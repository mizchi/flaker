import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  buildAffectedReport,
  createAffectedSelection,
} from "./affected-report.js";
import type {
  AffectedReport,
  AffectedTarget,
  DependencyResolver,
} from "./types.js";

interface PackageInfo {
  name: string;
  dir: string;
  dependencies: string[];
  testFiles: string[];
}

export class WorkspaceResolver implements DependencyResolver {
  private packages: Map<string, PackageInfo> = new Map();
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.discoverPackages();
  }

  private discoverPackages(): void {
    const rootPkg = this.readPackageJson(this.rootDir);
    let patterns: string[] = [];

    // Try pnpm-workspace.yaml first
    const pnpmWorkspacePath = join(this.rootDir, "pnpm-workspace.yaml");
    if (existsSync(pnpmWorkspacePath)) {
      const content = readFileSync(pnpmWorkspacePath, "utf-8");
      const match = content.match(/packages:\s*\n((?:\s+-\s+.+\n?)+)/);
      if (match) {
        patterns = match[1]
          .split("\n")
          .map((l) => l.trim().replace(/^-\s+/, "").replace(/['"]/g, ""))
          .filter(Boolean);
      }
    } else if (rootPkg?.workspaces) {
      patterns = Array.isArray(rootPkg.workspaces)
        ? rootPkg.workspaces
        : (rootPkg.workspaces.packages ?? []);
    }

    // Resolve patterns to package directories
    for (const pattern of patterns) {
      const base = pattern.replace(/\/?\*.*$/, "");
      const baseDir = join(this.rootDir, base);
      if (!existsSync(baseDir) || !statSync(baseDir).isDirectory()) continue;

      for (const entry of readdirSync(baseDir)) {
        const pkgDir = join(baseDir, entry);
        const pkgJsonPath = join(pkgDir, "package.json");
        if (!existsSync(pkgJsonPath)) continue;

        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        if (!pkg.name) continue;

        this.packages.set(pkg.name, {
          name: pkg.name,
          dir: relative(this.rootDir, pkgDir),
          dependencies: [],
          testFiles: this.findTestFiles(pkgDir),
        });
      }
    }

    // Second pass: resolve workspace dependencies (now that all packages are known)
    for (const [, info] of this.packages) {
      const pkg = JSON.parse(
        readFileSync(join(this.rootDir, info.dir, "package.json"), "utf-8"),
      );
      info.dependencies = this.extractWorkspaceDeps(pkg);
    }
  }

  private readPackageJson(dir: string): any {
    const p = join(dir, "package.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8"));
  }

  private extractWorkspaceDeps(pkg: any): string[] {
    const deps: string[] = [];
    const allDeps: Record<string, string> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    for (const [name, version] of Object.entries(allDeps)) {
      if (version.startsWith("workspace:") || this.packages.has(name)) {
        deps.push(name);
      }
    }
    return deps;
  }

  private findTestFiles(pkgDir: string): string[] {
    const testDirs = ["tests", "test", "__tests__", "src"];
    const results: string[] = [];
    for (const dir of testDirs) {
      const testDir = join(pkgDir, dir);
      if (existsSync(testDir) && statSync(testDir).isDirectory()) {
        this.walkDir(testDir, results);
      }
    }
    return results.map((f) => relative(this.rootDir, f));
  }

  private walkDir(dir: string, results: string[]): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules" && entry !== ".git") {
          this.walkDir(full, results);
        }
      } else if (/\.(test|spec)\.(ts|tsx|js|jsx|mts|mjs)$/.test(entry)) {
        results.push(full);
      }
    }
  }

  private buildDependents(): Map<string, string[]> {
    const dependents = new Map<string, string[]>();
    for (const [name, pkg] of this.packages) {
      for (const dep of pkg.dependencies) {
        const existing = dependents.get(dep);
        if (existing) {
          existing.push(name);
        } else {
          dependents.set(dep, [name]);
        }
      }
    }
    return dependents;
  }

  private matchChangedPackages(changedFiles: string[]): {
    directMatches: Map<string, string[]>;
    unmatched: string[];
  } {
    const directMatches = new Map<string, string[]>();
    const unmatched: string[] = [];

    for (const file of changedFiles) {
      const matchedPackages: string[] = [];
      for (const [name, pkg] of this.packages) {
        if (file.startsWith(pkg.dir + "/") || file.startsWith(pkg.dir + "\\")) {
          matchedPackages.push(name);
        }
      }

      if (matchedPackages.length === 0) {
        unmatched.push(file);
        continue;
      }

      for (const packageName of matchedPackages) {
        const existing = directMatches.get(packageName);
        if (existing) {
          existing.push(file);
        } else {
          directMatches.set(packageName, [file]);
        }
      }
    }

    return {
      directMatches,
      unmatched,
    };
  }

  private expandAffectedPackages(
    directMatches: Map<string, string[]>,
  ): Map<string, string[]> {
    const dependents = this.buildDependents();
    const affected = new Set(directMatches.keys());
    const includedBy = new Map<string, Set<string>>();
    const queue = [...directMatches.keys()];

    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      for (const dependent of dependents.get(current) ?? []) {
        let parents = includedBy.get(dependent);
        if (!parents) {
          parents = new Set<string>();
          includedBy.set(dependent, parents);
        }
        parents.add(current);

        if (!affected.has(dependent)) {
          affected.add(dependent);
          queue.push(dependent);
        }
      }
    }

    return new Map(
      [...includedBy.entries()].map(([key, value]) => [key, [...value].sort()]),
    );
  }

  resolve(changedFiles: string[], allTestFiles: string[]): string[] {
    const { directMatches } = this.matchChangedPackages(changedFiles);
    const affected = new Set<string>(directMatches.keys());
    const queue = [...directMatches.keys()];
    const dependents = this.buildDependents();

    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      for (const dependent of dependents.get(current) ?? []) {
        if (!affected.has(dependent)) {
          affected.add(dependent);
          queue.push(dependent);
        }
      }
    }

    const affectedTests = new Set<string>();
    for (const name of affected) {
      const pkg = this.packages.get(name);
      if (pkg) {
        for (const t of pkg.testFiles) {
          affectedTests.add(t);
        }
      }
    }

    const testSet = new Set(allTestFiles);
    return Array.from(affectedTests).filter((t) => testSet.has(t));
  }

  explain(changedFiles: string[], targets: AffectedTarget[]): AffectedReport {
    const { directMatches, unmatched } = this.matchChangedPackages(changedFiles);
    const includedBy = this.expandAffectedPackages(directMatches);
    const affectedPackages = new Set<string>([
      ...directMatches.keys(),
      ...includedBy.keys(),
    ]);
    const targetsByTaskId = new Map<string, AffectedTarget[]>();

    for (const target of targets) {
      const existing = targetsByTaskId.get(target.taskId);
      if (existing) {
        existing.push(target);
      } else {
        targetsByTaskId.set(target.taskId, [target]);
      }
    }

    const selected = [...affectedPackages].flatMap((taskId) => {
      const matchedTargets = targetsByTaskId.get(taskId) ?? [];
      const pkg = this.packages.get(taskId);
      const direct = directMatches.has(taskId);
      const parents = includedBy.get(taskId) ?? [];
      return matchedTargets.map((target) =>
        createAffectedSelection(target, {
          direct,
          includedBy: direct ? [] : parents,
          matchedPaths: direct ? (directMatches.get(taskId) ?? []) : [],
          matchReasons: direct
            ? [`package:${pkg?.dir ?? taskId}`]
            : parents.map((parent) => `dependency:${parent}`),
        }),
      );
    });

    return buildAffectedReport("workspace", changedFiles, selected, unmatched);
  }
}
