# flaker Management Quick Start

[English](flaker-management-quickstart.md)

`flaker` を導入したあと、どう運用を始めるかの最短手順。
このページは `flaker.toml` がすでにあり、`flaker run --gate merge` を advisory として回し始める段階を前提にする。

運用全体の整理は [operations-guide.ja.md](operations-guide.ja.md) を先に読むとよい。
日常利用だけなら [usage-guide.ja.md](usage-guide.ja.md) を使う。

まだ導入していない場合は先に [new-project-checklist.ja.md](new-project-checklist.ja.md) を使う。

この quick start の目的は 3 つ。

- 毎日何を回すかを固定する
- 毎週何を見て昇格 / 降格を判断するかを固定する
- Playwright E2E / VRT を安全に gate へ入れる最短ルートを示す

## 0. 前提

少なくとも次があること。

- `flaker.toml`
- `profile.scheduled`
- `profile.ci`
- `profile.local`
- GitHub Actions の `pull_request` または `push` / `schedule`

最低限の Playwright 向け設定例:

```toml
[runner]
type = "playwright"
command = "pnpm exec playwright test -c playwright.config.ts"
flaky_tag_pattern = "@flaky"

[quarantine]
auto = true
flaky_rate_threshold_percentage = 30
min_runs = 10

[profile.scheduled]
strategy = "full"

[profile.ci]
strategy = "hybrid"
sample_percentage = 30
skip_flaky_tagged = true

[profile.local]
strategy = "affected"
max_duration_seconds = 90
fallback_strategy = "weighted"
skip_flaky_tagged = true
```

## 1. まず 10 分でやること

repo root で次を実行する。

```bash
mkdir -p .artifacts
pnpm flaker status
pnpm flaker gate review merge --json --output .artifacts/gate-review-merge.json
pnpm flaker ops weekly --output .artifacts/flaker-weekly.md
```

ここで見るもの:

- `matched commits`
- `false negative rate`
- `pass correlation`
- `sample ratio`
- `saved test minutes`
- `flaky` / `quarantined` test 数

まだ `matched commits` が薄いなら、いきなり required にしない。advisory のまま observation を続ける。

## 2. 毎日の loop

nightly または 1 日 1 回、次を回す。

```bash
mkdir -p .artifacts
export GITHUB_TOKEN=$(gh auth token)
pnpm flaker collect ci --days 1
pnpm flaker ops daily --output .artifacts/flaker-daily.md
pnpm flaker quarantine suggest --json --output .artifacts/quarantine-plan.json
```

必要なら quarantine も更新する。

```bash
pnpm flaker quarantine apply --from .artifacts/quarantine-plan.json --create-issues
```

この loop の役割:

- full run で history を増やす
- quarantine の add / remove 候補を plan として残す
- 日次の release snapshot を残す

## 3. 毎週のレビュー

週 1 回、まず次を更新する。

```bash
mkdir -p .artifacts
pnpm flaker gate review merge --json --output .artifacts/gate-review-merge.json
pnpm flaker ops weekly --output .artifacts/flaker-weekly.md
```

その上で次の表を埋める。

```md
## Week YYYY-MM-DD

- matched commits:
- false negative rate:
- pass correlation:
- sample ratio:
- saved test minutes:
- fallback rate:
- flaky tests:
- quarantined tests:
- promote:
- keep:
- demote:
```

詳しいテンプレートは [skills/flaker-management/assets/weekly-review-template.md](../skills/flaker-management/assets/weekly-review-template.md)。

## 4. advisory から required へ上げる条件

少なくとも次を満たしてから required にする。

- `matched commits >= 20`
- `false negative rate <= 5%`
- `pass correlation >= 95%`
- `data confidence` が `moderate` 以上

Playwright E2E / VRT なら、さらに次が必要。

- user-visible contract が説明できる
- dynamic region と non-goal が決まっている
- PR budget に収まる

## 5. 降格する条件

次のどれかなら、required から advisory または `@flaky` / quarantine に戻す。

- unexplained false failure が継続する
- rolling window で false failure rate が高い
- owner が不在
- 何を守る test か説明できない
- runtime budget を圧迫している

## 6. Playwright E2E / VRT の追加ルール

VRT は新規追加した瞬間に gate に入れない。
まず `Learning lane` で burn-in する。

- `main` push または nightly で full に近く回す
- 失敗理由を `intent-debt` / `environment-noise` / `test-design` などで分類する
- `mask` / `stylePath` / animation disable でノイズを潰す
- full-page snapshot より local contract を優先する

test ごとの契約テンプレートは [skills/flaker-management/assets/test-contract-template.md](../skills/flaker-management/assets/test-contract-template.md) を使う。

## 7. 事故ったとき

CI failure の再確認:

```bash
pnpm flaker ops incident --run <workflow-run-id> --output .artifacts/flaker-incident.md
```

特定 test の confirm:

```bash
pnpm flaker ops incident --suite path/to/spec.ts --test "test name" --output .artifacts/flaker-incident.md
```

より細かくやるなら raw debug primitives を使う。

```bash
pnpm flaker debug retry --run <workflow-run-id>
pnpm flaker debug confirm "path/to/spec.ts:test name" --runner local
pnpm flaker debug diagnose --suite path/to/spec.ts --test "test name"
```

## 8. どの skill を使うか

- 導入前: `flaker-setup`
- 導入後の運用: `flaker-management`

`flaker-management` skill の本体は [skills/flaker-management/SKILL.md](../skills/flaker-management/SKILL.md)。
