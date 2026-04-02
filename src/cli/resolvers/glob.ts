import { readFileSync } from "node:fs";
import { parse } from "smol-toml";
import {
  buildAffectedReport,
  createAffectedSelection,
} from "./affected-report.js";
import type {
  AffectedReport,
  AffectedSelection,
  AffectedTarget,
  DependencyResolver,
} from "./types.js";

interface GlobRuleFile {
  rules?: Array<{
    changed?: unknown;
    select?: unknown;
    reason?: unknown;
  }>;
}

interface CompiledGlobRule {
  changed: RegExp[];
  select: RegExp[];
  reason: string;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function compileGlob(glob: string): RegExp {
  const normalized = normalizePath(glob);
  const escaped = escapeRegex(normalized)
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("?", "[^/]")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`);
}

function normalizeStringArray(
  value: unknown,
  fieldName: string,
  ruleIndex: number,
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`glob rule ${ruleIndex} requires non-empty ${fieldName}`);
  }

  return value.map((entry, offset) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error(
        `glob rule ${ruleIndex} ${fieldName}[${offset}] must be a non-empty string`,
      );
    }
    return entry;
  });
}

function compileRules(configPath: string): CompiledGlobRule[] {
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parse(raw) as GlobRuleFile;
  const rules = parsed.rules ?? [];

  return rules.map((rule, index) => {
    const changed = normalizeStringArray(rule.changed, "changed", index + 1);
    const select = normalizeStringArray(rule.select, "select", index + 1);
    const reason = typeof rule.reason === "string" && rule.reason.trim() !== ""
      ? rule.reason
      : `rule:${index + 1}`;

    return {
      changed: changed.map(compileGlob),
      select: select.map(compileGlob),
      reason,
    };
  });
}

function targetMatchesRule(target: AffectedTarget, rule: CompiledGlobRule): boolean {
  const spec = normalizePath(target.spec);
  return rule.select.some((pattern) => pattern.test(spec));
}

function buildSelection(
  target: AffectedTarget,
  matchedPaths: Set<string>,
  reasons: Set<string>,
): AffectedSelection {
  return createAffectedSelection(target, {
    direct: true,
    matchedPaths: [...matchedPaths],
    matchReasons: [...reasons].sort(),
  });
}

export class GlobRuleResolver implements DependencyResolver {
  private readonly rules: CompiledGlobRule[];

  constructor(configPath: string) {
    this.rules = compileRules(configPath);
  }

  resolve(changedFiles: string[], allTestFiles: string[]): string[] {
    const selected = new Set<string>();
    const normalizedTargets = allTestFiles.map((target) => ({
      raw: target,
      normalized: normalizePath(target),
    }));

    for (const file of changedFiles.map(normalizePath)) {
      const matchedRules = this.rules.filter((rule) =>
        rule.changed.some((pattern) => pattern.test(file))
      );
      if (matchedRules.length === 0) continue;

      for (const target of normalizedTargets) {
        if (matchedRules.some((rule) => rule.select.some((pattern) => pattern.test(target.normalized)))) {
          selected.add(target.raw);
        }
      }
    }

    return allTestFiles.filter((target) => selected.has(target));
  }

  explain(changedFiles: string[], targets: AffectedTarget[]): AffectedReport {
    const matchedFiles = new Set<string>();
    const selected = new Map<string, { target: AffectedTarget; matchedPaths: Set<string>; reasons: Set<string> }>();

    for (const file of changedFiles) {
      const normalizedFile = normalizePath(file);
      const matchedRules = this.rules.filter((rule) =>
        rule.changed.some((pattern) => pattern.test(normalizedFile))
      );
      if (matchedRules.length === 0) continue;
      matchedFiles.add(file);

      for (const target of targets) {
        const matchingRules = matchedRules.filter((rule) => targetMatchesRule(target, rule));
        if (matchingRules.length === 0) continue;

        const key = JSON.stringify({
          spec: target.spec,
          taskId: target.taskId,
          filter: target.filter ?? null,
        });
        const entry = selected.get(key) ?? {
          target,
          matchedPaths: new Set<string>(),
          reasons: new Set<string>(),
        };
        entry.matchedPaths.add(file);
        for (const rule of matchingRules) {
          entry.reasons.add(rule.reason);
        }
        selected.set(key, entry);
      }
    }

    return buildAffectedReport(
      "glob",
      changedFiles,
      [...selected.values()].map((entry) =>
        buildSelection(entry.target, entry.matchedPaths, entry.reasons)
      ),
      changedFiles.filter((file) => !matchedFiles.has(file)),
    );
  }
}
