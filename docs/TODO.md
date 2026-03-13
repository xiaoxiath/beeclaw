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

- [x] **为工具模块添加测试**
  - 位置: `src/domain/tools/`
  - 缺少测试的关键文件:
    - `builtin.ts` - ✅ 已有测试（修复了导入问题，删除了废弃的 Task 测试）
    - `holiday.ts` - ✅ 已有测试（修复了导入路径）
    - `weather.ts` - ✅ 已有测试（修复了导入路径）
    - `timezone.ts` - ✅ 新增增强测试（20 个新测试）
    - `user-settings.ts` - ✅ 新增完整测试（24 个新测试）
  - **状态**: ✅ 已完成 (2026-03-13) - 总共 159 个测试通过

## 🟡 中优先级

### 3. 未完成的实现

#### 3.1 Sandbox 系统
- [x] **实现 LocalSandboxProvider**
  - 位置: `src/domain/sandbox/providers/local.ts`
  - 状态: ✅ 已完成 (commit 47db7ba)
  - 功能: 进程级隔离、命令过滤、资源限制、文件系统隔离
  - 测试: 39 个测试全部通过

- [x] **实现 DockerSandboxProvider**
  - 位置: `src/domain/sandbox/providers/docker.ts`
  - 状态: ✅ 已完成 (commit 47db7ba+1)
  - 功能: 容器级隔离、资源限制（CPU/内存）、网络隔离、卷挂载
  - 测试: 集成测试（需要 Docker 运行）

#### 3.2 Proactive 系统
- [x] **实现 cron handler dispatch**
  - 位置: `src/app/dispatcher/handlers.ts`
  - 状态: ✅ 已完成 (2026-03-13)
  - 功能: 基于 handlerName 分发 cron 任务到对应的 job handlers
  - 测试: 10 个测试全部通过

#### 3.3 Evolution 模块
- [x] **实现 recordQuery**
  - 位置: `src/domain/agent/evolution/query-tracking.ts`
  - 状态: ✅ 已完成 (2026-03-13)
  - 功能: 记录用户查询、检测模式、智能建议技能创建
  - 测试: 35 个测试全部通过

### 4. 类型改进

- [x] **修复 Feishu client 类型**
  - 位置: `src/adapter/feishu/card-v2/streaming-controller.ts`
  - 当前: `client: any`
  - 改进: 添加正确的类型定义
  - **状态**: ✅ 已完成 (2026-03-13) - 使用 `FeishuWSClient` 类型，18/18 测试通过

- [x] **修复 user-settings 配置类型**
  - 位置: `src/domain/tools/user-settings.ts`
  - 当前: `config: any`
  - 改进: 使用 `Partial<AppConfig>` 类型
  - **状态**: ✅ 已完成 (2026-03-13) - 24/24 测试通过

- [ ] **修复 Plugin registry 类型**
  - 位置: `src/adapter/plugins/registry/index.ts`
  - 当前: `config: {} as any`, `runtime: {} as any`
  - 改进: 从 Beeclaw 配置传入正确的类型
  - **备注**: 需要等插件系统架构完善后再实现

### 5. 代码重构

- [x] **移除已废弃的代码**
  - 位置: `src/infra/resilience/retry.ts`
  - 问题: 多个 @deprecated 函数
  - 建议: 迁移到 unified-retry 后删除
  - **状态**: ✅ 已完成 (2026-03-13) - 删除 654 行代码，迁移到 unified-retry

- [x] **移除已废弃的工具**
  - 位置: `src/domain/skills/tools.ts`
  - 工具: `skill_create`, `skill_update`
  - 状态: 已被 `skill_ensure` 取代
  - **状态**: ✅ 已完成 (2026-03-13) - 删除 80+ 行代码，更新 16 个文件

- [x] **清理 evolution 模块中的废弃代码**
  - 位置: `src/domain/agent/evolution/reflection-trigger.ts`
  - 问题: 多个 @deprecated 函数
  - 建议: 评估使用情况后移除
  - **状态**: ✅ 已完成 (2026-03-13) - 移除 `checkReflectionTriggers` 和 `ReflectionTrigger` 类型，保留统计功能

## 🟢 低优先级

### 6. 改进建议

#### 6.1 动态导入优化
- [ ] **将动态导入改为静态导入**
  - 位置: 多个文件
  - 示例: `src/domain/proactive/job-handlers.ts`, `src/app/index.ts`
  - 原因: 违反 CLAUDE.md 最佳实践
  - 好处: 编译时验证、更好的 IDE 支持
  - **状态**: ⏸️ 部分完成 (2026-03-13) - 已修复 job-handlers.ts，其他文件需要评估是否可以安全修改

