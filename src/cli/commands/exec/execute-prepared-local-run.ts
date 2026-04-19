import { resolveCurrentCommitSha } from "../../core/git.js";
import type { FlakerConfig } from "../../config.js";
import { createRunner } from "../../runners/index.js";
import type { RunnerAdapter } from "../../runners/types.js";
import type { MetricStore } from "../../storage/types.js";
import { recordLocalRun, type RecordLocalRunResult } from "./record-local-run.js";
import type { PreparedRunRequest } from "./prepare-run-request.js";
import { runTests, type RunCommandResult } from "./run.js";

export interface ExecutePreparedLocalRunResult {
  commitSha: string;
  runResult: RunCommandResult;
  recordResult?: RecordLocalRunResult;
}

export async function executePreparedLocalRun(input: {
  store: MetricStore;
  config: FlakerConfig;
  cwd: string;
  prepared: PreparedRunRequest;
  dryRun?: boolean;
  explain?: boolean;
  runner?: RunnerAdapter;
  commitSha?: string;
}): Promise<ExecutePreparedLocalRunResult> {
  const runner = input.runner ?? createRunner(input.config.runner);
  const commitSha = input.commitSha ?? resolveCurrentCommitSha(input.cwd) ?? `local-${Date.now()}`;

  const runResult = await runTests({
    store: input.store,
    runner,
    mode: input.prepared.mode,
    fallbackMode: input.prepared.fallbackMode,
    count: input.prepared.count,
    percentage: input.prepared.percentage,
    resolver: input.prepared.resolver,
    changedFiles: input.prepared.changedFiles,
    skipQuarantined: input.prepared.skipQuarantined,
    skipFlakyTagged: input.prepared.skipFlakyTagged,
    flakyTagPattern: input.config.runner.flaky_tag_pattern ?? "@flaky",
    quarantineManifestEntries: input.prepared.quarantineManifestEntries,
    cwd: input.cwd,
    coFailureDays: input.prepared.coFailureDays,
    holdoutRatio: input.prepared.holdoutRatio,
    clusterMode: input.prepared.clusterMode,
    dryRun: input.dryRun,
    explain: input.explain,
  });

  if (input.dryRun) {
    return {
      commitSha,
      runResult,
    };
  }

  const recordResult = await recordLocalRun({
    store: input.store,
    repoSlug: `${input.config.repo.owner}/${input.config.repo.name}`,
    commitSha,
    cwd: input.cwd,
    runResult,
    storagePath: input.config.storage.path,
  });

  return {
    commitSha,
    runResult,
    recordResult,
  };
}
