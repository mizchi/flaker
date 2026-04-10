# Why flaker — When to Use It, Theoretical Foundations, and Probabilistic Behavior

[日本語版](why-flaker.ja.md)

## When to Use flaker

### You need flaker when:

- **Your test suite takes > 30 minutes** and you can't run it all on every commit
- **Tests fail intermittently** without code changes, and you can't tell flaky from broken
- **CI is untrusted** — developers re-run pipelines hoping for green, wasting compute
- **You don't know which tests matter** for a given code change
- **Flaky tests pile up** because nobody owns them and there's no data to prioritize

### You don't need flaker when:

- Your test suite runs in < 5 minutes and you always run everything
- You have < 100 tests and can track flakiness mentally
- You already use a paid service (BuildPulse, Trunk.io) and are satisfied with it

### Where flaker fits in the development lifecycle:

```
Code change → flaker run --dry-run (select tests) → Run selected tests → flaker collect (store results)
                                                                                  ↓
                                                   flaker analyze reason ← flaker analyze flaky (detect)
                                                            ↓
                                                   quarantine / bisect / fix
```

---

## Theoretical Foundations

### 1. Flaky Test Detection: Statistical Hypothesis Testing

A flaky test is one whose outcome is **non-deterministic** — the same code produces different results across runs. Formally:

> A test T is flaky if P(T = fail | code unchanged) > 0

flaker estimates this probability from observed data:

```
flaky_rate(T) = (failures + flaky_retries) / total_runs
```

This is a **maximum likelihood estimator** of the underlying failure probability. The confidence of this estimate depends on sample size:

| Runs | 95% CI width for 10% flaky rate |
|------|--------------------------------|
| 10   | ±18.6%                         |
| 30   | ±10.7%                         |
| 100  | ±5.9%                          |
| 500  | ±2.6%                          |

This is why flaker's `min_runs` parameter matters — below ~10 runs, the estimate is unreliable. The `window_days` parameter controls the recency bias: older data may reflect a codebase that no longer exists.

**DeFlaker method (true flaky detection):** Instead of estimating failure probability, DeFlaker asks: "Did this test produce different outcomes for the **same commit**?" If commit C has both pass and fail results for test T, then T is definitively non-deterministic — no statistical estimation needed.

```sql
-- True flaky: same commit, different outcomes
SELECT test_name
FROM test_results
GROUP BY test_name, commit_sha
HAVING COUNT(DISTINCT status) FILTER (WHERE status IN ('passed', 'failed')) > 1
```

**References:**
- Luo et al., "An Empirical Analysis of Flaky Tests" (FSE 2014) — foundational taxonomy of flaky test root causes
- Bell et al., "DeFlaker: Automatically Detecting Flaky Tests" (ICSE 2018) — differential coverage approach, 95.5% recall
- Parry et al., "A Survey of Flaky Tests" (ACM TOSEM 2022) — comprehensive multivocal review

### 2. Test Sampling: Coverage vs. Cost Tradeoff

Running all tests on every commit is ideal but often impractical. flaker's sampling strategies are grounded in **test selection theory**:

#### Random Sampling

If each test independently catches a unique bug with probability p, then running k out of n tests catches a bug with probability:

```
P(detect) = 1 - (1 - p)^k
```

For p = 0.01 (1% chance any single test catches the bug):
- k = 10: P(detect) = 9.6%
- k = 50: P(detect) = 39.5%
- k = 100: P(detect) = 63.4%
- k = 230: P(detect) = 90.0%

This means **running 20-30% of tests still catches most bugs**, assuming uniform distribution. But bugs aren't uniformly distributed — which is why weighted and affected strategies exist.

#### Weighted Sampling

flaker assigns weight `1.0 + flaky_rate` to each test. Tests with higher flaky rates are sampled more frequently, increasing the chance of detecting intermittent failures.

This is an application of **importance sampling** — over-sampling from the high-variance region of the test space to reduce estimator variance.

#### Affected Strategy (Dependency Analysis)

Microsoft's Test Impact Analysis (TIA) research showed:

> Running only tests affected by a code change detects **99%+ of bugs** while executing only **15-30%** of the test suite.

flaker implements this via dependency graph analysis:
1. Parse manifest files (package.json, moon.pkg, Cargo.toml) to build dependency DAG
2. Map changed files to affected packages via reverse dependency traversal
3. Select tests from affected packages

**References:**
- Machalica et al., "Predictive Test Selection" (ICSE-SEIP 2019) — Meta's ML-based approach, 20% tests for 90% confidence
- Herzig et al., "The Art of Testing Less without Sacrificing Quality" (ICSE 2015) — Microsoft TIA, 99% bug detection with 15-30% execution
- Elbaum et al., "Techniques for Improving Regression Testing in Continuous Integration Development Environments" (FSE 2014)

#### Hybrid Strategy (Microsoft TIA-inspired)

flaker's default `hybrid` strategy combines four sources, in priority order:

1. **Affected tests** — directly impacted by code changes (all selected)
2. **Previously failed tests** — failed in the last run (all selected)
3. **New tests** — added recently, limited history (all selected)
4. **Weighted random** — fill remaining capacity from the rest

This mirrors Microsoft's three-factor selection (affected + failed + new) with the addition of flaky-weighted random sampling for coverage of the remaining space.

### 3. Quarantine: Fault Isolation Theory

Google's Test Automation Platform (TAP) processes 4 billion+ tests daily. Their key insight:

> Flaky failures should be **non-blocking**. A test with > N consecutive failures is quarantined and a bug is auto-filed.

This is an application of **circuit breaker pattern** from distributed systems — when a component becomes unreliable, isolate it to prevent cascading failures (in this case, developer distrust of the entire CI system).

flaker's quarantine uses a threshold model:

```
quarantine(T) = true   if flaky_rate(T) > threshold AND total_runs(T) >= min_runs
```

The `min_runs` guard prevents quarantining tests with insufficient data (avoiding false positives from small samples).

**References:**
- Micco, "The State of Continuous Integration Testing at Google" (ICSE-SEIP 2017)
- Memon et al., "Taming Google-Scale Continuous Testing" (ICSE-SEIP 2017)

### 4. Bisect: Binary Search on Temporal Data

flaker's `bisect` command finds the transition point where a test went from stable to flaky. This is a **change-point detection** problem:

Given a time series of test outcomes [pass, pass, pass, fail, pass, fail, fail, ...], find the commit where the distribution shifted.

flaker uses a simple scan: find the last all-pass commit followed by the first commit with failures. For the common case (a single regression), this is equivalent to binary search on the sorted commit sequence.

More sophisticated approaches (CUSUM, Bayesian change-point detection) could be added but the simple scan handles 90%+ of cases where a specific commit introduces flakiness.

**Reference:**
- Lawall et al., "Finding Error Handling Bugs in Systems Code Using Code Search" — bisect as a debugging tool

### 5. Reasoning: Rule-Based Classification

flaker's `reason` command applies a decision tree:

```
Is same-commit inconsistent (true flaky rate > 30%)?
  → YES: classification = "true-flaky"
  → NO: Was failure rate low before and high now?
    → YES: Are failures commit-specific?
      → YES: classification = "regression" (fix-urgent)
      → NO: classification = "environment-dependent"
    → NO: Does it pass on retry?
      → YES: classification = "intermittent"
      → NO: classification = "environment-dependent"
```

This maps directly to the root cause taxonomy from Luo et al. (2014):

| Root Cause | % of Cases | flaker Classification |
|-----------|------------|----------------------|
| Async Wait | 45% | intermittent |
| Concurrency | 20% | true-flaky |
| Test Order Dependency | 12% | environment-dependent |
| Resource Leak | 8% | intermittent |
| Network | 5% | environment-dependent |
| Time-dependent | 4% | true-flaky |
| Other | 6% | varies |

### 6. Execution Pipeline: Three-Tier Feedback System

flaker's execution model is not just sampling at different granularities — it is a feedback control system where each tier's output improves the next tier's decisions.

**Scheduled (full execution):** Runs all tests on a regular schedule and accumulates ground truth history. This builds the co-failure matrix (which tests tend to fail together), per-test flaky rates, and stable baseline data. Without scheduled full runs, CI and local tiers have nothing to calibrate against.

**CI (hybrid sampling):** Uses the scheduled tier's accumulated data to make informed sampling decisions. Applies adaptive percentage to weight tests by risk. Randomly selects a holdout group (~10% of skipped tests) to measure false negative rate without running everything. The holdout result feeds back into the next CI run's sampling percentage.

**Local (affected + time budget):** Uses the dependency graph to select tests affected by changed files, bounded by a time budget. Because dependency graphs are imperfect, a divergence signal (how often CI and local disagree on which tests are affected) compensates for gaps in the graph.

```
Scheduled (full)      →  accumulates history  →  feeds CI sampling quality
CI (hybrid)           →  selective execution  →  validates via holdout
Local (affected)      →  fast feedback        →  compensated by divergence signal
```

Each tier feeds the next. Scheduled runs inform CI's sampling weights. CI's holdout FNR drives adaptive percentage. CI's divergence signal compensates for local's dependency graph gaps. The system converges toward the minimum test set needed to maintain quality.

References: Memon et al. (ICSE-SEIP 2017), Machalica et al. (ICSE-SEIP 2019)

### 7. Holdout Verification: Measuring What You Don't Run

When CI samples k tests from n total, the tests that were skipped are invisible. Holdout verification makes them partially visible without running them all.

