# ADR-004: MoonBit JS ターゲットによるコア計算の統合

**日付:** 2026-03-31
**ステータス:** Accepted

## コンテキスト

metrici のコア計算（flaky 検出、サンプリング、依存分析）を TypeScript とは別の言語で実装し、パフォーマンスと型安全性を確保したい。候補:

1. **MoonBit → WASM-GC** — ブラウザ互換だが Node.js の WASM-GC サポートが限定的
2. **MoonBit → JS** — Node.js で直接 import 可能
3. **Rust → NAPI** — 高速だがビルドチェーンが重い
4. **TypeScript のみ** — 追加依存なしだが計算ロジックの型安全性が低い

## 決定

**MoonBit → JS ターゲット** を採用。TS fallback を用意し、MoonBit ビルドが無くても動作する。

```
src/ (MoonBit source root)
├── contracts/           共有 JSON 契約
├── analysis/            flaky / sampling / affected / graph
├── reporting/           summary / diff / aggregate
├── policy/              quarantine / config ownership
├── metrics/             eval / KPI reducer
└── cli/bridge/          JS FFI export (ESM)

src/cli/core/loader.ts (TypeScript)
├── loadCore()          MoonBit JS を dynamic import、失敗時は TS fallback
├── wrapMbtCore()       JSON FFI ラッパー
└── TS fallback         全関数の純 TypeScript 実装
```

### FFI Boundary

```
TypeScript → JSON.stringify(input) → MoonBit fn(String) → JSON.parse(output) → TypeScript
```

MoonBit 側の export:
- `detect_flaky_json(input: String) -> String`
- `sample_random_json(meta: String, count: Int, seed: Int) -> String`
- `sample_weighted_json(meta: String, count: Int, seed: Int) -> String`
- `sample_hybrid_json(meta: String, affected: String, count: Int, seed: Int) -> String`
- `resolve_affected_json(workflow: String, changed: String) -> String`

### bitflow のライブラリ統合

bitflow (mizchi/bitflow) は MoonBit 製。`moon.mod.json` の deps に追加するだけで、Starlark パーサ・DAG 展開をライブラリとして直接利用可能。CLI 呼び出しのプロセス起動オーバーヘッドがない。

```json
// moon.mod.json
{
  "source": "src",
  "deps": {
    "mizchi/bitflow": "0.3.1"
  }
}
```

## 根拠

### JS ターゲットを選んだ理由

- Node.js で `import()` するだけで動作。WASM ランタイムの初期化不要
- ESM 形式で出力されるため、既存の TypeScript ビルドチェーンと互換
- デバッグが容易（生成 JS を直接読める）
- bitflow 等の MoonBit ライブラリをそのまま deps に追加可能

### WASM-GC を見送った理由

- Node.js の WASM-GC サポートがまだ experimental flag 必要
- GC 付き WASM のインスタンス化が遅い
- 文字列の受け渡しが複雑（linear memory vs GC heap）

### TS fallback を用意する理由

- MoonBit のビルド環境がなくてもテスト・開発が可能
- CI で MoonBit のインストールをスキップできる
- コントリビューターのハードルを下げる

## 結果

- `moon build --target js` で `_build/js/debug/build/cli/bridge/bridge.js` を生成
- `loadCore()` が MoonBit JS を優先 import、失敗時は TS fallback
- MoonBit 10 テスト + TypeScript 155 テスト = 165 テストで品質担保
- bitflow のネイティブ統合により、Starlark ワークフロー解析がインプロセスで完結
