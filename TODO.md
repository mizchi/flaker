# TODO

## 進行中
- [x] DuckDB のネイティブバイナリが無い環境で CLI が即死しないよう、`duckdb` 初期化を遅延ロード + エラーメッセージ改善する
- [x] `resolveAffectedFallback` のパーサを複数行 `task(...)` 定義に対応させる
- [x] `resolveAffectedFallback` の glob 解釈を MoonBit 実装仕様と突き合わせる（差分テスト追加）

## 次のマイルストーン
- [x] `flaker doctor` コマンドを追加し、DuckDB/MoonBit の実行環境チェックを 1 コマンドで確認可能にする
- [x] CI で「MoonBit あり / なし」の 2 パターンを回し、フォールバック経路を常時検証する

## crater 由来機能の整理と MoonBit 移行

### 分類軸

- `core-contract`
  - MoonBit/TS 間で受け渡す JSON 契約と canonical 型
  - 例: graph IR, report diff/aggregate input, quarantine match input

- `core-reducer`
  - I/O を持たない pure な集計・分類・伝播ロジック
  - MoonBit 化の最優先対象

- `core-policy`
  - reducer に近いが、match 条件や mode 判定などの規約ロジックを含むもの
  - quarantine / ownership / KPI 判定系

- `hybrid-explain`
  - resolver 固有理由や CLI 向け説明オブジェクトを返す層
  - 判定の一部は MoonBit 化できるが、最終整形は TS に残す

- `shell-integration`
  - adapter, filesystem, artifact import/export, markdown rendering, CLI
  - TS を正本に維持する

### 分類 A: MoonBit core に寄せる pure logic

- [x] graph analyzer / dependency traversal
  - 元ネタ: crater dogfood 全般 + ADR-006
  - 細分類:
    - `core-contract`: `GraphNodeInput`, `DependencyGraphInput`
    - `core-reducer`: affected expansion / reverse deps / topo sort / test pattern 収集
  - 対応コード:
    - `src/cli/graph/analyzer.ts`
    - `src/core/analysis/graph/`
  - 方針:
    - affected expansion / reverse deps / topo sort / test pattern 収集は MoonBit を正本にする
    - adapter は TS に残し、IR を MoonBit core に渡す

- [x] normalized summary / diff / aggregate core
  - 元 issue: #6, #7
  - 細分類:
    - `core-contract`: report summary/diff/aggregate input/output
    - `core-reducer`: summary reduction, diff classifier, aggregate totals/unstable reducer
    - `shell-integration`: artifact read/write, directory walk, markdown/json rendering
  - 対応コード:
    - `src/cli/reporting/playwright-report-summary-core.ts`
    - `src/cli/reporting/playwright-report-diff-core.ts`
    - `src/cli/reporting/flaker-batch-summary-core.ts`
    - `src/cli/commands/report.ts`
  - 方針:
    - summary reduction と base/head diff、aggregate totals は MoonBit 候補
    - artifact I/O と markdown rendering は TS に残す
  - 進捗:
    - `report summary` の reducer は `src/core/reporting/summary/` に移行済み
    - `report diff` の classifier は `src/core/reporting/diff/` に移行済み
    - `report aggregate` の totals / unstable reducer は `src/core/reporting/aggregate/` に移行済み

- [x] quarantine policy evaluation core
  - 元 issue: #5, #9
  - 細分類:
    - `core-contract`: `task/spec/titlePattern/variant/mode` の match input
    - `core-policy`: skip / allow_flaky / allow_failure の判定
    - `shell-integration`: manifest parse, runtime hook, report annotation
  - 対応コード:
    - `src/cli/runners/quarantine-runtime.ts`
    - `src/cli/reporting/flaker-quarantine-match.ts`
    - `src/cli/reporting/flaker-quarantine-expiry.ts`
  - 方針:
    - `task/spec/titlePattern/variant` に対する match と mode 判定は MoonBit 候補
    - manifest parse と runtime glue は TS に残す
  - 進捗:
    - `flaker-quarantine-summary-core` の ownership / expiry / mode-scope reducer は `src/core/policy/quarantine/` に移行済み
    - runtime match (`task/spec/titlePattern`) は `src/core/policy/quarantine/` に移行済み
    - blocking exit などの mode decision は `src/core/policy/quarantine/` に移行済み

