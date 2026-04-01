# ADR-006: 依存グラフ解析の所有権 — metrici vs bitflow

**日付:** 2026-03-31
**ステータス:** Open (未決定)

## コンテキスト

metrici に汎用的な依存グラフシステム (`src/cli/graph/`) を実装した。GraphAdapter で各エコシステム (npm, moon, cargo, actrun) のマニフェストを読み、GraphAnalyzer で共通のグラフ走査 (affected, transitive expansion, topological sort) を行う。

一方で bitflow (mizchi/bitflow) は既に MoonBit でグラフ解析コア（DAG 検証、位相ソート、影響展開、fingerprint）を持っている。

**問題: 高水準な依存解析ロジックは metrici と bitflow のどちらが所有すべきか？**

## 選択肢

### A: metrici が所有（現状）

```
metrici/src/cli/graph/
├── analyzer.ts         汎用グラフアルゴリズム (TypeScript)
└── adapters/           エコシステム別グラフ構築

bitflow は Starlark ベースの手動定義のみ
```

- 利点: metrici 内で完結。TypeScript で書けるのでコントリビューターのハードルが低い
- 欠点: bitflow のグラフ機能と重複。2 箇所でグラフアルゴリズムをメンテ

### B: bitflow が所有

```
bitflow/
├── graph/              汎用グラフアルゴリズム (MoonBit)
├── adapters/           エコシステム別グラフ構築 (MoonBit)
│   ├── npm.mbt
│   ├── moon.mbt
│   ├── cargo.mbt
│   └── actrun.mbt
└── starlark/           手動定義 (既存)

metrici は bitflow をライブラリとして呼ぶだけ
```

- 利点: グラフロジックが 1 箇所に集約。MoonBit の型安全性。bitflow を他ツールからも利用可能
- 欠点: bitflow の scope が広がる。Node.js プロジェクトのグラフ構築を MoonBit でやるのは冗長かもしれない

### C: ハイブリッド

```
bitflow: 汎用グラフアルゴリズム + Starlark 定義 (MoonBit)
metrici: エコシステム別アダプタ (TypeScript) → bitflow のグラフ形式に変換
```

- 利点: アダプタは TS で書きやすい（ファイル読み込み、JSON/TOML パース）。アルゴリズムは bitflow で集約
- 欠点: 変換レイヤーが追加

## 検討ポイント

1. **bitflow の graph 形式 (FlowNode, FlowIr)** と **metrici の graph 形式 (GraphNode, DependencyGraph)** は似ているが同一ではない。統一すべきか？
2. bitflow にエコシステムアダプタを追加すると、bitflow が npm/cargo/actrun の知識を持つことになる。bitflow の設計思想と合うか？
3. metrici の graph/ は TypeScript で書かれている。bitflow に移すなら MoonBit で書き直す必要がある。その価値はあるか？
4. 将来的に graph 解析を他ツール (actrun 等) からも使いたい場合、bitflow に集約する方が再利用性が高い

## 現時点の結論

**保留。** 現状の metrici 側実装で運用しながら、以下の条件で bitflow への移行を検討する:

- bitflow に `GraphAdapter` 相当の抽象化を入れる設計が固まったとき
- 他ツール (actrun) からも同じグラフ解析を利用したいユースケースが出たとき
- MoonBit のエコシステム対応 (package.json パース等) が実用的になったとき
