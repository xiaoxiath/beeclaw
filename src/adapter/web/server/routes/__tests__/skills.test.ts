import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../../../../infra/observability/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock skill store
const mockSkillStore = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('@/domain/skills/store', () => ({
  getSkillStore: () => mockSkillStore,
}));

import skillsRoutes from '../skills';

describe('Skills Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET / ───
  describe('GET / (list skills)', () => {
    it('returns all skills with category info', async () => {
      mockSkillStore.list.mockReturnValue([
        { name: 'greet', path: '/skills/builtin/greet.md', enabled: true },
        { name: 'custom', path: '/skills/user/custom.md', enabled: true },
      ]);

      const res = await skillsRoutes.request('/');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.skills).toHaveLength(2);
      expect(json.skills[0].category).toBe('builtin');
      expect(json.skills[1].category).toBe('user');
      expect(json.total).toBe(2);
      expect(json.builtin).toBe(1);
      expect(json.user).toBe(1);
    });

    it('returns empty list when no skills exist', async () => {
      mockSkillStore.list.mockReturnValue([]);

      const res = await skillsRoutes.request('/');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.skills).toEqual([]);
      expect(json.total).toBe(0);
    });

    it('returns 500 on error', async () => {
      mockSkillStore.list.mockImplementation(() => { throw new Error('DB crash'); });

      const res = await skillsRoutes.request('/');
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Failed to list skills');
      expect(json.message).toBe('DB crash');
    });

    it('returns 500 with "Unknown error" for non-Error throws', async () => {
      mockSkillStore.list.mockImplementation(() => { throw 'string error'; });

      const res = await skillsRoutes.request('/');
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.message).toBe('Unknown error');
    });
  });

  // ─── GET /:name ───
  describe('GET /:name', () => {
    it('returns a skill by name', async () => {
      mockSkillStore.get.mockReturnValue({
        name: 'greet',
        path: '/skills/builtin/greet.md',
        enabled: true,
      });

      const res = await skillsRoutes.request('/greet');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.skill.name).toBe('greet');
      expect(json.skill.category).toBe('builtin');
    });

    it('returns user category for non-builtin path', async () => {
      mockSkillStore.get.mockReturnValue({
        name: 'myskill',
        path: '/skills/user/myskill.md',
        enabled: true,
      });

      const res = await skillsRoutes.request('/myskill');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.skill.category).toBe('user');
    });

    it('returns 404 when skill not found', async () => {
      mockSkillStore.get.mockReturnValue(null);

      const res = await skillsRoutes.request('/nonexistent');
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Not found');
      expect(json.message).toContain('nonexistent');
    });

    it('returns 500 on error', async () => {
      mockSkillStore.get.mockImplementation(() => { throw new Error('Read error'); });

      const res = await skillsRoutes.request('/broken');
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Failed to get skill');
    });

    it('returns 500 with unknown error for non-Error throws', async () => {
      mockSkillStore.get.mockImplementation(() => { throw 42; });

      const res = await skillsRoutes.request('/broken');
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.message).toBe('Unknown error');
    });
  });

  // ─── POST / (create) ───
  describe('POST / (create skill)', () => {
    it('creates a skill successfully', async () => {
      mockSkillStore.create.mockReturnValue({
        success: true,
        data: { name: 'newskill', path: '/skills/user/newskill.md' },
      });

      const res = await skillsRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'newskill',
          description: 'A new skill',
          content: 'Skill content here',
          triggers: ['hello'],
          examples: ['say hello'],
          maturity: 'seed',
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.skill.name).toBe('newskill');
    });

    it('creates a skill with minimal required fields', async () => {
      mockSkillStore.create.mockReturnValue({
        success: true,
        data: { name: 'minimal', path: '/skills/user/minimal.md' },
      });

      const res = await skillsRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'minimal',
          description: 'Minimal skill',
          content: 'content',
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.skill).toBeDefined();
    });

    it('returns 400 when create fails', async () => {
      mockSkillStore.create.mockReturnValue({
        success: false,
        error: 'Skill already exists',
      });

      const res = await skillsRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'duplicate',
          description: 'Dup',
          content: 'content',
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Create failed');
    });

    it('returns 400 for invalid body (missing required fields)', async () => {
      const res = await skillsRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 500 on unexpected error', async () => {
      mockSkillStore.create.mockImplementation(() => { throw new Error('Unexpected'); });

      const res = await skillsRoutes.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'crash',
          description: 'desc',
          content: 'content',
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Failed to create skill');
    });
  });

  // ─── PUT /:name (update) ───
  describe('PUT /:name (update skill)', () => {
    it('updates a skill successfully', async () => {
      mockSkillStore.update.mockReturnValue({
        success: true,
        data: { name: 'greet', description: 'Updated' },
      });

      const res = await skillsRoutes.request('/greet', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'greet',
          description: 'Updated description',
          content: 'Updated content',
          enabled: true,
          triggers: ['hi'],
          examples: ['say hi'],
          maturity: 'growing',
        }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.skill).toBeDefined();
    });

    it('updates only partial fields', async () => {
      mockSkillStore.update.mockReturnValue({
        success: true,
        data: { name: 'test', enabled: false },
      });

      const res = await skillsRoutes.request('/test', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.skill.enabled).toBe(false);
    });

    it('returns 400 when update fails', async () => {
      mockSkillStore.update.mockReturnValue({
        success: false,
        error: 'Skill not found',
      });

      const res = await skillsRoutes.request('/missing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'update' }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Update failed');
    });

    it('returns 500 on unexpected error', async () => {
      mockSkillStore.update.mockImplementation(() => { throw new Error('Crash'); });

      const res = await skillsRoutes.request('/crash', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'boom' }),
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Failed to update skill');
    });

    it('handles non-Error throws', async () => {
      mockSkillStore.update.mockImplementation(() => { throw null; });

      const res = await skillsRoutes.request('/crash', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'boom' }),
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.message).toBe('Unknown error');
    });

    it('handles frontmatter with only triggers', async () => {
      mockSkillStore.update.mockReturnValue({
        success: true,
        data: { name: 'test' },
      });

      const res = await skillsRoutes.request('/test', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggers: ['new trigger'] }),
      });

      expect(res.status).toBe(200);
      expect(mockSkillStore.update).toHaveBeenCalledWith('test', expect.objectContaining({
        frontmatter: expect.objectContaining({ triggers: ['new trigger'] }),
      }));
    });
  });

  // ─── DELETE /:name ───
  describe('DELETE /:name', () => {
    it('deletes a skill successfully', async () => {
      mockSkillStore.delete.mockReturnValue({ success: true });

      const res = await skillsRoutes.request('/myskill', { method: 'DELETE' });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.message).toContain('myskill');
    });

    it('returns 400 when delete fails', async () => {
      mockSkillStore.delete.mockReturnValue({
        success: false,
        error: 'Cannot delete builtin',
      });

      const res = await skillsRoutes.request('/builtin', { method: 'DELETE' });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Delete failed');
    });

    it('returns 500 on unexpected error', async () => {
      mockSkillStore.delete.mockImplementation(() => { throw new Error('FS error'); });

      const res = await skillsRoutes.request('/crash', { method: 'DELETE' });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Failed to delete skill');
    });

    it('handles non-Error throws on delete', async () => {
      mockSkillStore.delete.mockImplementation(() => { throw undefined; });

      const res = await skillsRoutes.request('/crash', { method: 'DELETE' });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.message).toBe('Unknown error');
    });
  });

  // ─── POST /:name/toggle ───
  describe('POST /:name/toggle', () => {
    it('toggles an enabled skill to disabled', async () => {
      mockSkillStore.get.mockReturnValue({ name: 'greet', enabled: true });
      mockSkillStore.update.mockReturnValue({
        success: true,
        data: { name: 'greet', enabled: false },
      });

      const res = await skillsRoutes.request('/greet/toggle', { method: 'POST' });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.skill.enabled).toBe(false);
      expect(json.message).toContain('disabled');
      expect(mockSkillStore.update).toHaveBeenCalledWith('greet', { enabled: false });
    });

    it('toggles a disabled skill to enabled', async () => {
      mockSkillStore.get.mockReturnValue({ name: 'greet', enabled: false });
      mockSkillStore.update.mockReturnValue({
        success: true,
        data: { name: 'greet', enabled: true },
      });

      const res = await skillsRoutes.request('/greet/toggle', { method: 'POST' });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.message).toContain('enabled');
    });

    it('returns 404 when skill not found', async () => {
      mockSkillStore.get.mockReturnValue(null);

      const res = await skillsRoutes.request('/missing/toggle', { method: 'POST' });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Not found');
    });

    it('returns 400 when toggle update fails', async () => {
      mockSkillStore.get.mockReturnValue({ name: 'greet', enabled: true });
      mockSkillStore.update.mockReturnValue({
        success: false,
        error: 'Cannot toggle builtin',
      });

      const res = await skillsRoutes.request('/greet/toggle', { method: 'POST' });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Toggle failed');
    });

    it('returns 500 on unexpected error', async () => {
      mockSkillStore.get.mockImplementation(() => { throw new Error('Crash'); });

      const res = await skillsRoutes.request('/crash/toggle', { method: 'POST' });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Failed to toggle skill');
    });

    it('handles non-Error throws on toggle', async () => {
      mockSkillStore.get.mockImplementation(() => { throw 'oops'; });

      const res = await skillsRoutes.request('/crash/toggle', { method: 'POST' });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.message).toBe('Unknown error');
    });
  });
});
