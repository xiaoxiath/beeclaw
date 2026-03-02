/**
 * Feishu Calendar Tools
 *
 * Tools for managing Feishu calendars and events
 */

import type { Client } from '@larksuiteoapi/node-sdk';
import { getLogger } from '../utils/logger';
import { z } from 'zod';

const logger = getLogger('feishu:calendar');

/**
 * Get calendar list
 */
export async function getCalendarList(
  client: Client,
  options?: {
    pageSize?: number;
    pageToken?: string;
  }
): Promise<{
  calendars: FeishuCalendar[];
  pageToken?: string;
  hasMore: boolean;
}> {
  try {
    const response = await client.calendar.calendar.list({
      params: {
        page_size: options?.pageSize || 50,
        page_token: options?.pageToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get calendar list: ${response.msg}`);
    }

    logger.info(`✅ Got ${response.data?.calendar_list?.length || 0} calendars`);
    return {
      calendars: response.data?.calendar_list || [],
      pageToken: response.data?.page_token,
      hasMore: response.data?.has_more || false,
    };
  } catch (error) {
    logger.error('Failed to get calendar list:', error);
    throw error;
  }
}

/**
 * Get calendar by ID
 */
export async function getCalendar(
  client: Client,
  calendarId: string
): Promise<FeishuCalendar> {
  try {
    const response = await client.calendar.calendar.get({
      path: {
        calendar_id: calendarId,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get calendar: ${response.msg}`);
    }

    logger.info(`✅ Got calendar: ${calendarId}`);
    return response.data as FeishuCalendar;
  } catch (error) {
    logger.error('Failed to get calendar:', error);
    throw error;
  }
}

/**
 * Create calendar event
 */
export async function createEvent(
  client: Client,
  calendarId: string,
  event: {
    summary: string;
    description?: string;
    startTime: string; // ISO 8601 format
    endTime: string; // ISO 8601 format
    timezone?: string;
    location?: string;
    attendees?: Array<{
        type: 'user' | 'group' | 'resource';
        id: string;
      }>;
    reminders?: Array<{
        minutes: number;
      }>;
    visibility?: 'default' | 'public' | 'private';
  }
): Promise<FeishuEvent> {
  try {
    const response = await client.calendar.calendarEvent.create({
      path: {
        calendar_id: calendarId,
      },
      params: {},
      data: {
        summary: event.summary,
        description: event.description,
        start_time: {
          date: event.startTime.includes('T') ? undefined : event.startTime,
          timestamp: event.startTime.includes('T') ? Math.floor(new Date(event.startTime).getTime() / 1000) : undefined,
        },
        end_time: {
          date: event.endTime.includes('T') ? undefined : event.endTime,
          timestamp: event.endTime.includes('T') ? Math.floor(new Date(event.endTime).getTime() / 1000) : undefined,
        },
        timezone: event.timezone || 'Asia/Shanghai',
        location: event.location,
        attendees: event.attendees?.map(a => ({
          type: a.type,
          member_id: a.id,
        })),
        reminders: event.reminders?.map(r => ({
          remind_offset: r.minutes,
        })),
        visibility: event.visibility || 'default',
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to create event: ${response.msg}`);
    }

    logger.info(`✅ Created event: ${response.data?.event_id}`);
    return response.data as FeishuEvent;
  } catch (error) {
    logger.error('Failed to create event:', error);
    throw error;
  }
}

/**
 * Get event by ID
 */
export async function getEvent(
  client: Client,
  calendarId: string,
  eventId: string
): Promise<FeishuEvent> {
  try {
    const response = await client.calendar.calendarEvent.get({
      path: {
        calendar_id: calendarId,
        event_id: eventId,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get event: ${response.msg}`);
    }

    logger.info(`✅ Got event: ${eventId}`);
    return response.data as FeishuEvent;
  } catch (error) {
    logger.error('Failed to get event:', error);
    throw error;
  }
}

/**
 * List events in time range
 */
export async function listEvents(
  client: Client,
  calendarId: string,
  options: {
    startTime: string; // Unix timestamp in seconds
    endTime: string; // Unix timestamp in seconds
    pageSize?: number;
    pageToken?: string;
  }
): Promise<{
  events: FeishuEvent[];
  pageToken?: string;
  hasMore: boolean;
}> {
  try {
    const response = await client.calendar.calendarEvent.list({
      path: {
        calendar_id: calendarId,
      },
      params: {
        start_time: options.startTime,
        end_time: options.endTime,
        page_size: options.pageSize || 50,
        page_token: options.pageToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to list events: ${response.msg}`);
    }

    logger.info(`✅ Listed ${response.data?.events?.length || 0} events`);
    return {
      events: response.data?.events || [],
      pageToken: response.data?.page_token,
      hasMore: response.data?.has_more || false,
    };
  } catch (error) {
    logger.error('Failed to list events:', error);
    throw error;
  }
}

/**
 * Update event
 */
export async function updateEvent(
  client: Client,
  calendarId: string,
  eventId: string,
  updates: Partial<{
    summary: string;
    description: string;
    startTime: string;
    endTime: string;
    timezone: string;
    location: string;
    attendees: Array<{
      type: 'user' | 'group' | 'resource';
      id: string;
    }>;
  }>
): Promise<FeishuEvent> {
  try {
    const data: Record<string, unknown> = {};

    if (updates.summary) data.summary = updates.summary;
    if (updates.description) data.description = updates.description;
    if (updates.location) data.location = updates.location;
    if (updates.timezone) data.timezone = updates.timezone;

    if (updates.startTime) {
      data.start_time = {
        timestamp: Math.floor(new Date(updates.startTime).getTime() / 1000),
      };
    }

    if (updates.endTime) {
      data.end_time = {
        timestamp: Math.floor(new Date(updates.endTime).getTime() / 1000),
      };
    }

    if (updates.attendees) {
      data.attendees = updates.attendees.map(a => ({
        type: a.type,
        member_id: a.id,
      }));
    }

    const response = await client.calendar.calendarEvent.patch({
      path: {
        calendar_id: calendarId,
        event_id: eventId,
      },
      params: {},
      data,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to update event: ${response.msg}`);
    }

    logger.info(`✅ Updated event: ${eventId}`);
    return response.data as FeishuEvent;
  } catch (error) {
    logger.error('Failed to update event:', error);
    throw error;
  }
}

/**
 * Delete event
 */
export async function deleteEvent(
  client: Client,
  calendarId: string,
  eventId: string
): Promise<void> {
  try {
    const response = await client.calendar.calendarEvent.delete({
      path: {
        calendar_id: calendarId,
        event_id: eventId,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to delete event: ${response.msg}`);
    }

    logger.info(`✅ Deleted event: ${eventId}`);
  } catch (error) {
    logger.error('Failed to delete event:', error);
    throw error;
  }
}

/**
 * Search events
 */
export async function searchEvents(
  client: Client,
  calendarId: string,
  query: string,
  options?: {
    startTime?: string;
    endTime?: string;
    pageSize?: number;
    pageToken?: string;
  }
): Promise<{
  events: FeishuEvent[];
  pageToken?: string;
  hasMore: boolean;
}> {
  try {
    const response = await client.calendar.calendarEvent.search({
      path: {
        calendar_id: calendarId,
      },
      params: {
        query,
        start_time: options?.startTime,
        end_time: options?.endTime,
        page_size: options?.pageSize || 50,
        page_token: options?.pageToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to search events: ${response.msg}`);
    }

    logger.info(`✅ Found ${response.data?.events?.length || 0} events for query: ${query}`);
    return {
      events: response.data?.events || [],
      pageToken: response.data?.page_token,
      hasMore: response.data?.has_more || false,
    };
  } catch (error) {
    logger.error('Failed to search events:', error);
    throw error;
  }
}

/**
 * Get today's events
 */
export async function getTodayEvents(
  client: Client,
  calendarId: string
): Promise<FeishuEvent[]> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const result = await listEvents(client, calendarId, {
    startTime: Math.floor(startOfDay.getTime() / 1000).toString(),
    endTime: Math.floor(endOfDay.getTime() / 1000).toString(),
  });

  return result.events;
}

/**
 * Create quick event (simplified interface)
 */
export async function createQuickEvent(
  client: Client,
  calendarId: string,
  summary: string,
  duration: number = 60, // minutes
  options?: {
    description?: string;
    location?: string;
    offsetMinutes?: number; // start in X minutes from now
  }
): Promise<FeishuEvent> {
  const now = new Date();
  const startTime = new Date(now.getTime() + (options?.offsetMinutes || 0) * 60 * 1000);
  const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

  return await createEvent(client, calendarId, {
    summary,
    description: options?.description,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    location: options?.location,
  });
}

// ============================================================
// Tool Definitions
// ============================================================

export const calendarToolDefinitions = {
  feishu_calendar_list: {
    name: 'feishu_calendar_list',
    description: 'List all calendars the user has access to',
    parameters: {
      type: 'object' as const,
      properties: {
        pageSize: {
          type: 'number',
          description: 'Number of calendars per page (default: 50)',
        },
      },
      required: [],
    },
  },

  feishu_calendar_get: {
    name: 'feishu_calendar_get',
    description: 'Get calendar details by ID',
    parameters: {
      type: 'object' as const,
      properties: {
        calendarId: {
          type: 'string',
          description: 'Calendar ID',
        },
      },
      required: ['calendarId'],
    },
  },

  feishu_calendar_event_create: {
    name: 'feishu_calendar_event_create',
    description: 'Create a new calendar event',
    parameters: {
      type: 'object' as const,
      properties: {
        calendarId: {
          type: 'string',
          description: 'Calendar ID',
        },
        summary: {
          type: 'string',
          description: 'Event title',
        },
        description: {
          type: 'string',
          description: 'Event description',
        },
        startTime: {
          type: 'string',
          description: 'Start time (ISO 8601 format, e.g., "2024-01-15T10:00:00")',
        },
        endTime: {
          type: 'string',
          description: 'End time (ISO 8601 format, e.g., "2024-01-15T11:00:00")',
        },
        timezone: {
          type: 'string',
          description: 'Timezone (default: Asia/Shanghai)',
        },
        location: {
          type: 'string',
          description: 'Event location',
        },
      },
      required: ['calendarId', 'summary', 'startTime', 'endTime'],
    },
  },

  feishu_calendar_event_list: {
    name: 'feishu_calendar_event_list',
    description: 'List events in a time range',
    parameters: {
      type: 'object' as const,
      properties: {
        calendarId: {
          type: 'string',
          description: 'Calendar ID',
        },
        startTime: {
          type: 'string',
          description: 'Start time (ISO 8601 format)',
        },
        endTime: {
          type: 'string',
          description: 'End time (ISO 8601 format)',
        },
        pageSize: {
          type: 'number',
          description: 'Number of events per page (default: 50)',
        },
      },
      required: ['calendarId', 'startTime', 'endTime'],
    },
  },

  feishu_calendar_event_get: {
    name: 'feishu_calendar_event_get',
    description: 'Get event details by ID',
    parameters: {
      type: 'object' as const,
      properties: {
        calendarId: {
          type: 'string',
          description: 'Calendar ID',
        },
        eventId: {
          type: 'string',
          description: 'Event ID',
        },
      },
      required: ['calendarId', 'eventId'],
    },
  },

  feishu_calendar_event_update: {
    name: 'feishu_calendar_event_update',
    description: 'Update an existing event',
    parameters: {
      type: 'object' as const,
      properties: {
        calendarId: {
          type: 'string',
          description: 'Calendar ID',
        },
        eventId: {
          type: 'string',
          description: 'Event ID',
        },
        summary: {
          type: 'string',
          description: 'Event title',
        },
        description: {
          type: 'string',
          description: 'Event description',
        },
        startTime: {
          type: 'string',
          description: 'Start time (ISO 8601 format)',
        },
        endTime: {
          type: 'string',
          description: 'End time (ISO 8601 format)',
        },
        location: {
          type: 'string',
          description: 'Event location',
        },
      },
      required: ['calendarId', 'eventId'],
    },
  },

  feishu_calendar_event_delete: {
    name: 'feishu_calendar_event_delete',
    description: 'Delete an event',
    parameters: {
      type: 'object' as const,
      properties: {
        calendarId: {
          type: 'string',
          description: 'Calendar ID',
        },
        eventId: {
          type: 'string',
          description: 'Event ID',
        },
      },
      required: ['calendarId', 'eventId'],
    },
  },

  feishu_calendar_event_search: {
    name: 'feishu_calendar_event_search',
    description: 'Search events by keyword',
    parameters: {
      type: 'object' as const,
      properties: {
        calendarId: {
          type: 'string',
          description: 'Calendar ID',
        },
        query: {
          type: 'string',
          description: 'Search query',
        },
        startTime: {
          type: 'string',
          description: 'Start time (ISO 8601 format)',
        },
        endTime: {
          type: 'string',
          description: 'End time (ISO 8601 format)',
        },
      },
      required: ['calendarId', 'query'],
    },
  },

  feishu_calendar_today: {
    name: 'feishu_calendar_today',
    description: 'Get today\'s events',
    parameters: {
      type: 'object' as const,
      properties: {
        calendarId: {
          type: 'string',
          description: 'Calendar ID',
        },
      },
      required: ['calendarId'],
    },
  },

  feishu_calendar_quick_event: {
    name: 'feishu_calendar_quick_event',
    description: 'Create a quick event starting now or in X minutes',
    parameters: {
      type: 'object' as const,
      properties: {
        calendarId: {
          type: 'string',
          description: 'Calendar ID',
        },
        summary: {
          type: 'string',
          description: 'Event title',
        },
        duration: {
          type: 'number',
          description: 'Duration in minutes (default: 60)',
        },
        offsetMinutes: {
          type: 'number',
          description: 'Start in X minutes from now (default: 0)',
        },
        location: {
          type: 'string',
          description: 'Event location',
        },
        description: {
          type: 'string',
          description: 'Event description',
        },
      },
      required: ['calendarId', 'summary'],
    },
  },
};

/**
 * Execute calendar tool
 */
export async function executeCalendarTool(
  client: Client,
  name: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case 'feishu_calendar_list': {
        const parsed = z.object({
          pageSize: z.number().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const result = await getCalendarList(client, parsed.data);
        return {
          success: true,
          data: {
            calendars: result.calendars,
            hasMore: result.hasMore,
          },
        };
      }

      case 'feishu_calendar_get': {
        const parsed = z.object({
          calendarId: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const calendar = await getCalendar(client, parsed.data.calendarId);
        return { success: true, data: calendar };
      }

      case 'feishu_calendar_event_create': {
        const parsed = z.object({
          calendarId: z.string(),
          summary: z.string(),
          description: z.string().optional(),
          startTime: z.string(),
          endTime: z.string(),
          timezone: z.string().optional(),
          location: z.string().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const event = await createEvent(client, parsed.data.calendarId, parsed.data);
        return { success: true, data: event };
      }

      case 'feishu_calendar_event_list': {
        const parsed = z.object({
          calendarId: z.string(),
          startTime: z.string(),
          endTime: z.string(),
          pageSize: z.number().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const startTime = Math.floor(new Date(parsed.data.startTime).getTime() / 1000).toString();
        const endTime = Math.floor(new Date(parsed.data.endTime).getTime() / 1000).toString();

        const result = await listEvents(client, parsed.data.calendarId, {
          startTime,
          endTime,
          pageSize: parsed.data.pageSize,
        });
        return {
          success: true,
          data: {
            events: result.events,
            hasMore: result.hasMore,
          },
        };
      }

      case 'feishu_calendar_event_get': {
        const parsed = z.object({
          calendarId: z.string(),
          eventId: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const event = await getEvent(client, parsed.data.calendarId, parsed.data.eventId);
        return { success: true, data: event };
      }

      case 'feishu_calendar_event_update': {
        const parsed = z.object({
          calendarId: z.string(),
          eventId: z.string(),
          summary: z.string().optional(),
          description: z.string().optional(),
          startTime: z.string().optional(),
          endTime: z.string().optional(),
          location: z.string().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const event = await updateEvent(
          client,
          parsed.data.calendarId,
          parsed.data.eventId,
          parsed.data
        );
        return { success: true, data: event };
      }

      case 'feishu_calendar_event_delete': {
        const parsed = z.object({
          calendarId: z.string(),
          eventId: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        await deleteEvent(client, parsed.data.calendarId, parsed.data.eventId);
        return { success: true, data: { deleted: true } };
      }

      case 'feishu_calendar_event_search': {
        const parsed = z.object({
          calendarId: z.string(),
          query: z.string(),
          startTime: z.string().optional(),
          endTime: z.string().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const startTime = parsed.data.startTime
          ? Math.floor(new Date(parsed.data.startTime).getTime() / 1000).toString()
          : undefined;
        const endTime = parsed.data.endTime
          ? Math.floor(new Date(parsed.data.endTime).getTime() / 1000).toString()
          : undefined;

        const result = await searchEvents(client, parsed.data.calendarId, parsed.data.query, {
          startTime,
          endTime,
        });
        return {
          success: true,
          data: {
            events: result.events,
            hasMore: result.hasMore,
          },
        };
      }

      case 'feishu_calendar_today': {
        const parsed = z.object({
          calendarId: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const events = await getTodayEvents(client, parsed.data.calendarId);
        return { success: true, data: { events } };
      }

      case 'feishu_calendar_quick_event': {
        const parsed = z.object({
          calendarId: z.string(),
          summary: z.string(),
          duration: z.number().optional(),
          offsetMinutes: z.number().optional(),
          location: z.string().optional(),
          description: z.string().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const event = await createQuickEvent(
          client,
          parsed.data.calendarId,
          parsed.data.summary,
          parsed.data.duration,
          parsed.data
        );
        return { success: true, data: event };
      }

      default:
        return { success: false, error: `Unknown calendar tool: ${name}` };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================
// Types
// ============================================================

export interface FeishuCalendar {
  calendar_id: string;
  summary: string;
  description?: string;
  permissions?: string;
  color?: number;
  timezone?: string;
  is_sign?: boolean;
  role?: string;
}

export interface FeishuEvent {
  event_id: string;
  summary: string;
  description?: string;
  start_time: {
    date?: string;
    timestamp?: number;
  };
  end_time: {
    date?: string;
    timestamp?: number;
  };
  timezone?: string;
  location?: string;
  organizer?: {
    type: string;
    id: string;
  };
  attendees?: Array<{
    type: string;
    member_id: string;
    display_name?: string;
    status?: string;
  }>;
  visibility?: string;
  status?: string;
  create_time?: number;
  update_time?: number;
}
