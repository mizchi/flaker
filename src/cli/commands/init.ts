import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function generateToml(owner: string, name: string): string {
  return `[repo]
owner = "${owner}"
name = "${name}"

[storage]
path = ".flaker/data"

[adapter]
type = "command"

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

export function runInit(
  dir: string,
  opts: { owner: string; name: string },
): void {
  const tomlPath = join(dir, "flaker.toml");
  writeFileSync(tomlPath, generateToml(opts.owner, opts.name), "utf-8");
  mkdirSync(join(dir, ".flaker"), { recursive: true });
}
