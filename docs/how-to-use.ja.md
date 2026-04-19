# flaker — Flaky Test Detection & Test Sampling CLI

テストが多すぎて全部流せない。CI が flaky で信頼できない。どのテストが本当に壊れているのかわからない。flaker はこれらの問題を解決します。

[English](how-to-use.md)

このページは **詳細なコマンドリファレンス**。

- 日常利用の入口: [usage-guide.ja.md](usage-guide.ja.md)
- 運用設計の入口: [operations-guide.ja.md](operations-guide.ja.md)
- 導入手順: [new-project-checklist.ja.md](new-project-checklist.ja.md)

## インストール

```bash
# npm/pnpm プロジェクトに追加
pnpm add -D @mizchi/flaker

# または直接実行
pnpm dlx @mizchi/flaker --help
```

### sibling checkout で dogfood する

```bash
# ../flaker 側で 1 回だけ
pnpm --dir ../flaker install

# 利用側プロジェクトの root から
node ../flaker/scripts/dev-cli.mjs affected --changed src/foo.ts
node ../flaker/scripts/dev-cli.mjs run --dry-run --profile local --changed src/foo.ts
node ../flaker/scripts/dev-cli.mjs run --profile local --changed src/foo.ts
node ../flaker/scripts/dev-cli.mjs analyze eval --markdown --window 7 --output .artifacts/flaker-review.md

# flaker 自体を触った直後に build を強制したいとき
node ../flaker/scripts/dev-cli.mjs --rebuild run --profile local --changed src/foo.ts
```

`scripts/dev-cli.mjs` は `dist/cli/main.js` と `dist/moonbit/flaker.js` が無ければ自動で build し、source が `dist` より新しい場合も自動で rebuild します。pnpm script を使いたい場合は `pnpm --dir ../flaker run dev:cli -- ...` でも `INIT_CWD` 経由で呼び出し元 repo を維持します。

複数のローカルコマンドが同じ `.flaker/data.duckdb` を共有する場合は直列で実行してください。DuckDB は single-writer なので、parallel 実行だと lock conflict が起きます。

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
flaker collect --days 30
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
flaker analyze flaky

# AI が分析して推奨アクションを提示
flaker analyze reason

# テストスイートの健全性スコア
flaker analyze eval
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
command = "pnpm exec vitest run"

# 変更影響分析
[affected]
resolver = "workspace"  # "simple" | "workspace" | "moon" | "bitflow"

# flaky テストの自動隔離
[quarantine]
auto = true
flaky_rate_threshold_percentage = 30   # この % を超えたら quarantine 候補
min_runs = 10                           # 最低実行回数（データ不足の誤判定を防ぐ）

# flaky 検出パラメータ
[flaky]
window_days = 14                       # 直近何日間のデータを分析するか
detection_threshold_ratio = 0.02       # この割合以上で flaky と判定
```

---

## コマンドリファレンス

### `flaker plan` / `flaker apply` — 宣言的収束

```bash
flaker plan           # 現状との差分を表示 (dry-run)
flaker plan --json
flaker plan --output .artifacts/flaker-plan.json   # PlanArtifact を保存

flaker apply          # 差分を埋めるために collect / calibrate / run / quarantine apply を自動実行
flaker apply --json
flaker apply --output .artifacts/flaker-apply.json # ApplyArtifact を保存

