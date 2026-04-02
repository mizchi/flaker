# flaker — Flaky Test Detection & Test Sampling CLI

テストが多すぎて全部流せない。CI が flaky で信頼できない。どのテストが本当に壊れているのかわからない。flaker はこれらの問題を解決します。

[English](how-to-use.md)

## インストール

```bash
# npm/pnpm プロジェクトに追加
pnpm add -D @mizchi/flaker

# または直接実行
pnpm dlx @mizchi/flaker --help
```

## クイックスタート

### 1. 初期設定

```bash
flaker init --owner your-org --name your-repo
```

`flaker.toml` が生成されます。

### 2. データを集める

GitHub Actions のテスト結果を収集:

```bash
export GITHUB_TOKEN=$(gh auth token)
flaker collect --last 30
```

またはローカルのテストレポートを直接取り込み:

```bash
# Playwright JSON レポート
pnpm exec playwright test --reporter json > report.json
flaker import report.json --adapter playwright --commit $(git rev-parse HEAD)

# JUnit XML レポート
flaker import results.xml --adapter junit --commit $(git rev-parse HEAD)

# vrt-harness migration-report.json 用の built-in adapter
flaker import ../vrt-harness/test-results/migration/migration-report.json \
  --adapter vrt-migration \
  --commit $(git rev-parse HEAD)

# vrt-harness bench-report.json 用の built-in adapter
flaker import ../vrt-harness/test-results/css-bench/dashboard/bench-report.json \
  --adapter vrt-bench \
  --commit $(git rev-parse HEAD)

# 任意フォーマット向け custom adapter
flaker import ../vrt-harness/test-results/migration/migration-report.json \
  --adapter custom \
  --custom-command "node --experimental-strip-types ../vrt-harness/src/flaker-vrt-report-adapter.ts --scenario-id migration/tailwind-to-vanilla --backend chromium" \
  --commit $(git rev-parse HEAD)
```

### 3. 分析する

```bash
# flaky テスト一覧
flaker flaky

# AI が分析して推奨アクションを提示
flaker reason

# テストスイートの健全性スコア
flaker eval
```

### 4. テストを選んで実行する

```bash
# flaky 度で重み付けしてランダムに 20 件実行
flaker run --strategy weighted --count 20

# 変更に影響されるテストだけ実行
flaker run --strategy affected

# 変更影響 + 前回失敗 + 新規 + ランダム（推奨）
flaker run --strategy hybrid --count 50
```

---

## 設定ファイル (`flaker.toml`)

```toml
[repo]
owner = "your-org"
name = "your-repo"

[storage]
path = ".flaker/data.duckdb"

# テスト結果のパース形式
[adapter]
type = "playwright"     # "playwright" | "junit" | "vrt-migration" | "vrt-bench" | "custom"
artifact_name = "playwright-report"
# command = "node ./adapter.js"  # custom のときだけ必要

# テストランナー
[runner]
type = "vitest"         # "vitest" | "playwright" | "moontest" | "custom"
command = "pnpm vitest"

# 変更影響分析
[affected]
resolver = "workspace"  # "simple" | "workspace" | "moon" | "bitflow"

# flaky テストの自動隔離
[quarantine]
auto = true
flaky_rate_threshold = 30.0   # この % を超えたら quarantine 候補
min_runs = 10                  # 最低実行回数（データ不足の誤判定を防ぐ）

# flaky 検出パラメータ
[flaky]
window_days = 14              # 直近何日間のデータを分析するか
detection_threshold = 2.0     # この % 以上で flaky と判定
```

---

## コマンドリファレンス

### `flaker collect` — CI からデータ収集

```bash
flaker collect                    # 直近 30 日分
flaker collect --last 90          # 直近 90 日分
flaker collect --branch main      # main ブランチのみ
```

GitHub Actions の artifact からテストレポートを自動抽出します。既定の artifact 名は `playwright` が `playwright-report`、`junit` が `junit-report`、`vrt-migration` が `migration-report`、`vrt-bench` が `bench-report` です。workflow 側で別名を使う場合は `[adapter].artifact_name` で上書きします。`GITHUB_TOKEN` 環境変数が必要です。

### `flaker import` — ローカルレポートの取り込み

