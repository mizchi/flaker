# flaker API Surface Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink flaker's user-facing CLI and config to one vocabulary per concept, as specified in phase 3 of `docs/superpowers/specs/2026-09-24-flaker-test-db-design.md` (the parts that do not depend on the dataset layer).

**Architecture:** Pure removals and renames on the TypeScript CLI (`src/cli`). Removed config keys and sections become hard errors that name the replacement, following the existing `checkLegacyKeys` pattern in `src/cli/config.ts`. Removed commands are pinned by CLI-level tests that spawn `dist/cli/main.js`, following `tests/cli/removed-*.test.ts`. The MoonBit library surface (`src/*.mbt`, `src/pkg.generated.mbti`) is not touched.

**Tech Stack:** TypeScript, commander, vitest, DuckDB (`@duckdb/node-api`), MoonBit core compiled to JS.

**Out of scope (wait for phase 2):** `flaker export`, moving `explain context` / `explain bundle`, rebuilding `status` on datasets, unifying the two KPI engines.

**Release:** breaking, ships as `0.13.0` (pre-1.0 minor bump). The release itself is done afterwards with the `flaker-manual-release` skill, not in this plan.

---

## Decisions this plan locks in

| Before | After |
|---|---|
| `run --gate <g>` and `run --profile <p>` | `run --gate <g>` only |
| `[profile.local]` / `[profile.ci]` / `[profile.scheduled]` | `[gate.iteration]` / `[gate.merge]` / `[gate.release]`; custom profile names are gone |
| `FLAKER_PROFILE` | `FLAKER_GATE` (`FLAKER_PROFILE` set → hard error) |
| strategies `random weighted affected hybrid gbdt coverage-guided full` | `weighted affected hybrid full` |
| `cluster_mode`, `model_path`, `adaptive*`, `[coverage]` | removed (hard error) |
| `fallback_strategy`, `holdout_ratio` | kept |
| `apply --target calibrate` | `flaker calibrate` |
| `apply --target collect_ci` | `flaker import --ci [--days <n>]` |
| `apply --emit`, `apply --target`, `apply --incident-*`, `ops weekly`, `ops incident` | removed |
| `dev …` shown in help | `dev …` hidden (still runnable) |

## File map

- Delete: `src/cli/commands/gate/{explain,history,review}.ts`, `src/cli/commands/policy/{check,quarantine}.ts`, `src/cli/commands/collect/{local,coverage}.ts`, `src/cli/commands/exec/affected.ts`, `src/cli/adaptive.ts`, `src/cli/eval/gbdt.ts` (if only `plan.ts` / `dev train` use it), `src/cli/commands/dev/train.ts`, `src/cli/commands/ops/{daily,weekly,incident}.ts`, `src/cli/categories/ops.ts`, and the tests that import only these.
- Rename: `src/cli/profile-compat.ts` → `src/cli/gate-config.ts`, `src/cli/profile.ts` (merge into `gate-config.ts` if it only re-exports adaptive/profile helpers; read it first).
- Modify: `src/cli/main.ts`, `src/cli/config.ts`, `src/cli/gate.ts`, `src/cli/commands/exec/{sampling-options,plan,prepare-run-request}.ts`, `src/cli/commands/run.ts`, `src/cli/commands/setup/init.ts`, `src/cli/commands/collect/calibrate.ts`, `src/cli/commands/status/summary.ts`, `src/cli/commands/apply/{planner,executor}.ts`, `src/cli/categories/{apply,import,dev,analyze}.ts`.
- Create: `src/cli/categories/calibrate.ts`, `tests/cli/removed-0.13.test.ts`, `tests/cli/gate-config.test.ts`, `tests/cli/calibrate-cli.test.ts`, `tests/cli/import-ci.test.ts`, `docs/migration-0.12-to-0.13.md`, `docs/migration-0.12-to-0.13.ja.md`.
- Update: `.github/workflows/{ci,nightly-self-host}.yml`, `skills/flaker-setup/**`, `skills/flaker-management/**`, `README.md`, `docs/how-to-use{,.ja}.md`, `docs/usage-guide{,.ja}.md`, `docs/operations-guide{,.ja}.md`, `docs/flaker-management-quickstart{,.ja}.md`, `docs/new-project-checklist{,.ja}.md`, `CHANGELOG.md`.

---

### Task 1: Worktree and baseline

**Files:** none

- [ ] **Step 1: Create a worktree on a new branch off `docs/context-provider-design`**

```bash
cd /Users/mz/ghq/github.com/mizchi/flaker
git worktree add ../flaker-api-cleanup -b refactor/api-surface-0.13 docs/context-provider-design
cd ../flaker-api-cleanup
```

- [ ] **Step 2: Install and build**

```bash
pnpm install
pnpm build
```
Expected: `dist/cli/main.js` exists. `pnpm build` runs `scripts/build-package.mjs`, which also builds the MoonBit core; `moon` must be on the PATH.

- [ ] **Step 3: Record the baseline**

```bash
pnpm typecheck
pnpm test 2>&1 | tail -20
```
Expected: record the pass/fail counts in the task report. Any test that already fails on the baseline is noted and not fixed in this plan unless a later task touches it.

---

### Task 2: Delete dead modules

These modules are imported only by tests (verified with `grep -rln "<module>.js" src`). `src/cli/commands/setup/init.ts` is **not** dead: `main.ts` imports `setupInitAction` from it.

**Files:**
- Delete: `src/cli/commands/gate/explain.ts`, `src/cli/commands/gate/history.ts`, `src/cli/commands/gate/review.ts`, `src/cli/commands/policy/check.ts`, `src/cli/commands/policy/quarantine.ts`, `src/cli/commands/collect/local.ts`, `src/cli/commands/collect/coverage.ts`, `src/cli/commands/exec/affected.ts`
- Modify: `src/cli/categories/analyze.ts:278` (remove the empty `registerAnalyzeCommands`), `src/cli/main.ts` (remove its comment)

- [ ] **Step 1: Re-verify each module is unreferenced from `src`**

```bash
for f in commands/gate/explain commands/gate/history commands/gate/review commands/policy/check commands/policy/quarantine commands/collect/local commands/collect/coverage commands/exec/affected; do
  echo "$f: $(grep -rln "$f\.js" src | grep -v "src/cli/$f.ts" | tr '\n' ' ')"
done
```
Expected: every line ends with nothing after the colon. If any module is referenced, stop and report it instead of deleting.

- [ ] **Step 2: Find the tests that import them**

