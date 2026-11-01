"""Guard featurizer: a proposed tool call -> a set of named Boolean features.

Mirrors src/glassbox/guard-features.ts line by line.  The regexes and lists
come from guard_spec.py (and are shipped inside the model JSON), so only the
procedural steps below have two implementations; glassbox/parity.json and
src/glassbox/__tests__/parity.test.mjs check that both agree.
"""
from __future__ import annotations

import re
from typing import Iterable

from . import guard_spec as S
from .textnorm import fold, norm

FIELDS_MULTI = {"cmd", "cmdraw", "code", "path", "url", "content", "query", "all"}
FIELDS_LIST = {"cmdword", "flag", "target", "host", "urlfull", "method"}

# "(?![\s\S])" is the portable end-of-string; Python's "$" would also match before a final "\n".
_END = r"(?![\s\S])"
_ENV_ASSIGN = re.compile(r"^[a-z_][a-z0-9_]*=", re.ASCII)
_CMD_OK = re.compile(r"^[a-z0-9][a-z0-9._+-]{0,23}" + _END, re.ASCII)
_FLAG_OK = re.compile(r"^(-{1,2}[a-z0-9][a-z0-9._-]{0,22}|/[a-z?])" + _END, re.ASCII)
_WIN_FLAG = re.compile(r"^/[a-z?]" + _END, re.ASCII)
_DRIVE = re.compile(r"^[a-z]:(/|" + _END + ")", re.ASCII)
_KEY_VALUE = re.compile(r"^[a-z][a-z0-9_]*=", re.ASCII)
_REMOTE = re.compile(r"^[a-z0-9._-]+@[a-z0-9.-]+:", re.ASCII)
_REDIRECT = re.compile(r"(?:^|[^<>0-9&])>{1,2}[ \t]*([^ \t\n<>|;&()]+)", re.ASCII)
_URL = re.compile(r"(?:https?|ftp|wss?|file)://[^ \t\n'\"<>|;()\x60\\]+", re.ASCII)
_IPV4 = re.compile(r"^[0-9]{1,3}(\.[0-9]{1,3}){3}" + _END, re.ASCII)
_USER_HOST = re.compile(r"^[a-z0-9._-]+@([a-z0-9.-]+\.[a-z0-9.-]+)(:|" + _END + ")", re.ASCII)
_HAS_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.ASCII)
_SUBST = re.compile(r"\$\(([^()]*)\)|\x60([^\x60]*)\x60", re.ASCII)
_HOME_FORMS = ("~", "$home", "${home}", "$env:userprofile", "$env:home", "%userprofile%", "%homepath%")