# 0.9.0 で ops daily を吸収。weekly は動作 / incident は 1.0.0 で stub 解消予定:
flaker apply --emit daily   --output .artifacts/flaker-daily.md
flaker apply --emit weekly  --output .artifacts/flaker-weekly.md
flaker apply --emit incident  # 現在は flaker ops incident へ誘導する stub
```

`flaker.toml` を **desired state** とみなし、現在の DB 状態を見て「何をすべきか」を planner が組み立てる。履歴ゼロの新規 repo なら `collect_ci` + `cold_start_run` が、十分な履歴があれば `collect_ci` + `calibrate` + `quarantine_apply` が選ばれる。ユーザー側が順序を覚える必要はない。

`[promotion]` セクションの閾値と現状の KPI を突き合わせて `flaker status` がドリフトを表示する。

#### 0.9.0 の `--json` 出力シェイプ

`flaker apply --json`:

- `executed[*].status`: `"ok" | "failed" | "skipped"` (旧 `.ok: boolean` + トップレベル `aborted` は削除)
- `executed[*].skippedReason?: string`: dependency 失敗で skip されたときの理由
- exit code は `status === "failed"` のみ 1、skipped は 0

`flaker status --json` の `drift.unmet[*]` も同様に `{ field, threshold }` → `{ kind, desired }` へ変更。

#### `--emit` と `ops` の棲み分け

- `apply --emit daily`: 旧 `flaker ops daily` と同じ cadence artifact を出力 (0.9.0 で統合、`ops daily` は deprecated)。
- `apply --emit weekly`: 同じく weekly 集計を出力。ただし `flaker ops weekly` は operator 向け narrative (quarantine 提案, flaky-tag triage 等) を別途 carry するため first-class 継続。
- `apply --emit incident`: 現状 stub。インシデント調査は `flaker ops incident --run <id>` または `flaker debug retry / confirm / diagnose` を使う。1.0.0 で `--incident-*` フラグを取って完全統合予定。

### `flaker collect` — CI からデータ収集

```bash
flaker collect                                           # 直近 30 日分
flaker collect --days 90                                 # 直近 90 日分
flaker collect --branch main                             # main ブランチのみ
flaker collect --json --output .artifacts/collect.json   # 機械可読 summary を保存
flaker collect --json --output .artifacts/collect.json --fail-on-errors
```

GitHub Actions の artifact からテストレポートを自動抽出します。既定の artifact 名は `playwright` が `playwright-report`、`junit` が `junit-report`、`vrt-migration` が `migration-report`、`vrt-bench` が `bench-report` です。workflow 側で別名を使う場合は `[adapter].artifact_name` で上書きします。`GITHUB_TOKEN` 環境変数が必要です。

`--json` は機械可読 summary が欲しいとき、`--output <file>` は summary を artifact に残したいとき、`--fail-on-errors` は partial failure を CI failure として扱いたいときに使います。JSON summary では、実際に取り込めた run (`runsCollected`)、まだ matching artifact が見つかっていない run (`pendingArtifactRuns`)、収集中に失敗した run (`failedRuns`) を分けて確認できます。

GitHub Actions の完全な例は [examples/github-actions/collect-summary.yml](../examples/github-actions/collect-summary.yml) を参照してください。

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

#### `vrt-migration` adapter — versioned schema (推奨)

`vrt-migration` adapter は 2 形式を受け付ける:

1. **Legacy**: `{ dir, variants[], viewports[], results[] }` (0.3.x 互換)
2. **Versioned** (推奨): `{ schema: "studio-vrt-flaker", schemaVersion: 1, dir, results[] }`

Versioned 形式は interaction scenario (click / hover / input / scroll) を安定した identity で表現できる。Legacy 形式では interaction scenario を表すのに variant 名に `#interaction-*` を詰め込むしかなく、同ドメインの scenario が別 suite として分裂する問題があった。

Versioned 形式の shape:

```json
{
  "schema": "studio-vrt-flaker",
  "schemaVersion": 1,
  "dir": "regression/preview-vs-hrc",
  "results": [
    {
      "domain": "papplica.app",
      "scenario": "interaction-hero-hover",
      "viewport": "desktop",
      "width": 1440,
      "height": 900,
      "diffPixels": 466,
      "approved": true
    }
  ]
}
```

flaker 上での identity mapping:

| 入力 field | → flaker identity |
|---|---|
| `dir` + `domain` | `suite = "regression/preview-vs-hrc/papplica.app"` |
| `viewport` + `scenario` | `test_name = "viewport:desktop / scenario:interaction-hero-hover"` |
| (scenario が `"initial"` または未指定) | `test_name = "viewport:desktop"` (suffix なし) |
| `backend`, `viewport`, `width`, `height`, `scenario` | `variant = { ... }` |

