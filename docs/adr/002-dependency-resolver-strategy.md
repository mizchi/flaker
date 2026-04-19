# ADR-002: 依存分析リゾルバー戦略

**日付:** 2026-03-31
**ステータス:** Accepted

> **Update (0.9.0 → 0.10.0)**: Node / Moon / Cargo / Actrun dependency graph construction is unified behind the `GraphAdapter` abstraction in `src/cli/graph/`, with the cross-ecosystem algorithm in MoonBit at `src/graph/graph_core.mbt`. See ADR-006 for the ownership decision and phase status.

## コンテキスト

テストサンプリングの `affected` 戦略では「変更されたファイルに影響を受けるテスト」を特定する必要がある。依存関係の発見方法には大きく 2 つのアプローチがある:

1. **自動発見** — 既存の manifest (package.json, moon.pkg) から依存グラフを構築（vite-task の方式）
2. **手動定義** — Starlark 等の DSL でワークフローを記述（bitflow の方式）

## 決定

**両方をサポートし、プロジェクトに応じて使い分ける。**

```
DependencyResolver (interface)
├── SimpleResolver       ディレクトリ名マッチング。設定不要。精度低。
├── WorkspaceResolver    package.json の dependencies から自動構築。Node.js monorepo 向け。
├── MoonResolver         moon.pkg の import から自動構築。MoonBit プロジェクト向け。
└── BitflowNativeResolver  Starlark 定義から構築。MoonBit ライブラリとして直接呼び出し。
```

設定で切り替え:

```toml
[affected]
resolver = "workspace"    # or "moon", "bitflow", "simple"
config = "metrici.star"   # bitflow の場合のみ必要
```

### 各リゾルバーの使い分け

| リゾルバー | 設定コスト | 精度 | 適用先 |
|-----------|----------|------|-------|
| `simple` | ゼロ | 低（ディレクトリ名推測） | 小規模プロジェクト、fallback |
| `workspace` | ゼロ | 中（パッケージレベル） | pnpm / npm / yarn monorepo |
| `moon` | ゼロ | 中（パッケージレベル） | MoonBit プロジェクト |
| `bitflow` | 中（Starlark 記述） | 高（ファイルレベル glob） | 複雑な依存、非標準構成 |

### hybrid 戦略との組み合わせ

```
metrici run --strategy hybrid --count 50
  1. Resolver で affected テストを特定（全数実行）
  2. 前回失敗テストを追加（全数実行）
  3. 新規テストを追加（全数実行）
  4. 残り枠を flaky_rate 重み付きランダムで埋める
```

## 根拠

### vite-task から学んだこと

- vite-task は package.json の `dependencies` + `workspace:` プロトコルから依存グラフを自動構築する
- ゼロ設定で動作し、既存の manifest を二重管理しない
- クエリ時にパッケージ選択を動的に変更でき、柔軟性が高い
- **採用:** WorkspaceResolver として実装。pnpm-workspace.yaml と package.json workspaces の両方をサポート

### bitflow を残す理由

- 自動発見はパッケージレベルの粒度。ファイルレベルの依存（例: `src/auth/**` が `tests/e2e/checkout.spec.ts` に影響）は表現できない
- Starlark は条件分岐や変数が使え、複雑なワークフローに対応可能
- bitflow は MoonBit 製なので metrici コアに直接 import でき、CLI オーバーヘッドがない

### MoonResolver を独立させた理由

- MoonBit の moon.pkg は Node.js の package.json とは構造が異なる（import パスの形式、テストファイルの命名規則 `_test.mbt`）
- crater のような MoonBit + Node.js 混成プロジェクトでは、MoonBit 部分は MoonResolver、Node.js 部分は WorkspaceResolver と使い分ける
- 将来的に 1 プロジェクトで複数リゾルバーを組み合わせる設計も検討可能

## 結果

- `metrici.toml` の `[affected] resolver` で切り替え
- Node.js monorepo ではゼロ設定で `workspace` が使える
- MoonBit プロジェクトではゼロ設定で `moon` が使える
- 複雑な要件がある場合のみ bitflow Starlark を書く
