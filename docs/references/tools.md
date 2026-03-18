# 工具参考

> Beeclaw 内置工具完整列表

## 记忆工具

### 基础工具

#### memory_ls
列出记忆文件

**参数**:
- `path` (可选): 目录路径

**示例**:
```json
{
  "path": "facts"
}
```

#### memory_grep
搜索记忆内容

**参数**:
- `query`: 搜索关键词
- `path` (可选): 搜索路径

#### memory_read
读取记忆文件

**参数**:
- `path`: 文件路径

#### memory_write
写入记忆文件

**参数**:
- `path`: 文件路径
- `content`: 文件内容
- `mode` (可选): "overwrite" | "append"

#### memory_record
记录新事实

**参数**:
- `category`: 分类（如 "lessons", "decisions"）
- `content`: 事实内容

### 高级工具

#### memory_compress
压缩旧记忆

**参数**:
- `category`: 要压缩的分类
- `olderThan`: 天数（默认30）

#### memory_score
计算记忆重要性分数

**参数**:
- `entryId`: 记忆条目ID

#### memory_dedupe
去除重复记忆

**参数**:
- `category`: 分类

#### memory_knowledge_create
创建知识库

**参数**:
- `name`: 知识库名称
- `description`: 描述

#### memory_index
创建记忆索引

**参数**:
- `category`: 分类

#### memory_search
语义搜索记忆

**参数**:
- `query`: 搜索查询
- `limit` (可选): 结果数量

## 技能工具

### 基础工具

#### skill_list
列出所有技能

**参数**:
- `maturity` (可选): 成熟度过滤

#### skill_get
获取技能详情

**参数**:
- `name`: 技能名称

#### skill_ensure
创建或更新技能

**参数**:
- `name`: 技能名称
- `description`: 描述
- `content`: 技能内容
- `maturity` (可选): 成熟度（默认"seed"）

#### skill_delete
删除技能

**参数**:
- `name`: 技能名称

### 高级工具

#### skill_search
搜索技能

**参数**:
- `query`: 搜索查询

#### skill_maturity
更新技能成熟度

**参数**:
- `name`: 技能名称
- `maturity`: 新成熟度

#### skill_record
记录技能使用

**参数**:
- `skillName`: 技能名称
- `success`: 是否成功

#### skill_evals
获取技能评估

**参数**:
- `skillName`: 技能名称

#### skill_resource_read
读取技能资源文件

**参数**:
- `skillName`: 技能名称
- `resourcePath`: 资源路径

#### skill_resource_write
写入技能资源文件

**参数**:
- `skillName`: 技能名称
- `resourcePath`: 资源路径
- `content`: 内容

#### skill_structure
获取技能结构

**参数**:
- `skillName`: 技能名称

#### skill_workspace_create
创建技能工作空间

**参数**:
- `skillName`: 技能名称

#### skill_recommend
推荐相关技能

**参数**:
- `context`: 上下文

#### skill_performance
获取技能性能统计

**参数**:
- `skillName`: 技能名称

#### skill_analyze_failures
分析技能失败

**参数**:
- `skillName`: 技能名称

#### skill_export
导出技能

**参数**:
- `skillName`: 技能名称

#### skill_import
导入技能

**参数**:
- `skillData`: 技能数据（JSON字符串）

## 网络工具

### web_search
网络搜索

**参数**:
- `query`: 搜索查询
- `numResults` (可选): 结果数量（默认5）

### web_fetch
抓取网页内容

**参数**:
- `url`: 网页URL
- `renderJavaScript` (可选): 是否渲染JS（默认false）

## 文件工具

### file_read
读取文件

**参数**:
- `path`: 文件路径

### file_write
写入文件

**参数**:
- `path`: 文件路径
- `content`: 文件内容

## Shell 工具

### shell_exec
执行Shell命令

**参数**:
- `command`: Shell命令
- `timeout` (可选): 超时时间（毫秒）

**安全限制**:
- 某些危险命令被禁止
- 需要适当的权限

## 飞书工具

### feishu_send_message
发送飞书消息

**参数**:
- `chatId`: 聊天ID
- `message`: 消息内容

### feishu_drive_list
列出云文档

**参数**:
- `folderToken` (可选): 文件夹token

### feishu_calendar_create
创建日历事件

**参数**:
- `summary`: 事件标题
- `startTime`: 开始时间
- `endTime`: 结束时间

## 天气工具

### weather_get
获取天气信息

**参数**:
- `location`: 位置
- `days` (可选): 预报天数

## 相关文档

- [记忆系统](../guide/memory-system.md)
- [技能系统](../guide/skill-system.md)
