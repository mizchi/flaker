# flaker 利用ガイド

[English](usage-guide.md)

`flaker` を **利用側** として日常的に使うための入口。
このページは「どのコマンドを覚えればよいか」を最短で整理する。

次は扱わない:

- advisory / required の昇格条件
- quarantine の運用ポリシー
- nightly や weekly review の設計
- Playwright E2E / VRT の rollout

それらは [operations-guide.ja.md](operations-guide.ja.md) を参照。

まだ導入していない場合は [new-project-checklist.ja.md](new-project-checklist.ja.md) から始める。
`0.4.x` から上げる場合は [migration-0.4-to-0.5.ja.md](migration-0.4-to-0.5.ja.md) を先に見る。

## 対象読者

- 既に `flaker.toml` がある repo の開発者
- 日常的に `flaker` で手元のテストを回したい人
- CI 運用の細かい設計ではなく、まず使い方を知りたい人

## まず覚える 4 コマンド

```bash
pnpm flaker doctor   # canonical: flaker debug doctor
pnpm flaker run --gate iteration
pnpm flaker run --dry-run --gate iteration --explain
pnpm flaker status
```

意味:

- `doctor`: 実行環境の確認 (`flaker doctor` は onboarding 用エイリアス。正式形は `flaker debug doctor`)
- `run --gate iteration`: 普段のローカル実行
- `run --dry-run --explain`: 何が選ばれたかを確認
- `status`: 現在の健全性をざっと見る

## Gate の見方

利用者が意識すべき gate は 3 つだけ。

| Gate | 主な用途 | 普段の利用者が触るか |
|---|---|---|
| `iteration` | 手元の高速フィードバック | はい |
| `merge` | PR / mainline の gate | ときどき |
| `release` | full またはそれに近い厳密確認 | ふつうは CI 側 |

通常は `iteration` だけ覚えれば足りる。

## よくある流れ

### 変更前に確認

```bash
pnpm flaker debug doctor
```

### push 前に preview

```bash
pnpm flaker run --dry-run --gate iteration --explain --changed src/foo.ts,src/bar.ts
```

### 実際に回す

```bash
pnpm flaker run --gate iteration --changed src/foo.ts,src/bar.ts
```

### 今の状態を見る

```bash
pnpm flaker status
```

## もっと詳しく見るとき

- 詳細なコマンドリファレンス: [how-to-use.ja.md](how-to-use.ja.md)
- runner / adapter の詳細: [runner-adapters.md](runner-adapters.md), [test-result-adapters.md](test-result-adapters.md)
- 失敗の調査: [diagnose.md](diagnose.md), `flaker ops incident`, `flaker debug confirm`, `flaker debug retry`
- 導入手順: [new-project-checklist.ja.md](new-project-checklist.ja.md)
- 運用設計: [operations-guide.ja.md](operations-guide.ja.md)