同じドメインの initial 画像と interaction scenario が同じ suite の下にぶら下がるため、suite ベースの集計・affected-suites の扱いが自然になる。producer/consumer 双方が `schemaVersion` を明示できるので過去データとの整合も保たれる。

### `flaker collect local` — actrun 実行履歴の取り込み

```bash
flaker collect local              # actrun の全実行履歴を取り込み
flaker collect local --last 10    # 直近 10 run のみ
```

actrun (GitHub Actions 互換ローカルランナー) の実行結果を自動取り込みします。artifact ディレクトリに Playwright/JUnit レポートがあれば、それも解析します。

### `flaker analyze flaky` — flaky テスト検出

```bash
flaker analyze flaky                      # 上位 flaky テスト一覧
flaker analyze flaky --top 50             # 上位 50 件
flaker analyze flaky --test "login"       # 名前でフィルタ
flaker analyze flaky --true-flaky         # DeFlaker 式: 同一コミットで結果不一致
flaker analyze flaky --trend --test "should redirect"  # 週次トレンド
flaker analyze flaky --by-variant         # OS/ブラウザ別の flaky rate
```

#### 検出モード

| モード | フラグ | 判定方法 |
|--------|-------|---------|
| 閾値ベース | (デフォルト) | 直近 N 日間の fail 率が閾値超え |
| True flaky | `--true-flaky` | 同一 commit_sha で pass/fail が混在 (DeFlaker 方式) |
| variant 別 | `--by-variant` | OS/ブラウザ等の実行条件ごとに flaky rate を計算 |

### `flaker analyze reason` — AI 分析

```bash
flaker analyze reason                     # 推奨アクション付きレポート
flaker analyze reason --json              # 機械可読 JSON
flaker analyze reason --window 7          # 直近 7 日間で分析
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

### `flaker run --dry-run` — テストサンプリング（dry run）

```bash
flaker run --dry-run --strategy random --count 20        # ランダム 20 件
flaker run --dry-run --strategy weighted --count 20      # flaky 優先
flaker run --dry-run --strategy affected                 # 変更影響のみ
flaker run --dry-run --strategy hybrid --count 50        # ハイブリッド（推奨）
flaker run --dry-run --profile local --changed src/foo.ts
flaker run --dry-run --percentage 30                     # 全テストの 30%
flaker run --dry-run --skip-quarantined                  # quarantine 除外
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
flaker run --profile local --changed src/foo.ts
flaker run --skip-quarantined
flaker run --runner actrun                        # actrun 経由で実行
flaker run --runner actrun --retry                # 失敗箇所のみリトライ
```

`--runner actrun` は `[runner].command` ではなく、`[runner.actrun].workflow` に書いた workflow path を使います。

```toml
[runner]
type = "playwright"
command = "pnpm exec playwright test -c playwright.config.ts"

[runner.actrun]
workflow = ".github/workflows/ci.yml"
local = true
trust = true
# job = "e2e"
```

実行結果は自動的に DB に格納されます。

### Execution Profiles

`flaker run` は execution profile から設定を継承できます（実行せずサンプリングのみ行う場合は `--dry-run` を使用）:

```toml
[profile.scheduled]
strategy = "full"

[profile.ci]
strategy = "hybrid"
sample_percentage = 30
adaptive = true

[profile.local]
strategy = "affected"
max_duration_seconds = 60
fallback_strategy = "weighted"
```

ローカルでは次のループが扱いやすいです:

```bash
flaker exec affected --changed src/foo.ts
flaker run --dry-run --profile local --changed src/foo.ts
flaker run --profile local --changed src/foo.ts
```

`profile.local` で `affected` 選択、`weighted` への fallback、time budget 制御をまとめて扱うのが、dogfood と日常開発の両方で実用的です。

### フラグの優先順位

```
Resolution order (highest to lowest):
  1. Explicit CLI flag          (--strategy, --percentage, --count)
  2. [profile.<name>] in flaker.toml   (via --profile or auto-detection)
  3. [sampling] in flaker.toml         (project default)
  4. Built-in defaults

