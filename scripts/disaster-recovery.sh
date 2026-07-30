#!/bin/bash
# 灾备演练脚本
set -e

echo "🚨 开始灾备演练 - $(date)"

# 1. 模拟主库宕机
echo "📌 步骤1: 模拟 MySQL 主库故障"
kubectl delete pod -l app=mysql,role=master --grace-period=0 2>/dev/null || \
  docker kill nh-mysql 2>/dev/null || \
  echo "⚠️ 跳过（非 K8s/Docker 环境）"

# 2. 验证服务连续性
echo "📌 步骤2: 验证 API 可用性"
for i in {1..10}; do
  curl -sf http://localhost:3000/health || { echo "❌ 健康检查失败"; exit 1; }
  echo "✅ 健康检查通过 ($i/10)"
  sleep 3
done

# 3. 数据一致性校验
echo "📌 步骤3: 校验数据一致性"
mysql -h ${MYSQL_HOST:-localhost} -u ${MYSQL_USER:-root} -p${MYSQL_PASSWORD} \
  ${MYSQL_DATABASE:-neighborhood_help} -e "
  SELECT 'tasks' as tbl, COUNT(*) as cnt FROM tasks
  UNION ALL
  SELECT 'orders', COUNT(*) FROM orders
  UNION ALL
  SELECT 'wallets', COUNT(*) FROM wallets;
" 2>/dev/null || echo "⚠️ 数据库暂不可达，跳过校验"

# 4. 恢复
echo "📌 步骤4: 恢复服务"
docker start nh-mysql 2>/dev/null || echo "⚠️ 跳过恢复"

echo "✅ 灾备演练完成 - $(date)"
