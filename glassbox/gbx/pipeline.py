"""Shared training / evaluation / export helpers for both models."""
from __future__ import annotations

import collections
import hashlib
import json
import os
import random
import time

import numpy as np

from .tm import ExportedModel, TsetlinMachine, argmax_with_priority

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))          # .../glassbox
PROJECT = os.path.dirname(ROOT)                                                # project root
DATA = os.path.join(ROOT, "data")
RESULTS = os.path.join(ROOT, "results")
MODELS = os.path.join(PROJECT, "public", "models")


# ----------------------------------------------------------------------------- io
def write_jsonl(path: str, rows: list[dict]) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")


def read_jsonl(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


# ----------------------------------------------------------------------------- split
def assign_splits(rows: list[dict], seed: int, test: float = 0.20, val: float = 0.15) -> None:
    """Stratified by label and seeded; writes row['split'] in place."""
    rng = random.Random(seed)
    by = collections.defaultdict(list)
    for i, r in enumerate(rows):
        by[r["label"]].append(i)
    for label in sorted(by):
        idx = by[label]
        rng.shuffle(idx)
        n_test = round(len(idx) * test)
        n_val = round(len(idx) * val)
        for j, i in enumerate(idx):
            rows[i]["split"] = "test" if j < n_test else ("val" if j < n_test + n_val else "train")


# ----------------------------------------------------------------------------- vocab
def build_vocab(feature_lists: list[list[str]], labels: list[str], min_df: dict, caps: dict, sort_key) -> list[str]:
    """Keep features by document frequency per family, optionally keep the top
    `caps[family]` by a multi-class chi-square score.  Training data only."""
    df = collections.Counter()
    by_class = collections.defaultdict(collections.Counter)
    for fs, y in zip(feature_lists, labels):
        s = set(fs)
        df.update(s)
        by_class[y].update(s)
    n = len(labels)
    class_n = collections.Counter(labels)
    kept = []
    fams = collections.defaultdict(list)
    for f, c in df.items():
        fam = f.split(":", 1)[0]
        if c >= min_df.get(fam, min_df.get("*", 1)):
            fams[fam].append(f)
    for fam, names in fams.items():
        cap = caps.get(fam)
        if cap is not None and len(names) > cap:
            def chi2(f):
                total = 0.0
                for y, ny in class_n.items():
                    a = by_class[y][f]
                    exp = df[f] * ny / n
                    total += (a - exp) ** 2 / max(exp, 1e-9)
                return total
            names = sorted(names, key=lambda f: (-chi2(f), f))[:cap]
        kept.extend(names)
    return sorted(kept, key=sort_key)


def matrix(feature_lists: list[list[str]], vocab: list[str]) -> np.ndarray:
    index = {f: i for i, f in enumerate(vocab)}
    X = np.zeros((len(feature_lists), len(vocab)), dtype=bool)
    for r, fs in enumerate(feature_lists):
        for f in fs:
            j = index.get(f)
            if j is not None:
                X[r, j] = True
    return X


# ----------------------------------------------------------------------------- metrics
def metrics(y_true: np.ndarray, y_pred: np.ndarray, classes: list[str]) -> dict:
    K = len(classes)
    cm = np.zeros((K, K), dtype=int)
    for t, p in zip(y_true, y_pred):
        cm[t, p] += 1
    per = {}
    for k, c in enumerate(classes):
        tp = cm[k, k]
        prec = tp / cm[:, k].sum() if cm[:, k].sum() else 0.0
        rec = tp / cm[k, :].sum() if cm[k, :].sum() else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        per[c] = {"precision": round(float(prec), 4), "recall": round(float(rec), 4), "f1": round(float(f1), 4), "support": int(cm[k, :].sum())}
    acc = float(np.trace(cm) / cm.sum()) if cm.sum() else 0.0
    return {"accuracy": round(acc, 4), "macroF1": round(float(np.mean([per[c]["f1"] for c in classes])), 4), "n": int(cm.sum()),
            "perClass": per, "confusion": {"rows": "true", "cols": "predicted", "classes": classes, "matrix": cm.tolist()}}


# ----------------------------------------------------------------------------- training
def train_tm(X: np.ndarray, y: np.ndarray, K: int, hp: dict, priority: list[int], seed: int,
             X_val: np.ndarray | None = None, y_val: np.ndarray | None = None, log=None) -> tuple[TsetlinMachine, list[float]]:
    tm = TsetlinMachine(K, X.shape[1], hp["clauses"], hp["T"], hp["s"], max_literals=hp.get("max_literals"),
                        negation=hp.get("negation", "standard"), seed=seed)
    lit = TsetlinMachine.literals(X)
    lit_val = TsetlinMachine.literals(X_val) if X_val is not None else None
    curve = []
    for ep in range(hp["epochs"]):
        t0 = time.time()
        tm.fit_epoch(lit, y)
        if lit_val is not None:
            acc = float((argmax_with_priority(tm.scores(lit_val), priority) == y_val).mean())
            curve.append(round(acc, 4))
            if log:
                log(f"    epoch {ep + 1:3d}  val acc {acc:.4f}  ({time.time() - t0:.1f}s)")
    return tm, curve


def simplify_clauses(tm: TsetlinMachine, X_lit: np.ndarray, y: np.ndarray) -> dict:
    """Rewrite every trained clause as a short, readable conjunction (in place).

    On sparse Boolean features a trained clause is typically one or two
    present-feature literals buried among dozens of "NOT <rare feature>"
    literals.  For each clause:

    * P = the training examples on which the clause fires;
    * "bad" examples = those where a vote from this clause would hurt: another
      class for a +1 clause, the clause's own class for a -1 clause;
    * candidate literals = every literal (over all features, present or
      negated) that is true on all of P, so any conjunction of candidates
      still fires on all of P;
    * greedy set cover: repeatedly add the candidate that rules out the most
      bad examples outside P that are not yet ruled out (ties: a present-
      feature literal before a negated one, then the one that rules out fewer
      good examples), until every bad example the trained clause ruled out is
      ruled out again (the trained clause's own literals always suffice).

    The new clause fires on P plus possibly some extra examples, none of them
    bad, so no training example's class score moves in the wrong direction.
    Clauses that fire on no training example are left alone (export drops
    them).  This is post-processing, not part of TM learning, and the exported
    (rewritten) model is the one evaluated on the test split.
    """
    inc = tm.include_mask()
    before = int(inc.sum())
    F = tm.F
    changed = 0
    order: dict[tuple[int, int], list[int]] = {}
    for k in range(tm.K):
        for j in range(tm.C):
            S = np.nonzero(inc[k, j])[0]
            if S.size == 0:
                continue
            fires = ~(~X_lit[:, S]).any(axis=1)
            if not fires.any():
                continue
            bad = (y != k) if tm.pol[j] > 0 else (y == k)
            cand = np.nonzero(X_lit[fires].all(axis=0))[0]
            fails = ~X_lit[:, cand]                     # candidate false on example -> rules it out
            todo = bad & ~fires
            good_out = (fails & ~bad[:, None]).sum(axis=0)
            negated = (cand >= F).astype(np.int64)
            kept: list[int] = []
            while todo.any():
                cover = fails[todo].sum(axis=0)
                r = int(np.lexsort((good_out, negated, -cover))[0])
                if cover[r] == 0:
                    break
                kept.append(int(cand[r]))
                todo &= ~fails[:, r]
            if todo.any() or not kept:
                continue  # cannot happen with the trained literals available; keep the clause as trained
            new = np.zeros(tm.L, dtype=bool)
            new[kept] = True
            tm.state[k, j] = np.where(new, tm.N + 1, np.minimum(tm.state[k, j], tm.N))
            order[(k, j)] = kept
            changed += 1
    tm.literal_order = order
    after = int(tm.include_mask().sum())
    return {"includedLiteralsBefore": before, "includedLiteralsAfter": after, "clausesRewritten": changed}


def export_clauses(tm: TsetlinMachine, classes: list[str], X_train_lit: np.ndarray | None = None) -> tuple[list[dict], dict]:
    """Turn TA states into the JSON clause list, dropping clauses that can never
    fire at inference: empty ones, self-contradictory ones (x AND NOT x) and,
    when training data is given, ones that fire on no training example."""
    inc = tm.include_mask()
    F = tm.F
    clauses = []
    dropped = collections.Counter()
    fires_any = None
    if X_train_lit is not None:
        zeros = (~X_train_lit).astype(np.float32)
        viol = zeros @ inc.reshape(tm.K * tm.C, tm.L).astype(np.float32).T
        fires_any = (viol == 0).any(axis=0).reshape(tm.K, tm.C)
    for k in range(tm.K):
        for j in range(tm.C):
            pos = np.nonzero(inc[k, j, :F])[0].tolist()
            neg = np.nonzero(inc[k, j, F:])[0].tolist()
            ordered = getattr(tm, "literal_order", {}).get((k, j))
            if ordered is not None and sorted(ordered) == sorted(pos + [F + n for n in neg]):
                # keep the order the simplification chose: most discriminating literal first
                pos = [l for l in ordered if l < F]
                neg = [l - F for l in ordered if l >= F]
            if not pos and not neg:
                dropped["empty"] += 1
                continue
            if set(pos) & set(neg):
                dropped["contradictory"] += 1
                continue
            if fires_any is not None and not fires_any[k, j]:
                dropped["never_fires_on_training_data"] += 1
                continue
            clauses.append({"cls": classes[k], "pol": int(tm.pol[j]), "w": int(tm.w[k, j]), "pos": pos, "neg": neg})
    for i, c in enumerate(clauses):
        c["id"] = i
    return clauses, dict(dropped)


def clause_stats(clauses: list[dict]) -> dict:
    lens = [len(c["pos"]) + len(c["neg"]) for c in clauses]
    return {"clauses": len(clauses), "avgLiterals": round(float(np.mean(lens)), 2) if lens else 0.0,
            "maxLiterals": int(max(lens)) if lens else 0,
            "positiveLiteralShare": round(sum(len(c["pos"]) for c in clauses) / max(1, sum(lens)), 3),
            "perClass": dict(collections.Counter(c["cls"] for c in clauses))}


RULE_SHOWN = 6


def rule_text(clause: dict, features: list[dict]) -> str:
    """Readable rule: present-feature conditions first, then negations in the
    stored (most discriminating first) order; at most RULE_SHOWN conditions,
    then "(+N more conditions)".  Mirrors CompiledModel.describe in tm.ts."""
    parts = [features[j]["text"] for j in clause["pos"]] + [features[j]["neg"] for j in clause["neg"]]
    head = clause["cls"] if clause["pol"] > 0 else "not " + clause["cls"]
    shown = " AND ".join(parts[:RULE_SHOWN])
    more = len(parts) - RULE_SHOWN
    return f"{head} because: {shown}" + (f" (+{more} more conditions)" if more > 0 else "")


def evaluate_exported(model: dict, feature_lists: list[list[str]], labels: list[str]) -> tuple[dict, np.ndarray, np.ndarray]:
    em = ExportedModel(model)
    X = np.stack([em.vector(fs) for fs in feature_lists]) if feature_lists else np.zeros((0, len(em.features)), dtype=bool)
    S = em.predict_scores(X)
    pred = argmax_with_priority(S, em.priority)
    y = np.array([model["classes"].index(l) for l in labels])
    return metrics(y, pred, model["classes"]), pred, S