Notes:
  --count overrides --percentage when both are given
  --changed overrides git auto-detection
  --dry-run suppresses execution, still records selection telemetry
  --explain can be combined with --dry-run or a real run
```

`--count` と `--percentage` を同時に指定した場合は `--count` が優先されます。`--changed` は git の自動検出を上書きします。`--dry-run` は実行を抑制しますが、選択結果はテレメトリに記録されます。`--explain` は dry-run でも実際の実行でも併用できます。

### co-failure クラスタリング (`[sampling].cluster_mode`)

同じ run で同時に失敗するテスト群をクラスタとして扱い、sampling 時に**代表 1 本**だけ選ぶことで多様な失敗パターンを少ない枠でカバーする仕組み。VRT で数万の scenario をサンプリングするような用途向け。

#### 設定

```toml
[sampling]
cluster_mode = "spread"   # "off" (既定) | "spread" | "pack"
co_failure_window_days = 90
```

| mode | 挙動 |
|---|---|
| `off` | クラスタを無視。通常の `weighted` / `hybrid` sampling。 |
| `spread` | 各クラスタから **1 本だけ** 選び、残りの枠は通常 weighted で埋める。多様性優先。 |
| `pack` | 同一クラスタ内のテストを**まとめて**取る。同根原因の確認を深堀りしたいとき。 |

`cluster_mode` は `weighted` / `hybrid` strategy に対してのみ有効。`affected` / `full` では無視される。

#### クラスタ検出の閾値

`queryTestCoFailures` が `test_results` を集計して共起率を出し、`buildFailureClusters` がクラスタを組む。既定閾値:

- `windowDays`: 90 日
- `minCoFailures`: 2 (最低共起回数)
- `minCoRate`: 0.8 (共起率 80% 以上)

CLI では `flaker explain cluster` で個別に調整できる:

```bash
flaker explain cluster                                   # 既定 (window=90, min-co=2, min-rate=0.8, top=20)
flaker explain cluster --min-co-rate 0.9                 # 共起率 90% 以上のタイトなクラスタのみ
flaker explain cluster --window-days 30 --top 50         # 直近 30 日、上位 50 クラスタ
flaker explain cluster --json                            # 機械可読出力
```

#### 既存の `co_failure_boost` との違い

| | `co_failure_boost` | cluster_mode |
|---|---|---|
| 相関 | ファイル変更 ↔ テスト失敗 | テスト失敗 ↔ テスト失敗 |
| 用途 | affected sampling で「変更に関連するテスト」を優先 | sampling 枠に多様性を持たせる / 深堀りする |
| データ | `commit_changes` + `test_results` | `test_results` のみ |

両方を同時に設定しても矛盾せず、cluster_mode は `weighted` / `hybrid` の最終段で適用される (boost で並べ替え後にクラスタ代表を選ぶ)。

### `flaker collect coverage` — Coverage edge の取り込み

```bash
flaker collect coverage --format istanbul --input coverage/coverage-final.json
flaker collect coverage --format playwright --input .artifacts/coverage
```

`coverage-guided` sampling 用に、テストごとの coverage edge を DuckDB へ取り込みます。directory input も受け付け、重複 edge は insert 前に dedupe されます。

### `flaker dev train` — GBDT モデル学習

```bash
flaker dev train
flaker dev train --window-days 30 --num-trees 10 --learning-rate 0.3
```

蓄積済みの CI / local history から `.flaker/models/gbdt.json` を生成します。local run も低い重みで学習に含め、保存される model には `gbdt` sampling で使う feature 名も入ります。

### `flaker policy quarantine` — flaky テストの隔離

```bash
flaker policy quarantine                                 # 隔離済み一覧
flaker policy quarantine --auto                          # 閾値超えを自動隔離
flaker policy quarantine --add "suite>testName"          # 手動追加
flaker policy quarantine --remove "suite>testName"       # 解除
```

隔離されたテストは `--skip-quarantined` で実行から除外できます。

### `flaker debug retry` — CI 失敗をローカル再現

```bash
flaker debug retry                      # 直近の失敗 CI run から失敗テストを取り、ローカル再実行
flaker debug retry --run 12345678       # 特定の workflow run id を指定
```

CI の失敗 artifact から失敗テスト群を抽出し、ローカルで一括再実行します。**最初に打つコマンド**の位置付けで、複数の CI 失敗をまとめて「再現する / しない」で一次振り分けするために使います。出力は 2 値 (再現 / 非再現) で、`BROKEN/FLAKY/TRANSIENT` の分類までは行いません。細かい分類が欲しい場合は、非再現のテストを `flaker debug confirm` に回します。

### `flaker debug confirm` — 失敗を 3 分類に判定

```bash
# remote: workflow_dispatch を叩いて CI で繰り返し実行
flaker debug confirm "tests/api.test.ts:handles timeout"
flaker debug confirm "tests/api.test.ts:handles timeout" --repeat 10

