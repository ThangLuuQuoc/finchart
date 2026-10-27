/**
 * Pine `na` semantics, represented as NaN for zero-allocation hot paths.
 * (Pine: `na` is an undefined series value; we map it to IEEE NaN.)
 */

export const NA = Number.NaN;

/** Pine `na(x)` — true if the value is undefined. */
export function na(x: number): boolean {
  return Number.isNaN(x);
}

/** Pine `nz(x, replacement = 0)` — replace na with a fallback. */
export function nz(x: number, replacement = 0): number {
  return Number.isNaN(x) ? replacement : x;
}
