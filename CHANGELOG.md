# Changelog

## 0.7.0-next.0 (prerelease)

### Deprecated (removed in 0.8.0)

All listed below still work; they now emit a stderr warning pointing at
the 0.7.0 canonical replacement.

| Deprecated | Canonical replacement |
|---|---|
| `flaker setup init` | `flaker init` |
| `flaker exec run` / `flaker exec affected` | `flaker run` / `flaker run --gate iteration --changed <paths>` |
| `flaker ops daily` | `flaker apply` |
| `flaker collect ci / local / coverage / commit-changes / calibrate` | `flaker apply` |
| `flaker quarantine suggest / apply` | `flaker apply` |
| `flaker policy quarantine / check / report` | `flaker apply` |
| `flaker gate review / history / explain` | `flaker status --gate <name> [--detail]` |
| `flaker analyze kpi` | `flaker status` |
| `flaker analyze eval` | `flaker status --markdown` |
| `flaker analyze flaky` | `flaker status --list flaky` |
| `flaker analyze flaky-tag` | `flaker apply` |
| `flaker analyze reason / insights / cluster / bundle / context` | `flaker explain <topic>` |
| `flaker analyze query` | `flaker query <sql>` |
| `flaker import report / parquet` | `flaker import <file>` (auto-detect) |
| `flaker report summary / diff / aggregate` | `flaker report <file> --summary \| --diff <base> \| --aggregate <dir>` |
| `flaker debug doctor` | `flaker doctor` |

### New

- `flaker plan` / `flaker apply` (declarative reconciler; shipped in 0.6.0)
- `flaker status` gained `--markdown`, `--list flaky|quarantined`, `--detail`, `--gate <name>`
- `flaker query <sql>` top-level
- `flaker explain <topic>` umbrella for AI-assisted analysis
- `flaker import <file>` auto-detects adapter from extension
- `flaker report <file>` uses `--summary` / `--diff` / `--aggregate` flags
- `[promotion]` config section with documented defaults
- `[promotion].data_confidence_min` validated against the `low|moderate|high` enum

### Changed

- `flaker --help` reorganized into three tiers: Primary (11), Advanced, Deprecated
- Primary command surface reduced from 53 to 11 user-facing entries (hidden `dev *` subtree retained)

### Fixed

