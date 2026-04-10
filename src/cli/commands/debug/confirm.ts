export interface ConfirmTarget {
  suite: string;
  testName: string;
}

export type Verdict = "broken" | "flaky" | "transient";

export type ConfirmVerdict = "BROKEN" | "FLAKY" | "TRANSIENT" | "ERROR";

export function confirmExitCode(verdict: ConfirmVerdict): number {
  switch (verdict) {
    case "TRANSIENT": return 0;
    case "FLAKY":     return 1;
    case "BROKEN":    return 2;
    case "ERROR":     return 3;
  }
}

export interface VerdictResult {
  verdict: Verdict;
  message: string;
}

export interface ConfirmResult {
  suite: string;
  testName: string;
  runner: "remote" | "local";
  repeat: number;
  failures: number;
  verdict: Verdict;
  message: string;
}

export function parseConfirmTarget(target: string): ConfirmTarget {
  const colonIndex = target.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(
      `Invalid target format: "${target}". Expected "suite:testName" (e.g., "tests/api.test.ts:handles timeout")`,
    );
  }
  return {
    suite: target.slice(0, colonIndex),
    testName: target.slice(colonIndex + 1),
  };
}

export function computeVerdict(repeat: number, failures: number): VerdictResult {
  if (failures === repeat) {
    return { verdict: "broken", message: "Consistently failing. This is a regression." };
  }
  if (failures === 0) {
    return { verdict: "transient", message: "Could not reproduce. Failure was transient." };
  }
  const rate = Math.round((failures / repeat) * 100);
  return { verdict: "flaky", message: `Intermittent failure. Flaky rate: ${rate}%.` };
}

export function formatConfirmResult(result: ConfirmResult, opts: { json?: boolean } = {}): string {
  if (opts.json) {
    const verdict = result.verdict.toUpperCase() as ConfirmVerdict;
    return JSON.stringify({ verdict, runs: { repeat: result.repeat, failures: result.failures } }, null, 2);
  }
  const verdictLabel = result.verdict.toUpperCase();
  const lines = [
    `# Confirm: ${result.suite} > ${result.testName}`,
    "",
    `  Runner:   ${result.runner}`,
    `  Repeat:   ${result.repeat}`,
    `  Results:  ${result.failures}/${result.repeat} failed`,
    "",
    `  Verdict:  ${verdictLabel}`,
    "",
    `  ${result.message}`,
  ];
  if (result.verdict === "flaky") {
    lines.push(`  Consider quarantining: flaker policy quarantine --add "${result.suite}:${result.testName}"`);
  }
  if (result.verdict === "broken") {
    lines.push("  Investigate the regression starting from the commit that introduced it.");
  }
  return lines.join("\n");
}
