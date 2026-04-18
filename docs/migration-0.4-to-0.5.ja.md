# flaker 0.4 → 0.5 Migration Guide

[English](migration-0.4-to-0.5.md)

`0.5.x` は `0.2.0` のような hard breaking release ではない。
`0.4.x` の `flaker.toml` や profile ベースの運用は、そのまま継続できる。

今回の移行は主に:

- 利用者向けの表現を `profile` 中心から `gate` 中心へ寄せる
- 日常利用と運用管理のドキュメントを分離する

という UX 整理である。

## まず結論

必須の config rename はない。

ただし、利用者向けの案内や script は次の形へ寄せるのを推奨する。

| 0.4 までの案内 | 0.5 での推奨 |
|---|---|
| `flaker run --profile local` | `flaker run --gate iteration` |
| `flaker run --profile ci` | `flaker run --gate merge` |
| `flaker run --profile scheduled` | `flaker run --gate release` |
| `flaker debug doctor` | `flaker doctor` |
| `flaker analyze kpi` | `flaker status` |

## 変えなくてよいもの

- `flaker.toml` の `[profile.local]`, `[profile.ci]`, `[profile.scheduled]`
- custom profile を使う CI script
- `analyze`, `debug`, `policy`, `dev` 配下の詳細コマンド
- sampling strategy 名 (`affected`, `hybrid`, `weighted`, `full` など)

つまり `0.4.x` の運用は壊さず、`0.5.x` では入口だけを薄くするイメージ。

## Gate と profile の対応

`gate` は新しい内部概念ではなく、既存 profile を利用者向けに言い換えた薄い surface。

| Gate | 実体 |
|---|---|
| `iteration` | `profile.local` |
| `merge` | `profile.ci` |
| `release` | `profile.scheduled` |

advanced / custom profile を使う場合は引き続き `--profile` を使ってよい。

## 利用者向け script の移行例

### ローカル実行

```bash
# before
pnpm flaker run --profile local

# after
pnpm flaker run --gate iteration
```

### dry-run と explain

```bash
# before
pnpm flaker run --profile local --dry-run --explain

# after
pnpm flaker run --gate iteration --dry-run --explain
```

### ヘルス確認

```bash
# before
pnpm flaker analyze kpi
pnpm flaker debug doctor

# after
pnpm flaker status
pnpm flaker doctor
```

## CI 側の扱い

`0.4.x` で `--profile ci` や custom profile を使っているなら、すぐに置き換える必要はない。

次の方針を推奨する。

1. 利用者向け README や package script は `--gate` へ寄せる
2. CI は当面 `--profile` のままでもよい
3. gate 名で十分表現できる job だけ順次 `--gate merge` / `--gate release` に寄せる

## ドキュメント導線の変更

`0.5.x` では docs を役割別に分離している。

- 日常利用: [usage-guide.ja.md](usage-guide.ja.md)
- 運用設計: [operations-guide.ja.md](operations-guide.ja.md)
- 詳細リファレンス: [how-to-use.ja.md](how-to-use.ja.md)

`0.4.x` で README や `how-to-use` を直接見ていた利用者は、まず `usage-guide` から入るのがよい。

## 推奨確認手順

upgrade 後は次を確認する。

```bash
pnpm flaker doctor
pnpm flaker run --gate iteration --dry-run --explain
pnpm flaker status
```

CI で gate を使う場合は:

```bash
pnpm flaker run --gate merge
```

## 既知の注意点

- `0.5.x` は gate-oriented UX を追加した release で、profile API を削除した release ではない
- `0.2.0` 以前から上げる場合は、このページではなく [how-to-use.md#config-migration](how-to-use.md#config-migration) を先に見る