The mechanism: when selecting which tests to skip, randomly pull ~10% of the skipped pool into a holdout group and run them anyway. These tests were not selected by the sampling algorithm — they are a random control sample of what was about to be skipped.

**Numeric example:**
- 1000 total tests
- 300 sampled (by hybrid algorithm)
- 700 would be skipped
- 70 selected as holdout (10% of skipped)
- 630 truly skipped

The holdout false negative rate:

```
holdout_FNR = holdout_failures / holdout_total
```

This is an unbiased estimator of the true false negative rate across all skipped tests. With 70 holdout tests, a 95% confidence interval can reliably detect FNR > 4%.

The holdout FNR is the primary input to adaptive percentage adjustment. If holdout tests are failing at high rates, the sampling algorithm is missing important tests and the percentage needs to increase.

### 8. Adaptive Sampling: Dual-Signal Feedback Control

CI sampling quality is controlled by two independent signals. Using only one creates blind spots.

**Signal 1 — Holdout FNR:** Measures whether the sampling algorithm is selecting the right tests. A high FNR means tests that were nearly skipped are failing, so the sample is too narrow. This signal is measured directly from each CI run.

**Signal 2 — Divergence rate:** Measures whether the dependency graph is accurate. Computed as `ciOnlyCount / totalTests` — the fraction of tests that CI ran but local did not consider affected. A high divergence rate means the affected resolver is missing real dependencies.

The two signals measure different failure modes:

| Signal | Measures | Root cause when high |
|--------|----------|---------------------|
| Holdout FNR | Wrong tests selected | Sampling weights are stale or miscalibrated |
| Divergence rate | Dependency graph gaps | Import resolution is incomplete or incorrect |

The adaptive controller takes the worse (higher) of the two signals, applying a conservative strategy:

```
effectiveRate = max(FNR, divergenceRate)
if effectiveRate < lowThreshold  → reduce percentage
if effectiveRate > highThreshold → increase percentage
otherwise                        → keep current
```

This is analogous to a proportional controller in control theory: the output (sampling percentage) adjusts proportionally to the error signal (maximum of FNR and divergence).

**Convergence behavior:** With an accurate dependency graph and good historical data, the system converges to 10–15% sampling while maintaining low FNR. With poor dependency data or sparse history, the percentage stays elevated at 30%+ until the signals improve.

---

## Probabilistic Behavior

### What flaker guarantees and what it doesn't

**flaker DOES guarantee:**
- If a test has both pass and fail for the same commit, `--true-flaky` will detect it
- If a test's failure rate exceeds the threshold with sufficient data, `flaky` will flag it
- `hybrid` sampling always includes affected + failed + new tests
- Quarantine decisions are deterministic given the same data
- `bisect` will find the exact transition commit if one exists in the data

**flaker DOES NOT guarantee:**
- Random/weighted sampling will catch every bug — it's probabilistic by design
- flaky_rate estimates are exact — they're sample statistics with inherent uncertainty
- Classification by `reason` is always correct — it's heuristic, not proof
- First-run detection — flaker needs history to make judgments

### Sampling confidence levels

Given n total tests and k sampled tests, the probability of missing a bug that one specific test would catch:

```
P(miss) = (n - 1) / n × (n - 2) / (n - 1) × ... = (n - k) / n  ≈  1 - k/n
```

| Total Tests | Sampled | P(catch specific bug) |
|-------------|---------|----------------------|
| 1000 | 50 (5%) | 5% |
| 1000 | 100 (10%) | 10% |
| 1000 | 200 (20%) | 20% |
| 1000 | 500 (50%) | 50% |

But with `affected` strategy, if the bug is in the dependency graph:

```
P(catch with affected) ≈ 95-99%
```

This is why `hybrid` is the recommended strategy: `affected` provides high-probability coverage for related bugs, and `weighted random` provides probabilistic coverage for unrelated regressions.

### How much data does flaker need?

| Metric | Minimum | Recommended |
|--------|---------|------------|
| Runs per test | 5 | 20+ |
| Total workflow runs | 10 | 50+ |
| Time range | 3 days | 14+ days |
| For true-flaky detection | 2+ runs per commit | 5+ runs per commit |
| For bisect | 5+ commits | 20+ commits |
| For trend analysis | 2+ weeks | 4+ weeks |

`flaker analyze eval` reports data sufficiency and warns when you don't have enough.

### Convergence behavior

As data accumulates:
- **flaky_rate** converges to the true underlying probability (law of large numbers)
- **Classification confidence** increases (more evidence for pattern matching)
- **Risk predictions** become more accurate (longer baseline for deviation detection)
- **Quarantine decisions** stabilize (less flip-flopping with more data)

The first week of data collection is an "observation phase" — flaker collects but recommendations should be taken with appropriate skepticism. After 2-4 weeks, the statistical estimates become reliable for decision-making.
