export const LOCAL_WORKFLOW_EVENTS = [
  "local-import",
  "actrun-local",
  "flaker-local-run",
] as const;

const LOCAL_WORKFLOW_EVENT_SET = new Set<string>(LOCAL_WORKFLOW_EVENTS);

export type WorkflowRunSource = "ci" | "local";

export function parseWorkflowRunSource(raw?: string): WorkflowRunSource | undefined {
  if (raw == null) {
    return undefined;
  }
  if (raw === "ci" || raw === "local") {
    return raw;
  }
  throw new Error(`Unknown workflow run source: ${raw}. Expected one of: ci, local`);
}

export function resolveWorkflowRunSource(
  source?: string | null,
  event?: string | null,
): WorkflowRunSource {
  if (source === "local") {
    return "local";
  }
  if (event && LOCAL_WORKFLOW_EVENT_SET.has(event)) {
    return "local";
  }
  return "ci";
}

export function workflowRunSourceSql(runAlias: string): string {
  const localEvents = LOCAL_WORKFLOW_EVENTS.map((event) => `'${event}'`).join(", ");
  return `CASE WHEN ${runAlias}.source = 'local' OR ${runAlias}.event IN (${localEvents}) THEN 'local' ELSE 'ci' END`;
}

export function importEventForSource(source: WorkflowRunSource): string {
  return source === "local" ? "local-import" : "ci-import";
}
