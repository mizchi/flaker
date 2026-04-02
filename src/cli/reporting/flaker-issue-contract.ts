export interface FlakerIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  taskId?: string;
  spec?: string;
}
