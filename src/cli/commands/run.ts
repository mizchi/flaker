import type { MetricStore } from "../storage/types.js";
import type { TestMeta } from "../core/loader.js";
import { runSample, type SampleOpts } from "./sample.js";
import { DirectRunner } from "../runners/direct.js";

export interface RunOpts {
  store: MetricStore;
  command: string;
  count?: number;
  percentage?: number;
  mode: "random" | "weighted";
  seed?: number;
  skipQuarantined?: boolean;
}

export async function runTests(opts: RunOpts): Promise<void> {
  const sampled = await runSample({
    store: opts.store,
    count: opts.count,
    percentage: opts.percentage,
    mode: opts.mode,
    seed: opts.seed,
    skipQuarantined: opts.skipQuarantined,
  });

  const runner = new DirectRunner(opts.command);

  for (const test of sampled) {
    const pattern = `${test.suite}.*${test.test_name}`;
    runner.run(pattern);
  }
}
