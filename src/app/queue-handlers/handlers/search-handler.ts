/**
 * Search Worker Handler
 *
 * Handles web search jobs
 */

import type { Job } from 'bunqueue/client';
import type { SearchJobData } from '../types';
import { webSearch } from '../../search';

export async function handleSearchJob(job: Job<SearchJobData>): Promise<unknown> {
  const { query, numResults, region, timeRange } = job.data;

  console.log(`[Worker:search] Processing search: "${query}"`);

  // Report progress
  await job.updateProgress(10);

  try {
    // Execute search
    const results = await webSearch(query, {
      numResults: numResults || 10,
      region: region as 'global' | 'cn' | 'us' | 'auto',
      timeRange: timeRange as 'day' | 'week' | 'month' | 'year',
    });

    await job.updateProgress(100);

    console.log(`[Worker:search] Search completed: ${results.length} results`);

    return {
      success: true,
      query,
      results,
      count: results.length,
    };
  } catch (error) {
    console.error(`[Worker:search] Search failed:`, error);
    throw error;
  }
}
