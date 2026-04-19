import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../config.js";
import { DuckDBStore } from "../storage/duckdb.js";
import { normalizeGateName, profileNameFromGateName } from "../gate.js";
import { resolveProfile } from "../profile-compat.js";
import { computeKpi } from "../commands/analyze/kpi.js";
import { buildGateReview, formatGateReview } from "../commands/gate/review.js";
import { buildGateExplain, formatGateExplain } from "../commands/gate/explain.js";
import { formatGateHistory, runGateHistory } from "../commands/gate/history.js";

function resolveGateOrThrow(gateName: string) {
  const gate = normalizeGateName(gateName);
  if (!gate) {
    throw new Error(`Unknown gate '${gateName}'. Expected one of: iteration, merge, release.`);
  }
  return gate;
}

export async function gateReviewAction(
  gateName: string,
  opts: { windowDays: string; json?: boolean },
): Promise<void> {
  const gate = resolveGateOrThrow(gateName);

  const config = loadConfig(process.cwd());
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const profile = resolveProfile(
      profileNameFromGateName(gate),
      config.profile,
      config.sampling,
    );
    const kpi = await computeKpi(store, { windowDays: parseInt(opts.windowDays, 10) });
    const report = buildGateReview({ gate, profile, kpi });
    console.log(opts.json ? JSON.stringify(report, null, 2) : formatGateReview(report));
  } finally {
    await store.close();
  }
}

export async function gateExplainAction(
  gateName: string,
  opts: { json?: boolean },
): Promise<void> {
  const gate = resolveGateOrThrow(gateName);
  const config = loadConfig(process.cwd());
  const profile = resolveProfile(
    profileNameFromGateName(gate),
    config.profile,
    config.sampling,
  );
  const report = buildGateExplain({ gate, config, profile });
  console.log(opts.json ? JSON.stringify(report, null, 2) : formatGateExplain(report));
}

export async function gateHistoryAction(
  gateName: string,
  opts: { windowDays: string; json?: boolean },
): Promise<void> {
  const gate = resolveGateOrThrow(gateName);
  const config = loadConfig(process.cwd());
  const store = new DuckDBStore(resolve(config.storage.path));
  await store.initialize();
  try {
    const report = await runGateHistory({
      store,
      gate,
      config,
      windowDays: parseInt(opts.windowDays, 10),
    });
    console.log(opts.json ? JSON.stringify(report, null, 2) : formatGateHistory(report));
  } finally {
    await store.close();
  }
}

export function registerGateCommands(program: Command): void {
  const gate = program
    .command("gate")
    .description("Gate review and readiness inspection");

  gate
    .command("review <gate>")
    .description("Review gate readiness and recommended action")
    .option("--window-days <days>", "Analysis window in days", "30")
    .option("--json", "Output as JSON")
    .action(gateReviewAction);

  gate
    .command("explain <gate>")
    .description("Explain resolved gate settings and their config sources")
    .option("--json", "Output as JSON")
    .action(gateExplainAction);

  gate
    .command("history <gate>")
    .description("Show recent gate outcomes and sample ratio trend")
    .option("--window-days <days>", "Analysis window in days", "14")
    .option("--json", "Output as JSON")
    .action(gateHistoryAction);
}
