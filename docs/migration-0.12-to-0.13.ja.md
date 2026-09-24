# flaker 0.12 → 0.13 Migration Guide

[English](migration-0.12-to-0.13.md)

`0.13.0` は **breaking** release。profile ベースの実行 surface、`ops` コマンド群、`apply --emit` / `apply --target`、adaptive sampling、`random` / `gbdt` / `coverage-guided` 戦略を削除した。削除された config キー・セクション・環境変数は、置き換え先 (または削除指示) を明示したエラーで即座に起動を拒否し、このページへ誘導する。削除された CLI flag やコマンドは commander の `unknown option` / `unknown command` エラーになり、置き換え先は表示されない — このガイドの表を参照すること。

互換シムは無い。`flaker.toml` / script / CI workflow が以下の旧形式を使っている場合、修正するまで `flaker` は起動を拒否する。

## 1. `--profile` → `--gate`

`run --profile <name>`、`[profile.<name>]`、`FLAKER_PROFILE` は廃止された。代わりに `--gate`、`[gate.<name>]`、`FLAKER_GATE` を使う。

| 旧 (0.12.x) | 新 (0.13.0) |
|---|---|
| `flaker run --profile local` | `flaker run --gate iteration` |
| `flaker run --profile ci` | `flaker run --gate merge` |
| `flaker run --profile scheduled` | `flaker run --gate release` |
| `[profile.local]` | `[gate.iteration]` |
| `[profile.ci]` | `[gate.merge]` |
| `[profile.scheduled]` | `[gate.release]` |
| `FLAKER_PROFILE=<p>` | `FLAKER_GATE=<gate>` |

Before/after:

```diff
-[profile.ci]
+[gate.merge]
 strategy = "hybrid"
 sample_percentage = 30
```

```diff
-flaker run --profile local --changed src/foo.ts
+flaker run --gate iteration --changed src/foo.ts
```

補足:

- カスタム profile 名 (例: `[profile.nightly]`) に**対応する gate は無い**。gate は `iteration` / `merge` / `release` の 3 つ固定。4 つ目の profile を使っていた場合は、一番近い gate に設定を畳み込むか、config section を使わず CLI flag (`--strategy`, `--percentage`, `--count` など) だけで駆動する。
- CLI の `--gate` 値は大文字小文字を無視する (`--gate Merge` でも通る) が、`flaker.toml` の section 名は厳密に小文字でなければならない — `[gate.Merge]` は config error になる (§7 参照)。
- `FLAKER_GATE` が空文字 (`FLAKER_GATE=`) の場合は未設定として扱われ、自動判定 (CI なら `merge`、それ以外は `iteration`) にフォールバックする。一方 `FLAKER_PROFILE` は空でない値を設定すると **`--gate` を同時に渡していても** hard error になる — 黙って無視されない。CI 環境に残った `FLAKER_PROFILE` は大抵 workflow の更新漏れなので、意図的に厳しくしている。

## 2. 削除された戦略と sampling knob

`random` / `gbdt` / `coverage-guided` 戦略、`cluster_mode`、`model_path`、`[coverage]` セクション全体が削除された。GBDT モデルを学習していた `flaker dev train` も削除され、代替コマンドは無い。

| 削除されたもの | 代わりに使うもの |
|---|---|
| `strategy = "random"` | `weighted` (弱い重み付けでほぼ均等) または `full` |
| `strategy = "gbdt"`, `flaker dev train` | `weighted` または `hybrid` |
| `strategy = "coverage-guided"`, `flaker collect coverage`, `[coverage]` | `hybrid` (依存グラフベース) — [coverage-guided-sampling.md](coverage-guided-sampling.md) は歴史的資料として保持 |
| `[sampling].cluster_mode` / `[gate.*].cluster_mode`, `model_path` | 無し — キーを削除する |
| `fallback_strategy = "random"` / `"gbdt"` / `"coverage-guided"` | `fallback_strategy = "weighted"` |

Before/after:

```diff
-[sampling]
-strategy = "gbdt"
-cluster_mode = "spread"
-model_path = ".flaker/models/gbdt.json"
+[sampling]
+strategy = "hybrid"
```

```diff
-flaker run --dry-run --strategy random --count 20
+flaker run --dry-run --strategy weighted --count 20
```

`flaker explain cluster` (co-failure クラスタ**分析**) は影響を受けない — 削除された `cluster_mode` sampling knob とは別機能。

## 3. 削除された adaptive sampling キー

