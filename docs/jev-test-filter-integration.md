# Using flaker with jev-test-filter

[jev-test-filter](https://github.com/mizchi/jev-test-filter) picks the tests a change needs by asking a model about each test against the diff. It sees one change at a time. flaker keeps what jev cannot see: which tests really failed on which commits, which are flaky or quarantined, and whether jev's past selections missed a failure. This guide connects the two so that each full run checks jev's choices and tunes its gate.

[日本語](jev-test-filter-integration.ja.md)

## Who owns what

| | jev-test-filter | flaker |
|---|---|---|
| Decides | which tests run for one change | nothing about a selection |
| Writes | a run record per commit (`.jev-test-filter/records/<head_sha>.json`) | the test database (`[storage].path`, `.flaker/data` by default) |
| Reads | the diff, the test files, and flaker's `jev-context` | jev's run records, and your full runs |
| Gate values | uses them; a command-line flag always wins | suggests them from evidence (`gate_calibration`) |

flaker never runs jev and never calls a model. Calibration replays stored answers offline through jev's own gate code, which flaker bundles.

## Requirements

- flaker 0.14.0 or later, and jev-test-filter 0.1.3 or later (`pnpm add -D jev-test-filter`). jev needs `TYPESAFE_API_KEY` to ask its questions; without it, it runs every test and writes no record, so there is nothing for flaker to import.
- Full runs on some of the commits jev scored. A full run is one where the whole suite ran. flaker only compares jev's choices on a commit that also has a full run, because only a full run proves what failed. Tell flaker which runs are full with `[workflow_lanes]`, or let it infer them from the test count (see [`runs.is_full`](how-to-use.md#workflow_lanes-and-runsis_full)).
- The results of those full runs in flaker, stored under the commit they ran on. `flaker import --ci` does this. A report imported by hand needs `--commit <sha>`, otherwise it is stored under a local id that matches no commit, and a lane marked `full = true` in `[workflow_lanes]` (or a `--workflow-name`, so its size can be compared with that workflow's other runs): `flaker import report.json --commit $(git rev-parse HEAD) --lane full-batch`.
- For hints, the files each commit changed. `flaker import --ci` and `flaker run` record them; `flaker import <report>` does not. Without them the context has a gate and `skip`, but no per-test hints.

## Setup

`flaker.toml`:

```toml
[selector]
type = "jev"
recall_target = 0.90     # recall needed before calibration lets jev select fewer tests
min_failures = 20        # real failures needed before that
max_hinted_tests = 200   # cap on per-test hints in the context

[workflow_lanes]
"ci.yml" = "sampled"
"nightly.yml" = { lane = "full-batch", full = true }
```

The gate values themselves (`cutoff`, `unsure_below`, `unsure_margin`) are not set here, and flaker rejects a `[selector]` section that sets one. They live in the database, where calibration appends them.

`.gitignore`:

```
.jev-test-filter/
```

## The loop

```bash
# 1. Before selecting: hand jev the current context
flaker export --projection jev-context -o .flaker/context.json

# 2. Select and run (writes .jev-test-filter/records/<head_sha>.json)
jev-test-filter --base main --context .flaker/context.json --exec -- vitest run

# 3. Store jev's decisions
flaker import .jev-test-filter --adapter jev

# 4. Store full runs on the same commits
flaker import --ci

# 5. Compare and tune the gate
flaker calibrate --selector
```

Steps 1–3 run for every change. Steps 4–5 need a full run on at least one of the commits jev scored; until then `calibrate --selector` keeps the gate and says `no selector record has a full run on its head commit yet`. Calibration looks at the last 90 days of records; change that with `--window-days`.

The order of 3 and 4 does not matter. A jev test that flaker has not seen yet is stored without a test key and is matched on the next selector import, or by `calibrate --selector`, once its results are in.

### In CI

The flaker database has to outlive a single job, because calibration compares records and full runs from many commits. Keep it where your CI keeps state between runs (a cache, an artifact restored at the start of the next run, or a scheduled job on a persistent runner).

jev and flaker usually run in different jobs. Carry the two files between them as artifacts:

- the job that runs jev needs `.flaker/context.json` from the job that holds the flaker database;
- the job that holds the flaker database needs `.jev-test-filter/records/` from the job that ran jev.

A record is named after its commit, so records from many runs can be collected into one directory and imported at once. Importing a record that is already stored is a no-op.

`--base main` needs the base branch in the checkout. A shallow clone (the `actions/checkout` default) does not have it: use `fetch-depth: 0` and `--base origin/main`.

For `flaker import --ci`, the full-run workflow has to upload its report as an artifact, and `[adapter].artifact_name` has to match that artifact's name. Only the `playwright`, `junit`, `vrt-*` and `custom` adapters have their own default name; for `vitest`, set it explicitly, and write the report with `vitest run --reporter=json --outputFile=report.json`. The job that runs `import --ci` needs a token that can read Actions (`permissions: actions: read`).

`flaker apply` does not run this loop: it neither imports selector records nor runs `calibrate --selector`. Run the selector steps yourself, after `flaker apply` if you use it (apply already runs `import --ci`).

#### Put jev and a full run on the same commits

Calibration learns only from commits that have both a jev record and a full run. A PR job scores the PR head, while a nightly full run tests main's latest commit, so the two rarely share a commit and `calibrate --selector` keeps the gate indefinitely. Pick one layout:

- **jev on main.** On every push to main, run jev with `--base` set to the previous commit (`${{ github.event.before }}`; it is all zeros on the first push of a branch, so fall back to `HEAD~1`), and run the full suite on the same commit in the same workflow. Upload only the full-suite report as the full lane's artifact. The tests jev selected are a partial run, and counted as full they would make every unselected test look like it passed.
- **A full run after jev on some PRs.** In the PR job, run jev's selection first, then the rest of the suite on the same checkout, and import the result as a full lane. Doing this on a sample of PRs keeps the cost down.

A complete workflow for the "jev on main" layout is in [`examples/github-actions/jev-loop.yml`](../examples/github-actions/jev-loop.yml). It keeps the database in the Actions cache (restored by prefix at the start, saved under a new key at the end, with a weekly run so the cache does not expire), serializes runs with a `concurrency` group because DuckDB has one writer, resolves `--base` from `github.event.before` with the `HEAD~1` fallback, uploads only the full-suite report, and then runs `import --adapter jev`, `import --ci`, `calibrate --selector` and, at the next run's start, `export --projection jev-context`. `import --ci` reads only completed runs, so a push's full run is imported by the next run.

`flaker calibrate --selector --dry-run --json` shows whether the layout works: `without_full_run` counts records with no full run on their commit, and `decision.real_failures` is the evidence gathered so far.

## What the context changes in jev

`jev-context` v1 has three parts:

- `gate`: the latest calibrated `cutoff`, `unsure_below` and `unsure_margin`, with the evidence behind them. jev uses them as its defaults, and a flag still overrides them. Before the first calibration the gate is `null`, and jev keeps its own defaults.
- `skip`: tests quarantined in flaker. jev does not ask about them and does not select them, even when the diff touches them, and reports them with `reason: "quarantined"`.
- `tests`: hints for tests with a history. For each one, up to five files it has failed together with (at least two co-failures) and `missed`, the number of commits on which jev left it out and it failed. jev adds one sentence naming those files to that test's question, for example `This test previously failed when src/cli/config.ts or src/cli/main.ts changed.` `missed` is recorded but never shown to the model. Flaky and quarantined tests get no hints.

Tests are matched by file and title path, and by Playwright project when one is given; the line number is never used, since it moves with every edit above the test. `digest` covers `skip` and `tests` only. jev stores it in each run record, so runs are compared only under the same hints, and a new gate alone does not change it.

## How calibration decides

`flaker calibrate --selector` takes, for each commit, the latest real jev record that has a full run on the same commit. The failures that count are the tests that failed in that full run, minus flaky and quarantined tests. A failure of a test that jev's record itself quarantined is not counted as jev's miss; it is reported separately.

It then replays every record under a grid of gate values and applies one rule: tighten at once, loosen with care.

- If the current gate missed a failure, it moves right away to a gate that selects everything the current one selects and misses fewer; among those, the fewest misses, then the fewest selected tests. If no gate in the grid misses fewer, the gate is kept and the misses are reported, since selecting more would not catch them.
- It selects fewer tests only when nothing was missed, there are at least `min_failures` real failures, and the Wilson 95% lower bound of recall reaches `recall_target`. With every failure caught, that bound is n / (n + 3.84), so the default 0.90 needs 35 real failures before the first loosening.

Every run appends one row to `gate_calibration` with its `rationale`. `--dry-run` appends nothing, and `--json` prints the full result.

## Checking the results

```bash
# What jev left out that then failed
flaker query "SELECT test_key, head_sha, reason, changed_files FROM flaker_v1.misses LIMIT 20"

# The current gate and why
flaker query "SELECT * FROM flaker_v1.gate_calibration ORDER BY calibrated_at DESC LIMIT 1"

# What calibration would do now, without writing
flaker calibrate --selector --dry-run --json
```

The datasets are listed in [flaker_v1](how-to-use.md#flaker-export--public-datasets-flaker_v1). Other selectors can use the same loop by writing `selector-record` v1 and importing with `--adapter selector-record`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `calibrate --selector` keeps with "no selector record has a full run on its head commit yet" | No full run on any commit jev scored. Check `flaker_v1.runs.is_full` and `[workflow_lanes]`. |
| Many tests in `unmatched` | These are full-run failures that no verdict in jev's record names: the file path or title differs between jev and your reporter, or jev did not find the test. Compare `flaker_v1.tests.file` / `title_path` with the record's `tests`. |
| `flaker import --adapter jev` finds no records | jev writes a record only when its run completed. A run that fell back to running everything (no API key, an API error) writes none. flaker also skips a record whose `fallback` is set, which only a hand-made or older record has. |
| jev exits 2 on `--context` | The file is not a version 1 context, or does not validate. Regenerate it with the same flaker version. |
| A new gate did not change `context_digest` in jev's records | Expected: the digest covers hints and `skip`, not the gate. |
