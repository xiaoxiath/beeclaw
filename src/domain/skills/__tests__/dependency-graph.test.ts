import { describe, it, expect } from 'vitest';
import {
  validateSkillGraph,
  topologicalSort,
  type SkillDepGraph,
} from '../dependency-graph';

function graph(spec: Record<string, string[]>): SkillDepGraph {
  return new Map(Object.entries(spec));
}

describe('validateSkillGraph — happy path', () => {
  it('reports healthy for an empty graph', () => {
    const r = validateSkillGraph(new Map());
    expect(r.healthy).toBe(true);
    expect(r.totalSkills).toBe(0);
  });

  it('reports healthy for a graph with no edges', () => {
    const r = validateSkillGraph(graph({ a: [], b: [], c: [] }));
    expect(r.healthy).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.cycles).toEqual([]);
  });

  it('reports healthy for a linear chain a → b → c', () => {
    const r = validateSkillGraph(graph({ a: ['b'], b: ['c'], c: [] }));
    expect(r.healthy).toBe(true);
  });

  it('reports healthy for a diamond a → {b,c} → d', () => {
    const r = validateSkillGraph(graph({
      a: ['b', 'c'], b: ['d'], c: ['d'], d: [],
    }));
    expect(r.healthy).toBe(true);
  });
});

describe('validateSkillGraph — missing deps', () => {
  it('flags a single missing dep', () => {
    const r = validateSkillGraph(graph({ a: ['ghost'] }));
    expect(r.healthy).toBe(false);
    expect(r.missing).toEqual([{ source: 'a', missing: 'ghost' }]);
    expect(r.cycles).toEqual([]);
  });

  it('flags multiple missing deps from the same source', () => {
    const r = validateSkillGraph(graph({ a: ['x', 'y', 'z'] }));
    expect(r.missing).toEqual([
      { source: 'a', missing: 'x' },
      { source: 'a', missing: 'y' },
      { source: 'a', missing: 'z' },
    ]);
  });

  it('does not double-report the same dep when referenced from different sources', () => {
    const r = validateSkillGraph(graph({ a: ['ghost'], b: ['ghost'] }));
    // Both sources should be reported (this is intentional — operators
    // need to know every callsite that needs to be edited).
    const sources = r.missing.map(m => m.source).sort();
    expect(sources).toEqual(['a', 'b']);
  });
});

describe('validateSkillGraph — cycles', () => {
  it('detects a self-loop a → a', () => {
    const r = validateSkillGraph(graph({ a: ['a'] }));
    expect(r.healthy).toBe(false);
    expect(r.cycles).toHaveLength(1);
    expect(r.cycles[0].path).toEqual(['a', 'a']);
  });

  it('detects a direct two-node cycle a → b → a', () => {
    const r = validateSkillGraph(graph({ a: ['b'], b: ['a'] }));
    expect(r.cycles).toHaveLength(1);
    // Cycle path includes the closing node.
    expect(r.cycles[0].path[0]).toBe(r.cycles[0].path[r.cycles[0].path.length - 1]);
    expect(r.cycles[0].path).toContain('a');
    expect(r.cycles[0].path).toContain('b');
  });

  it('detects a long indirect cycle a → b → c → d → a', () => {
    const r = validateSkillGraph(graph({
      a: ['b'], b: ['c'], c: ['d'], d: ['a'],
    }));
    expect(r.cycles).toHaveLength(1);
    expect(new Set(r.cycles[0].path)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('does not double-count the same cycle reached from different starts', () => {
    // If we DFS from each of a/b/c/d we'd "find" the same cycle 4 times.
    // canonicalCycleKey rotates to the lex-smallest start so dedup catches them.
    const r = validateSkillGraph(graph({
      a: ['b'], b: ['c'], c: ['a'],
    }));
    expect(r.cycles).toHaveLength(1);
  });

  it('reports two separate cycles in the same graph', () => {
    const r = validateSkillGraph(graph({
      // Cycle 1: a → b → a
      a: ['b'], b: ['a'],
      // Cycle 2: c → d → c
      c: ['d'], d: ['c'],
    }));
    expect(r.cycles).toHaveLength(2);
  });

  it('reports both missing deps and cycles at the same time', () => {
    const r = validateSkillGraph(graph({
      a: ['b', 'ghost'], b: ['a'],
    }));
    expect(r.healthy).toBe(false);
    expect(r.missing).toEqual([{ source: 'a', missing: 'ghost' }]);
    expect(r.cycles).toHaveLength(1);
  });

  it('does not falsely flag a diamond as a cycle', () => {
    // Regression: a naive visited-set algorithm thinks a → {b,c} → d is
    // cyclic because b and c both reach d. Three-colour DFS is correct.
    const r = validateSkillGraph(graph({
      a: ['b', 'c'], b: ['d'], c: ['d'], d: [],
    }));
    expect(r.cycles).toEqual([]);
  });

  it('handles disconnected subgraphs', () => {
    const r = validateSkillGraph(graph({
      // Healthy: a → b
      a: ['b'], b: [],
      // Cyclic: c → c
      c: ['c'],
      // Isolated: d
      d: [],
    }));
    expect(r.cycles).toHaveLength(1);
    expect(r.cycles[0].path).toEqual(['c', 'c']);
  });
});

describe('topologicalSort', () => {
  it('orders deps before dependents', () => {
    const order = topologicalSort(graph({
      a: ['b', 'c'], b: ['d'], c: ['d'], d: [],
    }));
    expect(order).not.toBeNull();
    const positions = new Map(order!.map((n, i) => [n, i]));
    expect(positions.get('d')!).toBeLessThan(positions.get('b')!);
    expect(positions.get('d')!).toBeLessThan(positions.get('c')!);
    expect(positions.get('b')!).toBeLessThan(positions.get('a')!);
    expect(positions.get('c')!).toBeLessThan(positions.get('a')!);
  });

  it('returns null when the graph contains any cycle', () => {
    expect(topologicalSort(graph({ a: ['b'], b: ['a'] }))).toBeNull();
  });

  it('is deterministic across runs (sorts by node name)', () => {
    const g = graph({ z: [], a: [], m: [] });
    const a = topologicalSort(g);
    const b = topologicalSort(g);
    expect(a).toEqual(b);
    // With no edges the result should be alphabetical.
    expect(a).toEqual(['a', 'm', 'z']);
  });

  it('tolerates missing deps (edges to absent nodes are skipped)', () => {
    const order = topologicalSort(graph({ a: ['ghost', 'b'], b: [] }));
    expect(order).not.toBeNull();
    expect(order).toContain('a');
    expect(order).toContain('b');
    expect(order).not.toContain('ghost');
  });

  it('returns [] for an empty graph', () => {
    expect(topologicalSort(new Map())).toEqual([]);
  });
});

describe('performance — large graphs', () => {
  it('validates a 1000-node linear chain in under 100ms', () => {
    const spec: Record<string, string[]> = {};
    for (let i = 0; i < 1000; i++) {
      spec[`n${i}`] = i + 1 < 1000 ? [`n${i + 1}`] : [];
    }
    const start = Date.now();
    const r = validateSkillGraph(graph(spec));
    const elapsed = Date.now() - start;
    expect(r.healthy).toBe(true);
    expect(elapsed).toBeLessThan(100);
  });
});
