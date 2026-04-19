# ADR-003: ランナーアダプタとオーケストレーションモデル

**日付:** 2026-03-31
**ステータス:** Accepted

## コンテキスト

metrici がサンプリングしたテストを実行する際、テストランナーごとに CLI 構文、並列化能力、結果フォーマットが異なる。また、テスト数が多い場合のスループット最適化が必要。

## 決定

### ランナーアダプタ

テスト実行を `RunnerAdapter` インターフェースで抽象化する。

```typescript
interface RunnerAdapter {
  name: string;
  capabilities: RunnerCapabilities;
  execute(tests: TestId[], opts?: ExecuteOpts): Promise<ExecuteResult>;
  listTests(opts?: ExecuteOpts): Promise<TestId[]>;
}
```

組み込みアダプタ:

| ランナー | execute | list | capabilities |
|---------|---------|------|-------------|
| Vitest | `vitest run -t "pattern" --reporter json` | `vitest --list --reporter json` | `nativeParallel: true` |
| Playwright | `playwright test --grep "pattern" --reporter json` | `playwright test --list --reporter json` | `nativeParallel: true` |
| `moontest` | `moon test --filter "pkg::test"` | `moon test --dry-run` | `nativeParallel: false, maxBatchSize: 50` |
| `actrun` | GitHub Actions-compatible local runner; invoked via `--runner actrun` and wraps the configured actrun workflow. Entry-point: `src/cli/runners/actrun.ts`. | — | `nativeParallel: false` |
| Custom | JSON stdin/stdout プロトコル | JSON stdout | 設定による |

### カスタムアダプタプロトコル

外部コマンドと JSON over stdin/stdout で通信:
- `execute`: stdin に `{ tests: TestId[], opts }` → stdout に `ExecuteResult`
- `list`: stdout に `TestId[]`

言語非依存。Node.js, Python, Shell, Go 等どれでも実装可能。

### オーケストレーションモデル

ランナーが `capabilities` を宣言し、`orchestrate()` が実行戦略を決定:

```
nativeParallel = true の場合:
  → 全テストを 1 回の execute で渡す
  → opts.workers でランナー内部の並列度をヒント

nativeParallel = false の場合:
  → metrici が batchSize で分割
  → concurrency 数だけ並列に execute を呼ぶ
  → 結果をマージ
```

```
metrici run --count 100 --concurrency 4 --batch-size 25

nativeParallel=false の場合:
  batch 1 (25 tests) ─┐
  batch 2 (25 tests) ─┤ 並列 4
  batch 3 (25 tests) ─┤
  batch 4 (25 tests) ─┘
  → 結果マージ
```

## 根拠

### なぜランナーに並列化を委譲するか

- Vitest はスレッドプールで高速並列実行。metrici がプロセス分割すると各プロセスで初期化コストが重複する
- Playwright は worker isolation が組み込み。`--workers` で制御するのが最適
- 逆に moon test やカスタムランナーは native 並列化がないので、metrici 側でシャーディングする方が効率的

### crater (Playwright + BiDi) の制約

crater は BiDi サーバーを共有するため `workers: 1` 必須。metrici 側のシャーディング (`--concurrency`) も使えない。`capabilities.nativeParallel = true` だが `workers` 未指定でランナーのデフォルト (serial) に従う。

### カスタムプロトコルを JSON にした理由

- 言語非依存（Python, Go, Rust, Shell で実装可能）
- デバッグが容易（stdin/stdout を直接確認可能）
- 型情報は TypeScript 側の interface で定義、ドキュメントで公開

## 結果

- `metrici.toml` の `[runner] type` で切り替え
- 新しいテストランナーのサポートは `RunnerAdapter` の実装追加のみ
- カスタムランナーは外部スクリプト 1 つで接続可能
