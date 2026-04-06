import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

function generateToml(owner: string, name: string): string {
  return `[repo]
owner = "${owner}"
name = "${name}"

[storage]
path = ".flaker/data"

[adapter]
type = "playwright"
artifact_name = "playwright-report"
# command = "node ./adapter.js"

[runner]
type = "vitest"
command = "pnpm test"

[affected]
resolver = "git"
config = ""

[quarantine]
auto = true
flaky_rate_threshold = 0.3
min_runs = 5

[flaky]
window_days = 14
detection_threshold = 0.1
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
  opts: { owner: string; name: string },
): void {
  const tomlPath = join(dir, "flaker.toml");
  writeFileSync(tomlPath, generateToml(opts.owner, opts.name), "utf-8");
  mkdirSync(join(dir, ".flaker"), { recursive: true });

  // Generate confirm workflow if not exists
  const workflowDir = join(dir, ".github", "workflows");
  const workflowPath = join(workflowDir, "flaker-confirm.yml");
  mkdirSync(workflowDir, { recursive: true });
  if (!existsSync(workflowPath)) {
    writeFileSync(workflowPath, generateConfirmWorkflow(), "utf-8");
  }
}
