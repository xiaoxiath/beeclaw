import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SkillCache } from '../cache';

describe('SkillCache', () => {
  let cache: SkillCache;

  beforeEach(() => {
    cache = new SkillCache();
  });

  it('should start invalidated with null cache', () => {
    expect(cache.isInvalidated).toBe(true);
    expect(cache.get()).toBeNull();
  });

  it('should store and retrieve skills', () => {
    const skills = [{ id: 's1', name: 'test-skill' }] as any[];
    cache.set(skills);
    expect(cache.get()).toBe(skills);
    expect(cache.isInvalidated).toBe(false);
  });

  it('should return null after invalidation', () => {
    cache.set([{ id: 's1' }] as any[]);
    expect(cache.get()).not.toBeNull();

    cache.invalidate();

    expect(cache.get()).toBeNull();
    expect(cache.isInvalidated).toBe(true);
  });

  it('should allow re-setting after invalidation', () => {
    cache.set([{ id: 's1' }] as any[]);
    cache.invalidate();
    const newSkills = [{ id: 's2' }] as any[];
    cache.set(newSkills);
    expect(cache.get()).toBe(newSkills);
    expect(cache.isInvalidated).toBe(false);
  });
});
