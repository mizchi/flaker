# flaker を selector へのコンテキスト供給層として再定義する

- 日付: 2026-09-24
- 状態: design 承認済み / 実装未着手
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

一方、jev-test-filter は git diff に対して各テストを Jev モデルで採点し、ランナーのフィルタ引数を出すツールで、テスト選択そのものは flaker より筋が良い。ただし実行時の indirection (plugin registry、DI、名前で読む fixture) で変更に届くテストは静的なソースから見えず、取りこぼすことがある。取りこぼしを見つけてフィードバックする仕組みを jev-test-filter 自身は持っていない。

実測 (flaker 自身、`HEAD~3..HEAD`、7 ファイル変更): 824 テスト中 47 テスト選択、5 リクエスト、5.2 秒、$0.008。選択理由の内訳は `unsure` 37 / `dynamic` 6 / `scored` 3 / `touched` 1 で、選択の大半は `cutoff` ではなく unsure による救済が決めている。

## 方針

**テストの選択は jev-test-filter、履歴・判定・キャリブレーションは flaker。** flaker は selector を呼び出さない。両者はファイル 2 つでつながる。

```
flaker (知識 + キャリブレーション)          jev-test-filter (選択 + 実行)
──────────────────────────────           ─────────────────────────────
CI 結果 / jev record の import  ──┐
flaky 判定 / quarantine           │
miss (jev が落とした真の失敗) 抽出  ├─→ context.json ──→ --context <file>
gate パラメータ calibrate          │
                                  └── ← records/<head_sha>.json
```

- gate (score → selected の判定) は jev にだけ存在する。flaker は gate パラメータを供給するだけで、判定ロジックは複製しない。
- flaker 自前の選択は API key を持たないユーザー向けに `affected` と `weighted` (と `full`) だけ残す。

## 契約 A: `context.json` (flaker → jev)

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

- テストのキーは `file` + `title_path` (+ Playwright の `project`)。jev の `testId` は行番号を含み commit をまたいで変わるので、キーにしない。
- `digest` は `gate` を除いた `skip` と `tests` の正規化 JSON の sha256。hints が変わると質問が変わるので、record 側にこの digest を残して比較単位にする。
- jev 側の扱い:
  - `tests[].failed_with` は該当テストの `question.instructions.history` にだけ注入する。閾値は書かず事実だけ書く (例: `This test previously failed when src/cli/config.ts changed.`)。jev の「質問に閾値を書かない」原則は守られる。
  - `skip` にあるテストは候補から除外し、`reason: "quarantined"` で報告する。
  - `gate` は既定値として使う。CLI で `--cutoff` などが明示されたらそちらを優先する。
- JSON Schema は flaker の `src/contracts` に置き、両 repo の fixture テストから参照する。

## 契約 B: record (jev → flaker)

- jev は成功したランごとに `.jev-test-filter/records/<head_sha>.json` を保存する。`last.json` も従来どおり残す (`--replay` の既定値の互換のため)。
- `RunRecord` を `version: 2` に上げ、次を追加する: `head_sha`, `base_sha`, `context_digest` (context なしなら `null`), `gate` (実際に使った `cutoff` / `unsure_below` / `unsure_margin`)。
- fallback したラン (`fallback !== null`) は従来どおり保存しない。
- flaker は `flaker import --adapter jev <file|dir>` で取り込み、新テーブル `selector_runs` / `selector_verdicts` に入れる。jev は flaker `run` と独立に動くので、`sampling_runs` / `sampling_run_tests` とは分ける。

```
selector_runs(id, selector, selector_version, head_sha, base_sha, context_digest,
              cutoff, unsure_below, unsure_margin, created_at, source)   -- source: real | mutation
selector_verdicts(run_id, suite, test_name, task_id, title_path, score, confidence,
                  reason, selected)
```

`suite` / `test_name` への写像は adapter が担当する (vitest なら `file` と `title_path.join(" > ")`)。flaker の stable test identity (`resolve_test_identity`) を通す。

## キャリブレーション: `flaker calibrate`

1. **突き合わせ**: `selector_runs.head_sha` と同じ commit の CI full run (`workflow_runs.source = 'ci'`) を join する。正解集合は「CI で失敗したテスト − flaky 判定 − quarantined」。identity で突き合わせできなかった失敗は `unmatched` として件数と一覧を報告し、miss とは数えない。
2. **replay**: jev-test-filter の `./gate` export (`gate`) を使い、`cutoff × unsure_below × unsure_margin` の格子で各 record を offline で再判定する。API は呼ばない。
3. **採用ルール: 締めるのは即時、緩めるのは慎重に**
   - 観測済みの真の失敗を 1 件でも落とす候補は不採用。
   - 現行設定で miss があれば、全ての真の失敗を拾う候補のうち選択数が最小のものに即座に切り替える。
   - 既定値より緩める (選択数を減らす) のは、真の失敗が `min_failures` 件以上 (既定 20) あって、recall の Wilson 95% 下限が `recall_target` (既定 0.98) 以上のときに限る。条件を満たさなければ現行値を維持し、理由を出力する。
   - 同点なら既定値に近い候補を選ぶ。