- [x] config ownership analysis core
  - 元 issue: #4
  - 細分類:
    - `core-contract`: task/spec/filter ownership input
    - `core-policy`: duplicate ownership / split ownership / unmanaged spec 判定
    - `shell-integration`: filesystem scan, runner inventory, report rendering
  - 対応コード:
    - `src/cli/commands/check.ts`
  - 方針:
    - duplicate ownership / split ownership / unmanaged spec の判定ロジックは MoonBit 候補
    - filesystem scan と runner/listTests は TS に残す
  - 進捗:
    - duplicate ownership / split ownership / unmanaged spec / task summary reducer は `src/core/policy/config/` に移行済み
    - filesystem scan と bitflow task definition 読み込み、report formatting は TS shell を維持

### 分類 B: hybrid のまま進める機能

- [x] affected explain / inspect
  - 元 issue: #3
  - 細分類:
    - `core-reducer`: direct/transitive selection 判定
    - `hybrid-explain`: match reason, includedBy, unmatched 理由
    - `shell-integration`: JSON/Markdown 出力
  - 対応コード:
    - `src/cli/commands/affected.ts`
    - `src/cli/resolvers/*`
  - 方針:
    - direct / transitive selection の判定は MoonBit 化可能
    - resolver 固有の match reason と JSON/Markdown 出力は TS shell を維持
  - 進捗:
    - direct / transitive selection reducer と target dedupe は `src/core/analysis/affected_explain/` に移行済み
    - resolver 固有の match reason と JSON/Markdown 出力は TS shell を維持

- [x] stable test identity
  - 元 issue: #8
  - 細分類:
    - `core-contract`: stable ID canonical input
    - `hybrid-explain`: adapter ごとの identity source 正規化
    - `shell-integration`: storage mapper, adapter bridge
  - 対応コード:
    - `src/cli/identity.ts`
    - `src/cli/storage/test-result-mapper.ts`
  - 方針:
    - adapter 境界の正規化は TS 維持
    - 将来的に stable ID の canonical hash/normalization は MoonBit 化を検討
  - 進捗:
    - stable test id の canonical string 生成と normalized field 解決は `src/core/analysis/identity/` に移行済み
    - adapter 境界の source 正規化と storage bridge は TS shell を維持

- [x] eval / KPI aggregation
  - crater dogfood で追加された predictive KPI を含む
  - 細分類:
    - `core-contract`: commit/local/ci comparison input
    - `core-reducer`: confusion matrix, conditional pass/fail rate, sample ratio
    - `shell-integration`: DB query, CLI formatting
  - 対応コード:
    - `src/cli/commands/eval.ts`
  - 方針:
    - commit 単位の集計や confusion matrix は pure logic なので MoonBit 候補
    - DB query と CLI formatting は TS に残す
  - 進捗:
    - sampling KPI の commit matching / confusion matrix / conditional rate / sample ratio reducer は `src/core/metrics/eval/` に移行済み
    - DB query と health score / markdown formatting は TS shell を維持

### 分類 C: TS shell に残す

- [ ] adapter / artifact ingestion
  - `src/cli/adapters/*`
  - `src/cli/commands/import.ts`
  - `src/cli/commands/collect.ts`
  - `src/cli/commands/collect-local.ts`

- [ ] manifest / report parse / markdown rendering
  - `src/cli/quarantine-manifest.ts`
  - `src/cli/reporting/*parser.ts`
  - `src/cli/reporting/*report.ts`
  - `src/cli/main.ts`

### 直近の移行順

1. `report summary reduction` を `core-reducer` として MoonBit に移す
2. `quarantine match / mode 判定` を `core-policy` として MoonBit に移す
3. `config ownership analysis` を `core-policy` として MoonBit に移す
4. `stable test identity` の adapter source 正規化を TS shell として維持しつつ、必要なら variant contract を bitflow/actrun に広げる

## ML ベーステスト選択

### 設計方針（確定）

- ML はオプション。なくても現行ヒューリスティックで動作する
- co-failure はマテリアライズせず、毎回 DuckDB クエリで導出
- 学習: MoonBit native target で LightGBM C API (daily batch)
- 推論: native では C API、JS target では TS フォールバック（ツリー走査）
- モデルがなければヒューリスティックにフォールバック

