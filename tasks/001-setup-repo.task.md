# Task 001: 初始化代码仓库

- **Prompt**: `prompts/bff/01-nestjs-init.prompt.md`
- **执行顺序**: 1
- **状态**: pending
- **依赖**: 无
- **预估时间**: 30 分钟
- **说明**: 创建 monorepo 结构，初始化 Git 仓库，配置 CI/CD 基础
- **验收**:
  - [ ] 仓库结构：frontend/ + bff/ + backend/ + specs/ + prompts/
  - [ ] 根目录 package.json（workspace 管理）
  - [ ] Docker Compose（MySQL + Redis + RabbitMQ + ES）
  - [ ] GitHub Actions CI 基础配置
  - [ ] .gitignore 完整（node_modules, .env, dist）
