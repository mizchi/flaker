import { resolve } from "node:path";
import type { Command } from "commander";
import { deprecate } from "../deprecation.js";
import {
  runQuarantine,
  formatQuarantineTable,
  buildQuarantineIssueOpts,
} from "../commands/policy/quarantine.js";
import {
  appendConfigWarnings,
  appendConfigRangeErrors,
  discoverTestSpecsForCheck,
  formatConfigCheckReport,
  loadTaskDefinitionsForCheck,
  runConfigCheck,
} from "../commands/policy/check.js";
import { loadConfig, loadConfigWithDiagnostics, validateConfigRanges } from "../config.js";
import { isGhAvailable, createGhIssue } from "../gh.js";
import { DuckDBStore } from "../storage/duckdb.js";
import { createRunner } from "../runners/index.js";
import { resolveTestIdentity } from "../identity.js";
import { createResolver } from "../resolvers/index.js";
import {
  formatQuarantineManifestReport,
  loadQuarantineManifest,
  resolveQuarantineManifestPath,
  validateQuarantineManifest,
} from "../quarantine-manifest.js";

async function collectKnownQuarantineTaskIds(
  cwd: string,
  store: DuckDBStore,
  runnerConfig: {
    type: string;
    command: string;
    execute?: string;
    list?: string;
  },
): Promise<string[]> {
  const taskIds = new Set<string>();
  const persisted = await store.raw<{ task_id: string }>(`
    SELECT DISTINCT task_id
    FROM test_results
    WHERE task_id IS NOT NULL AND task_id <> ''
  `);
  for (const row of persisted) {
    taskIds.add(row.task_id);
  }

  try {
    const runner = createRunner(runnerConfig);
    const listedTests = await runner.listTests({ cwd });
    for (const test of listedTests) {
      const resolved = resolveTestIdentity({
        suite: test.suite,
        testName: test.testName,
        taskId: test.taskId,
        filter: test.filter,
        variant: test.variant,
      });
      taskIds.add(resolved.taskId);
    }
  } catch {
    // Best-effort: fall back to persisted task ids only.
  }

  return [...taskIds].sort();
}

async function listRunnerTests(
  cwd: string,
  runnerConfig: {
    type: string;
    command: string;
    execute?: string;
    list?: string;
  },
) {
  try {
    const runner = createRunner(runnerConfig);
    return await runner.listTests({ cwd });
  } catch {
    return [];
  }
}

export function registerPolicyCommands(program: Command): void {
  const policy = program
    .command("policy")
    .description("Enforcement and ownership");

  const quarantineCmd = policy
    .command("quarantine")
    .description("Manage quarantined tests")
    .option("--add <suite:testName>", "Add a test to quarantine (suite:testName)")
    .option(
      "--remove <suite:testName>",
      "Remove a test from quarantine (suite:testName)",
    )
    .option("--auto", "Auto-quarantine tests exceeding flaky threshold")
    .option("--create-issues", "Create GitHub issues for newly quarantined tests (requires gh CLI)")
    .action(
      async (opts: { add?: string; remove?: string; auto?: boolean; createIssues?: boolean }) => {
        const config = loadConfig(process.cwd());
        const store = new DuckDBStore(resolve(config.storage.path));
        await store.initialize();

        try {
          if (opts.add) {
            const [suite, testName] = opts.add.split(":");
            if (!suite || !testName) {
              console.error("Error: --add requires format suite:testName");
              process.exit(1);
            }
            await runQuarantine({
              store,
              action: "add",
              suite,
              testName,
              reason: "manual",
            });
            console.log(`Quarantined ${suite}:${testName}`);
          } else if (opts.remove) {
            const [suite, testName] = opts.remove.split(":");
            if (!suite || !testName) {
              console.error("Error: --remove requires format suite:testName");
              process.exit(1);
            }
            await runQuarantine({ store, action: "remove", suite, testName });
            console.log(`Removed ${suite}:${testName} from quarantine`);
          } else if (opts.auto) {
            await runQuarantine({
              store,
              action: "auto",
              flakyRateThreshold: config.quarantine.flaky_rate_threshold_percentage,
              minRuns: config.quarantine.min_runs,
            });
            const quarantined = await store.queryQuarantined();
            console.log(
              `Auto-quarantine complete. ${quarantined.length} test(s) quarantined.`,
            );
            if (quarantined.length > 0) {
              console.log(formatQuarantineTable(quarantined));
            }
            if (opts.createIssues) {
              if (!isGhAvailable()) {
                console.error("Warning: gh CLI not found. Skipping issue creation.");
                console.error("Install: https://cli.github.com/");
              } else if (quarantined.length > 0) {
                const flaky = await store.queryFlakyTests({ windowDays: 30 });
                let created = 0;
                for (const q of quarantined) {
                  const flakyInfo = flaky.find(
                    (f) => f.suite === q.suite && f.testName === q.testName,
                  );
                  const issueInput = {
                    suite: q.suite,
                    testName: q.testName,
                    flakyRate: flakyInfo?.flakyRate ?? 0,
                    totalRuns: flakyInfo?.totalRuns ?? 0,
                    reason: q.reason,
                  };
                  const issueOpts = buildQuarantineIssueOpts(issueInput);
                  const repo = `${config.repo.owner}/${config.repo.name}`;
                  const url = createGhIssue({
                    title: issueOpts.title,
                    body: issueOpts.body,
                    labels: issueOpts.labels,
                    repo,
                  });
                  if (url) {
                    console.log(`  Created issue: ${url}`);
                    created++;
                  }
                }
                if (created > 0) {
                  console.log(`Created ${created} issue(s) for quarantined tests.`);
                }
              }
            }
          } else {
            const result = await runQuarantine({ store, action: "list" });
            if (result && result.length > 0) {
              console.log(formatQuarantineTable(result));
            } else {
              console.log("No quarantined tests.");
            }
          }
        } finally {
          await store.close();
        }
      },
    );
  deprecate(quarantineCmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker apply" });

  const quarantineCheckCmd = quarantineCmd
    .command("check")
    .description("Validate the repo-tracked quarantine manifest")
    .option("--manifest <path>", "Override manifest path")
    .action(async (opts: { manifest?: string }) => {
      const cwd = process.cwd();
      const config = loadConfig(cwd);
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
        const manifestPath = resolveQuarantineManifestPath({
          cwd,
          manifestPath: opts.manifest,
        });
        if (!manifestPath) {
          console.error("Error: quarantine manifest not found");
          process.exit(1);
        }

        const manifest = loadQuarantineManifest({
          cwd,
          manifestPath,
        });
        const knownTaskIds = await collectKnownQuarantineTaskIds(
          cwd,
          store,
          config.runner,
        );
        const report = validateQuarantineManifest({
          cwd,
          manifest,
          manifestPath,
          knownTaskIds,
        });

        if (report.errors.length > 0) {
          console.error(formatQuarantineManifestReport(report, "markdown"));
          process.exit(1);
        }
        console.log(formatQuarantineManifestReport(report, "markdown"));
      } finally {
        await store.close();
      }
    });
  deprecate(quarantineCheckCmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker apply" });

  const quarantineReportCmd = quarantineCmd
    .command("report")
    .description("Render a quarantine manifest report")
    .option("--manifest <path>", "Override manifest path")
    .option("--json", "Output JSON report")
    .option("--markdown", "Output Markdown report")
    .action(async (opts: { manifest?: string; json?: boolean; markdown?: boolean }) => {
      if (opts.json && opts.markdown) {
        console.error("Error: choose either --json or --markdown");
        process.exit(1);
      }

      const cwd = process.cwd();
      const config = loadConfig(cwd);
      const store = new DuckDBStore(resolve(config.storage.path));
      await store.initialize();

      try {
        const manifestPath = resolveQuarantineManifestPath({
          cwd,
          manifestPath: opts.manifest,
        });
        if (!manifestPath) {
          console.error("Error: quarantine manifest not found");
          process.exit(1);
        }

        const manifest = loadQuarantineManifest({
          cwd,
          manifestPath,
        });
        const knownTaskIds = await collectKnownQuarantineTaskIds(
          cwd,
          store,
          config.runner,
        );
        const report = validateQuarantineManifest({
          cwd,
          manifest,
          manifestPath,
          knownTaskIds,
        });
        console.log(
          formatQuarantineManifestReport(
            report,
            opts.json ? "json" : "markdown",
          ),
        );
      } finally {
        await store.close();
      }
    });
  deprecate(quarantineReportCmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker apply" });

  const policyCheckCmd = policy
    .command("check")
    .description("Validate test spec ownership and config drift")
    .option("--json", "Output JSON report")
    .option("--markdown", "Output Markdown report")
    .action(async (opts: { json?: boolean; markdown?: boolean }) => {
      if (opts.json && opts.markdown) {
        console.error("Error: choose either --json or --markdown");
        process.exit(1);
      }

      const cwd = process.cwd();
      const { config, warnings: configWarnings } = loadConfigWithDiagnostics(cwd);
      const listedTests = await listRunnerTests(cwd, config.runner);
      const discoveredSpecs = discoverTestSpecsForCheck(cwd, config.runner.type);
      const taskDefinitions = loadTaskDefinitionsForCheck({
        cwd,
        resolverName: config.affected.resolver,
        resolverConfig: config.affected.config,
      });

      const rangeErrors = validateConfigRanges(config);
      const report = appendConfigRangeErrors(
        appendConfigWarnings(runConfigCheck({
          listedTests,
          discoveredSpecs,
          taskDefinitions,
        }), configWarnings),
        rangeErrors,
      );
      console.log(
        formatConfigCheckReport(report, opts.json ? "json" : "markdown"),
      );
      process.exit(report.errors.length > 0 ? 1 : 0);
    });
  deprecate(policyCheckCmd, { since: "0.7.0", remove: "0.8.0", canonical: "flaker apply" });
}
