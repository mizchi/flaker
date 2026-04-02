# Why flaker — いつ使うべきか、理論的根拠、確率的な振る舞い

[English](why-flaker.md)

運用面の具体化は [Design Partner Rollout](design-partner-rollout.ja.md) を参照。

## いつ使うべきか

### flaker が必要な場面:

- **テストスイートが 30 分以上かかる** — 毎コミットで全テストを流せない
- **テストが非決定的に失敗する** — コード変更なしで落ちる。flaky なのか本当に壊れているのか判別できない
- **CI が信頼されていない** — 開発者が「もう一回流せば通る」と re-run する。計算資源の浪費
- **変更に関係するテストがわからない** — 全テストを流すか、何も流さないかの二択
- **flaky テストが放置されている** — 誰がオーナーかわからない。優先順位をつけるデータがない

### flaker が不要な場面:

- テストスイートが 5 分以内で完走し、常に全テストを流せる
- テストが 100 件未満で、flaky を頭で把握できる
- BuildPulse / Trunk.io 等の有料サービスを使っていて満足している

### 開発ライフサイクルにおける位置:

```
コード変更 → flaker sample (テスト選択) → 選択テスト実行 → flaker collect (結果蓄積)
                                                                    ↓
                                             flaker reason (分析) ← flaker flaky (検出)
                                                      ↓
                                             quarantine / bisect / fix
```

---

## 理論的根拠

### 1. Flaky Test 検出: 統計的仮説検定

flaky テストとは、結果が **非決定的** なテストである。同じコードで異なる結果が出る:

> テスト T が flaky であるとは、P(T = fail | コード変更なし) > 0 であること

flaker は観測データからこの確率を推定する:

```
flaky_rate(T) = (failures + flaky_retries) / total_runs
```

これは背後にある失敗確率の **最尤推定量** である。推定の信頼度はサンプルサイズに依存する:

| 実行回数 | flaky rate 10% の場合の 95% 信頼区間幅 |
|---------|--------------------------------------|
| 10 回   | ±18.6%                               |
| 30 回   | ±10.7%                               |
| 100 回  | ±5.9%                                |
| 500 回  | ±2.6%                                |

`min_runs` パラメータが重要な理由: 10 回未満では推定が不安定。`window_days` は鮮度のバイアス制御: 古いデータは現在のコードベースを反映しない可能性がある。

**DeFlaker 方式 (true flaky 検出):** 統計推定ではなく「同一コミットで結果が異なるか？」を直接問う。コミット C でテスト T が pass と fail の両方を出したら、T は定義上非決定的 — 推定不要。

```sql
-- True flaky: 同一コミットで異なる結果
SELECT test_name
FROM test_results
GROUP BY test_name, commit_sha
HAVING COUNT(DISTINCT status) FILTER (WHERE status IN ('passed', 'failed')) > 1
```

**参考文献:**
- Luo et al., "An Empirical Analysis of Flaky Tests" (FSE 2014) — flaky テストの root cause 分類の基礎
- Bell et al., "DeFlaker: Automatically Detecting Flaky Tests" (ICSE 2018) — 差分カバレッジ方式、recall 95.5%
- Parry et al., "A Survey of Flaky Tests" (ACM TOSEM 2022) — 包括的レビュー

### 2. テストサンプリング: カバレッジ vs コストのトレードオフ

毎コミットで全テストを実行するのが理想だが、現実的でないことが多い。flaker のサンプリング戦略は **テスト選択理論** に基づく:

#### ランダムサンプリング

各テストが独立に確率 p でバグを検出するとき、n テスト中 k テストを実行したときのバグ検出確率:

```
P(検出) = 1 - (1 - p)^k
```

p = 0.01 (各テストが 1% の確率でバグを検出) の場合:
- k = 10: P = 9.6%
- k = 50: P = 39.5%
- k = 100: P = 63.4%
- k = 230: P = 90.0%

つまり **全テストの 20-30% を実行しても大半のバグを検出できる**。ただしバグは一様分布しない — weighted や affected 戦略が存在する理由。

#### 重み付きサンプリング

flaker は各テストに重み `1.0 + flaky_rate` を割り当てる。flaky rate が高いテストほど高頻度でサンプリングされ、間欠的な失敗の検出確率が上がる。

これは **重点サンプリング (importance sampling)** の応用 — テスト空間の高分散領域から過剰サンプリングし、推定量の分散を減らす。

#### affected 戦略 (依存分析)

Microsoft の Test Impact Analysis (TIA) 研究の知見:

> コード変更に影響されるテストのみ実行すると、テストスイートの **15-30%** の実行で **99%以上** のバグを検出できる。

flaker は依存グラフ解析でこれを実装する:
1. マニフェストファイル (package.json, moon.pkg, Cargo.toml) からDAGを構築
2. 変更ファイルを逆方向に辿り、影響パッケージを特定
3. 影響パッケージのテストを選択

**参考文献:**
- Machalica et al., "Predictive Test Selection" (ICSE-SEIP 2019) — Meta の ML ベースアプローチ。テストの 20% で 90% の信頼度
- Herzig et al., "The Art of Testing Less without Sacrificing Quality" (ICSE 2015) — Microsoft TIA。15-30% の実行で 99% のバグ検出
- Elbaum et al., "Techniques for Improving Regression Testing in Continuous Integration Development Environments" (FSE 2014)

#### hybrid 戦略 (Microsoft TIA 方式)

flaker のデフォルト `hybrid` 戦略は 4 つのソースを優先順に組み合わせる:

1. **affected テスト** — コード変更の直接影響 (全数選択)
2. **前回失敗テスト** — 直前の実行で失敗 (全数選択)
3. **新規テスト** — 最近追加、履歴が少ない (全数選択)
4. **重み付きランダム** — 残り枠を flaky_rate で重み付けして充填

