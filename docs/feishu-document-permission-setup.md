# Feishu Document Creation Permission Setup

## Problem

When trying to create Feishu documents, you may encounter this error:

```
Access denied. One of the following scopes is required: [docx:document, docx:document:create].
应用尚未开通所需的应用身份权限：[docx:document, docx:document:create]
```

## Solution

You need to enable document creation permissions in your Feishu Open Platform application settings.

### Step-by-Step Guide

1. **Open Feishu Open Platform**
   - Go to https://open.feishu.cn
   - Log in with your Feishu account

2. **Navigate to Your Application**
   - Click "Developer Console" (开发者后台)
   - Select your application (e.g., `cli_a9390dcb98ba9cc6`)

3. **Add Required Permissions**
   - Go to "Permissions & Scopes" (权限管理)
   - Click "Application Permissions" (应用能力)

   Add these permissions:
   - ✅ `docx:document` - View and manage documents
   - ✅ `docx:document:create` - Create new documents

4. **Apply for Permissions**
   - Click "Apply" (申请) for each permission
   - Fill in the reason for needing this permission
   - Submit the application

5. **Wait for Approval**
   - Some permissions require Feishu admin approval
   - You'll receive a notification once approved

6. **Reinstall Application (if needed)**
   - If permissions were recently added, you may need to reinstall the app
   - Go to "Version Management" (版本管理)
   - Create a new version and publish

### Direct Permission Link

Use this direct link to apply for document permissions:

```
https://open.feishu.cn/app/cli_a9390dcb98ba9cc6/auth?q=docx:document,docx:document:create&op_from=openapi&token_type=tenant
```

Replace `cli_a9390dcb98ba9cc6` with your actual App ID.

## Verification

After enabling permissions, restart your beeclaw bot:

```bash
bun run pm2:restart
```

Then test document creation by saying to the bot:

```
创建一个飞书文档 "测试文档"
```

## Available Document Operations

Once permissions are enabled, you can:

1. **Create documents in cloud drive**
   ```
   创建飞书文档 "项目计划"
   ```

2. **Create documents in specific folders**
   ```
   在文件夹 fldcnXXXXX 中创建文档 "会议记录"
   ```

3. **Create documents with initial content**
   ```
   创建飞书文档 "工作日志"，内容是"今天的工作："
   ```

4. **Create wiki pages** (requires wiki permissions)
   ```
   在知识库中创建文档 "团队介绍"
   ```

## Related Documentation

- [Feishu Document API](https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document/create)
- [Permission Management](https://open.feishu.cn/document/home/introduction-to-scope-and-authorization/availability-of-permissions)
- [Error 99991672 Troubleshooting](https://open.feishu.cn/document/uAjLw4CM/ugTN1YjL4UTN24CO1UjN/trouble-shooting/how-to-fix-the-99991672-error)

## Need Help?

If you still encounter permission errors after following these steps:

1. Check that your App ID and App Secret are correct in environment variables
2. Verify that permissions are approved (not just requested)
3. Try creating a new app version and reinstalling
4. Check Feishu admin console for any pending approval requests
