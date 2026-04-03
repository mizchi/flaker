export interface TestCoverageInput {
  suite: string;
  edges: string[];
}

export interface CoverageGuidedResult {
  selected: string[];
  coveredEdges: number;
  totalChangedEdges: number;
  coverageRatio: number;
}

/**
 * Greedy set cover: select tests that maximize coverage of changed edges.
 * Based on coverage-guided fuzzing's max-reduce strategy.
 */
export function selectByCoverage(
  testCoverages: TestCoverageInput[],
  changedEdges: string[],
  count: number,
): CoverageGuidedResult {
  if (testCoverages.length === 0 || changedEdges.length === 0 || count <= 0) {
    return {
      selected: [],
      coveredEdges: 0,
      totalChangedEdges: changedEdges.length,
      coverageRatio: 0,
    };
  }

  const changedSet = new Set(changedEdges);

  // For each test, compute relevant changed edges
  const testRelevant: { suite: string; edges: string[] }[] = [];
  for (const tc of testCoverages) {
    const relevant = tc.edges.filter((e) => changedSet.has(e));
    if (relevant.length > 0) {
      testRelevant.push({ suite: tc.suite, edges: relevant });
    }
  }

  const selected: string[] = [];
  const covered = new Set<string>();
  const usedSuites = new Set<string>();
  const maxSelect = Math.min(count, testRelevant.length);

  for (let round = 0; round < maxSelect; round++) {
    let bestIdx = -1;
    let bestNewCount = 0;

    for (let i = 0; i < testRelevant.length; i++) {
      const { suite, edges } = testRelevant[i];
      if (usedSuites.has(suite)) continue;

      let newCount = 0;
      for (const edge of edges) {
        if (!covered.has(edge)) newCount++;
      }

      if (newCount > bestNewCount) {
        bestNewCount = newCount;
        bestIdx = i;
      }
    }

    if (bestIdx < 0 || bestNewCount === 0) break;

    const best = testRelevant[bestIdx];
    selected.push(best.suite);
    usedSuites.add(best.suite);
    for (const edge of best.edges) {
      covered.add(edge);
    }
  }

  const coverageRatio =
    changedEdges.length > 0
      ? Math.round((covered.size / changedEdges.length) * 100) / 100
      : 1;

  return {
    selected,
    coveredEdges: covered.size,
    totalChangedEdges: changedEdges.length,
    coverageRatio,
  };
}
