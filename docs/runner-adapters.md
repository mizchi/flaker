# Runner Adapters

flaker はテストランナーごとの違いを吸収する Runner Adapter を提供します。テストケースの個別実行、一覧取得、結果パースを統一的に扱えます。

## 組み込みアダプタ

### Vitest

```toml
[runner]
type = "vitest"
command = "pnpm vitest"    # デフォルト
```

| 操作 | 実行されるコマンド |
|------|------------------|
| テスト実行 | `pnpm vitest run -t "testA\|testB" --reporter json` |
| テスト一覧 | `pnpm vitest --list --reporter json` |

結果パース: Vitest JSON reporter の `testResults[].assertionResults[]` からステータス・所要時間・エラーメッセージを抽出。

### Playwright Test

```toml
[runner]
type = "playwright"
command = "pnpm exec playwright test"    # デフォルト
```

| 操作 | 実行されるコマンド |
|------|------------------|
| テスト実行 | `pnpm exec playwright test --grep "testA\|testB" --reporter json` |
| テスト一覧 | `pnpm exec playwright test --list --reporter json` |

結果パース: Playwright JSON reporter の `suites[].specs[].tests[].results[]` から retry 検出を含むステータスを抽出。`retry_count > 0 && 最終 pass` のテストは `flaky` ステータスとして記録。

### Moon Test (MoonBit)

```toml
[runner]
type = "moontest"
command = "moon test"    # デフォルト
```

| 操作 | 実行されるコマンド |
|------|------------------|
| テスト実行 | `moon test --filter "pkg::testA\|pkg::testB"` |
| テスト一覧 | `moon test --dry-run` |

結果パース: stdout の `test <name> ... ok/FAILED` パターンをパース。パッケージパスをスイート名、テスト関数名をテスト名として分離。

## カスタムアダプタ

任意のテストランナーを JSON プロトコルで接続できます。

```toml
[runner]
type = "custom"
execute = "node ./my-runner.js execute"
list = "node ./my-runner.js list"
```

### プロトコル仕様

#### `execute` コマンド

flaker が stdin に JSON を送り、stdout から JSON を受け取ります。

**stdin:**