#### 6.2 功能完善
- [x] **实现 Web adapter connection tracking**
  - 位置: `src/adapter/web/adapter.ts`
  - 当前: `connections: 0` (硬编码)
  - 功能: 跟踪活跃的 WebSocket 连接数
  - **状态**: ✅ 已完成 (2026-03-13) - 使用 Set 跟踪连接，返回实际数量

- [x] **实现 Feishu disconnect 方法**
  - 位置: `src/adapter/feishu/adapter.ts`
  - 当前: 注释掉的 TODO
  - 功能: 正确断开 Feishu WebSocket 连接
  - **状态**: ✅ 已完成 (2026-03-13) - 调用 client.stop() 断开连接

- [x] **获取实际的文件修改时间**
  - 位置: `src/adapter/web/server/routes/memory.ts`
  - 当前: `new Date().toISOString()`
  - 改进: 从文件系统获取实际 mtime
  - **状态**: ✅ 已完成 (2026-03-13) - 添加 stat() 方法，使用 fs.statSync()

#### 6.3 配置改进
- [x] **添加 MiniMax groupId 配置**
  - 位置: `src/domain/memory/embeddings.ts:283`
  - 当前: 硬编码为空字符串
  - 改进: 添加到配置 schema
  - **状态**: ✅ 已完成 (2026-03-13) - 添加 groupId 到 EmbeddingProviderSchema

- [ ] **完善 Plugin SDK 映射**
  - 位置: `src/adapter/plugins/loader/index.ts`
  - 当前: TODO 注释
  - 改进: 添加更多 SDK 模块映射

- [x] **实现相对路径解析**
  - 位置: `src/adapter/plugins/registry/index.ts`
  - 当前: 直接返回 input
  - 功能: 解析插件中的相对路径
  - **状态**: ✅ 已完成 (2026-03-13) - 实现安全路径解析，防止路径遍历攻击

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

| 类别 | 数量 | 已完成 | 待办 |
|------|------|--------|------|
| 高优先级 | 2 | 2 | 0 |
| 中优先级 | 10 | 10 | 0 |
| 低优先级 | 11 | 5 | 6 |
| **总计** | **23** | **17** | **6** |

### ✅ 代码清理完成（2026-03-13）

**Retry 系统清理**:
- ✅ 删除 `src/infra/resilience/retry.ts` (130 行)
- ✅ 删除 `src/infra/resilience/__tests__/retry.test.ts` (524 行)
- ✅ 迁移到 `unified-retry.ts`
- ✅ 更新 `src/domain/agent/api.ts`

**Skill 工具清理**:
- ✅ 删除 `skill_create` 和 `skill_update` 工具定义 (80+ 行)
- ✅ 删除测试代码 (134 行)
- ✅ 迁移到 `skill_ensure`
- ✅ 更新 16 个文件的引用

**Evolution 清理**:
- ✅ 删除 `checkReflectionTriggers()` 函数和测试 (41 行)
- ✅ 删除 `ReflectionTrigger` 类型导出
- ✅ 保留统计功能（`recordSkillFailure`, `getReflectionStats`）
- ✅ 移除 `proactive.ts` 中的调用

**总代码减少**: 909 行删除，154 行新增，净减少 **755 行** 🎉

### ✅ 测试覆盖改进（2026-03-13）

**新增测试文件**:
1. `timezone.enhanced.test.ts` - 20 个测试（全面覆盖时区解析）
2. `user-settings.test.ts` - 24 个测试（用户设置功能）

**修复的测试**:
1. `builtin.test.ts` - 删除废弃的 Task 工具测试，修复导入
2. `holiday.test.ts` - 修复导入路径
3. `weather.test.ts` - 修复导入路径
4. `timezone.test.ts` - 修复导入路径

**修复的问题**:
1. 修复 `tools.ts` 中的循环依赖（使用 getter 函数）
2. 删除所有 Task 相关工具的测试引用

**结果**: 工具模块测试从 115 个增加到 159 个，全部通过 ✅

## 🎯 建议优先级

1. **本周**: 提交当前审计修复 (#1)
2. **下周**: 添加 Extraction Manager 测试 (#2)
3. **本月**: 实现 Sandbox 或移除配置 (#3.1)
4. **下季度**: 清理已废弃代码 (#5)

## 📝 备注

- 某些 TODO 项可能已过时，需要重新评估
- 优先级应根据实际使用情况和用户反馈调整
- 建议定期（每月）审查此清单