```bash
flaker import report.json --adapter playwright
flaker import results.xml --adapter junit
flaker import migration-report.json --adapter vrt-migration
flaker import bench-report.json --adapter vrt-bench
flaker import migration-report.json --adapter custom --custom-command "node ./adapter.js"
flaker import report.json --commit abc123 --branch feature-x
```

CI を使わずローカルで生成したテストレポートを直接 DB に格納します。

`--adapter custom` では、入力ファイルの中身を stdin で受けて `TestCaseResult[]` JSON を stdout に返す任意コマンドを指定できます。Playwright/JUnit 以外の独自レポートを bridge する用途です。

### `flaker collect-local` — actrun 実行履歴の取り込み

```bash
flaker collect-local              # actrun の全実行履歴を取り込み
flaker collect-local --last 10    # 直近 10 run のみ
```

actrun (GitHub Actions 互換ローカルランナー) の実行結果を自動取り込みします。artifact ディレクトリに Playwright/JUnit レポートがあれば、それも解析します。

### `flaker flaky` — flaky テスト検出

```bash
flaker flaky                      # 上位 flaky テスト一覧
flaker flaky --top 50             # 上位 50 件
flaker flaky --test "login"       # 名前でフィルタ
flaker flaky --true-flaky         # DeFlaker 式: 同一コミットで結果不一致
flaker flaky --trend --test "should redirect"  # 週次トレンド
flaker flaky --by-variant         # OS/ブラウザ別の flaky rate
```

#### 検出モード

| モード | フラグ | 判定方法 |
|--------|-------|---------|
| 閾値ベース | (デフォルト) | 直近 N 日間の fail 率が閾値超え |
| True flaky | `--true-flaky` | 同一 commit_sha で pass/fail が混在 (DeFlaker 方式) |
| variant 別 | `--by-variant` | OS/ブラウザ等の実行条件ごとに flaky rate を計算 |

### `flaker reason` — AI 分析

```bash
flaker reason                     # 推奨アクション付きレポート
flaker reason --json              # 機械可読 JSON
flaker reason --window 7          # 直近 7 日間で分析
```

各 flaky テストを分類し、推奨アクションを提示します:

| 分類 | 意味 | 推奨アクション |
|------|------|--------------|
| `true-flaky` | 同一コードで結果が変わる (非決定的) | quarantine または investigate |
| `regression` | 最近の変更で壊れた | **fix-urgent** |
| `intermittent` | retry で通る | quarantine または monitor |
| `environment-dependent` | 環境依存の可能性 | investigate |

パターン検出:
- **suite-instability** — 同じスイートに 3+ 件の flaky テスト → 共有 fixture の問題の可能性
- **new-test-risk** — 追加されたばかりのテストが既に失敗

リスク予測:
- 現在安定だが、直近で失敗が出始めたテスト
- 実行時間の分散が大きいテスト

### `flaker sample` — テストサンプリング

```bash
flaker sample --strategy random --count 20        # ランダム 20 件
flaker sample --strategy weighted --count 20      # flaky 優先
flaker sample --strategy affected                 # 変更影響のみ
flaker sample --strategy hybrid --count 50        # ハイブリッド（推奨）
flaker sample --percentage 30                     # 全テストの 30%
flaker sample --skip-quarantined                  # quarantine 除外
```

#### サンプリング戦略

| 戦略 | 説明 |
|------|------|
| `random` | 均等ランダム |
| `weighted` | flaky rate で重み付け (flaky なテストほど選ばれやすい) |
| `affected` | `git diff` から変更影響テストを特定 |
| `hybrid` | affected + 前回失敗 + 新規テスト + weighted random (Microsoft TIA 方式) |

### `flaker run` — サンプリング + 実行

```bash
flaker run --strategy hybrid --count 50
flaker run --strategy affected
flaker run --skip-quarantined
flaker run --runner actrun                        # actrun 経由で実行
flaker run --runner actrun --retry                # 失敗箇所のみリトライ
```

実行結果は自動的に DB に格納されます。

### `flaker quarantine` — flaky テストの隔離

```bash
flaker quarantine                                 # 隔離済み一覧
flaker quarantine --auto                          # 閾値超えを自動隔離
flaker quarantine --add "suite>testName"          # 手動追加
flaker quarantine --remove "suite>testName"       # 解除
```

隔離されたテストは `--skip-quarantined` で実行から除外できます。

### `flaker bisect` — 原因コミット特定

