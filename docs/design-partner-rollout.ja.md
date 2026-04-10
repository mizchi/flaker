# flaker Design Partner Rollout

3 repo で `flaker` の価値を検証するための実験計画。

対象:
- `crater`
- `bit-vcs/bit`
- `mizchi/flaker`

この文書の目的は 3 つです。
- どの repo で何を検証するかを固定する
- 毎週どの KPI を見るかを固定する
- 続行 / 見直し / 打ち切りの判断基準を固定する

## 役割分担

### 1. crater

役割:
- package-first 配布の検証
- install 成功率の検証
- local advisory が CI とどれだけ相関するかの検証

見るもの:
- `pnpm add --no-save @mizchi/flaker@latest` 成功率
- `node_modules/@mizchi/flaker/dist/cli/main.js` 実行成功率
- `P(CI pass | local pass)`
- fallback 発生率

成功条件:
- install 成功率 95% 以上
- CLI 実行成功率 95% 以上
- `P(CI pass | local pass) >= 95%`
- fallback 率 10% 未満

### 2. bit-vcs/bit

役割:
- sampling の本質的価値の検証
- `affected` / `hybrid` がどれだけ test を削減できるかの検証
- local fail と CI fail の相関の検証

見るもの:
- sample ratio
- saved test minutes
- `P(CI pass | local pass)`
- `P(CI fail | local fail)`
- false negative rate

成功条件:
- sample ratio 20% 以下
- saved test minutes 70% 以上
- `P(CI pass | local pass) >= 95%`
- false negative rate 2% 未満

### 3. mizchi/flaker

役割:
- dogfood
- release 運用の品質担保
- collect / eval / report の UX 検証

見るもの:
- release workflow 成功率
- `pnpm add @mizchi/flaker` 相当の smoke
- `collect` / `eval` / `report` の継続利用性

成功条件:
- release workflow 連続成功
- package install smoke が常時 green
- 自分自身の開発で advisory を継続利用できる

## North Star

`sampled local run が full CI の代理としてどれだけ信頼できるか`

この North Star は、次の 2 指標で見る。
- `P(CI pass | local pass)`
- `saved test minutes`

片方だけでは足りない。
- 相関だけ高くて削減率が低いなら価値が弱い
- 削減率だけ高くて相関が低いなら危険

## 週次 KPI

毎週、repo ごとに最低これを記録する。

| KPI | 意味 | 目標 |
|---|---|---|
| install success rate | package install 成功率 | 95%+ |
| CLI smoke success rate | `dist/cli/main.js --help` 実行成功率 | 95%+ |
| collect success rate | データ取り込み成功率 | 95%+ |
| `P(CI pass | local pass)` | local pass の信頼度 | 95%+ |
| `P(CI fail | local fail)` | fail 側相関 | 70-90% |
| false negative rate | local pass だが CI fail | 1-2% 未満 |
| sample ratio | 実行した test 数 / full 候補数 | 5-20% |
| saved test minutes | full 相当との差分時間 | 70%+ が理想 |
| fallback rate | advisory を捨てて full run に倒れた率 | 10% 未満 |

## 週次レビュー用テンプレート

各 repo について、1 週間ごとに次の表を埋める。

```md
## Week YYYY-MM-DD

### crater
- commits observed:
- local sample runs:
- CI runs matched:
- install success rate:
- CLI smoke success rate:
- collect success rate:
- P(CI pass | local pass):
- P(CI fail | local fail):
- false negative rate:
- sample ratio:
- saved test minutes:
- fallback rate:
- notes:

### bit-vcs/bit
- commits observed:
- local sample runs:
- CI runs matched:
- install success rate:
- CLI smoke success rate:
- collect success rate:
- P(CI pass | local pass):
- P(CI fail | local fail):
- false negative rate:
- sample ratio:
- saved test minutes:
- fallback rate:
- notes:

### mizchi/flaker
- commits observed:
- local sample runs:
- CI runs matched:
- release workflow success rate:
- CLI smoke success rate:
- collect success rate:
- P(CI pass | local pass):
- P(CI fail | local fail):
- false negative rate:
- sample ratio:
- saved test minutes:
- fallback rate:
- notes:
```

## 実験の単位

1 週間ごとの commit 群で見るが、最小評価単位は commit。

1 commit について見るもの:
- local sample が pass / fail のどちらか
- 対応する CI が pass / fail のどちらか
- local sample で何件実行したか
- full CI では何件相当だったか
- 実行時間差分
- fallback したか

最低でも各 repo で 20-30 commit 分の観測が欲しい。

## 判定ルール

### Go

以下を 2 週間連続で満たす。

- `P(CI pass | local pass) >= 95%`
- false negative rate 2% 未満
- sample ratio 20% 以下
- saved test minutes 70% 以上
- fallback rate 10% 未満

### Borderline

以下のどちらか。

- 相関は高いが削減率が低い
- 削減率は高いが fallback が多い

この場合は advisory tool として継続し、gate にはしない。

### No-Go

以下のどれか。

- false negative rate が高い
- install / collect が不安定
- 毎回 full run fallback している
- 開発者が継続利用しない

この場合は rollout を止めて、導入面か sampling ロジックを見直す。

## 運用コマンド

最低限、各 repo で次を回せるようにする。

```bash
# local advisory
flaker run --strategy hybrid --count 25 --changed ...

# commit / local / CI 相関の評価
flaker analyze eval --json

# 週次レビュー用の markdown 出力
flaker analyze eval --markdown --window 7

# collect の健全性確認
flaker debug doctor
```

必要なら repo 側で wrapper task を持つ。

例:
- `just flaker-sample`
- `just flaker-run`
- `just flaker-eval`

## 初期 rollout の原則

- 最初は advisory only
- いきなり CI gate にはしない
- explain を必ず見せる
- 危険な場合は full run fallback を許容する

最初に売る価値は `自動判定` ではなく次の 1 文である。

> この変更では 20 件だけ回せば十分そうで、過去の実績では local pass のとき CI も 95% 以上で通っている

## 次に実装で必要なもの

- sample 実行時に `confidence / sample ratio / saved minutes` を常時表示する
- `eval` の出力を repo 週次レビュー向けに整形する
- fallback 理由を構造化して記録する
- false negative commit を掘りやすくする
