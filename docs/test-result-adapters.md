# Test Result Adapters

flaker can import test results from various test frameworks. Each adapter parses a specific output format into flaker's internal `TestCaseResult` structure.

## Usage

```bash
# Import from a file
flaker import report.json --adapter vitest --commit $(git rev-parse HEAD)

# Import from stdin
go test -json ./... | flaker import /dev/stdin --adapter gotest --commit HEAD

# In flaker.toml
[adapter]
type = "vitest"           # or "gotest", "cargo-test", "tap", etc.
artifact_name = "test-report"
```

## Adapters

### vitest

Parses Vitest/Jest JSON reporter output.

```bash
pnpm vitest run --reporter=json > report.json
flaker import report.json --adapter vitest
```

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

**Suite**: Derived from `fullName` (parts before last ` > `), falls back to file name.
**Skip**: `status: "pending"` or `"todo"` are excluded.

---

### playwright

Parses Playwright Test JSON reporter output.

```bash
pnpm playwright test --reporter=json > report.json
flaker import report.json --adapter playwright
```

**Format**: JSON with nested `suites[].specs[].tests[].results[]`.

---

### junit

Parses JUnit XML format (used by Java, pytest, many CI tools).

```bash
pytest --junitxml=report.xml
flaker import report.xml --adapter junit
```

**Format**: XML with `<testsuite><testcase>` elements.

```xml
<testsuite name="math" tests="2">
  <testcase name="test_add" classname="math" time="0.01"/>
  <testcase name="test_sub" classname="math" time="0.02">
    <failure message="expected 5 got 3"/>
  </testcase>
</testsuite>
```

---

### tap

Parses [TAP (Test Anything Protocol)](https://testanything.org/) output. Used by git test framework, Perl's `prove`, and many shell-based test suites.

```bash
make test 2>&1 | flaker import /dev/stdin --adapter tap
```

**Format**:

```
*** t0000-basic.sh ***
ok 1 - verify shell supports local
ok 2 # skip missing PREREQ
not ok 3 - this test fails
*** t0001-init.sh ***
ok 1 - plain init
```

**Suite**: Extracted from `*** filename ***` delimiter lines.
**Skip**: `ok N # skip ...` lines are excluded.
**TODO**: `not ok N # TODO ...` (known breakage) are excluded.

---

### gotest

Parses `go test -json` NDJSON output.

```bash
go test -json ./... > report.jsonl
flaker import report.jsonl --adapter gotest
```

**Format**: One JSON object per line (NDJSON).

```jsonl
{"Action":"run","Package":"example.com/pkg","Test":"TestAdd"}
{"Action":"pass","Package":"example.com/pkg","Test":"TestAdd","Elapsed":0.01}
{"Action":"fail","Package":"example.com/pkg","Test":"TestSub","Elapsed":0.02}
{"Action":"pass","Package":"example.com/pkg","Elapsed":0.03}
```

**Suite**: `Package` field.
**Test name**: `Test` field (supports subtests like `TestTable/case_1`).
**Skip**: `Action: "skip"` events are excluded.
**Package-level**: Events without `Test` field are ignored (only per-test results).
**Error messages**: Collected from `Action: "output"` events for failed tests.

---

### cargo-test

Parses Rust's `cargo test` output. Supports both text and JSON formats.

**Text format** (default):

```bash
cargo test 2>&1 | flaker import /dev/stdin --adapter cargo-test
```

```
running 3 tests
test math::test_add ... ok
test math::test_sub ... FAILED
test math::test_mul ... ok

failures:
---- math::test_sub stdout ----
thread 'math::test_sub' panicked at 'assertion failed'
```

**JSON format** (unstable):

```bash
cargo test -- -Z unstable-options --format json > report.jsonl
flaker import report.jsonl --adapter cargo-test
```

```jsonl
{"type":"test","event":"ok","name":"math::test_add","exec_time":0.001}
{"type":"test","event":"failed","name":"math::test_sub","exec_time":0.002}
```

**Suite**: Module path before last `::` (e.g., `crate::module`).
**Skip**: `ignored` tests are excluded.
**Error messages**: Extracted from `failures:` section (text) or `stdout` field (JSON).
**Auto-detect**: The adapter detects JSON vs text format automatically.

---

### custom

User-defined adapter that pipes test results through a command.

```toml
[adapter]
type = "custom"
command = "node ./my-adapter.js"
```

The command receives raw test output on stdin and must output a JSON array of `TestCaseResult`:

```json
[
  {
    "suite": "math",
    "testName": "adds numbers",
    "status": "passed",
    "durationMs": 42,
    "retryCount": 0
  }
]
```

Required fields: `suite`, `testName`, `status` (`"passed"` | `"failed"`).

## Adding a New Adapter

1. Create `src/cli/adapters/myadapter.ts` implementing `TestResultAdapter`
2. Register in `src/cli/adapters/index.ts`
3. Add tests in `tests/adapters/myadapter.test.ts`

```typescript
import type { TestCaseResult, TestResultAdapter } from "./types.js";

export const myAdapter: TestResultAdapter = {
  name: "myadapter",
  parse(input: string): TestCaseResult[] {
    // Parse input string → TestCaseResult[]
  },
};
```
