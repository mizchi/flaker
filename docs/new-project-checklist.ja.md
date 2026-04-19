# 新規プロジェクトへの flaker 導入チェックリスト

[English](new-project-checklist.md)

新しいリポジトリで flaker を「即日 → 1 週 → 1 ヶ月」の段階で価値を出すための手順書。0.7.0 以降を前提とする。

Day 1 は `init → doctor → plan → apply → status` の 5 ステップで収束させる。順に実行すれば 30 分で初期セットアップが終わり、1 週間で計測ベースが整い、2〜4 週間で CI gating に昇格できる状態になる。

---

## Day 0: 前提確認 (5 分)

```bash
node --version    # >= 24
pnpm --version    # >= 10
git remote -v     # origin が GitHub を指している
gh auth status    # ログイン済み (flaker apply で履歴収集するときに必要)
```

GitHub Actions を使っていない / 履歴が無い場合も問題ない。`flaker apply` は履歴ゼロの repo では cold-start 経路 (local run で self-seed) を選ぶので、Day 1 の手順はそのまま通る。CI 履歴は後から自然に溜まる。

`moon` (MoonBit) は不要。flaker は `dist/moonbit/flaker.js` を bundle 済みで配布し、無ければ TypeScript fallback (`src/cli/core/loader.ts`) で動く。

---

## Day 1: インストールから収束まで (15 分)

Day 1 は次の 5 ステップで完結する。個別のキャリブレーション / 履歴取り込みは `flaker apply` が内部で面倒を見るので、ユーザーが順序を覚える必要はない。

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

0.7.0 以降、`flaker init` は `[profile.scheduled]` / `[profile.ci]` / `[profile.local]` の既定値も同時に書き込む。

### 3. doctor で環境チェック

```bash
pnpm flaker doctor
```

期待する出力:

```
OK  config          flaker.toml is readable
OK  config ranges   all values within expected ranges
OK  duckdb    DuckDB initialized successfully
OK  moonbit   MoonBit JS build detected (or fallback)

Doctor checks passed.
```

DuckDB が落ちる場合は `node --version` が 24 未満の可能性が高い。

### 4. affected resolver を設定

`flaker run --gate iteration` / `hybrid` strategy を活かすには resolver の設定が必要。プロジェクトの形に合わせて `flaker.toml` の `[affected]` セクションを編集:

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

### 5. `flaker plan` で差分を確認

```bash
export GITHUB_TOKEN=$(gh auth token)
pnpm flaker plan
```

`flaker.toml` を desired state として、今 DB に何が欠けているかを planner が示す。履歴ゼロの repo なら `collect_ci` + `cold_start_run` が、`[quarantine].auto=true` のときは `quarantine_apply` も plan に載る。

### 6. `flaker apply` で収束させる

```bash
pnpm flaker apply
```

`flaker apply` は `collect` / `calibrate` / `quarantine apply` を現状に応じて自動で順に実行する idempotent コマンド。同じコマンドを cron や nightly で回しても状態が壊れない。

### 7. `flaker status` で確認

```bash
pnpm flaker status
```

サマリダッシュボードが 1 画面で出る。Day 1 段階では `data confidence: insufficient` が出て普通。1 週間運用すると自然に `moderate` に上がる。

---

## Day 2-3: 継続的な apply

`flaker apply` は idempotent なので、Day 2 以降は「1 日 1 回走らせておく」だけで十分。手動で `collect` / `calibrate` を順に叩く必要はない。

```bash
export GITHUB_TOKEN=$(gh auth token)
pnpm flaker apply
pnpm flaker status                 # 日次ダッシュボード
pnpm flaker status --detail        # KPI ビュー (旧 analyze kpi)
```

<details><summary>内部で何が走っているか知りたい・個別コマンドで掘りたい場合</summary>

`flaker apply` は内部的に以下を現状に応じて実行する。単体で叩きたい場合は直接呼んでもよい (0.7.0 以降はすべて deprecated / hidden、`flaker apply` が canonical)。

**CI 履歴取り込み:**

```bash
export GITHUB_TOKEN=$(gh auth token)
pnpm flaker collect ci --days 30
```

