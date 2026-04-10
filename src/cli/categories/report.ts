import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import {
  runReportSummarize,
  runReportDiff,
  runReportAggregate,
  formatReportSummary,
  formatReportDiff,
  formatReportAggregate,
  formatPrComment,
  parseReportSummary,
  createReportSummaryArtifact,
  loadReportSummaryArtifactsFromDir,
} from "../commands/report/index.js";

function parseKeyValuePairs(input?: string): Record<string, string> | undefined {
  if (!input) return undefined;
  const entries = input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator === -1) {
        throw new Error(`Invalid key=value pair: ${part}`);
      }
      return [part.slice(0, separator), part.slice(separator + 1)] as const;
    });
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

export function registerReportCommands(program: Command): void {
  const reportCmd = program
    .command("report")
    .description("Normalize and diff reports");

  reportCmd
    .command("summary")
    .description("Summarize a raw adapter report")
    .requiredOption("--adapter <type>", "Adapter type (playwright, junit, vrt-migration, vrt-bench)")
    .requiredOption("--input <file>", "Raw adapter report file")
    .option("--bundle", "Wrap summary with shard metadata for aggregation")
    .option("--shard <name>", "Shard name")
    .option("--module <name>", "Module name")
    .option("--offset <n>", "Shard offset")
    .option("--limit <n>", "Shard limit")
    .option("--matrix <pairs>", "Comma-separated matrix metadata (key=value)")
    .option("--variant <pairs>", "Comma-separated variant metadata (key=value)")
    .option("--meta <pairs>", "Comma-separated extra metadata (key=value)")
    .option("--json", "Output JSON report")
    .option("--markdown", "Output Markdown report")
    .option("--pr-comment", "Output compact Markdown for PR comments")
    .action(
      (opts: {
        adapter: string;
        input: string;
        bundle?: boolean;
        shard?: string;
        module?: string;
        offset?: string;
        limit?: string;
        matrix?: string;
        variant?: string;
        meta?: string;
        json?: boolean;
        markdown?: boolean;
        prComment?: boolean;
      }) => {
        const formatCount = [opts.json, opts.markdown, opts.prComment].filter(Boolean).length;
        if (formatCount > 1) {
          console.error("Error: choose one of --json, --markdown, or --pr-comment");
          process.exit(1);
        }
        if (opts.bundle && opts.markdown) {
          console.error("Error: --bundle cannot be combined with --markdown");
          process.exit(1);
        }

        const summary = runReportSummarize({
          adapter: opts.adapter,
          input: readFileSync(resolve(opts.input), "utf-8"),
        });
        if (opts.bundle) {
          console.log(
            JSON.stringify(
              createReportSummaryArtifact(summary, {
                shard: opts.shard,
                module: opts.module,
                offset: opts.offset ? Number(opts.offset) : undefined,
                limit: opts.limit ? Number(opts.limit) : undefined,
                matrix: parseKeyValuePairs(opts.matrix),
                variant: parseKeyValuePairs(opts.variant),
                extra: parseKeyValuePairs(opts.meta),
              }),
              null,
              2,
            ),
          );
          return;
        }
        if (opts.prComment) {
          console.log(formatPrComment(summary));
          return;
        }
        console.log(
          formatReportSummary(summary, opts.json ? "json" : "markdown"),
        );
      },
    );

  reportCmd
    .command("diff")
    .description("Diff two normalized summaries or raw adapter reports")
    .requiredOption("--base <file>", "Base summary or raw report file")
    .requiredOption("--head <file>", "Head summary or raw report file")
    .option("--adapter <type>", "Adapter type when diffing raw reports")
    .option("--json", "Output JSON report")
    .option("--markdown", "Output Markdown report")
    .action(
      (opts: {
        base: string;
        head: string;
        adapter?: string;
        json?: boolean;
        markdown?: boolean;
      }) => {
        if (opts.json && opts.markdown) {
          console.error("Error: choose either --json or --markdown");
          process.exit(1);
        }

        const baseInput = readFileSync(resolve(opts.base), "utf-8");
        const headInput = readFileSync(resolve(opts.head), "utf-8");
        const base = opts.adapter
          ? runReportSummarize({ adapter: opts.adapter, input: baseInput })
          : parseReportSummary(baseInput);
        const head = opts.adapter
          ? runReportSummarize({ adapter: opts.adapter, input: headInput })
          : parseReportSummary(headInput);
        const diff = runReportDiff({ base, head });

        console.log(formatReportDiff(diff, opts.json ? "json" : "markdown"));
      },
    );

  reportCmd
    .command("aggregate <dir>")
    .description("Aggregate shard-aware summary artifacts")
    .option("--json", "Output JSON report")
    .option("--markdown", "Output Markdown report")
    .action((dir: string, opts: { json?: boolean; markdown?: boolean }) => {
      if (opts.json && opts.markdown) {
        console.error("Error: choose either --json or --markdown");
        process.exit(1);
      }

      const aggregate = runReportAggregate({
        summaries: loadReportSummaryArtifactsFromDir(resolve(dir)),
      });
      console.log(
        formatReportAggregate(aggregate, opts.json ? "json" : "markdown"),
      );
    });
}
