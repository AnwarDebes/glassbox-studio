"""Router featurizer: a chat prompt -> a set of named Boolean features.

Mirrors src/glassbox/router-features.ts.  Features:

* ``w:<token>``   the token occurs (unigram)
* ``b:<t1> <t2>`` the two tokens occur next to each other (bigram)
* ``f:<token>``   the first content word, after skipping fillers such as
                  "please", "can you", "hey"
* ``x:<fact>``    a regex fact (code block, file path, URL, version, ...)
                  or a small verb lexicon (locate / change / execute /
                  explain / external-information words)
* ``len:short`` / ``len:long``

Which unigrams, bigrams and first words are kept is decided on the training
split only (document frequency, then a chi-square ranking) and stored in the
model JSON.
"""
from __future__ import annotations

import re

from .textnorm import fold, norm

FILLERS = ["please", "pls", "plz", "can", "could", "would", "will", "you", "u", "hey", "hi", "ok", "okay", "so", "now", "quick",
           "question", "q", "i", "im", "need", "want", "to", "lets", "let", "us", "me", "just", "kindly", "yo", "alright", "next",
           "also", "go", "ahead", "and", "hmm", "btw", "curious", "quickly", "the", "a", "an", "then", "first"]

FACTS = [
    ("x:code_block", "text", r"\x60\x60\x60", "contains a code block"),
    ("x:inline_code", "text", r"\x60[^\x60\n]+\x60", "contains inline code"),
    ("x:path", "text", r"[a-z0-9_-]+/[a-z0-9_./-]+|\b[a-z0-9_-]+\.(tsx?|jsx?|py|go|rs|java|rb|md|json|ya?ml|toml|css|html|sql|sh|ipynb)\b",
     "mentions a file path"),
    ("x:url", "text", r"https?://", "contains a URL"),
    ("x:version", "text", r"\bv?[0-9]+\.[0-9]+(\.[0-9]+)?\b|\b(version|v)[ \t]?[0-9]+\b|\b[a-z]+[ \t][0-9]{1,2}\b", "mentions a version"),
    ("x:year", "text", r"\b20[0-9]{2}\b", "mentions a year"),
    ("x:camel", "raw", r"\b[a-z]+[A-Z][a-zA-Z0-9]*\b", "mentions a camelCase identifier"),
    ("x:snake", "text", r"\b[a-z]+_[a-z0-9_]+\b", "mentions a snake_case identifier"),
    ("x:error_text", "text", r"error|exception|traceback|failed|cannot|undefined|panic|segmentation|refused|eaddrinuse|eresolve|nullpointer",
     "quotes an error"),
    ("x:question_mark", "text", r"\?", "asks a question (?)"),
    ("x:cli", "text", r"\b(npm|pnpm|yarn|npx|pip|python|node|cargo|go|git|docker|make|pytest|tsc|kubectl|terraform|bun|deno)\b",
     "mentions a CLI tool"),
    ("x:lex_locate", "text", r"\b(where|wheres|find|locate|grep|search|scan|show|list|usages?|references?|defined|imported|import|calls|uses|open|print|contents)\b",
     "uses a locate/show word"),
    ("x:lex_change", "text",
     r"\b(add|fix|refactor|rename|implement|update|change|remove|delete|write|create|convert|replace|make|extract|move|rewrite|clean|port|patch|edit|translate|optimize|split|bump)\b",
     "uses a change-the-code word"),
    ("x:lex_execute", "text",
     r"\b(run|rerun|execute|start|build|install|uninstall|deploy|test|lint|compile|compiles|launch|restart|kill|commit|push|pull|merge|stash|format|benchmark|spin|tail|ping|rebuild)\b",
     "uses an execute word"),
    ("x:lex_explain", "text", r"\b(what|whats|why|how|explain|difference|mean|means|understand|eli5|describe|tell|should|better|pros|cons|example|purpose)\b",
     "uses an explain word"),
    ("x:lex_external", "text",
     r"\b(latest|newest|recent|current|currently|today|these days|right now|news|changelog|roadmap|docs|documentation|online|web|internet|google|stack overflow|github|cve|vulnerabilit[a-z]*|benchmarks?|pricing|maintained|released?|lts|tutorial|papers?|consensus|trending|popular|status page)\b",
     "asks for outside / fresh information"),
]

_TOKEN = re.compile(r"[a-z0-9]+", re.ASCII)


def export_spec() -> dict:
    return {"kind": "router", "version": 1, "token": _TOKEN.pattern, "fillers": FILLERS, "shortMax": 3, "longMin": 20,
            "facts": [{"name": n, "on": on, "re": rx} for (n, on, rx, _t) in FACTS]}


class RouterFeaturizer:
    def __init__(self, spec: dict | None = None):
        self.spec = spec or export_spec()
        self.token = re.compile(self.spec["token"], re.ASCII)
        self.fillers = set(self.spec["fillers"])
        self.facts = [(f["name"], f["on"], re.compile(f["re"], re.ASCII)) for f in self.spec["facts"]]
        self.short_max = self.spec["shortMax"]
        self.long_min = self.spec["longMin"]

    def tokens(self, prompt: str) -> list[str]:
        return self.token.findall(norm(prompt).replace("'", ""))

    def featurize(self, prompt: str) -> list[str]:
        text = norm(prompt).replace("'", "")
        raw = fold(prompt)
        toks = self.token.findall(text)
        feats: set[str] = set()
        for t in toks:
            feats.add("w:" + t)
        for a, b in zip(toks, toks[1:]):
            feats.add("b:" + a + " " + b)
        for t in toks:
            if t not in self.fillers:
                feats.add("f:" + t)
                break
        if len(toks) <= self.short_max:
            feats.add("len:short")
        if len(toks) >= self.long_min:
            feats.add("len:long")
        for name, on, rx in self.facts:
            if rx.search(text if on == "text" else raw):
                feats.add(name)
        return sorted(feats)


_TEXT = {n: t for (n, _on, _rx, t) in FACTS}
_TEXT.update({"len:short": "is very short (3 words or fewer)", "len:long": "is long (20+ words)"})


def describe(name: str) -> tuple[str, str]:
    if name in _TEXT:
        t = _TEXT[name]
        return t, "NOT " + t
    fam, _, val = name.partition(":")
    if fam == "w":
        return f'says "{val}"', f'NOT "{val}"'
    if fam == "b":
        return f'says "{val}"', f'NOT "{val}"'
    if fam == "f":
        return f'starts with "{val}"', f'does not start with "{val}"'
    return name, "NOT " + name


FAMILY_ORDER = ["f", "w", "b", "x", "len"]


def feature_sort_key(name: str) -> tuple:
    fam = name.split(":", 1)[0]
    return (FAMILY_ORDER.index(fam) if fam in FAMILY_ORDER else 9, name)
