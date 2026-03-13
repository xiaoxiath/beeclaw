# Beeclaw 待办事项清单

**更新日期**: 2026-03-13

## 🔴 高优先级

### 1. 代码清理
- [x] **提交当前的审计修复**
  - 位置: 已修改但未提交的文件
  - 包括: 测试修复、新测试、文档更新
  - 影响: 需要提交以保留审计成果
  - **状态**: ✅ 已完成 (commit fbd29ce)

### 2. 测试覆盖
- [x] **为 Extraction Manager 添加测试**
  - 位置: `src/domain/extraction/`
  - 当前状态: 仅有 2 个测试文件
  - 缺少: 主提取器功能测试
  - **状态**: ✅ 已完成 (commit 849fd2c) - 新增 128 个测试

- [ ] **为工具模块添加测试**
  - 位置: `src/domain/tools/`
  - 缺少测试的关键文件:
    - `builtin.ts`
    - `holiday.ts`
    - `weather.ts`
    - `timezone.ts`
    - `user-settings.ts`

## 🟡 中优先级

### 3. 未完成的实现

#### 3.1 Sandbox 系统
- [x] **实现 LocalSandboxProvider**
  - 位置: `src/domain/sandbox/providers/local.ts`
  - 状态: ✅ 已完成 (commit 849fd2c)
  - 功能: 进程级隔离、命令过滤、资源限制、文件系统隔离
  - 测试: 39 个测试全部通过

- [ ] **实现 DockerSandboxProvider**
  - 位置: `src/domain/sandbox/providers/docker.ts`
  - 当前: 抛出 "not implemented" 错误
  - 优先级: 低（Local Provider 已足够用于开发）

#### 3.2 Proactive 系统
- [ ] **实现 cron handler dispatch**
  - 位置: `src/app/dispatcher/handlers.ts:66`
  - 当前: 注释掉的 TODO
  - 功能: 基于 handlerName 分发 cron 任务

#### 3.3 Evolution 模块
- [ ] **实现 recordQuery**
  - 位置: `src/app/routes/proactive.ts`
  - 当前: 注释掉的 TODO
  - 功能: 在 evolution 模块中记录查询

### 4. 类型改进

- [ ] **修复 Feishu client 类型**
  - 位置: `src/adapter/feishu/card-v2/streaming-controller.ts`
  - 当前: `client: any`
  - 改进: 添加正确的类型定义

- [ ] **修复 Plugin registry 类型**
  - 位置: `src/adapter/plugins/registry/index.ts`
  - 当前: `config: {} as any`, `runtime: {} as any`
  - 改进: 从 Beeclaw 配置传入正确的类型

### 5. 代码重构

- [ ] **移除已废弃的代码**
  - 位置: `src/infra/resilience/retry.ts`
  - 问题: 多个 @deprecated 函数
  - 建议: 迁移到 unified-retry 后删除

- [ ] **移除已废弃的工具**
  - 位置: `src/domain/skills/tools.ts`
  - 工具: `skill_create`, `skill_update`
  - 状态: 已被 `skill_ensure` 取代
  - 计划: 在下个主版本中移除

- [ ] **清理 evolution 模块中的废弃代码**
  - 位置: `src/domain/agent/evolution/reflection-trigger.ts`
  - 问题: 多个 @deprecated 函数
  - 建议: 评估使用情况后移除

## 🟢 低优先级

### 6. 改进建议

#### 6.1 动态导入优化
- [ ] **将动态导入改为静态导入**
  - 位置: 多个文件
  - 示例: `src/domain/proactive/job-handlers.ts`, `src/app/index.ts`
  - 原因: 违反 CLAUDE.md 最佳实践
  - 好处: 编译时验证、更好的 IDE 支持

#### 6.2 功能完善
- [ ] **实现 Web adapter connection tracking**
  - 位置: `src/adapter/web/adapter.ts`
  - 当前: `connections: 0` (硬编码)
  - 功能: 跟踪活跃的 WebSocket 连接数

- [ ] **实现 Feishu disconnect 方法**
  - 位置: `src/adapter/feishu/adapter.ts`
  - 当前: 注释掉的 TODO
  - 功能: 正确断开 Feishu WebSocket 连接

- [ ] **获取实际的文件修改时间**
  - 位置: `src/adapter/web/server/routes/memory.ts`
  - 当前: `new Date().toISOString()`
  - 改进: 从文件系统获取实际 mtime

#### 6.3 配置改进
- [ ] **添加 MiniMax groupId 配置**
  - 位置: `src/domain/memory/embeddings.ts:283`
  - 当前: 硬编码为空字符串
  - 改进: 添加到配置 schema

- [ ] **完善 Plugin SDK 映射**
  - 位置: `src/adapter/plugins/loader/index.ts`
  - 当前: TODO 注释
  - 改进: 添加更多 SDK 模块映射

- [ ] **实现相对路径解析**
  - 位置: `src/adapter/plugins/registry/index.ts`
  - 当前: 直接返回 input
  - 功能: 解析插件中的相对路径

### 7. 文档完善

- [ ] **为 Feishu 工具添加文档**
  - 位置: `src/adapter/feishu/tools/`
  - 文件: drive.ts, wiki.ts, calendar.ts, bitable.ts, docx.ts
  - 缺少: 使用示例和最佳实践

- [ ] **更新 API 文档**
  - 位置: `docs/`
  - 缺少: 新功能的 API 文档
  - 包括: Card V2, Streaming, Evolution

## 📊 统计

| 类别 | 数量 |
|------|------|
| 高优先级 | 2 |
| 中优先级 | 10 |
| 低优先级 | 11 |
| **总计** | **23** |

## 🎯 建议优先级

1. **本周**: 提交当前审计修复 (#1)
2. **下周**: 添加 Extraction Manager 测试 (#2)
3. **本月**: 实现 Sandbox 或移除配置 (#3.1)
4. **下季度**: 清理已废弃代码 (#5)

## 📝 备注

- 某些 TODO 项可能已过时，需要重新评估
- 优先级应根据实际使用情况和用户反馈调整
- 建议定期（每月）审查此清单