```bash
grep -rln "commands/gate/\(explain\|history\|review\)\|commands/policy/\|commands/collect/\(local\|coverage\)\|commands/exec/affected" tests
```
For each file listed: if every `describe` in it targets a deleted module, delete the file; if it also tests something still alive, delete only the `describe` blocks and imports for the deleted module.

- [ ] **Step 3: Delete the modules and the `registerAnalyzeCommands` stub**

```bash
git rm src/cli/commands/gate/explain.ts src/cli/commands/gate/history.ts src/cli/commands/gate/review.ts \
  src/cli/commands/policy/check.ts src/cli/commands/policy/quarantine.ts \
  src/cli/commands/collect/local.ts src/cli/commands/collect/coverage.ts \
  src/cli/commands/exec/affected.ts
```
In `src/cli/categories/analyze.ts`, delete the `export function registerAnalyzeCommands(_program: Command): void { … }` block. In `src/cli/main.ts`, delete the line `// registerAnalyzeCommands: all analyze subcommands removed in 0.8.0; parent dropped.`. Remove the now-unused `Command` import from `analyze.ts` if the typecheck flags it.

- [ ] **Step 4: Verify**

```bash
pnpm typecheck && pnpm build && pnpm test 2>&1 | tail -5
```
Expected: same pass count as the baseline minus the deleted tests; no new failures.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete CLI modules no command registers"
```

---

### Task 3: One gate vocabulary (`--gate`, `[gate.*]`, `FLAKER_GATE`)

**Files:**
- Rename: `src/cli/profile-compat.ts` → `src/cli/gate-config.ts`
- Modify: `src/cli/gate.ts`, `src/cli/config.ts`, `src/cli/commands/exec/prepare-run-request.ts`, `src/cli/commands/status/summary.ts`, `src/cli/commands/run.ts`, `src/cli/main.ts`, `src/cli/commands/setup/init.ts`, `src/cli/categories/apply.ts` (cold-start run already passes `gate: "iteration"`)
- Test: `tests/cli/gate-config.test.ts` (new), update `tests/cli/profile.test.ts`, `tests/cli/profile-integration.test.ts`, `tests/cli/init-profile-defaults.test.ts`, `tests/commands/prepare-run-request.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/cli/gate-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/cli/config.js";
import { resolveGateName, resolveGate } from "../../src/cli/gate-config.js";

function configDir(toml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-gate-"));
  writeFileSync(join(dir, "flaker.toml"), `[repo]\nowner = "a"\nname = "b"\n${toml}`);
  return dir;
}

describe("resolveGateName", () => {
  it("prefers the explicit gate", () => {
    expect(resolveGateName("release", {})).toBe("release");
  });
  it("reads FLAKER_GATE", () => {
    expect(resolveGateName(undefined, { FLAKER_GATE: "merge" })).toBe("merge");
  });
  it("defaults to merge on CI and iteration elsewhere", () => {
    expect(resolveGateName(undefined, { CI: "true" })).toBe("merge");
    expect(resolveGateName(undefined, { GITHUB_ACTIONS: "true" })).toBe("merge");
    expect(resolveGateName(undefined, {})).toBe("iteration");
  });
  it("rejects FLAKER_PROFILE with the replacement", () => {
    expect(() => resolveGateName(undefined, { FLAKER_PROFILE: "ci" })).toThrow(
      /FLAKER_PROFILE was replaced by FLAKER_GATE.*ci → merge/,
    );
  });
  it("rejects an unknown gate", () => {
    expect(() => resolveGateName("ci", {})).toThrow(/Unknown gate 'ci'/);
  });
});

