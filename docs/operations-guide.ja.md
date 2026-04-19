# flaker 運用ガイド

[English](operations-guide.md)

`flaker` を **運用側** として回すための入口。
このページは maintainer / QA / CI owner 向けに、gate 設計と継続運用の考え方をまとめる。

次は扱わない:

- 単純な日常利用だけ
- 1 コマンドごとの詳細な option 一覧

それらは [usage-guide.ja.md](usage-guide.ja.md) と [how-to-use.ja.md](how-to-use.ja.md) を参照。

まだ導入していない場合は [new-project-checklist.ja.md](new-project-checklist.ja.md) から始める。

## 対象読者

- repo maintainer
- QA / test owner
- CI owner
- advisory から required への昇格を設計したい人

## 運用の見方

`flaker` の運用は 4 層で見ると整理しやすい。

- `Gate`: 何を止める判断か
- `Budget`: どこまで時間・ノイズ・コストを許容するか
- `Loop`: gate を信頼できる状態に保つ背景運用
- `Policy`: quarantine / promotion / demotion などのルール

## まず置く gate

ほとんどのチームは 3 つで足りる。

| Gate | Backing profile | 役割 |
|---|---|---|
| `iteration` | `local` | 開発者の高速フィードバック |
| `merge` | `ci` | PR / mainline の gate |
| `release` | `scheduled` | full あるいはそれに近い厳密確認 |

## 運用 loop

### Observation loop

- `flaker collect`
- `flaker ops daily`
- `flaker status`

役割:

- history を増やす
- release gate の日次 snapshot を残す
- gate の信頼度を測る

### Triage loop

- `flaker gate review merge`
- `flaker ops weekly`
- `flaker quarantine suggest`
- `flaker quarantine apply`
- 週次の promote / keep / demote review

役割:

- flaky を gate から隔離する
- promote / keep / demote の判断を artifact に残す
- review 済みの quarantine plan だけを適用する
- required check の信頼を保つ

### Incident loop

- `flaker ops incident`
- 必要なら `flaker debug retry / confirm / diagnose`

役割:

- 失敗が regression か flaky かを切り分ける
- 調査を issue 化しやすくする

## 推奨 cadence

### 毎日

```bash
mkdir -p .artifacts
export GITHUB_TOKEN=$(gh auth token)
pnpm flaker collect ci --days 1
pnpm flaker ops daily --output .artifacts/flaker-daily.md
pnpm flaker quarantine suggest --json --output .artifacts/quarantine-plan.json
```

### 毎週

```bash
mkdir -p .artifacts
pnpm flaker gate review merge --json --output .artifacts/gate-review-merge.json
pnpm flaker ops weekly --output .artifacts/flaker-weekly.md
```

次を見て `promote / keep / demote` を決める。

- `matched commits`
- `false negative rate`
- `pass correlation`
- `sample ratio`
- `saved test minutes`
- `flaky` / `quarantined` test 数

`status` は summary-only なので、昇格判断は `gate review merge` を使う。

### 失敗時

```bash
pnpm flaker ops incident --run <workflow-run-id> --output .artifacts/flaker-incident.md
pnpm flaker ops incident --suite path/to/spec.ts --test "test name" --output .artifacts/flaker-incident.md
```

より細かい切り分けが必要なときだけ `flaker debug retry / confirm / diagnose` に降りる。

## 昇格・降格の目安

`merge` gate を required に上げる前に、少なくとも次を満たす。

- `matched commits >= 20`
- `false negative rate <= 5%`
- `pass correlation >= 95%`
- `data confidence` が `moderate` 以上

逆に次のどれかなら advisory または quarantine に戻す。

- unexplained false failure が続く
- flaky が増えて trust が落ちる
- owner が不在
- runtime budget を圧迫する

## Playwright E2E / VRT

- 新しい VRT をすぐ required に入れない
- まず `release` / nightly 側で burn-in する
- `mask`, `stylePath`, animation disable でノイズを消す
- full-page snapshot より per-test contract を優先する

最短導線は [flaker-management-quickstart.ja.md](flaker-management-quickstart.ja.md)。

## 次に読むもの

- 最短 10 分の運用開始: [flaker-management-quickstart.ja.md](flaker-management-quickstart.ja.md)
- 日常利用の入口: [usage-guide.ja.md](usage-guide.ja.md)
- plugin skill: [../skills/flaker-management/SKILL.md](../skills/flaker-management/SKILL.md)
