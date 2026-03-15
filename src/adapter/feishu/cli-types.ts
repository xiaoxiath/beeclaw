/**
 * Feishu CLI Types
 *
 * Type definitions and converters for CLI responses
 */

import type { FeishuFile } from './tools/drive';
import type { FeishuWikiSpace, FeishuWikiNode } from './tools/wiki';
import type { FeishuCalendar, FeishuEvent } from './tools/calendar';

// ============================================================
// Drive Types
// ============================================================

export interface CLIFileResponse {
  token: string;
  name: string;
  type: string;
  size?: number;
  created_time?: string;
  modified_time?: string;
  parent_token?: string;
  owner_id?: string;
}

export interface CLIFileListResponse {
  files: CLIFileResponse[];
  has_more: boolean;
  page_token?: string;
}

export interface CLIFileUploadResponse {
  file_token: string;
}

/**
 * Convert CLI file response to FeishuFile type
 */
export function cliFileToFeishuFile(cliFile: CLIFileResponse): FeishuFile {
  return {
    token: cliFile.token,
    name: cliFile.name,
    type: cliFile.type as 'file' | 'folder',
    parent_token: cliFile.parent_token || '',
    size: cliFile.size,
    create_time: cliFile.created_time || '',
    modify_time: cliFile.modified_time || '',
    creator: cliFile.owner_id || '',
    modifier: cliFile.owner_id || '',
  };
}

// ============================================================
// Wiki Types
// ============================================================

export interface CLIWikiSpaceResponse {
  space_id: string;
  name: string;
  description?: string;
  create_time?: number;
  update_time?: number;
}

export interface CLIWikiSpacesResponse {
  spaces: CLIWikiSpaceResponse[];
  has_more?: boolean;
  page_token?: string;
}

export interface CLIWikiNodeResponse {
  node_token: string;
  obj_token: string;
  obj_type: string;
  title: string;
  parent_node_token?: string;
  space_id: string;
  create_time?: number;
  update_time?: number;
  has_child?: boolean;
}

export interface CLIWikiNodesResponse {
  nodes: CLIWikiNodeResponse[];
  has_more: boolean;
  page_token?: string;
}

/**
 * Convert CLI wiki space to FeishuWikiSpace type
 */
export function cliSpaceToFeishuSpace(cliSpace: CLIWikiSpaceResponse): FeishuWikiSpace {
  return {
    space_id: cliSpace.space_id,
    name: cliSpace.name,
    description: cliSpace.description,
    create_time: cliSpace.create_time ? new Date(cliSpace.create_time * 1000).toISOString() : '',
    modify_time: cliSpace.update_time ? new Date(cliSpace.update_time * 1000).toISOString() : '',
    creator: '',
    modifier: '',
  };
}

/**
 * Convert CLI wiki node to FeishuWikiNode type
 */
export function cliNodeToFeishuNode(cliNode: CLIWikiNodeResponse): FeishuWikiNode {
  return {
    node_token: cliNode.node_token,
    obj_token: cliNode.obj_token,
    obj_type: cliNode.obj_type as any,
    parent_node_token: cliNode.parent_node_token,
    space_id: cliNode.space_id,
    title: cliNode.title,
    create_time: cliNode.create_time ? new Date(cliNode.create_time * 1000).toISOString() : '',
    modify_time: cliNode.update_time ? new Date(cliNode.update_time * 1000).toISOString() : '',
    creator: '',
    modifier: '',
    has_child: cliNode.has_child || false,
    node_create_time: cliNode.create_time ? new Date(cliNode.create_time * 1000).toISOString() : '',
  };
}

// ============================================================
// Calendar Types
// ============================================================

export interface CLICalendarResponse {
  calendar_id: string;
  summary: string;
  description?: string;
  color?: number;
  role?: string;
}

export interface CLICalendarListResponse {
  calendars: CLICalendarResponse[];
}

export interface CLIEventResponse {
  event_id: string;
  summary: string;
  description?: string;
  start_time: string;
  end_time: string;
  status?: string;
  location?: string;
  attendees?: Array<{
    user_id: string;
    display_name?: string;
  }>;
}

export interface CLIEventListResponse {
  events: CLIEventResponse[];
  has_more?: boolean;
  page_token?: string;
}

/**
 * Convert CLI calendar to FeishuCalendar type
 */
export function cliCalendarToFeishuCalendar(cliCal: CLICalendarResponse): FeishuCalendar {
  return {
    calendar_id: cliCal.calendar_id,
    summary: cliCal.summary,
    description: cliCal.description,
    color: cliCal.color,
    role: cliCal.role as any,
  };
}

/**
 * Convert CLI event to FeishuEvent type
 */
export function cliEventToFeishuEvent(cliEvent: CLIEventResponse): FeishuEvent {
  return {
    event_id: cliEvent.event_id,
    summary: cliEvent.summary,
    description: cliEvent.description,
    start_time: cliEvent.start_time,
    end_time: cliEvent.end_time,
    status: cliEvent.status,
    location: cliEvent.location,
    attendees: cliEvent.attendees?.map(a => ({
      user_id: a.user_id,
      display_name: a.display_name,
    })),
  };
}

// ============================================================
// Document Types
// ============================================================

export interface CLIDocBlockResponse {
  block_id: string;
  block_type: number;
  document_id?: string;
  parent_id?: string;
  text?: {
    elements?: Array<{
      text_run?: {
        content: string;
      };
    }>;
  };
  children?: string[];
}

// ============================================================
// Bitable Types
// ============================================================

export interface CLIBitableResponse {
  app_token: string;
  name: string;
  revision?: number;
}

export interface CLIBitableTablesResponse {
  tables: Array<{
    table_id: string;
    name: string;
    revision?: number;
  }>;
}

export interface CLIBitableRecordsResponse {
  records: Array<{
    record_id: string;
    fields: Record<string, unknown>;
    created_time?: number;
    modified_time?: number;
  }>;
  has_more: boolean;
  page_token?: string;
}
