// src/cli/projections/index.ts
import type { MetricStore } from "../storage/types.js";
import type { SelectorConfig } from "../config.js";
import { FlakerUsageError } from "../errors.js";
import { readDataset } from "../datasets/read.js";
import { resolveSelectorTestKeys } from "../selector/store.js";
import { latestGateCalibration } from "../commands/calibrate/selector.js";
import { buildJevContext, type JevContextInput } from "./jev-context.js";

export const PROJECTION_NAMES = ["jev-context"] as const;

export async function runProjection(
  name: string,
  store: MetricStore,
  opts: { selector: SelectorConfig; now?: Date },
): Promise<unknown> {
  if (name !== "jev-context") {
    throw new FlakerUsageError(`Unknown projection "${name}". Expected one of: ${PROJECTION_NAMES.join(", ")}`);
  }
  await resolveSelectorTestKeys(store);
  const [tests, quarantine, flaky, misses, coFailures, latest] = await Promise.all([
    readDataset(store, "tests"),
    readDataset(store, "quarantine"),
    readDataset(store, "flaky"),
    readDataset(store, "misses"),
    readDataset(store, "co_failures"),
    latestGateCalibration(store, opts.selector.type),
  ]);
  return buildJevContext({
    tests: tests as unknown as JevContextInput["tests"],
    quarantine: quarantine as unknown as JevContextInput["quarantine"],
    flaky: flaky as unknown as JevContextInput["flaky"],
    misses: misses as unknown as JevContextInput["misses"],
    co_failures: coFailures as unknown as JevContextInput["co_failures"],
    gate: latest,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    limits: { maxHintedTests: opts.selector.max_hinted_tests },
  });
}
