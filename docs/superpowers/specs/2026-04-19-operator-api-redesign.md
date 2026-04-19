# flaker Operator API Redesign — Design Spec

**Date:** 2026-04-19
**Version bump target:** `0.6.0` (additive, operator-facing redesign)
**Scope:** operator-facing CLI, config surface, and documentation for `Gate / Budget / Loop / Policy`. No changes to MoonBit core logic, DuckDB schema, flaky detection formulas, or sampling algorithms.

---

## 1. Goals

- Make the operator-facing API match the public mental model:
  - `Gate`
  - `Budget`
  - `Loop`
  - `Policy`
- Keep the developer-facing surface thin:
  - `flaker doctor`
  - `flaker run --gate ...`
  - `flaker status`
- Give maintainers and CI owners a first-class read API for:
  - promotion readiness
  - demotion triggers
  - quarantine suggestions
  - weekly review artifacts
- Separate `suggest` from `apply` for any mutating policy action.
- Preserve backward compatibility for existing `[profile.*]`, `[sampling]`, and `--profile` users.

### Non-goals

- changing hybrid / affected / weighted / gbdt behavior
- changing MoonBit contract types
- removing existing categories such as `analyze`, `debug`, `dev`
- forcing immediate config migration from `0.5.x`
- redesigning the storage backend

---

## 2. Problem Statement

Today, the docs describe `Gate / Budget / Loop / Policy`, but the actual operator surface is still mostly:

- `[sampling]`
- `[profile.*]`
- `analyze kpi`
- `analyze eval`
- `analyze flaky-tag`
- `policy quarantine`

This creates four problems:

1. Operators must mentally translate from the public model back into internal implementation knobs.
2. Promotion/demotion decisions are documented, but not exposed as a first-class machine-readable command.
3. Policy commands mix read-only suggestions and mutating actions.
4. Stable operator API and advanced/internal commands are not clearly separated in the CLI.

The result is that `flaker` is conceptually simple but operationally still feels like a collection of primitives.

---

## 3. Proposed Public Surface

### 3.1 Stable top-level commands

The stable operator-facing top-level surface should be:

```text
flaker init
flaker doctor
flaker run --gate <iteration|merge|release>
flaker status
flaker gate ...
flaker ops ...
flaker quarantine ...
```

Existing category commands remain available, but they are treated as advanced/internal.

Role split:

- `status`: repo-wide KPI dashboard for everyday visibility
- `gate review`: promotion / keep / demotion decision API
- `kpi`: compatibility alias only, not part of the stable first-screen surface

### 3.2 New command groups

#### `flaker gate`

The `gate` group is the read-first operator API.

```text
flaker gate review <gate>
flaker gate explain <gate>
flaker gate history <gate>
```

Purpose:

- `review`: promotion/demotion readiness and health summary
- `explain`: why the gate is configured the way it is
- `history`: recent gate outcomes over time

#### `flaker ops`

The `ops` group is the loop-oriented orchestration surface.

```text
flaker ops daily
flaker ops weekly
flaker ops incident
```

Purpose:

- `daily`: observation loop bundle
- `weekly`: triage/review bundle
- `incident`: failure investigation bundle

This is not meant to replace every primitive command. It gives maintainers a stable entrypoint for repeatable cadence.

#### `flaker quarantine`

The `quarantine` group becomes suggest/apply oriented.

```text
flaker quarantine list
flaker quarantine suggest
flaker quarantine apply
flaker quarantine check
flaker quarantine report
```

`policy quarantine` stays as a compatibility alias in `0.6.x`, but the public docs move to `quarantine`.

---

## 4. Command Design

### 4.1 `flaker status`

Stable repo-wide KPI dashboard.

`status` is intentionally summary-only in `0.6.x`.

- it shows recent health and activity at a glance
- it does not make promote / demote decisions
- operators must use `gate review` for promotion readiness

Default scope:

- branch: `main`
- window: last `7` days

Output must include:

