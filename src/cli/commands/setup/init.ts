import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const RUNNER_COMMAND_DEFAULTS: Record<string, string> = {
  vitest: "pnpm exec vitest run",
  playwright: "pnpm exec playwright test",
  jest: "pnpm exec jest",
  actrun: "actrun",
};

function adapterSection(adapter?: string): string {
  if (adapter) return `[adapter]\ntype = "${adapter}"\n`;
  return `[adapter]\ntype = "playwright"\nartifact_name = "playwright-report"\n# command = "node ./adapter.js"\n`;
}

function runnerSection(runner?: string): string {
  if (runner) {
    const cmd = RUNNER_COMMAND_DEFAULTS[runner] ?? "";
    return `[runner]\ntype = "${runner}"\ncommand = "${cmd}"\n`;
  }
  return `[runner]\ntype = "vitest"\ncommand = "pnpm test"\n`;
}

function generateToml(owner: string, name: string, adapter?: string, runner?: string): string {
  return `[repo]
owner = "${owner}"
name = "${name}"

[storage]
path = ".flaker/data"

${adapterSection(adapter)}
${runnerSection(runner)}
# Optional: used by \`flaker run --runner actrun\`
# [runner.actrun]
# workflow = ".github/workflows/ci.yml"
# job = "test"
# local = true
# trust = true

[affected]
resolver = "git"
config = ""

[quarantine]
auto = true
flaky_rate_threshold_percentage = 30
min_runs = 5

[flaky]
window_days = 14
detection_threshold_ratio = 0.02

[profile.local]
strategy = "affected"
max_duration_seconds = 60
fallback_strategy = "weighted"
skip_flaky_tagged = true

[profile.ci]
strategy = "hybrid"
sample_percentage = 30
adaptive = true
skip_flaky_tagged = true

[profile.scheduled]
strategy = "full"
`;
}

function generateConfirmWorkflow(): string {
  return `name: flaker-confirm
on:
  workflow_dispatch:
    inputs:
      suite:
        description: "Test suite (file path)"
        required: true
      test_name:
        description: "Test name"
        required: true
      repeat:
        description: "Number of repetitions"
        default: "5"

jobs:
  confirm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install

      - name: Run confirmation tests
        run: |
          for i in \\$(seq 1 \${{ inputs.repeat }}); do
            echo "--- Run \\$i/\${{ inputs.repeat }} ---"
            pnpm exec vitest run "\${{ inputs.suite }}" \\\\
              -t "\${{ inputs.test_name }}" \\\\
              --reporter json \\\\
              --outputFile "result-\\$i.json" || true
          done

      - uses: actions/upload-artifact@v4
        with:
          name: flaker-confirm-results
          path: result-*.json
`;
}

export function runInit(
  dir: string,
  opts: { owner: string; name: string; adapter?: string; runner?: string },
): void {
  const tomlPath = join(dir, "flaker.toml");
  writeFileSync(tomlPath, generateToml(opts.owner, opts.name, opts.adapter, opts.runner), "utf-8");
  mkdirSync(join(dir, ".flaker"), { recursive: true });

  // Generate confirm workflow if not exists
  const workflowDir = join(dir, ".github", "workflows");
  const workflowPath = join(workflowDir, "flaker-confirm.yml");
  mkdirSync(workflowDir, { recursive: true });
  if (!existsSync(workflowPath)) {
    writeFileSync(workflowPath, generateConfirmWorkflow(), "utf-8");
  }
}
