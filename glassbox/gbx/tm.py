"""A compact multi-class Tsetlin Machine with integer clause weights, in numpy.

Standard TM (Granmo 2018) with the integer-weighted extension (Abeyrathna,
Granmo and Goodwin 2021):

* every class owns ``clauses_per_class`` clauses; even-numbered clauses vote
  for the class (polarity +1), odd-numbered ones against it (polarity -1);
* every clause has one Tsetlin automaton per literal (each feature x_k and its
  negation NOT x_k), with states 1..2N; a literal is included when its state
  is above N;
* a clause outputs the AND of its included literals (an empty clause outputs
  1 while learning and 0 at inference);
* class score = sum over firing clauses of polarity * weight, clipped to
  [-T, T] while learning;
* for a training example (x, y) the clauses of class y are selected for
  feedback with probability (T - v_y) / 2T, the clauses of one random other
  class q with probability (T + v_q) / 2T;  Type I feedback (reinforce /
  forget, specificity s, with "boosted" true-positive feedback) goes to the
  positive clauses of y and the negative clauses of q, Type II feedback
  (include a zero-valued literal to stop a false positive) to the rest;
* weights: +1 when a firing clause gets Type I feedback, -1 (never below 1)
  when a firing clause gets Type II feedback;
* optional ``max_literals``: a clause may not include more than this many
  literals (the "max_included_literals" option in TMU), which keeps every
  rule short enough to read.
"""
from __future__ import annotations

import numpy as np


class TsetlinMachine:
    def __init__(self, n_classes: int, n_features: int, clauses_per_class: int, T: int, s: float,
                 n_states: int = 127, max_literals: int | None = None, boost_tpf: bool = True,
                 weighted: bool = True, negation: str = "standard", init_depth: int = 0, seed: int = 0):
        """negation:
        "standard"  every literal is learned the same way (Granmo 2018);
        "ondemand"  Type Ia feedback does not recruit new negated literals: a
                    "NOT x" literal can only be included by Type II feedback
                    (to reject a false positive in which x is present), and is
                    then reinforced like any other included literal;
        "none"      negated literals are never included (TMU's feature_negation=False).
        With sparse Boolean features the standard rule fills clauses with dozens
        of "NOT <rare feature>" literals; "ondemand" keeps only the negations that
        actually separate the classes.
        """
        if clauses_per_class % 2:
            raise ValueError("clauses_per_class must be even")
        if negation not in ("standard", "ondemand", "none"):
            raise ValueError("negation must be standard, ondemand or none")
        self.negation = negation
        self.K, self.F, self.C = n_classes, n_features, clauses_per_class
        self.L = 2 * n_features
        self.T, self.s, self.N = int(T), float(s), int(n_states)
        self.max_literals = max_literals
        self.boost = boost_tpf
        self.weighted = weighted
        self.rng = np.random.default_rng(seed)
        # every automaton starts excluded, init_depth steps below the include boundary
        self.state = np.full((self.K, self.C, self.L), self.N - int(init_depth), dtype=np.int16)
        self.pol = np.where(np.arange(self.C) % 2 == 0, 1, -1).astype(np.int32)
        self.w = np.ones((self.K, self.C), dtype=np.int32)
        self._buf = np.empty((self.C, self.L), dtype=np.float32)

    # ------------------------------------------------------------------ helpers
    @staticmethod
    def literals(X: np.ndarray) -> np.ndarray:
        X = np.asarray(X, dtype=bool)
        return np.concatenate([X, ~X], axis=1)

    def _train_outputs(self, k: int, lit: np.ndarray) -> np.ndarray:
        inc = self.state[k] > self.N
        return ~(inc & ~lit).any(axis=1)

    def _cap_mask(self, st: np.ndarray, grow: np.ndarray) -> np.ndarray:
        """TMU-style literal budget: a clause that already includes max_literals
        literals may not include new ones (excluded automata stay at or below N)."""
        if self.max_literals is None:
            return grow
        full = (st > self.N).sum(axis=1) >= self.max_literals
        if full.any():
            grow &= ~(full[:, None] & (st == self.N))
        return grow

    def _type_i(self, k: int, idx: np.ndarray, out: np.ndarray, lit: np.ndarray) -> None:
        if idx.size == 0:
            return
        st = self.state[k, idx].astype(np.int32)
        fired = out[idx]
        r = self._buf[: idx.size]
        self.rng.random(out=r, dtype=np.float32)
        low = r < (1.0 / self.s)
        on = fired[:, None] & lit[None, :]
        if self.negation == "ondemand":
            on[:, self.F:] &= st[:, self.F:] > self.N
        elif self.negation == "none":
            on[:, self.F:] = False
        dec = low & ~on
        grow = on.copy() if self.boost else (on & ~low)
        grow = self._cap_mask(st, grow)
        st += grow
        st -= dec
        np.clip(st, 1, 2 * self.N, out=st)
        self.state[k, idx] = st
        if self.weighted:
            self.w[k, idx[fired]] += 1

    def _type_ii(self, k: int, idx: np.ndarray, out: np.ndarray, lit: np.ndarray) -> None:
        idx = idx[out[idx]]
        if idx.size == 0:
            return
        st = self.state[k, idx].astype(np.int32)
        grow = (~lit)[None, :] & (st <= self.N)
        if self.negation == "none":
            grow[:, self.F:] = False
        grow = self._cap_mask(st, grow)
        st += grow
        self.state[k, idx] = st
        if self.weighted:
            self.w[k, idx] = np.maximum(1, self.w[k, idx] - 1)

    def _update(self, lit: np.ndarray, y: int) -> None:
        q = int(self.rng.integers(self.K - 1))
        if q >= y:
            q += 1
        for k, positive in ((y, True), (q, False)):
            out = self._train_outputs(k, lit)
            v = int((self.pol * self.w[k] * out).sum())
            v = max(-self.T, min(self.T, v))
            p = (self.T - v) / (2 * self.T) if positive else (self.T + v) / (2 * self.T)
            sel = self.rng.random(self.C) < p
            if positive:
                t1 = np.nonzero(sel & (self.pol > 0))[0]
                t2 = np.nonzero(sel & (self.pol < 0))[0]
            else:
                t1 = np.nonzero(sel & (self.pol < 0))[0]
                t2 = np.nonzero(sel & (self.pol > 0))[0]
            self._type_i(k, t1, out, lit)
            self._type_ii(k, t2, out, lit)

    # ------------------------------------------------------------------ API
    def fit_epoch(self, X_lit: np.ndarray, y: np.ndarray) -> None:
        for i in self.rng.permutation(len(y)):
            self._update(X_lit[i], int(y[i]))

    def include_mask(self) -> np.ndarray:
        """(K, C, L) bool: which literals each clause includes."""
        return self.state > self.N

    def scores(self, X_lit: np.ndarray) -> np.ndarray:
        """Inference-mode class scores, (n, K) int."""
        inc = self.include_mask().reshape(self.K * self.C, self.L).astype(np.float32)
        nonempty = inc.sum(axis=1) > 0
        zeros = (~X_lit).astype(np.float32)
        viol = zeros @ inc.T
        fire = (viol == 0) & nonempty[None, :]
        votes = (np.tile(self.pol, self.K) * self.w.reshape(-1)).astype(np.float32)
        contrib = fire * votes[None, :]
        return contrib.reshape(len(X_lit), self.K, self.C).sum(axis=2).astype(np.int64)


