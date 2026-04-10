export const SAMPLING_MODES = [
  "random",
  "weighted",
  "affected",
  "hybrid",
  "gbdt",
  "coverage-guided",
  "full",
] as const;

export type SamplingMode = (typeof SAMPLING_MODES)[number];

export function parseSamplingMode(raw: string): SamplingMode {
  if (isSamplingMode(raw)) {
    return raw;
  }
  throw new Error(
    `Unknown sampling strategy: ${raw}. Expected one of: ${SAMPLING_MODES.join(", ")}`,
  );
}

export function parseSampleCount(raw?: string): number | undefined {
  return parseOptionalInteger(raw, "--count");
}

export function parseSamplePercentage(raw?: string): number | undefined {
  if (raw == null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(
      `Invalid --percentage value: ${raw}. Expected a number between 0 and 100.`,
    );
  }
  return value;
}

function parseOptionalInteger(raw: string | undefined, flag: string): number | undefined {
  if (raw == null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `Invalid ${flag} value: ${raw}. Expected a non-negative integer.`,
    );
  }
  return value;
}

function isSamplingMode(raw: string): raw is SamplingMode {
  return SAMPLING_MODES.includes(raw as SamplingMode);
}
