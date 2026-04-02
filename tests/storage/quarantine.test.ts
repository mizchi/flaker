import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DuckDBStore } from "../../src/cli/storage/duckdb.js";
import { createStableTestId } from "../../src/cli/identity.js";

describe("Quarantine Storage", () => {
  let store: DuckDBStore;

  beforeEach(async () => {
    store = new DuckDBStore(":memory:");
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it("adds a test to quarantine", async () => {
    await store.addQuarantine({ suite: "suite-a", testName: "test-1" }, "flaky");
    const all = await store.queryQuarantined();
    expect(all).toHaveLength(1);
    expect(all[0].suite).toBe("suite-a");
    expect(all[0].testName).toBe("test-1");
    expect(all[0].reason).toBe("flaky");
    expect(all[0].createdAt).toBeInstanceOf(Date);
  });

  it("removes a test from quarantine", async () => {
    await store.addQuarantine({ suite: "suite-a", testName: "test-1" }, "flaky");
    await store.removeQuarantine({ suite: "suite-a", testName: "test-1" });
    const all = await store.queryQuarantined();
    expect(all).toHaveLength(0);
  });

  it("checks if a test is quarantined", async () => {
    await store.addQuarantine({ suite: "suite-a", testName: "test-1" }, "flaky");
    expect(await store.isQuarantined({ suite: "suite-a", testName: "test-1" })).toBe(true);
    expect(await store.isQuarantined({ suite: "suite-a", testName: "test-2" })).toBe(false);
  });

  it("does not duplicate entries (ON CONFLICT updates reason)", async () => {
    await store.addQuarantine({ suite: "suite-a", testName: "test-1" }, "flaky");
    await store.addQuarantine({ suite: "suite-a", testName: "test-1" }, "manual");
    const all = await store.queryQuarantined();
    expect(all).toHaveLength(1);
    expect(all[0].reason).toBe("manual");
  });

  it("treats filtered variants as distinct quarantine identities", async () => {
    await store.addQuarantine(
      { suite: "suite-a", testName: "test-1", filter: "@smoke" },
      "manual",
    );
    await store.addQuarantine(
      { suite: "suite-a", testName: "test-1", filter: "@regression" },
      "manual",
    );

    const all = await store.queryQuarantined();
    expect(all).toHaveLength(2);
    expect(new Set(all.map((entry) => entry.testId)).size).toBe(2);
    expect(
      all.map((entry) => entry.testId).sort(),
    ).toEqual(
      [
        createStableTestId({
          suite: "suite-a",
          testName: "test-1",
          filter: "@regression",
        }),
        createStableTestId({
          suite: "suite-a",
          testName: "test-1",
          filter: "@smoke",
        }),
      ].sort(),
    );
    expect(
      await store.isQuarantined({
        suite: "suite-a",
        testName: "test-1",
        filter: "@smoke",
      }),
    ).toBe(true);
    expect(
      await store.isQuarantined({
        suite: "suite-a",
        testName: "test-1",
        filter: "@other",
      }),
    ).toBe(false);
  });
});
