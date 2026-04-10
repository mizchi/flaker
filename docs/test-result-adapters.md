# Test Result Adapters

## Concepts

flaker has two types of adapters:

| Type | Config | Used by | Purpose |
|------|--------|---------|---------|
| **Test result adapter** | `[adapter]` or `--adapter` flag | `flaker collect`, `flaker import` | Parse test output files into flaker's format |
| **Runner** | `[runner]` | `flaker run` | Execute tests and return results (includes parsing) |

When you run `flaker collect`, it downloads CI artifacts and parses them with the **test result adapter**.
When you run `flaker import`, it reads a local file and parses it with the **test result adapter**.
When you run `flaker run`, it uses the **runner** to execute and parse tests — the `[adapter]` config is not used.

## Which command uses what

| Command | Input | Config used |
|---------|-------|-------------|
| `flaker collect` | GitHub Actions artifacts | `[adapter].type` + `[adapter].artifact_name` |
| `flaker import FILE --adapter TYPE` | Local file / stdin | `--adapter` flag (ignores `[adapter]` config) |
| `flaker run` | Live test execution | `[runner]` only |
| `flaker collect local` | actrun history | actrun adapter (automatic) |

## Quick Start by Language

### JavaScript/TypeScript (Vitest)

```toml
# flaker.toml
[adapter]
type = "vitest"
artifact_name = "vitest-report"

[runner]
type = "vitest"
command = "pnpm vitest"
```

```bash
# CI: generate report
pnpm vitest run --reporter=json > vitest-report.json

# Local: import manually
flaker import vitest-report.json --adapter vitest --commit $(git rev-parse HEAD)

# Local: run with sampling
flaker run
```

### Go

```toml
# flaker.toml
[adapter]
type = "gotest"
artifact_name = "go-test-report"
```

```bash
# CI: generate report
go test -json ./... > go-test-report.jsonl

# Local: import
go test -json ./... | flaker import /dev/stdin --adapter gotest --commit $(git rev-parse HEAD)
```

CI workflow snippet:
```yaml
- name: Test
  run: go test -json ./... > go-test-report.jsonl || true

- name: Upload report
  uses: actions/upload-artifact@v4
  with:
    name: go-test-report
    path: go-test-report.jsonl
```

### Rust (Cargo)

```toml
# flaker.toml
[adapter]
type = "cargo-test"
artifact_name = "cargo-test-report"
```

```bash
# CI: generate report (text format)
cargo test 2>&1 | tee cargo-test-report.txt

# Local: import
cargo test 2>&1 | flaker import /dev/stdin --adapter cargo-test --commit $(git rev-parse HEAD)
```

### Git Test Suite (TAP)

```toml
# flaker.toml
[adapter]
type = "tap"
```

```bash
# Import from test log
flaker import test-output.log --adapter tap --commit $(git rev-parse HEAD)
```

## Adapter Reference

### vitest

**Format**: JSON with `testResults[].assertionResults[]`.

```json
{
  "testResults": [{
    "name": "tests/math.test.ts",
    "assertionResults": [{
      "fullName": "math > adds numbers",
      "status": "passed",
      "duration": 42
    }]
  }]
}
```

- **Suite**: Derived from `fullName` (parts before last ` > `), falls back to file name.
- **Skip**: `status: "pending"` or `"todo"` are excluded.
- **Jest compatible**: Jest uses the same JSON format, so this adapter works for Jest too.

### playwright

**Format**: JSON with nested `suites[].specs[].tests[].results[]`.

Generate with: `pnpm playwright test --reporter=json`

### junit

**Format**: XML with `<testsuite><testcase>` elements.

```xml
<testsuite name="math" tests="2">
  <testcase name="test_add" classname="math" time="0.01"/>
  <testcase name="test_sub" classname="math" time="0.02">
    <failure message="expected 5 got 3"/>
  </testcase>
</testsuite>
```

Works with: Java (Maven/Gradle), Python (pytest `--junitxml`), .NET, and any tool that outputs JUnit XML.

### tap

**Format**: [TAP (Test Anything Protocol)](https://testanything.org/).

```
*** t0000-basic.sh ***
ok 1 - verify shell supports local
ok 2 # skip missing PREREQ
not ok 3 - this test fails
```

- **Suite**: Extracted from `*** filename ***` delimiter lines. Falls back to `"unknown"`.
- **Skip**: `ok N # skip ...` are excluded.
- **TODO**: `not ok N # TODO ...` (known breakage) are excluded.

### gotest

**Format**: NDJSON from `go test -json` (one JSON object per line).

```jsonl
{"Action":"pass","Package":"example.com/pkg","Test":"TestAdd","Elapsed":0.01}
{"Action":"fail","Package":"example.com/pkg","Test":"TestSub","Elapsed":0.02}
```

- **Suite**: `Package` field.
- **Subtests**: Supported (e.g., `TestTable/case_1`).
- **Skip**: `Action: "skip"` are excluded.
- **Package-level**: Events without `Test` field are ignored.
- **Error messages**: Collected from `Action: "output"` events.

### cargo-test

Supports both **text** and **JSON** formats. Auto-detected by checking if input starts with `{`.

**Text format** (default `cargo test` output):

```
test math::test_add ... ok
test math::test_sub ... FAILED
```

**JSON format** (`cargo test -- -Z unstable-options --format json`):

```jsonl
{"type":"test","event":"ok","name":"math::test_add","exec_time":0.001}
```

- **Suite**: Module path before last `::` (e.g., `crate::module`).
- **Skip**: `ignored` tests are excluded.
- **Error messages**: Text format extracts from `failures:` section. JSON uses `stdout` field.

### custom

User-defined command that receives test output on stdin and outputs `TestCaseResult[]` JSON.

```toml
[adapter]
type = "custom"
command = "node ./my-adapter.js"
```

The command must output a JSON array:

```json
[{
  "suite": "math",
  "testName": "adds numbers",
  "status": "passed",
  "durationMs": 42,
  "retryCount": 0
}]
```

Required fields: `suite`, `testName`, `status` (`"passed"` | `"failed"`).

## Troubleshooting

### "Imported 0 test results"

- **Wrong adapter**: Check that `--adapter` matches your test output format. A vitest JSON file won't parse with the `tap` adapter.
- **Empty file**: Verify the input file has content: `wc -l report.json`
- **Encoding**: Adapters expect UTF-8 text input.

### "Unknown adapter type: X"

Available types: `vitest`, `playwright`, `junit`, `tap`, `gotest`, `cargo-test`, `custom`.

### Debugging

Import with verbose output:

```bash
# Check how many results are parsed
flaker import report.json --adapter vitest --commit HEAD 2>&1
# Shows: "Imported N test results"
```

If 0 results, inspect your test output to verify it matches the expected format.

### `--commit` flag

`--commit` accepts a git SHA or `HEAD`. flaker resolves `HEAD` to the actual SHA via `git rev-parse`. If omitted, flaker uses the current HEAD automatically.

## Adding a New Adapter

Create `src/cli/adapters/myadapter.ts`:

```typescript
import type { TestCaseResult, TestResultAdapter } from "./types.js";

export const myAdapter: TestResultAdapter = {
  name: "myadapter",
  parse(input: string): TestCaseResult[] {
    // Parse input string → TestCaseResult[]
  },
};
```

Register in `src/cli/adapters/index.ts`:

```typescript
import { myAdapter } from "./myadapter.js";
// In switch: case "myadapter": return myAdapter;
```

Add tests in `tests/adapters/myadapter.test.ts`.
