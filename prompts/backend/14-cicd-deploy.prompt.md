---
name: cicd-deploy
description: 实现完整 CI/CD 流水线（测试+构建+部署+混沌工程）
model: claude-4-opus
tags: [backend, devops]
depends_on: [monitoring-logging]
---

# 任务：实现 CI/CD 全链路

## 目标
自动化测试 → 构建 → 安全扫描 → 部署 → 混沌演练。

## 具体步骤

### 1. GitHub Actions 主流程 `.github/workflows/main.yml`
```yaml
name: Full Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  REGISTRY: ${{ secrets.ACR_REGISTRY }}
  NAMESPACE: neighborhood-help

jobs:
  # ===== 并行测试 =====
  test-frontend:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: frontend } }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm type-check
      - run: pnpm test -- --coverage --maxWorkers=2
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: frontend/coverage/lcov.info
          flags: frontend

  test-bff:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: bff } }
    services:
      mysql:
        image: mysql:8.0
        env: { MYSQL_ROOT_PASSWORD: test, MYSQL_DATABASE: test }
        ports: ['3306:3306']
        options: --health-cmd="mysqladmin ping" --health-timeout=5s
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma migrate deploy
      - run: pnpm test -- --coverage --maxWorkers=2
      - name: SonarQube Scan
        uses: sonarsource/sonarqube-scan-action@v2
        with:
          projectBaseDir: bff
          args: >
            -Dsonar.projectKey=nh-bff
            -Dsonar.sources=src
            -Dsonar.tests=test
            -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info

  test-risk:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: backend/risk-service } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      - run: go test -v -race -coverprofile=coverage.out ./...
      - run: go vet ./...
      - name: Upload coverage
        run: bash <(curl -s https://codecov.io/bash) -f coverage.out

  test-admin:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: backend/admin-service } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with: { java-version: '21', distribution: 'temurin' }
      - run: mvn test
      - name: JaCoCo
        run: mvn jacoco:report

  # ===== 安全扫描（并行） =====
  security-scan:
    needs: [test-frontend, test-bff, test-risk, test-admin]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Snyk 依赖漏洞扫描
      - uses: snyk/actions/node@master
        with: { args: '--severity-threshold=high' }
        env: { SNYK_TOKEN: ${{ secrets.SNYK_TOKEN } }
      # Trivy 容器扫描
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@0.20.0
        with:
          scan-type: 'fs'
          scan-ref: '.'
          severity: 'CRITICAL,HIGH'
          exit-code: '1'

  # ===== 构建 + 推送镜像 =====
  build-and-push:
    needs: [security-scan]
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [bff, risk-service, admin-service, admin-web]
    steps:
      - uses: actions/checkout@v4
      - name: Log in to ACR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ secrets.ACR_USERNAME }}
          password: ${{ secrets.ACR_PASSWORD }}
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: ${{ matrix.service == 'admin-web' && 'admin-web' || format('backend/{0}', matrix.service) }}
          file: ${{ matrix.service == 'admin-web' && 'admin-web/Dockerfile' || format('backend/{0}/Dockerfile', matrix.service) }}
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.NAMESPACE }}/${{ matrix.service }}:${{ github.sha }}
            ${{ env.REGISTRY }}/${{ env.NAMESPACE }}/${{ matrix.service }}:latest
          cache-from: type=registry,ref=${{ env.REGISTRY }}/${{ env.NAMESPACE }}/${{ matrix.service }}:latest
          cache-to: type=registry,ref=${{ env.REGISTRY }}/${{ env.NAMESPACE }}/${{ matrix.service }}:latest,mode=max

  # ===== 部署到 K8s =====
  deploy-staging:
    needs: build-and-push
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to ACK Staging
        run: |
          echo "${{ secrets.KUBECONFIG_STAGING }}" > kubeconfig
          export KUBECONFIG=kubeconfig
          kubectl set image deployment/bff bff=${{ env.REGISTRY }}/${{ env.NAMESPACE }}/bff:${{ github.sha }}
          kubectl set image deployment/risk risk=${{ env.REGISTRY }}/${{ env.NAMESPACE }}/risk-service:${{ github.sha }}
          kubectl set image deployment/admin admin=${{ env.REGISTRY }}/${{ env.NAMESPACE }}/admin-service:${{ github.sha }}
          kubectl rollout status deployment/bff --timeout=300s
          kubectl rollout status deployment/risk --timeout=300s
          kubectl rollout status deployment/admin --timeout=300s

  deploy-production:
    needs: deploy-staging
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      # 蓝绿部署
      - name: Blue-Green Deploy
        run: |
          echo "${{ secrets.KUBECONFIG_PROD }}" > kubeconfig
          export KUBECONFIG=kubeconfig
          
          # 部署到 green
          kubectl set image deployment/bff-green bff=${{ env.REGISTRY }}/${{ env.NAMESPACE }}/bff:${{ github.sha }}
          kubectl rollout status deployment/bff-green --timeout=600s
          
          # 健康检查
          kubectl exec deploy/bff-green -- curl -s http://localhost:3000/health
          
          # 切换流量
          kubectl patch service bff-svc -p '{"spec":{"selector":{"version":"green"}}}'
          
          # 等待 5 分钟观察
          sleep 300
          
          # 确认无异常 → 更新 blue
          kubectl set image deployment/bff bff=${{ env.REGISTRY }}/${{ env.NAMESPACE }}/bff:${{ github.sha }}

  # ===== 混沌工程 =====
  chaos-engineering:
    needs: deploy-production
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - name: Install Chaos Mesh
        run: |
          curl -sSL https://mirrors.chaos-mesh.org/latest/install.sh | bash
          kubectl wait --namespace chaos-testing --for=condition=ready pod --selector=app.kubernetes.io/instance=chaos-mesh --timeout=120s
      - name: Run Chaos Experiments
        run: |
          # Pod Kill 实验
          kubectl apply -f - <<EOF
          apiVersion: chaos-mesh.org/v1alpha1
          kind: PodChaos
          metadata:
            name: kill-bff-pod
            namespace: production
          spec:
            selector:
              labelSelectors:
                app: bff
            mode: one
            action: pod-kill
            scheduler:
              cron: "@every 5m"
            duration: "10m"
          EOF
          
          # Network Loss 实验
          kubectl apply -f - <<EOF
          apiVersion: chaos-mesh.org/v1alpha1
          kind: NetworkChaos
          metadata:
            name: network-loss-bff
            namespace: production
          spec:
            selector:
              labelSelectors:
                app: bff
            mode: all
            action: loss
            loss:
              loss: "30"
            duration: "5m"
          EOF
          
          # 观察 15 分钟
          sleep 900
          
          # 清理
          kubectl delete podchaos kill-bff-pod -n production
          kubectl delete networkchaos network-loss-bff -n production
      - name: Verify Recovery
        run: |
          # 检查服务是否自愈
          curl -s https://api.neighborhood-help.com/health | grep -q "ok"
          echo "Service recovered successfully"

  # ===== 通知 =====
  notify:
    needs: [deploy-production, chaos-engineering]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Notify WeChat Work
        run: |
          curl -X POST "${{ secrets.WECOM_BOT_URL }}" \
            -H "Content-Type: application/json" \
            -d '{
              "msgtype": "markdown",
              "markdown": {
                "content": "## 🚀 部署完成\n> Commit: ${{ github.sha }}\n> Author: ${{ github.actor }}\n> Status: ${{ job.status }}"
              }
            }'
```

### 2. Dockerfile 多阶段构建 `backend/risk-service/Dockerfile`
```dockerfile
# ---- Build Stage ----
FROM golang:1.22-alpine AS builder
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o risk-service ./cmd/main.go

# ---- Security Scan Stage ----
FROM aquasec/trivy:latest AS security
COPY --from=builder /build/risk-service /risk-service
RUN trivy fs --exit-code 1 --severity HIGH,CRITICAL /risk-service

# ---- Runtime Stage ----
FROM alpine:3.19
RUN apk --no-cache add ca-certificates tzdata
ENV TZ=Asia/Shanghai
ENV USER=appuser
RUN addgroup -S $USER && adduser -S $USER -G $USER
WORKDIR /app
COPY --from=builder /build/risk-service .
RUN chown -R $USER:$USER /app
USER $USER
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1
CMD ["./risk-service"]
```

### 3. Kubernetes 部署 `deploy/k8s/bff-deployment.yaml`
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bff
  labels:
    app: bff
    version: blue
spec:
  replicas: 3
  selector:
    matchLabels:
      app: bff
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: bff
        version: blue
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchExpressions:
                    - key: app
                      operator: In
                      values: [bff]
                topologyKey: kubernetes.io/hostname
      terminationGracePeriodSeconds: 30
      containers:
        - name: bff
          image: nh-registry.tencentcloudcr.com/neighborhood-help/bff:latest
          ports:
            - containerPort: 3000
          envFrom:
            - secretRef:
                name: bff-secrets
            - configMapRef:
                name: bff-config
          resources:
            requests:
              cpu: 250m
              memory: 512Mi
            limits:
              cpu: "2"
              memory: 2Gi
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            readOnlyRootFilesystem: true
            allowPrivilegeEscalation: false
          lifecycle:
            preStop:
              exec:
                command: ["sleep", "10"]
---
apiVersion: v1
kind: Service
metadata:
  name: bff-svc
spec:
  selector:
    app: bff
    version: blue
  ports:
    - port: 80
      targetPort: 3000
  type: ClusterIP
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: bff-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: bff
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 2
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Pods
          value: 1
          periodSeconds: 120
```

### 4. 灾备脚本 `scripts/disaster-recovery.sh`
```bash
#!/bin/bash
# 灾备演练脚本
set -e

echo "🚨 开始灾备演练 - $(date)"

# 1. 模拟主库宕机
echo "📌 步骤1: 模拟 MySQL 主库故障"
kubectl delete pod -l app=mysql,role=master --grace-period=0

# 2. 验证从库提升
echo "📌 步骤2: 验证从库自动提升为主库"
sleep 30
kubectl exec deploy/mysql-replica -- mysql -e "SHOW SLAVE STATUS\G" | grep "Slave_IO_Running"

# 3. 验证服务连续性
echo "📌 步骤3: 验证 API 可用性"
for i in {1..10}; do
  curl -sf https://api.neighborhood-help.com/health || { echo "❌ 健康检查失败"; exit 1; }
  echo "✅ 健康检查通过 ($i/10)"
  sleep 5
done

# 4. 恢复主库
echo "📌 步骤4: 恢复主库"
kubectl scale deploy/mysql --replicas=1
sleep 30

# 5. 数据一致性校验
echo "📌 步骤5: 校验数据一致性"
kubectl exec deploy/mysql -- mysql -e "
  SELECT COUNT(*) FROM neighborhood_help.tasks;
  SELECT COUNT(*) FROM neighborhood_help.orders;
  SELECT COUNT(*) FROM neighborhood_help.wallets;
"

echo "✅ 灾备演练完成 - $(date)"
```

### 5. 对应需求条目
#71, #72, #73, #74, #79, #80, #81, #82, #87, #88, #89, #90, #99, #100

## 验收标准
- [ ] 所有测试通过（前端/BFF/Go/Java 覆盖率 > 80%）
- [ ] Snyk 无高危漏洞
- [ ] Trivy 扫描无 CRITICAL
- [ ] Docker 镜像多阶段构建（< 100MB）
- [ ] K8s 滚动更新零停机
- [ ] HPA 自动扩缩容生效
- [ ] 蓝绿部署切换成功
- [ ] Chaos Mesh Pod Kill 后服务自愈
- [ ] 灾备演练数据一致
- [ ] 企业微信通知正常

## 参考文件
- `specs/06-ops.md` → 全部章节
- `.trae/memory.md` → ADR + 禁止事项
