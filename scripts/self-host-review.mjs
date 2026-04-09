import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = value;
    i++;
  }
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readText(path) {
  return readFileSync(path, "utf8").trim();
}

function formatMetric(value, suffix = "%") {
  if (value == null) return "N/A";
  return `${value}${suffix}`;
}

function clipBlock(text, maxLines = 18) {
  if (!text) return "_none_";
  const lines = text.trim().split("\n");
  if (lines.length <= maxLines) {
    return lines.join("\n");
  }
  return [...lines.slice(0, maxLines), `... (${lines.length - maxLines} more lines)`].join("\n");
}

export function buildPromotionReadiness(input) {
  const matchedCommits = input?.sampling?.matchedCommits ?? 0;
  const falseNegativeRate = input?.sampling?.falseNegativeRate ?? null;
  const passCorrelation = input?.sampling?.passCorrelation ?? null;
  const holdoutFNR = input?.sampling?.holdoutFNR ?? null;
  const confidence = input?.data?.confidence ?? "insufficient";

  const issues = [];
  if (matchedCommits < 20) {
    issues.push(`matched commits ${matchedCommits} < 20`);
  }
  if (falseNegativeRate == null || falseNegativeRate > 5) {
    issues.push(`false negative rate ${formatMetric(falseNegativeRate)} is above 5%`);
  }
  if (passCorrelation == null || passCorrelation < 95) {
    issues.push(`pass correlation ${formatMetric(passCorrelation)} is below 95%`);
  }
  if (holdoutFNR != null && holdoutFNR > 10) {
    issues.push(`holdout FNR ${formatMetric(holdoutFNR)} is above 10%`);
  }
  if (confidence === "insufficient" || confidence === "low") {
    issues.push(`data confidence is ${confidence}`);
  }

  if (issues.length === 0) {
    return {
      status: "ready",
      label: "ready for gated trial",
      summary: "required-check trial candidate",
      reasons: [
        `matched commits ${matchedCommits}`,
        `false negative rate ${formatMetric(falseNegativeRate)}`,
        `pass correlation ${formatMetric(passCorrelation)}`,
        `holdout FNR ${formatMetric(holdoutFNR)}`,
        `data confidence ${confidence}`,
      ],
    };
  }

  const watchOnly = matchedCommits >= 10
    && falseNegativeRate != null
    && falseNegativeRate <= 10
    && passCorrelation != null
    && passCorrelation >= 90
    && (confidence === "moderate" || confidence === "high");

  if (watchOnly) {
    return {
      status: "watch",
      label: "watch",
      summary: issues.join("; "),
      reasons: issues,
    };
  }

  return {
    status: "not-ready",
    label: "not-ready",
    summary: issues.join("; "),
    reasons: issues,
  };
}

function buildHeading(mode) {
  return mode === "issue"
    ? "flaker self-host nightly"
    : "flaker self-host PR advisory";
}

export function renderSelfHostReview(input) {
  const readiness = buildPromotionReadiness(input.kpi);
  const title = buildHeading(input.mode);
  const body = [
    `# ${title}`,
    "",
    `- Run outcome: \`${input.runOutcome ?? "unknown"}\``,
    `- Promotion readiness: \`${readiness.label}\``,
    `- Ref: \`${input.refName ?? "unknown"}\``,
    `- Commit: \`${input.sha ? input.sha.slice(0, 12) : "unknown"}\``,
    ...(input.workflowUrl ? [`- Workflow: ${input.workflowUrl}`] : []),
    "",
    "## Promotion Signals",
    "",
    `- matched commits: ${input.kpi?.sampling?.matchedCommits ?? 0}`,
    `- false negative rate: ${formatMetric(input.kpi?.sampling?.falseNegativeRate)}`,
    `- pass correlation: ${formatMetric(input.kpi?.sampling?.passCorrelation)}`,
    `- holdout FNR: ${formatMetric(input.kpi?.sampling?.holdoutFNR)}`,
    `- sample ratio: ${formatMetric(input.kpi?.sampling?.sampleRatio)}`,
    `- skipped minutes: ${formatMetric(input.kpi?.sampling?.skippedMinutes, "m")}`,
    `- data confidence: ${input.kpi?.data?.confidence ?? "unknown"}`,
    `- last data at: ${input.kpi?.data?.lastDataAt ?? "N/A"}`,
    "",
    "## Promotion Readiness",
    "",
    `- status: \`${readiness.status}\``,
    `- summary: ${readiness.summary}`,
    ...readiness.reasons.map((reason) => `- ${reason}`),
    "",
    "## Eval Snapshot",
    "",
    `- health score: ${input.evalReport?.healthScore ?? "N/A"}`,
    `- flaky tests: ${input.evalReport?.detection?.flakyTests ?? "N/A"}`,
    `- quarantined tests: ${input.evalReport?.detection?.quarantinedTests ?? "N/A"}`,
    "",
    "## Collect Summary",
    "",
    "```text",
    clipBlock(input.collectSummary, 12),
    "```",
    "",
    "## Run Summary",
    "",
    "```text",
    clipBlock(input.runSummary, input.mode === "issue" ? 24 : 16),
    "```",
  ].join("\n");

  return { title, body };
}

function writeText(path, content) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode || !args.kpi || !args.eval || !args["body-out"] || !args["title-out"]) {
    console.error(
      "Usage: node scripts/self-host-review.mjs --mode <issue|pr> --kpi <file> --eval <file> --body-out <file> --title-out <file> [--collect <file>] [--run <file>] [--run-outcome <status>] [--workflow-url <url>] [--ref-name <name>] [--sha <sha>]",
    );
    process.exit(1);
  }

  const rendered = renderSelfHostReview({
    mode: args.mode,
    refName: args["ref-name"],
    sha: args.sha,
    runOutcome: args["run-outcome"],
    workflowUrl: args["workflow-url"],
    collectSummary: args.collect ? readText(args.collect) : "",
    runSummary: args.run ? readText(args.run) : "",
    evalReport: readJson(args.eval),
    kpi: readJson(args.kpi),
  });

  writeText(args["title-out"], rendered.title);
  writeText(args["body-out"], rendered.body);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
