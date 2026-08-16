# 微信一键登录问题排查指南

## 问题现象
点击"微信一键登录"按钮后报错。

## 已完成的修复
✅ 增强了登录流程的错误处理和日志输出
✅ 添加了详细的console.log用于调试
✅ 改进了错误提示信息

## 排查步骤

### 步骤1: 检查后端服务是否运行

```bash
# 检查BFF服务是否在运行
curl http://localhost:3000/api/v1/auth/test-login -X POST -H "Content-Type: application/json" -d "{\"nickname\":\"测试\"}"
```

**预期结果**: 应返回包含token的JSON响应

**如果失败**:
```bash
# 启动BFF服务
pnpm --filter bff start:dev
```

### 步骤2: 检查环境变量配置

打开 `d:\neighborhood-help\.env` 文件（如果没有，复制 `.env.example` 为 `.env`），确保以下配置正确：

```env
# 微信配置（开发环境可以使用mock，不需要真实AppID）
WX_APPID=
WX_SECRET=

# JWT配置（必须有值）
JWT_SECRET=your_dev_secret_change_in_production
JWT_REFRESH_SECRET=your_refresh_secret_change_in_production

# 数据库配置
DATABASE_URL=mysql://root:password@localhost:3306/neighborhood_help

# 前端API地址
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

**重要**: 如果 `WX_APPID` 和 `WX_SECRET` 为空或未配置，系统会自动使用mock模式，返回模拟的openid用于开发测试。

### 步骤3: 在微信开发者工具中调试

1. **打开微信开发者工具**
2. **导入项目**: `d:\neighborhood-help\frontend\dist\build\mp-weixin`
3. **打开调试器**: 点击顶部菜单 "调试器" 或按 F12
4. **查看Console**: 在Console面板中可以看到详细的日志输出

### 步骤4: 测试登录流程

#### 方法A: 使用Mock登录（推荐用于开发测试）

1. 在微信开发者工具中打开登录页
2. 输入任意昵称（可选）
3. 点击 **"🧪 Mock 登录（开发测试）"** 按钮
4. 这会直接调用 `/auth/test-login` 接口，跳过微信code获取

**优点**: 不需要真实的微信AppID，适合本地开发

#### 方法B: 使用真实微信登录

1. 在微信开发者工具Console中执行：
```javascript
wx.login({ success: res => console.log('code:', res.code) })
```

2. 复制输出的code值

3. 在登录页的"H5 调试模式"区域，粘贴code值

4. 输入昵称（可选）

5. 点击"微信一键登录"按钮

6. **查看Console日志**，应该看到：
```
获取到微信登录code: xxxxxxxxxx...
```

### 步骤5: 查看错误信息

如果登录失败，Console中会显示详细的错误信息：

#### 常见错误及解决方案

**错误1**: `获取微信code失败`
- **原因**: 微信开发者工具未正确初始化
- **解决**: 
  1. 重新编译项目（点击"编译"按钮）
  2. 确认使用的是微信小程序项目（不是公众号网页）

**错误2**: `网络错误` 或 `请求失败`
- **原因**: BFF服务未启动或端口不对
- **解决**:
  1. 检查BFF服务是否运行在 http://localhost:3000
  2. 检查 `.env` 中的 `VITE_API_BASE_URL` 是否正确

**错误3**: `微信 code2Session 失败`
- **原因**: 微信AppID/Secret配置错误或code已使用
- **解决**:
  1. 如果未配置AppID/Secret，系统应自动使用mock模式
  2. 如果配置了，请确认AppID和Secret正确
  3. code只能使用一次，请重新获取

**错误4**: `MySQL连接失败`
- **原因**: 数据库未启动或配置错误
- **解决**:
  ```bash
  # 启动MySQL（使用Docker）
  docker compose up -d mysql
  ```

### 步骤6: 使用Mock登录快速测试

如果微信登录一直失败，可以临时使用Mock登录来测试其他功能：

在登录页，点击 **"🧪 Mock 登录（开发测试）"** 按钮，这会：
- 创建一个模拟用户
- 签发有效的JWT token
- 跳过微信code验证

这样可以先测试其他功能（任务列表、发布任务等），后续再修复微信登录问题。

## 快速诊断命令

```bash
# 1. 检查BFF服务状态
curl http://localhost:3000/api/v1/auth/test-login -X POST -H "Content-Type: application/json" -d "{\"nickname\":\"测试\"}"

# 2. 检查MySQL是否运行
docker ps | grep mysql

# 3. 查看BFF日志
# 在运行BFF的终端中查看输出

# 4. 重新构建前端
pnpm --filter frontend build:mp-weixin
```

## 完整的登录流程图

```
用户点击登录
    ↓
uni.login() 获取code
    ↓
POST /api/v1/auth/wx-login { code, userInfo }
    ↓
B端: code2Session(code) → openid
    ↓
    ├─ 有WX_APPID/WX_SECRET → 调用微信API
    │     ↓
    │   真实openid
    │
    └─ 无配置 → Mock模式
          ↓
        mock_{code}
    ↓
查找或创建用户
    ↓
签发JWT Token
    ↓
前端保存Token并跳转首页
```

## 需要帮助？

请提供以下信息：
1. 微信开发者工具Console中的完整错误信息
2. BFF服务的日志输出
3. `.env` 文件中的相关配置（隐藏敏感信息）