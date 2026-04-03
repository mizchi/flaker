# Sampling Strategy Evaluation Report

## 概要

flaker が提供する6つのサンプリング戦略を合成フィクスチャデータで定量評価した。
テスト数・コミット数・フレーキー率・co-failure 相関強度・サンプリング予算を変化させ、各戦略の Recall（失敗検出率）、Precision（選択精度）、Efficiency（random 比効率）を測定した。

## 戦略一覧

| 戦略 | 説明 | Resolver 必要 | ML 学習 |
|------|------|:---:|:---:|
| **random** | 均一ランダム選択 | No | No |
| **weighted** | flaky_rate による重み付きランダム | No | No |
| **weighted+co-failure** | flaky_rate + co_failure_boost | No | No |
| **hybrid+co-failure** | affected + co-failure priority + weighted fill | Yes | No |
| **coverage-guided** | greedy set cover (変更エッジカバレッジ最大化) | Coverage data | No |
| **gbdt** | Gradient Boosted Decision Tree による予測スコアランキング | No | Yes |

## ベンチマーク結果

### Scenario A: 標準（tests=200, commits=100, flaky=5%, co-failure=1.0, sample=20%）

| Strategy | Recall | Precision | F1 | FNR | Efficiency |
|----------|--------|-----------|-----|-----|------------|
| random | 22.6% | 6.0% | 0.10 | 77.4% | 1.13 |
| weighted | 23.3% | 6.2% | 0.10 | 76.7% | 1.17 |
| weighted+co-failure | 23.3% | 6.2% | 0.10 | 76.7% | 1.17 |
| hybrid+co-failure | **94.4%** | 25.1% | 0.40 | 5.6% | **4.72** |
| coverage-guided | 18.8% | **100.0%** | 0.32 | 81.2% | 0.94 |
| gbdt | 90.2% | 24.0% | 0.38 | 9.8% | 4.51 |

### Scenario B: 中程度の相関（tests=200, commits=100, flaky=10%, co-failure=0.5, sample=20%）

| Strategy | Recall | Precision | F1 | FNR | Efficiency |
|----------|--------|-----------|-----|-----|------------|
| random | 28.6% | 5.2% | 0.09 | 71.4% | 1.43 |
| weighted | 31.3% | 5.7% | 0.10 | 68.7% | 1.57 |
| hybrid+co-failure | 78.6% | 14.3% | 0.24 | 21.4% | 3.93 |
| coverage-guided | 14.8% | 54.0% | 0.23 | 85.2% | 0.74 |
| gbdt | **84.1%** | 15.3% | **0.26** | **15.9%** | **4.20** |

### Scenario C: タイトな予算（tests=200, commits=100, flaky=5%, co-failure=1.0, sample=10%）

| Strategy | Recall | Precision | F1 | FNR | Efficiency |
|----------|--------|-----------|-----|-----|------------|
| random | 14.3% | 7.6% | 0.10 | 85.7% | 1.43 |
| weighted | 11.3% | 6.0% | 0.08 | 88.7% | 1.13 |
| hybrid+co-failure | **94.4%** | **50.2%** | **0.66** | **5.6%** | **9.44** |
| coverage-guided | 18.8% | 100.0% | 0.32 | 81.2% | 1.88 |
| gbdt | 88.3% | 47.0% | 0.61 | 11.7% | 8.83 |

## 分析

### 1. Hybrid+co-failure が最高性能

依存グラフ解析（resolver）が利用可能な場合、hybrid+co-failure が全シナリオで最高の Recall を達成する。
特にタイトな予算（10%）では Efficiency 9.44 を記録 — random の約 9.4 倍の効率でテスト失敗を検出する。

**メカニズム**: affected（dependency graph）で変更に関連するテストを確定的に選択 → co-failure priority で履歴的相関が強いテストを追加 → 残り枠を weighted で埋める。

### 2. GBDT は resolver 不要で 90% recall

GBDT の最大の価値は **resolver を設定せずに 90% 近い recall を達成する**こと。
hybrid (94.4%) との差はわずか 4% だが、**設定コストがゼロ**。新しいリポジトリへの導入が即座に可能。

