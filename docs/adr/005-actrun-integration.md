# ADR-005: actrun 統合によるローカル CI フィードバックループ

**日付:** 2026-03-31
**ステータス:** Accepted

## コンテキスト

flaky test の検出精度はデータ量に依存する。GitHub Actions の結果だけでは collect のタイミングが限られ、データが不足しがち。ローカルでのテスト実行結果も蓄積できればデータ収集速度が上がる。

actrun (mizchi/actrun) は GitHub Actions 互換のローカルランナーで、`--retry` による失敗箇所リトライと `--json` による構造化出力をサポートしている。

## 決定

actrun を metrici に深く統合し、ローカル実行結果の自動取り込みを実現する。

## CLI integration (as of 0.10.0)

Three ways actrun-collected results flow into flaker:

1. **`flaker apply`** runs `collect_ci` as part of the reconcile plan (`src/cli/categories/apply.ts`), which ingests GitHub Actions artifacts when `GITHUB_TOKEN` is set.
2. **`flaker run --runner actrun`** executes the workflow locally via actrun and records the run (`src/cli/runners/actrun.ts`).
3. **`flaker import <file>`** ingests an arbitrary report file produced by any actrun-invoked workflow (adapter auto-detected from extension).

The earlier `metrici collect-local` entry point was absorbed into the `collect_local` action function (`src/cli/commands/collect/local.ts`), callable internally but not a CLI verb.

## 根拠

- actrun の JSON 出力は GitHub Actions API と互換性のあるフィールド名 (`conclusion`, `headSha`, `status`) を使っており、WorkflowRun へのマッピングが自然
- `--retry` でローカルから失敗テストだけを再実行し、その結果も蓄積できる
- CI を通さずにローカルで flaky テストの再現確認 → データ蓄積 → 分析のサイクルが回る

## 結果

- ローカル実行のたびにデータが蓄積され、eval の health score が改善していく
- CI と ローカルの両方のデータが 1 つの DuckDB に統合される
- `metrici bisect` がローカル実行結果も含めて分析可能