4. **hints 生成**: miss したテストと co-failure 履歴 (`commit_changes` × CI 失敗) から `failed_with` を作る。1 テストあたり上位 5 ファイル、hints を持つテスト数は既定 200 件を上限にする (token 増加を抑えるため)。
5. **出力**: `context.json` (既定 `.flaker/context.json`) を書き出し、前回との差分 (gate の変化、hints の増減) を表示する。`--dry-run` なら書かない。`--json` で機械可読の結果を出す。

制約: record の score は hints 込みの質問に対する答えで、新しい hints で再採点するには API が要る。hints は該当テストの score を押し上げる方向にしか働かないので、digest が混ざった状態での gate calibrate は保守側に倒れる。レポートは digest ごとに分けて出す。

設定:

```toml
[selector]
type = "jev"
context = ".flaker/context.json"
recall_target = 0.98
min_failures = 20
max_hinted_tests = 200
```

gate の値は `flaker.toml` ではなく `context.json` にだけ持つ (二重管理を避ける)。

## mutation による合成評価 (後続フェーズ)

`flaker calibrate --mutate <n>`:

1. 直近 commit の変更ファイルから関数を選び、単純な mutation (比較演算子の反転、boolean return の反転、early return の挿入) を当てる
2. full suite を実行し、落ちたテストを正解にする
3. 同じ mutation diff に対して jev-test-filter を実行し、record を `source = mutation` で取り込む
4. 作業ツリーを元に戻す (`git stash` ではなく一時 worktree で行い、利用者の作業ツリーには触らない)

レポートは real と mutation を分けて出す。mutation は実際の変更と分布がずれるので、採用ルールの「緩める」条件には real の件数だけを使い、mutation は「締める」根拠にだけ使う。

## flaker CLI の整理後の形

| 残す / 新設 | 統合 / 削除 |
|---|---|
| `init` `import` `status` `query` `doctor` | `--profile` は `--gate` に統合 |
| **`context`** (context.json の生成と検証) | `apply --emit` / `--target` / `--incident-*` を削除し、`ops` group も撤去 |
| **`calibrate`** (トップレベル化) | strategy `hybrid` `gbdt` `coverage-guided` `random`、adaptive / holdout / cluster |
| `run` (`affected` / `weighted` / `full` のみ) | `dev` は公開面から外し、隠しコマンドにする |
| `quarantine` `debug` `explain` (`context` と `bundle` を統合) | dead module とヘルプの参照切れ (`setup init`) を削除 |
| `plan` / `apply` (reconcile のみ) | KPI は MoonBit `build_sampling_kpi` に一本化 |

`init` のヘルプが参照している `setup init` は存在しないので、`init` 自体を正とする。

## フェーズ

1. **jev-test-filter 上流**: `--context`、per-SHA record (`RunRecord` v2)。minor リリース (0.2.0)。
2. **flaker 連携 (追加のみ)**: `import --adapter jev`、`context`、`calibrate`、context の JSON Schema。minor リリース。
3. **flaker 表面整理 (破壊的変更)**: 上表の統合と削除、migration guide (`docs/migration-*.md` / `.ja.md`)。バージョン番号 (1.0 にするか) はこのフェーズの着手時に決める。
4. **mutation 評価**: `calibrate --mutate`。

各フェーズは別 PR にする。フェーズ 2 はフェーズ 1 のリリースに依存し、フェーズ 3 と 4 は互いに独立している。

## テスト方針

- 契約: `context.json` と record v2 の JSON Schema を置き、両 repo の fixture を検証する。
- calibrate の中核は純関数 (records + 正解集合 + 現行 gate → 採用 gate + 理由) にし、表形式テストで採用ルールを網羅する (miss あり → 即時に締める / 件数不足 → 維持 / 条件成立 → 緩める / unmatched の扱い)。
- hints 生成も純関数にし、上限と順位付けをテストする。
- E2E: `dev eval-fixture` 系で CI run と jev record を合成し、import → calibrate → context → jev replay の一周が回ることを確認する。
- jev 側: context 注入後の question の snapshot、`skip` の除外、CLI 引数が context に勝つこと、record v2 の保存と v1 の読み込み互換をテストする。

## 決めないこと

- jev 以外の selector の実装 (契約はファイルで開いているので、後から足せる)
- flaker が jev を spawn する経路 (flaker `run` に jev を組み込むこと)
- hints の自然言語テンプレートの最適化 (まず 1 文の固定テンプレートで始める)
