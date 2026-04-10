# ML ベーステスト選択 設計ドキュメント

## 概要

flaker に ML ベースのテスト選択を段階的に導入する設計。
現行のヒューリスティック（依存グラフ + フレーキー率重み付け）を維持しつつ、オプションとして ML 予測を追加する。

## 背景と動機

### 現行アプローチの限界

現在の flaker は完全にヒューリスティック/決定論的:

- **依存グラフ解析**: 変更ファイルから BFS/DFS で影響テストを特定
- **フレーキー率重み付け**: `weight = 1.0 + flaky_rate`
- **ハイブリッドサンプリング**: affected > 過去失敗 > 新規 > 重み付きランダム

静的依存解析は**プログラム言語レベルの依存関係**には有効だが、E2E テストのように暗黙の状態依存（DB、キャッシュ、外部サービス）がある場合は不十分。

### 業界の実績

| 組織 | 手法 | 結果 |
|------|------|------|
| Google | ロジスティック回帰 + co-failure 履歴 | テスト 95% 削減、失敗検出 99.5% |
| Meta | 変更-テスト相関 + カバレッジ | 大規模に実運用 |
| Microsoft | 強化学習 (RETECS) | 研究段階 |

## 設計方針

- **ML はオプション**: なくても現行ヒューリスティックで動作する
- **co-failure はマテリアライズせず、毎回 DuckDB クエリで導出**
- **学習**: MoonBit native target で LightGBM C API (daily batch)
- **推論**: native では C API、JS target では TS フォールバック（ツリー走査）
- **モデルがなければヒューリスティックにフォールバック**

## 段階的導入計画

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
- `collect local` (actrun): `git diff-tree` または bit API
- `import`: レポートに commit_sha があればその時点の diff を取得

#### Co-failure 導出クエリ

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

時間窓は 2 種類サポート:
- `--co-failure-days`: co-failure 集計の窓（デフォルト: 90 日）
- `--flaky-days`: 既存のフレーキー率の窓（デフォルト: 30 日）

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

### Stage 3: Holdout サンプリング（フィードバックループ）

- スキップしたテストの一部をランダム実行し「見逃し」を検出
- これがないと「落ちるテストをスキップし続けて気づかない」問題が発生
- 設計詳細: 未決定

### 自動チューニング

α（co-failure の重み係数）を eval の結果から自動最適化:

1. 過去の sampling_runs + CI 結果から confusion matrix を計算
2. α を変化させて F1 スコアを最大化する値を探索（grid search / Bayesian opt）
3. `.flaker/models/tuning.json` に保存
4. `flaker run` 時に自動ロード

## 時系列的特徴量

純粋な時系列予測（ARIMA, LSTM）はこの問題には不適。
テスト選択は「この diff で何が落ちるか」の**条件付き分類**であり、「次に何が起きるか」の予測ではない。

分類モデル（GBDT）に時系列的特徴量を組み込む:

- **Recency weighting**: 指数減衰で直近の失敗を重視
- **周期性パターン検出**: cron 的な外部依存によるフレーキー
- **Concept drift 対応**: sliding window で学習窓を制御

## Coverage-guided アプローチ

Coverage-guided fuzzing の知見（参考: [Pierre Zemb, "Diving into coverage-guided fuzzing"](https://pierrezemb.fr/posts/diving-into-coverage-guided-fuzzing/)）をテスト選択に応用する。

### 核心的アイデア: 乗算から加算への分解

ランダムファジングで 3 バイト列を見つけるには 256³ = 1600 万回必要だが、カバレッジフィードバックがあれば 256×3 = 768 回で済む。

テスト選択に当てはめると:
- **乗算的（現状）**: テストを重み付きランダムで選ぶ
- **加算的（目標）**: 「変更された関数 A をカバーするテスト」+「関数 B をカバーするテスト」と分解

co-failure はカバレッジの近似として機能するが、直接カバレッジデータの方が精度は高い。

### Max-reduce による新規性検出

ファジングの max-reduce 戦略をテスト選択に応用:

```
各テスト選択時:
  if このテストが、既に選択済みテストがカバーしていない
     コードパスをカバーする:
    → 選択（novel）
  else:
    → 冗長、スキップ
```

現在の flaker は「テストごとに独立して重みを計算 → 上位 N 件を選択」だが、テスト間の冗長性を考慮していない。同じコードパスをカバーする複数テストを全部選ぶのは無駄。

### バケット化によるノイズ削減

AFL の 8bit カウンタバケット化をメトリクスに応用:

| 生値 | バケット | 意味 |
|------|---------|------|
| 0 | 0 | 未実行 / 相関なし |
| 1 | 1 | 1 回 |
| 2-3 | 2 | 少数 |
| 4-7 | 3 | 中程度 |
| 8+ | 4 | 強い相関 |

co-failure rate や flaky_rate をバケット化すれば、37 回失敗 vs 38 回失敗の無意味な区別を消せる。GBDT の特徴量としても離散化した方が頑健。

### 「目の良い馬鹿な手」原則

> "Dumb hands with good eyes beat smart hands that are blind."

単純なモデル（GBDT）+ 良いフィードバック（co-failure, カバレッジ）が、複雑なモデル（Transformer）+ フィードバックなしに勝つ。flaker の ML 戦略を支持する原則。

### Antithesis 的拡張 — E2E テストへの応用

Antithesis はバイト列ではなくスケジューリング決定、ネットワークイベント、障害注入をミューテーションする。E2E テストに当てはめると:

- **テスト実行順序のミューテーション** → 順序依存のフレーキー検出
- **タイミングのミューテーション（遅延注入）** → レースコンディション発見
- **環境変数のミューテーション** → 環境依存のフレーキー検出

「なぜこのテストがフレーキーか」の原因特定に使える。

### Coverage-guided サンプリング戦略

```
1. changed_files から影響範囲を特定（既存の affected analysis）
2. 各テストのカバレッジデータから、影響範囲をカバーするテストを列挙
3. greedy set cover: カバレッジの新規性が最大のテストを順に選択
4. カバレッジデータがなければ co-failure で近似
5. 残り枠は weighted random で埋める（holdout 的な探索）
```

ステップ 5 が重要: ファジングの「ランダムミューテーションで未知の領域を探索する」に相当。全てをカバレッジで決めると、カバレッジデータにないバグを永遠に見つけられない。

## E2E テスト固有の課題

- **非決定性**: フレーキーな失敗が学習シグナルを汚染
- **暗黙の状態依存**: DB, キャッシュ, 外部サービスは静的解析で見えない
- **多対多マッピング**: バックエンドの小変更が UI フロー全体に波及
- **疎なデータ**: E2E は実行頻度が低く学習データが少ない
- **プロセス間カバレッジ**: ブラウザ + サーバ + DB をまたぐ計装が困難

→ 静的依存解析だけでは不十分。ML の追加価値が最も大きい領域。

## ストレージアーキテクチャ

### 方針

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
- 他言語実装への切り替えに備え、スキーマ規約は後で固める
- 現段階ではスキーマは柔らかく保ち、実データが溜まってから正式に決定

### モデルアーティファクト

```
.flaker/models/
  model-{date}.json       -- LightGBM モデル
  tuning.json             -- α 等のハイパーパラメータ
```

ホスト先: 未決定（S3, GitHub Releases 等）

## 未決定事項

- Holdout サンプリングの設計詳細（`sampling_run_tests` に `is_holdout` 追加する案あり）
- モデルアーティファクトのホスト先
- Parquet スキーマの正式規約（実データが溜まってから決定）
- カバレッジデータの収集方法（Istanbul/V8 coverage, playwright `--coverage` 等）
