import type { RunnerAdapter } from "../../runners/types.js";
import { computeVerdict, type ConfirmResult } from "./confirm.js";

export interface ConfirmLocalOpts {
  suite: string;
  testName: string;
  repeat: number;
  runner: RunnerAdapter;
  cwd?: string;
}

export async function runConfirmLocal(opts: ConfirmLocalOpts): Promise<ConfirmResult> {
  let failures = 0;

  for (let i = 0; i < opts.repeat; i++) {
    console.log(`  Run ${i + 1}/${opts.repeat}...`);
    const result = await opts.runner.execute(
      [{ suite: opts.suite, testName: opts.testName }],
      { cwd: opts.cwd },
    );
    if (result.exitCode !== 0) {
      failures++;
      console.log(`  Run ${i + 1}: FAIL`);
    } else {
      console.log(`  Run ${i + 1}: PASS`);
    }
  }

  const { verdict, message } = computeVerdict(opts.repeat, failures);

  return {
    suite: opts.suite,
    testName: opts.testName,
    runner: "local",
    repeat: opts.repeat,
    failures,
    verdict,
    message,
  };
}
