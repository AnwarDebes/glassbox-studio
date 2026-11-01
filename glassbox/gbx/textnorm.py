"""Text normalisation shared by both featurizers.

The TypeScript port (src/glassbox/text.ts) must produce byte-identical strings,
so this file only uses operations with identical semantics in Python and
JavaScript:

* CRLF / CR become LF (JavaScript's ``.`` does not match ``\\r``, Python's does);
* curly quotes become straight quotes;
* every non-ASCII code point becomes ``?`` (so ``len`` agrees between UTF-16
  JavaScript strings and Python code-point strings, and ``\\w``/``\\s``/``\\b``
  mean the same thing in both regex engines);
* ``lower()`` is then plain ASCII lower-casing.
"""
from __future__ import annotations

import re

_NON_ASCII = re.compile(r"[^\x00-\x7f]")


def fold(s: str) -> str:
    """Normalise newlines and quotes and replace non-ASCII code points with '?'."""
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = s.replace("‘", "'").replace("’", "'").replace("“", '"').replace("”", '"')
    return _NON_ASCII.sub("?", s)


def norm(s: str) -> str:
    """fold() followed by ASCII lower-casing (the string is pure ASCII by then)."""
    return fold(s).lower()
