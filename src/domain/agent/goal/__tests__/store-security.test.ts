/**
 * Goal store security: id whitelist + decompose parentId integrity.
 *
 * Two real findings:
 *   1. The previous denylist `sanitizeId` mangled `.` and `/` to `_`
 *      instead of rejecting bad input. Whitelist regex now refuses
 *      anything that doesn't match generateId() shape.
 *   2. decompose() stored the *raw* parentId in the subgoal record
 *      (not the sanitized one). Any code reading `subGoal.parentGoal`
 *      and re-using it as an fs path would re-introduce a traversal.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GoalStore } from '../store';

let tmp: string;
let store: GoalStore;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beeclaw-goal-sec-'));
  store = new GoalStore(tmp);
  store.init();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('GoalStore.sanitizeId — whitelist', () => {
  // The traversal payloads route through the public methods that call
  // sanitizeId(); we expect *all* of them to reject the same way.
  const TRAVERSAL_PAYLOADS = [
    '../etc/passwd',
    '../../etc/passwd',
    '/etc/passwd',
    '..',
    '.',
    'a/b',
    'a\\b',
    'has space',
    '',
    'has.dot',           // previously got mangled to "has_dot", now rejected outright
    'leading-dash-ok-but-no-dot.json',
    '$(rm -rf /)',
  ];

  for (const payload of TRAVERSAL_PAYLOADS) {
    test(`get(${JSON.stringify(payload)}) rejects`, () => {
      expect(() => store.get(payload)).toThrow(/Invalid goal ID/);
    });

    test(`update(${JSON.stringify(payload)}) rejects`, () => {
      expect(() => store.update(payload, { title: 'x' })).toThrow(/Invalid goal ID/);
    });

    test(`delete(${JSON.stringify(payload)}) rejects`, () => {
      expect(() => store.delete(payload)).toThrow(/Invalid goal ID/);
    });
  }

  test('valid generated id shape passes', () => {
    // Mirror generateId(): goal-<base36>-<base36>
    const ok = 'goal-mxxxxxxx-abcde';
    // get() returns null (not found) but does NOT throw — proves whitelist accepted it.
    expect(store.get(ok)).toBeNull();
  });

  test('boundary: 64-char alphanumeric id accepted', () => {
    const id = 'a' + 'b'.repeat(63); // 64 chars
    expect(store.get(id)).toBeNull();
  });

  test('boundary: 65-char id rejected', () => {
    const id = 'a' + 'b'.repeat(64); // 65 chars
    expect(() => store.get(id)).toThrow(/Invalid goal ID/);
  });

  test('id starting with "-" rejected (whitelist requires alnum first char)', () => {
    expect(() => store.get('-leading-dash')).toThrow(/Invalid goal ID/);
  });
});

describe('GoalStore.decompose — parentId integrity', () => {
  test('subGoal.parentGoal stores the SANITIZED parent id, not raw input', () => {
    const created = store.create({ title: 'parent' });
    expect(created.success).toBe(true);
    const parentId = created.data!.id; // valid generated id

    const decomposed = store.decompose(parentId, ['child A', 'child B']);
    expect(decomposed.success).toBe(true);

    const subGoalIds: string[] = decomposed.data!.subGoalIds;
    expect(subGoalIds).toHaveLength(2);

    for (const sgId of subGoalIds) {
      const sg = store.get(sgId);
      expect(sg).not.toBeNull();
      // The bug we fixed: previously this stored raw `parentId` (the
      // user-controlled string). Now it must equal the sanitized one,
      // and since valid ids are unchanged by sanitize, it equals parentId.
      expect(sg!.parentGoal).toBe(parentId);
      // Crucially: should never contain traversal chars even in adversarial
      // input. (Generated parentId never does, but assert the property.)
      expect(sg!.parentGoal).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
    }
  });

  test('decompose with traversal-shaped parentId rejects up front (no subgoal files written)', () => {
    expect(() => store.decompose('../escape', ['child'])).toThrow(/Invalid goal ID/);
    // Confirm the sub-goal file wasn't half-created.
    const activeDir = path.join(tmp, 'active');
    const files = fs.readdirSync(activeDir);
    expect(files).toHaveLength(0);
  });
});

describe('Goal generateId() — output matches whitelist', () => {
  test('100 generated ids all pass the whitelist', () => {
    // Indirect: create 100 goals, each must round-trip via get() without throwing.
    const created: string[] = [];
    for (let i = 0; i < 100; i++) {
      const r = store.create({ title: `t${i}` });
      expect(r.success).toBe(true);
      created.push(r.data!.id);
    }
    for (const id of created) {
      expect(() => store.get(id)).not.toThrow();
      expect(store.get(id)).not.toBeNull();
    }
  });
});
