import { Hono } from 'hono';
import { getMemoryStore } from '@/domain/memory';

export default new Hono()
  // List/search memory entries
  .get('/', async (c) => {
    console.log('[Memory API] GET /');
    const { path, search, category } = c.req.query();
    console.log('[Memory API] Query params:', { path, search, category });

    const store = getMemoryStore();

    try {
      // If searching
      if (search) {
        console.log('[Memory API] Searching for:', search);
        const results = await store.grep(search);
        console.log('[Memory API] Search results:', results);

        // Parse grep results into structured format
        let entries: any[] = [];
        if (results.success && results.data && results.data !== '(no matches found)') {
          // Split by file separator
          const files = results.data.split('\n\n---\n\n');
          entries = files.map(fileBlock => {
            const lines = fileBlock.split('\n');
            const firstLine = lines[0];
            // Extract file path from "📄 path"
            const path = firstLine.replace('📄 ', '').trim();
            // Extract matching lines
            const matches = lines.slice(1)
              .filter(line => line.startsWith('L'))
              .map(line => {
                const match = line.match(/^L(\d+): (.*)$/);
                return match ? { line: parseInt(match[1]), content: match[2] } : null;
              })
              .filter(Boolean);

            return {
              path,
              category: path.split('/')[0] || 'other',
              type: 'file' as const,
              matches,
            };
          });
        }

        return c.json({
          entries,
          total: entries.length,
          query: { search },
        });
      }

      // If browsing by path
      if (path) {
        console.log('[Memory API] Listing path:', path);
        const result = await store.ls(path);
        console.log('[Memory API] List result:', result);

        if (!result.success) {
          return c.json({ error: 'Failed to list path', message: result.error }, 404);
        }

        // Parse the listing data into structured entries
        const entries = result.data
          ? result.data.split('\n').map(line => {
            const isDir = line.startsWith('d ');
            const name = line.substring(2).trim();
            return {
              path: path === '/' ? `/${name}` : `${path}/${name}`,
              category: path.split('/')[1] || 'other',
              type: isDir ? 'directory' : 'file',
            } as MemoryEntry;
          })
          : [];

        return c.json({
          path,
          entries,
          total: entries.length,
        });
      }

      // List all categories
      console.log('[Memory API] Listing all memory');
      const allResult = await store.ls('/');
      console.log('[Memory API] List result:', allResult);

      if (!allResult.success) {
        return c.json({ error: 'Failed to list memory', message: allResult.error }, 500);
      }

      // Parse all entries
      const allMemory = allResult.data
        ? allResult.data.split('\n').map(line => {
          const isDir = line.startsWith('d ');
          const name = line.substring(2).trim();
          return {
            path: name, // Remove leading slash
            category: name.split('/')[0] || 'other',
            type: isDir ? 'directory' : 'file',
          } as MemoryEntry;
        })
        : [];

      console.log('[Memory API] Total entries:', allMemory.length);

      // Group by category
      const byCategory = allMemory.reduce((acc, entry) => {
        const cat = entry.category || 'other';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(entry);
        return acc;
      }, {} as Record<string, typeof allMemory>);

      return c.json({
        entries: allMemory,
        byCategory,
        total: allMemory.length,
      });
    } catch (error) {
      console.error('[Memory API] Error:', error);
      return c.json({
        error: true,
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  })

  // Get specific memory entry or list directory
  .get('/*', async (c) => {
    let memoryPath = c.req.path.replace('/api/memory/', '');
    // URL decode the path (e.g., %2F -> /)
    memoryPath = decodeURIComponent(memoryPath);
    // Remove leading slash if present (memory store expects paths without leading slash)
    memoryPath = memoryPath.replace(/^\//, '');
    console.log('[Memory API] GET /*', memoryPath);

    const store = getMemoryStore();

    try {
      // First try to read as a file
      const result = await store.read(memoryPath);

      if (result && result.success) {
        // It's a file, return content
        const category = memoryPath.split('/')[0] || 'other';

        const entry = {
          path: memoryPath,
          category,
          content: result.data,
          type: 'file' as const,
          updatedAt: new Date().toISOString(), // TODO: get actual file mtime
        };

        console.log('[Memory API] File entry retrieved:', memoryPath);
        return c.json({ entry });
      }

      // If read failed with directory error, try listing instead
      if (result?.error?.includes('EISDIR') || result?.error?.includes('directory')) {
        console.log('[Memory API] Path is a directory, listing contents:', memoryPath);
        const listResult = await store.ls(memoryPath);

        if (!listResult.success) {
          return c.json({ error: 'Failed to list directory', message: listResult.error }, 404);
        }

        // Parse the listing data into structured entries
        const entries = listResult.data && listResult.data !== '(empty)'
          ? listResult.data.split('\n')
              .map(line => {
                const isDir = line.startsWith('d ');
                const name = line.substring(2).trim();
                // Skip empty names and "(empty)" entries
                if (!name || name === '(empty)') return null;

                return {
                  path: memoryPath === '' ? name : `${memoryPath}/${name}`,
                  category: memoryPath.split('/')[0] || 'other',
                  type: isDir ? 'directory' : 'file' as const,
                };
              })
              .filter(Boolean)
          : [];

        return c.json({
          path: memoryPath,
          entries,
          total: entries.length,
          type: 'directory',
        });
      }

      // Not found or other error
      return c.json({ error: 'Not found', message: result?.error || 'Memory entry not found' }, 404);
    } catch (error) {
      console.error('[Memory API] Error reading entry:', error);
      return c.json({
        error: true,
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  })

  // Delete memory entry
  .delete('/*', async (c) => {
    let memoryPath = c.req.path.replace('/api/memory/', '');
    // URL decode the path
    memoryPath = decodeURIComponent(memoryPath);
    // Remove leading slash if present
    memoryPath = memoryPath.replace(/^\//, '');
    console.log('[Memory API] DELETE /*', memoryPath);

    const store = getMemoryStore();

    try {
      // Note: Memory store doesn't have a delete method in the current implementation
      // This is a placeholder for future implementation
      return c.json({
        error: true,
        message: 'Delete operation not yet supported by memory store',
      }, 501);
    } catch (error) {
      console.error('[Memory API] Error deleting entry:', error);
      return c.json({
        error: true,
        message: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });
