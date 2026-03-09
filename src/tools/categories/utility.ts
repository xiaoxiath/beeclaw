/**
 * Utility tools (time, calc, weather, QR, URL, etc.)
 *
 * Re-export from builtin.ts for modular imports.
 * Usage: import { webSearchTool } from '../tools/categories/search';
 */
export {
  timeTool,
  executeTime,
  calcTool,
  executeCalc,
  weatherTool,
  executeWeather,
  urlShortenTool,
  executeUrlShorten,
  qrCodeTool,
  executeQrCode,
  QrCodeSchema,
  beeclawInfoTool,
  executeBeeclawInfo,
  codeExecuteTool,
  executeCode,
  claudeCodeTool,
  executeClaudeCode,
  ClaudeCodeSchema
} from '../builtin';
