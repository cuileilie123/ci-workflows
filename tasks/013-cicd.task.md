# Task 013: CI/CD 全链路 + 混沌工程

- **Prompts**:
  - `prompts/backend/14-cicd-deploy.prompt.md`
- **执行顺序**: 13
- **状态**: pending
- **依赖**: Task 011, 012
- **预估时间**: 4 小时
- **说明**: GitHub Actions 全流水线 + Docker 多阶段 + K8s 蓝绿部署 + Chaos Mesh
- **验收**:
  - [ ] 所有测试通过（覆盖率 > 80%）
  - [ ] Snyk 无高危漏洞
  - [ ] Trivy 扫描无 CRITICAL
  - [ ] Docker 镜像多阶段构建（< 100MB）
  - [ ] K8s 滚动更新零停机
  - [ ] HPA 自动扩缩容生效
  - [ ] 蓝绿部署切换成功
  - [ ] Chaos Mesh Pod Kill 后服务自愈
  - [ ] 灾备演练数据一致
  - [ ] 企业微信通知正常
