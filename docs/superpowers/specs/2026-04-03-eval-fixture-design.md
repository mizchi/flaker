# Evaluation Fixture Framework Design

## Goal

Co-failure tracking (Stage 1) の精度を定量的に測定するための合成フィクスチャジェネレータと評価パイプラインを構築する。

## Architecture

合成データを DuckDB に投入し、既存の `planSample` を各戦略で実行、結果を confusion matrix で比較する。新規コマンド `flaker eval-fixture` として提供。

## Data Generation

### Parameters

```typescript
interface FixtureConfig {
  testCount: number;           // テスト数 (100 / 500 / 1000)
  commitCount: number;         // コミット数 (50 / 100 / 200)
  flakyRate: number;           // フレーキー率 (0.05 / 0.10 / 0.20)
  coFailureStrength: number;   // co-failure 相関強度 (0.0-1.0)
  filesPerCommit: number;      // コミットあたりの変更ファイル数 (1-5)
  testsPerFile: number;        // ファイルあたりの関連テスト数 (3-10)
  samplePercentage: number;    // サンプリング率 (10 / 20 / 50)
  seed: number;                // 再現用シード
}
```

### Generation Logic

1. **テスト一覧生成**: `tests/module_{i}/test_{j}.spec.ts` (testCount 個)
2. **ファイル一覧生成**: `src/module_{i}.ts` (testCount / testsPerFile 個)
3. **依存マップ作成**: 各ファイルに `testsPerFile` 個のテストを紐付け (ground truth)
4. **フレーキーテスト選定**: `testCount * flakyRate` 個のテストをフレーキーとしてマーク
5. **各 commit の生成**:
   - ランダムに `filesPerCommit` 個のファイルを選択 → `commit_changes`
   - 各テストの失敗判定:
     - 変更ファイルに依存するテスト: `coFailureStrength` の確率で失敗
     - フレーキーテスト: `flakyRate` の確率で追加失敗
     - それ以外: 常に pass
   - `workflow_runs` + `test_results` に記録

### Deterministic Seeding

全てのランダム判定は seed ベースの LCG で行い、同一パラメータで同一結果を保証する。

## Evaluation Pipeline

### Process

1. In-memory DuckDB にフィクスチャデータを投入
2. 最後の N commits を「評価対象」として分離（train/test split 的）
3. 各評価 commit について:
   - `changed_files` を取得
   - 各戦略で `planSample` を実行（samplePercentage で件数決定）
   - サンプリング結果と実際の CI 結果を比較
4. 全 commit の結果を集計

### Compared Strategies

| Strategy | Description |
|----------|-------------|
| `random` | Baseline: ランダムサンプリング |
| `weighted` | flaky_rate のみの重み付け |
| `weighted+co-failure` | flaky_rate + co_failure_boost |

### Metrics

- **Recall**: 実際に失敗したテストのうち、サンプリングで選択された割合
- **Precision**: サンプリングで選択されたテストのうち、実際に失敗した割合
- **F1 Score**: Recall と Precision の調和平均
- **False Negative Rate**: サンプリングで漏れた失敗テストの割合
- **Sample Ratio**: 全テストに対する選択率
- **Efficiency**: Recall / Sample Ratio (1.0 超なら random より良い)

### Output Format

```
# Evaluation Report

Config: tests=500, commits=100, flaky=10%, co-failure=0.8, sample=20%

| Strategy            | Recall | Precision | F1    | FNR   | Sample% | Efficiency |
|---------------------|--------|-----------|-------|-------|---------|------------|
| random              | 20.0%  | 5.0%      | 0.08  | 80.0% | 20.0%   | 1.00       |
| weighted            | 35.0%  | 8.0%      | 0.13  | 65.0% | 20.0%   | 1.75       |
| weighted+co-failure | 72.0%  | 15.0%     | 0.25  | 28.0% | 20.0%   | 3.60       |
```

## File Structure

- `src/cli/eval/fixture-generator.ts` — データ生成ロジック (pure, no I/O)
- `src/cli/eval/fixture-evaluator.ts` — 評価パイプライン
- `src/cli/eval/fixture-report.ts` — レポートフォーマット
- `tests/eval/fixture-generator.test.ts` — ジェネレータのユニットテスト
- `tests/eval/fixture-evaluator.test.ts` — 評価パイプラインの統合テスト

## CLI

```bash
# デフォルトパラメータで実行
flaker eval-fixture

# パラメータ指定
flaker eval-fixture --tests 500 --commits 100 --flaky-rate 0.1 --co-failure-strength 0.8 --sample-percentage 20

# 複数パラメータセットを sweep
flaker eval-fixture --sweep
```

`--sweep` は co-failure-strength を 0.0, 0.25, 0.5, 0.75, 1.0 で変化させて比較テーブルを出力。