`adaptive`, `adaptive_fnr_low_ratio`, `adaptive_fnr_high_ratio`, `adaptive_min_percentage`, `adaptive_step` は全て代替キー無しで削除された。自動 percentage チューニングという概念自体が無くなった。

```diff
 [gate.merge]
 strategy = "hybrid"
 sample_percentage = 30
-adaptive = true
-adaptive_fnr_low_ratio = 0.02
-adaptive_fnr_high_ratio = 0.08
```

代わりに `flaker calibrate` を定期実行する (週次が妥当な既定値。nightly workflow に組み込んでもよい)。直近の履歴から `[sampling]` を再計算する:

```bash
flaker calibrate                  # [sampling] を再計算して書き込む
flaker calibrate --dry-run        # 書き込まず確認のみ
flaker calibrate --window-days 30 --json
```

`flaker calibrate` は `[affected].resolver` が設定されていれば `hybrid`、無ければ `weighted` を推奨するようになった。小規模スイートに `random` を、大規模スイートに `gbdt` を推奨することはもう無い — そもそもその戦略が存在しない。

## 4. `apply --target` → 専用コマンド

`apply --target calibrate` と `apply --target collect_ci` は廃止された。`flaker apply` は drift を検知すれば内部で同じステップを実行するが、特定の target を直接呼んでいた場合は単体コマンドに置き換える。

| 旧 (0.12.x) | 新 (0.13.0) |
|---|---|
| `apply --target calibrate` | `flaker calibrate` |
| `apply --target collect_ci` | `flaker import --ci --days 30` |

`flaker import --ci` は `[--days <n>] [--branch-filter <branch>]` を受け付け、`GITHUB_TOKEN` が必要。(`flaker import <file>` の `--branch` は別の既存フラグで、local file import にブランチ名を付与するだけの無関係な機能 — 同じ意味ではない。)

## 5. `apply --emit`, `apply --incident-*`, `ops` group

`ops` コマンド群 (`ops daily`, `ops weekly`, `ops incident`) と `apply --emit` / `apply --incident-*` flag は全て削除された。以下の表で置き換える:

| 旧 (0.12.x) | 新 (0.13.0) |
|---|---|
| `apply --target collect_ci` | `import --ci --days 30` |
| `apply --target calibrate` | `flaker calibrate` |
| `run --profile ci` / `scheduled` / `local` | `run --gate merge` / `release` / `iteration` |
| `[profile.local]` / `[profile.ci]` / `[profile.scheduled]` | `[gate.iteration]` / `[gate.merge]` / `[gate.release]` |
| `FLAKER_PROFILE=<p>` | `FLAKER_GATE=<gate>` |
| `flaker ops weekly --output X` | `flaker status --markdown > X` に加えて `flaker explain insights` |
| `flaker ops incident …` | `flaker debug retry` / `debug confirm` / `debug diagnose` |
| `apply --emit daily` | `flaker apply && flaker status` |
| `adaptive = true` (他 adaptive キーも) | 削除する。代わりに `flaker calibrate` を定期実行 |

`ops weekly` はかつて flaky-tag の add/remove 提案 narrative も運んでいたが、この副機能は `apply` に統合されず完全に削除された (`ops` の orchestration に依存していたため)。`flaker status --list flaky` で候補を確認し、手動でタグ付けする。

`flaker apply --json` と `flaker apply --output <file>` の形自体は変わっていないが、`ApplyArtifact` JSON のトップレベル `emitted` フィールドは削除された (廃止された `--emit` flag の結果を反映していただけのフィールドのため)。`--plan-file` を使った apply は `executed` を plan 順で報告するが、これは 0.13.0 より前から既にそうだった挙動で `ops` / `--emit` 削除とは無関係 — 同じ JSON shape に影響するためここで触れている。

## 6. `dev` は非表示に

`flaker dev <subcommand>` は `flaker --help` の一覧やその親カテゴリの help から見えなくなったが、直接呼び出せば各 subcommand は引き続き動く (例: `flaker dev tune`, `flaker dev eval-co-failure`)。実際に**削除**されたのは `dev train` のみ (§2 参照) — 削除済みの GBDT 戦略に依存していたため。

## 7. 削除された config キーと環境変数は置き換え先を明示するエラーになる

`flaker.toml` は他の何より先に検証される。削除・リネームされたキーを使う config は即座に、該当キー名と (あれば) 置き換え先を示すエラーで起動を拒否する。例えば次の `flaker.toml` に対して `flaker run` を実行すると:

```toml
[repo]
owner = "example"
name = "demo"

[profile.ci]
strategy = "weighted"
```

次のエラーになる:

