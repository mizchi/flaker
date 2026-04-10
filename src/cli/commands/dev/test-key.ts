import type { TestId } from "../../runners/types.js";
import { createStableTestId } from "../../identity.js";

/** Key from runner's TestId (camelCase fields) */
export function createListedTestKey(test: TestId): string {
  return (
    test.testId ??
    createStableTestId({
      suite: test.suite,
      testName: test.testName,
      taskId: test.taskId,
      filter: test.filter,
      variant: test.variant,
    })
  );
}

/** Key from MoonBit-style meta (snake_case fields) */
export function createMetaKey(test: {
  suite: string;
  test_name: string;
  task_id?: string | null;
  filter?: string | null;
  test_id?: string | null;
}): string {
  return (
    test.test_id ??
    createStableTestId({
      suite: test.suite,
      testName: test.test_name,
      taskId: test.task_id,
      filter: test.filter,
    })
  );
}

/** Build an index of listed tests keyed by stable identity */
export function buildListedTestIndex(listedTests: TestId[]): Map<string, TestId[]> {
  const index = new Map<string, TestId[]>();
  for (const test of listedTests) {
    const key = createListedTestKey(test);
    const existing = index.get(key);
    if (existing) {
      existing.push(test);
    } else {
      index.set(key, [test]);
    }
  }
  return index;
}
