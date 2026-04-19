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
import { deprecate } from "../deprecation.js";

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

type SummaryOpts = {
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
};

async function runSummaryAction(opts: SummaryOpts): Promise<void> {
  const formatCount = [opts.json, opts.markdown, opts.prComment].filter(Boolean).length;
  if (formatCount > 1) {
    console.error("Error: choose one of --json, --markdown, or --pr-comment");
    process.exit(1);
  }
  if (opts.bundle && opts.markdown) {
    console.error("Error: --bundle cannot be combined with --markdown");
    process.exit(1);
  }

  const summary = await runReportSummarize({
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
}

type DiffOpts = {
  base: string;
  head: string;
  adapter?: string;
  json?: boolean;
  markdown?: boolean;
};

async function runDiffAction(opts: DiffOpts): Promise<void> {
  if (opts.json && opts.markdown) {
    console.error("Error: choose either --json or --markdown");
    process.exit(1);
  }

  const baseInput = readFileSync(resolve(opts.base), "utf-8");
  const headInput = readFileSync(resolve(opts.head), "utf-8");
  const base = opts.adapter
    ? await runReportSummarize({ adapter: opts.adapter, input: baseInput })
    : parseReportSummary(baseInput);
  const head = opts.adapter
    ? await runReportSummarize({ adapter: opts.adapter, input: headInput })
    : parseReportSummary(headInput);
  const diff = await runReportDiff({ base, head });

  console.log(formatReportDiff(diff, opts.json ? "json" : "markdown"));
}

type AggregateOpts = {
  json?: boolean;
  markdown?: boolean;
};

async function runAggregateAction(dir: string, opts: AggregateOpts): Promise<void> {
  if (opts.json && opts.markdown) {
    console.error("Error: choose either --json or --markdown");
    process.exit(1);
  }

  const aggregate = await runReportAggregate({
    summaries: loadReportSummaryArtifactsFromDir(resolve(dir)),
  });
  console.log(
    formatReportAggregate(aggregate, opts.json ? "json" : "markdown"),
  );
}

export function registerReportCommands(program: Command): void {
  const reportCmd = program
    .command("report")
    .description("Normalize and diff reports")
    .argument("[file]", "Input file (or directory for --aggregate)")
    .option("--summary", "Summarize a raw adapter report")
    .option("--diff <base>", "Diff against a base report file")
    .option("--aggregate <dir>", "Aggregate shard-aware summary artifacts from a directory")
    // summary flags
    .option("--adapter <type>", "Adapter type (playwright, junit, vrt-migration, vrt-bench)")
    .option("--input <file>", "Raw adapter report file (alias for positional [file])")
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
    // diff flags
    .option("--head <file>", "Head summary or raw report file (for --diff)")
    .action(
      async (
        file: string | undefined,
        opts: {
          summary?: boolean;
          diff?: string;
          aggregate?: string;
          // summary opts
          adapter?: string;
          input?: string;
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
          // diff opts
          head?: string;
        },
      ): Promise<void> => {
        const flagCount = [opts.summary, opts.diff !== undefined, opts.aggregate !== undefined].filter(Boolean).length;
        if (flagCount === 0) {
          reportCmd.help();
          return;
        }
        if (flagCount > 1) {
          console.error("Error: --summary, --diff, and --aggregate are mutually exclusive");
          process.exit(2);
        }

        if (opts.summary) {
          const inputFile = file ?? opts.input;
          if (!inputFile) {
            console.error("Error: --summary requires a file argument or --input <file>");
            process.exit(2);
          }
          if (!opts.adapter) {
            console.error("Error: --summary requires --adapter <type>");
            process.exit(2);
          }
          await runSummaryAction({
            adapter: opts.adapter,
            input: inputFile,
            bundle: opts.bundle,
            shard: opts.shard,
            module: opts.module,
            offset: opts.offset,
            limit: opts.limit,
            matrix: opts.matrix,
            variant: opts.variant,
            meta: opts.meta,
            json: opts.json,
            markdown: opts.markdown,
            prComment: opts.prComment,
          });
          return;
        }

        if (opts.diff !== undefined) {
          const headFile = file ?? opts.head;
          if (!headFile) {
            console.error("Error: --diff requires a head file argument or --head <file>");
            process.exit(2);
          }
          await runDiffAction({
            base: opts.diff,
            head: headFile,
            adapter: opts.adapter,
            json: opts.json,
            markdown: opts.markdown,
          });
          return;
        }

        if (opts.aggregate !== undefined) {
          await runAggregateAction(opts.aggregate, {
            json: opts.json,
            markdown: opts.markdown,
          });
        }
      },
    );

  deprecate(
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
      .action(async (opts: SummaryOpts) => {
        await runSummaryAction(opts);
      }),
    { since: "0.7.0", remove: "0.8.0", canonical: "flaker report --summary" },
  );

  deprecate(
    reportCmd
      .command("diff")
      .description("Diff two normalized summaries or raw adapter reports")
      .requiredOption("--base <file>", "Base summary or raw report file")
      .requiredOption("--head <file>", "Head summary or raw report file")
      .option("--adapter <type>", "Adapter type when diffing raw reports")
      .option("--json", "Output JSON report")
      .option("--markdown", "Output Markdown report")
      .action(async (opts: DiffOpts) => {
        await runDiffAction(opts);
      }),
    { since: "0.7.0", remove: "0.8.0", canonical: "flaker report --diff <base>" },
  );

  deprecate(
    reportCmd
      .command("aggregate <dir>")
      .description("Aggregate shard-aware summary artifacts")
      .option("--json", "Output JSON report")
      .option("--markdown", "Output Markdown report")
      .action(async (dir: string, opts: AggregateOpts) => {
        await runAggregateAction(dir, opts);
      }),
    { since: "0.7.0", remove: "0.8.0", canonical: "flaker report --aggregate <dir>" },
  );
}
