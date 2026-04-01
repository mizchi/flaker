import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";

export interface FlakerConfig {
  repo: { owner: string; name: string };
  storage: { path: string };
  adapter: { type: string; command?: string };
  runner: {
    type: string;
    command: string;
    execute?: string;
    list?: string;
    actrun?: { workflow: string };
  };
  affected: { resolver: string; config: string };
  quarantine: { auto: boolean; flaky_rate_threshold: number; min_runs: number };
  flaky: { window_days: number; detection_threshold: number };
}

const DEFAULT_CONFIG: FlakerConfig = {
  repo: { owner: "", name: "" },
  storage: { path: ".flaker/data" },
  adapter: { type: "command" },
  runner: { type: "vitest", command: "pnpm test" },
  affected: { resolver: "git", config: "" },
  quarantine: { auto: true, flaky_rate_threshold: 0.3, min_runs: 5 },
  flaky: { window_days: 14, detection_threshold: 0.1 },
};

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const result = { ...target } as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = result[key];
    if (
      sv !== null &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv !== null &&
      typeof tv === "object" &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(
        tv as Record<string, unknown>,
        sv as Record<string, unknown>,
      );
    } else {
      result[key] = sv;
    }
  }
  return result as T;
}

export function loadConfig(dir: string): FlakerConfig {
  const filePath = join(dir, "flaker.toml");
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Config file not found: ${filePath}`);
  }
  const parsed = parse(content) as unknown as Record<string, unknown>;
  return deepMerge(DEFAULT_CONFIG, parsed);
}
