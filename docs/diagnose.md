# Diagnose Flaky Tests

フレーキーなテストの原因をミューテーションベースで特定する。

## 仕組み

`flaker debug diagnose` はテストに対して複数のミューテーションを適用し、baseline（通常実行）との失敗率を比較する。

| ミューテーション | 検出対象 |
|----------------|----------|
| `order-shuffle` | 順序依存: 他のテストの実行順序に依存 |
| `repeat` | 非決定性: タイミングやランダム性による不安定さ |
| `env-mutate` | 環境依存: TZ, LANG, NODE_OPTIONS 等の環境変数 |
| `isolate` | テスト間依存: 他のテストとの暗黙の共有状態 |

## 使い方

### 基本

```bash
# 全ミューテーションを適用（デフォルト 3 回実行）
flaker debug diagnose --suite "tests/auth.test.ts" --test "login flow"

# 実行回数を指定
flaker debug diagnose --suite "tests/auth.test.ts" --test "login flow" --runs 5

# 特定のミューテーションのみ
flaker debug diagnose --suite "tests/auth.test.ts" --test "login flow" --mutations order,env
```

### 出力例

```
# Diagnose Report

  Target: tests/auth.test.ts > login flow

## Baseline
  Runs: 3  Failures: 0  Rate: 0%

## Mutations
  order-shuffle: 3 runs, 0 failures (0%)
  repeat: 6 runs, 0 failures (0%)
  env-mutate: 3 runs, 1 failures (33.33%)
  isolate: 3 runs, 0 failures (0%)

## Diagnosis
  order-shuffle: baseline と同程度 (0% vs 0%)
  repeat: baseline と同程度 (0% vs 0%)
  🌍 環境依存の疑い: env-mutate で失敗率が上昇 (0% → 33.33%)
  isolate: baseline と同程度 (0% vs 0%)
```

### JSON 出力

```bash
flaker debug diagnose --suite "auth.test.ts" --test "login" --json
```

## 解釈ガイド

| 診断 | 原因 | 対処 |
|------|------|------|
| 🔀 順序依存 | テスト間でグローバル状態を共有 | beforeEach/afterEach で状態リセット |
| 🌍 環境依存 | TZ, LANG 等に依存 | 環境固定 or テスト内で明示設定 |
| 🎲 非決定性 | タイミング、ランダム、外部 API | 固定シード、モック、待機条件の明示 |
| ✅ isolate で改善 | 他のテストが副作用を残す | テスト分離、独立プロセス実行 |

## ミューテーション一覧

### order-shuffle

全テストリストをシャッフルして実行。順序依存のフレーキーを検出する。
失敗率が上昇する場合、テスト間で共有された状態（グローバル変数、DB、ファイル）が原因。

### repeat

同じテストを N×2 回繰り返し実行。非決定性を検出する。
baseline より高い失敗率の場合、タイミングやランダム性に依存。

### env-mutate

環境変数をランダムに変更して実行。
- `TZ`: タイムゾーン
- `LANG`: ロケール
- `NODE_OPTIONS`: Node.js オプション
- `CI`: CI 環境フラグ

### isolate

対象テストのみを単独実行。
baseline で失敗していたが isolate で通る場合、他のテストの副作用が原因。