def argmax_with_priority(scores: np.ndarray, priority: list[int]) -> np.ndarray:
    """Row-wise argmax; ties go to the class that comes first in `priority`."""
    rank = np.empty(len(priority), dtype=np.int64)
    for r, c in enumerate(priority):
        rank[c] = r
    best = np.empty(len(scores), dtype=np.int64)
    for i, row in enumerate(scores):
        m = row.max()
        cands = np.nonzero(row == m)[0]
        best[i] = cands[np.argmin(rank[cands])]
    return best


class ExportedModel:
    """Inference over the exported clause list: exactly what src/glassbox/tm.ts computes."""

    def __init__(self, model: dict):
        self.classes = model["classes"]
        self.features = [f["name"] for f in model["features"]]
        self.index = {n: i for i, n in enumerate(self.features)}
        self.priority = [self.classes.index(c) for c in model["tiePriority"]]
        self.clauses = [(self.classes.index(c["cls"]), int(c["pol"]), int(c["w"]), list(c["pos"]), list(c["neg"]))
                        for c in model["clauses"]]

    def vector(self, names) -> np.ndarray:
        x = np.zeros(len(self.features), dtype=bool)
        for n in names:
            j = self.index.get(n)
            if j is not None:
                x[j] = True
        return x

    def scores_one(self, x: np.ndarray) -> list[int]:
        s = [0] * len(self.classes)
        for k, pol, w, pos, neg in self.clauses:
            if all(x[j] for j in pos) and not any(x[j] for j in neg):
                s[k] += pol * w
        return s

    def predict_scores(self, X: np.ndarray) -> np.ndarray:
        K = len(self.classes)
        n = len(X)
        S = np.zeros((n, K), dtype=np.int64)
        Xf = X.astype(np.float32)
        Z = (~X).astype(np.float32)
        for k, pol, w, pos, neg in self.clauses:
            ok = np.ones(n, dtype=bool)
            if pos:
                ok &= Xf[:, pos].sum(axis=1) == len(pos)
            if neg:
                ok &= Z[:, neg].sum(axis=1) == len(neg)
            S[ok, k] += pol * w
        return S

    def predict(self, X: np.ndarray) -> np.ndarray:
        return argmax_with_priority(self.predict_scores(X), self.priority)
