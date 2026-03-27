# 故障排查

> Beeclaw 常见问题和解决方案

## 文档索引

| 文档 | 说明 |
|------|------|
| [技能执行问题](./skill-execution-bugs.md) | 技能使用流程中的已知问题和解决方案 |
| [图表渲染调试](./chart-rendering.md) | `create_chart` 工具图表未渲染到飞书消息的排查 |
| [会话队列超时修复](./session-queue-timeout-fix.md) | 消息在会话队列中超时过期的修复方案 |
| [定时任务错峰执行](./stagger-reflection-compression.md) | Daily Reflection 与 Memory Compression 同时执行的冲突修复 |
| [Extraction 与 Session 错误](./extraction-session-errors.md) | ExtractionManager 和 Session 相关错误分析 |

---

## 快速诊断

### 1. 服务无法启动

**症状**:
```
Error: Cannot find module './beeclaw.json'
```

**解决方案**:
```bash
cp beeclaw.example.json beeclaw.json
```

### 2. API Key 未设置

**症状**:
```
Error: ZHIPU_API_KEY is not defined
```

**解决方案**:
```bash
export ZHIPU_API_KEY=your_key_here
# 或添加到 .env 文件
```

### 3. 配置验证失败

**症状**:
```
Error: Invalid configuration: ...
```

**解决方案**:
1. 检查 JSON 格式
2. 验证必填字段
3. 参考 `beeclaw.example.json`

## 飞书相关问题

### 权限错误

**症状**:
```
Error: permission denied (code: 99991672)
```

**解决方案**:
1. 检查飞书应用权限配置
2. 确认已启用所需权限
3. 参考 [飞书集成](../guide/feishu-integration.md)

### 消息发送失败

**症状**:
```
Error: failed to send message
```

**解决方案**:
1. 验证 App ID 和 Secret
2. 检查网络连接
3. 查看飞书 API 状态

## 性能问题

### 响应缓慢

**可能原因**:
- 上下文过长
- 网络延迟
- API 限流

**解决方案**:
1. 启用上下文压缩
2. 检查网络连接
3. 调整请求频率

### 内存占用高

**解决方案**:
1. 清理会话文件
2. 压缩记忆数据
3. 重启服务

## 调试技巧

### 启用详细日志

```json
{
  "logging": {
    "level": "debug"
  }
}
```

### 检查会话状态

```bash
ls -la data/sessions/
```

### 测试配置

```bash
bun run config:validate
```

## 获取帮助

- **文档**: [docs/](../)
- **问题**: 提交 GitHub Issue
- **社区**: 加入讨论群

## 相关文档

- [部署指南](../operations/deployment.md)
- [飞书集成](../guide/feishu-integration.md)
