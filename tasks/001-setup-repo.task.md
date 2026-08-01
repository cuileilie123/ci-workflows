# Task 001: 初始化代码仓库

- **Prompt**: `prompts/bff/01-nestjs-init.prompt.md`
- **执行顺序**: 1
- **状态**: done
- **依赖**: 无
- **预估时间**: 30 分钟
- **说明**: 创建 monorepo 结构，初始化 Git 仓库，配置 CI/CD 基础
- **验收**:
  - [x] 仓库结构：frontend/ + bff/ + backend/ + specs/ + prompts/
  - [x] 根目录 package.json（workspace 管理）
  - [x] Docker Compose（MySQL + Redis + RabbitMQ + ES）
  - [x] GitHub Actions CI 基础配置
  - [x] .gitignore 完整（node_modules, .env, dist）
  - [x] BFF 启动成功 + /api/v1/health 返回 200 + Swagger /docs 可访问
