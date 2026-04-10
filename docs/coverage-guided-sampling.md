# Coverage-Guided Test Sampling

Coverage-guided fuzzing の知見をテスト選択に応用した戦略。変更されたコードをカバーするテストを効率的に選択し、冗長なテスト選択を排除する。

## 仕組み

1. changed files から影響範囲を特定
2. カバレッジデータから影響範囲をカバーするテストを列挙
3. Greedy set cover でカバレッジの新規性が最大のテストを順に選択
4. カバレッジデータがなければ co-failure で近似
5. 残り枠は weighted random で埋める

## 使い方

### 1. カバレッジデータの収集

テスト実行時にカバレッジデータを生成し、`flaker collect coverage` で取り込む。

**Istanbul (nyc / Vitest / Jest):**

```bash
# Vitest で coverage 生成
npx vitest run --coverage

# flaker に取り込む
flaker collect coverage --format istanbul --input coverage/coverage-final.json
```

**V8 coverage (Node.js):**

```bash
# Node.js で V8 coverage 生成
node --experimental-test-coverage test.mjs

# flaker に取り込む
flaker collect coverage --format v8 --input coverage/
```

**Playwright:**

```bash
# Playwright で coverage 生成
npx playwright test --coverage

# flaker に取り込む
flaker collect coverage --format playwright --input test-results/coverage/
```

### 2. サンプリング実行

```bash
# coverage-guided 戦略でサンプリング
flaker run --dry-run --strategy coverage-guided --changed src/auth.ts src/api.ts --percentage 20

# hybrid 戦略でも coverage データがあれば自動利用
flaker run --strategy hybrid --changed src/auth.ts
```

### 3. flaker.toml 設定

```toml
[coverage]
format = "istanbul"       # istanbul | v8 | playwright
input = "coverage-final.json"
granularity = "statement"  # statement (default) | function | branch
```

## 対応フォーマット

| フォーマット | 入力形式 | 説明 |
|-------------|----------|------|
| `istanbul` | `coverage-final.json` | Istanbul/nyc の statement coverage |
| `v8` | V8 coverage JSON | Node.js 内蔵の V8 coverage |
| `playwright` | Playwright coverage JSON | Playwright の V8 coverage 出力 |

## カバレッジ Adapter の拡張

カスタム coverage フォーマットに対応するには、`CoverageAdapter` インターフェースを実装する。

```typescript
import type { CoverageAdapter, CoverageEdge } from "./adapters/coverage-types.js";

export const myCoverageAdapter: CoverageAdapter = {
  name: "my-format",
  parse(input: string): CoverageEdge[] {
    // input をパースして CoverageEdge[] を返す
    return [
      {
        suite: "tests/auth.test.ts",
        testName: "login",
        edges: ["src/auth.ts:10", "src/auth.ts:42"],
      },
    ];
  },
};
```

`CoverageEdge` の `edges` は `ファイルパス:行番号` または `ファイルパス:関数名` の形式で指定する。

## 設計詳細

[ML ベーステスト選択 設計ドキュメント](ml-test-selection-design.md) を参照。