- run counts
- pass/fail trend
- gate-at-a-glance summary for `iteration`, `merge`, and `release` when data exists
- current quarantine counts
- pending suggestion counts when available

Exit semantics:

- `0`: dashboard rendered successfully
- non-zero: CLI / config / infra error

### 4.2 `flaker run --gate <iteration|merge|release>`

Stable execution contract for developers and CI.

#### Examples

```bash
flaker run --gate iteration
flaker run --gate merge
flaker run --gate release
```

#### Resolution contract

- `iteration -> local`
- `merge -> ci`
- `release -> scheduled`

Flag rules:

- `--gate` is the stable selector
- `--profile` remains a compatibility selector
- `--gate` and `--profile` are treated as mutually exclusive for docs and examples
- both may be accepted only when they resolve to the same backing profile
- if both are provided and resolve differently, the command fails with argument error

Resolution order:

1. explicit CLI flags
2. `[gates.*]`, `[budgets.*]`
3. legacy `[profile.*]`
4. legacy `[sampling]`
5. built-in defaults

#### Execution contract

- `run` reuses the existing test execution path and local run recording behavior
- sampled run metadata continues to be recorded in DuckDB
- existing runner artifacts remain unchanged in `0.6.x`
- this redesign does not add a second artifact format for `run`

Exit semantics:

- `0`: command executed and the selected test run passed
- `1`: command executed and the selected test run failed
- `2`: configuration or argument error, including `--gate` / `--profile` mismatch
- non-contract infra failures may use existing non-zero behavior, but should be normalized later

### 4.3 `flaker gate review <gate>`

Primary operator read API.

#### Example

```bash
flaker gate review merge
flaker gate review merge --json
flaker gate review merge --markdown --output .artifacts/gate-review.md
```

#### Output contract

The command returns:

- gate name
- backing profile
- strategy
- budget snapshot
- KPI snapshot
- promotion readiness
- demotion risk
- recommended action

Example JSON shape:

```json
{
  "gate": "merge",
  "backingProfile": "ci",
  "strategy": "hybrid",
  "budget": {
    "timeSeconds": 600,
    "samplePercentage": 25,
    "holdoutRatio": 0.1
  },
  "kpi": {
    "matchedCommits": 24,
    "falseNegativeRateRatio": 0.03,
    "passCorrelationRatio": 0.97,
    "dataConfidence": "moderate"
  },
  "promotionReadiness": {
    "status": "ready",
    "checks": [
      { "name": "matched_commits", "status": "pass", "actual": 24, "target": ">= 20" },
      { "name": "false_negative_rate", "status": "pass", "actual": 0.03, "target": "<= 0.05" },
      { "name": "pass_correlation", "status": "pass", "actual": 0.97, "target": ">= 0.95" },
      { "name": "data_confidence", "status": "pass", "actual": "moderate", "target": ">= moderate" }
    ]
  },
  "demotionRisk": {
    "status": "low",
    "reasons": []
  },
  "recommendedAction": "promote"
}
```

#### Review status model

`promotionReadiness.status` must be one of:

- `ready`: sufficient evidence to promote or keep as required
- `insufficient_data`: not enough matched history yet
- `investigate`: conflicting or unstable signals require human review
- `demote`: gate no longer meets required criteria

`recommendedAction` must be one of:

- `promote`
- `keep`
- `demote`
- `investigate`

Normative mapping:

- `ready` -> `promote` or `keep`
- `insufficient_data` -> `keep`
- `investigate` -> `investigate`
- `demote` -> `demote`

Read API semantics:

- successful evaluation returns exit code `0` even when the status is `demote`
- CLI / config / infra errors return non-zero
- automation should inspect JSON fields, not shell exit code, for promote/demote decisions

### 4.4 `flaker gate explain <gate>`

Static explanation API for resolved gate policy.

Output must include:

- resolved gate name and backing profile
- resolved strategy and fallbacks
- resolved budgets and thresholds
- whether each value came from CLI, new config, legacy config, or built-in default
- migration hints when the resolved value came from a legacy source

This command is intentionally explanatory rather than evaluative.

### 4.5 `flaker gate history <gate>`

Recent outcome timeline for a gate.

Default scope:

- branch: `main`
- window: last `14` days

Output must include:

- per-day or per-run outcome summary
- sample percentage trend
- pass/fail trend
- promotion status trend when available

`history` is a read API. Exit code is `0` on successful evaluation regardless of whether the trend is improving or degrading.

### 4.6 `flaker ops daily`

Bundles the observation loop into one read/write workflow.

#### Example

```bash
flaker ops daily
flaker ops daily --days 1 --json
flaker ops daily --markdown --output .artifacts/flaker-daily.md
```

Equivalent primitive flow:

1. `collect ci --days N`
2. `run --gate release`
3. `gate review release`
4. `quarantine suggest`

Default scope:

- branch: `main`
- window: last `1` day
- output mode: human-readable summary unless `--json` or `--markdown` is requested

Selectors:

- `--branch`
- `--days`
- `--since`
- `--until`

Output should summarize:

- collected runs/tests
- pending artifacts
- release gate health
- new quarantine suggestions
- action items

The contract is first-class: it may internally reuse primitive commands, but its output shape is stable on its own.

Execution semantics:

- `ops daily` is `execute + summary` in `0.6.x`
- it is expected to run `run --gate release` as part of the workflow
- repositories that cannot execute `release` locally should keep using primitive commands until a future summary-only mode exists

Exit semantics:

- `0`: workflow completed and the daily artifact was rendered
- `1`: embedded `run --gate release` executed and failed
- `2`: configuration or argument error

### 4.7 `flaker ops weekly`

Bundles the triage loop into one review artifact.

#### Example

```bash
flaker ops weekly
flaker ops weekly --json
flaker ops weekly --markdown --output .artifacts/flaker-weekly.md
```

Default scope:

- branch: `main`
- window: last `7` days
- comparison baseline: previous `7` days when enough data exists

Output should include:

- `merge` gate readiness
- trend deltas vs prior week
- flaky-tag suggestions
- quarantine suggestions
- promote / keep / demote recommendation

Stable JSON contract must expose these top-level keys:

- `scope`
- `mergeGate`
- `trends`
- `flakyTagSuggestions`
- `quarantineSuggestions`
- `recommendedActions`

Exit semantics:

- `0`: weekly artifact rendered successfully regardless of recommendations
- non-zero: CLI / config / infra error

### 4.8 `flaker ops incident`

Bundles incident investigation primitives.

#### Example

```bash
flaker ops incident --run 123456789
flaker ops incident --suite path/to/spec.ts --test "should redirect"
```

Internally this can call:

- `debug retry`
- `debug confirm`
- `debug diagnose`

The value is not new logic. The value is a stable operator entrypoint.

### 4.9 `flaker quarantine suggest`

Read-only policy suggestion command.

#### Example

```bash
flaker quarantine suggest
flaker quarantine suggest --json
flaker quarantine suggest --output .artifacts/quarantine-plan.json
```

Output should separate:

- add candidates
- remove candidates
- confidence
- reasons
- source scope
- generated thresholds

#### Plan schema

`quarantine suggest --json` emits a versioned plan document.

Example:

```json
{
  "version": 1,
  "generatedAt": "2026-04-19T09:00:00Z",
  "scope": {
    "branch": "main",
    "days": 7
  },
  "thresholds": {
    "flakyRateThresholdPercentage": 30,
    "minRuns": 10
  },
  "add": [
    {
      "selector": {
        "suite": "e2e/login.spec.ts",
        "test": "should redirect after login"
      },
      "reason": "flaky_rate_exceeded",
      "evidence": {
        "flakeRatePercentage": 42,
        "runs": 18
      }
    }
  ],
  "remove": []
}
```

### 4.10 `flaker quarantine apply`

Mutation command that consumes a reviewed plan.

#### Example

```bash
flaker quarantine apply --from .artifacts/quarantine-plan.json
flaker quarantine apply --from .artifacts/quarantine-plan.json --create-issues
```