### Stage 1: Co-failure トラッキング（ML なし）

`commit_changes` テーブルを追加し、co-failure をクエリで導出する。

#### 新規テーブル

```sql
CREATE TABLE IF NOT EXISTS commit_changes (
  commit_sha  VARCHAR NOT NULL,
  file_path   VARCHAR NOT NULL,
  change_type VARCHAR,          -- added / modified / deleted / renamed
  additions   INTEGER DEFAULT 0,
  deletions   INTEGER DEFAULT 0,
  PRIMARY KEY (commit_sha, file_path)
);
```

#### 収集ソース

- `collect` (GitHub): `git diff-tree --no-commit-id --name-status -r {sha}`
- `collect-local` (actrun): `git diff-tree` またはbit API
- `import`: レポートに commit_sha があればその時点の diff を取得

#### Co-failure 導出クエリ（毎回実行）

```sql
SELECT
  cc.file_path, tr.test_id,
  COUNT(*) AS co_runs,
  COUNT(*) FILTER (WHERE tr.status IN ('failed','flaky')
    OR (tr.retry_count > 0 AND tr.status = 'passed')) AS co_failures,
  ROUND(co_failures * 100.0 / co_runs, 2) AS co_failure_rate
FROM commit_changes cc
JOIN test_results tr ON cc.commit_sha = tr.commit_sha
WHERE cc.commit_sha IN (
  SELECT commit_sha FROM commit_changes
  WHERE commit_sha IN (SELECT commit_sha FROM test_results
    WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (? || ' days'))
)
GROUP BY cc.file_path, tr.test_id
HAVING co_runs >= 3
```

時間窓は2種類サポート:
- `--co-failure-days`: co-failure 集計の窓（デフォルト: 90日）
- `--flaky-days`: 既存のフレーキー率の窓（デフォルト: 30日）

#### Sampling への組み込み

```
既存:  weight = 1.0 + flaky_rate
拡張:  weight = 1.0 + flaky_rate + α * max(co_failure_rate for changed_files)
α は自動チューニング（eval の confusion matrix から最適化）
```

### Stage 2: GBDT 予測モデル（LightGBM）

- 特徴量:
  - co_failure_rate（Stage 1 のクエリから）
  - dependency_graph_distance（既存の graph analyzer）
  - flaky_rate（既存）
  - change_size: `SUM(additions + deletions)` from `commit_changes`
  - recency_weighted_failures: 指数減衰 `Σ fail * exp(-λ * days_ago)`
  - is_new_test: `total_runs <= 1`
- ラベル: CI でこのテストが落ちたか (0/1)
- 学習: native target で LightGBM C API、daily batch で `init_model` 引き継ぎ
- モデル保存: `.flaker/models/model-{date}.json`
- モデルホスト: 未決定（S3? GitHub Releases? 後で決める）

### Stage 3: Holdout サンプリング（フィードバックループ）

- スキップしたテストの一部をランダム実行し「見逃し」を検出
- これがないと「落ちるテストをスキップし続けて気づかない」問題が発生
- 設計詳細: 未決定（`sampling_run_tests` に `is_holdout` を追加する案あり）

### 自動チューニング

α（co-failure の重み係数）を eval の結果から自動最適化:
1. 過去の sampling_runs + CI 結果から confusion matrix を計算
2. α を変化させて F1 スコアを最大化する値を探索（grid search / Bayesian opt）
3. `.flaker/models/tuning.json` に保存
4. `flaker sample` 時に自動ロード

### 時系列的特徴量

純粋な時系列予測（ARIMA, LSTM）はこの問題には不適。
分類モデル（GBDT）に時系列的特徴量を組み込む:
- Recency weighting（指数減衰で直近の失敗を重視）
- フレーキーの周期性パターン検出（cron 的な外部依存）
- Concept drift 対応（sliding window で学習窓を制御）

### E2E テスト固有の課題

- 非決定性: フレーキーな失敗が学習シグナルを汚染
- 暗黙の状態依存: DB, キャッシュ, 外部サービスは静的解析で見えない
- 多対多マッピング: バックエンドの小変更が UI フロー全体に波及
- 疎なデータ: E2E は実行頻度が低く学習データが少ない
- → 静的依存解析だけでは不十分。ML の追加価値が最も大きい領域

