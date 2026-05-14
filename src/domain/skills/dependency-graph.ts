/**
 * Skill dependency-graph utilities — pure functions over a graph of
 * skill names → list of skills they declare as `depends_on`.
 *
 * The SkillStore holds the actual on-disk state; this module just
 * answers questions about a graph passed in:
 *   - Which dependencies are missing (named but no such skill exists)?
 *   - Are there cycles? Where do they start?
 *   - What is the topological order for a healthy subgraph?
 *
 * Pure functions only — no fs, no SkillStore — so they are trivially
 * testable and reusable (e.g. by a future skill-marketplace import flow
 * that wants to pre-validate a bundle before unpacking it).
 *
 * Algorithm: standard iterative DFS with three-colour marking
 * (unvisited / on-stack / done) — O(V + E), correct for self-loops,
 * direct cycles (A → A), and indirect cycles of any length.
 */

/** A directed edge list: each key declares its dependencies. */
export type SkillDepGraph = ReadonlyMap<string, readonly string[]>;

export interface MissingDependency {
  /** Skill that names a missing dep. */
  source: string;
  /** The named-but-absent dep. */
  missing: string;
}

export interface DependencyCycle {
  /** Ordered list of skill names forming the cycle, starting and ending at the same node.
   *  e.g. ['a', 'b', 'c', 'a'] for a → b → c → a. */
  path: string[];
}

export interface DependencyValidation {
  /** True iff there are no cycles AND no missing deps. */
  healthy: boolean;
  missing: MissingDependency[];
  cycles: DependencyCycle[];
  /** Skill count visited during validation. */
  totalSkills: number;
}

/**
 * Validate a dependency graph end-to-end.
 *
 * Detects every cycle independently (does not stop at the first one) so the
 * caller can report all of them in one shot. Missing deps are also collected
 * for every source skill, not just the first.
 */
export function validateSkillGraph(graph: SkillDepGraph): DependencyValidation {
  const missing: MissingDependency[] = [];
  const cycles: DependencyCycle[] = [];

  // 1. Missing-dep pass — single linear scan.
  for (const [source, deps] of graph) {
    for (const dep of deps) {
      if (!graph.has(dep)) {
        missing.push({ source, missing: dep });
      }
    }
  }

  // 2. Cycle pass — DFS with three colours.
  const cyclesSeen = new Set<string>();
  const colour: Map<string, 0 | 1 | 2> = new Map(); // 0 = unvisited, 1 = on-stack, 2 = done

  for (const start of graph.keys()) {
    if (colour.get(start) === 2) continue;
    dfs(start, graph, colour, [], cycles, cyclesSeen);
  }

  return {
    healthy: missing.length === 0 && cycles.length === 0,
    missing,
    cycles,
    totalSkills: graph.size,
  };
}

function dfs(
  node: string,
  graph: SkillDepGraph,
  colour: Map<string, 0 | 1 | 2>,
  stack: string[],
  cycles: DependencyCycle[],
  cyclesSeen: Set<string>,
): void {
  const c = colour.get(node) ?? 0;
  if (c === 2) return;
  if (c === 1) {
    // Found a back-edge — recover the cycle from the current stack.
    const start = stack.indexOf(node);
    if (start >= 0) {
      const cyclePath = [...stack.slice(start), node];
      const key = canonicalCycleKey(cyclePath);
      if (!cyclesSeen.has(key)) {
        cyclesSeen.add(key);
        cycles.push({ path: cyclePath });
      }
    }
    return;
  }
  colour.set(node, 1);
  stack.push(node);

  const deps = graph.get(node);
  if (deps) {
    for (const dep of deps) {
      if (graph.has(dep)) {
        dfs(dep, graph, colour, stack, cycles, cyclesSeen);
      }
    }
  }

  stack.pop();
  colour.set(node, 2);
}

/**
 * A cycle reported with two different rotations of the same nodes is the
 * same cycle. Canonicalise by rotating to the lexicographically smallest
 * starting node so dedup works.
 */
function canonicalCycleKey(cyclePath: string[]): string {
  // The path's first and last entries are the same node; drop the trailing
  // duplicate when rotating, then re-append it.
  const ring = cyclePath.slice(0, -1);
  if (ring.length === 0) return cyclePath.join('→');
  let bestStart = 0;
  for (let i = 1; i < ring.length; i++) {
    if (ring[i] < ring[bestStart]) bestStart = i;
  }
  const rotated = [...ring.slice(bestStart), ...ring.slice(0, bestStart)];
  return [...rotated, rotated[0]].join('→');
}

/**
 * Return a topological ordering of the graph (deps come before dependents).
 * Returns null if there is any cycle — callers should run validateSkillGraph
 * first to surface a useful error.
 *
 * Missing deps are tolerated: edges to absent nodes are simply ignored,
 * mirroring the indexer's "warn but proceed" stance.
 */
export function topologicalSort(graph: SkillDepGraph): string[] | null {
  const validation = validateSkillGraph(graph);
  if (validation.cycles.length > 0) return null;

  const order: string[] = [];
  const visited = new Set<string>();

  function visit(node: string): void {
    if (visited.has(node)) return;
    visited.add(node);
    const deps = graph.get(node);
    if (deps) {
      for (const d of deps) {
        if (graph.has(d)) visit(d);
      }
    }
    order.push(node);
  }

  // Sort keys for determinism — independent of Map insertion order.
  const keys = [...graph.keys()].sort();
  for (const k of keys) visit(k);
  return order;
}
