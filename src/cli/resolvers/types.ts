export interface AffectedTarget {
  spec: string;
  taskId: string;
  filter: string | null;
}

export interface AffectedSelection {
  taskId: string;
  spec: string;
  filter: string | null;
  direct: boolean;
  includedBy: string[];
  matchedPaths: string[];
  matchReasons: string[];
}

export interface AffectedReport {
  resolver: string;
  changedFiles: string[];
  matched: AffectedSelection[];
  selected: AffectedSelection[];
  unmatched: string[];
  summary: {
    matchedCount: number;
    selectedCount: number;
    unmatchedCount: number;
  };
}

export interface DependencyResolver {
  resolve(changedFiles: string[], allTestFiles: string[]): string[] | Promise<string[]>;
  explain?(
    changedFiles: string[],
    targets: AffectedTarget[],
  ): AffectedReport | Promise<AffectedReport>;
}