This replaces today’s `policy quarantine --auto` as the recommended operator workflow.

#### Source of truth and idempotency

For `0.6.x`, `apply` writes to the existing DuckDB-backed quarantine state only.

- manifest-file outputs are out of scope for `0.6.x`
- repeating `apply` with the same plan is idempotent
- removing a non-quarantined item is a no-op
- `--create-issues` is a best-effort post-mutation side effect
- issue creation failure does not roll back quarantine state

`policy quarantine --auto` remains in `0.6.x` as a compatibility alias over the same underlying DuckDB mutation path. Public docs move to `quarantine suggest` and `quarantine apply`.

Legacy `policy quarantine` compatibility in `0.6.x`:

| Legacy behavior | `0.6.x` status | Recommended path |
|---|---|---|
| bare list | keep as compatibility alias | `flaker quarantine list` |
| `--auto` | keep as compatibility alias | `flaker quarantine suggest` + `flaker quarantine apply` |
| `--create-issues` | keep on compatibility path | `flaker quarantine apply --create-issues` |
| `--add` | keep as compatibility-only direct mutation | edit a reviewed plan, then `flaker quarantine apply` |
| `--remove` | keep as compatibility-only direct mutation | edit a reviewed plan, then `flaker quarantine apply` |

### 4.11 `flaker quarantine list|check|report`

These commands stay read-only in `0.6.x`.

- `list`: raw current quarantine entries
- `check`: validate a generated plan without mutation
- `report`: human-readable summary of current quarantine state and recent changes

`check` exit semantics:

- `0`: plan is valid and applicable
- `1`: plan is invalid or incompatible
- `2`: CLI / config / infra error

---

## 5. Config Design

### 5.1 New public config sections

`0.6.x` adds a new public shape:

```toml
[gates.iteration]
strategy = "affected"
fallback_strategy = "weighted"

[gates.merge]
strategy = "hybrid"
adaptive = true

[gates.release]
strategy = "full"

[budgets.iteration]
time_seconds = 60

[budgets.merge]
time_seconds = 600
max_false_negative_rate_ratio = 0.05
min_pass_correlation_ratio = 0.95

[budgets.release]
time_seconds = 1800

[ops.merge]
min_matched_commits = 20
min_data_confidence = "moderate"

[ops.quarantine]
auto = true
flaky_rate_threshold_percentage = 30
min_runs = 10
```

### 5.2 Stored vs derived values

Persistent operator config:

- `[gates.*]`: execution intent and strategy selection
- `[budgets.*]`: time and review thresholds
- `[ops.merge]`: persistent review thresholds used by `gate review merge`
- `[ops.quarantine]`: persistent suggestion thresholds used by `quarantine suggest`

Derived runtime values:

- `matched_commits`
- measured false negative rate
- measured pass correlation
- gate trend summaries
- quarantine suggestions themselves

`ops.merge` is not a derived report. It is persistent config consumed by review commands.

### 5.3 Compatibility behavior

Internal resolution order:

1. explicit CLI flags
2. `[gates.*]`, `[budgets.*]`, `[ops.*]`
3. legacy `[profile.*]`
4. legacy `[sampling]`
5. built-in defaults

This means:

- new repos can start with the new shape
- old repos do not break
- migration can be gradual

Field-level precedence:

- gate selection: `--gate` first, `--profile` compatibility second
- if both are present and resolve to different profiles, fail with argument error
- execution settings: new sections override mapped legacy profile values
- review thresholds with no legacy counterpart use new-section values or built-in defaults
- quarantine thresholds prefer `[ops.quarantine]`, then legacy `[quarantine]`, then built-in defaults

### 5.4 Mapping to existing config

| New public shape | Existing internal shape |
|---|---|
| `[gates.iteration]` | `[profile.local]` |
| `[gates.merge]` | `[profile.ci]` |
| `[gates.release]` | `[profile.scheduled]` |
| `[budgets.*].time_seconds` | `[profile.*].max_duration_seconds` |
| `[ops.quarantine]` | `[quarantine]` |

Fields with no legacy storage counterpart stay as new persisted config keys in `0.6.x`:

- `[budgets.merge].max_false_negative_rate_ratio`
- `[budgets.merge].min_pass_correlation_ratio`
- `[ops.merge].min_matched_commits`
- `[ops.merge].min_data_confidence`

Other fields such as `holdout_ratio`, `cluster_mode`, and `model_path` remain supported, but should be treated as advanced knobs rather than first-screen operator settings.

---

## 6. CLI Help and Documentation Rules

### 6.1 Stable vs advanced classification

Root help should explicitly separate:

- stable user/operator commands
- advanced/internal commands

Proposed root help buckets:

```text
Everyday:
  init
  doctor
  run
  status

Operator:
  gate
  ops
  quarantine

Advanced:
  collect
  import
  report
  analyze
  debug
  policy
  dev
  setup
  exec
```

`kpi` may remain as a compatibility alias, but it should not appear in the stable root buckets.

### 6.2 Documentation entrypoints

- `usage-guide`: developer-facing daily usage
- `operations-guide`: operator mental model and cadence
- `how-to-use`: detailed command reference
- `migration-0.5-to-0.6`: config and CLI migration

The docs should stop telling operators to manually compose `analyze eval + analyze flaky-tag + policy quarantine` as the first-class workflow once `gate/ops/quarantine` are available.

---

## 7. Rollout Plan

### Phase 1A: Read-only operator API

Ship:

- `flaker gate review`
- `flaker gate explain`
- `flaker gate history`
- `flaker quarantine suggest`

Keep:

- `analyze eval`
- `analyze flaky-tag`
- `policy quarantine`

No breaking changes. This phase establishes the stable read contracts first.

### Phase 1B: Reviewed mutation and loop wrappers

Ship:

- `flaker quarantine apply`
- `flaker ops daily`
- `flaker ops weekly`
- `flaker ops incident`

Dependency:

- plan schema for `quarantine suggest`
- idempotent `apply`
- documented DuckDB write target

### Phase 2: New config shape

Ship:

- `[gates.*]`
- `[budgets.*]`
- `[ops.*]`

Keep old config shape working.

Add `flaker config migrate --write` only if the new shape proves stable enough.

### Phase 3: Documentation demotion

Move legacy/internal commands out of the first-screen docs.

Do not remove them yet.

### Phase 4: Optional cleanup (`0.7+`)

If adoption is good:

- de-emphasize `[profile.*]` in generated examples
- keep `--profile` as advanced escape hatch
- possibly deprecate `policy quarantine --auto`

---

## 8. Acceptance Criteria

This redesign is successful only if the following contracts are testable:

1. `flaker gate review merge --json` returns a stable JSON object containing:
   - `gate`
   - `backingProfile`
   - `budget`
   - `kpi`
   - `promotionReadiness.status`
   - `recommendedAction`
2. `flaker run --gate merge --profile ci` succeeds, and `flaker run --gate merge --profile local` fails with argument error.
3. `flaker quarantine suggest --json` emits a versioned plan with `version`, `scope`, `thresholds`, `add`, and `remove`.
4. `flaker quarantine apply --from <plan>` is idempotent against the same plan and mutates DuckDB quarantine state only.
5. `flaker status` remains summary-only and does not expose promote / demote decisions.
6. `flaker ops weekly --json` returns a stable artifact containing:
   - gate readiness
   - trend deltas
   - quarantine suggestions
   - recommended actions
7. Existing `0.5.x` repositories continue to work unchanged with `[profile.*]`, `[sampling]`, and `--profile`.
8. New docs can teach `Gate / Budget / Loop / Policy` without requiring operators to learn `[profile.*]` first.

---

## 9. Open Questions

1. Should `flaker gate review` include release-specific product performance metrics, or should that remain connector-specific?
2. Should `ops daily/weekly` support repository-specific custom sections, or stay fixed and portable across repos?
3. Should `status` eventually evolve into a multi-gate summary, while `gate review` remains the decision API?
