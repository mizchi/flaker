# ADR-001: metrici アーキテクチャ概要

> **Superseded by [ADR-008](./008-apply-first-architecture.md) (2026-04-20)**.
> This document reflects the pre-rebrand "metrici" architecture and the 0.5-era CLI surface.
> It is preserved for historical context.

**日付:** 2026-03-31
**ステータス:** Accepted

## コンテキスト

大規模テストスイートの flaky test 管理とテストサンプリングを行う CLI ツール metrici を開発している。Chrome LUCI/ResultDB、Microsoft TIA、Google TAP を参考に、小規模チームでも運用可能な軽量版を目指す。

## 決定

### 全体構成

```
metrici CLI (TypeScript)
├── Commands: init, collect, collect-local, import, flaky, sample, run, query, quarantine, bisect, eval
├── Adapters (結果パーサ): Playwright JSON, JUnit XML, actrun, Custom
├── Runners (テスト実行): Vitest, Playwright, MoonBit, Custom
├── Resolvers (依存分析): Simple, Workspace, Moon, Bitflow
├── Orchestrator (実行制御): バッチ分割 + 並列実行
├── Storage: DuckDB
└── Core (MoonBit → JS): flaky検出, サンプリング, bitflow統合
```

### 言語分離

| レイヤー | 言語 | 理由 |
|---------|------|------|
| コア計算 | MoonBit (JS target) | flaky 検出・サンプリングアルゴリズムは計算集約。MoonBit で型安全に書き、JS にコンパイル。bitflow をライブラリとして直接 import 可能 |
| I/O・CLI | TypeScript | GitHub API、DuckDB、プロセス実行、CLI の組み立て。Node.js エコシステムとの親和性 |

MoonBit → JS の FFI boundary は JSON シリアライズ。TS fallback を用意し、MoonBit ビルドが無くても動作する。

### データ収集の 3 経路

```
1. metrici collect        GitHub Actions API → artifact (zip) → アダプタパース → DuckDB
2. metrici collect-local  actrun ローカル実行履歴 → JSON パース → DuckDB
3. metrici import <file>  ローカルレポートファイル → アダプタパース → DuckDB
```

## 根拠

- **DuckDB** を選んだのは分析クエリ（ウィンドウ関数、FILTER句）が強力で、ローカルファイルで完結するため。将来の SQLite 対応に備えて MetricStore インターフェースを切っている。
- **MoonBit JS target** を選んだのは WASM-GC より Node.js 統合が容易なため。bitflow (MoonBit 製) をライブラリとして直接 import でき、CLI 呼び出しのオーバーヘッドがない。
- **アダプタ/ランナー/リゾルバーの 3 層分離** により、テストランナーの追加が各層で独立して行える。