class GuardFeaturizer:
    """Compiles the spec once; featurize(call) returns a sorted list of feature names."""

    def __init__(self, spec: dict | None = None):
        self.spec = spec or export_spec()
        sp = self.spec
        self.wrappers = set(sp["wrappers"])
        self.wrapper_value_flags = set(sp["wrapperValueFlags"])
        self.multi = set(sp["multi"])
        self.file_cmds = set(sp["fileCmds"])
        self.mode_first = set(sp["modeFirstArg"])
        self.dev_null = set(sp["devNull"])
        self.readonly_head = re.compile(sp["readonlyHead"], re.ASCII)
        self.localhost = re.compile(sp["localhostHost"], re.ASCII)
        self.known = re.compile(sp["knownHost"], re.ASCII)
        self.facts = [(f["name"], f["on"], re.compile(f["re"], re.ASCII)) for f in sp["facts"]]
        self.any_of = [(a["name"], a["of"]) for a in sp["anyOf"]]
        self.all_of = [(a["name"], a["groups"]) for a in sp["allOf"]]
        self.arg_keys = sp["argKeys"]

    # ------------------------------------------------------------------ fields
    def fields(self, call: dict) -> dict:
        args = call.get("args") or {}

        def pick(kind: str) -> str:
            for k in self.arg_keys[kind]:
                v = args.get(k)
                if isinstance(v, str) and v != "":
                    return v
            return ""

        raw_cmd = pick("cmd")
        f = {
            "tool": str(call.get("tool") or ""),
            "cmd": norm(raw_cmd),
            "cmdraw": fold(raw_cmd),
            "cwd": norm(pick("cwd")),
            "code": norm(pick("code")),
            "path": norm(pick("path")),
            "url": norm(pick("url")),
            "method": norm(pick("method")).replace("\n", " "),
            "content": norm(pick("content")),
            "query": norm(pick("query")),
            "ws": norm(str(call.get("workspaceRoot") or "")),
        }
        f["all"] = "\n".join([f["cmd"], f["code"], f["path"], f["url"], f["content"], f["query"]])
        return f

    # ------------------------------------------------------------ featurize
    def featurize(self, call: dict) -> list[str]:
        f = self.fields(call)
        feats: set[str] = {"tool:" + f["tool"]}
        lists = {"cmdword": [], "flag": [], "target": [], "host": [], "urlfull": [],
                 "method": [f["method"]] if f["method"] else []}

        heads: list[str] = []
        if f["cmd"]:
            self._shell(f["cmd"], lists, heads, feats)
            if heads and all(self.readonly_head.search(h) for h in heads):
                feats.add("exec:all_readonly")
        if f["path"]:
            lists["target"].append(f["path"])
        elif f["tool"] in ("list_files", "search"):
            lists["target"].append(".")
        if f["cwd"]:
            lists["target"].append(f["cwd"])
        if f["tool"] == "write_file" and re.sub(r"[ \t\n]", "", f["content"]) == "":
            feats.add("content:empty")

        self._urls(f, lists, feats)
        self._targets(lists, f["ws"], feats)

        for name, on, rx in self.facts:
            if name in feats:
                continue
            for field in on:
                if field in FIELDS_LIST:
                    if any(rx.search(v) for v in lists[field]):
                        feats.add(name)
                        break
                else:
                    v = f[field]
                    if v and rx.search(v):
                        feats.add(name)
                        break

        for name, members in self.any_of:
            if any(m in feats for m in members):
                feats.add(name)
        for name, groups in self.all_of:
            if all(any(m in feats for m in g) for g in groups):
                feats.add(name)
        return sorted(feats)

    # ---------------------------------------------------------------- shell
    def _shell(self, cmd: str, lists: dict, heads: list, feats: set) -> None:
        segments = shell_segments(cmd)
        # $(...) and `...` run even inside double quotes, where the tokenizer
        # keeps them as one token, so their bodies are analysed as commands too.
        for m in _SUBST.finditer(cmd):
            segments += shell_segments(m.group(1) if m.group(1) is not None else m.group(2))
        for toks in segments:
            i, n = 0, len(toks)
            main = -1
            while i < n:
                t = toks[i]
                if t == "" or t == "$" or _ENV_ASSIGN.match(t):
                    i += 1
                    continue
                w = basename(t)
                self._add_cmd(w, lists, feats)
                if w in self.wrappers:
                    i += 1
                    while i < n and toks[i].startswith("-"):
                        takes_value = toks[i] in self.wrapper_value_flags
                        i += 1
                        if takes_value and i < n:
                            i += 1
                    if w == "timeout" and i < n and toks[i][:1].isdigit():
                        i += 1
                    continue
                main = i
                break
            if main < 0:
                continue
            w = basename(toks[main])
            rest = toks[main + 1:]
            head = w
            if w in self.multi:
                for t in rest:
                    if not t.startswith("-"):
                        if _CMD_OK.match(t):
                            feats.add("sub:" + w + " " + t)
                            head = w + " " + t
                        break
            heads.append(head)
            for j, t in enumerate(rest):
                if t in ("-exec", "-execdir", "-ok") and j + 1 < len(rest):
                    self._add_cmd(basename(rest[j + 1]), lists, feats)
            file_cmd = w in self.file_cmds
            skip_first = w in self.mode_first
            seen_arg = False
            for t in rest:
                if is_flag(t):
                    fl = t.split("=", 1)[0]
                    if _FLAG_OK.match(fl):
                        lists["flag"].append(fl)
                        feats.add("flag:" + fl)
                    continue
                if skip_first and not seen_arg:
                    seen_arg = True
                    continue
                seen_arg = True
                kv = _KEY_VALUE.match(t)
                if kv and not _REMOTE.match(t):
                    t = t[kv.end():]
                    if t == "":
                        continue
                if file_cmd or path_like(t):
                    if "://" not in t and not _REMOTE.match(t):
                        lists["target"].append(t)
        for m in _REDIRECT.finditer(cmd):
            lists["target"].append(m.group(1).strip("\"'"))

    def _add_cmd(self, w: str, lists: dict, feats: set) -> None:
        if _CMD_OK.match(w):
            lists["cmdword"].append(w)
            feats.add("cmd:" + w)

    # ---------------------------------------------------------------- network
    def _urls(self, f: dict, lists: dict, feats: set) -> None:
        urls = [m.group(0) for m in _URL.finditer(f["all"])]
        if f["tool"] == "fetch_url" and f["url"] and not _HAS_SCHEME.match(f["url"]):
            urls.append("https://" + f["url"])
        hosts = []
        for u in urls:
            lists["urlfull"].append(u)
            if u.startswith("file:"):
                lists["target"].append(u[len("file://"):] if u.startswith("file://") else u[5:])
                continue
            h = url_host(u)
            if h:
                hosts.append(h)
                if u.startswith("http:") and not self.localhost.search(h):
                    feats.add("net:http_plain")
        for seg_word in f["cmd"].replace("\t", " ").replace("\n", " ").split(" "):
            t = seg_word.strip("\"'")
            if _IPV4.match(t):
                hosts.append(t)
            else:
                m = _USER_HOST.match(t)
                if m:
                    hosts.append(m.group(1))
        if urls:
            feats.add("net:url")
        for h in hosts:
            lists["host"].append(h)
            if not self.localhost.search(h) and not self.known.search(h):
                feats.add("net:unknown_host")

    # ---------------------------------------------------------------- paths
    def _targets(self, lists: dict, ws_raw: str, feats: set) -> None:
        clean = []
        ws = _segments(ws_raw.replace("\\", "/")) if ws_raw else None
        ws_abs = bool(ws_raw) and (ws_raw.replace("\\", "/").startswith("/") or bool(_DRIVE.match(ws_raw.replace("\\", "/"))))
        for t in lists["target"]:
            t = t.replace("\\", "/").replace("\n", " ").replace("\t", " ")
            if t == "" or t in self.dev_null:
                continue
            clean.append(t)
            where = resolve(t, ws, ws_abs)
            if where == "outside":
                feats.add("path:outside_ws")
            elif where == "escape":
                feats.add("path:outside_ws")
                feats.add("path:escapes_ws")
            elif where == "root":
                feats.add("path:inside_ws")
                feats.add("path:ws_root")
            else:
                feats.add("path:inside_ws")
        lists["target"] = clean


