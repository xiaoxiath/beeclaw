/**
 * Feishu Bitable (Multidimensional Table) Tools
 *
 * Tools for managing Feishu Bitable (多维表格)
 */

import type { Client } from '@larksuiteoapi/node-sdk';
import { getLogger } from '../utils/logger';
import { z } from 'zod';

const logger = getLogger('feishu:bitable');

// Field type mapping
const FIELD_TYPE_MAP: Record<string, number> = {
  'text': 1,
  'number': 2,
  'singleSelect': 3,
  'multiSelect': 4,
  'dateTime': 5,
  'checkbox': 7,
  'user': 11,
  'phone': 13,
  'url': 15,
  'attachment': 17,
  'singleLink': 18,
  'lookup': 19,
  'formula': 20,
  'duplexLink': 21,
  'location': 22,
  'groupChat': 23,
  'createdTime': 1001,
  'modifiedTime': 1002,
  'createdUser': 1003,
  'modifiedUser': 1004,
  'autoNumber': 1005,
};

const FIELD_TYPE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(FIELD_TYPE_MAP).map(([k, v]) => [v, k])
);

/**
 * Parse Bitable URL to extract app_token and table_id
 */
export function parseBitableUrl(url: string): {
    app_token: string;
    table_id: string | null;
    view_id: string | null;
  } {

    // Pattern 1: /base/XXXXX?table=YYY
    const baseMatch = url.match(/\/base\/([^?]+)\?table=([^&]+)/);
    if (baseMatch) {
      app_token = baseMatch[1];
      table_id = baseMatch[2];
      return { app_token, table_id };
    }

    // Pattern 2: /wiki/XXXXX?table=YYY
    const wikiMatch = url.match(/\/wiki\/([^?]+)\?table=([^&]+)/);
    if (wikiMatch) {
      const nodeToken = wikiMatch[1];
      table_id = wikiMatch[2];

      // Note: Need to resolve node_token to obj_token
      // For now, return as-is (caller should handle conversion)
      return { app_token: nodeToken, table_id, table_id };
    }

    return null;
  } catch (error) {
    logger.error('Failed to parse Bitable URL:', error);
    return null;
  }
}

/**
 * Get Bitable metadata
 */
