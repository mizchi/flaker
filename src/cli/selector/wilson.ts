// src/cli/selector/wilson.ts
/** z for a two-sided 95% interval. */
export const Z95 = 1.959963984540054;

/** Lower bound of the Wilson score interval for k successes out of n. 0 when n is 0. */
export function wilsonLowerBound(k: number, n: number, z: number = Z95): number {
  if (n <= 0) return 0;
  const p = k / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return (centre - spread) / (1 + z2 / n);
}
