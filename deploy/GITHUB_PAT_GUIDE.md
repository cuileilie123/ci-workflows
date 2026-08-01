# GitHub Personal Access Token 创建指南

## 一、创建步骤

### 1. 打开 Token 创建页面

访问：https://github.com/settings/tokens?type=beta

> 注意：GitHub 现在推荐使用 Fine-grained token（细粒度令牌），比 Classic token 更安全。

### 2. 点击 "Generate new token"

选择 **"Fine-grained token"**，点击 "Generate new token"。

### 3. 填写基本信息

| 字段 | 值 |
|------|-----|
| Token name | `ci-workflows-push` |
| Expiration | 90 days（推荐） |
| Resource owner | `cuileilei123` |
| Repository access | 选择 "Only select repositories" → 勾选 `ci-workflows` |

### 4. 配置权限

展开 "Repository permissions"，按以下表格配置：

#### 必需权限（推送代码 + CI 工作流）

| 权限类别 | 权限名称 | 级别 | 用途 |
|----------|----------|------|------|
| Repository | Contents | Read and write | 推送代码 |
| Repository | Pull requests | Read and write | 创建/更新 PR 评论 |
| Repository | Metadata | Read-only | 访问仓库元数据（自动勾选） |
| Repository | Actions | Read-only | 查看工作流运行状态 |
| Repository | Commit statuses | Read-only | 读取提交状态 |

#### 可选权限（如果需要管理 Actions）

| 权限类别 | 权限名称 | 级别 | 用途 |
|----------|----------|------|------|
| Repository | Workflows | Read and write | 修改工作流文件 |

### 5. 生成并复制 Token

点击页面底部 "Generate token"。

> **重要**：Token 只在创建时显示一次，请立即复制保存。

### 6. 配置 Git 凭据

#### 方式 A：使用 Git Credential Manager（推荐）

Windows 环境自带 Git Credential Manager，首次推送时会弹出浏览器登录窗口：

```powershell
# 确保凭据管理器已启用
git config --global credential.helper manager

# 推送时会自动弹出登录窗口
git push -u origin main
```

#### 方式 B：手动存储 Token

将 Token 存入 Git 凭据缓存：

```powershell
# 缓存 1 小时
git config --global credential.helper 'cache --timeout=3600'

# 推送时输入用户名和 Token
git push -u origin main
# Username: cuileilei123
# Password: ghp_xxxxxxxxxxxx（粘贴 Token）
```

#### 方式 C：直接写入 Remote URL（不推荐，仅临时使用）

```powershell
git remote set-url origin https://cuileilei123:ghp_xxxxxxxxxxxx@github.com/cuileilei123/ci-workflows.git
git push -u origin main

# 推送完成后恢复原始 URL
git remote set-url origin https://github.com/cuileilei123/ci-workflows.git
```

## 二、Classic Token 方式（备选）

如果 Fine-grained token 遇到问题，可以使用 Classic token：

访问：https://github.com/settings/tokens/new

| 字段 | 值 |
|------|-----|
| Note | `ci-workflows-push` |
| Expiration | 90 days |
| Scopes | 勾选以下选项 |

需要的 Scopes：

- [x] **repo**（完整勾选）— 推送代码、管理 PR
- [x] **workflow** — 修改 GitHub Actions 工作流文件

## 三、验证推送

```powershell
cd d:\neighborhood-help

# 确认远程地址
git remote -v
# origin  https://github.com/cuileilei123/ci-workflows.git

# 推送
git push -u origin main

# 验证
git log --oneline -3
# d0c5498 ci: 添加备份恢复测试工作流，支持通过率阈值和 HTML PR 评论
# 016d9d4 [Trae] Task 001: 初始化 monorepo 仓库结构
```

## 四、安全注意事项

1. **不要将 Token 提交到代码仓库**
2. **不要在公共聊天/日志中分享 Token**
3. **Token 过期后及时续期**
4. **如怀疑泄露，立即在 https://github.com/settings/tokens 撤销**
5. **推荐使用 Fine-grained token + 最小权限原则**

## 五、常见问题

### Q: 推送时报 "Authentication failed"？

- Classic token: 确认勾选了 `repo` scope
- Fine-grained token: 确认选择了正确的仓库 + Contents 权限为 Read and write

### Q: 推送时报 "Permission denied to workflow file"？

- Classic token: 需要额外勾选 `workflow` scope
- Fine-grained token: 需要将 Workflows 权限设为 Read and write

### Q: 每次推送都要输入 Token？

```powershell
# 永久存储（Windows 凭据管理器）
git config --global credential.helper manager
```
