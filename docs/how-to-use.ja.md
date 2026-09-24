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
node ../flaker/scripts/dev-cli.mjs run --dry-run --gate iteration --changed src/foo.ts
node ../flaker/scripts/dev-cli.mjs run --gate iteration --changed src/foo.ts
node ../flaker/scripts/dev-cli.mjs status --markdown --output .artifacts/flaker-review.md

# flaker 自体を触った直後に build を強制したいとき
node ../flaker/scripts/dev-cli.mjs --rebuild run --gate iteration --changed src/foo.ts
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
flaker import --ci --days 30
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
flaker status --list flaky

# AI が分析して推奨アクションを提示
flaker explain reason

# テストスイートの健全性スコア
flaker status --markdown
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
path = ".flaker/data"      # DuckDB のファイル 1 つ

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

flaker apply          # 差分を埋めるために import --ci / calibrate / cold-start run / quarantine apply を自動実行
flaker apply --json
flaker apply --output .artifacts/flaker-apply.json # ApplyArtifact を保存

flaker apply --refresh-only          # probe + diff + plan のみ実行 (execution はしない)
flaker apply --plan-file plan.json   # 保存済み PlanArtifact を実行
```

`flaker.toml` を **desired state** とみなし、現在の DB 状態を見て「何をすべきか」を planner が組み立てる。履歴ゼロの新規 repo なら `collect_ci` + `cold_start_run` が、十分な履歴があれば `collect_ci` + `calibrate` + `quarantine_apply` が選ばれる。ユーザー側が順序を覚える必要はない。

`[promotion]` セクションの閾値と現状の KPI を突き合わせて `flaker status` がドリフトを表示する。

#### `--json` 出力シェイプ

`flaker apply --json`:

- `executed[*].status`: `"ok" | "failed" | "skipped"`
- `executed[*].skippedReason?: string`: dependency 失敗で skip されたときの理由
- exit code は `status === "failed"` のみ 1、skipped は 0
- 0.13.0 で `ApplyArtifact` JSON のトップレベル `emitted` フィールドは削除

`flaker status --json` の `drift.unmet[*]` は `{ kind, desired }` 形式。

#### 週次 / インシデント対応 (0.13.0)

旧 cadence artifact 用サブコマンド群は 0.13.0 で全廃されました (詳細は [docs/migration-0.12-to-0.13.ja.md](migration-0.12-to-0.13.ja.md))。代わりに:

- 日次/週次レビュー: `flaker apply && flaker status --markdown > .artifacts/flaker-review.md`、閾値ドリフトの narrative は `flaker explain insights`
- インシデント調査: `flaker debug retry` / `flaker debug confirm` / `flaker debug diagnose`

### `flaker import --ci` — CI からデータ収集

```bash
flaker import --ci                                           # 直近 30 日分
flaker import --ci --days 90                                 # 直近 90 日分
flaker import --ci --branch-filter main                      # main ブランチのみ
```

GitHub Actions の artifact からテストレポートを自動抽出します。既定の artifact 名は `playwright` が `playwright-report`、`junit` が `junit-report`、`vrt-migration` が `migration-report`、`vrt-bench` が `bench-report` です。workflow 側で別名を使う場合は `[adapter].artifact_name` で上書きします。`GITHUB_TOKEN` 環境変数が必要です。

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

### `flaker import --adapter selector-record|jev` — selector の判定

テスト selector は、変更ごとにどのテストを走らせるかを決めます。flaker はその判定を保存し、実際に落ちたテストと突き合わせます (`selector_verdicts`、`misses`)。取り込む形式は `selector-record` v1 です。変更 1 件につき JSON オブジェクト 1 つで、selector 名、`head_sha`、判定時の gate の値、テストごとの `file`・`title_path`・`score`・`confidence`・`reason`・`selected` を持ちます。型、JSON Schema、parser は `@mizchi/flaker/contracts/selector-record-v1` から export しています ([`src/cli/contracts/selector-record-v1.ts`](../src/cli/contracts/selector-record-v1.ts))。

```bash
# selector-record v1 を直接書く selector
flaker import selector-record.json --adapter selector-record

# jev-test-filter の run record を、jev 自身の gate で変換して取り込む
flaker import .jev-test-filter --adapter jev
```

- パスはファイルでもディレクトリでも構いません。ディレクトリなら直下の `*.json`、続いて `records/*.json` を取り込みます (jev-test-filter の配置)。`last.json` は最新 record のコピーなので duplicate として数えます。
- record は内容で識別します。同じ record を再度取り込んでも何も変わらず、duplicate と報告されます。
- すべてのテストを走らせる fallback になった jev record (`fallback` あり) は判定を持たないので skip します。
- 不正なファイルやデータベースが受け付けなかったファイルは stderr に報告し、残りは取り込みます。その場合の終了コードは 1 です。record が 1 つもないディレクトリは警告を出し、終了コード 0 で終わります。
- 各テストは `file` + `title_path` (+ `project`) で既知の `test_key` に照合します。flaker がまだ見ていないテストは `test_key = null` のまま `selector_verdicts` に残り、結果が入った後の次の selector import (または `flaker calibrate --selector`) で照合されます。

### `flaker export` — 公開 dataset (flaker_v1)

ストレージのテーブルは内部実装で、どのリリースでも変わりえます。バージョン付きで公開しているのは DuckDB の `flaker_v1` スキーマにある 9 つの dataset で、それぞれの JSON Schema を `@mizchi/flaker/contracts/flaker-v1-datasets` から export しています。全 dataset の共通キーは安定テスト ID の `test_key` です。

| dataset | 内容 |
|---|---|
| `tests` | テストの identity。`suite`, `test_name`, `task_id`, `variant`, `file`, `title_path` (JSON 配列), 初出と最終観測。`file` + `title_path` は selector との突き合わせに使う |
| `runs` | 実行単位。`source` (`ci` / `local` / `mutation`), `workflow_name`, `lane`, `commit_sha`, `branch`, `event`, `is_full` (全テストを実行したランか) |
| `results` | テスト単位の結果。`run_id`, `test_key`, `status`, `retry_count`, `duration_ms` |
| `flaky` | flaky 判定。`window_days`, `runs`, `failures`, `flaky_rate`, `is_flaky`。`failures` は一度でも失敗した結果の数。`flaky_rate` が数えるのは flaky の証拠 (retry で通った結果、`flaky` status、同じ commit で pass もしている失敗) だけなので、単なる regression は `flaky_rate = 0` になる |
| `quarantine` | 隔離中のテスト。`reason`, `since`, `source` (`auto` / `manual`) |
| `co_failures` | 「このファイルが変わったときにこのテストが落ちた」の集計。`changed_file`, `co_failures`, `changes`, `strength`。`changes` は window 内でそのファイルを変更し、かつそのテストの結果がある commit の数。`co_failures` はそのうちテストが一度でも失敗した commit の数。commit 上の失敗 1 件で数え、その commit が変更した全ファイルに計上する |
| `selector_verdicts` | selector のテストごとの判定。`score`, `confidence`, `reason`, `selected` |
| `misses` | selector 自身の取りこぼし。selector が選ばなかったのに同じコミットの full run で実際に失敗したテストで、判定 1 件につき 1 行。採点するのは `real` の selector run と real の full run の組だけで、`head_sha` ごとに最新の selector run だけを数えるので、同じコミットで selector を走らせ直しても取りこぼしは重複しない。record 自身が quarantine していた判定 (`reason = quarantined`) は取りこぼしに含めない。mutation の採点は mutation フェーズで入る |
| `gate_calibration` | selector gate の calibrate 結果の履歴。最新行が現行値 |

`source = mutation` のランは `flaky`・`co_failures`・`misses` に一切入りません。

安定性のルール: `flaker_v1` の中では列の追加だけを行います。列の削除・改名・意味の変更は `flaker_v2` を新設して行います。外部ツールが `.duckdb` ファイルを直接開くのは構いませんが、読むのは `flaker_v1.*` だけにして、ストレージのテーブルは読まないでください。

```bash
flaker export tests --format jsonl
flaker export runs --since 2026-09-01 --format csv -o runs.csv
flaker export results --format parquet -o .flaker/export/results.parquet
flaker query "SELECT * FROM flaker_v1.flaky WHERE is_flaky"
```

- `--format` は `json` (既定、配列), `jsonl`, `csv` (ヘッダは schema の列順、配列とオブジェクトは JSON 文字列、null は空セル、空文字列は `""`), `parquet` (`-o` が必須) のいずれかです。
- 時刻は UTC です。JSON と CSV では末尾が `Z` の ISO 文字列になります。Parquet ではタイムゾーンなしの `TIMESTAMP` (`isAdjustedToUTC = false`) に UTC の時刻がそのまま入るので、UTC として読んでください。JSON 列 (`variant`, `title_path`, `changed_files`) は JSON 論理型の Parquet 文字列です。
- `--since <date>` は ISO 日付以降の行だけを残します。日付だけ (`2026-09-01`) なら UTC の 0 時です。日時にはオフセットが必要で (`2026-09-01T09:00:00Z` や `…+09:00`)、`2026-02-30` のような存在しない日付は拒否します。使えるのは `tests` (`last_seen_at`), `runs` と `results` (`created_at`), `quarantine` (`since`), `selector_verdicts` (`created_at`), `gate_calibration` (`calibrated_at`) で、それ以外の dataset ではエラーになります。
- `--where <expr>` は dataset 自身の列に対する追加条件で、たとえば `--where "status = 'failed'"` です。行単位の式 1 つに限り、サブクエリ・`;`・コメント・ファイルシステム関数は拒否します。DuckDB がクエリ全体を先に構文解析し、選んだ dataset への条件 1 つのままであることを確かめます。また export 中は DuckDB のファイルアクセスを `-o` の Parquet ファイル以外すべて切ります。
- 不正な入力 (未知の dataset や format、時刻列のない dataset への `--since`、安全でない `--where`) は終了コード 2 で終わります。

#### `[workflow_lanes]` と `runs.is_full`

`[workflow_lanes]` は workflow の名前またはパスを lane に対応づけます。値をテーブルにすると、その lane が全テストを実行するかどうかも書けます:

```toml
[workflow_lanes]
"ci.yml" = "sampled"
"nightly.yml" = { lane = "full-batch", full = true }
```

`full = true` の lane のランは `runs.is_full = true` になり、`full = false` なら常に `false` です。`full` の指定がない lane では、同じ workflow の直近 `[flaky].window_days` のランのうち最大のもの (そのラン自身を含む) と比べて、テスト数が 95% 以上あるランを full とみなします。テストの改名や削除があっても、その後の full run が partial に見えることはありません。

### `flaker prune` — 保持期間

```bash
flaker prune --older-than 180 --dry-run   # 消える量を確認
flaker prune --older-than 180             # 削除して CHECKPOINT
```

`flaker prune` は `--older-than <days>` より古い履歴を、テーブル間の整合を保って削除します。workflow run はその結果と collected artifact ごと、selector record はその verdict ごと、sampling run はそのテストごと消し、commit changes は残る run や selector record がそのコミットを参照しなくなったものだけを消します。gate calibration は selector ごとの最新行を残します。quarantine・coverage・設定は状態なので残します。削除後に CHECKPOINT し、テーブルごとの削除件数を表示します (`--dry-run` は何も消さずに削除予定件数を表示、`--json` は同じ内容を JSON で出力)。

`<days>` は `max(90, [sampling].co_failure_window_days) + [flaky].window_days` 以上 (既定で 104) が必要です。90 日は既定の窓で最長のもの (`calibrate --window-days`, `calibrate --selector --window-days`, `explain insights`) で、run の `is_full` は同じ workflow の flaky window 分さかのぼった run と比べて決まるためです。短い値は終了コード 2 になります。`calibrate` に長めの `--window-days` を渡している場合は、その日数 + flaky window 以上を残してください。DuckDB はシングルライターなので、他の flaker コマンドがデータベースを開いていない場所 (データベースを持っている定期ジョブなど) で実行してください。

### jev-test-filter による selector の calibration

手順を追った導入は [flaker と jev-test-filter を組み合わせる](jev-test-filter-integration.ja.md) を見てください。この節はリファレンスです。

flaker は selector の判定を、同じコミットの full run で実際に分かった結果と突き合わせ、その証拠から selector の gate を調整します。[jev-test-filter](https://github.com/mizchi/jev-test-filter) との流れは次のとおりです。

```bash
jev-test-filter --context .flaker/context.json …        # .jev-test-filter/records/<sha>.json を書く
flaker import .jev-test-filter --adapter jev
flaker import --ci                                       # 同じコミットの full run
flaker calibrate --selector                              # gate_calibration に追記
flaker export --projection jev-context -o .flaker/context.json
```

`flaker calibrate --selector [name]` は real な selector record を、その `head_sha` の full run と結合します。`head_sha` ごとに最新の record だけを数えるので、同じコミットで selector を何度走らせても同じ regression を重ねて数えません。mutation の record は対象外です。正解はその run で落ちたテストから flaky と quarantine を除いたものです。record 自身が quarantine していたテストの失敗は selector の取りこぼしではないので、別に数えて報告します。そのうえで、すべての record を jev 自身の gate (`jev-test-filter/gate` を bundle したもの、API 呼び出しなし) で `cutoff × unsure_below × unsure_margin` の grid にわたってオフライン再判定します。採用規則は「締めるのは即座に、緩めるのは慎重に」です。現在の gate が失敗を取りこぼしていれば、即座に切り替えます (`tighten`)。切り替え先は、すべての record で現在の gate が選ぶテストをすべて選び続ける候補に限り、その中から取りこぼしが最も少なく、次に選択テスト数が最も少ないものを選びます。すべての失敗を拾う候補がなくても、現在の gate より取りこぼしが少ない候補があれば、その中で最も少ないものを採用します。取りこぼしを減らせる候補がなければ、テストを多く選んでも拾えないので gate を維持し、取りこぼしを報告します。選択テストを減らす (`loosen`) には、取りこぼしがゼロで、real な失敗が `min_failures` 件以上あり、recall の Wilson 95% 下限が `recall_target` 以上である必要があります。どちらでもなければ現状を維持し、理由を `rationale` に残します (`keep`)。同点なら jev の既定値に近い候補を選びます。1 回の実行で `gate_calibration` に 1 行追記します。`--dry-run` は何も追記せず、`--json` は結果を snake_case のキーの JSON で出力します (`decision.real_failures`、`decision.recall_lb95`、`decision.rationale`、`without_full_run`、`unmatched`)。どの判定にも照合できない失敗は `unmatched` として一覧にし、取りこぼしには数えません。レポートは context digest ごとにも分けて出します。

この下限は見た目より厳しい条件です。real な失敗 n 件をすべて拾えたとき、Wilson 95% 下限は n / (n + 3.8415) で、20 件なら 0.839、35 件なら 0.901、50 件なら 0.929 です。緩めるには取りこぼしがゼロでなければならないので、既定の `recall_target = 0.90` では少なくとも 35 件の real な失敗をすべて拾っている必要があり、`min_failures = 20` より多くなります。緩めるのを見送ったときは rationale にそう書きます。`recall_target = 0.98` なら 189 件が必要です (189 件で 0.9801、188 件では 0.9800 に届きません)。

`flaker export --projection jev-context` は、jev-test-filter が `--context` で読む context を書き出します。中身は `gate_calibration` の最新の gate とその根拠、`skip` (quarantine 中のテスト)、`tests` (hint: selector がそのテストを取りこぼしたコミット数と、一緒に落ちたファイル最大 5 件。`co_failures` のうち同時失敗 2 回以上のもの) です。flaky と quarantine 中のテストには hint を付けません。`digest` は `skip` と `tests` だけの sha256 なので、gate が変わっても変わりません。型と JSON Schema は `@mizchi/flaker/contracts/jev-context-v1` から export しています。context を読むには jev-test-filter 0.1.3 以降が必要です。projection は常に JSON で、`--format`・`--since`・`--where`・dataset 引数を付けると終了コード 2 になります。

```toml
[selector]
type = "jev"             # 唯一の selector
recall_target = 0.90     # 緩めるのに必要な recall の Wilson 95% 下限
min_failures = 20        # 緩めるのに必要な real な失敗の件数
max_hinted_tests = 200   # jev-context の tests[] の上限
```

gate の値 (`cutoff`・`unsure_below`・`unsure_margin`) は `flaker.toml` には置きません。`[selector]` にそれらを書くとエラーになります。正本はデータベースの `gate_calibration` で、その最新行が現在の gate です。

### flaky テスト一覧 — `flaker status --list flaky`

0.7.0 以前の `flaker analyze flaky` は 0.8.0 で削除。flaky テスト一覧は `flaker status --list flaky` に統合済み。

```bash
flaker status --list flaky                 # 上位 flaky テスト一覧
flaker status --list flaky --json          # 機械可読
```

旧 `analyze flaky` の `--top` / `--test` / `--true-flaky` / `--trend` / `--by-variant` に相当する詳細切り口は、現状 `flaker query "SELECT ..."` で SQL を直接叩くか、`flaker explain insights` で AI 分析に委ねる。

### `flaker explain <topic>` — AI 分析

旧 `flaker analyze reason/insights/cluster/bundle/context` は 0.8.0 で `flaker explain <topic>` umbrella に集約。5 つの分析トピックを提供する。

#### `explain reason` — flaky 分類と推奨アクション

```bash
flaker explain reason                     # 分類 + 推奨レポート
flaker explain reason --json              # 機械可読 JSON
flaker explain reason --window-days 7     # 直近 7 日間で分析
```

`reason` が返す分類:

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

#### `explain insights` — sampling KPI からの adaptive insights

```bash
flaker explain insights
flaker explain insights --json
```

sampling effectiveness / false negative rate の変動から、閾値の見直し候補を提示する。

#### `explain cluster` — 同時失敗クラスタ

co-failure クラスタ検出。詳細は [co-failure クラスタリング](#co-failure-クラスタリング-flaker-explain-cluster) 節を参照。

```bash
flaker explain cluster --min-co-rate 0.9
flaker explain cluster --window-days 30 --top 50
flaker explain cluster --json
```

#### `explain bundle` — bundle 単位の失敗集約

同一 bundle (suite のプレフィクス等) で連動して失敗するテスト群を要約。共有 fixture / env 問題の候補を特定する。

```bash
flaker explain bundle
```

#### `explain context` — 失敗 context 抽出

失敗テストから error message / stdout / stderr / artifact path を切り出し、類似 context のクラスタを提示。

```bash
flaker explain context
flaker explain context --test "handles timeout"
```

### `flaker run --dry-run` — テストサンプリング（dry run）

```bash
flaker run --dry-run --strategy weighted --count 20      # flaky 優先
flaker run --dry-run --strategy affected                 # 変更影響のみ
flaker run --dry-run --strategy hybrid --count 50        # ハイブリッド（推奨）
flaker run --dry-run --gate iteration --changed src/foo.ts
flaker run --dry-run --percentage 30                     # 全テストの 30%
flaker run --dry-run --skip-quarantined                  # quarantine 除外
```

#### サンプリング戦略

| 戦略 | 説明 |
|------|------|
| `weighted` | flaky rate で重み付け (flaky なテストほど選ばれやすい) |
| `affected` | `git diff` から変更影響テストを特定 |
| `hybrid` | affected + 前回失敗 + 新規テスト + weighted random (Microsoft TIA 方式) |
| `full` | 全件実行 |

`random` / `gbdt` / `coverage-guided` 戦略は 0.13.0 で削除されました。詳細は [docs/migration-0.12-to-0.13.ja.md](migration-0.12-to-0.13.ja.md)。

### `flaker run` — サンプリング + 実行

```bash
flaker run --strategy hybrid --count 50
flaker run --strategy affected
flaker run --gate iteration --changed src/foo.ts
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

### Execution Gates

`flaker run` は `[gate.<name>]` から設定を継承します（実行せずサンプリングのみ行う場合は `--dry-run` を使用）。`[profile.*]` / `--profile` / `FLAKER_PROFILE` は 0.13.0 で削除されました — 詳細は [docs/migration-0.12-to-0.13.ja.md](migration-0.12-to-0.13.ja.md)。

```toml
[gate.release]
strategy = "full"

[gate.merge]
strategy = "hybrid"
sample_percentage = 30

[gate.iteration]
strategy = "affected"
max_duration_seconds = 60
fallback_strategy = "weighted"
```

ローカルでは次のループが扱いやすいです:

```bash
flaker run --dry-run --gate iteration --changed src/foo.ts
flaker run --gate iteration --changed src/foo.ts
```

`gate.iteration` で `affected` 選択、`weighted` への fallback、time budget 制御をまとめて扱うのが、dogfood と日常開発の両方で実用的です。

`adaptive` (自動チューニング) キーは 0.13.0 で削除されました。代わりに `flaker calibrate` を定期実行してください。

### フラグの優先順位

```
Resolution order (highest to lowest):
  1. Explicit CLI flag          (--strategy, --percentage, --count)
  2. [gate.<name>] in flaker.toml      (via --gate or auto-detection)
  3. [sampling] in flaker.toml         (project default)
  4. Built-in defaults

Notes:
  --count overrides --percentage when both are given
  --changed overrides git auto-detection
  --dry-run suppresses execution, still records selection telemetry
  --explain can be combined with --dry-run or a real run
```

`--count` と `--percentage` を同時に指定した場合は `--count` が優先されます。`--changed` は git の自動検出を上書きします。`--dry-run` は実行を抑制しますが、選択結果はテレメトリに記録されます。`--explain` は dry-run でも実際の実行でも併用できます。

### co-failure クラスタリング (`flaker explain cluster`)

> **0.13.0 の変更点:** sampling 時に代表 1 本を選ぶ `[sampling].cluster_mode` (`spread` / `pack`) は `model_path` と共に削除されました。以下の co-failure クラスタ**分析** (`flaker explain cluster`) は影響を受けません — これは sampling の挙動ではなく read-only なレポートです。

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

### Coverage-guided sampling (0.13.0 で削除)

`[coverage]`、`flaker collect coverage`、`coverage-guided` 戦略は 0.13.0 で削除されました。[Coverage-Guided Test Sampling](coverage-guided-sampling.md) (歴史的資料として保持) と [docs/migration-0.12-to-0.13.ja.md](migration-0.12-to-0.13.ja.md) を参照。

### quarantine の管理 — `flaker apply` + `[quarantine].auto`

0.7.0 以前の `flaker policy quarantine` / `flaker quarantine suggest|apply` は 0.8.0 で削除。quarantine は宣言的に扱う:

```toml
[quarantine]
auto = true                              # 閾値超えは apply が自動で隔離
flaky_rate_threshold_percentage = 30
min_runs = 10
```

`flaker apply` が履歴に応じて quarantine 提案 + 適用を内包する (`QuarantineAction`)。

- 一覧: `flaker status --list quarantined`
- 手動 override が必要な場合は `.flaker/quarantine-manifest.toml` を直接編集してコミット (apply は既存 manifest を尊重する)
- 実行時の除外は引き続き `flaker run --skip-quarantined`

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

### 健全性評価 — `flaker status --markdown`

0.7.0 以前の `flaker analyze eval` は 0.8.0 で削除。同等の出力は `flaker status --markdown` に統合:

```bash
flaker status --markdown                                           # 週次レビューに貼れる Markdown summary
flaker status --markdown --output .artifacts/flaker-review.md      # ファイルに保存
flaker status --detail --markdown                                  # drift 詳細セクション付き
flaker status --gate merge --detail --markdown                     # merge gate の詳細のみに絞る
```

0-100 の Health Score、flaky 件数、matched commits、correlation 等は全て `flaker status` 側に移植済。`--markdown` は週次レビュー向けテーブル、`--json` は機械可読。

### `flaker query` — SQL で直接分析

0.7.0 以前の `flaker analyze query` は 0.7.0 で top-level `flaker query` に昇格、0.8.0 でサブコマンド形は削除。

```bash
flaker query "SELECT suite, test_name, status, COUNT(*) as cnt
              FROM test_results
              GROUP BY suite, test_name, status
              ORDER BY cnt DESC
              LIMIT 20"
```

DuckDB に直接 SQL を投げられます。ウィンドウ関数、FILTER 句など DuckDB の分析機能をフル活用できます。

クエリが見られるのは flaker のデータベースだけです。実行前に DuckDB の external access を切るので、`read_csv(…)` や `FROM 'file.parquet'` などでファイルは読めません。データを外に出すときは `flaker export` を使ってください。データベースは読み取り専用で開き、受け付けるのは 1 文だけです（末尾の `;` は可）。`SELECT 1; CREATE TABLE …` のような複文は拒否され、どの文もデータベースを変更できません。

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

flaky-tag の add/remove 提案機能 (旧 `ops` コマンド群が出力していたもの) は `ops` と共に 0.13.0 で削除されました。`flaker status --list flaky` で候補を確認し、手動でタグ付けしてください。

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
```

workflow path は `[runner.actrun].workflow` から解決されます。.github/workflows/ci.yml のような repo 相対 path を明示し、git worktree を使わないローカル実行では `local = true` を付けてください。

---

## 典型的なワークフロー

### 日常の開発

```bash
# 朝: CI データを最新化
flaker import --ci --days 7

# コード変更後: inspect → sample → run を iteration gate で回す
flaker run --dry-run --gate iteration --changed src/foo.ts
flaker run --gate iteration --changed src/foo.ts

# 全体の状態確認
flaker status --markdown
```

### flaky テスト対応

```bash
# 問題のあるテストを特定
flaker explain reason

# 重症なものを隔離 (apply は [quarantine].auto を尊重する)
flaker apply

# 原因コミットを特定
flaker debug bisect --test "問題のテスト名"

# 修正後、.flaker/quarantine-manifest.toml を編集して該当行を削除
```

### CI での活用

```yaml
# .github/workflows/flaker.yml
- name: Collect & Analyze
  run: |
    flaker import --ci --days 7
    flaker status --json --output flaker-report.json
    flaker explain reason --json > flaker-reason.json

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
| `[profile.*]` (0.13.0 より前) | `percentage` | `sample_percentage` | 0–100 |
| `[profile.*]` (0.13.0 より前) | `co_failure_days` | `co_failure_window_days` | 日数 (整数) |

`co_failure_window_days` (`[sampling]` または `[gate.*]`) は co-failure 履歴をどこまで遡って読むかを決める。効くのは `weighted` と `hybrid` の並び順だけで、変更ファイルがあるときに限る。純粋な `affected` gate では使われない (ただし `fallback_strategy` が `weighted` / `hybrid` なら、その fallback で使われる)。

`flaky_rate_threshold` の単位解釈も変わりました。以前は `30.0` を「30%」、`0.3` を自動正規化して扱っていましたが、現在はそのまま percentage として解釈します。旧設定が `flaky_rate_threshold = 0.3` だった場合は `flaky_rate_threshold_percentage = 30` にリネームしてください。

範囲検証は `flaker doctor` が担当します: `*_ratio` は [0.0, 1.0]、`*_percentage` は [0, 100]、`*_days` / `*_seconds` / `*_count` は非負整数でなければなりません。

### 0.13.0 のリネームと削除

`0.13.0` で `[profile.*]` セクションは `[gate.*]` にリネームされ、adaptive sampling は全廃されました。カスタム profile 名 (`local` / `ci` / `scheduled` 以外) に対応する gate はありません。

| 旧 (0.12.x) | 新 (0.13.0) |
|---|---|
| `[profile.local]` | `[gate.iteration]` |
| `[profile.ci]` | `[gate.merge]` |
| `[profile.scheduled]` | `[gate.release]` |
| `run --profile <name>` | `run --gate <name>` |
| `FLAKER_PROFILE=<name>` | `FLAKER_GATE=<name>` |

`0.13.0` で完全に削除 (リネーム先なし。キー自体を削除する):

- `adaptive`, `adaptive_fnr_low_ratio`, `adaptive_fnr_high_ratio`, `adaptive_min_percentage`, `adaptive_step` — 代わりに `flaker calibrate` を定期実行する
- `cluster_mode`, `model_path`
- `[coverage]` (セクションごと)
- `strategy = "random"`, `strategy = "gbdt"`, `strategy = "coverage-guided"` (および対応する `fallback_strategy` の値) — `weighted` / `affected` / `hybrid` / `full` を使う

これらのキーを含む `flaker.toml` は、該当キー名と置き換え先 (または削除指示) を明示したエラーで起動を拒否します。詳細とエラー文の実例は [docs/migration-0.12-to-0.13.ja.md](migration-0.12-to-0.13.ja.md) を参照。

---

## Advanced / Maintainer tools

通常の日常利用では不要なメンテナ向けコマンド群。`dev` は `--help` からは隠れていますが実行は可能です。

`flaker dev train` (GBDT モデル学習) は `gbdt` 戦略と共に 0.13.0 で削除され、代替コマンドはありません。`flaker dev tune` (co-failure alpha の自動チューニング) と `flaker dev eval-co-failure` は影響を受けません。
