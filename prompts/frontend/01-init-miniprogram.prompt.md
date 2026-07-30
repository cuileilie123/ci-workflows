---
name: init-miniprogram
description: 初始化 UniApp 微信小程序项目骨架
model: claude-4-sonnet
tags: [frontend, setup]
depends_on: []
---

# 任务：初始化 UniApp 微信小程序项目

## 目标
创建一个基于 **UniApp 3.x + TypeScript** 的微信小程序项目骨架，配置好工程化工具链。

## 具体要求

1. 使用 `pnpm create uni-app` 创建项目，选择 TypeScript 模板
2. 项目结构：
   ```
   src/
   ├── pages/          # 页面
   ├── components/     # 公共组件
   ├── utils/          # 工具函数
   ├── store/          # Pinia 状态管理
   ├── api/            # API 接口封装
   ├── types/          # TypeScript 类型定义
   └── static/         # 静态资源
   ```

3. 安装并配置：
   - `eslint` + `prettier` + `eslint-config-prettier`
   - `husky` + `lint-staged`（pre-commit 自动检查）
   - `sass` 预处理器

4. 配置 `tsconfig.json`：
   - `strict: true`
   - `noImplicitAny: true`
   - 路径别名 `@/*` → `src/*`

5. 创建 `.env.development` 和 `.env.production`：
   - `VITE_API_BASE_URL` 区分环境
   - `VITE_WX_APPID`

6. 在 `manifest.json` 中配置微信小程序 AppID

## 验收标准
- [ ] `pnpm dev:mp-weixin` 能正常编译
- [ ] 微信开发者工具能打开并预览
- [ ] ESLint 无报错
- [ ] TypeScript 严格模式通过

## 参考文件
- `.trae/memory.md` → 技术栈章节
- `specs/01-auth.md` → 登录流程
