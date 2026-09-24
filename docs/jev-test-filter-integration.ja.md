# flaker と jev-test-filter を組み合わせる

[jev-test-filter](https://github.com/mizchi/jev-test-filter) は、diff に対してテストを 1 件ずつモデルに問い合わせ、その変更に必要なテストを選びます。jev が見るのは目の前の 1 つの変更だけです。どのコミットでどのテストが実際に落ちたか、どれが flaky か quarantine 中か、過去の選択が失敗を取りこぼしたかは、flaker が持っています。このガイドでは両者をつなぎ、full run のたびに jev の選択を検証して gate を調整する流れを作ります。

[English](jev-test-filter-integration.md)

## 役割分担

| | jev-test-filter | flaker |
|---|---|---|
| 決めること | 1 つの変更で走らせるテスト | 選択については何も決めない |
| 書き出すもの | コミットごとの run record (`.jev-test-filter/records/<head_sha>.json`) | テスト DB (`[storage].path`、既定は `.flaker/data`) |
| 読むもの | diff、テストファイル、flaker の `jev-context` | jev の run record と full run の結果 |
| gate の値 | 使う。コマンドラインのフラグが常に優先 | 根拠から提案する (`gate_calibration`) |

flaker が jev を起動したりモデルを呼んだりすることはありません。calibration は保存済みの回答を、flaker が bundle した jev 自身の gate のコードでオフライン再生します。

## 前提

- flaker 0.14.0 以降と jev-test-filter 0.1.3 以降 (`pnpm add -D jev-test-filter`)。jev が問い合わせるには `TYPESAFE_API_KEY` が必要です。ないと全テストを走らせるだけで record を書かないので、flaker が取り込むものがありません。
- jev が採点したコミットの一部に full run があること。full run はテストスイート全体を走らせた run です。何が落ちたかを確定できるのは full run だけなので、flaker は full run のあるコミットでしか jev の選択を比較しません。どの run が full かは `[workflow_lanes]` で指定するか、テスト件数から推定させます ([`runs.is_full`](how-to-use.ja.md#workflow_lanes-と-runsis_full) を参照)。
- その full run の結果が、走ったコミットに紐づいて flaker に入っていること。`flaker import --ci` ならそうなります。report を手で取り込むときは `--commit <sha>` が必要です。付けないとどのコミットにも一致しないローカル id で保存されます。full と数えさせるには、`[workflow_lanes]` で `full = true` にした lane を `--lane` で付けます (または `--workflow-name` を付けて、同じ workflow のほかの run と件数で比べさせます): `flaker import report.json --commit $(git rev-parse HEAD) --lane full-batch`。
- hint を出すには、各コミットで変わったファイルが必要です。`flaker import --ci` と `flaker run` は記録しますが、`flaker import <report>` は記録しません。ない場合、context には gate と `skip` だけが入り、テスト別の hint は入りません。

## 設定

`flaker.toml`:

```toml
[selector]
type = "jev"
recall_target = 0.90     # jev が選ぶテストを減らす前に必要な recall
min_failures = 20        # そのために必要な real な失敗の件数
max_hinted_tests = 200   # context に載せるテスト別 hint の上限

[workflow_lanes]
"ci.yml" = "sampled"
"nightly.yml" = { lane = "full-batch", full = true }
```

gate の値そのもの (`cutoff`、`unsure_below`、`unsure_margin`) はここには書きません。書くと flaker は `[selector]` を拒否します。値は DB にあり、calibration が追記していきます。

`.gitignore`:

```
.jev-test-filter/
```

## 基本の流れ

```bash
# 1. 選択の前に、現在の context を jev に渡す
flaker export --projection jev-context -o .flaker/context.json

# 2. 選択して実行する (.jev-test-filter/records/<head_sha>.json が書かれる)
jev-test-filter --base main --context .flaker/context.json --exec -- vitest run

# 3. jev の判定を取り込む
flaker import .jev-test-filter --adapter jev

# 4. 同じコミットの full run を取り込む
flaker import --ci

# 5. 比較して gate を調整する
flaker calibrate --selector
```

1〜3 は変更ごとに走らせます。4〜5 は、jev が採点したコミットのどれかに full run があって初めて意味を持ちます。それまでは `calibrate --selector` は gate を維持し、`no selector record has a full run on its head commit yet` と表示します。calibration が見るのは直近 90 日分の record で、`--window-days` で変えられます。

3 と 4 の順番は問いません。flaker がまだ知らないテストはテストキーなしで保存され、結果が入った後の次の selector import か `calibrate --selector` で照合されます。

### CI で使う

calibration は多くのコミットの record と full run を比べるので、flaker の DB は 1 つの job より長く残す必要があります。CI が run をまたいで状態を残せる場所 (cache、次の run の最初に復元する artifact、永続的な runner 上の定期 job など) に置いてください。

jev と flaker はたいてい別の job で動きます。2 つのファイルを artifact で受け渡してください。

- jev を走らせる job には、flaker の DB を持つ job から `.flaker/context.json` を渡す
- flaker の DB を持つ job には、jev を走らせた job から `.jev-test-filter/records/` を渡す

record のファイル名はコミットで決まるので、複数の run の record を 1 つのディレクトリに集めてまとめて取り込めます。取り込み済みの record をもう一度取り込んでも何も起きません。

## context で jev の何が変わるか

`jev-context` v1 は 3 つの部分からなります。

- `gate`: 最新の calibration で決まった `cutoff`、`unsure_below`、`unsure_margin` と、その根拠です。jev はこれを既定値として使い、フラグを指定すればそちらが優先されます。最初の calibration の前は `null` で、jev は自分の既定値を使います。
- `skip`: flaker で quarantine 中のテストです。jev はこれを問い合わせず、diff が触れていても選ばず、`reason: "quarantined"` として報告します。
- `tests`: 履歴のあるテストへの hint です。テストごとに、一緒に落ちたファイル (同時失敗 2 回以上) を最大 5 件と、`missed` (jev が外して実際に落ちたコミットの数) を持ちます。jev はそのファイルを挙げた 1 文を、そのテストの質問に加えます。たとえば `This test previously failed when src/cli/config.ts or src/cli/main.ts changed.` です。`missed` は記録されますが、モデルには見せません。flaky と quarantine 中のテストには hint を付けません。

テストの照合にはファイルと title path を使い、Playwright の project が指定されていればそれも使います。行番号は、テストより上を編集するたびにずれるので使いません。`digest` は `skip` と `tests` だけのハッシュです。jev は run record ごとにこれを保存するので、run は同じ hint のもとでだけ比較されます。gate が変わっただけでは digest は変わりません。

## calibration の判断

`flaker calibrate --selector` は、コミットごとに、同じコミットに full run がある real な jev の record のうち最新のものを使います。数える失敗は、その full run で落ちたテストから flaky と quarantine 中のものを除いたものです。jev の record 自身が quarantine していたテストの失敗は jev の取りこぼしとは数えず、別に報告します。

そのうえで、すべての record を gate の値の格子で再生し、「締めるのはすぐ、緩めるのは慎重に」という 1 つの規則を当てはめます。

- 現在の gate が失敗を取りこぼしていれば、すぐに、現在の gate が選ぶテストをすべて選び、かつ取りこぼしが少ない gate に移ります。候補の中では、取りこぼしが最も少なく、次に選択テスト数が最も少ないものを選びます。取りこぼしを減らせる gate が格子の中になければ、テストを多く選んでも拾えないので gate を維持し、取りこぼしを報告します。
- 選ぶテストを減らすのは、取りこぼしがゼロで、real な失敗が `min_failures` 件以上あり、recall の Wilson 95% 下限が `recall_target` に届いたときだけです。すべての失敗を拾えたときの下限は n / (n + 3.84) なので、既定の 0.90 では、最初に緩めるまでに 35 件の real な失敗が必要です。

実行ごとに `gate_calibration` に 1 行が `rationale` 付きで追記されます。`--dry-run` は何も追記せず、`--json` は結果をすべて出力します。

## 結果を確かめる

```bash
# jev が外して、その後落ちたテスト
flaker query "SELECT test_key, head_sha, reason, changed_files FROM flaker_v1.misses LIMIT 20"

# 現在の gate とその理由
flaker query "SELECT * FROM flaker_v1.gate_calibration ORDER BY calibrated_at DESC LIMIT 1"

# 書き込まずに、いま calibration が何をするか見る
flaker calibrate --selector --dry-run --json
```

dataset の一覧は [flaker_v1](how-to-use.ja.md#flaker-export--公開-dataset-flaker_v1) にあります。ほかの selector も、`selector-record` v1 を書いて `--adapter selector-record` で取り込めば同じ流れに乗れます。

## うまくいかないとき

| 症状 | 原因 |
|---|---|
| `calibrate --selector` が "no selector record has a full run on its head commit yet" で維持する | jev が採点したコミットに full run がない。`flaker_v1.runs.is_full` と `[workflow_lanes]` を確認する。 |
| `unmatched` にテストが多い | jev の record のどの判定にも対応しない full run の失敗。jev と reporter でファイルパスや title が違うか、jev がそのテストを見つけていない。`flaker_v1.tests.file` / `title_path` を record の `tests` と見比べる。 |
| `flaker import --adapter jev` で record が見つからない | jev は run が完了したときだけ record を書く。全件実行に fallback した run (API key がない、API エラー) は何も書かない。`fallback` が設定された record も flaker は skip するが、そういう record は手作りか古いものに限られる。 |
| jev が `--context` で exit 2 になる | version 1 の context でないか、形式が合っていない。同じ版の flaker で作り直す。 |
| gate が変わっても jev の record の `context_digest` が変わらない | 想定どおり。digest は hint と `skip` だけを対象にし、gate は含まない。 |