export async function getBitableMeta(
  client: Client,
  appToken: string
): Promise<FeishuBitable> {
  try {
    const response = await client.bitable.app.get({
      path: {
        app_token: appToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get Bitable: ${response.msg}`);
    }

    logger.info(`✅ Got Bitable: ${appToken}`);
    return response.data as FeishuBitable;
  } catch (error) {
    logger.error('Failed to get Bitable:', error);
    throw error;
  }
}

/**
 * List tables in Bitable
 */
export async function listTables(
  client: Client,
  appToken: string
): Promise<FeishuTable[]> {
  try {
    const response = await client.bitable.appTable.list({
      path: {
        app_token: appToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to list tables: ${response.msg}`);
    }

    logger.info(`✅ Listed ${response.data?.items?.length || 0} tables`);
    return response.data?.items || [];
  } catch (error) {
    logger.error('Failed to list tables:', error);
    throw error;
  }
}

/**
 * Get table metadata
 */
export async function getTableMeta(
  client: Client,
  appToken: string,
  tableId: string
): Promise<FeishuTable> {
  try {
    const response = await client.bitable.appTable.get({
      path: {
        app_token: appToken,
        table_id: tableId,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get table: ${response.msg}`);
    }

    logger.info(`✅ Got table: ${tableId}`);
    return response.data as FeishuTable;
  } catch (error) {
    logger.error('Failed to get table:', error);
    throw error;
  }
}

/**
 * List fields in table
 */
export async function listFields(
  client: Client,
  appToken: string,
  tableId: string
): Promise<FeishuField[]> {
  try {
    const response = await client.bitable.appTableField.list({
      path: {
        app_token: appToken,
        table_id: tableId,
      },
    });

    if (response.code !== 0) {
        throw new Error(`Failed to list fields: ${response.msg}`);
    }

    logger.info(`✅ Listed ${response.data?.items?.length || 0} fields`);
    return response.data?.items || [];
  } catch (error) {
    logger.error('Failed to list fields:', error);
    throw error;
  }
}

/**
 * Create field
 */
export async function createField(
  client: Client,
  appToken: string,
  tableId: string,
  field: {
    fieldName: string;
    type: number;
    property?: Record<string, unknown>;
  }
): Promise<FeishuField> {
  try {
    const response = await client.bitable.appTableField.create({
      path: {
        app_token: appToken,
        table_id: tableId,
      },
      data: {
        field_name: field.fieldName,
        type: field.type,
        property: field.property,
      },
    });

    if (response.code !== 0) {
        throw new Error(`Failed to create field: ${response.msg}`);
    }

    logger.info(`✅ Created field: ${field.fieldName}`);
    return response.data as FeishuField;
  } catch (error) {
    logger.error('Failed to create field:', error);
    throw error;
  }
}

/**
 * List records in table
 */
export async function listRecords(
  client: Client,
  appToken: string,
  tableId: string,
  options?: {
    pageSize?: number;
    pageToken?: string;
    viewId?: string;
    fieldNames?: string[];
    filter?: string;
    sort?: Array<{
    fieldName: string;
    desc: 'ASC' | 'DESC';
  }>;
  }
): Promise<{
  records: FeishuRecord[];
  pageToken?: string;
  hasMore: boolean;
  total?: number;
}> {
  try {
    const response = await client.bitable.appTableRecord.list({
      path: {
        app_token: appToken,
        table_id: tableId,
      },
      params: {
        page_size: options?.pageSize || 50,
        page_token: options?.pageToken,
        view_id: options?.viewId,
        field_names: options?.fieldNames?.join(','),
        filter: options?.filter,
        sort: options?.sort?.map(s => `${s.fieldName} ${s.desc}`).join(','),
      },
    });

    if (response.code !== 0) {
        throw new Error(`Failed to list records: ${response.msg}`);
    }

    logger.info(`✅ Listed ${response.data?.items?.length || 0} records`);
    return {
      records: response.data?.items || [],
      pageToken: response.data?.page_token,
      hasMore: response.data?.has_more || false,
      total: response.data?.total,
    };
  } catch (error) {
    logger.error('Failed to list records:', error);
    throw error;
  }
}

/**
 * Get record
 */
export async function getRecord(
  client: Client,
  appToken: string,
  tableId: string,
  recordId: string
): Promise<FeishuRecord> {
  try {
    const response = await client.bitable.appTableRecord.get({
      path: {
        app_token: appToken,
        table_id: tableId,
        record_id: recordId,
      },
    });

    if (response.code !== 0) {
        throw new Error(`Failed to get record: ${response.msg}`);
    }

    logger.info(`✅ Got record: ${recordId}`);
    return response.data as FeishuRecord;
  } catch (error) {
    logger.error('Failed to get record:', error);
    throw error;
  }
}

/**
 * Create record
 */
export async function createRecord(
  client: Client,
  appToken: string,
  tableId: string,
  fields: Record<string, unknown>
): Promise<FeishuRecord> {
  try {
    const response = await client.bitable.appTableRecord.create({
      path: {
        app_token: appToken,
        table_id: tableId,
      },
      data: {
        fields,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to create record: ${response.msg}`);
    }

    logger.info(`✅ Created record`);
    return response.data as FeishuRecord;
  } catch (error) {
    logger.error('Failed to create record:', error);
    throw error;
  }
}

/**
 * Update record
 */
export async function updateRecord(
  client: Client,
  appToken: string,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>
): Promise<FeishuRecord> {
  try {
    const response = await client.bitable.appTableRecord.put({
      path: {
        app_token: appToken,
        table_id: tableId,
        record_id: recordId,
      },
      data: {
        fields,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to update record: ${response.msg}`);
    }

    logger.info(`✅ Updated record: ${recordId}`);
    return response.data as FeishuRecord;
  } catch (error) {
    logger.error('Failed to update record:', error);
    throw error;
  }
}

/**
 * Delete record
 */
export async function deleteRecord(
  client: Client,
  appToken: string,
  tableId: string,
  recordId: string
): Promise<void> {
  try {
    const response = await client.bitable.appTableRecord.delete({
      path: {
        app_token: appToken,
        table_id: tableId,
        record_id: recordId,
      },
    });

    if (response.code !== 0) {
        throw new Error(`Failed to delete record: ${response.msg}`);
    }

    logger.info(`✅ Deleted record: ${recordId}`);
  } catch (error) {
    logger.error('Failed to delete record:', error);
    throw error;
  }
}

/**
 * Create new Bitable
 */
export async function createBitable(
  client: Client,
  options: {
    name: string;
    folderToken?: string;
  }
): Promise<FeishuBitable> {
  try {
    const response = await client.bitable.app.create({
      params: {
        name: options.name,
        folder_token: options.folderToken,
      },
    });

    if (response.code !== 0) {
      throw new Error(`Failed to create Bitable: ${response.msg}`);
    }

    const bitable = response.data as FeishuBitable;
    logger.info(`✅ Created Bitable: ${options.name}`);

    // Cleanup default fields and    await cleanupNewBitable(client, bitable.app.token);

    return bitable;
  } catch (error) {
    logger.error('Failed to create Bitable:', error);
    throw error;
  }
}

/**
 * Cleanup default fields in new Bitable
 */
async function cleanupNewBitable(
  client: Client,
  appToken: string
): Promise<void> {
  try {
    const tables = await listTables(client, appToken);

    for (const table of tables) {
      const fields = await listFields(client, appToken, table.table_id);

      // Find and delete default placeholder fields
      const defaultFields = fields.filter(f =>
        f.field_name === '多选' ||
        f.field_name === '日期' ||
        f.field_name === '附件' ||
        f.field_name.includes('文本')
      );

      for (const field of defaultFields) {
        try {
          await client.bitable.appTableField.delete({
            path: {
                app_token: appToken,
                table_id: table.table_id,
                field_id: field.field_id,
              },
          });
          logger.info(`  Cleaned up field: ${field.field_name}`);
        } catch (error) {
          logger.warn(`  Failed to delete field ${field.field_name}:`, error);
        }
      }

      // Delete empty records
      const records = await listRecords(client, appToken, table.table_id, { pageSize: 100 });
      const emptyRecords = records.filter(r => {
        return Object.values(r.fields || {}).every(v => !v || v v === '');
      });

      for (const record of emptyRecords) {
        try {
          await deleteRecord(client, appToken, table.table_id, record.record_id);
          logger.info(`  Deleted empty record`);
        } catch (error) {
          logger.warn(`  Failed to delete empty record:`, error);
        }
      }
    }
  } catch (error) {
    logger.warn('Failed to cleanup new Bitable:', error);
  }
}

// ============================================================
// Tool Definitions
// ============================================================

export const bitableToolDefinitions = {
  feishu_bitable_get_meta: {
    name: 'feishu_bitable_get_meta',
    description: 'Parse Bitable URL to get app_token and table_id',
    parameters: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'Bitable URL (e.g., https://xxx.feishu.cn/base/XXXXX?table=YYY)',
        },
      },
      required: ['url'],
    },
  },

  feishu_bitable_list_tables: {
    name: 'feishu_bitable_list_tables',
    description: 'List all tables in Bitable',
    parameters: {
      type: 'object' as const,
      properties: {
        appToken: {
          type: 'string',
          description: 'Bitable app token',
        },
      },
      required: ['appToken'],
    },
  },

  feishu_bitable_list_fields: {
    name: 'feishu_bitable_list_fields',
    description: 'List all fields (columns) in table',
    parameters: {
      type: 'object' as const,
      properties: {
        appToken: {
          type: 'string',
          description: 'Bitable app token',
        },
        tableId: {
          type: 'string',
          description: 'Table ID',
        },
      },
      required: ['appToken', 'tableId'],
    },
  },

  feishu_bitable_create_field: {
    name: 'feishu_bitable_create_field',
    description: 'Create a new field (column)',
    parameters: {
      type: 'object' as const,
      properties: {
        appToken: {
          type: 'string',
          description: 'Bitable app token',
        },
        tableId: {
          type: 'string',
          description: 'Table ID',
        },
        fieldName: {
          type: 'string',
          description: 'Field name',
        },
        type: {
          type: 'number',
          description: 'Field type (1=Text, 2=Number, 3=SingleSelect, 4=MultiSelect, 5=DateTime, 7=Checkbox, 11=User, etc.)',
        },
      },
      required: ['appToken', 'tableId', 'fieldName', 'type'],
    },
  },

  feishu_bitable_list_records: {
    name: 'feishu_bitable_list_records',
    description: 'List records (rows) in table',
    parameters: {
      type: 'object' as const,
      properties: {
        appToken: {
          type: 'string',
          description: 'Bitable app token',
        },
        tableId: {
          type: 'string',
          description: 'Table ID',
        },
        pageSize: {
          type: 'number',
          description: 'Number of records per page (default: 50)',
        },
        filter: {
          type: 'string',
          description: 'Filter condition',
        },
      },
      required: ['appToken', 'tableId'],
    },
  },

  feishu_bitable_get_record: {
    name: 'feishu_bitable_get_record',
    description: 'Get a single record by ID',
    parameters: {
      type: 'object' as const,
      properties: {
        appToken: {
          type: 'string',
          description: 'Bitable app token',
        },
        tableId: {
          type: 'string',
          description: 'Table ID',
        },
        recordId: {
          type: 'string',
          description: 'Record ID',
        },
      },
      required: ['appToken', 'tableId', 'recordId'],
    },
  },

  feishu_bitable_create_record: {
    name: 'feishu_bitable_create_record',
    description: 'Create a new record (row)',
    parameters: {
      type: 'object' as const,
      properties: {
        appToken: {
          type: 'string',
          description: 'Bitable app token',
        },
        tableId: {
          type: 'string',
          description: 'Table ID',
        },
        fields: {
          type: 'object',
          description: 'Field values (e.g., {"字段名": "值"})',
        },
      },
      required: ['appToken', 'tableId', 'fields'],
    },
  },

  feishu_bitable_update_record: {
    name: 'feishu_bitable_update_record',
    description: 'Update an existing record',
    parameters: {
      type: 'object' as const,
      properties: {
        appToken: {
          type: 'string',
          description: 'Bitable app token',
        },
        tableId: {
          type: 'string',
          description: 'Table ID',
        },
        recordId: {
          type: 'string',
          description: 'Record ID',
        },
        fields: {
          type: 'object',
          description: 'Updated field values',
        },
      },
      required: ['appToken', 'tableId', 'recordId', 'fields'],
    },
  },

  feishu_bitable_delete_record: {
    name: 'feishu_bitable_delete_record',
    description: 'Delete a record',
    parameters: {
      type: 'object' as const,
      properties: {
        appToken: {
          type: 'string',
          description: 'Bitable app token',
        },
        tableId: {
          type: 'string',
          description: 'Table ID',
        },
        recordId: {
          type: 'string',
          description: 'Record ID',
        },
      },
      required: ['appToken', 'tableId', 'recordId'],
    },
  },

  feishu_bitable_create_app: {
    name: 'feishu_bitable_create_app',
    description: 'Create a new Bitable (with cleanup)',
    parameters: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Bitable name',
        },
        folderToken: {
          type: 'string',
          description: 'Parent folder token (optional)',
        },
      },
      required: ['name'],
    },
  },
};

/**
 * Execute Bitable tool
 */
export async function executeBitableTool(
  client: Client,
  name: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    switch (name) {
      case 'feishu_bitable_get_meta': {
        const parsed = z.object({
          url: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const result = parseBitableUrl(parsed.data.url);
        if (!result) {
          return { success: false, error: 'Invalid Bitable URL' };
        }

        const meta = await getBitableMeta(client, result.app_token);
        return {
          success: true,
          data: {
            appToken: result.app_token,
            tableId: result.table_id,
            name: meta.name,
          },
        };
      }

      case 'feishu_bitable_list_tables': {
        const parsed = z.object({
          appToken: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const tables = await listTables(client, parsed.data.appToken);
        return { success: true, data: { tables } };
      }

      case 'feishu_bitable_list_fields': {
        const parsed = z.object({
          appToken: z.string(),
          tableId: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const fields = await listFields(
          client,
          parsed.data.appToken,
          parsed.data.tableId
        );
        return { success: true, data: { fields } };
      }

      case 'feishu_bitable_create_field': {
        const parsed = z.object({
          appToken: z.string(),
          tableId: z.string(),
          fieldName: z.string(),
          type: z.number(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const field = await createField(
          client,
          parsed.data.appToken,
          parsed.data.tableId,
          {
            fieldName: parsed.data.fieldName,
            type: parsed.data.type,
          }
        );
        return { success: true, data: field };
      }

      case 'feishu_bitable_list_records': {
        const parsed = z.object({
          appToken: z.string(),
          tableId: z.string(),
          pageSize: z.number().optional(),
          filter: z.string().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const result = await listRecords(
          client,
          parsed.data.appToken,
          parsed.data.tableId,
          {
            pageSize: parsed.data.pageSize,
            filter: parsed.data.filter,
          }
        );
        return {
          success: true,
          data: {
            records: result.records,
            hasMore: result.hasMore,
            total: result.total,
          },
        };
      }

      case 'feishu_bitable_get_record': {
        const parsed = z.object({
          appToken: z.string(),
          tableId: z.string(),
          recordId: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const record = await getRecord(
          client,
          parsed.data.appToken,
          parsed.data.tableId,
          parsed.data.recordId
        );
        return { success: true, data: record };
      }

      case 'feishu_bitable_create_record': {
        const parsed = z.object({
          appToken: z.string(),
          tableId: z.string(),
          fields: z.record(z.unknown),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const record = await createRecord(
          client,
          parsed.data.appToken,
          parsed.data.tableId,
          parsed.data.fields
        );
        return { success: true, data: record };
      }

      case 'feishu_bitable_update_record': {
        const parsed = z.object({
          appToken: z.string(),
          tableId: z.string(),
          recordId: z.string(),
          fields: z.record(z.unknown),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const record = await updateRecord(
          client,
          parsed.data.appToken,
          parsed.data.tableId,
          parsed.data.recordId,
          parsed.data.fields
        );
        return { success: true, data: record };
      }

      case 'feishu_bitable_delete_record': {
        const parsed = z.object({
          appToken: z.string(),
          tableId: z.string(),
          recordId: z.string(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        await deleteRecord(
          client,
          parsed.data.appToken,
          parsed.data.tableId,
          parsed.data.recordId
        );
        return { success: true, data: { deleted: true } };
      }

      case 'feishu_bitable_create_app': {
        const parsed = z.object({
          name: z.string(),
          folderToken: z.string().optional(),
        }).safeParse(params);

        if (!parsed.success) {
          return { success: false, error: parsed.error.message };
        }

        const bitable = await createBitable(client, parsed.data);
        return { success: true, data: bitable };
      }

      default:
        return { success: false, error: `Unknown Bitable tool: ${name}` };
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

export interface FeishuBitable {
  app: {
    token: string;
    name: string;
    revision: number;
    is_advanced: boolean;
  };
  table: {
    table_id: string;
    name: string;
    revision: number;
  }[];
}

export interface FeishuTable {
  table_id: string;
  name: string;
  revision: number;
  created_time: number;
  modified_time: number;
}

export interface FeishuField {
  field_id: string;
  field_name: string;
  type: number;
  property: Record<string, unknown>;
  created_time: number;
  modified_time: number;
}

export interface FeishuRecord {
  record_id: string;
  fields: Record<string, unknown>;
  created_time: number;
  modified_time: number;
  created_by: string;
  modified_by: string;
}
