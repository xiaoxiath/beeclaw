/**
 * Manifest Parser - 清单解析器
 *
 * 职责：
 * - 解析 openclaw.plugin.json 文件
 * - 校验清单结构（使用 JSON Schema）
 * - 校验插件配置（使用插件声明的 configSchema）
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import Ajv from "ajv";

export type PluginKind = "tool" | "channel" | "memory" | "provider" | "general";

export interface PluginManifest {
  id: string;                          // [必需] 全局唯一标识
  name?: string;                       // 显示名称
  description?: string;                // 功能描述
  version?: string;                    // 语义化版本
  kind?: PluginKind;                   // 插件类型
  configSchema?: Record<string, any>;  // JSON Schema 配置定义
  channels?: string[];                 // 声明支持的频道 ID
  providers?: string[];                // 声明提供的 Provider ID
  skills?: string[];                   // 声明提供的 Skill 名称
  uiHints?: {
    category?: string;
    icon?: string;
    homepage?: string;
  };
}

export interface ManifestLoadResult {
  ok: true;
  manifest: PluginManifest;
  manifestPath: string;
}

export interface ManifestLoadError {
  ok: false;
  error: string;
  manifestPath: string;
}

export type ManifestLoadOutcome = ManifestLoadResult | ManifestLoadError;

export interface ConfigValidationResult {
  valid: boolean;
  errors?: string;
}

const PLUGIN_MANIFEST_FILENAME = "openclaw.plugin.json";

// 创建 AJV 实例
const ajv = new Ajv({ allErrors: true, strict: false });

// 清单自身的 JSON Schema
const manifestSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$" },
    name: { type: "string" },
    description: { type: "string" },
    version: { type: "string" },
    kind: {
      type: "string",
      enum: ["tool", "channel", "memory", "provider", "general"],
    },
    configSchema: { type: "object" },
    channels: { type: "array", items: { type: "string" } },
    providers: { type: "array", items: { type: "string" } },
    skills: { type: "array", items: { type: "string" } },
    uiHints: {
      type: "object",
      properties: {
        category: { type: "string" },
        icon: { type: "string" },
        homepage: { type: "string" },
      },
    },
  },
  additionalProperties: false,
};

const validateManifestSchema = ajv.compile(manifestSchema);

/**
 * 从插件根目录加载并校验清单
 */
export function loadPluginManifest(rootDir: string): ManifestLoadOutcome {
  const manifestPath = join(rootDir, PLUGIN_MANIFEST_FILENAME);

  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      error: `Manifest not found: ${manifestPath}`,
      manifestPath,
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON in ${manifestPath}: ${error}`,
      manifestPath,
    };
  }

  // 校验清单结构
  if (!validateManifestSchema(raw)) {
    const errors = ajv.errorsText(validateManifestSchema.errors);
    return {
      ok: false,
      error: `Invalid manifest schema: ${errors}`,
      manifestPath,
    };
  }

  return {
    ok: true,
    manifest: raw as PluginManifest,
    manifestPath,
  };
}

/**
 * 使用插件声明的 configSchema 校验用户提供的配置
 */
export function validatePluginConfig(
  manifest: PluginManifest,
  config: Record<string, any>
): ConfigValidationResult {
  if (!manifest.configSchema) {
    return { valid: true };
  }

  const validate = ajv.compile(manifest.configSchema);
  const valid = validate(config);

  if (!valid) {
    return {
      valid: false,
      errors: ajv.errorsText(validate.errors),
    };
  }

  return { valid: true };
}
