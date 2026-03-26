/**
 * Finance Tools — Stock Quote, History, Financial, Info
 *
 * Extracted from builtin.ts for modular organization.
 */

import { z } from 'zod';
import {
  getFinanceOrchestrator,
} from './categories/finance';
import type { BuiltinToolResult } from './builtin';

// ============================================================================
// Stock Quote Tool (Finance Data)
// ============================================================================

export const StockQuoteSchema = z.object({
  symbol: z.string().describe('股票代码，如 600000, sh600000, sh.600000'),
  symbols: z.array(z.string()).optional().describe('批量查询股票代码列表'),
});

export const stockQuoteTool = {
  name: 'stock_quote',
  description: '获取A股实时行情。支持单个或批量查询，返回价格、涨跌幅、成交量等信息。',
  parameters: {
    type: 'object' as const,
    properties: {
      symbol: {
        type: 'string',
        description: '股票代码，如 600000, sh600000, sh.600000',
      },
      symbols: {
        type: 'array',
        items: { type: 'string' },
        description: '批量查询股票代码列表',
      },
    },
    required: ['symbol'],
  },
};

export async function executeStockQuote(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = StockQuoteSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { symbol, symbols } = parsed.data;

  try {
    const orchestrator = getFinanceOrchestrator();
    const quotes = await orchestrator.getQuote({ symbol, symbols });

    if (quotes.length === 0) {
      return { success: false, error: `未找到股票: ${symbol}` };
    }

    const formatted = quotes.map(q => {
      const changeIcon = q.change >= 0 ? '📈' : '📉';
      return `${changeIcon} **${q.symbol}** ${q.name}
   当前: ¥${q.price.toFixed(2)} ${q.change >= 0 ? '+' : ''}${q.change.toFixed(2)} (${q.change >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%)
   今开: ¥${q.open.toFixed(2)} 昨收: ¥${q.preClose.toFixed(2)}
   最高: ¥${q.high.toFixed(2)} 最低: ¥${q.low.toFixed(2)}
   成交量: ${(q.volume / 10000).toFixed(2)}万手 成交额: ${(q.amount / 100000000).toFixed(2)}亿
   ${q.peRatio ? `市盈率: ${q.peRatio.toFixed(2)}` : ''} ${q.pbRatio ? `市净率: ${q.pbRatio.toFixed(2)}` : ''}
   ${q.totalMarketValue ? `总市值: ${(q.totalMarketValue / 100000000).toFixed(2)}亿` : ''}
   数据来源: ${q.source}`;
    }).join('\n\n');

    return { success: true, data: formatted };
  } catch (error) {
    return {
      success: false,
      error: `股票行情获取失败: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Stock History Tool (Finance Data)
// ============================================================================

export const StockHistorySchema = z.object({
  symbol: z.string().describe('股票代码'),
  start_date: z.string().optional().describe('开始日期 YYYY-MM-DD'),
  end_date: z.string().optional().describe('结束日期 YYYY-MM-DD'),
  period: z.enum(['daily', 'weekly', 'monthly']).optional().default('daily').describe('K线周期'),
  adjust: z.enum(['none', 'hfq', 'qfq']).optional().default('none').describe('复权方式: none=不复权, hfq=后复权, qfq=前复权'),
  limit: z.number().min(1).max(365).optional().default(30).describe('返回数据条数'),
});

export const stockHistoryTool = {
  name: 'stock_history',
  description: '获取股票历史K线数据。支持日K、周K、月K，以及前复权、后复权。',
  parameters: {
    type: 'object' as const,
    properties: {
      symbol: {
        type: 'string',
        description: '股票代码',
      },
      start_date: {
        type: 'string',
        description: '开始日期 YYYY-MM-DD',
      },
      end_date: {
        type: 'string',
        description: '结束日期 YYYY-MM-DD',
      },
      period: {
        type: 'string',
        enum: ['daily', 'weekly', 'monthly'],
        description: 'K线周期 (默认: daily)',
      },
      adjust: {
        type: 'string',
        enum: ['none', 'hfq', 'qfq'],
        description: '复权方式: none=不复权, hfq=后复权, qfq=前复权',
      },
      limit: {
        type: 'number',
        description: '返回数据条数 (默认: 30, 最大: 365)',
      },
    },
    required: ['symbol'],
  },
};

export async function executeStockHistory(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = StockHistorySchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { symbol, start_date, end_date, period, adjust, limit } = parsed.data;

  try {
    const orchestrator = getFinanceOrchestrator();
    const history = await orchestrator.getHistory({
      symbol,
      start_date,
      end_date,
      period,
      adjust,
      limit,
    });

    if (history.items.length === 0) {
      return { success: false, error: `未找到股票历史数据: ${symbol}` };
    }

    const adjustLabel = adjust === 'qfq' ? '前复权' : adjust === 'hfq' ? '后复权' : '不复权';
    const periodLabel = period === 'daily' ? '日K' : period === 'weekly' ? '周K' : '月K';

    const header = `📊 **${symbol}** ${history.name || ''} ${periodLabel} ${adjustLabel}\n`;
    const table = '| 日期 | 开盘 | 最高 | 最低 | 收盘 | 成交量(万手) | 成交额(亿) |\n|------|------|------|------|------|-------------|-------------|\n';

    const rows = history.items.map(item => {
      return `| ${item.date} | ${item.open.toFixed(2)} | ${item.high.toFixed(2)} | ${item.low.toFixed(2)} | ${item.close.toFixed(2)} | ${(item.volume / 10000).toFixed(2)} | ${(item.amount / 100000000).toFixed(2)} |`;
    }).join('\n');

    return {
      success: true,
      data: header + table + rows + `\n\n数据来源: ${history.source}`
    };
  } catch (error) {
    return {
      success: false,
      error: `股票历史数据获取失败: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Stock Financial Tool (Finance Data)
// ============================================================================

export const StockFinancialSchema = z.object({
  symbol: z.string().describe('股票代码'),
  report_type: z.enum(['income', 'balance', 'cashflow']).describe('报表类型: income=利润表, balance=资产负债表, cashflow=现金流量表'),
  period: z.enum(['annual', 'quarterly']).optional().default('annual').describe('报告周期: annual=年报, quarterly=季报'),
  limit: z.number().min(1).max(8).optional().default(4).describe('返回报告期数'),
});

export const stockFinancialTool = {
  name: 'stock_financial',
  description: '获取上市公司财务报表数据。支持利润表、资产负债表、现金流量表。',
  parameters: {
    type: 'object' as const,
    properties: {
      symbol: {
        type: 'string',
        description: '股票代码',
      },
      report_type: {
        type: 'string',
        enum: ['income', 'balance', 'cashflow'],
        description: '报表类型: income=利润表, balance=资产负债表, cashflow=现金流量表',
      },
      period: {
        type: 'string',
        enum: ['annual', 'quarterly'],
        description: '报告周期: annual=年报, quarterly=季报 (默认: annual)',
      },
      limit: {
        type: 'number',
        description: '返回报告期数 (默认: 4, 最大: 8)',
      },
    },
    required: ['symbol', 'report_type'],
  },
};

export async function executeStockFinancial(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = StockFinancialSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { symbol, report_type, period, limit } = parsed.data;

  try {
    const orchestrator = getFinanceOrchestrator();
    const financial = await orchestrator.getFinancial({
      symbol,
      report_type,
      period,
      limit,
    });

    if (financial.items.length === 0) {
      return { success: false, error: `未找到财务数据: ${symbol}。注意：财务数据需要Tushare Token。` };
    }

    const reportLabel = report_type === 'income' ? '利润表' :
                        report_type === 'balance' ? '资产负债表' : '现金流量表';
    const periodLabel = period === 'annual' ? '年报' : '季报';

    let content = `📈 **${symbol}** ${financial.name || ''} ${reportLabel} (${periodLabel})\n\n`;

    for (const item of financial.items) {
      content += `**报告期: ${item.endDate}**\n`;

      if (report_type === 'income') {
        content += `- 营业收入: ${item.revenue ? (item.revenue / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
        content += `- 净利润: ${item.netProfit ? (item.netProfit / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
        content += `- 归母净利润: ${item.netProfitAttrib ? (item.netProfitAttrib / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
        if (item.roe) content += `- ROE: ${item.roe.toFixed(2)}%\n`;
      } else if (report_type === 'balance') {
        content += `- 总资产: ${item.totalAssets ? (item.totalAssets / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
        content += `- 总负债: ${item.totalLiabilities ? (item.totalLiabilities / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
        content += `- 股东权益: ${item.totalEquity ? (item.totalEquity / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
      } else {
        content += `- 经营现金流: ${item.operatingCashFlow ? (item.operatingCashFlow / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
        content += `- 投资现金流: ${item.investingCashFlow ? (item.investingCashFlow / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
        content += `- 筹资现金流: ${item.financingCashFlow ? (item.financingCashFlow / 100000000).toFixed(2) + '亿' : 'N/A'}\n`;
      }
      content += '\n';
    }

    return { success: true, data: content + `数据来源: ${financial.source}` };
  } catch (error) {
    return {
      success: false,
      error: `财务数据获取失败: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================================================
// Stock Info Tool (Finance Data)
// ============================================================================

export const StockInfoSchema = z.object({
  symbol: z.string().describe('股票代码'),
});

export const stockInfoTool = {
  name: 'stock_info',
  description: '获取上市公司基本信息。包括行业、上市日期、主营业务等。',
  parameters: {
    type: 'object' as const,
    properties: {
      symbol: {
        type: 'string',
        description: '股票代码',
      },
    },
    required: ['symbol'],
  },
};

export async function executeStockInfo(params: Record<string, unknown>): Promise<BuiltinToolResult> {
  const parsed = StockInfoSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }

  const { symbol } = parsed.data;

  try {
    const orchestrator = getFinanceOrchestrator();
    const info = await orchestrator.getInfo({ symbol });

    const content = `🏢 **${info.symbol}** ${info.name}
${info.fullName && info.fullName !== info.name ? `全称: ${info.fullName}\n` : ''}${info.industry ? `行业: ${info.industry}\n` : ''}${info.sector ? `板块: ${info.sector}\n` : ''}${info.market ? `市场: ${info.market}\n` : ''}${info.listDate ? `上市日期: ${info.listDate}\n` : ''}${info.chairman ? `董事长: ${info.chairman}\n` : ''}${info.employees ? `员工数: ${info.employees.toLocaleString()}\n` : ''}${info.province || info.city ? `地区: ${[info.province, info.city].filter(Boolean).join(' ')}\n` : ''}${info.website ? `网站: ${info.website}\n` : ''}
${info.mainBusiness ? `主营业务:\n${info.mainBusiness}` : ''}
数据来源: ${info.source}`;

    return { success: true, data: content };
  } catch (error) {
    return {
      success: false,
      error: `公司信息获取失败: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
