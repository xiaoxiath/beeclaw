import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getSkillStore } from '@/domain/skills/store';
import type { CreateSkillOptions, UpdateSkillOptions } from '@/domain/skills/types';

const createSkillSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(1),
  content: z.string().min(1),
  triggers: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
  maturity: z.enum(['seed', 'growing', 'mature', 'deprecated']).optional(),
});

const updateSkillSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  triggers: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
  maturity: z.enum(['seed', 'growing', 'mature', 'deprecated']).optional(),
  enabled: z.boolean().optional(),
});

export default new Hono()
  // List all skills
  .get('/', async (c) => {
    try {
      const store = getSkillStore();
      const skills = store.list();

      // Add category info
      const skillsWithCategory = skills.map(skill => ({
        ...skill,
        category: skill.path.includes('/builtin/') ? 'builtin' : 'user',
      }));

      return c.json({
        skills: skillsWithCategory,
        total: skillsWithCategory.length,
        builtin: skillsWithCategory.filter(s => s.category === 'builtin').length,
        user: skillsWithCategory.filter(s => s.category === 'user').length,
      });
    } catch (error) {
      return c.json({
        error: 'Failed to list skills',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  })

  // Get skill by name
  .get('/:name', async (c) => {
    try {
      const name = c.req.param('name');
      const store = getSkillStore();
      const skill = store.get(name);

      if (!skill) {
        return c.json({ error: 'Not found', message: `Skill '${name}' not found` }, 404);
      }

      return c.json({
        skill: {
          ...skill,
          category: skill.path.includes('/builtin/') ? 'builtin' : 'user',
        },
      });
    } catch (error) {
      return c.json({
        error: 'Failed to get skill',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  })

  // Create new skill
  .post('/', zValidator('json', createSkillSchema), async (c) => {
    try {
      const body = c.req.valid('json');
      const store = getSkillStore();

      const options: CreateSkillOptions = {
        name: body.name,
        description: body.description,
        content: body.content,
        frontmatter: {
          triggers: body.triggers || [],
          examples: body.examples || [],
          maturity: body.maturity || 'seed',
        },
      };

      const result = store.create(options);

      if (!result.success) {
        return c.json({ error: 'Create failed', message: result.error }, 400);
      }

      return c.json({ skill: result.data }, 201);
    } catch (error) {
      return c.json({
        error: 'Failed to create skill',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  })

  // Update skill
  .put('/:name', zValidator('json', updateSkillSchema), async (c) => {
    try {
      const name = c.req.param('name');
      const body = c.req.valid('json');
      const store = getSkillStore();

      const options: UpdateSkillOptions = {};

      if (body.name) options.name = body.name;
      if (body.description) options.description = body.description;
      if (body.content) options.content = body.content;
      if (body.enabled !== undefined) options.enabled = body.enabled;
      if (body.triggers || body.examples || body.maturity) {
        options.frontmatter = {};
        if (body.triggers) options.frontmatter.triggers = body.triggers;
        if (body.examples) options.frontmatter.examples = body.examples;
        if (body.maturity) options.frontmatter.maturity = body.maturity;
      }

      const result = store.update(name, options);

      if (!result.success) {
        return c.json({ error: 'Update failed', message: result.error }, 400);
      }

      return c.json({ skill: result.data });
    } catch (error) {
      return c.json({
        error: 'Failed to update skill',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  })

  // Delete skill
  .delete('/:name', async (c) => {
    try {
      const name = c.req.param('name');
      const store = getSkillStore();

      const result = store.delete(name);

      if (!result.success) {
        return c.json({ error: 'Delete failed', message: result.error }, 400);
      }

      return c.json({ success: true, message: `Skill '${name}' deleted` });
    } catch (error) {
      return c.json({
        error: 'Failed to delete skill',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  })

  // Toggle skill enabled/disabled
  .post('/:name/toggle', async (c) => {
    try {
      const name = c.req.param('name');
      const store = getSkillStore();

      const skill = store.get(name);
      if (!skill) {
        return c.json({ error: 'Not found', message: `Skill '${name}' not found` }, 404);
      }

      const result = store.update(name, { enabled: !skill.enabled });

      if (!result.success) {
        return c.json({ error: 'Toggle failed', message: result.error }, 400);
      }

      return c.json({
        skill: result.data,
        message: `Skill '${name}' ${result.data!.enabled ? 'enabled' : 'disabled'}`,
      });
    } catch (error) {
      return c.json({
        error: 'Failed to toggle skill',
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });
