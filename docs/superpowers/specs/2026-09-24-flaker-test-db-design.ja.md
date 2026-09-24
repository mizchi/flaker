# flaker をテスト DB として再定義し、selector などの外部にデータを供給する

- 日付: 2026-09-24
- 状態: design 承認済み / 実装未着手
- English: [2026-09-24-flaker-test-db-design.md](2026-09-24-flaker-test-db-design.md)
- 関連: [mizchi/jev-test-filter](https://github.com/mizchi/jev-test-filter)

## 背景

flaker の表面 API は肥大化している。

- `run --gate` と `run --profile` が同じ概念の別名 (`src/cli/gate.ts`, `src/cli/profile-compat.ts`)
- `apply --emit weekly|incident` と `ops weekly|incident` が重複し、`--incident-*` フラグまで複製されている
- KPI エンジンが 2 系統ある (`src/cli/commands/analyze/kpi.ts` の `computeKpi` と、MoonBit `build_sampling_kpi` 経由の `runSamplingKpi`)
- calibration は `apply --target calibrate` 経由でしか呼べない
- 選択 strategy が 7 種類あり (`random` `weighted` `affected` `hybrid` `gbdt` `coverage-guided` `full`)、adaptive / holdout / cluster / silent fallback と掛け算になっている
- resolver factory (`src/cli/resolvers/index.ts`) は閉じた switch で、外部 selector を差せない
- どのコマンドからも登録されていない dead module が残っている (`commands/gate/`, `commands/policy/`, `commands/collect/{local,coverage}.ts`, `commands/exec/affected.ts`, `commands/setup/`)
- 外部に出せるデータの形が決まっていない。`query` は内部テーブルをそのまま見せ、`explain bundle` / `explain context` / `status --json` はそれぞれ別の形で出力する

一方、jev-test-filter は git diff に対して各テストを Jev モデルで採点し、ランナーのフィルタ引数を出すツールで、テスト選択そのものは flaker より筋が良い。ただし実行時の indirection (plugin registry、DI、名前で読む fixture) で変更に届くテストは静的なソースから見えず、取りこぼすことがある。取りこぼしを見つけてフィードバックする仕組みを jev-test-filter 自身は持っていない。

実測 (flaker 自身、`HEAD~3..HEAD`、7 ファイル変更): 824 テスト中 47 テスト選択、5 リクエスト、5.2 秒、$0.008。選択理由の内訳は `unsure` 37 / `dynamic` 6 / `scored` 3 / `touched` 1 で、選択の大半は `cutoff` ではなく unsure による救済が決めている。

## 方針

**flaker はテスト DB である。** テスト結果を取り込み、安定した identity で束ね、flaky 判定・co-failure・selector の取りこぼしといった派生事実を計算し、決まった形で外に出す。テストの選択は jev-test-filter などの selector に任せ、flaker は selector を呼び出さない。

```
        取り込み (adapters)               公開 dataset (flaker_v1)          利用者
  CI 結果 (junit/playwright/…) ─┐    ┌─ tests            ┌→ jev-test-filter (context)
  jev record                    ├──→ ├─ runs / results   ├→ AI agent (explain bundle)
  local run / mutation trial   ─┘    ├─ flaky            ├→ dashboard / BI (Parquet)
                                     ├─ quarantine       ├→ 他の selector
                                     ├─ co_failures      └→ issue / PR comment
                                     ├─ selector_verdicts / misses
                                     └─ gate_calibration
```

- gate (score → selected の判定) は selector にだけ存在する。flaker は gate パラメータを供給するだけで、判定ロジックは複製しない。
- flaker 自前の選択は API key を持たないユーザー向けに `affected` / `weighted` / `hybrid` / `full` だけ残す。`hybrid` は `init` が merge gate の既定として生成している。holdout は選択ではなく計測 (promotion 判定の根拠) なので残す。

## 3 層構造

1. **保存層 (内部)**: 既存の DuckDB テーブル。スキーマは自由に変えてよい。外部から直接読むことはサポートしない。
2. **公開 dataset 層 (契約)**: DuckDB の `flaker_v1` スキーマに置く view 群。各 dataset は `src/contracts` に JSON Schema を持つ。v1 の中では列の追加だけを許し、列の削除・改名・意味の変更は `flaker_v2` を新設して行う。`flaker query` はこの層を既定の検索対象にする。外部ツールは DuckDB ファイルを直接開いてもよいが、読んでよいのは `flaker_v1.*` だけ。
3. **projection 層 (利用者別)**: dataset を特定の利用者向けの形に変換したもの。最初の組み込み projection は jev-test-filter 向けの `jev-context`。projection は「JSON Schema + 純関数 (dataset の行 → 出力) + fixture テスト」の 3 点セットでコードに登録する。任意 SQL で定義する外部 projection は今回扱わない。

同じ事実を複数の出力が別々に計算しないように、`status` / `explain` / `calibrate` も順次この dataset 層を読む形に寄せる (フェーズ 3)。

## 公開 dataset (flaker_v1)

全 dataset の共通キーは `test_key` (MoonBit `create_stable_test_id` による安定 ID)。

| dataset | 主な列 | 内容 |
|---|---|---|
| `tests` | `test_key`, `suite`, `test_name`, `task_id`, `variant`, `file`, `title_path` (JSON 配列), `first_seen_at`, `last_seen_at` | テストの identity。`file` + `title_path` は selector との突き合わせに使う |
| `runs` | `run_id`, `source` (`ci` / `local` / `mutation`), `workflow_name`, `lane`, `commit_sha`, `branch`, `event`, `is_full`, `created_at` | 実行単位。`is_full` は全テストを実行したランかどうか |
| `results` | `run_id`, `test_key`, `status`, `retry_count`, `duration_ms`, `created_at` | テスト単位の結果 |
| `flaky` | `test_key`, `window_days`, `runs`, `failures`, `flaky_rate`, `is_flaky`, `computed_at` | flaky 判定 |
| `quarantine` | `test_key`, `reason`, `since`, `source` (`auto` / `manual`) | 隔離中のテスト |
| `co_failures` | `changed_file`, `test_key`, `co_failures`, `changes`, `strength`, `window_days` | 「このファイルが変わったときにこのテストが落ちた」の集計 |
| `selector_verdicts` | `selector_run_id`, `selector`, `selector_version`, `head_sha`, `base_sha`, `context_digest`, `source` (`real` / `mutation`), `test_key`, `score`, `confidence`, `reason`, `selected` | selector の判定結果 |
| `misses` | `selector_run_id`, `test_key`, `head_sha`, `ci_run_id`, `reason`, `changed_files` (JSON 配列) | selector が選ばなかったのに full run で真に失敗したテスト |
| `gate_calibration` | `selector`, `calibrated_at`, `cutoff`, `unsure_below`, `unsure_margin`, `records`, `real_failures`, `recall_lb95`, `decision` (`tighten` / `loosen` / `keep`), `rationale` | calibrate の結果の履歴。最新行が現行値 |

`runs.is_full` は `[workflow_lanes]` の lane 定義に `full = true` を書いて決める。未設定の lane は、そのランの結果件数が直近の `tests` 件数の 95% 以上なら full とみなす。

## CLI: 出力

- `flaker export <dataset> [--format json|jsonl|csv|parquet] [--since <date>] [--where <expr>] [-o <file>]`: 汎用の出力経路。
- `flaker export --projection <name> [-o <file>]`: projection の出力。`jev-context` はこれで出す (`flaker export --projection jev-context -o .flaker/context.json`)。独立した `context` コマンドは作らない。
- `flaker query <sql>`: `flaker_v1` を既定の search path にする。内部テーブルを読むには `--internal` が必要。

## CLI: 取り込み

- 取り込みも契約を flaker 側に持つ。selector の判定結果は flaker の `selector-record` v1 で受ける (per-test の `score` / `confidence` / `reason` / `selected` と、`head_sha` / `base_sha` / `context_digest` / 使った gate の値)。
- `flaker import --adapter selector-record <file|dir>` がこの形式をそのまま取り込む。`flaker import --adapter jev <file|dir>` は jev の record v2 を `selector-record` v1 に変換してから取り込む。jev 以外の selector も同じ形式を出せば、そのまま calibrate できる。

## projection: `jev-context` (flaker → jev-test-filter)

```json
{
  "version": 1,
  "digest": "sha256:…",
  "generated_at": "2026-09-24T00:00:00.000Z",
  "gate": {
    "cutoff": 2.0,
    "unsure_below": 0.5,
    "unsure_margin": 1.0,
    "basis": { "records": 42, "real_failures": 17, "recall_lb95": 0.83 }
  },
  "skip": [
    { "file": "tests/a.test.ts", "title_path": ["A", "b"], "reason": "quarantined" }
  ],
  "tests": [
    {
      "file": "tests/cli/init.test.ts",
      "title_path": ["init", "writes toml"],
      "failed_with": ["src/cli/config.ts"],
      "missed": 2
    }
  ]
}
```

- 材料: `gate` は `gate_calibration` の最新行、`skip` は `quarantine`、`tests` は `misses` と `co_failures` から作る。
- テストのキーは `file` + `title_path` (+ Playwright の `project`)。jev の `testId` は行番号を含み commit をまたいで変わるので、キーにしない。
- `digest` は `gate` を除いた `skip` と `tests` の正規化 JSON の sha256。hints が変わると質問が変わるので、record 側にこの digest を残して比較単位にする。
- hints の上限: 1 テストあたり `failed_with` は上位 5 ファイル、hints を持つテスト数は既定 200 件 (token 増加を抑えるため)。
- jev 側の扱い:
  - `tests[].failed_with` は該当テストの `question.instructions.history` にだけ注入する。閾値は書かず事実だけ書く (例: `This test previously failed when src/cli/config.ts changed.`)。jev の「質問に閾値を書かない」原則は守られる。
  - `skip` にあるテストは候補から除外し、`reason: "quarantined"` で報告する。
  - `gate` は既定値として使う。CLI で `--cutoff` などが明示されたらそちらを優先する。

## jev-test-filter 側の変更 (上流)

- `--context <file>`: 上記 projection を読む。
- 成功したランごとに `.jev-test-filter/records/<head_sha>.json` を保存する。`last.json` も従来どおり残す (`--replay` の既定値の互換のため)。
- `RunRecord` を `version: 2` に上げ、`head_sha`, `base_sha`, `context_digest` (context なしなら `null`), `gate` (実際に使った値) を追加する。v1 の読み込みは維持する。 context の `skip` で外したテストの `testId` を `quarantined` として記録し、replay でも quarantine を再現できるようにする。
- fallback したラン (`fallback !== null`) は従来どおり保存しない。
- `unsure_below` / `unsure_margin` を CLI からも指定できるようにする。

## キャリブレーション: `flaker calibrate`

1. **突き合わせ**: `selector_verdicts.head_sha` と同じ commit の full run (`runs.is_full`) を join する。正解集合は「full run で失敗したテスト − `flaky.is_flaky` − `quarantine`」。identity で突き合わせできなかった失敗は `unmatched` として件数と一覧を報告し、miss とは数えない。結果は `misses` に入る。
2. **replay**: jev-test-filter の `./gate` export を使い、`cutoff × unsure_below × unsure_margin` の格子で各 record を offline で再判定する。API は呼ばない。
3. **採用ルール: 締めるのは即時、緩めるのは慎重に**
   - 観測済みの真の失敗を 1 件でも落とす候補は不採用。
   - 現行設定で miss があれば、全ての真の失敗を拾う候補のうち選択数が最小のものに即座に切り替える (`decision = tighten`)。
   - 既定値より緩める (選択数を減らす) のは、`source = real` の真の失敗が `min_failures` 件以上 (既定 20) あって、recall の Wilson 95% 下限が `recall_target` (既定 0.98) 以上のときに限る (`decision = loosen`)。
   - どちらでもなければ現行値を維持し、理由を `rationale` に残す (`decision = keep`)。
   - 同点なら既定値に近い候補を選ぶ。
4. **出力**: 結果は `gate_calibration` に 1 行追加する。ファイルは書かない。`--dry-run` なら行も追加しない。`--json` で機械可読の結果を出す。context ファイルが必要なら続けて `flaker export --projection jev-context` を実行する。

制約: record の score は hints 込みの質問に対する答えで、新しい hints で再採点するには API が要る。hints は該当テストの score を押し上げる方向にしか働かないので、digest が混ざった状態での gate calibrate は保守側に倒れる。レポートは digest ごとに分けて出す。

設定:

```toml
[selector]
type = "jev"
recall_target = 0.98
min_failures = 20
max_hinted_tests = 200
```

gate の値は `flaker.toml` に持たない。正は DB の `gate_calibration` にある。

## mutation による合成評価 (後続フェーズ)

`flaker calibrate --mutate <n>`:

1. 直近 commit の変更ファイルから関数を選び、単純な mutation (比較演算子の反転、boolean return の反転、early return の挿入) を当てる
2. 一時 worktree で full suite を実行し、結果を `runs.source = mutation` で取り込む
3. 同じ mutation diff に対して jev-test-filter を実行し、判定を `selector_verdicts.source = mutation` で取り込む
4. 一時 worktree を消す。利用者の作業ツリーには触らない

レポートは real と mutation を分けて出す。mutation は実際の変更と分布がずれるので、採用ルールの「緩める」条件には real の件数だけを使い、mutation は「締める」根拠にだけ使う。

## flaker CLI の整理後の形

| 残す / 新設 | 統合 / 削除 |
|---|---|
| `init` `import` `status` `query` `doctor` | `run --profile` を削除して `--gate` に一本化。設定も `[profile.local\|ci\|scheduled]` → `[gate.iteration\|merge\|release]`、環境変数も `FLAKER_PROFILE` → `FLAKER_GATE`。旧形式は移行案内付きで hard error |
| **`export`** (dataset と projection の出力) | `apply --emit` / `--target` / `--incident-*` を削除し、`ops` group も撤去 |
| **`calibrate`** (トップレベル化) | strategy `random` `gbdt` `coverage-guided`、`cluster_mode`、`model_path`、adaptive 系キー、`[coverage]`、`dev train` |
| **`import --ci [--days <n>]`** (CI artifact の収集。`apply --target collect_ci` の置き換え) | `dev` は公開面から外し、隠しコマンドにする |
| `run` (`affected` / `weighted` / `hybrid` / `full`、`fallback_strategy` と holdout は維持) | `explain context` と `explain bundle` は `export --projection` に移す (フェーズ 2 の後) |
| `quarantine` `debug` `explain` | dead module (`commands/gate/`, `commands/policy/`, `commands/collect/{local,coverage}.ts`, `commands/exec/affected.ts`, `registerAnalyzeCommands`) を削除 |
| `plan` / `apply` (reconcile のみ) | KPI は MoonBit `build_sampling_kpi` に一本化 (dataset 層に載せ替えるフェーズ 2 以降) |

`commands/setup/init.ts` は `flaker init` の実装なので dead ではない。`init` のヘルプにある `setup init` への言及だけを消す。

## フェーズ

1. **jev-test-filter 上流**: `--context`、per-SHA record (`RunRecord` v2)、unsure 系の CLI flag。minor リリース (0.2.0)。
2. **flaker テスト DB 層 + jev 連携 (追加のみ)**: `flaker_v1` の 9 dataset と JSON Schema、`export`、`import --adapter selector-record|jev`、`calibrate`、`jev-context` projection。minor リリース。
3. **flaker 表面整理 (破壊的変更)**: 上表の統合と削除と migration guide (`docs/migration-*.md` / `.ja.md`)。dataset 層に依存しない部分 (gate への一本化、strategy 削除、`calibrate` / `import --ci`、`apply` / `ops` / `dev` の整理、dead module 削除) はフェーズ 2 を待たずに先行してよい。`explain` の移設、`status` の載せ替え、KPI の一本化はフェーズ 2 の後に行う。
4. **mutation 評価**: `calibrate --mutate`。

各フェーズは別 PR にする。フェーズ 2 はフェーズ 1 のリリースに依存し、フェーズ 3 と 4 は互いに独立している。

## テスト方針

- 契約: `flaker_v1` の各 dataset、`selector-record` v1、`jev-context` v1、jev record v2 の JSON Schema を置き、fixture を検証する。
- dataset: 保存層に fixture を入れて view を読み、Schema に合うこと、`is_full` の判定、`misses` の導出 (flaky / quarantine / unmatched の除外) をテストする。
- calibrate の中核は純関数 (records + 正解集合 + 現行 gate → 採用 gate + 理由) にし、表形式テストで採用ルールを網羅する (miss あり → 即時に締める / 件数不足 → 維持 / 条件成立 → 緩める / mutation は緩める根拠にならない)。
- projection: dataset の行 → `jev-context` の純関数として、hints の上限と順位付け、digest の安定性をテストする。
- E2E: `dev eval-fixture` 系で CI run と jev record を合成し、import → calibrate → export → jev replay の一周が回ることを確認する。
- jev 側: context 注入後の question の snapshot、`skip` の除外、CLI 引数が context に勝つこと、record v2 の保存と v1 の読み込み互換をテストする。

## 決めないこと

- jev 以外の selector と projection の実装 (契約は開いているので後から足せる)
- 任意 SQL による外部 projection の定義
- flaker が selector を spawn する経路 (flaker `run` に jev を組み込むこと)
- hints の自然言語テンプレートの最適化 (まず 1 文の固定テンプレートで始める)
