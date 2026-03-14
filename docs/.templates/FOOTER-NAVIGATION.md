# 文档底部导航模板

> 标准化的文档底部导航，提升文档可发现性

---

## 模板说明

在所有主要文档（>50行）底部添加以下导航结构：

```markdown
---

## 📚 相关文档

**上一篇**: [XX文档](./prev.md) | **下一篇**: [YY文档](./next.md)

**相关主题**:
- [主题A](./link-a.md) - 简短描述
- [主题B](./link-b.md) - 简短描述
- [主题C](./link-c.md) - 简短描述

**返回**: [文档首页](./README.md) | [学习路径](./learning-paths.md) | [文档地图](./sitemap.md)

---

**最后更新**: 2026-03-14 | [编辑此页](https://github.com/xiaoxiath/beeclaw/edit/main/docs/path/to/file.md)
```

---

## 示例 1：快速开始

```markdown
---

## 📚 相关文档

**下一篇**: [配置指南](./configuration.md)

**相关主题**:
- [学习路径](./learning-paths.md) - 系统化学习指南
- [CLI 参考](./references/cli.md) - 命令行详解
- [飞书集成](./guide/feishu-integration.md) - Bot 配置

**返回**: [文档首页](./README.md) | [学习路径](./learning-paths.md)

---

**最后更新**: 2026-03-14
```

---

## 示例 2：记忆系统

```markdown
---

## 📚 相关文档

**上一篇**: [快速开始](./getting-started.md) | **下一篇**: [技能系统](./guide/skill-system.md)

**相关主题**:
- [记忆管理工作流](./cookbook/basic/memory-workflow.md) - 实战案例
- [工具参考 - 记忆工具](./references/tools.md#记忆工具) - API 文档
- [故障排查 - 记忆问题](./troubleshooting/memory-issues.md) - 问题诊断

**返回**: [用户指南](./guide/) | [文档首页](./README.md)

---

**最后更新**: 2026-03-14
```

---

## 示例 3：工具参考

```markdown
---

## 📚 相关文档

**相关主题**:
- [CLI 参考](./references/cli.md) - 命令行工具
- [深度研究任务](./cookbook/basic/research-task.md) - 工具实战
- [配置指南](./configuration.md) - 配置选项

**返回**: [参考文档](./references/) | [文档首页](./README.md)

---

**最后更新**: 2026-03-14
```

---

## 导航规则

### 1. 顺序导航

- **上一篇/下一篇**: 同一类别的相邻文档
- 例如：用户指南系列按学习顺序排列

### 2. 主题导航

- **相关主题**: 2-4 个最相关的文档
- 每个链接附带简短描述（< 10 字）
- 优先级：实战案例 > API 文档 > 故障排查

### 3. 返回导航

- **文档首页**: 总是包含
- **类别首页**: 如果文档属于某个类别（如 guide/）
- **学习路径**: 对新手友好的入口
- **文档地图**: 可选，帮助迷失用户

### 4. 元信息

- **最后更新**: 日期格式 YYYY-MM-DD
- **编辑此页**: GitHub 编辑链接（可选）

---

## 实施清单

为以下文档添加底部导航：

### P0 优先级（立即执行）

- [ ] getting-started.md
- [ ] configuration.md
- [ ] learning-paths.md

### P1 优先级（本周内）

- [ ] guide/memory-system.md
- [ ] guide/skill-system.md
- [ ] guide/subagent-system.md
- [ ] guide/plugin-system.md

### P2 优先级（下周）

- [ ] architecture.md
- [ ] design/*.md
- [ ] references/*.md

---

## 自动化脚本

可以使用脚本自动添加导航：

```bash
#!/bin/bash
# add-navigation.sh

file=$1
category=$2

cat >> $file << EOF

---

## 📚 相关文档

**返回**: [文档首页](../README.md) | [学习路径](../learning-paths.md)

---

**最后更新**: $(date +%Y-%m-%d)
EOF

echo "✓ 已添加导航到 $file"
```

**使用**:
```bash
./add-navigation.sh docs/getting-started.md "入门"
```

---

**维护者**: Beeclaw Team
**最后更新**: 2026-03-14