```json
{
  "tests": [
    { "suite": "tests/login.spec.ts", "testName": "should redirect" },
    { "suite": "tests/home.spec.ts", "testName": "should load" }
  ],
  "opts": {
    "cwd": "/path/to/project",
    "timeout": 30000,
    "retries": 0,
    "env": { "NODE_ENV": "test" }
  }
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `tests` | `TestId[]` | 実行するテスト一覧 |
| `tests[].suite` | `string` | ファイルパスまたはスイート名 |
| `tests[].testName` | `string` | テストケース名 |
| `opts.cwd` | `string?` | 作業ディレクトリ |
| `opts.timeout` | `number?` | タイムアウト（ミリ秒） |
| `opts.retries` | `number?` | リトライ回数 |
| `opts.env` | `object?` | 追加の環境変数 |

**stdout:**

```json
{
  "exitCode": 1,
  "results": [
    {
      "suite": "tests/login.spec.ts",
      "testName": "should redirect",
      "status": "passed",
      "durationMs": 1200,
      "retryCount": 0
    },
    {
      "suite": "tests/home.spec.ts",
      "testName": "should load",
      "status": "failed",
      "durationMs": 5000,
      "retryCount": 0,
      "errorMessage": "Timeout waiting for element"
    }
  ],
  "durationMs": 6200,
  "stdout": "...",
  "stderr": "..."
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `exitCode` | `number` | プロセス終了コード（0 = 全 pass） |
| `results` | `TestCaseResult[]` | 各テストの結果 |
| `results[].status` | `string` | `"passed"` / `"failed"` / `"skipped"` / `"flaky"` |
| `results[].durationMs` | `number` | 実行時間（ミリ秒） |
| `results[].retryCount` | `number` | リトライ回数（0 = リトライなし） |
| `results[].errorMessage` | `string?` | エラーメッセージ（失敗時） |
| `results[].variant` | `object?` | 実行環境の情報（`{"os": "linux", "browser": "chromium"}` 等） |
| `durationMs` | `number` | 全体の実行時間 |
| `stdout` | `string` | 標準出力（ログ用） |
| `stderr` | `string` | 標準エラー出力 |

#### `list` コマンド

引数なしで実行され、stdout に TestId の JSON 配列を返します。

**stdout:**

```json
[
  { "suite": "tests/login.spec.ts", "testName": "should redirect" },
  { "suite": "tests/login.spec.ts", "testName": "should display form" },
  { "suite": "tests/home.spec.ts", "testName": "should load" }
]
```

### カスタムアダプタの実装例

#### Node.js

```javascript
#!/usr/bin/env node
import { execSync } from "node:child_process";

const mode = process.argv[2]; // "execute" or "list"

if (mode === "list") {
  // テスト一覧を返す
  const tests = [
    { suite: "tests/math.test.ts", testName: "add" },
    { suite: "tests/math.test.ts", testName: "multiply" },
  ];
  console.log(JSON.stringify(tests));
} else if (mode === "execute") {
  // stdin から実行対象を読む
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const { tests, opts } = JSON.parse(input);

  const results = [];
  const start = Date.now();

  for (const test of tests) {
    const cmd = `npx vitest run -t "${test.testName}" ${test.suite}`;
    try {
      execSync(cmd, { cwd: opts?.cwd, timeout: opts?.timeout });
      results.push({ ...test, status: "passed", durationMs: 0, retryCount: 0 });
    } catch (e) {
      results.push({
        ...test, status: "failed", durationMs: 0, retryCount: 0,
        errorMessage: e.stderr?.toString() ?? "Unknown error",
      });
    }
  }

  console.log(JSON.stringify({
    exitCode: results.some(r => r.status === "failed") ? 1 : 0,
    results,
    durationMs: Date.now() - start,
    stdout: "",
    stderr: "",
  }));
}
```

#### Python

```python
#!/usr/bin/env python3
import json, sys, subprocess, time

mode = sys.argv[1]  # "execute" or "list"

if mode == "list":
    tests = [
        {"suite": "tests/test_math.py", "testName": "test_add"},
        {"suite": "tests/test_math.py", "testName": "test_multiply"},
    ]
    print(json.dumps(tests))

elif mode == "execute":
    data = json.load(sys.stdin)
    tests = data["tests"]
    results = []
    start = time.time()

    for t in tests:
        cmd = f"pytest {t['suite']}::{t['testName']} -x"
        proc = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        results.append({
            "suite": t["suite"],
            "testName": t["testName"],
            "status": "passed" if proc.returncode == 0 else "failed",
            "durationMs": 0,
            "retryCount": 0,
            "errorMessage": proc.stderr if proc.returncode != 0 else None,
        })

    print(json.dumps({
        "exitCode": 1 if any(r["status"] == "failed" for r in results) else 0,
        "results": results,
        "durationMs": int((time.time() - start) * 1000),
        "stdout": "",
        "stderr": "",
    }))
```

#### Shell Script

```bash
#!/bin/bash
# my-runner.sh execute|list

if [ "$1" = "list" ]; then
  echo '[{"suite":"tests/test.sh","testName":"test_basic"}]'
elif [ "$1" = "execute" ]; then
  INPUT=$(cat)
  # ... run tests based on $INPUT ...
  echo '{"exitCode":0,"results":[],"durationMs":0,"stdout":"","stderr":""}'
fi
```

## TestId の設計

`TestId` はテストケースを一意に識別するための言語中立な構造です。

```typescript
interface TestId {
  suite: string;      // ファイルパスまたはスイート名
  testName: string;   // テストケース名
}
```

| ランナー | suite の例 | testName の例 |
|---------|-----------|---------------|
| Vitest | `tests/math.test.ts` | `add returns sum` |
| Playwright | `tests/login.spec.ts` | `should redirect after login` |
| MoonBit | `mizchi/pkg/module` | `test_add` |
| pytest | `tests/test_math.py` | `test_add` |
| Go | `./pkg/math` | `TestAdd` |

`suite` と `testName` の組み合わせでテストケースを一意に特定します。同じテスト名が異なるスイートに存在しても区別できます。

## 実行モデル: バッチとオーケストレーション

テスト数が多い場合、flaker のオーケストレーターがランナーの特性に応じて実行を最適化します。

### Runner Capabilities

各ランナーは自分の並列化能力を宣言します:

| ランナー | `nativeParallel` | `maxBatchSize` | 動作 |
|---------|-----------------|---------------|------|
| Vitest | `true` | - | flaker は全テストを 1 回の execute で渡す。vitest が `--pool=threads` で内部並列化 |
| Playwright | `true` | - | flaker は全テストを 1 回の execute で渡す。playwright が `--workers` で内部並列化 |
| MoonBit | `false` | 50 | flaker が 50 件ずつバッチ分割して実行 |
| Custom | `false` | - | flaker がバッチ分割して実行 |

### 実行オプション

```bash
# Vitest: 4 workers で並列実行（ランナー内部の並列化）
flaker run --strategy hybrid --count 100 --workers 4

# MoonBit: 50件ずつ 2 並列でバッチ実行（flaker がシャード）
flaker run --strategy random --count 200 --concurrency 2

# バッチサイズを明示的に指定
flaker run --strategy weighted --count 100 --batch-size 25 --concurrency 4
```

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `--workers N` | ランナー内部の並列ワーカー数（`nativeParallel: true` のランナーに渡される） | ランナーのデフォルト |
| `--concurrency N` | flaker がバッチを並列実行する数 | 1（シーケンシャル） |
| `--batch-size N` | 1 回の execute に渡すテスト数の上限 | ランナーの `maxBatchSize` または全件 |

### 動作フロー

```
flaker run --count 100 --concurrency 2 --batch-size 30

nativeParallel = true の場合:
  → execute(100 tests, { workers })      ※1回で全部渡す
  → ランナーが内部で並列実行

nativeParallel = false, maxBatchSize = 30 の場合:
  → batch 1: execute(tests[0:30])  ─┐
  → batch 2: execute(tests[30:60]) ─┤ 並列 (concurrency=2)
                                     ↓ 完了待ち
  → batch 3: execute(tests[60:90]) ─┐
  → batch 4: execute(tests[90:100])─┤ 並列
                                     ↓
  → 結果をマージ
```

### crater (Playwright + BiDi) での注意

crater の Playwright テストは BiDi サーバーを共有するため `workers: 1` が必須です。flaker 側でのシャーディング（`--concurrency`）も使えません:

```toml
# crater の flaker.toml
[runner]
type = "playwright"
command = "pnpm exec playwright test"
# workers, concurrency は指定しない（デフォルト = シーケンシャル）
```

### カスタムアダプタでの capabilities 宣言

カスタムアダプタの場合、設定で capabilities を宣言できます:

```toml
[runner]
type = "custom"
execute = "node ./my-runner.js execute"
list = "node ./my-runner.js list"
native_parallel = true      # ランナーが内部で並列化する場合
max_batch_size = 100         # 1回の execute の上限
```

## flaker との統合フロー

```
flaker run --dry-run --strategy hybrid --count 20
  → TestId[] を出力

flaker run --strategy hybrid --count 20
  → run --dry-run で TestId[] を選択
  → orchestrate(runner, TestId[], opts) で実行戦略を決定
  → RunnerAdapter.execute() を適切にバッチ/並列実行
  → ExecuteResult.results を DB に自動格納
  → flaker analyze eval で健全性評価
```

Runner Adapter の結果は自動的に flaker の DuckDB に格納されるため、実行するたびにデータが蓄積され、flaky 検出・トレンド分析・bisect の精度が向上します。