```
Error: flaker.toml uses removed or renamed keys (see docs/migration-0.12-to-0.13.md and docs/how-to-use.md#config-migration):
  [profile.ci] was renamed to [gate.merge]
```

有効な gate section の中に削除済みキーがある場合:

```toml
[gate.merge]
strategy = "weighted"
cluster_mode = "spread"
```

次のエラーになる:

```
Error: flaker.toml uses removed or renamed keys (see docs/migration-0.12-to-0.13.md and docs/how-to-use.md#config-migration):
  `cluster_mode` in [gate.merge] was removed in 0.13.0; delete this key
```

gate section の大文字小文字を間違えた場合 (config section は `--gate` flag と違い厳密に小文字):

```
Error: flaker.toml uses removed or renamed keys (see docs/migration-0.12-to-0.13.md and docs/how-to-use.md#config-migration):
  [gate.Merge] is not a gate; use one of iteration, merge, release
```

`FLAKER_PROFILE` に空でない値を設定した場合 (有効な `--gate` flag を同時に渡していても):

```
Error: FLAKER_PROFILE was replaced by FLAKER_GATE in 0.13.0 (ci → merge). See docs/migration-0.12-to-0.13.md.
```

いずれもメッセージを stderr に 1 回だけ出力し、stack trace は出さず、exit code 2 で終了する。

削除された CLI flag とコマンドは扱いが異なる。flaker 自身の検証より前に引数パーサが拒否するため、エラーに置き換え先は含まれない。例えば `flaker run --profile ci` は `error: unknown option '--profile'`、`flaker ops weekly` は `error: unknown command 'ops'` を出力する (いずれも続けてコマンドの help を表示し、exit code 1)。置き換え先は §1–§5 の表で確認すること。

`fallback_strategy` と `holdout_ratio` はそのまま残る。削除されたのは `fallback_strategy` に指定する戦略の**値** (`random` / `gbdt` / `coverage-guided`) のみ。

## その他の変更点

- `flaker explain context --json` の `strategies` map から `random` / `coverage-guided` / `gbdt` が消え、`environment.gbdtModelAvailable` も無くなった。
- `[gate]`, `[gate.<name>]`, `[profile]` は TOML table でなければならない。table でない値 (例: `gate = "merge"`) は config error になる。

## アップグレード手順

```bash
pnpm up @mizchi/flaker@0.13

# 1. flaker.toml の profile section を gate にリネーム
#    [profile.local] -> [gate.iteration]
#    [profile.ci]     -> [gate.merge]
#    [profile.scheduled] -> [gate.release]

# 2. 削除済みキーを消す: adaptive*, cluster_mode, model_path, [coverage]
# 3. 削除済み戦略値 (random/gbdt/coverage-guided) を weighted/affected/hybrid/full に変更

# 4. script / CI workflow を更新
#    run --profile <x>        -> run --gate <対応する名前>
#    FLAKER_PROFILE=<x>       -> FLAKER_GATE=<対応する名前>
#    apply --target calibrate -> flaker calibrate
#    apply --target collect_ci -> flaker import --ci --days 30
#    ops weekly --output X    -> flaker status --markdown > X (+ flaker explain insights)
#    ops incident ...         -> flaker debug retry / confirm / diagnose
#    apply --emit daily       -> flaker apply && flaker status

# 5. 確認
flaker doctor
flaker run --dry-run --gate iteration --explain
flaker status
```

## grep チェックリスト

アップグレード前に repo root で実行する:

```bash
grep -rnE -- '--profile|\[profile\.|FLAKER_PROFILE|flaker (ops|collect|analyze|policy|gate|quarantine|setup|exec|kpi)\b|apply --(target|emit|incident)|--cluster-mode|--model-path|cluster_mode|model_path|adaptive|\[coverage\]|strategy *= *"(random|gbdt|coverage-guided)"|dev train|debug doctor|import (report|parquet) ' \
  flaker.toml .github package.json Makefile justfile Taskfile.pkl scripts docs 2>/dev/null
```

マッチした script / workflow / config は上表に従って更新する。0.13.0 より前に消えた書き方 (`flaker collect`、`analyze`、`policy`、`gate` など) も拾う。それらの現在の書き方は [docs/agent-changelog.md](agent-changelog.md) の対応表にある。

## 関連ドキュメント

- [docs/how-to-use.md#config-migration](how-to-use.md#config-migration) — config key rename の完全なリファレンス (0.13.0 のリネームも含む)
- [README.md](../README.md) — canonical command forms
- [CHANGELOG.md](../CHANGELOG.md) — 0.13.0 の full release notes