# ---------------------------------------------------------------------------
# Procedural helpers (each has a twin in guard-features.ts)
# ---------------------------------------------------------------------------
SEPARATORS = ";\n|&()\x60"


def shell_segments(s: str) -> list[list[str]]:
    """Split a normalised shell command into pipeline segments of tokens.

    Quotes group characters (and are dropped), whitespace and < > end a token,
    and ; newline | & ( ) and backtick end a segment.  An & that belongs to a
    redirection (2>&1, &>) is skipped.  Backslashes are ordinary characters so
    Windows paths survive.
    """
    segs: list[list[str]] = []
    cur: list[str] = []
    tok: str | None = None
    quote = ""
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if quote:
            if c == quote:
                quote = ""
            else:
                tok += c
            i += 1
            continue
        if c == "'" or c == '"':
            quote = c
            if tok is None:
                tok = ""
            i += 1
            continue
        if c == " " or c == "\t" or c == "<" or c == ">":
            if tok is not None:
                cur.append(tok)
                tok = None
            i += 1
            continue
        if c == "&" and ((i + 1 < n and s[i + 1] == ">") or (i > 0 and s[i - 1] in "<>")):
            if tok is not None:
                cur.append(tok)
                tok = None
            i += 1
            continue
        if c in SEPARATORS:
            if tok is not None:
                cur.append(tok)
                tok = None
            if cur:
                segs.append(cur)
                cur = []
            i += 1
            continue
        tok = c if tok is None else tok + c
        i += 1
    if tok is not None:
        cur.append(tok)
    if cur:
        segs.append(cur)
    return segs


def basename(t: str) -> str:
    t = t.replace("\\", "/")
    k = t.rfind("/")
    return t[k + 1:] if k >= 0 else t


def is_flag(t: str) -> bool:
    return (len(t) >= 2 and t[0] == "-" and t != "--") or bool(_WIN_FLAG.match(t))


def path_like(t: str) -> bool:
    if t == "" or "://" in t or _REMOTE.match(t):
        return False
    if t in (".", "..", "*", "~"):
        return True
    if t[0] in "/.~%\\":
        return True
    if t.startswith("$home") or t.startswith("${home}") or t.startswith("$env:"):
        return True
    if _DRIVE.match(t.replace("\\", "/")):
        return True
    return "/" in t or "\\" in t or "*" in t


def url_host(u: str) -> str:
    k = u.find("://")
    rest = u[k + 3:] if k >= 0 else u
    for ch in "/?#":
        j = rest.find(ch)
        if j >= 0:
            rest = rest[:j]
    at = rest.rfind("@")
    if at >= 0:
        rest = rest[at + 1:]
    if rest.startswith("["):
        j = rest.find("]")
        host = rest[: j + 1] if j >= 0 else rest
    else:
        j = rest.find(":")
        host = rest[:j] if j >= 0 else rest
    while host.endswith("."):
        host = host[:-1]
    return host


