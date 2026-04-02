export interface BitflowTaskDefinition {
  id: string;
  node: string | null;
  needs: string[];
  srcs: string[];
}

export function parseBitflowWorkflowTasks(
  workflowText: string,
): BitflowTaskDefinition[] {
  const blocks = extractTaskBlocks(workflowText);
  const tasks: BitflowTaskDefinition[] = [];

  for (const block of blocks) {
    const id = getQuotedValue(block, "id");
    if (!id) continue;

    tasks.push({
      id,
      node: getQuotedValue(block, "node"),
      needs: getQuotedArrayValue(block, "needs"),
      srcs: getQuotedArrayValue(block, "srcs"),
    });
  }

  return tasks;
}

export function buildBitflowDependents(
  tasks: BitflowTaskDefinition[],
): Map<string, string[]> {
  const dependents = new Map<string, string[]>();

  for (const task of tasks) {
    for (const need of task.needs) {
      const existing = dependents.get(need);
      if (existing) {
        existing.push(task.id);
      } else {
        dependents.set(need, [task.id]);
      }
    }
  }

  return dependents;
}

export function matchBitflowTaskPaths(
  task: BitflowTaskDefinition,
  changedFiles: string[],
): {
  matchedPaths: string[];
  matchReasons: string[];
} {
  const matchedPaths: string[] = [];
  const matchReasons = new Set<string>();

  for (const path of changedFiles) {
    const matchedPatterns = task.srcs.filter((pattern) => matchGlob(pattern, path));
    if (matchedPatterns.length === 0) continue;

    matchedPaths.push(path);
    for (const pattern of matchedPatterns) {
      matchReasons.add(`glob:${normalizePath(pattern)}`);
    }
  }

  return {
    matchedPaths,
    matchReasons: [...matchReasons],
  };
}

function extractTaskBlocks(workflowText: string): string[] {
  const blocks: string[] = [];
  let index = 0;

  while (index < workflowText.length) {
    const start = workflowText.indexOf("task(", index);
    if (start === -1) break;

    let depth = 0;
    let quoteChar: "'" | "\"" | null = null;
    let end = start;

    for (; end < workflowText.length; end++) {
      const current = workflowText[end];
      const previous = end > 0 ? workflowText[end - 1] : "";

      if ((current === "\"" || current === "'") && previous !== "\\") {
        if (quoteChar === null) {
          quoteChar = current;
        } else if (quoteChar === current) {
          quoteChar = null;
        }
      }
      if (quoteChar !== null) continue;

      if (current === "(") depth++;
      if (current === ")") {
        depth--;
        if (depth === 0) {
          end++;
          break;
        }
      }
    }

    if (end > start) {
      blocks.push(workflowText.slice(start, end));
      index = end;
    } else {
      index = start + 5;
    }
  }

  return blocks;
}

function getQuotedValue(line: string, key: string): string | null {
  const match = new RegExp(`${key}\\s*=\\s*(['"])(.*?)\\1`, "s").exec(line);
  return match?.[2] ?? null;
}

function getQuotedArrayValue(line: string, key: string): string[] {
  const match = new RegExp(`${key}\\s*=\\s*\\[(.*?)\\]`, "s").exec(line);
  if (!match) return [];

  const inner = match[1].trim();
  if (!inner) return [];

  const values: string[] = [];
  const pattern = /(['"])(.*?)\1/g;
  for (const captured of inner.matchAll(pattern)) {
    values.push(captured[2]);
  }
  return values;
}

function matchGlob(pattern: string, target: string): boolean {
  return globToRegex(normalizePath(pattern)).test(normalizePath(target));
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function globToRegex(pattern: string): RegExp {
  let out = "^";
  for (let index = 0; index < pattern.length; index++) {
    const current = pattern[index];
    if (current === "*") {
      const next = pattern[index + 1];
      if (next === "*") {
        out += ".*";
        index++;
      } else {
        out += "[^/]*";
      }
      continue;
    }

    if (".+?^${}()|[]\\".includes(current)) {
      out += `\\${current}`;
    } else {
      out += current;
    }
  }

  out += "$";
  return new RegExp(out);
}
