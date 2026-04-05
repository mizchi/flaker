# Three-Tier Test Execution Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `[profile.daily]`, `[profile.ci]`, `[profile.local]` sections to `flaker.toml` and wire `--profile` flag into the CLI so that `flaker run` uses environment-appropriate sampling strategies.

**Architecture:** Profile resolution happens entirely in the CLI layer (`src/cli/`). A new `src/cli/profile.ts` module handles config parsing, auto-detection, and adaptive percentage logic. The MoonBit core and storage layers remain unchanged.

**Tech Stack:** TypeScript, Commander.js, smol-toml, vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/cli/profile.ts` | Create | Profile type, resolution (auto-detect + merge), adaptive percentage calculation, time-budget filtering |
| `src/cli/config.ts` | Modify | Add `ProfileConfig` type, parse `[profile.*]` sections from TOML |
| `src/cli/main.ts` | Modify | Add `--profile` flag to `run` and `sample` commands, call profile resolution |
| `src/cli/commands/sample.ts` | Modify | Add `"full"` strategy handling, time-budget filtering |
| `src/cli/commands/sampling-options.ts` | Modify | Add `"full"` to `SAMPLING_MODES` |
| `tests/cli/profile.test.ts` | Create | Unit tests for profile module |
| `tests/cli/time-budget.test.ts` | Create | Unit tests for time-budget filtering |

---

### Task 1: ProfileConfig type and TOML parsing

**Files:**
- Modify: `src/cli/config.ts:1-17` (add ProfileConfig type)
- Modify: `src/cli/config.ts:18-33` (add profile field to FlakerConfig)
- Modify: `src/cli/config.ts:34-43` (add default profile configs)
- Test: `tests/cli/profile.test.ts`

- [ ] **Step 1: Write failing test for ProfileConfig parsing**

```typescript
// tests/cli/profile.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/cli/config.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

