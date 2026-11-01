// Text normalisation shared by both featurizers. Twin of glassbox/gbx/textnorm.py:
// both sides must produce identical strings, so only operations with the same
// meaning in Python and JavaScript are used (see that file for the reasons).

/** Unify newlines, straighten curly quotes, and replace every non-ASCII code point with '?'. */
export function fold(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x00-\x7f]/gu, '?');
}

/** fold() followed by ASCII lower-casing (the string is pure ASCII by then). */
export function norm(s: string): string {
  return fold(s).toLowerCase();
}
