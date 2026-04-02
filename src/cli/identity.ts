export interface TestIdentityFields {
  suite: string;
  testName: string;
  taskId?: string | null;
  filter?: string | null;
  variant?: Record<string, string> | null;
  testId?: string;
}

export interface ResolvedTestIdentity extends TestIdentityFields {
  taskId: string;
  filter: string | null;
  variant: Record<string, string> | null;
  testId: string;
}

export function normalizeVariant(
  variant?: Record<string, string> | null,
): Record<string, string> | null {
  if (!variant) return null;

  const entries = Object.entries(variant)
    .filter(([, value]) => value != null)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

export function createStableTestId(input: TestIdentityFields): string {
  const taskId = input.taskId ?? input.suite;
  const filter = input.filter ?? null;
  const variant = normalizeVariant(input.variant);

  return JSON.stringify({
    taskId,
    suite: input.suite,
    testName: input.testName,
    filter,
    variant,
  });
}

export function resolveTestIdentity<T extends TestIdentityFields>(
  input: T,
): T & ResolvedTestIdentity {
  const taskId = input.taskId ?? input.suite;
  const filter = input.filter ?? null;
  const variant = normalizeVariant(input.variant);
  const testId =
    input.testId ??
    createStableTestId({
      ...input,
      taskId,
      filter,
      variant,
    });

  return {
    ...input,
    taskId,
    filter,
    variant,
    testId,
  };
}
