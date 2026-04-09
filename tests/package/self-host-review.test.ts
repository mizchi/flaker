import { describe, expect, it } from "vitest";

import {
  buildPromotionReadiness,
  renderSelfHostReview,
} from "../../scripts/self-host-review.mjs";

describe("self-host review", () => {
  it("marks readiness as not-ready when matched history is too small", () => {
    const readiness = buildPromotionReadiness({
      sampling: {
        matchedCommits: 4,
        falseNegativeRate: 2.5,
        passCorrelation: 98,
        holdoutFNR: 4,
      },
      data: {
        confidence: "low",
      },
    });

    expect(readiness.status).toBe("not-ready");
    expect(readiness.summary).toContain("matched commits");
  });

  it("marks readiness as ready when sampling signals clear the thresholds", () => {
    const readiness = buildPromotionReadiness({
      sampling: {
        matchedCommits: 28,
        falseNegativeRate: 2.1,
        passCorrelation: 97.4,
        holdoutFNR: 5.2,
      },
      data: {
        confidence: "high",
      },
    });

    expect(readiness.status).toBe("ready");
    expect(readiness.summary).toContain("required-check trial");
  });

  it("renders a compact review body with readiness and signals", () => {
    const rendered = renderSelfHostReview({
      mode: "pr",
      refName: "feature/self-host",
      sha: "abcdef1234567890",
      runOutcome: "failure",
      workflowUrl: "https://github.com/mizchi/flaker/actions/runs/1",
      collectSummary: "Collected 12 runs, 480 test results",
      runSummary: "# Sampling Summary\n\n  Strategy: hybrid",
      evalReport: {
        healthScore: 76,
        detection: {
          flakyTests: 3,
          quarantinedTests: 1,
        },
      },
      kpi: {
        sampling: {
          matchedCommits: 12,
          falseNegativeRate: 4.2,
          passCorrelation: 95.5,
          holdoutFNR: 6.1,
          sampleRatio: 28.4,
          skippedMinutes: 14.2,
        },
        data: {
          confidence: "moderate",
          lastDataAt: "2026-04-09T10:00:00.000Z",
        },
      },
    });

    expect(rendered.title).toContain("PR advisory");
    expect(rendered.body).toContain("Promotion readiness");
    expect(rendered.body).toContain("watch");
    expect(rendered.body).toContain("health score");
    expect(rendered.body).toContain("Collected 12 runs");
  });
});
