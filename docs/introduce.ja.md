# flaker — テストを賢く選んで、速く回す

## 何をするツールか

flaker は「全テストを毎回流すのが現実的でない」プロジェクトのためのテスト選択ツールです。

CI のテスト履歴を学習し、今の変更に対して**どのテストを優先的に実行すべきか**を判断します。全テストの 20-30% を選んで実行するだけで、大半のリグレッションを検出できます。

## 解決する問題

### テストが多すぎて全部流せない

テストスイートが 30 分以上かかるプロジェクトでは、push のたびに全テストを実行するのは現実的ではありません。かといって何も実行しないのは危険です。

flaker は変更の影響範囲と過去の失敗パターンから、実行すべきテストを自動で選びます。

### flaky テストが CI の信頼性を壊している

「もう一回流せば通る」— この再実行がチームの時間と計算資源を浪費しています。

flaker は flaky テストを統計的に検出し、本当に壊れたテストと区別します。Broken（常に失敗）、Flaky（間欠的に失敗）、Retry-flaky（同一コミットで結果が変わる）を分類します。

### ローカルのテスト実行が CI と乖離している

開発者がローカルで通したテストが CI で落ちる。あるいはその逆。

flaker は CI とローカルの結果を同じ DB に蓄積し、**ローカル実行が CI をどの程度予測できているか**（偽陽性率・偽陰性率）を KPI として可視化します。

## 仕組み

```
コード変更
  ↓
git diff で変更ファイルを検出
  ↓
テスト履歴 DB から候補を取得（flaky率、co-failure相関、実行時間）
  ↓
サンプリング戦略で実行テストを選択
  ├─ affected: 変更に影響されるテスト
  ├─ weighted: flaky率で重み付けランダム
  └─ hybrid: affected + 前回失敗 + 新規 + weighted（推奨）
  ↓
テスト実行 → 結果を DB に蓄積 → 次回の選択精度が向上
```

データが蓄積されるほど選択精度が上がるフィードバックループです。

## インストールと最初の実行

### Nix（推奨）

```bash
# インストール不要で直接実行
nix run github:mizchi/flaker -- run

# devShell に組み込む場合
# flake.nix の inputs に追加:
#   flaker.url = "github:mizchi/flaker";
# devShell の packages に追加:
#   flaker.packages.${system}.default
```

### npm

```bash
pnpm add -D @mizchi/flaker
```

## 使い方（3ステップ）

### Step 1: collect calibrate — プロジェクトを分析する

```bash
flaker collect calibrate
```

プロジェクトのテスト数・flaky率・データ量を分析し、最適なサンプリング設定を推奨します。初回は `flaker.toml` に推奨設定を書き出します。

```
# Project Profile

  Tests:          457
  Commits:        28
  Flaky tests:    18
  Flaky rate:     3.9%

  Recommended:
    strategy         = hybrid
    sample_percentage = 30
    holdout          = 0.1
```

### Step 2: collect — CI の履歴を集める

```bash
export GITHUB_TOKEN=$(gh auth token)
flaker collect
```

GitHub Actions のテスト結果を artifact から自動収集し、DuckDB に蓄積します。これが flaker の学習データになります。

### Step 3: run — テストを選んで実行する

```bash
flaker run
```

これだけで以下が自動的に行われます:

1. `git diff` で変更ファイルを検出
2. 履歴に基づいてテストをサンプリング
3. テストランナー（vitest 等）を実行
4. 結果をレポート

```
# Changed files: 3
  src/auth.ts
  src/utils.ts
  tests/auth.test.ts

# Sampling: hybrid  (14/457 tests, 3%)

$ pnpm exec vitest run tests/auth.test.ts tests/utils.test.ts ...
────────────────────────────────────────────────────────────
 ✓ tests pass
────────────────────────────────────────────────────────────
# Result: PASS
  Saved ~443 test runs (97% reduction)
```

## 設定なしで使えるか？

**`flaker collect calibrate` と `flaker collect` を一度実行すれば、あとは `flaker run` だけ**です。

設定ファイル（`flaker.toml`）はリポジトリに含め、チーム全員が同じサンプリング設定で実行できるようにします。

```toml
[repo]
owner = "your-org"
name = "your-repo"

[storage]
path = ".flaker/data.duckdb"

[adapter]
type = "vitest"

[runner]
type = "vitest"
command = "pnpm exec vitest run"

[sampling]
strategy = "hybrid"
sample_percentage = 30
holdout_ratio = 0.1

[profile.scheduled]
strategy = "full"

[profile.ci]
strategy = "hybrid"
sample_percentage = 30
adaptive = true

[profile.local]
strategy = "affected"
max_duration_seconds = 60
```

## 実行プロファイル

flaker は実行環境に応じて自動的にテスト戦略を切り替えます。

| プロファイル | 用途 | 戦略 | 自動検出 |
|------------|------|------|---------|
| `scheduled` | 全テスト実行、データ蓄積 | `full` | `--profile scheduled` で明示指定 |
| `ci` | PR の選択的テスト | `hybrid` + adaptive | `CI=true` で自動 |
| `local` | 開発中の高速フィードバック | `affected` + 時間制約 | デフォルト |

データの流れ: scheduled でデータ蓄積 → CI がその履歴で精度の高いサンプリング → ローカルは依存グラフで高速フィードバック

```bash
# 自動検出（CI なら ci、それ以外は local）
flaker run

# 明示指定
flaker run --profile scheduled
flaker run --profile ci
flaker run --profile local
```

設定例:

```toml
[profile.scheduled]
strategy = "full"

[profile.ci]
strategy = "hybrid"
sample_percentage = 30
adaptive = true          # KPI に基づいて sample_percentage を動的に調整

[profile.local]
strategy = "affected"
max_duration_seconds = 60  # 時間制約内で優先度の高いテストを選択
```

## もっと深く使うには

| やりたいこと | コマンド |
|------------|---------|
| flaky テストの一覧を見る | `flaker analyze flaky` |
| サンプリングの品質を評価する | `flaker kpi` |
| テストを実行せず選択だけ見る | `flaker run --dry-run` |
| SQL で直接データを分析する | `flaker analyze query "SELECT ..."` |

## 対応テストフレームワーク

| フレームワーク | adapter type | 備考 |
|--------------|-------------|------|
| Vitest | `vitest` | `--reporter json` の出力を解析 |
| Playwright | `playwright` | JSON reporter |
| JUnit | `junit` | XML 形式 |
| Go Test | `gotest` | `go test -json` NDJSON |
| Cargo Test | `cargo` | テキストまたは `--format json` |
| TAP (git test 等) | `tap` | Test Anything Protocol |

## アーキテクチャ

flaker は MoonBit で書かれたネイティブバイナリです。

- **計算エンジン**: MoonBit（サンプリング、flaky 検出、GBDT）
- **ストレージ**: DuckDB（テスト履歴の分析クエリに最適化）
- **GitHub 連携**: MoonBit HTTP クライアント（`mizchi/github`）
- **テストランナー連携**: サブプロセス実行

Node.js/npm パッケージとしても利用可能です（TypeScript CLI が MoonBit コアを呼び出す構成）。

## 関連ドキュメント

- [なぜ flaker が必要か（理論的背景）](why-flaker.ja.md)
- [利用ガイド](usage-guide.ja.md)
- [運用ガイド](operations-guide.ja.md)
- [詳細な使い方リファレンス](how-to-use.ja.md)
- [テストアダプター設定ガイド](test-result-adapters.md)
- [サンプリング戦略の評価レポート](sampling-strategy-evaluation-report.ja.md)
