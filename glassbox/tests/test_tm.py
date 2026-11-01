"""Tsetlin Machine tests:  python -m unittest discover -s glassbox/tests"""
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gbx.pipeline import export_clauses, simplify_clauses  # noqa: E402
from gbx.tm import ExportedModel, TsetlinMachine, argmax_with_priority  # noqa: E402


def toy(n=600, seed=0):
    """Three classes defined by short rules over 12 noisy-free Boolean features."""
    rng = np.random.default_rng(seed)
    X = rng.random((n, 12)) < 0.3
    y = np.where(X[:, 0] & X[:, 1], 2, np.where(X[:, 2] & ~X[:, 3], 1, 0))
    return X, y


class TM(unittest.TestCase):
    def setUp(self):
        self.X, self.y = toy()
        self.tm = TsetlinMachine(3, 12, 20, T=30, s=3.0, seed=3)
        lit = TsetlinMachine.literals(self.X)
        for _ in range(30):
            self.tm.fit_epoch(lit, self.y)
        self.lit = lit

    def acc(self):
        return float((argmax_with_priority(self.tm.scores(self.lit), [0, 1, 2]) == self.y).mean())

    def test_learns_toy_rules(self):
        self.assertGreater(self.acc(), 0.97)

    def test_export_matches_tm_inference(self):
        clauses, _ = export_clauses(self.tm, ["a", "b", "c"])
        model = {"classes": ["a", "b", "c"], "tiePriority": ["a", "b", "c"], "features": [{"name": f"f{i}"} for i in range(12)],
                 "clauses": clauses}
        em = ExportedModel(model)
        np.testing.assert_array_equal(em.predict_scores(self.X), self.tm.scores(self.lit))
        x = self.X[7]
        self.assertEqual(em.scores_one(x), list(self.tm.scores(self.lit[7:8])[0]))

    def test_simplification_never_hurts_training_votes(self):
        before = self.tm.scores(self.lit)
        info = simplify_clauses(self.tm, self.lit, self.y)
        after = self.tm.scores(self.lit)
        self.assertLessEqual(info["includedLiteralsAfter"], info["includedLiteralsBefore"])
        true_gain = after[np.arange(len(self.y)), self.y] - before[np.arange(len(self.y)), self.y]
        self.assertTrue((true_gain >= 0).all(), "a correct class lost votes")
        for k in range(3):
            wrong = self.y != k
            self.assertTrue((after[wrong, k] <= before[wrong, k]).all(), "a wrong class gained votes")
        self.assertGreaterEqual(self.acc(), 0.97)

    def test_tie_priority(self):
        s = np.array([[1, 1, 0], [0, 0, 0], [2, 5, 5]])
        self.assertEqual(argmax_with_priority(s, [1, 0, 2]).tolist(), [1, 1, 1])
        self.assertEqual(argmax_with_priority(s, [2, 1, 0]).tolist(), [1, 2, 2])


if __name__ == "__main__":
    unittest.main()
