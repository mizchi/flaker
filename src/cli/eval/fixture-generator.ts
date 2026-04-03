export interface FixtureConfig {
  testCount: number;
  commitCount: number;
  flakyRate: number;
  coFailureStrength: number;
  filesPerCommit: number;
  testsPerFile: number;
  samplePercentage: number;
  seed: number;
}

export interface FixtureTest {
  suite: string;
  testName: string;
  isFlaky: boolean;
}

interface FixtureCommitResult {
  suite: string;
  testName: string;
  status: "passed" | "failed";
}

export interface FixtureCommit {
  sha: string;
  changedFiles: { filePath: string; changeType: string }[];
  testResults: FixtureCommitResult[];
}

export interface FixtureData {
  tests: FixtureTest[];
  files: string[];
  fileDeps: Map<string, string[]>;
  commits: FixtureCommit[];
  config: FixtureConfig;
}

function lcgNext(state: number): { next: number; value: number } {
  const next = (state * 1664525 + 1013904223) >>> 0;
  return { next, value: next / 0x100000000 };
}

export function generateFixture(config: FixtureConfig): FixtureData {
  let rng = config.seed >>> 0;
  function rand(): number {
    const r = lcgNext(rng);
    rng = r.next;
    return r.value;
  }

  const fileCount = Math.max(1, Math.ceil(config.testCount / config.testsPerFile));
  const files: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    files.push(`src/module_${i}.ts`);
  }

  const tests: FixtureTest[] = [];
  const fileDeps = new Map<string, string[]>();
  for (let i = 0; i < fileCount; i++) {
    fileDeps.set(files[i], []);
  }

  const flakyCount = Math.round(config.testCount * config.flakyRate);
  for (let i = 0; i < config.testCount; i++) {
    const fileIdx = i % fileCount;
    const suite = `tests/module_${fileIdx}/test_${i}.spec.ts`;
    tests.push({
      suite,
      testName: `test_${i}`,
      isFlaky: i < flakyCount,
    });
    fileDeps.get(files[fileIdx])!.push(suite);
  }

  const commits: FixtureCommit[] = [];
  for (let c = 0; c < config.commitCount; c++) {
    const sha = `fixture-sha-${c.toString().padStart(4, "0")}`;

    const changedFiles: { filePath: string; changeType: string }[] = [];
    const changedFileSet = new Set<string>();
    const targetCount = Math.min(config.filesPerCommit, fileCount);
    while (changedFileSet.size < targetCount) {
      const idx = Math.floor(rand() * fileCount);
      const file = files[idx];
      if (!changedFileSet.has(file)) {
        changedFileSet.add(file);
        changedFiles.push({ filePath: file, changeType: "modified" });
      }
    }

    const dependentSuites = new Set<string>();
    for (const file of changedFileSet) {
      for (const suite of fileDeps.get(file) ?? []) {
        dependentSuites.add(suite);
      }
    }

    const testResults: FixtureCommitResult[] = tests.map((test) => {
      const isDependent = dependentSuites.has(test.suite);
      let failed = false;

      if (isDependent && rand() < config.coFailureStrength) {
        failed = true;
      }

      if (test.isFlaky && rand() < config.flakyRate) {
        failed = true;
      }

      return {
        suite: test.suite,
        testName: test.testName,
        status: failed ? "failed" : "passed",
      };
    });

    commits.push({ sha, changedFiles, testResults });
  }

  return { tests, files, fileDeps, commits, config };
}