**キャリブレーション:**

```bash
pnpm flaker collect calibrate
```

`flaker.toml` の `[sampling]` セクションに最適な戦略・サンプル率が書き込まれる。`--dry-run` を付ければ書き込まずに推奨だけ見られる。

データが少ないとき (commits < 20) は `confidence: insufficient` か `low` の警告が出るが無視して続行 OK。1 週間後に再度 `flaker apply` を回せば自然に更新される。

</details>

---

## Day 3: package.json scripts を整える

0.7.0 以降は apply-first の script 構成にする:

```jsonc
{
  "scripts": {
    "flaker": "flaker",
    "flaker:plan": "flaker plan",
    "flaker:apply": "flaker apply",
    "flaker:status": "flaker status",
    "flaker:run:iteration": "flaker run --gate iteration",
    "flaker:run:release": "flaker run --gate release",
    "flaker:eval": "flaker status --markdown",
    "flaker:doctor": "flaker doctor"
  }
}
```

`pnpm flaker:run:iteration` を pre-push hook や lefthook / husky と組み合わせると、push 前に自動で affected テストだけ流せる。`pnpm flaker:apply` は毎朝の cron / launchd 向け。

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

- name: Post status as PR comment
  if: github.event_name == 'pull_request'
  run: |
    pnpm flaker status --markdown > .artifacts/status.md
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
  apply:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm flaker apply
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - run: pnpm flaker status --markdown > .artifacts/flaker-status.md
      - uses: actions/upload-artifact@v6
        with:
          name: flaker-nightly
          path: .artifacts/
```

毎晩 `flaker apply` で現状を収束させ、`flaker status --markdown` で週次レビュー用の artifact を残す。

---

## Week 1: 観測と微調整

毎朝 5 分:

```bash
pnpm flaker status              # 1 画面で全体把握
pnpm flaker status --list flaky # 上位の flaky テスト
pnpm flaker explain insights    # CI vs local 差分などの AI 分析
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

`pnpm flaker status` の drift セクションが `ready` を示したら CI gating に切り替えて OK。より詳細な actual 値を確認したいときは `pnpm flaker status --gate merge --detail`。到達目安は以下:

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

`flaker apply` を回し続ける限り、データが増えれば自動で再キャリブレーションされる。明示的に状態を確認したい場合:

```bash
pnpm flaker apply
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
| `flaker apply` が 0 runs しか取れない | GITHUB_TOKEN 不足 or actions:read 権限不足。`gh auth refresh -s actions:read` |
| `flaker status` が `data confidence: insufficient` | コミット数 < 5。`flaker apply` を回し続ければ自然に解消 (1 週間目安) |
| 並列テストが timeout | DuckDB の単一書き手制約。同じ `.flaker/data.duckdb` を使う複数プロセスを直列化 |
| `dist/moonbit/flaker.js` が無い | `pnpm install` 後に flaker パッケージ内で `pnpm build` 済みのものが配られているはず。npm install 直後は問題なし |

---

## 1 ヶ月後の理想形

- `flaker run --gate merge` が PR の required check
- nightly で `flaker apply` が毎晩 history を更新
- 週次レポート (`flaker status --markdown`) が自動生成され Slack/issue に流れる
- 開発者は手元で `pnpm flaker:run:iteration` だけで affected テストを回す
- flaky テストは `[quarantine].auto=true` + `flaker apply` の自動隔離で吸収される

ここまで来れば、CI 時間を 30〜70% 削減しつつ、見逃しは 5% 未満に保てる。

---

## 参照

- [README.md](../README.md) — プロジェクト概要
- [docs/usage-guide.ja.md](usage-guide.ja.md) — 利用側の入口
- [docs/operations-guide.ja.md](operations-guide.ja.md) — 運用側の入口
- [docs/how-to-use.ja.md](how-to-use.ja.md) — コマンドと設定の詳細
- [docs/migration-0.6-to-0.7.md](migration-0.6-to-0.7.md) — 0.6.x からの移行ガイド
- [docs/contributing.md](contributing.md) — 開発・dogfood
- [CHANGELOG.md](../CHANGELOG.md) — バージョン履歴と breaking changes
