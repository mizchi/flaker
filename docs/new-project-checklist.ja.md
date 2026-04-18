# 新規プロジェクトへの flaker 導入チェックリスト

[English](new-project-checklist.md)

新しいリポジトリで flaker を「即日 → 1 週 → 1 ヶ月」の段階で価値を出すための手順書。0.3.0 以降を前提とする。

順番に実行すれば 30 分で初期セットアップが終わり、1 週間で計測ベースが整い、2〜4 週間で CI gating に昇格できる状態になる。

---

## Day 0: 前提確認 (5 分)

```bash
node --version    # >= 24
pnpm --version    # >= 10
git remote -v     # origin が GitHub を指している
gh auth status    # ログイン済み (collect ci に必要)
```

GitHub Actions を使っていない / 履歴が無い場合は、Day 1 の手順で `collect ci` を一旦スキップして「ローカル先行 → 後日 collect」のフローに切り替える。

`moon` (MoonBit) は不要。flaker は `dist/moonbit/flaker.js` を bundle 済みで配布し、無ければ TypeScript fallback (`src/cli/core/loader.ts`) で動く。

---

## Day 1: インストールと初期化 (15 分)

### 1. インストール

```bash
pnpm add -D @mizchi/flaker
```

### 2. `flaker.toml` を生成

adapter / runner をその場で指定:

```bash
# 例: vitest プロジェクト
pnpm flaker init --adapter vitest --runner vitest

# 例: playwright e2e
pnpm flaker init --adapter playwright --runner playwright

# 例: jest
pnpm flaker init --adapter jest --runner jest

# 例: actrun (GitHub Actions ローカル実行) で playwright をラップ
pnpm flaker init --adapter playwright --runner actrun
```

owner / name は git remote から自動検出される。`--owner` / `--name` で上書き可。

### 3. doctor で環境チェック

```bash
pnpm flaker doctor
```

期待する出力:

```
OK  config    flaker.toml is readable
OK  config rangesall values within expected ranges
OK  duckdb    DuckDB initialized successfully
OK  moonbit   MoonBit JS build detected (or fallback)

Doctor checks passed.
```

DuckDB が落ちる場合は `node --version` が 24 未満の可能性が高い。

### 4. affected resolver を設定

`flaker run --gate iteration` / `hybrid` strategy を活かすには resolver の設定が必要。プロジェクトの形に合わせて `[affected]` セクションを編集:

```toml
# pnpm workspaces / npm workspaces を使っているモノレポ
[affected]
resolver = "workspace"
config = ""

# glob ルール (`flaker.affected.toml` を別途作成)
[affected]
resolver = "glob"
config = "flaker.affected.toml"

# bitflow を使っている場合
[affected]
resolver = "bitflow"
config = ""
```

resolver を設定しないと `hybrid` は機能しないが、`weighted` / `random` フォールバックで動く。最初は workspace を試して、ハマったら次のレベルへ。

### 5. ローカルで dry-run

```bash
git diff --name-only main | tr '\n' ',' > /tmp/changed.txt
pnpm flaker run --gate iteration --dry-run --explain --changed "$(cat /tmp/changed.txt)"
```

`Selected tests:` の行に件数が出ればパイプライン稼働中。`Sampling Summary` セクションが空の場合は、対応するテストファイルが無い (project 初期で当然) か、resolver 設定不一致。

---

## Day 2-3: 最初のデータ収集 (30 分)

### 1. CI 履歴があるなら即取り込み

```bash
export GITHUB_TOKEN=$(gh auth token)
pnpm flaker collect ci --days 30
```

期待する出力:

```
Exported to Parquet: 12 test results, 4 commit changes
...
Collected N runs, N*X test results, ...
```

`Failed runs` がカウントされていても問題ない (失敗 run はスキップ)。`pending artifact runs` は GitHub Actions の retention 待ちなので、後でもう一度実行すれば取れる。

### 2. キャリブレーション

```bash
pnpm flaker collect calibrate
```

`flaker.toml` の `[sampling]` セクションに最適な戦略・サンプル率が書き込まれる。`--dry-run` を付ければ書き込まずに推奨だけ見られる。

データが少ないとき (commits < 20) は `confidence: insufficient` か `low` の警告が出るが無視して続行 OK。1 週間後に再度回せばよい。

### 3. KPI ダッシュボードで確認

```bash
pnpm flaker analyze kpi
```

最初は `Sampling Effectiveness` セクションが空 (matched commits = 0)。Week 1 が終われば `local pass / CI pass` の相関が計算できるようになる。

---

## Day 3: package.json scripts を整える

```jsonc
{
  "scripts": {
    "flaker": "flaker",
    "flaker:run:iteration": "flaker run --gate iteration",
    "flaker:run:release": "flaker run --gate release",
    "flaker:collect:ci": "flaker collect ci --days 7",
    "flaker:collect:local": "flaker collect local --last 1",
    "flaker:eval:markdown": "flaker analyze eval --markdown --window 7",
    "flaker:doctor": "flaker doctor"
  }
}
```

`pnpm flaker:run:iteration` を pre-push hook や lefthook / husky と組み合わせると、push 前に自動で affected テストだけ流せる。

---

## Day 5: GitHub Actions に統合 (advisory モード)