## ストレージアーキテクチャ

### 方針（確定）

- Storage と Query を分離: Parquet (保存) + DuckDB (分析)
- 出力先: `.flaker/artifacts/`
- CI artifacts (GitHub Actions) とローカル (actrun) の両方を扱う

### データフロー

```
GitHub Actions (collect)
  → git diff-tree で commit_changes 収集
  → adapter でテスト結果パース
  → DuckDB に書き込み
  → .flaker/artifacts/ に Parquet エクスポート
  → actions/upload-artifact で保存

actrun (collect-local)
  → git diff-tree or bit API で commit_changes 収集
  → actrun adapter でテスト結果パース
  → DuckDB に書き込み
  → .flaker/artifacts/ に Parquet エクスポート

import (他環境からの取り込み)
  → .flaker/artifacts/*.parquet を DuckDB に read_parquet() で読み込み
  → または S3 / artifacts からダウンロード → import
```

### Parquet ファイル構成

```
.flaker/artifacts/
  test_results/
    {repo}-{date}-{run_id}.parquet
  commit_changes/
    {repo}-{date}-{run_id}.parquet
  workflow_runs/
    {repo}-{date}-{run_id}.parquet
```

### Parquet 実装

- `mizchi/parquet` (MoonBit) で native target から直接読み書き可能
- TS 側は DuckDB の `read_parquet()` で同じファイルを読める
- 他言語実装（Python/Rust 等）への切り替えに備え、スキーマ規約は後で固める
- 現段階ではスキーマは柔らかく保ち、実データが溜まってから正式に決定する

### DuckDB との統合

- DuckDB は `.flaker/artifacts/*.parquet` を `read_parquet()` で直読み可能
- 既存テーブルへの INSERT も維持（後方互換）
- 将来的に DuckDB テーブルを Parquet ビューに置き換え可能

### モデルアーティファクト

```
.flaker/models/
  model-{date}.json       -- LightGBM モデル
  tuning.json             -- α 等のハイパーパラメータ
```

ホスト先: 未決定（S3, GitHub Releases 等。後で決める）

## 評価フレームワーク

### 目的

flaker の各機能（サンプリング精度、フレーキー検出、CLI UX）を定量的に評価する。
ML 導入前のベースラインと導入後の改善を比較可能にする。

### アプローチ A: 合成フィクスチャ

- 制御されたパラメータでテスト履歴データを生成
  - テスト数: 100 / 1,000 / 10,000
  - フレーキー率: 0% / 5% / 20%
  - 依存グラフ: 線形 / ツリー / メッシュ
  - co-failure パターン: 強相関 / 弱相関 / ランダム
- ベースライン（現行ヒューリスティック）と ML モデルの比較が可能
- 再現性が高い

### アプローチ B: 実 OSS リポジトリ

- vite, playwright, deno 等のテスト履歴を収集
- 実データでの弱点特定
- ただし再現性は低い

### アプローチ C: Subagent 評価

- Claude Code の subagent に flaker を使わせる
- CLI の UX、エラーメッセージ、ドキュメントの改善フィードバック
- 「初見のユーザーが使えるか」の評価

## Coverage-guided テスト選択（検討中）

coverage-guided fuzzing の知見をテスト選択に応用する。
詳細設計: [docs/ml-test-selection-design.md](docs/ml-test-selection-design.md)

- [ ] **乗算→加算分解**: カバレッジデータがあれば、変更関数ごとにテストを加算的に選択できる
- [ ] **max-reduce 新規性検出**: テスト間の冗長性を排除（同じコードパスをカバーするテストを重複選択しない）
- [ ] **バケット化**: co-failure rate / flaky_rate を AFL 式にバケット化してノイズ削減
- [ ] **coverage-guided サンプリング戦略**: greedy set cover + weighted random（holdout 探索）
- [ ] **Antithesis 的拡張**: 実行順序・タイミング・環境のミューテーションによるフレーキー原因特定
- [ ] カバレッジデータの収集方法を決める（Istanbul/V8 coverage, playwright --coverage 等）

## 完了済み
- [x] MoonBit 未ビルド時でも affected target を解決できる TypeScript fallback を実装