- `flaker apply` now aborts cleanly when `GITHUB_TOKEN` is missing (previously `process.exit(1)` bypassed the executor's abort handler)
- `probeRepo.hasLocalHistory` now queries `workflow_runs` instead of being hardcoded `false`

## [0.5.0](https://github.com/mizchi/flaker/compare/flaker-v0.4.0...flaker-v0.5.0) (2026-04-18)

### Migration guide

Upgrading from `0.4.x` does **not** require a `flaker.toml` rename.
The main change is the recommended user-facing CLI surface:

- prefer `flaker run --gate iteration|merge|release` over profile-oriented examples
- prefer `flaker doctor` over `flaker debug doctor`
- prefer `flaker status` over `flaker analyze kpi` for the default dashboard

Existing profile-based configs and commands remain supported:

- `profile.local`, `profile.ci`, `profile.scheduled` still work
- `flaker run --profile ...` is still supported for advanced and custom setups
- existing category commands under `analyze`, `debug`, `policy`, and `dev` are unchanged

For a practical migration checklist, see:

- [docs/migration-0.4-to-0.5.ja.md](docs/migration-0.4-to-0.5.ja.md)
- [docs/migration-0.4-to-0.5.md](docs/migration-0.4-to-0.5.md)

### Highlights

- gate-oriented daily workflow: `flaker run --gate iteration`, `flaker doctor`, `flaker status`
- docs are split by audience: usage vs operations
- management guidance is now explicit for advisory/required gates, quarantine, and staged E2E/VRT rollout

### Compatibility notes

- no config-key migration is required from `0.4.x`
- this is a conceptual UX migration, not a hard CLI break like `0.2.0`
- if you already use custom profiles in CI, you can keep them and adopt gates gradually in docs and scripts

### Features

* add --skip-quarantined option to sample and run commands ([90046f1](https://github.com/mizchi/flaker/commit/90046f101999774b3ee6f934e8198b816fa0d6d2))
* add `flaker reason` command for rule-based flaky test analysis ([a591d9e](https://github.com/mizchi/flaker/commit/a591d9e2af82305afcbeb6c788adb2af14ed9113))
* add `metrici eval` command for test suite health evaluation ([fb20dbc](https://github.com/mizchi/flaker/commit/fb20dbc862d25a3814b49e9d86240cfa7c1e493b))
* add `metrici import` command for local test report ingestion ([aca2fd1](https://github.com/mizchi/flaker/commit/aca2fd133ca9ff0044852cb789b900f24c702be9))
* add ActrunRunner with --runner and --retry flags for run command ([8606385](https://github.com/mizchi/flaker/commit/860638519ae6bfb3ba02cefcbdbe7180d9166055))
* add alpha auto-tuning for co-failure boost ([#28](https://github.com/mizchi/flaker/issues/28)) ([e682c01](https://github.com/mizchi/flaker/commit/e682c01ddc701e1419756a7ab68f90761a0cd769))
* add bisect command to find commit range where a test became flaky ([dffa796](https://github.com/mizchi/flaker/commit/dffa796e132163a1f64a0ad93bbbf174b07cff9b))
* add co-failure priority tier to hybrid sampling ([#25](https://github.com/mizchi/flaker/issues/25)) ([61c10a9](https://github.com/mizchi/flaker/commit/61c10a99565953cce0d99b37d1f2dfe084157e7f))
* add co-failure tracking for ML-based test selection (Stage 1) ([#23](https://github.com/mizchi/flaker/issues/23)) ([7be9dcc](https://github.com/mizchi/flaker/commit/7be9dccec21c189a4c05cd9379486c5b08d0bce3))
* add coverage-guided sampling with greedy set cover ([#30](https://github.com/mizchi/flaker/issues/30)) ([833c8d5](https://github.com/mizchi/flaker/commit/833c8d591411ec19b73bd864f9d1cb43f1565595))
* add custom adapter for external command parsing ([c31ea10](https://github.com/mizchi/flaker/commit/c31ea1035c9fcb1fdd3e4b5719a8357c9014653e))
* add DeFlaker-inspired true flaky detection ([cf89889](https://github.com/mizchi/flaker/commit/cf89889752d520e7bc7b42c3c0d6964d65f031b4))
* add eval-fixture command for sampling strategy evaluation ([#24](https://github.com/mizchi/flaker/issues/24)) ([f7d6cfb](https://github.com/mizchi/flaker/commit/f7d6cfb4794dd322f394bdd9f501b03664493eb1))
* add flaker context command for LLM-assisted strategy selection ([#32](https://github.com/mizchi/flaker/issues/32)) ([bef4447](https://github.com/mizchi/flaker/commit/bef44475d76d81187f7685ff9fb8467c0983ce99))
* add flaker-confirm workflow template and init generation ([73775d2](https://github.com/mizchi/flaker/commit/73775d223f07134217f7940781797ff7afd5a2b1))
* add flaky trend query and --trend flag for weekly flaky rate tracking ([87d53b0](https://github.com/mizchi/flaker/commit/87d53b05d9dfc562e4eebdda0c3e050559747a74))
* add GBDT model — 90% recall without dependency resolver ([#31](https://github.com/mizchi/flaker/issues/31)) ([6b3a834](https://github.com/mizchi/flaker/commit/6b3a8340b677a1b74a76ea488726ce9f0c3b8bd2))
* add generic dependency graph system with ecosystem adapters ([f26a2ad](https://github.com/mizchi/flaker/commit/f26a2ad51ad72633eb4d1366b5527ce31961f7ec))
* add holdout FNR metric and multi-parameter sweep to eval-fixture ([de508a6](https://github.com/mizchi/flaker/commit/de508a6f1e07007650854f496faabf6f74bc4138))
* add holdout sampling, GBDT strategy, train command, and refactor ([75ad178](https://github.com/mizchi/flaker/commit/75ad1780ec7629f06b0c6363ab8121a711ff2412))
* add hybrid sampling strategy combining affected, failed, new, and weighted random ([17182ca](https://github.com/mizchi/flaker/commit/17182cae2cfe333637994a561bd6a6d3d8e7cfd0))
* add hybrid+co-failure strategy to eval-fixture ([#27](https://github.com/mizchi/flaker/issues/27)) ([5a02cc0](https://github.com/mizchi/flaker/commit/5a02cc0c4ed37a7c3862c57e6a519ab365eeabae))
* add JUnit XML adapter for parsing test reports ([1c92162](https://github.com/mizchi/flaker/commit/1c921626bc6e959c98c707f994a206b2b39015e8))
* add language-neutral runner adapter system ([49af2ec](https://github.com/mizchi/flaker/commit/49af2ecece666a46c2984bc58f41542f0d6a29c9))
* add Parquet export/import and auto-export on collect ([#26](https://github.com/mizchi/flaker/issues/26)) ([eea4488](https://github.com/mizchi/flaker/commit/eea44886b068328f16c45603fac973023e9e5bf9))
* add retry mechanism with flaky test detection ([2984d83](https://github.com/mizchi/flaker/commit/2984d83a5954bb15da11e4e10e496d1f25912043))
* add runner adapter system for language-neutral test execution ([da3d8f8](https://github.com/mizchi/flaker/commit/da3d8f8d12fb82049f61eebf6fc491df072ce757))
* add runner capabilities and orchestrator for parallel execution ([bc895d9](https://github.com/mizchi/flaker/commit/bc895d989edf376357f9a6936038da5801f4f824))
* add self-eval command for validating recommendation logic ([e0d085c](https://github.com/mizchi/flaker/commit/e0d085cb16eb10aa83584e662fcd589e364e1786))
* add self-eval command with isolated scenario evaluation ([ccb2651](https://github.com/mizchi/flaker/commit/ccb2651a191dcc16ac83c538979053de7d0676cf))
* add variant-specific flaky analysis ([e0a2841](https://github.com/mizchi/flaker/commit/e0a28414bf6674acd7bad5e98c3c238fd5171389))
* add vitest adapter and dogfooding setup ([4e9f0e3](https://github.com/mizchi/flaker/commit/4e9f0e325b2f5313c32e9571d474d55173f8e22c))
* add workspace and moon auto-discovery dependency resolvers ([db5c015](https://github.com/mizchi/flaker/commit/db5c01588e48dcbc717edf396930b5b6a5f52801))
* auto-extract Playwright/JUnit reports from actrun artifacts + E2E flow test ([76a5e2e](https://github.com/mizchi/flaker/commit/76a5e2eb537741140946753d6b089d76020bbd1e))
* calibrate — broken vs flaky classification, data confidence, --explain ([f533ca7](https://github.com/mizchi/flaker/commit/f533ca75f478bfca54d41aa033510fbf9761dec4))
* calibrate command, insights, auto-detect config, eval improvements ([56f0253](https://github.com/mizchi/flaker/commit/56f02539f5d3a4c657427139af2f4e83652414ae))
* co-failure window sensitivity analysis ([e3c17b7](https://github.com/mizchi/flaker/commit/e3c17b75728c12f5d275264efa3b14cc49581a24))
* co-failure window sensitivity analysis ([37704db](https://github.com/mizchi/flaker/commit/37704db15ed62c8434e2507ead1b493e7841af29))
* consistent broken/flaky distinction across all commands ([4b1ef47](https://github.com/mizchi/flaker/commit/4b1ef47ad42c9c3298af5bd8a6d93cae6011c300))
* coverage-guided sampling and diagnose command ([7ca022c](https://github.com/mizchi/flaker/commit/7ca022c617f354b23be57568056ef0af1fde1d61))
* coverage-guided sampling and diagnose command ([fdc1011](https://github.com/mizchi/flaker/commit/fdc1011bf1d37964b08a6d20968b3e9685ec617e))
* data staleness warning in KPI dashboard ([e52258a](https://github.com/mizchi/flaker/commit/e52258a0404963624f4ae24a50c1a707632fa3f0))
* deep actrun integration with auto-import and collect-local ([078b5e1](https://github.com/mizchi/flaker/commit/078b5e1b6017535169714b6cba7fc6fd09d4c44c))
* deep actrun integration with auto-import and collect-local command ([9ed0241](https://github.com/mizchi/flaker/commit/9ed0241b10f7750f881acf488d01001c5e06cbee))
* execute holdout tests in flaker run command ([257073b](https://github.com/mizchi/flaker/commit/257073b943c9fb846759155323e849ec3976f9f1))
* flaker kpi — KPI dashboard for sampling, flaky tracking, data quality ([b994ec3](https://github.com/mizchi/flaker/commit/b994ec31ad374a73703a2108d246749c32a4398d))
* Go test and cargo test adapters ([e2c424b](https://github.com/mizchi/flaker/commit/e2c424b23d842c5b74c072eb5a214ff7413b7792))
* integrate bitflow as MoonBit library for native affected resolution ([194329e](https://github.com/mizchi/flaker/commit/194329e4e7ec4ba1a6ef23d5c5f955ab76a534f8))
* KPI confusion matrix — FP, FN, recall, pass correlation, skipped time ([7752750](https://github.com/mizchi/flaker/commit/775275052016bae553a41fb8822872c99820809f))
* MoonBit native CLI for flaker (collect command prototype) ([51e9b1d](https://github.com/mizchi/flaker/commit/51e9b1d6553346dcf259beede5ddd500b3427583))
* native CLI collect writes workflow runs to DuckDB ([3db8bc2](https://github.com/mizchi/flaker/commit/3db8bc2fa0ae20237a818ee8c32c93c56fd96b85))
* native CLI flaky + sample commands ([ba556a7](https://github.com/mizchi/flaker/commit/ba556a7460ed66beade7312ce2e1739db1fa4559))
* native CLI production-ready — collect + calibrate ([9b17f09](https://github.com/mizchi/flaker/commit/9b17f09cbcc71a781ec3a1a6307bd965036201f2))
* native collect downloads artifacts, vitest JSON parser ([cebc6b7](https://github.com/mizchi/flaker/commit/cebc6b7b925e5ac1dc00a65edf312914dcad63b3))
* native collect E2E working — ZIP extraction + vitest parse + DuckDB ([84a57ee](https://github.com/mizchi/flaker/commit/84a57ee68e8df4cab2917816b1b04d685fc81e4f))
* port GBDT to MoonBit (Stage 2 ML migration) ([#33](https://github.com/mizchi/flaker/issues/33)) ([857a413](https://github.com/mizchi/flaker/commit/857a41347ba88f20be4ed0c78b0bf7fb89a932c1))
* standalone native binary build script ([2ca7358](https://github.com/mizchi/flaker/commit/2ca7358bba1bc3422326366b223a62407e09a6f4))
* TAP adapter for git test framework output ([aa1a10e](https://github.com/mizchi/flaker/commit/aa1a10ebcaf5f4d6de13410a7b9e14a60fc2c991))
* wire config-based resolver selection in CLI + fix bitflow Starlark syntax ([80ad70c](https://github.com/mizchi/flaker/commit/80ad70c376efcdaf5d1bf8de2cb6aefd0bb9eae9))
* ZIP extraction with mizchi/zlib, vitest artifact pipeline ([20e0e79](https://github.com/mizchi/flaker/commit/20e0e79697134ea56998ca3c100e7c96a7ecbd72))


### Bug Fixes

* add co_failure_boost to MoonBit test fixtures, set version 0.0.1 ([4bc11ea](https://github.com/mizchi/flaker/commit/4bc11ea19767f134d2e7e791d2a5b8aa05364d65))
* add type parameters to store.raw() calls in calibrate.ts ([a748b62](https://github.com/mizchi/flaker/commit/a748b62e584b78d6c841d1dc06246ec9905a72a9))
* add wasm-gc target stub and prepare for mooncakes 0.0.1 ([315fd54](https://github.com/mizchi/flaker/commit/315fd54c47b26d7f180049b7bac2938eece073c1))
* align TS fallback flaky_rate formula with MoonBit core ([fef8063](https://github.com/mizchi/flaker/commit/fef80636a88d07d9d4bac18ac5f759a8e8bfaf88))
* CLI UX improvements from subagent evaluation (3 rounds) ([#29](https://github.com/mizchi/flaker/issues/29)) ([ebbfd0d](https://github.com/mizchi/flaker/commit/ebbfd0df04003a43acb188f8bbe3d76467474732))
* collect commit_changes via GitHub API instead of local git ([4d766f2](https://github.com/mizchi/flaker/commit/4d766f2bac6d472466185805d414e1cf92f27669))
* exclude holdout tests from confusion matrix, label skipped time as estimate ([385ff06](https://github.com/mizchi/flaker/commit/385ff0609be477cb1006f7416daec94c6050a34e))
* flaky broken/flaky split, explain top tests, classification threshold ([d46a149](https://github.com/mizchi/flaker/commit/d46a149467985f3529fcae0c26d34a950ab63bd6))
* include 'flaky' status in flaky rate calculation ([ef9e10d](https://github.com/mizchi/flaker/commit/ef9e10d6e34318f44baa464170a216fff38c85c2))
* KPI dashboard improvements from evaluation round 4 ([2b6ef03](https://github.com/mizchi/flaker/commit/2b6ef03d4d8005f8284a1d9dd12c092eeb4c3b25))
* remove incorrect *100 multiplier on quarantine threshold ([b13cd94](https://github.com/mizchi/flaker/commit/b13cd94189ff29caaaf910a94a1b8ccbca1d10f2))
* resolve 110 MoonBit deprecation warnings ([51e92e5](https://github.com/mizchi/flaker/commit/51e92e5d2ec7dbd97b1bc5bc05293064c54c9c65))
* unify flaky definitions across all commands ([29e0183](https://github.com/mizchi/flaker/commit/29e0183d069a612d24fff732d5202f8aa7cd8b0d))
* update true-flaky test for retry-flaky rename ([5d7557a](https://github.com/mizchi/flaker/commit/5d7557a18baba783ba358ce2dbbf84dc185634ba))


### Miscellaneous Chores

* trigger release-please 0.5.0 ([7714a53](https://github.com/mizchi/flaker/commit/7714a532dca266ecf45838d38c310a5358fd45db))

## 0.3.0 — 2026-04-10

Republishes the 0.2.0 CLI redesign under a new minor version so that downstream releases (npm `@mizchi/flaker`, mooncakes `mizchi/flaker`) track the same semver. No functional changes relative to 0.2.0; see the 0.2.0 entry below for the full breaking-change list.

## 0.2.0 — 2026-04-10

### Breaking changes

This release restructures the CLI into a two-level category hierarchy, merges `sample` into `run --dry-run`, and renames config keys to follow a suffix-per-unit convention. There is no backward compatibility layer. Configs and scripts must be updated before upgrading.

See the [redesign spec](docs/superpowers/specs/2026-04-10-flaker-cli-redesign-design.md) for the full rationale and the [config migration section](docs/how-to-use.md#config-migration) for the `flaker.toml` rename map.

#### Removed commands

- `flaker sample` — use `flaker run --dry-run` (add `--explain` for selection reasons).

#### Renamed commands

| Old | New |
|---|---|
| `flaker collect` | `flaker collect ci` (alias `flaker collect` preserved) |
| `flaker collect-local` | `flaker collect local` |
| `flaker collect-coverage` | `flaker collect coverage` |
| `flaker collect-commit-changes` | `flaker collect commit-changes` |
| `flaker calibrate` | `flaker collect calibrate` |
| `flaker import <file>` | `flaker import report <file>` |
| `flaker import-parquet <dir>` | `flaker import parquet <dir>` |
| `flaker affected` | `flaker exec affected` |
| `flaker report summarize` | `flaker report summary` |
| `flaker flaky` | `flaker analyze flaky` |
| `flaker reason` | `flaker analyze reason` |
| `flaker insights` | `flaker analyze insights` |
| `flaker eval` | `flaker analyze eval` |
| `flaker context` | `flaker analyze context` |
| `flaker query` | `flaker analyze query` |
| `flaker diagnose` | `flaker debug diagnose` |
| `flaker bisect` | `flaker debug bisect` |
| `flaker confirm` | `flaker debug confirm` |
| `flaker retry` | `flaker debug retry` |
| `flaker doctor` | `flaker debug doctor` |
| `flaker quarantine` | `flaker policy quarantine` |
| `flaker check` | `flaker policy check` |
| `flaker train` | `flaker dev train` |
| `flaker tune` | `flaker dev tune` |
| `flaker self-eval` | `flaker dev self-eval` |
| `flaker eval-fixture` | `flaker dev eval-fixture` |
| `flaker eval-co-failure-window` | `flaker dev eval-co-failure` |
| `flaker test-key` | `flaker dev test-key` |

Top-level aliases preserved: `flaker init`, `flaker run`, `flaker kpi`, `flaker collect`.

#### Renamed flags

- `flaker collect ci --last <days>` → `--days <n>`

#### Renamed config keys

| Section | Old | New | Unit |
|---|---|---|---|
| `[sampling]` | `percentage` | `sample_percentage` | 0–100 |
| `[sampling]` | `co_failure_days` | `co_failure_window_days` | days |
| `[sampling]` | `detected_flaky_rate` | `detected_flaky_rate_ratio` | 0.0–1.0 |
| `[sampling]` | `detected_co_failure_strength` | `detected_co_failure_strength_ratio` | 0.0–1.0 |
| `[flaky]` | `detection_threshold` | `detection_threshold_ratio` | 0.0–1.0 |
| `[quarantine]` | `flaky_rate_threshold` | `flaky_rate_threshold_percentage` | 0–100 |
| `[profile.*]` | `percentage` | `sample_percentage` | 0–100 |
| `[profile.*]` | `co_failure_days` | `co_failure_window_days` | days |
| `[profile.*]` | `adaptive_fnr_low` | `adaptive_fnr_low_ratio` | 0.0–1.0 |
| `[profile.*]` | `adaptive_fnr_high` | `adaptive_fnr_high_ratio` | 0.0–1.0 |

The CLI refuses to start on legacy configs and prints migration hints pointing at [docs/how-to-use.md#config-migration](docs/how-to-use.md#config-migration).

`flaky_rate_threshold_percentage` is now taken literally as a percentage — previous silent auto-conversion from a 0–1 ratio is gone. If your old config had `flaky_rate_threshold = 0.3`, rename to `flaky_rate_threshold_percentage = 30`.

#### New `debug confirm` exit codes

| Code | Verdict | Meaning |
|---|---|---|
| 0 | TRANSIENT | Not reproducible |
| 1 | FLAKY | Intermittent |
| 2 | BROKEN | Regression reproduced |
| 3 | ERROR | Runner or config failure |

### New features

- `flaker run --dry-run` — preview selection without executing.
- `flaker run --explain` — print per-test selection tier, score, and reason.
- `flaker setup init --adapter <type> --runner <type>` — generate populated `[adapter]` and `[runner]` sections in the created `flaker.toml`. Valid adapters: `playwright`, `vitest`, `jest`, `junit`. Valid runners: `vitest`, `playwright`, `jest`, `actrun`.
- `flaker debug confirm --json` — machine-readable verdict output.
- `flaker analyze query` now has three example queries in `--help`.
- `flaker debug doctor` and `flaker policy check` validate config value ranges.
- Top-level `--help` is organized into Getting started, Daily workflow, and nine category sections.
- Vitest is configured with a 60s global timeout and a 4-worker fork cap to stabilize DuckDB + MoonBit core tests.

### Internal

- `src/cli/main.ts` shrunk from 2076 lines to ~200 lines. Category registration lives under `src/cli/categories/`.
- Every command handler lives under `src/cli/commands/<category>/<name>.ts`.
- The MoonBit parquet fixture test is now invoked automatically by the vitest global setup, removing a hidden cross-language test dependency.
