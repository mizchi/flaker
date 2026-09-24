# flaker Management Guide

最短の導入手順だけ欲しい場合は先に `../../docs/flaker-management-quickstart.ja.md` を読む。

この guide は `flaker` を導入した後の運用を扱う。
対象は次のような repo。

- advisory の `flaker run --gate merge` はあるが、まだ required にしていない
- nightly / scheduled で full run を回している
- Playwright E2E / VRT を徐々に gate に入れたい
- flaky tag や quarantine を使って suite の信頼を保ちたい

## 1. レーン設計

運用は 3 レーンで考える。

- `Learning lane`
  `main` push または nightly schedule で広く回す。目的は gate ではなく観測、学習、安定化。
- `Verdict lane`
  pull request の CI で回す。ここに入るのは、十分に観測され、速く、意図が明確な check だけ。
- `Rebalance lane`
  1 日 1 回または nightly で回す。昇格候補と降格候補を見つけ、`@flaky` と quarantine を更新する。

`Learning lane` を消さないこと。`Verdict lane` はそこから選抜された subset にする。

## 2. 毎日の loop

最低限の daily or nightly loop (0.13.0 以降は `apply` の reconcile に寄せるのが基本):

```bash
mkdir -p .artifacts
flaker apply
flaker status --markdown --window-days 7 > .artifacts/flaker-review.md
```

`apply` は内部で `import --ci`（history 収集）/ `calibrate` / `quarantine_apply`（`[quarantine].auto = true` のとき）を状態に応じて自動実行する。個別に叩きたい場合のみ:

```bash
flaker import --ci --days 1
flaker run --gate release
flaker status --list flaky --json > .artifacts/flaky-list.json
```

旧 `flaker analyze flaky-tag` による triage コマンドと `flaker policy quarantine --auto --create-issues` は 0.13.0 で廃止された。flaky 一覧は `flaker status --list flaky`、quarantine の適用は `flaker.toml` の `[quarantine].auto = true` を設定した上で `flaker apply` に任せる（`apply` が `quarantine_apply` アクションとして実行する）。

この loop の役割:

- full 実行で history を蓄積する
- unstable test を `Verdict lane` から外す候補を出す
- stable に戻った test を復帰候補として出す
- 週次レビューの材料を Markdown に残す

## 3. 週次レビュー

毎週レビューする項目:

- `matched commits`
- `false negative rate`
- `pass correlation`
- `sample ratio`
- `saved test minutes`
- `flaky` / `quarantined` test 数
- fallback rate
- 新規に追加された unstable test

テンプレートは `../assets/weekly-review-template.md` を使う。

### 昇格の判断

`Verdict lane` を advisory から required に上げる条件は、次を基本線にする。

- `matched commits >= 20`
- `false negative rate <= 5%`
- `pass correlation >= 95%`
- `data confidence` が `moderate` 以上

Playwright E2E / VRT では、これに加えて:

- その test の `user-visible contract` が説明できる
- dynamic region と non-goal が定義されている
- PR budget に収まる

### 降格の判断

次のどれかに当たるなら、一度 advisory または `@flaky` / quarantine に戻す。

- unexplained false failure が継続する
- rolling window で false failure rate が高い
- owner が不在
- 何を守る test か説明できない
- runtime budget を圧迫している

## 4. Playwright E2E / VRT の扱い

Playwright VRT は特に環境依存性が高い。昇格前に先に潰すべきは threshold ではなく環境ノイズ。

- OS / browser / viewport / locale / timezone を固定する
- font を固定する
- clock / random / network を固定する
- animation を止める
- `mask` / `stylePath` で dynamic region を消す
- full-page snapshot より local contract を優先する

新規 test は最初から gate に入れない。`Learning lane` で burn-in し、意図と揺れ方を把握してから昇格させる。

## 5. AI-generated code に対する追加原則

AI 生成コードでは `理解の負債` と `意図の負債` が増えやすい。
だから VRT 失敗時に snapshot 更新だけで閉じない。

最低でも、失敗理由を次から 1 つ選んで記録する。

- `intent-debt`
- `comprehension-debt`
- `environment-noise`
- `test-design`
- `real-regression`

これは `Verdict` だけではなく `Learning` を残すための操作である。

## 6. flaker への落とし込み

基本の config 役割 (0.13.0 以降は `[profile.*]` ではなく `[gate.*]`):

- `[gate.release]`
  full execution。history の母集団。
- `[gate.merge]`
  PR selective execution。`skip_flaky_tagged = true` を有効にして Verdict lane を守る。
- `[gate.iteration]`
  開発者向けの短い feedback loop。`affected` と `max_duration_seconds` を使う。

基本コマンド (`analyze kpi` / `analyze eval` / `analyze flaky-tag` / `policy quarantine` は 0.13.0 で廃止):

```bash
flaker status
flaker status --markdown --window-days 7
flaker status --list flaky --json
flaker apply   # [quarantine].auto = true なら quarantine_apply も自動実行される
```

incident 時:

```bash
flaker debug retry --run <workflow-run-id>
flaker debug confirm "path/to/spec.ts:test name" --runner local
flaker debug diagnose --suite path/to/spec.ts --test "test name"
```

## 7. 推奨 cadence

- per PR
  `flaker run --gate merge`
- daily or nightly
  `flaker apply`（内部で `import --ci` 相当の収集 + calibrate + quarantine 適用）+ `flaker run --gate release` + `flaker status --markdown`
- weekly
  KPI review, promote / keep / demote の判断
- monthly
  budget 見直し、preset 見直し、quarantine の stale cleanup