# local: 手元の runner で繰り返し実行
flaker debug confirm "tests/api.test.ts:handles timeout" --runner local
```

指定した 1 テストを `--repeat N` 回実行し、結果を 3 分類に判定します (`--repeat` の既定値は `5`):

| 分類 | 条件 | 意味 / 推奨アクション |
|---|---|---|
| `BROKEN` | `failures == N` | 毎回失敗。regression として修正する |
| `FLAKY` | `0 < failures < N` | 断続的失敗。`@flaky` タグ付与または quarantine |
| `TRANSIENT` | `failures == 0` | 再現せず。CI 環境起因 / 一過性ノイズとして記録のみ |

`--repeat 10` 以上は、低頻度の flaky を既定値 `5` では検出しきれないと疑うときに使います。試行回数を増やすほど判定が安定する一方、wall time が伸びます。

remote モードは `.github/workflows/flaker-confirm.yml` を要求します。未生成の repo では `flaker init --force` で作り直すか、`templates/flaker-confirm.yml` をコピーしてください。

### `flaker debug bisect` — 原因コミット特定

```bash
flaker debug bisect --test "should redirect"
flaker debug bisect --test "should redirect" --suite "tests/login.spec.ts"
```

テスト結果の履歴から、flaky が始まったコミット範囲を特定します。

### `flaker analyze eval` — 健全性評価

```bash
flaker analyze eval
flaker analyze eval --json
flaker analyze eval --markdown --window 7
flaker analyze eval --markdown --window 7 --output .artifacts/flaker-review.md
```

テストスイート全体の健全性を 0-100 のスコアで評価します:
- **Data Sufficiency** — データ量は十分か
- **Detection** — flaky テストの検出状況
- **Resolution** — flaky テストの解決状況 (MTTD/MTTR)
- **Health Score** — 総合スコア

`--markdown --window 7` を使うと、週次レビューに貼りやすい KPI サマリを Markdown で出力します。

### `flaker analyze query` — SQL で直接分析

```bash
flaker analyze query "SELECT suite, test_name, status, COUNT(*) as cnt
              FROM test_results
              GROUP BY suite, test_name, status
              ORDER BY cnt DESC
              LIMIT 20"
```

DuckDB に直接 SQL を投げられます。ウィンドウ関数、FILTER 句など DuckDB の分析機能をフル活用できます。

---

## テストランナー別の設定

`flaker init --adapter <type> --runner <type>` で生成される既定は下記。`[adapter].type` はレポートフォーマットのパーサ選択、`[runner].type` は実際にテストを実行する runner。

### Vitest

```toml
[adapter]
type = "vitest"

[runner]
type = "vitest"
command = "pnpm exec vitest run"
```

`flaker import <report.json>` で Vitest の JSON レポートを取り込む場合は `vitest run --reporter=json --outputFile=report.json` で生成すること。`flaker report <report.json> --summary --adapter vitest` も同じ JSON を入力として受け付ける。

### Playwright Test

```toml
[adapter]
type = "playwright"

[runner]
type = "playwright"
command = "pnpm exec playwright test"
```

### Jest

```toml
[adapter]
type = "jest"       # または "junit" (jest-junit reporter 経由のとき)

[runner]
type = "jest"
command = "pnpm exec jest"
```

Jest の JSON レポートは `jest --json --outputFile=report.json` で生成。`jest-junit` reporter を使う場合は `--adapter junit` に切り替える。

### JUnit XML (runner 非依存)

```toml
[adapter]
type = "junit"

[runner]
type = "custom"
execute = "..."   # runner は用途に合わせて
```

Ant / Gradle / Maven / pytest 等、どの runner でも JUnit XML を吐けば取り込める。

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

### `[runner.actrun]` の runner 別例

`flaker run --runner actrun` を使う場合、`[runner]` に加えて `[runner.actrun]` で workflow ファイルを指定する。

```toml
# Playwright E2E を actrun で
[runner]
type = "playwright"
command = "pnpm exec playwright test -c playwright.config.ts"
[runner.actrun]
workflow = ".github/workflows/e2e.yml"
local = true
trust = true

# Vitest を actrun で (ユニット/統合テストを CI と同じ環境で手元実行)
[runner]
type = "vitest"
command = "pnpm exec vitest run"
[runner.actrun]
workflow = ".github/workflows/ci.yml"
job = "test"
local = true
trust = true
```

### `flaky_tag_pattern` / `skip_flaky_tagged` の runner 別挙動

| runner | タグ記法 | `skip_flaky_tagged = true` の挙動 |
|---|---|---|
| `playwright` | テスト名に `@flaky` を埋め込む (例: `test("login @flaky", ...)` または `test.describe` 階層) | `--grep-invert @flaky` を自動付与 |
| `vitest` | 現状対応なし | `skip_flaky_tagged` は no-op。`@flaky` なテストを除外したい場合は `test.skipIf` や `--testNamePattern` を手書きする |
| `jest` | 現状対応なし | 同上。`describe.skip` / `it.skip` で個別スキップ |
| `custom` | runner 次第 | 任意のフィルタを `execute` コマンド側で実装 |

`flaker ops weekly` / `flaker analyze flaky-tag` が出す `@flaky` add/remove 提案は Playwright 前提。Vitest / Jest で同じ自動化が欲しい場合は提案 JSON をパースして自前で適用する必要がある (0.7.x では自動適用なし)。

---

## 依存分析の設定

`--strategy affected` や `--strategy hybrid` で使う依存解析方式。**5 種類をサポート**、単一 package や最初に試すなら `simple` (init 既定)。

| resolver | 適用対象 | 設定 | 備考 |
|---|---|---|---|
| `simple` | 単一 package / フォールバック | なし (`init` 既定) | ディレクトリ名マッチングによる簡易推定。`git` は同じ挙動のエイリアス。 |
| `workspace` | Node.js monorepo | なし | `package.json` の `dependencies` + `workspace:` プロトコルを自動読み取り。pnpm / npm / yarn に対応。 |
| `glob` | 任意の単一/monorepo | `flaker.affected.toml` | glob ルールを TOML で手動定義。次項のテンプレ参照。 |
| `bitflow` | Starlark を採用済の repo | `flaker.star` | 既存 bitflow プロジェクトに乗るときに選択。 |
| `moon` | MoonBit | なし | `moon.pkg` の `import` フィールドを自動読み取り。 |

### workspace (Node.js monorepo)

```toml
[affected]
resolver = "workspace"
```

### moon (MoonBit)

```toml
[affected]
resolver = "moon"
```

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

### glob (手動ルール)

```toml
[affected]
resolver = "glob"
config = "flaker.affected.toml"
```

```toml
# flaker.affected.toml
[[rules]]
tests = ["tests/auth/**"]
srcs = ["src/auth/**", "src/utils/**"]

[[rules]]
tests = ["tests/checkout/**"]
srcs = ["src/checkout/**"]
```

### simple (既定)

```toml
[affected]
resolver = "simple"
```

ディレクトリ名マッチングによる簡易推定。設定不要。`init` 既定。`git` (過去の別名) と同じ挙動。

---

## actrun との連携

[actrun](https://github.com/mizchi/actrun) (GitHub Actions 互換ローカルランナー) と連携して、CI パイプラインを通さずにローカルでテストを実行・蓄積できます。

```bash
# actrun でテスト実行 → 結果を自動 DB 取り込み
flaker run --runner actrun

# 失敗テストだけリトライ
flaker run --runner actrun --retry

# actrun の過去の実行履歴を一括取り込み
flaker collect local
```

workflow path は `[runner.actrun].workflow` から解決されます。.github/workflows/ci.yml のような repo 相対 path を明示し、git worktree を使わないローカル実行では `local = true` を付けてください。

---

## 典型的なワークフロー

### 日常の開発

```bash
# 朝: CI データを最新化
flaker collect

# コード変更後: inspect → sample → run を local profile で回す
flaker exec affected --changed src/foo.ts
flaker run --dry-run --profile local --changed src/foo.ts
flaker run --profile local --changed src/foo.ts

# 全体の状態確認
flaker analyze eval
```

### flaky テスト対応

```bash
# 問題のあるテストを特定
flaker analyze reason

# 重症なものを隔離
flaker policy quarantine --auto

# 原因コミットを特定
flaker debug bisect --test "問題のテスト名"

# 修正後、隔離解除
flaker policy quarantine --remove "suite>testName"
```

### CI での活用

```yaml
# .github/workflows/flaker.yml
- name: Collect & Analyze
  run: |
    flaker collect --days 7
    flaker analyze eval --json --output flaker-report.json
    flaker analyze reason --json > flaker-reason.json

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

## 設定の移行

`flaker 0.2.0` 以降、設定キーの命名規則を「サフィックスで単位を明示する」方式に変更しました: `*_ratio` (0.0–1.0)、`*_percentage` (0–100)、`*_days`、`*_seconds`、`*_count`。単位サフィックスが付かないキーは廃止されました。レガシーな `flaker.toml` を検出するとCLIは起動を拒否し、このセクションへ誘導します。

下表にしたがって `flaker.toml` のキーをリネームしてください:

| セクション | 旧キー | 新キー | 単位 |
|---|---|---|---|
| `[sampling]` | `percentage` | `sample_percentage` | 0–100 |
| `[sampling]` | `co_failure_days` | `co_failure_window_days` | 日数 (整数) |
| `[sampling]` | `detected_flaky_rate` | `detected_flaky_rate_ratio` | 0.0–1.0 |
| `[sampling]` | `detected_co_failure_strength` | `detected_co_failure_strength_ratio` | 0.0–1.0 |
| `[flaky]` | `detection_threshold` | `detection_threshold_ratio` | 0.0–1.0 |
| `[quarantine]` | `flaky_rate_threshold` | `flaky_rate_threshold_percentage` | 0–100 |
| `[profile.*]` | `percentage` | `sample_percentage` | 0–100 |
| `[profile.*]` | `co_failure_days` | `co_failure_window_days` | 日数 (整数) |
| `[profile.*]` | `adaptive_fnr_low` | `adaptive_fnr_low_ratio` | 0.0–1.0 |
| `[profile.*]` | `adaptive_fnr_high` | `adaptive_fnr_high_ratio` | 0.0–1.0 |

`flaky_rate_threshold` の単位解釈も変わりました。以前は `30.0` を「30%」、`0.3` を自動正規化して扱っていましたが、現在はそのまま percentage として解釈します。旧設定が `flaky_rate_threshold = 0.3` だった場合は `flaky_rate_threshold_percentage = 30` にリネームしてください。

範囲検証は `flaker debug doctor` と `flaker policy check` が担当します: `*_ratio` は [0.0, 1.0]、`*_percentage` は [0, 100]、`*_days` / `*_seconds` / `*_count` は非負整数でなければなりません。