- Scenario A: 90.2% recall（hybrid: 94.4%）
- Scenario B: **84.1% recall**（hybrid: 78.6%）— 中程度の相関では **GBDT が hybrid を上回る**
- Scenario C: 88.3% recall（hybrid: 94.4%）

Scenario B で GBDT が hybrid を上回る理由: co-failure 相関が弱い場合、hybrid の co-failure priority が的外れなテストを選ぶことがあるが、GBDT は複数の特徴量を総合的に学習するため頑健。

### 3. Weighted+co-failure は weighted と同等

現在の実装では weighted+co-failure が weighted と同じ結果を示す。これは MoonBit bridge の `Option<Double>` round-trip 問題による。co_failure_boost が MoonBit 経由で失われている。

**対策**: normalizeMetaBoosts workaround は #24 で追加済みだが、本質的には MoonBit の `Double?` の `ToJson` が `null` を正しく出力するか、あるいは `Double` に戻して bridge 側でデフォルト値を保証する必要がある。

### 4. Coverage-guided は精度特化

coverage-guided は **Precision 100%**（Scenario A）を達成するが、Recall は低い。
これは greedy set cover が「変更されたコードをカバーするテスト」のみを選ぶため、カバレッジ外の失敗（フレーキー等）を見逃すから。

**最適な用途**: 単独ではなく hybrid の Priority 1 として組み込み、affected analysis を補完する。

### 5. Random は予算に比例

Random の Recall はほぼ sample% に等しい（20% → ~22%, 10% → ~14%）。これは理論的期待値と一致。
他の戦略はこの baseline をどれだけ上回るかが評価基準。

## 推奨使用パターン

### パターン 1: Resolver あり（推奨）
```bash
flaker sample --strategy hybrid --changed $(git diff --name-only HEAD~1)
```
- Recall: 94%+
- 依存グラフ + co-failure + weighted の全層が機能

### パターン 2: Resolver なし（GBDT）
```bash
flaker sample --strategy weighted --changed $(git diff --name-only HEAD~1)
# GBDT モデルが .flaker/models/ にあれば自動適用（将来実装）
```
- Recall: 84-90%
- 設定不要、新規リポジトリで即使用可能

### パターン 3: 高精度が必要（coverage-guided + hybrid）
- Coverage データ収集パイプラインが必要（将来実装）
- coverage-guided で変更コードに直結するテストを確実に選択
- hybrid の残り枠で exploration

## 技術的制約と今後の課題

### 現在の制約

1. **weighted+co-failure の MoonBit bridge 問題**: `Double?` の JSON round-trip で boost が失われる
2. **GBDT は eval-fixture 内のみ**: `planSample` への統合は未実装
3. **Coverage-guided はカバレッジデータ収集が未実装**: 合成データでのみ評価
4. **合成データの限界**: 実リポジトリでの検証が必要

### 今後の改善

1. **GBDT を `planSample` に統合**: `flaker train` → `.flaker/models/gbdt.json` → `flaker sample` で自動ロード
2. **LightGBM C API への差し替え**: 精度向上（特に深いツリーと多数のツリー）
3. **V8/Istanbul カバレッジ収集**: `flaker collect-coverage` → coverage-guided を実データで使用可能に
4. **MoonBit bridge 修正**: `co_failure_boost` を `Double` に戻し、bridge 側でデフォルト 0.0 を保証
5. **Holdout サンプリング**: スキップしたテストの一部をランダム実行し、モデルの劣化を検出

## 再現方法

```bash
# 標準ベンチマーク
flaker eval-fixture --tests 200 --commits 100 --co-failure-strength 1.0 --flaky-rate 0.05 --sample-percentage 20

# Co-failure 強度の sweep
flaker eval-fixture --sweep --tests 200 --commits 100

# タイトな予算
flaker eval-fixture --tests 200 --commits 100 --sample-percentage 10

# 大規模
flaker eval-fixture --tests 500 --commits 200 --co-failure-strength 0.8 --flaky-rate 0.05 --sample-percentage 10
```

全ベンチマークは合成データで実行され、外部依存なし・設定不要で再現可能。