describe("[gate.*] config", () => {
  it("reads [gate.merge] into the merge gate", () => {
    const config = loadConfig(configDir(`[gate.merge]\nstrategy = "hybrid"\nsample_percentage = 30\n`));
    const gate = resolveGate("merge", config.gate, config.sampling);
    expect(gate.name).toBe("merge");
    expect(gate.strategy).toBe("hybrid");
    expect(gate.sample_percentage).toBe(30);
  });

  it("rejects [profile.*] and names the [gate.*] section", () => {
    expect(() => loadConfig(configDir(`[profile.ci]\nstrategy = "hybrid"\n`))).toThrow(
      /\[profile\.ci\] was renamed to \[gate\.merge\]/,
    );
  });

  it("rejects custom profile names", () => {
    expect(() => loadConfig(configDir(`[profile.nightly]\nstrategy = "full"\n`))).toThrow(
      /\[profile\.nightly\] has no gate equivalent/,
    );
  });

  it("rejects unknown gate sections", () => {
    expect(() => loadConfig(configDir(`[gate.nightly]\nstrategy = "full"\n`))).toThrow(
      /\[gate\.nightly\] is not a gate/,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/cli/gate-config.test.ts`
Expected: FAIL, `Cannot find module '../../src/cli/gate-config.js'`.

- [ ] **Step 3: Rename the module and implement the gate API**

```bash
git mv src/cli/profile-compat.ts src/cli/gate-config.ts
```

In `src/cli/gate.ts`, delete `GATE_TO_PROFILE`, `PROFILE_TO_GATE`, `profileNameFromGateName` and `gateNameFromProfileName`, and add the legacy map used by error messages:

```ts
export const LEGACY_PROFILE_TO_GATE: Readonly<Record<string, GateName>> = {
  local: "iteration",
  ci: "merge",
  scheduled: "release",
};
```

In `src/cli/gate-config.ts`, replace `detectProfileName`, `resolveRequestedProfileName` and `resolveProfile` with:

```ts
import type { GateConfig, SamplingConfig } from "./config.js";
import { LEGACY_PROFILE_TO_GATE, normalizeGateName, type GateName } from "./gate.js";

export interface ResolvedGate {
  name: GateName;
  strategy: string;
  sample_percentage?: number;
  holdout_ratio?: number;
  co_failure_window_days?: number;
  skip_quarantined?: boolean;
  skip_flaky_tagged?: boolean;
  max_duration_seconds?: number;
  fallback_strategy?: string;
}

type Env = Record<string, string | undefined>;

export function resolveGateName(explicit: string | undefined, env: Env = process.env): GateName {
  if (env["FLAKER_PROFILE"]) {
    const mapped = LEGACY_PROFILE_TO_GATE[env["FLAKER_PROFILE"]];
    throw new Error(
      `FLAKER_PROFILE was replaced by FLAKER_GATE in 0.13.0` +
        (mapped ? ` (${env["FLAKER_PROFILE"]} → ${mapped})` : "") +
        `. See docs/migration-0.12-to-0.13.md.`,
    );
  }
  const raw =
    explicit ??
    env["FLAKER_GATE"] ??
    (env["CI"] === "true" || env["GITHUB_ACTIONS"] === "true" ? "merge" : "iteration");
  const gate = normalizeGateName(raw);
  if (!gate) {
    throw new Error(`Unknown gate '${raw}'. Expected one of: iteration, merge, release.`);
  }
  return gate;
}

export function resolveGate(
  name: GateName,
  gates: Partial<Record<GateName, GateConfig>> | undefined,
  sampling: SamplingConfig | undefined,
): ResolvedGate {
  const base = {
    strategy: sampling?.strategy ?? "weighted",
    sample_percentage: sampling?.sample_percentage,
    holdout_ratio: sampling?.holdout_ratio,
    co_failure_window_days: sampling?.co_failure_window_days,
    skip_quarantined: sampling?.skip_quarantined,
    skip_flaky_tagged: sampling?.skip_flaky_tagged,
  };
  const merged = { ...base, ...(gates?.[name] ?? {}) };
  if (merged.strategy === "full") {
    merged.sample_percentage = 100;
    merged.holdout_ratio = 0;
  }
  return { name, ...merged };
}
```

Keep `resolveFallbackSamplingMode`, retyped to `Pick<ResolvedGate, "fallback_strategy">`. Keep the adaptive fields out of `ResolvedGate`: Task 5 deletes the rest of adaptive. Until then, any code that reads `resolvedProfile.adaptive*` must read it from `config.gate?.[name]` directly; Task 5 deletes those reads.

In `src/cli/config.ts`:
- Rename `ProfileConfig` to `GateConfig` and `FlakerConfig.profile?: Record<string, ProfileConfig>` to `gate?: Partial<Record<GateName, GateConfig>>` (import `GateName` from `./gate.js`).
- Rename `LEGACY_PROFILE_KEYS` to `LEGACY_GATE_KEYS` and make `checkLegacyKeys` iterate `parsed.gate` with `[gate.${name}]` in the messages.
- Add, at the top of `checkLegacyKeys`:

```ts
  const legacyProfiles = parsed.profile as Record<string, unknown> | undefined;
  if (legacyProfiles && typeof legacyProfiles === "object") {
    for (const name of Object.keys(legacyProfiles)) {
      const gate = LEGACY_PROFILE_TO_GATE[name];
      errors.push(
        gate
          ? `[profile.${name}] was renamed to [gate.${gate}]`
          : `[profile.${name}] has no gate equivalent; use one of [gate.iteration], [gate.merge], [gate.release]`,
      );
    }
  }
  const gates = parsed.gate as Record<string, unknown> | undefined;
  if (gates && typeof gates === "object") {
    for (const name of Object.keys(gates)) {
      if (!normalizeGateName(name)) {
        errors.push(`[gate.${name}] is not a gate; use one of iteration, merge, release`);
      }
    }
  }
```
- Change the error header so it points at both guides: `` `flaker.toml uses removed or renamed keys (see docs/migration-0.12-to-0.13.md and docs/how-to-use.md#config-migration):\n` ``. Keep the existing `docs/how-to-use.md#config-migration` substring so `tests/cli/config-migration.test.ts` still passes.
- In `validateConfigRanges`, iterate `config.gate` and use `gate.${name}.…` in the paths.

- [ ] **Step 4: Move the callers onto the new API**

- `src/cli/commands/exec/prepare-run-request.ts`: drop `profile` from `RunCliOpts`; replace the `profileName`/`resolvedProfile`/`gateName` block with

```ts
  const gateName = resolveGateName(input.opts.gate);
  const resolvedGate = resolveGate(gateName, input.config.gate, input.config.sampling);
```
  rename the `PreparedRunRequest.resolvedProfile` field to `resolvedGate` and make `gateName: GateName` non-optional. Fix every reader (`grep -rn "resolvedProfile" src tests`).
- `src/cli/commands/status/summary.ts`: `resolveGate(gate, config.gate, config.sampling)`; drop the `profile` field from the per-gate info and the "via <profile>" text and the profile column in the Markdown table. Update `tests/cli/status-*.test.ts` expectations that contain `via local|ci|scheduled` or the profile column.
- `src/cli/main.ts`: delete the `.option("--profile <name>", …)` line from `run`, and change the `run` description to `"Run the selected gate"`.
- `src/cli/commands/run.ts`: remove any `profile` handling in `RUN_COMMAND_HELP` and the action.
- `src/cli/commands/setup/init.ts`: rename the generated sections to `[gate.iteration]`, `[gate.merge]`, `[gate.release]` (content unchanged in this task).
- `grep -rn "profile" src/cli --include='*.ts'` must now only show `ProjectProfile` in `calibrate.ts` and unrelated words; fix anything else.

- [ ] **Step 5: Update the existing tests**

- `tests/cli/profile.test.ts` and `tests/cli/profile-integration.test.ts`: port each case to `resolveGateName` / `resolveGate` (`local→iteration`, `ci→merge`, `scheduled→release`, `FLAKER_PROFILE→FLAKER_GATE`), then `git mv` them to `tests/cli/gate-resolution.test.ts` and `tests/cli/gate-integration.test.ts`.
- `tests/cli/init-profile-defaults.test.ts`: expect `[gate.*]` sections; `git mv` to `tests/cli/init-gate-defaults.test.ts`.
- `tests/commands/prepare-run-request.test.ts`: replace `profile:` options with `gate:` and `config.profile` fixtures with `config.gate`.
- Any fixture `flaker.toml` under `tests/fixtures` with `[profile.` must be migrated: `grep -rln "\[profile\." tests/fixtures`. `tests/fixtures/legacy-config` is only about `[sampling] percentage`; leave it alone unless it also has `[profile.`.

- [ ] **Step 6: Verify**

```bash
pnpm typecheck && pnpm build && pnpm vitest run tests/cli/gate-config.test.ts && pnpm test 2>&1 | tail -5
node dist/cli/main.js run --profile ci 2>&1 | head -2
```
Expected: all tests pass; the last command prints `error: unknown option '--profile'`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor!: use one gate vocabulary for run, config and env"
```

---

### Task 4: Remove the `random`, `gbdt` and `coverage-guided` strategies and cluster mode

**Files:**
- Modify: `src/cli/commands/exec/sampling-options.ts`, `src/cli/commands/exec/plan.ts`, `src/cli/commands/exec/prepare-run-request.ts`, `src/cli/main.ts`, `src/cli/config.ts`, `src/cli/commands/collect/calibrate.ts`, `src/cli/categories/apply.ts`, `src/cli/categories/dev.ts`
- Delete: `src/cli/commands/dev/train.ts`, `src/cli/eval/gbdt.ts` (after checking its other importers), `src/cli/failure-clusters.ts` (only if `explain cluster` does not import it — check first; if it does, keep the file and remove only `applyClusterSamplingMode`)
- Test: `tests/cli/removed-0.13.test.ts` (new), `tests/commands/sampling-options.test.ts` (update or create)

- [ ] **Step 1: Write the failing tests**

Create `tests/cli/removed-0.13.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../src/cli/config.js";
import { parseSamplingMode } from "../../src/cli/commands/exec/sampling-options.js";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

function configDir(toml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-removed-"));
  writeFileSync(join(dir, "flaker.toml"), `[repo]\nowner = "a"\nname = "b"\n${toml}`);
  return dir;
}

function help(...args: string[]): string {
  const res = spawnSync("node", [CLI, ...args, "--help"], { encoding: "utf8" });
  return res.stdout;
}

describe("strategies removed in 0.13.0", () => {
  for (const mode of ["random", "gbdt", "coverage-guided"]) {
    it(`rejects ${mode}`, () => {
      expect(() => parseSamplingMode(mode)).toThrow(
        /Expected one of: weighted, affected, hybrid, full/,
      );
    });
  }

  it("run --help no longer offers cluster mode or a model path", () => {
    const out = help("run");
    expect(out).not.toContain("--cluster-mode");
    expect(out).not.toContain("--model-path");
    expect(out).not.toContain("--profile");
  });

  for (const [key, value] of [["cluster_mode", `"spread"`], ["model_path", `"m.json"`]]) {
    it(`rejects [sampling] ${key}`, () => {
      expect(() => loadConfig(configDir(`[sampling]\n${key} = ${value}\n`))).toThrow(
        new RegExp(`\`${key}\` in \\[sampling\\] was removed in 0.13.0`),
      );
    });
    it(`rejects [gate.merge] ${key}`, () => {
      expect(() => loadConfig(configDir(`[gate.merge]\n${key} = ${value}\n`))).toThrow(
        new RegExp(`\`${key}\` in \\[gate\\.merge\\] was removed in 0.13.0`),
      );
    });
  }

  it("rejects [coverage]", () => {
    expect(() => loadConfig(configDir(`[coverage]\nformat = "istanbul"\ninput = "c.json"\n`))).toThrow(
      /\[coverage\] was removed in 0.13.0/,
    );
  });

  it("rejects a removed strategy value in config", () => {
    expect(() => loadConfig(configDir(`[gate.merge]\nstrategy = "gbdt"\n`))).toThrow(
      /strategy "gbdt" in \[gate\.merge\] was removed in 0.13.0/,
    );
  });

  it("dev train is gone", () => {
    const res = spawnSync("node", [CLI, "dev", "train"], { encoding: "utf8" });
    expect(res.status).not.toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm build && pnpm vitest run tests/cli/removed-0.13.test.ts`
Expected: FAIL on every case (the strategies still parse, the options still exist, the config keys load).

- [ ] **Step 3: Narrow the strategy set**

In `src/cli/commands/exec/sampling-options.ts`, set

```ts
export const SAMPLING_MODES = ["weighted", "affected", "hybrid", "full"] as const;
```
and delete `CLUSTER_MODES`, `ClusterSamplingMode`, `parseClusterSamplingMode` and `isClusterSamplingMode`.

In `src/cli/commands/exec/plan.ts`:
- Delete the `gbdt` and `coverage-guided` branches of `pickPrimary`, and the final `core.sampleRandom` fallthrough; make the last branch `weighted` explicitly and add an exhaustive check:

```ts
    if (mode === "weighted") {
      return { sampled: core.sampleWeighted(allTests, count, seed), effectiveMode };
    }
    const unreachable: never = mode;
    throw new Error(`Unhandled sampling mode: ${String(unreachable)}`);
```
- Delete `applyFailureClusterMode`, `loadGBDTModel`, `sampleByGBDT`, the `modelPath` and `clusterMode` fields of `SampleOpts`, the `clusterMode` field of `SamplingSummary` and its "Cluster mode:" line in the summary formatter, and the now-unused imports (`extractFeatures`, `GBDTModel`, `readFileSync`, `existsSync`, `resolve`, the failure-cluster imports).

In `src/cli/commands/exec/prepare-run-request.ts`, delete `modelPath` and `clusterMode` from `RunCliOpts` and `PreparedRunRequest`, and their resolution. Fix readers with `grep -rn "clusterMode\|modelPath" src tests`.

In `src/cli/main.ts`, delete the `--cluster-mode` and `--model-path` options of `run`, and change the `--strategy` description to `"Sampling strategy: weighted, affected, hybrid, full"`.

In `src/cli/config.ts`, delete `cluster_mode` and `model_path` from `SamplingConfig` and `GateConfig`, delete `CoverageConfig` and `FlakerConfig.coverage`, delete those lines from `writeSamplingConfig`, and add removed-key checks to `checkLegacyKeys`:

```ts
const REMOVED_IN_0_13 = ["cluster_mode", "model_path"] as const;
const REMOVED_STRATEGIES = new Set(["random", "gbdt", "coverage-guided"]);

function checkRemovedKeys(sectionLabel: string, section: Record<string, unknown>, errors: string[]): void {
  for (const key of REMOVED_IN_0_13) {
    if (key in section) errors.push(`\`${key}\` in [${sectionLabel}] was removed in 0.13.0`);
  }
  const strategy = section["strategy"];
  if (typeof strategy === "string" && REMOVED_STRATEGIES.has(strategy)) {
    errors.push(`strategy "${strategy}" in [${sectionLabel}] was removed in 0.13.0; use weighted, affected, hybrid or full`);
  }
  const fallback = section["fallback_strategy"];
  if (typeof fallback === "string" && REMOVED_STRATEGIES.has(fallback)) {
    errors.push(`fallback_strategy "${fallback}" in [${sectionLabel}] was removed in 0.13.0; use weighted, affected, hybrid or full`);
  }
}
```
Call it for `parsed.sampling` (label `sampling`) and for each `parsed.gate[name]` (label `gate.${name}`), and push `[coverage] was removed in 0.13.0` when `"coverage" in parsed`.

In `src/cli/commands/collect/calibrate.ts`:
- Remove `hasGBDTModel` from `ProjectProfile` and from `analyzeProject`'s options.
- Replace the strategy choice in `recommendSampling` with

```ts
  const strategy = profile.hasResolver ? "hybrid" : "weighted";
```
- In `formatCalibrationReport`, replace ``Run `flaker collect --days 30` `` with ``Run `flaker import --ci --days 30` ``.

Update `tests/commands/calibrate*.test.ts` (find with `grep -rln "recommendSampling\|hasGBDTModel" tests`) so that fewer than 50 tests now yields `weighted` (or `hybrid` with a resolver) instead of `random`, and nothing expects `gbdt`.

In `src/cli/categories/apply.ts`, delete `hasGBDTModel` from the `calibrate` dep and the `existsSync(resolve(".flaker","models","gbdt.json"))` line.

In `src/cli/categories/dev.ts`, delete the `train` subcommand and its import; `git rm src/cli/commands/dev/train.ts`. Then `grep -rln "eval/gbdt" src`: if nothing remains, `git rm src/cli/eval/gbdt.ts` and its test. Leave `core.predictGBDT` / `core.sampleRandom` / `core.selectByCoverage` in the MoonBit bridge (`src/cli/core/loader.ts`) alone; the MoonBit library surface is out of scope.

`grep -rn "failure-clusters" src`: if only `plan.ts` imported it, delete the file and its test; otherwise delete only `applyClusterSamplingMode`.

Strategy lists in the eval tooling (`src/cli/eval/fixture-evaluator.ts`, `fixture-report.ts`, `alpha-tuner.ts`, `commands/dev/self-eval.ts`): these compare strategies as baselines. Where they call `core.sampleRandom` directly, keep it as a baseline; where they pass `"random"`/`"gbdt"`/`"coverage-guided"` as a `SamplingMode`, drop those entries. The typecheck will point at each one.

- [ ] **Step 4: Verify**

```bash
pnpm typecheck && pnpm build && pnpm vitest run tests/cli/removed-0.13.test.ts && pnpm test 2>&1 | tail -5
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor!: remove random, gbdt and coverage-guided strategies and cluster mode"
```

---

### Task 5: Remove adaptive sampling

**Files:**
- Delete: `src/cli/adaptive.ts` and its test
- Modify: `src/cli/config.ts`, `src/cli/commands/exec/prepare-run-request.ts`, `src/cli/profile.ts` (read it first; delete it if it only served adaptive), `src/cli/commands/status/summary.ts`, `src/cli/commands/setup/init.ts`, `src/cli/commands/run.ts`
- Test: extend `tests/cli/removed-0.13.test.ts`

- [ ] **Step 1: Add the failing tests to `tests/cli/removed-0.13.test.ts`**

```ts
describe("adaptive sampling removed in 0.13.0", () => {
  for (const key of ["adaptive", "adaptive_fnr_low_ratio", "adaptive_fnr_high_ratio", "adaptive_min_percentage", "adaptive_step"]) {
    it(`rejects [gate.merge] ${key}`, () => {
      const value = key === "adaptive" ? "true" : "1";
      expect(() => loadConfig(configDir(`[gate.merge]\n${key} = ${value}\n`))).toThrow(
        new RegExp(`\`${key}\` in \\[gate\\.merge\\] was removed in 0.13.0`),
      );
    });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/cli/removed-0.13.test.ts -t adaptive`
Expected: FAIL (the keys load).

- [ ] **Step 3: Remove adaptive**

- `src/cli/config.ts`: delete the five adaptive fields from `GateConfig`, add them to `REMOVED_IN_0_13`, and delete their range checks in `validateConfigRanges`. Delete the `adaptive_fnr_low` / `adaptive_fnr_high` entries from `LEGACY_GATE_KEYS` (the removed-key check now covers them).
- `src/cli/commands/exec/prepare-run-request.ts`: delete the `if (resolvedProfile.adaptive && …)` block, `adaptiveReason`, the `computeKpi` and `runInsights` deps and imports (check `grep -rn "adaptiveReason" src tests` and remove the readers, including the run summary output in `src/cli/commands/run.ts`).
- `git rm src/cli/adaptive.ts` and the test that imports it (`grep -rln "cli/adaptive" tests`).
- `src/cli/profile.ts`: if it now has no importers (`grep -rn "cli/profile.js\|\./profile.js" src`), `git rm` it and its test.
- `src/cli/commands/status/summary.ts`: delete the `adaptive` field and the adaptive column / text.
- `src/cli/commands/setup/init.ts`: delete `adaptive = true` from `[gate.merge]`.

- [ ] **Step 4: Verify**

```bash
pnpm typecheck && pnpm build && pnpm test 2>&1 | tail -5
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor!: remove adaptive sampling"
```

---

### Task 6: Top-level `flaker calibrate`

**Files:**
- Create: `src/cli/categories/calibrate.ts`, `tests/cli/calibrate-cli.test.ts`
- Modify: `src/cli/main.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/calibrate-cli.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "flaker-calibrate-"));
  writeFileSync(
    join(dir, "flaker.toml"),
    `[repo]\nowner = "a"\nname = "b"\n[storage]\npath = ".flaker/data"\n[affected]\nresolver = "git"\nconfig = ""\n`,
  );
  return dir;
}

describe("flaker calibrate", () => {
  it("is listed in the top-level help", () => {
    const res = spawnSync("node", [CLI, "--help"], { encoding: "utf8" });
    expect(res.stdout).toMatch(/^\s+calibrate\b/m);
  });

  it("--dry-run --json reports a recommendation without touching flaker.toml", () => {
    const dir = repo();
    const before = readFileSync(join(dir, "flaker.toml"), "utf8");
    const res = spawnSync("node", [CLI, "calibrate", "--dry-run", "--json"], { cwd: dir, encoding: "utf8" });
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout) as { sampling: { strategy: string }; written: boolean };
    expect(out.sampling.strategy).toBe("hybrid");
    expect(out.written).toBe(false);
    expect(readFileSync(join(dir, "flaker.toml"), "utf8")).toBe(before);
  });

  it("writes [sampling] without --dry-run", () => {
    const dir = repo();
    const res = spawnSync("node", [CLI, "calibrate"], { cwd: dir, encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(readFileSync(join(dir, "flaker.toml"), "utf8")).toMatch(/\[sampling\]\nstrategy = "hybrid"/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm build && pnpm vitest run tests/cli/calibrate-cli.test.ts`
Expected: FAIL, `error: unknown command 'calibrate'`.

- [ ] **Step 3: Implement**

Create `src/cli/categories/calibrate.ts`:

```ts
import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig, writeSamplingConfig } from "../config.js";
import { DuckDBStore } from "../storage/duckdb.js";
import {
  analyzeProject,
  formatCalibrationReport,
  recommendSampling,
} from "../commands/collect/calibrate.js";

export interface CalibrateCliOpts {
  windowDays: string;
  dryRun?: boolean;
  json?: boolean;
}

export async function calibrateAction(opts: CalibrateCliOpts): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const store = new DuckDBStore(resolve(cwd, config.storage.path));
  await store.initialize();
  try {
    const hasResolver = config.affected.resolver !== "" && config.affected.resolver !== "none";
    const profile = await analyzeProject(store, {
      hasResolver,
      windowDays: Number(opts.windowDays),
    });
    const sampling = recommendSampling(profile);
    const written = !opts.dryRun;
    if (written) writeSamplingConfig(cwd, sampling);
    if (opts.json) {
      console.log(JSON.stringify({ profile, sampling, written }, null, 2));
    } else {
      console.log(formatCalibrationReport({ profile, sampling }));
      console.log(written ? "Wrote [sampling] to flaker.toml." : "Dry run: flaker.toml was not changed.");
    }
  } finally {
    await store.close();
  }
}

export function registerCalibrateCommand(program: Command): void {
  program
    .command("calibrate")
    .description("Recommend [sampling] from history and write it to flaker.toml")
    .option("--window-days <days>", "Analysis window in days", "90")
    .option("--dry-run", "Report the recommendation without writing flaker.toml")
    .option("--json", "Output as JSON")
    .action(calibrateAction);
}
```

In `src/cli/main.ts`, import `registerCalibrateCommand` and call it after `registerApplyCommands(program)`.

In `src/cli/categories/apply.ts`, make the `calibrate` executor dep reuse the same two calls (`analyzeProject` + `recommendSampling` + `writeSamplingConfig`) without `hasGBDTModel` (already done in Task 4); no further change.

- [ ] **Step 4: Verify**

```bash
pnpm typecheck && pnpm build && pnpm vitest run tests/cli/calibrate-cli.test.ts
```
Expected: PASS. If the empty-store recommendation is not `hybrid` (e.g. `analyzeProject` reports `testCount = 0` and a later rule changes the strategy), adjust the test expectation to the value `recommendSampling` actually returns for an empty store with a resolver, and note it in the task report.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add top-level flaker calibrate"
```

---

### Task 7: `flaker import --ci`

**Files:**
- Modify: `src/cli/categories/import.ts`
- Create: `tests/cli/import-ci.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/import-ci.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const CLI = resolve(__filename, "../../../dist/cli/main.js");

describe("flaker import --ci", () => {
  it("is documented in import --help", () => {
    const res = spawnSync("node", [CLI, "import", "--help"], { encoding: "utf8" });
    expect(res.stdout).toContain("--ci");
    expect(res.stdout).toContain("--days <n>");
  });

  it("requires GITHUB_TOKEN and says so", () => {
    const dir = mkdtempSync(join(tmpdir(), "flaker-import-ci-"));
    writeFileSync(join(dir, "flaker.toml"), `[repo]\nowner = "a"\nname = "b"\n`);
    const env = { ...process.env };
    delete env["GITHUB_TOKEN"];
    const res = spawnSync("node", [CLI, "import", "--ci"], { cwd: dir, encoding: "utf8", env });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("GITHUB_TOKEN environment variable is required");
  });

  it("rejects a file together with --ci", () => {
    const res = spawnSync("node", [CLI, "import", "report.json", "--ci"], { encoding: "utf8" });
    expect(res.status).toBe(2);
    expect(res.stderr).toContain("--ci does not take a file");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm build && pnpm vitest run tests/cli/import-ci.test.ts`
Expected: FAIL (`--ci` unknown).

- [ ] **Step 3: Implement**

In `src/cli/categories/import.ts`, add the options to the `import` command:

```ts
    .option("--ci", "Collect test-result artifacts from recent GitHub Actions runs (needs GITHUB_TOKEN)")
    .option("--days <n>", "With --ci: how many days of runs to collect", "30")
    .option("--branch-filter <branch>", "With --ci: only collect runs on this branch")
```
and at the start of the action (add `ci?: boolean; days: string; branchFilter?: string` to the opts type):

```ts
      if (opts.ci) {
        if (file) {
          process.stderr.write("error: --ci does not take a file\n");
          process.exit(2);
        }
        const config = loadConfig(process.cwd());
        const store = new DuckDBStore(resolve(config.storage.path));
        await store.initialize();
        try {
          const { result, exitCode } = await runCollectCi({
            store,
            config,
            cwd: process.cwd(),
            days: Number(opts.days),
            branch: opts.branchFilter,
          });
          console.log(formatCollectSummary(result));
          process.exitCode = exitCode;
        } finally {
          await store.close();
        }
        return;
      }
```
Import `runCollectCi` and `formatCollectSummary` from `../commands/collect/ci.js`. Before writing the `formatCollectSummary(result)` call, read its signature at `src/cli/commands/collect/ci.ts:75` and pass the arguments it actually takes. The existing `--branch <branch>` option means "branch to record for a file import", which is why the CI filter is `--branch-filter`.

Errors thrown by `runCollectCi` (missing token) propagate to `main.ts`'s catch, which prints `Error: …` to stderr and exits 1; the test relies on that.

- [ ] **Step 4: Verify**

```bash
pnpm typecheck && pnpm build && pnpm vitest run tests/cli/import-ci.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: collect CI artifacts with flaker import --ci"
```

---

### Task 8: `apply` reconciles only; remove `ops`

**Files:**
- Modify: `src/cli/categories/apply.ts`, `src/cli/main.ts`, `src/cli/commands/apply/artifact.ts` (drop `EmitKind` / `emitted` if nothing else uses them)
- Delete: `src/cli/categories/ops.ts`, `src/cli/commands/ops/daily.ts`, `src/cli/commands/ops/weekly.ts`, `src/cli/commands/ops/incident.ts`
- Delete tests: `tests/cli/apply-emit-incident.test.ts`, `tests/cli/apply-target.test.ts`, `tests/cli/removed-ops-daily.test.ts`, and the ops command tests (`grep -rln "commands/ops/\|categories/ops" tests`); update `tests/cli/apply-artifact-emission.test.ts` and `tests/cli/apply-cli.test.ts`
- Test: extend `tests/cli/removed-0.13.test.ts`

- [ ] **Step 1: Add the failing tests to `tests/cli/removed-0.13.test.ts`**

```ts
describe("apply and ops surface in 0.13.0", () => {
  it("apply no longer takes --emit, --target or --incident-*", () => {
    const out = help("apply");
    for (const flag of ["--emit", "--target", "--incident-run", "--incident-suite", "--incident-test", "--incident-repeat", "--incident-runner"]) {
      expect(out).not.toContain(flag);
    }
    for (const flag of ["--json", "--output", "--refresh-only", "--plan-file", "--force"]) {
      expect(out).toContain(flag);
    }
  });

  for (const sub of ["weekly", "incident"]) {
    it(`ops ${sub} is gone`, () => {
      const res = spawnSync("node", [CLI, "ops", sub], { encoding: "utf8" });
      expect(res.status).not.toBe(0);
    });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm build && pnpm vitest run tests/cli/removed-0.13.test.ts -t "apply and ops"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/cli/categories/apply.ts`:
- Delete the `--emit`, `--target` and five `--incident-*` options from `registerApplyCommands`, and the corresponding fields and branches in `applyAction` (the `emitted` handling, the `target` filter, the incident dispatch).
- Delete the imports of `runOpsDaily`/`formatOpsDailyReport`, `runOpsWeekly`/`formatOpsWeeklyReport`, `runOpsIncident`/`formatOpsIncidentReport`, `runRetry`, `runConfirmLocal`, `runConfirmRemote`, `runDiagnose`, `createTestResultAdapter`, `createRunner` if they become unused.
- In `src/cli/commands/apply/artifact.ts`, delete `EmitKind`, `EmittedArtifact` and the `emitted` field if nothing else reads them after this change; keep the plan/apply artifact serializers.

In `src/cli/main.ts`, delete `registerOpsCommands` and its import. Then:

```bash
git rm src/cli/categories/ops.ts src/cli/commands/ops/daily.ts src/cli/commands/ops/weekly.ts src/cli/commands/ops/incident.ts
git rm tests/cli/apply-emit-incident.test.ts tests/cli/apply-target.test.ts tests/cli/removed-ops-daily.test.ts
grep -rln "commands/ops/\|categories/ops" tests src
```
Delete or trim every file the last command lists. `debug retry`, `debug confirm` and `debug diagnose` stay; they were the pieces `ops incident` bundled.

- [ ] **Step 4: Verify**

```bash
pnpm typecheck && pnpm build && pnpm test 2>&1 | tail -5
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor!: make apply reconcile only and remove the ops group"
```

---

### Task 9: Hide `dev`, rewrite the help text

**Files:**
- Modify: `src/cli/categories/dev.ts`, `src/cli/main.ts`
- Test: `tests/cli/surface-reduction.test.ts`, `tests/cli/help-shape.test.ts`, `tests/cli/help-primary-shape.test.ts`, `tests/cli/help.test.ts`, `tests/cli/top-level-aliases.test.ts`, `tests/cli/removed-0.13.test.ts`

- [ ] **Step 1: Update the surface contract test first**

In `tests/cli/surface-reduction.test.ts`, change the header comment to "The 0.13.0 surface contract" and the list to:

```ts
const PRIMARY = [
  "init",
  "plan",
  "apply",
  "status",
  "run",
  "calibrate",
  "doctor",
  "debug",
  "query",
  "explain",
  "import",
  "report",
];
```
and update the expected count in the test name and assertions from 11 to 12. Add to `tests/cli/removed-0.13.test.ts`:

```ts
describe("help text in 0.13.0", () => {
  const top = spawnSync("node", [CLI, "--help"], { encoding: "utf8" }).stdout;

  it("does not list dev or ops", () => {
    expect(top).not.toMatch(/^\s+dev\b/m);
    expect(top).not.toMatch(/^\s+ops\b/m);
  });

  it("init no longer claims to alias setup init", () => {
    expect(top).not.toContain("setup init");
  });

  it("dev is still runnable", () => {
    const res = spawnSync("node", [CLI, "dev", "test-key", "--suite", "a", "--test-name", "b"], { encoding: "utf8" });
    expect(res.status).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm build && pnpm vitest run tests/cli/surface-reduction.test.ts tests/cli/removed-0.13.test.ts -t "help|primary"`
Expected: FAIL (`calibrate` missing from the Primary block, `dev`/`ops` still listed, `setup init` still present).

- [ ] **Step 3: Implement**

In `src/cli/categories/dev.ts`, register the parent as hidden:

```ts
  const dev = program
    .command("dev", { hidden: true })
    .description("Maintainer tools (not part of the public surface)");
```
(keep the existing variable name used by the subcommands).

In `src/cli/main.ts`, change the `init` description to `"Create flaker.toml (auto-detects the repository)"`, and replace the `extras` string with:

```ts
    const extras = `
Getting started:
  flaker init                       Create flaker.toml (auto-detects repo)
  flaker doctor                     Check runtime requirements
  flaker run --gate iteration       Fast local feedback
  flaker run --gate merge           PR / mainline gate
  flaker status                     KPI dashboard (sampling, flaky, data quality)

Primary commands:
  init                                          Bootstrap flaker.toml
  plan                                          Preview actions apply would take
  apply                                         Reconcile repo to flaker.toml (idempotent)
  status                                        Dashboard + promotion drift
  run --gate <iteration|merge|release>          Execute the selected gate
  calibrate                                     Recommend and write [sampling]
  doctor                                        Verify local environment
  debug <retry|confirm|bisect|diagnose>         Incident investigation
  query <sql>                                   SQL escape hatch
  explain <topic>                               AI-assisted analysis
  import <file> | import --ci                   Ingest reports or CI artifacts
  report <file> --summary|--diff|--aggregate    Local report shaping

Run \`flaker <command> --help\` for details.
Upgrading from 0.12.x? See docs/migration-0.12-to-0.13.md.
`;
```
If `surface-reduction.test.ts` locates the block end with `"Advanced:"`, change it to end at `"Run \`flaker"` and keep the same parsing otherwise.

Update `tests/cli/help-shape.test.ts`, `help-primary-shape.test.ts`, `help.test.ts` and `top-level-aliases.test.ts` wherever they expect `ops`, `dev`, `Advanced:`, `setup init` or `--profile`.

- [ ] **Step 4: Verify**

```bash
pnpm typecheck && pnpm build && pnpm test 2>&1 | tail -5
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor!: hide dev and rewrite the top-level help for 0.13.0"
```

---

### Task 10: Self-hosted workflows and plugin skills

**Files:**
- Modify: `.github/workflows/ci.yml`, `.github/workflows/nightly-self-host.yml`, `skills/flaker-setup/SKILL.md`, `skills/flaker-management/SKILL.md`, `skills/flaker-management/references/*.md`, `skills/flaker-management/assets/*.yml`, `flaker.toml` in the repo root if it has `[profile.`

- [ ] **Step 1: Find every use of the removed surface**

```bash
grep -rn -- "--profile\|FLAKER_PROFILE\|\[profile\.\|apply --target\|apply --emit\|--incident-\|flaker ops\|dev train\|cluster_mode\|model_path\|adaptive\|coverage-guided\|gbdt\|strategy = \"random\"" \
  .github skills flaker.toml 2>/dev/null
```

- [ ] **Step 2: Rewrite each hit**

| Old | New |
|---|---|
| `apply --target collect_ci` | `import --ci` (keep `--days` if the step passed one via config; the old default window came from the planner, use `--days 30`) |
| `run --profile ci` | `run --gate merge` |
| `run --profile scheduled` | `run --gate release` |
| `run --profile local` | `run --gate iteration` |
| `[profile.local]` / `[profile.ci]` / `[profile.scheduled]` | `[gate.iteration]` / `[gate.merge]` / `[gate.release]` |
| `FLAKER_PROFILE=<p>` | `FLAKER_GATE=<gate>` |
| `flaker ops weekly --output X` | `flaker status --markdown > X` plus `flaker explain insights` (say so in prose where the skill explained the weekly bundle) |
| `flaker ops incident …` | `flaker debug retry` / `debug confirm` / `debug diagnose` |
| `apply --emit daily` | `flaker apply && flaker status` |
| `adaptive = true` | delete the line |

In `skills/flaker-setup/SKILL.md`, also remove `setup init`, `policy …`, `gate review/history/explain` from the list of deprecated aliases at line ~221 (they no longer exist at all) and state the minimum version as `0.13.0` where the skill pins one.

- [ ] **Step 3: Verify**

Re-run the Step 1 grep. Expected: no hits except intentional mentions inside a migration note. Then:

```bash
node dist/cli/main.js --help >/dev/null && echo ok
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: move workflows and skills to the 0.13.0 surface"
```

---

### Task 11: User docs, migration guide, changelog

**Files:**
- Create: `docs/migration-0.12-to-0.13.md`, `docs/migration-0.12-to-0.13.ja.md`
- Modify: `README.md`, `docs/how-to-use{,.ja}.md`, `docs/usage-guide{,.ja}.md`, `docs/operations-guide{,.ja}.md`, `docs/flaker-management-quickstart{,.ja}.md`, `docs/new-project-checklist{,.ja}.md`, `docs/coverage-guided-sampling.md`, `CHANGELOG.md`

- [ ] **Step 1: Write `docs/migration-0.12-to-0.13.md`**

Sections, in this order, each with a before/after snippet:
1. `--profile` → `--gate`, `[profile.*]` → `[gate.*]`, `FLAKER_PROFILE` → `FLAKER_GATE`, with the mapping `local → iteration`, `ci → merge`, `scheduled → release`, and the note that custom profile names have no equivalent.
2. Removed strategies (`random`, `gbdt`, `coverage-guided`) → use `weighted` or `hybrid`; removed `cluster_mode`, `model_path`, `[coverage]`, `dev train`.
3. Removed adaptive keys (`adaptive`, `adaptive_fnr_low_ratio`, `adaptive_fnr_high_ratio`, `adaptive_min_percentage`, `adaptive_step`) → run `flaker calibrate` periodically instead.
4. `apply --target calibrate` → `flaker calibrate`; `apply --target collect_ci` → `flaker import --ci`.
5. `apply --emit …`, `apply --incident-*`, `ops weekly`, `ops incident` → the replacements from the Task 10 table.
6. `dev` is hidden.
7. "Every removed key is a hard error that names its replacement" with one real error message copied from `node dist/cli/main.js run` against a `[profile.ci]` config.

- [ ] **Step 2: Write `docs/migration-0.12-to-0.13.ja.md`**

The same sections in Japanese, following the style of `docs/migration-0.4-to-0.5.ja.md`.

- [ ] **Step 3: Update the user docs**

Run the Task 10 Step 1 grep over `README.md docs/*.md` (not `docs/superpowers`, not older `docs/migration-*`) and rewrite each hit with the same table. Add a line to the README's "Upgrading" callouts pointing at both new migration guides. In `docs/coverage-guided-sampling.md`, add a first-line note that the strategy was removed in 0.13.0 and the document is kept for history.

- [ ] **Step 4: Add the CHANGELOG entry**

At the top of `CHANGELOG.md`, following the existing entry format:

```markdown
## 0.13.0 (unreleased)

### Breaking

- `run --profile`, `[profile.*]` and `FLAKER_PROFILE` are replaced by `run --gate`, `[gate.iteration|merge|release]` and `FLAKER_GATE`.
- Removed the `random`, `gbdt` and `coverage-guided` strategies, `cluster_mode`, `model_path`, `[coverage]` and `dev train`.
- Removed adaptive sampling (`adaptive*` keys).
- `apply` only reconciles: `--emit`, `--target` and `--incident-*` are gone, and so is the `ops` group.
- `dev` is hidden from the help.

### Added

- `flaker calibrate` (was `apply --target calibrate`).
- `flaker import --ci [--days <n>]` (was `apply --target collect_ci`).

See docs/migration-0.12-to-0.13.md.
```

- [ ] **Step 5: Verify**

```bash
grep -rn -- "--profile\|\[profile\.\|FLAKER_PROFILE\|flaker ops\|apply --target\|apply --emit" README.md docs/*.md | grep -v "migration-"
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: document the 0.13.0 surface and migration"
```

---

### Task 12: Final verification

- [ ] **Step 1: Full check**

```bash
pnpm typecheck && pnpm build && pnpm test 2>&1 | tail -10 && pnpm pack:check >/dev/null && echo pack-ok
```
Expected: typecheck clean, all tests pass, `pack-ok`.

- [ ] **Step 2: Smoke the new surface by hand**

```bash
node dist/cli/main.js --help
node dist/cli/main.js run --help
node dist/cli/main.js apply --help
node dist/cli/main.js calibrate --help
node dist/cli/main.js import --help
```
Expected: no `--profile`, `--cluster-mode`, `--model-path`, `--emit`, `--target`, `--incident-*`, `ops` or `dev`; `calibrate` and `import --ci` present.

- [ ] **Step 3: Report**

List the commits, the before/after test counts from Task 1, and anything that was skipped or deferred, then hand over to `superpowers:finishing-a-development-branch`.