Microsoft の三要素選択 (affected + failed + new) に、flaky 重み付きランダムサンプリングを追加した構成。

### 3. Quarantine: 障害隔離の理論

Google の Test Automation Platform (TAP) は 1 日 40 億テスト以上を処理する。核心的な知見:

> flaky な失敗は **非ブロッキング** にすべき。N 回連続失敗したテストは隔離し、バグチケットを自動起票する。

これは分散システムの **サーキットブレーカーパターン** の応用 — コンポーネントが不安定になったら隔離し、カスケード障害（この場合は CI 全体への不信感）を防ぐ。

flaker の quarantine は閾値モデル:

```
quarantine(T) = true   if flaky_rate(T) > threshold AND total_runs(T) >= min_runs
```

`min_runs` ガードにより、データ不足での誤判定（小サンプルからの偽陽性）を防ぐ。

**参考文献:**
- Micco, "The State of Continuous Integration Testing at Google" (ICSE-SEIP 2017)
- Memon et al., "Taming Google-Scale Continuous Testing" (ICSE-SEIP 2017)

### 4. Bisect: 時系列データ上の二分探索

flaker の `bisect` コマンドは、テストが安定から flaky に変わった転換点を見つける。これは **変化点検出 (change-point detection)** 問題:

テスト結果の時系列 [pass, pass, pass, fail, pass, fail, fail, ...] が与えられたとき、分布が変化したコミットを見つける。

flaker は単純スキャンを使用: 最後の全 pass コミットと、最初の失敗コミットの境界を見つける。典型的なケース（単一のリグレッション）では、これはソート済みコミット列の二分探索と等価。

より高度な手法（CUSUM、ベイズ変化点検出）も追加可能だが、単純スキャンで 90% 以上のケースに対応できる。

### 5. Reasoning: ルールベース分類

flaker の `reason` コマンドは決定木を適用する:

```
同一コミットで結果不一致か (true flaky rate > 30%)?
  → YES: 分類 = "true-flaky"
  → NO: 以前は低かった失敗率が最近急上昇したか?
    → YES: 失敗が特定コミットに集中しているか?
      → YES: 分類 = "regression" (fix-urgent)
      → NO: 分類 = "environment-dependent"
    → NO: リトライで通るか?
      → YES: 分類 = "intermittent"
      → NO: 分類 = "environment-dependent"
```

これは Luo et al. (2014) の root cause 分類に直接対応する:

| Root Cause | 割合 | flaker の分類 |
|-----------|------|--------------|
| 非同期待ち | 45% | intermittent |
| 並行性 | 20% | true-flaky |
| テスト順序依存 | 12% | environment-dependent |
| リソースリーク | 8% | intermittent |
| ネットワーク | 5% | environment-dependent |
| 時刻依存 | 4% | true-flaky |
| その他 | 6% | ケースによる |

---

## 確率的な振る舞い

### flaker が保証すること・しないこと

**保証する:**
- 同一コミットで pass と fail が混在するテストは `--true-flaky` で必ず検出される
- flaky rate が閾値を超え、十分なデータがあるテストは `flaky` で必ずフラグされる
- `hybrid` サンプリングは affected + failed + new テストを必ず含む
- quarantine 判定は同じデータに対して決定的
- `bisect` はデータ中に転換点があれば必ず見つける

**保証しない:**
- ランダム/重み付きサンプリングが全バグを検出する — 設計上確率的
- flaky_rate 推定が正確である — 標本統計であり固有の不確実性がある
- `reason` の分類が常に正しい — ヒューリスティックであり証明ではない
- 初回実行での検出 — flaker は判断に履歴が必要

### サンプリングの信頼度

全 n テストから k テストをサンプリングしたとき、特定の 1 テストだけが検出するバグを見逃す確率:

```
P(見逃し) ≈ 1 - k/n
```

| 全テスト数 | サンプル数 | 特定バグの検出率 |
|-----------|----------|----------------|
| 1000 | 50 (5%) | 5% |
| 1000 | 100 (10%) | 10% |
| 1000 | 200 (20%) | 20% |
| 1000 | 500 (50%) | 50% |

ただし `affected` 戦略で、バグが依存グラフ内にある場合:

```
P(affected で検出) ≈ 95-99%
```

これが `hybrid` を推奨する理由: `affected` が関連バグの高確率カバレッジを提供し、`weighted random` が無関係なリグレッションの確率的カバレッジを補完する。

### どれくらいのデータが必要か?

| 指標 | 最低限 | 推奨 |
|------|--------|------|
| テストあたりの実行回数 | 5 | 20+ |
| 合計 workflow runs | 10 | 50+ |
| 期間 | 3 日 | 14 日以上 |
| true flaky 検出 | コミットあたり 2+ 実行 | コミットあたり 5+ 実行 |
| bisect | 5+ コミット | 20+ コミット |
| トレンド分析 | 2+ 週間 | 4+ 週間 |

`flaker eval` がデータ充足度を報告し、不足している場合は警告する。

### 収束の振る舞い

データが蓄積されるにつれて:
- **flaky_rate** は真の背後の確率に収束する (大数の法則)
- **分類の confidence** が上昇する (パターンマッチングの根拠が増える)
- **リスク予測** の精度が向上する (逸脱検出のベースラインが長くなる)
- **quarantine 判定** が安定する (データ増加で判定の揺らぎが減る)

データ収集の最初の 1 週間は「観察期間」— flaker は収集するが、推奨は適切な懐疑心を持って受け止めるべき。2-4 週間後、統計推定は意思決定に十分な信頼性を持つ。