### 1. PR advisory ジョブ

`.github/workflows/ci.yml` に追加:

```yaml
- name: Setup Node
  uses: actions/setup-node@v4
  with:
    node-version: 24

- name: Setup pnpm
  uses: pnpm/action-setup@v4

- name: Install
  run: pnpm install --frozen-lockfile

- name: Run tests via flaker (advisory)
  run: pnpm flaker run --gate merge
  continue-on-error: true   # advisory mode
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

- name: Post sampling KPI as PR comment
  if: github.event_name == 'pull_request'
  run: |
    pnpm flaker analyze kpi > .artifacts/kpi.md
    pnpm flaker report summary --adapter vitest --input report.json --pr-comment \
      | gh pr comment ${{ github.event.pull_request.number }} --body-file -
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`continue-on-error: true` がポイント。最初の 2〜4 週間は **絶対に required check にしない**。データが揃うまで誤検知が出る。

### 2. nightly 履歴蓄積ジョブ

`.github/workflows/nightly-flaker.yml`:

```yaml
name: nightly flaker
on:
  schedule: [{ cron: "0 18 * * *" }]    # JST 03:00
  workflow_dispatch:
jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm flaker collect ci --days 1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - run: pnpm flaker run --gate release
      - run: pnpm flaker analyze eval --markdown --window 7 --output .artifacts/flaker-review.md
      - uses: actions/upload-artifact@v6
        with:
          name: flaker-nightly
          path: .artifacts/
```

毎晩 1 日分の CI 履歴を取り込み、release gate (= scheduled profile / full run) を回し、週次サマリを作る。

---

## Week 1: 観測と微調整

毎朝 5 分:

```bash
pnpm flaker analyze kpi      # 1 画面で全体把握
pnpm flaker analyze flaky    # 上位の flaky テスト
pnpm flaker analyze insights # CI vs local 差分
```

何か気になったら:

```bash
# 個別テストを N 回再実行して broken/flaky/transient 判定
pnpm flaker debug confirm "tests/api.test.ts:handles timeout" --runner local --repeat 10

# CI で失敗したテストをローカル再実行
pnpm flaker debug retry --run <run-id>

# どのコミットで flaky 化したか
pnpm flaker debug bisect --test "tests/api.test.ts:handles timeout"
```

---

## Week 2-4: required check に昇格する条件

`pnpm flaker analyze kpi` の `Sampling Effectiveness` セクションが以下を満たしたら CI gating に切り替えて OK:

| Metric | 目標 |
|---|---|
| Matched commits | ≥ 20 |
| Recall (CI failures caught) | ≥ 90% |
| False negative rate | ≤ 5% |
| Pass correlation | ≥ 95% |
| Holdout FNR (もし使うなら) | ≤ 10% |
| Co-failure data | "ready" |
| Data confidence | "moderate" or "high" |

到達したら、`ci.yml` の `continue-on-error: true` を外して required check 化。

### 自動キャリブレーション再実行

データが増えたら再キャリブレーション:

```bash
pnpm flaker collect calibrate
git diff flaker.toml   # 推奨値の変化を確認
```

---

## トラブルシュート (よくある詰まり)

| 症状 | 原因と対処 |
|---|---|
| `flaker.toml uses deprecated keys` | 0.1.x 以前の config。`docs/how-to-use.md#config-migration` の表で rename |
| `Config file not found` | プロジェクトルートで実行されていない。`cd` して `pnpm flaker init` から |
| `actrun runner requires [runner.actrun] workflow` | `[runner.actrun]` を `flaker.toml` に追加 |
| `hybrid` で 0 件しか選ばれない | resolver 未設定。`[affected].resolver` を埋める |
| `collect ci` が 0 runs | GITHUB_TOKEN 不足 or actions:read 権限不足。`gh auth refresh -s actions:read` |
| `analyze kpi` が `insufficient data` | コミット数 < 5。さらに collect する。1 週間運用すれば自然に解消 |
| 並列テストが timeout | DuckDB の単一書き手制約。同じ `.flaker/data.duckdb` を使う複数プロセスを直列化 |
| `dist/moonbit/flaker.js` が無い | `pnpm install` 後に flaker パッケージ内で `pnpm build` 済みのものが配られているはず。npm install 直後は問題なし |

---

## 1 ヶ月後の理想形

- `flaker run --gate merge` が PR の required check
- nightly が毎晩 history を更新
- 週次レポート (`analyze eval --markdown`) が自動生成され Slack/issue に流れる
- 開発者は手元で `pnpm flaker:run:iteration` だけで affected テストを回す
- flaky テストは `policy quarantine --auto --create-issues` で自動隔離 + Issue 化

ここまで来れば、CI 時間を 30〜70% 削減しつつ、見逃しは 5% 未満に保てる。

---

## 参照

- [README.md](../README.md) — プロジェクト概要
- [docs/usage-guide.ja.md](usage-guide.ja.md) — 利用側の入口
- [docs/operations-guide.ja.md](operations-guide.ja.md) — 運用側の入口
- [docs/how-to-use.ja.md](how-to-use.ja.md) — コマンドと設定の詳細
- [docs/contributing.md](contributing.md) — 開発・dogfood
- [CHANGELOG.md](../CHANGELOG.md) — バージョン履歴と breaking changes
