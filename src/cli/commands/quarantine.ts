import type { MetricStore, QuarantinedTest } from "../storage/types.js";

export type QuarantineOpts =
  | {
      store: MetricStore;
      action: "add";
      suite: string;
      testName: string;
      reason?: string;
    }
  | {
      store: MetricStore;
      action: "remove";
      suite: string;
      testName: string;
    }
  | {
      store: MetricStore;
      action: "list";
    }
  | {
      store: MetricStore;
      action: "auto";
      flakyRateThreshold?: number;
      minRuns?: number;
      windowDays?: number;
    };

export async function runQuarantine(
  opts: QuarantineOpts,
): Promise<QuarantinedTest[] | undefined> {
      const { store } = opts;

  switch (opts.action) {
    case "add": {
      await store.addQuarantine(
        {
          suite: opts.suite,
          testName: opts.testName,
        },
        opts.reason ?? "manual",
      );
      return undefined;
    }
    case "remove": {
      await store.removeQuarantine({
        suite: opts.suite,
        testName: opts.testName,
      });
      return undefined;
    }
    case "list": {
      return store.queryQuarantined();
    }
    case "auto": {
      const threshold = opts.flakyRateThreshold ?? 30;
      const minRuns = opts.minRuns ?? 5;
      const windowDays = opts.windowDays ?? 30;
      const flaky = await store.queryFlakyTests({ windowDays });
      const reason = `auto:flaky_rate>=${threshold}%`;
      for (const f of flaky) {
        if (f.flakyRate >= threshold && f.totalRuns >= minRuns) {
          await store.addQuarantine(
            {
              suite: f.suite,
              testName: f.testName,
              taskId: f.taskId,
              filter: f.filter,
              variant: f.variant,
              testId: f.testId,
            },
            reason,
          );
        }
      }
      return undefined;
    }
  }
}

export function formatQuarantineTable(tests: QuarantinedTest[]): string {
  if (tests.length === 0) {
    return "No quarantined tests.";
  }

  const headers = ["Suite", "Test Name", "Reason", "Created At"];
  const rows = tests.map((t) => [
    t.suite,
    t.testName,
    t.reason,
    t.createdAt.toISOString(),
  ]);

  const allRows = [headers, ...rows];
  const colWidths = headers.map((_, i) =>
    Math.max(...allRows.map((row) => (row[i] ?? "").length)),
  );

  const sep = colWidths.map((w) => "-".repeat(w)).join(" | ");
  const formatRow = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(colWidths[i])).join(" | ");

  const lines = [formatRow(headers), sep, ...rows.map(formatRow)];
  return lines.join("\n");
}