describe("ProfileConfig parsing", () => {
  function createTempConfig(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "flaker-test-"));
    writeFileSync(join(dir, "flaker.toml"), content);
    return dir;
  }

  it("parses [profile.*] sections from TOML", () => {
    const dir = createTempConfig(`
[repo]
owner = "test"
name = "test"

[storage]
path = ".flaker/data"

[adapter]
type = "vitest"

[runner]
type = "vitest"
command = "pnpm test"

[sampling]
strategy = "hybrid"
percentage = 30

[profile.daily]
strategy = "full"

[profile.ci]
strategy = "hybrid"
percentage = 30
adaptive = true

[profile.local]
strategy = "affected"
max_duration_seconds = 60
fallback_strategy = "weighted"
`);
    const config = loadConfig(dir);
    expect(config.profile).toBeDefined();
    expect(config.profile!.daily).toEqual({ strategy: "full" });
    expect(config.profile!.ci).toEqual({
      strategy: "hybrid",
      percentage: 30,
      adaptive: true,
    });
    expect(config.profile!.local).toEqual({
      strategy: "affected",
      max_duration_seconds: 60,
      fallback_strategy: "weighted",
    });
  });

  it("works without [profile.*] sections (backward compat)", () => {
    const dir = createTempConfig(`
[repo]
owner = "test"
name = "test"

[storage]
path = ".flaker/data"

[adapter]
type = "vitest"

[runner]
type = "vitest"
command = "pnpm test"

[sampling]
strategy = "hybrid"
percentage = 30
`);
    const config = loadConfig(dir);
    expect(config.profile).toBeUndefined();
    expect(config.sampling?.strategy).toBe("hybrid");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/cli/profile.test.ts`
Expected: FAIL — `profile` property not recognized in FlakerConfig

- [ ] **Step 3: Add ProfileConfig type and update FlakerConfig**

In `src/cli/config.ts`, add the type after `SamplingConfig`:

```typescript
export interface ProfileConfig {
  strategy: string;
  percentage?: number;
  holdout_ratio?: number;
  co_failure_days?: number;
  model_path?: string;
  skip_quarantined?: boolean;
  adaptive?: boolean;
  adaptive_fnr_low?: number;
  adaptive_fnr_high?: number;
  adaptive_min_percentage?: number;
  adaptive_step?: number;
  max_duration_seconds?: number;
  fallback_strategy?: string;
}
```

Add to the `FlakerConfig` interface:

```typescript
export interface FlakerConfig {
  // ... existing fields ...
  sampling?: SamplingConfig;
  profile?: Record<string, ProfileConfig>;
}
```

No changes to `DEFAULT_CONFIG` — `profile` is optional and undefined by default.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/cli/profile.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/config.ts tests/cli/profile.test.ts
git commit -m "feat: add ProfileConfig type and TOML parsing for [profile.*] sections"
```

---

### Task 2: Profile resolution module

**Files:**
- Create: `src/cli/profile.ts`
- Test: `tests/cli/profile.test.ts` (extend)

- [ ] **Step 1: Write failing test for resolveProfile**

Append to `tests/cli/profile.test.ts`:

```typescript
import { resolveProfile, detectProfileName } from "../../src/cli/profile.js";
import type { ProfileConfig } from "../../src/cli/config.js";
import type { SamplingConfig } from "../../src/cli/config.js";

describe("detectProfileName", () => {
  it("returns explicit profile when provided", () => {
    expect(detectProfileName("daily")).toBe("daily");
  });

  it("returns 'ci' when CI env var is set", () => {
    const original = process.env.CI;
    process.env.CI = "true";
    try {
      expect(detectProfileName(undefined)).toBe("ci");
    } finally {
      if (original === undefined) delete process.env.CI;
      else process.env.CI = original;
    }
  });

  it("returns 'ci' when GITHUB_ACTIONS is set", () => {
    const origCI = process.env.CI;
    const origGA = process.env.GITHUB_ACTIONS;
    delete process.env.CI;
    process.env.GITHUB_ACTIONS = "true";
    try {
      expect(detectProfileName(undefined)).toBe("ci");
    } finally {
      if (origCI === undefined) delete process.env.CI;
      else process.env.CI = origCI;
      if (origGA === undefined) delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS = origGA;
    }
  });

  it("returns 'local' as default", () => {
    const origCI = process.env.CI;
    const origGA = process.env.GITHUB_ACTIONS;
    const origFP = process.env.FLAKER_PROFILE;
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.FLAKER_PROFILE;
    try {
      expect(detectProfileName(undefined)).toBe("local");
    } finally {
      if (origCI !== undefined) process.env.CI = origCI;
      if (origGA !== undefined) process.env.GITHUB_ACTIONS = origGA;
      if (origFP !== undefined) process.env.FLAKER_PROFILE = origFP;
    }
  });

  it("checks FLAKER_PROFILE env var", () => {
    const origFP = process.env.FLAKER_PROFILE;
    process.env.FLAKER_PROFILE = "daily";
    try {
      expect(detectProfileName(undefined)).toBe("daily");
    } finally {
      if (origFP === undefined) delete process.env.FLAKER_PROFILE;
      else process.env.FLAKER_PROFILE = origFP;
    }
  });
});

describe("resolveProfile", () => {
  const sampling: SamplingConfig = {
    strategy: "hybrid",
    percentage: 30,
    holdout_ratio: 0.1,
  };

  it("merges profile config over sampling defaults", () => {
    const profiles: Record<string, ProfileConfig> = {
      ci: { strategy: "hybrid", percentage: 20, adaptive: true },
    };
    const result = resolveProfile("ci", profiles, sampling);
    expect(result.strategy).toBe("hybrid");
    expect(result.percentage).toBe(20);
    expect(result.adaptive).toBe(true);
    expect(result.holdout_ratio).toBe(0.1); // inherited from sampling
  });

  it("falls back to sampling config when profile not found", () => {
    const result = resolveProfile("unknown", {}, sampling);
    expect(result.strategy).toBe("hybrid");
    expect(result.percentage).toBe(30);
  });

  it("full strategy sets percentage to 100", () => {
    const profiles: Record<string, ProfileConfig> = {
      daily: { strategy: "full" },
    };
    const result = resolveProfile("daily", profiles, sampling);
    expect(result.strategy).toBe("full");
    expect(result.percentage).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/cli/profile.test.ts`
Expected: FAIL — module `../../src/cli/profile.js` not found

- [ ] **Step 3: Implement profile.ts**

Create `src/cli/profile.ts`:

```typescript
import type { ProfileConfig, SamplingConfig } from "./config.js";

export interface ResolvedProfile {
  name: string;
  strategy: string;
  percentage?: number;
  holdout_ratio?: number;
  co_failure_days?: number;
  model_path?: string;
  skip_quarantined?: boolean;
  adaptive: boolean;
  adaptive_fnr_low: number;
  adaptive_fnr_high: number;
  adaptive_min_percentage: number;
  adaptive_step: number;
  max_duration_seconds?: number;
  fallback_strategy?: string;
}

/**
 * Detect which profile to use.
 * Priority: explicit > FLAKER_PROFILE env > CI detection > "local"
 */
export function detectProfileName(explicit: string | undefined): string {
  if (explicit) return explicit;
  if (process.env.FLAKER_PROFILE) return process.env.FLAKER_PROFILE;
  if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") return "ci";
  return "local";
}

/**
 * Merge profile config with sampling defaults to produce a resolved profile.
 */
export function resolveProfile(
  profileName: string,
  profiles: Record<string, ProfileConfig> | undefined,
  sampling: SamplingConfig | undefined,
): ResolvedProfile {
  const profileConf = profiles?.[profileName];
  const strategy = profileConf?.strategy ?? sampling?.strategy ?? "weighted";

  // "full" means run everything
  const isFull = strategy === "full";

  return {
    name: profileName,
    strategy,
    percentage: isFull ? 100 : (profileConf?.percentage ?? sampling?.percentage),
    holdout_ratio: isFull ? 0 : (profileConf?.holdout_ratio ?? sampling?.holdout_ratio),
    co_failure_days: profileConf?.co_failure_days ?? sampling?.co_failure_days,
    model_path: profileConf?.model_path ?? sampling?.model_path,
    skip_quarantined: profileConf?.skip_quarantined ?? sampling?.skip_quarantined,
    adaptive: profileConf?.adaptive ?? false,
    adaptive_fnr_low: profileConf?.adaptive_fnr_low ?? 0.02,
    adaptive_fnr_high: profileConf?.adaptive_fnr_high ?? 0.05,
    adaptive_min_percentage: profileConf?.adaptive_min_percentage ?? 10,
    adaptive_step: profileConf?.adaptive_step ?? 5,
    max_duration_seconds: profileConf?.max_duration_seconds,
    fallback_strategy: profileConf?.fallback_strategy,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/cli/profile.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/profile.ts tests/cli/profile.test.ts
git commit -m "feat: add profile resolution module with env auto-detection"
```

---

### Task 3: Add "full" to sampling modes

**Files:**
- Modify: `src/cli/commands/sampling-options.ts:1-2`
- Modify: `src/cli/commands/sample.ts:205-255` (selectByStrategy)
- Test: existing tests + inline verification

- [ ] **Step 1: Write failing test for "full" mode**

Create `tests/cli/full-strategy.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseSamplingMode } from "../../src/cli/commands/sampling-options.js";

describe("full sampling mode", () => {
  it("parseSamplingMode accepts 'full'", () => {
    expect(parseSamplingMode("full")).toBe("full");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/cli/full-strategy.test.ts`
Expected: FAIL — "Unknown sampling strategy: full"

- [ ] **Step 3: Add "full" to SAMPLING_MODES**

In `src/cli/commands/sampling-options.ts`, change line 1:

```typescript
export const SAMPLING_MODES = [
  "random",
  "weighted",
  "affected",
  "hybrid",
  "gbdt",
  "full",
] as const;
```

In `src/cli/commands/sample.ts`, add a `"full"` branch to `selectByStrategy` (before the weighted check around line 242):

```typescript
  if (opts.mode === "full") {
    return {
      sampled: allTests,
      effectiveMode: "full",
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/cli/full-strategy.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `pnpm exec vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/sampling-options.ts src/cli/commands/sample.ts tests/cli/full-strategy.test.ts
git commit -m "feat: add 'full' sampling mode (run all tests, no sampling)"
```

---

### Task 4: Adaptive percentage calculation

**Files:**
- Modify: `src/cli/profile.ts` (add computeAdaptivePercentage)
- Test: `tests/cli/profile.test.ts` (extend)

- [ ] **Step 1: Write failing test for adaptive percentage**

Append to `tests/cli/profile.test.ts`:

```typescript
import { computeAdaptivePercentage } from "../../src/cli/profile.js";

describe("computeAdaptivePercentage", () => {
  const defaults = {
    basePercentage: 30,
    fnrLow: 0.02,
    fnrHigh: 0.05,
    minPercentage: 10,
    step: 5,
  };

  it("reduces percentage when FNR is below low threshold", () => {
    const result = computeAdaptivePercentage(0.01, defaults);
    expect(result.percentage).toBe(25);
    expect(result.reason).toContain("FNR");
  });

  it("keeps percentage when FNR is between thresholds", () => {
    const result = computeAdaptivePercentage(0.03, defaults);
    expect(result.percentage).toBe(30);
    expect(result.reason).toContain("within");
  });

  it("increases percentage when FNR exceeds high threshold", () => {
    // Already at base, can't increase beyond base
    const lowStart = { ...defaults, basePercentage: 20 };
    const result = computeAdaptivePercentage(0.06, lowStart);
    expect(result.percentage).toBe(25);
    expect(result.reason).toContain("FNR");
  });

  it("never goes below minPercentage", () => {
    const result = computeAdaptivePercentage(0.001, {
      ...defaults,
      basePercentage: 12,
    });
    expect(result.percentage).toBeGreaterThanOrEqual(10);
  });

  it("returns base percentage when FNR is null (no data)", () => {
    const result = computeAdaptivePercentage(null, defaults);
    expect(result.percentage).toBe(30);
    expect(result.reason).toContain("no data");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/cli/profile.test.ts`
Expected: FAIL — `computeAdaptivePercentage` not exported

- [ ] **Step 3: Implement computeAdaptivePercentage**

Add to `src/cli/profile.ts`:

```typescript
export interface AdaptivePercentageOpts {
  basePercentage: number;
  fnrLow: number;
  fnrHigh: number;
  minPercentage: number;
  step: number;
}

export interface AdaptivePercentageResult {
  percentage: number;
  reason: string;
}

export function computeAdaptivePercentage(
  falseNegativeRate: number | null,
  opts: AdaptivePercentageOpts,
): AdaptivePercentageResult {
  if (falseNegativeRate == null) {
    return {
      percentage: opts.basePercentage,
      reason: "adaptive: no data, using base percentage",
    };
  }

  if (falseNegativeRate < opts.fnrLow) {
    const reduced = Math.max(opts.minPercentage, opts.basePercentage - opts.step);
    return {
      percentage: reduced,
      reason: `adaptive: FNR ${(falseNegativeRate * 100).toFixed(1)}% < ${(opts.fnrLow * 100).toFixed(0)}% threshold, reduced to ${reduced}%`,
    };
  }

  if (falseNegativeRate > opts.fnrHigh) {
    const increased = opts.basePercentage + opts.step;
    return {
      percentage: increased,
      reason: `adaptive: FNR ${(falseNegativeRate * 100).toFixed(1)}% > ${(opts.fnrHigh * 100).toFixed(0)}% threshold, increased to ${increased}%`,
    };
  }

  return {
    percentage: opts.basePercentage,
    reason: `adaptive: FNR ${(falseNegativeRate * 100).toFixed(1)}% within target range, keeping ${opts.basePercentage}%`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/cli/profile.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/profile.ts tests/cli/profile.test.ts
git commit -m "feat: add adaptive percentage calculation based on false negative rate"
```

---

### Task 5: Time-budget filtering for local profile

**Files:**
- Modify: `src/cli/profile.ts` (add applyTimeBudget)
- Test: `tests/cli/time-budget.test.ts`

- [ ] **Step 1: Write failing test for time-budget filtering**

Create `tests/cli/time-budget.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { applyTimeBudget, type TimeBudgetResult } from "../../src/cli/profile.js";

describe("applyTimeBudget", () => {
  const tests = [
    { suite: "a.test.ts", test_name: "test1", avg_duration_ms: 10_000, flaky_rate: 0.5, co_failure_boost: 0.8, run_count: 10, last_failed_at: "2026-04-01" },
    { suite: "b.test.ts", test_name: "test2", avg_duration_ms: 20_000, flaky_rate: 0.1, co_failure_boost: 0, run_count: 10, last_failed_at: null },
    { suite: "c.test.ts", test_name: "test3", avg_duration_ms: 30_000, flaky_rate: 0.3, co_failure_boost: 0.5, run_count: 10, last_failed_at: "2026-04-02" },
    { suite: "d.test.ts", test_name: "test4", avg_duration_ms: 5_000, flaky_rate: 0, co_failure_boost: 0, run_count: 10, last_failed_at: null },
  ];

  it("returns all tests when within budget", () => {
    const result = applyTimeBudget(tests, 120);
    expect(result.selected).toHaveLength(4);
    expect(result.skippedCount).toBe(0);
  });

  it("cuts tests when exceeding budget, prioritizing high-signal tests", () => {
    // Budget: 40s. Total: 65s. Must cut some.
    const result = applyTimeBudget(tests, 40);
    expect(result.selected.length).toBeLessThan(4);
    expect(result.skippedCount).toBeGreaterThan(0);
    // The highest-priority tests (high flaky_rate + co_failure_boost) should survive
    const selectedSuites = result.selected.map((t) => t.suite);
    expect(selectedSuites).toContain("a.test.ts"); // highest signal
  });

  it("reports skipped duration", () => {
    const result = applyTimeBudget(tests, 40);
    expect(result.skippedDurationMs).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/cli/time-budget.test.ts`
Expected: FAIL — `applyTimeBudget` not exported

- [ ] **Step 3: Implement applyTimeBudget**

Add to `src/cli/profile.ts`:

```typescript
export interface TimeBudgetResult<T> {
  selected: T[];
  skippedCount: number;
  skippedDurationMs: number;
}

interface TimeBudgetTest {
  avg_duration_ms: number;
  flaky_rate: number;
  co_failure_boost: number;
}

function testPriority(t: TimeBudgetTest): number {
  return t.flaky_rate + t.co_failure_boost;
}

/**
 * Filter tests to fit within a time budget.
 * Prioritizes tests with highest signal (flaky rate + co-failure boost).
 */
export function applyTimeBudget<T extends TimeBudgetTest>(
  tests: T[],
  maxDurationSeconds: number,
): TimeBudgetResult<T> {
  const budgetMs = maxDurationSeconds * 1000;
  const totalMs = tests.reduce((sum, t) => sum + t.avg_duration_ms, 0);

  if (totalMs <= budgetMs) {
    return { selected: tests, skippedCount: 0, skippedDurationMs: 0 };
  }

  // Sort by priority descending
  const sorted = [...tests].sort((a, b) => testPriority(b) - testPriority(a));
  const selected: T[] = [];
  let accMs = 0;

  for (const t of sorted) {
    if (accMs + t.avg_duration_ms > budgetMs && selected.length > 0) {
      continue;
    }
    selected.push(t);
    accMs += t.avg_duration_ms;
  }

  const skippedCount = tests.length - selected.length;
  const skippedDurationMs = totalMs - accMs;

  return { selected, skippedCount, skippedDurationMs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/cli/time-budget.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/profile.ts tests/cli/time-budget.test.ts
git commit -m "feat: add time-budget filtering for local profile"
```

---

### Task 6: Wire --profile into CLI (run and sample commands)

**Files:**
- Modify: `src/cli/main.ts:220-269` (SamplingCliOpts, addSamplingOptions, resolveSamplingOpts)
- Modify: `src/cli/main.ts:468-537` (sample command action)
- Modify: `src/cli/main.ts:539-698` (run command action)

- [ ] **Step 1: Add --profile option to addSamplingOptions**

In `src/cli/main.ts`, add the import at the top:

```typescript
import { detectProfileName, resolveProfile, computeAdaptivePercentage, applyTimeBudget } from "./profile.js";
```

Add to `SamplingCliOpts` interface:

```typescript
interface SamplingCliOpts {
  profile?: string;  // NEW
  strategy: string;
  // ... rest unchanged
}
```

Add to `addSamplingOptions`:

```typescript
.option("--profile <name>", "Execution profile: daily, ci, local (auto-detected if omitted)")
```

- [ ] **Step 2: Update resolveSamplingOpts to use profile resolution**

Replace `resolveSamplingOpts` with profile-aware logic. The function should:

1. Call `detectProfileName(opts.profile)` to determine profile
2. Call `resolveProfile(profileName, config.profile, config.sampling)` to get merged config
3. CLI flags still override profile values

```typescript
function resolveSamplingOpts(
  opts: SamplingCliOpts,
  config: FlakerConfig,
): ResolvedSamplingOpts & { resolvedProfile: ResolvedProfile } {
  const profileName = detectProfileName(opts.profile);
  const profile = resolveProfile(profileName, config.profile, config.sampling);

  return {
    resolvedProfile: profile,
    strategy: opts.strategy ?? profile.strategy,
    count: parseSampleCount(opts.count),
    percentage: parseSamplePercentage(opts.percentage) ?? profile.percentage,
    skipQuarantined: opts.skipQuarantined ?? profile.skip_quarantined,
    changed: opts.changed,
    coFailureDays: opts.coFailureDays ? parseInt(opts.coFailureDays, 10) : profile.co_failure_days,
    holdoutRatio: opts.holdoutRatio ? parseFloat(opts.holdoutRatio) : profile.holdout_ratio,
    modelPath: opts.modelPath ?? profile.model_path,
  };
}
```

Note: Change the callers of `resolveSamplingOpts` to pass `config` (the full FlakerConfig) instead of `config.sampling`.

- [ ] **Step 3: Add adaptive percentage to run command**

In the run command action, after resolving opts but before calling `runTests`, add:

```typescript
// Adaptive percentage adjustment
if (profile.adaptive && opts.percentage != null) {
  const kpiData = await computeKpi(store);
  const adaptive = computeAdaptivePercentage(
    kpiData.sampling.falseNegativeRate,
    {
      basePercentage: opts.percentage,
      fnrLow: profile.adaptive_fnr_low,
      fnrHigh: profile.adaptive_fnr_high,
      minPercentage: profile.adaptive_min_percentage,
      step: profile.adaptive_step,
    },
  );
  opts.percentage = adaptive.percentage;
  console.log(`# Profile: ${profile.name} (${adaptive.reason})`);
}
```

- [ ] **Step 4: Add time-budget filtering to run command**

In the run command action, after getting the run result (for "affected" mode with `max_duration_seconds`), add time-budget filtering. This requires intercepting between sample planning and test execution. The cleanest approach is to apply it in `planSample` by passing `max_duration_seconds` through:

In the run command, pass `maxDurationSeconds` to the `runTests` call:

```typescript
// For local profile with time budget, apply after affected resolution
if (profile.max_duration_seconds != null) {
  console.log(`# Time budget: ${profile.max_duration_seconds}s`);
}
```

The actual filtering happens in `sample.ts` — see Step 5.

- [ ] **Step 5: Add maxDurationSeconds to SampleOpts and apply in planSample**

In `src/cli/commands/sample.ts`, add `maxDurationSeconds?: number` to `SampleOpts`. In `planSample`, after `selectByStrategy`, apply time budget:

```typescript
// After selectByStrategy returns sampled:
if (opts.maxDurationSeconds != null) {
  const budgetResult = applyTimeBudget(sampled, opts.maxDurationSeconds);
  sampled = budgetResult.selected;
  // Include budget info in summary
}
```

- [ ] **Step 6: Print profile name in output**

At the start of both `sample` and `run` command actions, print the resolved profile:

```typescript
console.log(`# Profile: ${opts.resolvedProfile.name}`);
```

- [ ] **Step 7: Run full test suite**

Run: `pnpm exec vitest run`
Expected: All tests pass (existing tests should still work — backward compatible, no profile = fallback to [sampling])

- [ ] **Step 8: Commit**

```bash
git add src/cli/main.ts src/cli/commands/sample.ts src/cli/commands/run.ts
git commit -m "feat: wire --profile flag into run and sample commands"
```

---

### Task 7: Integration test — profile-aware run

**Files:**
- Test: `tests/cli/profile-integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
import { describe, it, expect } from "vitest";
import { detectProfileName, resolveProfile } from "../../src/cli/profile.js";
import type { ProfileConfig, SamplingConfig } from "../../src/cli/config.js";

describe("profile integration", () => {
  const sampling: SamplingConfig = {
    strategy: "hybrid",
    percentage: 30,
    holdout_ratio: 0.1,
    co_failure_days: 90,
  };

  const profiles: Record<string, ProfileConfig> = {
    daily: { strategy: "full" },
    ci: { strategy: "hybrid", percentage: 25, adaptive: true },
    local: {
      strategy: "affected",
      max_duration_seconds: 60,
      fallback_strategy: "weighted",
    },
  };

  it("daily profile runs all tests", () => {
    const p = resolveProfile("daily", profiles, sampling);
    expect(p.strategy).toBe("full");
    expect(p.percentage).toBe(100);
    expect(p.holdout_ratio).toBe(0);
  });

  it("ci profile uses adaptive with hybrid", () => {
    const p = resolveProfile("ci", profiles, sampling);
    expect(p.strategy).toBe("hybrid");
    expect(p.percentage).toBe(25);
    expect(p.adaptive).toBe(true);
    expect(p.holdout_ratio).toBe(0.1); // inherited from sampling
  });

  it("local profile uses affected with time budget", () => {
    const p = resolveProfile("local", profiles, sampling);
    expect(p.strategy).toBe("affected");
    expect(p.max_duration_seconds).toBe(60);
    expect(p.fallback_strategy).toBe("weighted");
  });

  it("unknown profile falls back to sampling config", () => {
    const p = resolveProfile("staging", profiles, sampling);
    expect(p.strategy).toBe("hybrid");
    expect(p.percentage).toBe(30);
  });

  it("end-to-end: auto-detect in non-CI env resolves to local", () => {
    const origCI = process.env.CI;
    const origGA = process.env.GITHUB_ACTIONS;
    const origFP = process.env.FLAKER_PROFILE;
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.FLAKER_PROFILE;
    try {
      const name = detectProfileName(undefined);
      const p = resolveProfile(name, profiles, sampling);
      expect(p.name).toBe("local");
      expect(p.strategy).toBe("affected");
    } finally {
      if (origCI !== undefined) process.env.CI = origCI;
      if (origGA !== undefined) process.env.GITHUB_ACTIONS = origGA;
      if (origFP !== undefined) process.env.FLAKER_PROFILE = origFP;
    }
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm exec vitest run tests/cli/profile-integration.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite for final regression check**

Run: `pnpm exec vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/cli/profile-integration.test.ts
git commit -m "test: add profile integration tests"
```

---

### Task 8: Update documentation

**Files:**
- Modify: `docs/introduce.ja.md`
- Modify: `flaker.toml` (project's own config — add profile sections as example)

- [ ] **Step 1: Add profile sections to flaker.toml**

```toml
[profile.daily]
strategy = "full"

[profile.ci]
strategy = "hybrid"
percentage = 30
holdout_ratio = 0.1
adaptive = true

[profile.local]
strategy = "affected"
max_duration_seconds = 60
fallback_strategy = "weighted"
```

- [ ] **Step 2: Update docs/introduce.ja.md**

Add a section after "設定なしで使えるか？" explaining the three profiles:

```markdown
## 実行プロファイル

flaker は実行環境に応じて自動的にテスト戦略を切り替えます。

| プロファイル | 用途 | 戦略 | 自動検出 |
|------------|------|------|---------|
| `daily` | 全テスト実行、データ蓄積 | `full` | `--profile daily` で明示指定 |
| `ci` | PR の選択的テスト | `hybrid` + adaptive | `CI=true` で自動 |
| `local` | 開発中の高速フィードバック | `affected` + 時間制約 | デフォルト |

\```bash
# 自動検出（CI なら ci、それ以外は local）
flaker run

# 明示指定
flaker run --profile daily
flaker run --profile ci
flaker run --profile local
\```
```

- [ ] **Step 3: Commit**

```bash
git add flaker.toml docs/introduce.ja.md
git commit -m "docs: add three-tier profile configuration and documentation"
```