def _segments(p: str) -> list[str]:
    out: list[str] = []
    for seg in p.split("/"):
        if seg == "" or seg == ".":
            continue
        if seg == "..":
            if out:
                out.pop()
            continue
        out.append(seg)
    return out


def resolve(t: str, ws: list[str] | None, ws_abs: bool) -> str:
    """Where a target lands relative to the workspace: inside | root | outside | escape."""
    for h in _HOME_FORMS:
        if t == h or t.startswith(h + "/") or (h == "~" and t.startswith("~")):
            return "outside"
    if t.startswith("/") or _DRIVE.match(t):
        if ws is None or not ws_abs:
            return "outside"
        segs = _segments(t)
        if segs == ws:
            return "root"
        if segs[: len(ws)] == ws:
            return "inside"
        return "outside"
    depth = 0
    for seg in t.split("/"):
        if seg == "" or seg == ".":
            continue
        if seg == "..":
            depth -= 1
            if depth < 0:
                return "escape"
        else:
            depth += 1
    return "root" if depth == 0 else "inside"


# ---------------------------------------------------------------------------
# Spec export and readable descriptions
# ---------------------------------------------------------------------------
def export_spec() -> dict:
    return {
        "kind": "guard",
        "version": 1,
        "argKeys": S.ARG_KEYS,
        "wrappers": S.WRAPPERS,
        "wrapperValueFlags": S.WRAPPER_VALUE_FLAGS,
        "multi": S.MULTI,
        "fileCmds": S.FILE_CMDS,
        "modeFirstArg": S.MODE_FIRST_ARG,
        "devNull": S.DEV_NULL,
        "readonlyHead": S.READONLY_HEAD,
        "localhostHost": S.LOCALHOST_HOST,
        "knownHost": S.KNOWN_HOST,
        "facts": [{"name": n, "on": on, "re": rx} for (n, on, rx, *_rest) in S.FACTS],
        "anyOf": [{"name": n, "of": of} for (n, of, _t) in S.ANY_OF],
        "allOf": [{"name": n, "groups": g} for (n, g, _t) in S.ALL_OF],
    }


_TEXT: dict[str, tuple[str, str]] = {}
for _n, _on, _rx, _t, *_neg in S.FACTS:
    _TEXT.setdefault(_n, (_t, _neg[0] if _neg else "NOT " + _t))
for _n, _of, _t in S.ANY_OF + S.ALL_OF:
    _TEXT.setdefault(_n, (_t, "NOT " + _t))
for _n, (_t, _neg) in S.PROCEDURAL_TEXT.items():
    _TEXT.setdefault(_n, (_t, _neg))


def describe(name: str) -> tuple[str, str]:
    """(text when the feature is present, text when it is required absent)."""
    if name in _TEXT:
        return _TEXT[name]
    fam, _, val = name.partition(":")
    if fam == "tool":
        return f"tool is {val}", f"tool is not {val}"
    if fam == "cmd":
        return f'command has "{val}"', f'NOT "{val}"'
    if fam == "sub":
        return f'runs "{val}"', f'NOT "{val}"'
    if fam == "flag":
        return f'flag "{val}"', f'NOT "{val}"'
    return name, "NOT " + name


FAMILY_ORDER = ["tool", "cmd", "sub", "flag", "exec", "git", "pkg", "del", "perm", "sys", "sh", "path", "net", "secret",
                "exfil", "js", "content", "query", "env"]


def feature_sort_key(name: str) -> tuple:
    fam = name.split(":", 1)[0]
    return (FAMILY_ORDER.index(fam) if fam in FAMILY_ORDER else len(FAMILY_ORDER), name)


def check_spec_portability(spec: dict) -> list[str]:
    """Flag regex constructs whose meaning differs between Python and JavaScript."""
    problems = []
    bad = ["(?P", "(?i", "(?m", "(?s", "(?x", "\\A", "\\Z", "{,", "(?<=", "(?<!", "(?#", "\\h"]
    for f in spec["facts"]:
        rx = f["re"]
        for b in bad:
            if b in rx:
                problems.append(f"{f['name']}: uses {b}")
        if set(f["on"]) & FIELDS_MULTI:
            if re.search(r"(?<!\\)\$", rx):
                problems.append(f"{f['name']}: unescaped $ on a multi-line field")
    return problems


def iter_feature_names(featurizer: GuardFeaturizer, calls: Iterable[dict]) -> list[list[str]]:
    return [featurizer.featurize(c) for c in calls]