```bash
flaker bisect --test "should redirect"
flaker bisect --test "should redirect" --suite "tests/login.spec.ts"
```

テスト結果の履歴から、flaky が始まったコミット範囲を特定します。

### `flaker eval` — 健全性評価

```bash
flaker eval
flaker eval --json
```

テストスイート全体の健全性を 0-100 のスコアで評価します:
- **Data Sufficiency** — データ量は十分か
- **Detection** — flaky テストの検出状況
- **Resolution** — flaky テストの解決状況 (MTTD/MTTR)
- **Health Score** — 総合スコア

### `flaker query` — SQL で直接分析

```bash
flaker query "SELECT suite, test_name, status, COUNT(*) as cnt
              FROM test_results
              GROUP BY suite, test_name, status
              ORDER BY cnt DESC
              LIMIT 20"
```

DuckDB に直接 SQL を投げられます。ウィンドウ関数、FILTER 句など DuckDB の分析機能をフル活用できます。

---

## テストランナー別の設定

### Vitest

```toml
[adapter]
type = "playwright"    # vitest --reporter json は Playwright 互換

[runner]
type = "vitest"
command = "pnpm vitest"
```

### Playwright Test

```toml
[adapter]
type = "playwright"

[runner]
type = "playwright"
command = "pnpm exec playwright test"
```

### MoonBit (moon test)

```toml
[adapter]
type = "custom"
command = "node ./parse-moon-output.js"

[runner]
type = "moontest"
command = "moon test"
```

### カスタムランナー

任意のテストランナーを JSON プロトコルで接続:

```toml
[runner]
type = "custom"
execute = "node ./my-runner.js execute"   # stdin: TestId[], stdout: ExecuteResult
list = "node ./my-runner.js list"         # stdout: TestId[]
```

詳細は [Runner Adapters](runner-adapters.md) を参照。

---

## 依存分析の設定

`--strategy affected` や `--strategy hybrid` で使う依存解析方式:

### workspace (Node.js monorepo, ゼロ設定)

```toml
[affected]
resolver = "workspace"
```

`package.json` の `dependencies` + `workspace:` プロトコルから自動で依存グラフを構築。pnpm / npm / yarn workspace に対応。

### moon (MoonBit, ゼロ設定)

```toml
[affected]
resolver = "moon"
```

`moon.pkg` の `import` フィールドから自動で依存グラフを構築。

### bitflow (Starlark 手動定義)

```toml
[affected]
resolver = "bitflow"
config = "flaker.star"
```

```python
# flaker.star
task("tests/auth", srcs=["src/auth/**", "src/utils/**"])
task("tests/checkout", srcs=["src/checkout/**"], needs=["tests/auth"])
```

ファイルレベルの細かい依存を定義可能。

### simple (フォールバック)

```toml
[affected]
resolver = "simple"
```

ディレクトリ名マッチングによる簡易推定。設定不要。

---

## actrun との連携

[actrun](https://github.com/mizchi/actrun) (GitHub Actions 互換ローカルランナー) と連携して、CI パイプラインを通さずにローカルでテストを実行・蓄積できます。

```bash
# actrun でテスト実行 → 結果を自動 DB 取り込み
flaker run --runner actrun

# 失敗テストだけリトライ
flaker run --runner actrun --retry

# actrun の過去の実行履歴を一括取り込み
flaker collect-local
```

---

## 典型的なワークフロー

### 日常の開発

```bash
# 朝: CI データを最新化
flaker collect

# コード変更後: 影響テストだけ素早く実行
flaker run --strategy affected

# 全体の状態確認
flaker eval
```

### flaky テスト対応

```bash
# 問題のあるテストを特定
flaker reason

# 重症なものを隔離
flaker quarantine --auto

# 原因コミットを特定
flaker bisect --test "問題のテスト名"

# 修正後、隔離解除
flaker quarantine --remove "suite>testName"
```

### CI での活用

```yaml
# .github/workflows/flaker.yml
- name: Collect & Analyze
  run: |
    flaker collect --last 7
    flaker eval --json > flaker-report.json
    flaker reason --json > flaker-reason.json

- name: Upload analysis
  uses: actions/upload-artifact@v6
  with:
    name: flaker-report
    path: flaker-*.json
```

### PR でのテスト選択

```yaml
- name: Run affected tests
  run: |
    flaker run --strategy hybrid --count 50 --skip-quarantined
```
