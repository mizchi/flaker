# flaker Management Presets

この skill では 3 つの運用 preset を持つ。

## 1. bootstrap

使いどころ:

- 導入直後
- advisory only で始めたい
- E2E / VRT の history がまだ薄い

既定:

- PR budget: `10分`
- local budget: `120秒`
- `[gate.merge].sample_percentage = 50`
- promotion: `20 matched commits` と `false negative rate <= 5%`
- demotion: rolling `14日` で incident `2件` 以上

assets:

- `../assets/flaker.playwright-vrt-bootstrap.toml`
- `../assets/workflow-pr-advisory.yml`
- `../assets/workflow-nightly-learning.yml`

## 2. standard

使いどころ:

- OSS の標準運用
- advisory から required へ段階的に上げたい
- Playwright E2E / VRT を managed gate にしたい

既定:

- PR budget: `5分`
- local budget: `90秒`
- `[gate.merge].sample_percentage = 30`
- promotion: `matched commits >= 20`, `FNR <= 5%`, `pass correlation >= 95%`
- demotion: rolling `30日` で false failure rate `> 2%` または incident `2件`

assets:

- `../assets/flaker.playwright-vrt-standard.toml`
- `../assets/workflow-pr-advisory.yml`
- `../assets/workflow-nightly-learning.yml`

注意:

- 0.13.0 で `adaptive = true` トグルは廃止された。代わりに `flaker calibrate` を実行して `[sampling]` を history から再計算し、`flaker.toml` に書き戻す
- `flaker calibrate` は matched commits や FNR history が十分に溜まってから実行する（目安は 30 commits 以上）
- 導入直後なら `bootstrap` を使い、history が薄いうちは `calibrate` を回さない

## 3. strict

使いどころ:

- release quality に直結する UI contract を守る
- dedicated shard を切る価値がある
- quarantine を強めに運用する

既定:

- PR budget: `10分`
- local budget: `120秒`
- `[gate.merge].sample_percentage = 20`
- promotion: 直近 `100 run` で unexplained false failure `0`
- demotion: unexplained false failure `1件` で advisory へ戻す

assets:

- `../assets/flaker.playwright-vrt-strict.toml`
- `../assets/workflow-pr-advisory.yml`
- `../assets/workflow-nightly-learning.yml`

## 4. 統計メモ

`0失敗 / n回` を独立ベルヌーイ近似で見ると、95% 片側上限は:

```text
upper_bound = 1 - 0.05^(1 / n)
```

目安:

- `10 run clean` -> 約 `25.9%`
- `20 run clean` -> 約 `13.9%`
- `60 run clean` -> 約 `4.9%`
- `300 run clean` -> 約 `1.0%`

つまり `10回通った` は burn-in にはよいが、gate 昇格の根拠としては弱い。
OSS の標準 preset では `60 run` をより強い目安とする。
