# ADR-006: 依存グラフ解析の所有権 — metrici vs bitflow

**日付:** 2026-03-31
**ステータス:** Accepted

> **Status (as of 0.10.3)**: Phase 1 and Phase 2 are **shipped**. The graph algorithm lives in MoonBit (`src/graph/graph_core.mbt`, ~150 LOC, exports `find_affected_nodes` / `get_affected_test_patterns`). `GraphResolver.resolve()` delegates to `core.findAffectedNodes` / `core.getAffectedTestPatterns` (`src/cli/resolvers/graph.ts:14-18`). Phase 3 (upstream bitflow takeover) remains open; bitflow 0.4.1 is pinned in `moon.mod.json` but does not yet expose the graph surface.

## コンテキスト

metrici に汎用的な依存グラフシステム (`src/cli/graph/`) を実装した。GraphAdapter で各エコシステム (npm, moon, cargo, actrun) のマニフェストを読み、GraphAnalyzer で共通のグラフ走査 (affected, transitive expansion, topological sort) を行う。

一方で bitflow (mizchi/bitflow) は既に MoonBit でグラフ解析コア（DAG 検証、位相ソート、影響展開、fingerprint）を持っている。

**問題: 高水準な依存解析ロジックは metrici と bitflow のどちらが所有すべきか？**

加えて、flaker はまだプロトタイプ段階であり、複雑な純計算ロジックは段階的に MoonBit へ寄せた方が長期の保守性が高い。
既に flaky detection / sampling / bitflow affected は MoonBit JS target で実装済みであり、graph analyzer も同じ方針へ寄せる余地がある。

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

## 決定

**選択肢 C: ハイブリッドを採用する。**

ただし、単なるハイブリッドではなく、以下の ownership と移行方針を固定する。

### Ownership

- **bitflow / MoonBit が所有するもの**
  - canonical graph IR
  - graph algorithm (`affected`, transitive expansion, topological sort, fingerprint と隣接する純計算)
  - 将来的な graph-related metadata の意味論
- **flaker が所有するもの**
  - CLI / Node.js shell
  - ecosystem adapter (npm, cargo, actrun, workspace manifest 読み込み)
  - test selection に必要な `testPatterns` / task metadata への写像
  - GitHub / actrun / local filesystem との統合

### Boundary

- flaker の adapter は ecosystem 固有ファイルを読み、**graph IR 相当の JSON** を構築する
- graph algorithm は MoonBit core に渡して評価する
- flaker は algorithm の結果を sampling / affected explain / report に利用する

つまり、**adapter は flaker、algorithm は bitflow/MoonBit** という境界にする。

## MoonBit-First Policy

flaker は今後、複雑な純計算ロジックを原則として MoonBit に寄せる。

- 新しい複雑ロジックは **MoonBit first**
- TypeScript は shell / I/O / integration 層を優先
- TypeScript fallback は bootstrap と開発互換のために残すが、**feature parity の主戦場にはしない**

ここでいう「複雑な純計算ロジック」とは:

- graph traversal / affected expansion
- sampling / ranking / KPI 集計のような集計処理
- deterministic で副作用のない rule evaluation

逆に、以下は当面 TypeScript に残す:

- `package.json`, YAML, TOML, XML, JSON artifact の読み込み
- GitHub API / actrun CLI / filesystem との接続
- commander ベースの CLI

## なぜこの決定か

### 1. 現在の重複コストは algorithm 側にある

sampling / flaky detection / bitflow affected は既に MoonBit core を優先しているが、graph analyzer は TypeScript に残っている。
保守コストを下げるには、Node shell を MoonBit に移すより、まず algorithm の二重管理をやめる方が効果が大きい。

### 2. adapter は Node.js 側の方が実装しやすい

`package.json`, `pnpm-workspace.yaml`, GitHub Actions YAML の読み込みや path/glob の扱いは TypeScript の方が素直で、I/O も既存資産を流用しやすい。

### 3. MoonBit は純計算の安定化に向いている

型安全・不変寄りの設計・テストしやすさの観点で、graph traversal のようなロジックは MoonBit の方が長期保守に向く。

## 非目標

- ecosystem adapter を直ちに bitflow へ全面移植すること
- flaker の CLI や I/O 層を MoonBit へ全面移植すること
- build cache ownership を flaker に戻すこと

build/cache の ownership は引き続き ADR-007 に従い、bitflow が持つ。

## 段階移行

### Phase 1

- `src/cli/graph/analyzer.ts` 相当の pure algorithm を MoonBit へ移す（the previous TypeScript analyzer (removed in 0.9.0) has been replaced by the MoonBit core）
- 既存 `GraphNode` / `DependencyGraph` を参考に canonical IR の最小形を決める

### Phase 2

- flaker の graph adapter を `buildGraph()` から「IR を返す adapter」へ寄せる
- `GraphResolver` は TS analyzer を直接呼ばず、MoonBit core を経由する

### Phase 3

- bitflow 側で graph IR / algorithm を安定 API として公開できるなら、flaker の MoonBit core から bitflow 実装へ統合する
- この時点で TS fallback の責務をさらに縮小する

## 結果

- graph algorithm の canonical owner は bitflow / MoonBit
- flaker は adapter と integration shell に集中する
- 今後の複雑ロジックは MoonBit first で設計する
- 既存 TypeScript 実装は即時廃止しないが、段階的に shell へ押し戻す
