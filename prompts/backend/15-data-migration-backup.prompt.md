---
name: data-migration-backup
description: 实现数据库迁移+备份+脱敏+恢复
model: claude-4-sonnet
tags: [backend, database, devops]
depends_on: [cicd-deploy]
---

# 任务：实现数据迁移 + 备份 + 脱敏

## 目标
完整的数据库生命周期管理：版本化迁移、自动备份、敏感数据脱敏、灾难恢复。

## 具体步骤

### 1. Prisma 迁移脚本 `bff/prisma/migrations/`

**迁移 1：`20240101000000_init/migration.sql`**
```sql
-- 创建全部 15 张表（见 prisma-schema.prompt.md）
-- 创建索引
CREATE INDEX idx_tasks_geohash ON tasks(geohash);
CREATE INDEX idx_tasks_status_expire ON tasks(status, expire_at);
CREATE INDEX idx_orders_helper_status ON orders(helper_id, status);
CREATE INDEX idx_transactions_wallet_created ON transactions(wallet_id, created_at);
CREATE INDEX idx_reviews_reviewee_rating ON reviews(reviewee_id, rating);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
```

**迁移 2：`20240115000000_add_audit_fields/migration.sql`**
```sql
ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL;
ALTER TABLE users ADD COLUMN login_count INT DEFAULT 0;
ALTER TABLE tasks ADD COLUMN view_count INT DEFAULT 0;
ALTER TABLE orders ADD COLUMN refund_reason VARCHAR(500) NULL;
```

**迁移 3：`20240201000000_optimize_indexes/migration.sql`**
```sql
-- 复合索引优化查询
CREATE INDEX idx_tasks_category_status_created ON tasks(category, status, created_at DESC);
CREATE INDEX idx_orders_status_created ON orders(status, created_at DESC);
-- 分区表（按月份）
ALTER TABLE transactions PARTITION BY RANGE (YEAR(created_at)*100 + MONTH(created_at)) (
  PARTITION p202401 VALUES LESS THAN (202402),
  PARTITION p202402 VALUES LESS THAN (202403),
  PARTITION p202403 VALUES LESS THAN (202404),
  PARTITION pmax VALUES LESS THAN MAXVALUE
);
```

### 2. 备份脚本 `scripts/backup.sh`
```bash
#!/bin/bash
set -e

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/mysql"
S3_BUCKET="s3://nh-backups/mysql"
RETENTION_DAYS=30

echo "📦 开始备份 - $DATE"

# 1. 全量备份（mysqldump）
mysqldump \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --all-databases \
  --hex-blob \
  --set-charset \
  --default-character-set=utf8mb4 \
  -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASSWORD \
  | gzip > "$BACKUP_DIR/full_$DATE.sql.gz"

# 2. 上传到 S3 / COS
aws s3 cp "$BACKUP_DIR/full_$DATE.sql.gz" "$S3_BUCKET/full/"

# 3. 增量备份（Binlog）
mysql -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASSWORD \
  -e "FLUSH BINARY LOGS;"
# 复制当前 binlog 到备份目录
cp /var/lib/mysql/mysql-bin.* "$BACKUP_DIR/binlog_$DATE/"

# 4. 清理旧备份
find "$BACKUP_DIR" -name "full_*.sql.gz" -mtime +$RETENTION_DAYS -delete
aws s3 ls "$S3_BUCKET/full/" | awk '{print $4}' | while read f; do
  FILE_DATE=$(echo $f | sed 's/full_\([0-9_]*\)\.sql\.gz/\1/')
  FILE_EPOCH=$(date -d "${FILE_DATE:0:8}" +%s)
  NOW_EPOCH=$(date +%s)
  DIFF=$(( (NOW_EPOCH - FILE_EPOCH) / 86400 ))
  if [ $DIFF -gt $RETENTION_DAYS ]; then
    aws s3 rm "$S3_BUCKET/full/$f"
  fi
done

# 5. 验证备份完整性
gunzip -c "$BACKUP_DIR/full_$DATE.sql.gz" | tail -5 | grep -q "Dump completed"
if [ $? -eq 0 ]; then
  echo "✅ 备份验证通过"
  # 写入备份记录
  echo "$DATE,$S3_BUCKET/full/full_$DATE.sql.gz,$(ls -la $BACKUP_DIR/full_$DATE.sql.gz | awk '{print $5}')" \
    >> "$BACKUP_DIR/backup_log.csv"
else
  echo "❌ 备份验证失败"
  exit 1
fi

echo "✅ 备份完成 - $(date)"
```

### 3. 数据脱敏脚本 `scripts/anonymize.ts`
```typescript
// 脱敏工具：用于测试环境数据导出
import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

async function anonymize() {
  console.log('🔒 开始数据脱敏...');
  
  // 1. 脱敏用户表
  const users = await prisma.user.findMany();
  for (const user of users) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        phone: faker.phone.number().replace(/[^0-9]/g, '').padEnd(11, '0').slice(0, 11),
        nickname: faker.person.firstName() + faker.person.lastName(),
        avatar: 'https://placeholder.com/avatar.png',
      }
    });
  }
  console.log(`✅ 已脱敏 ${users.length} 条用户记录`);
  
  // 2. 脱敏地址（任务表）
  const tasks = await prisma.task.findMany();
  for (const task of tasks) {
    await prisma.task.update({
      where: { id: task.id },
      data: {
        address: faker.location.streetAddress(),
        description: faker.lorem.paragraph().slice(0, 500),
      }
    });
  }
  console.log(`✅ 已脱敏 ${tasks.length} 条任务记录`);
  
  // 3. 脱敏交易金额（保留统计意义）
  const transactions = await prisma.transaction.findMany();
  for (const tx of transactions) {
    const fakeAmount = parseFloat(faker.commerce.price(1, 1000, 2));
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { amount: fakeAmount }
    });
  }
  console.log(`✅ 已脱敏 ${transactions.length} 条交易记录`);
  
  // 4. 清除敏感字段
  await prisma.$executeRaw`UPDATE users SET phone = NULL WHERE phone NOT REGEXP '^1[0-9]{10}$'`;
  
  console.log('🎉 脱敏完成！数据可安全用于测试环境');
}

anonymize().catch(console.error).finally(() => prisma.$disconnect());
```

### 4. 恢复脚本 `scripts/restore.sh`
```bash
#!/bin/bash
set -e

BACKUP_FILE=$1
if [ -z "$BACKUP_FILE" ]; then
  echo "用法: $0 <backup_file.sql.gz>"
  echo "可用备份:"
  aws s3 ls s3://nh-backups/mysql/full/ | sort -r | head -20
  exit 1
fi

echo "⚠️  即将恢复数据库: $BACKUP_FILE"
echo "目标数据库: $MYSQL_DATABASE"
read -p "确认恢复？(yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "已取消"
  exit 0
fi

# 1. 下载备份
echo "📥 下载备份文件..."
if [[ "$BACKUP_FILE" == s3://* ]]; then
  aws s3 cp "$BACKUP_FILE" /tmp/restore.sql.gz
else
  cp "$BACKUP_FILE" /tmp/restore.sql.gz
fi

# 2. 验证文件完整性
echo "🔍 验证备份文件..."
gunzip -c /tmp/restore.sql.gz | head -5 | grep -q "MySQL dump"
if [ $? -ne 0 ]; then
  echo "❌ 备份文件损坏或格式错误"
  exit 1
fi

# 3. 创建恢复前的自动备份
echo "📦 创建恢复前快照..."
mysqldump --single-transaction -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASSWORD \
  $MYSQL_DATABASE | gzip > "/tmp/pre_restore_$(date +%Y%m%d_%H%M%S).sql.gz"

# 4. 执行恢复
echo "🔄 开始恢复..."
gunzip -c /tmp/restore.sql.gz | mysql \
  -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASSWORD \
  $MYSQL_DATABASE

# 5. 验证恢复结果
echo "✅ 验证恢复结果..."
TABLE_COUNT=$(mysql -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASSWORD \
  -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$MYSQL_DATABASE'" -N)
echo "恢复完成，共 $TABLE_COUNT 张表"

# 6. 清理
rm -f /tmp/restore.sql.gz

echo "🎉 数据库恢复完成！"
```

### 5. Cron 定时任务 `deploy/cron/backup-cron`
```cron
# 每日凌晨 3 点全量备份
0 3 * * * /scripts/backup.sh >> /var/log/backup.log 2>&1

# 每 6 小时增量备份
0 */6 * * * /scripts/binlog-backup.sh >> /var/log/binlog-backup.log 2>&1

# 每周日验证备份完整性
0 4 * * 0 /scripts/verify-backup.sh >> /var/log/verify.log 2>&1

# 每月 1 号清理旧备份
0 5 1 * * /scripts/cleanup-old-backups.sh >> /var/log/cleanup.log 2>&1
```

### 6. Docker Compose 追加备份服务
```yaml
# 追加到 docker-compose.yml
backup:
  image: mysql:8.0
  container_name: nh-backup
  volumes:
    - ./scripts:/scripts
    - backup_data:/backup
  environment:
    - MYSQL_HOST=mysql
    - MYSQL_USER=root
    - MYSQL_PASSWORD=${MYSQL_PASSWORD}
    - MYSQL_DATABASE=neighborhood_help
    - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
    - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
  entrypoint: ["sh", "/scripts/backup.sh"]
  depends_on:
    - mysql
  restart: unless-stopped
```

### 7. 数据导出 API（GDPR 合规）`src/modules/user/gdpr.controller.ts`
```typescript
@Get('data-export')
@UseGuards(JwtAuthGuard)
async exportUserData(@Req() req, @Res() res: Response) {
  const userId = req.user.sub;
  
  // 1. 收集用户全部数据
  const [user, tasks, orders, reviews, transactions, tickets] = await Promise.all([
    this.prisma.user.findUnique({ where: { id: userId } }),
    this.prisma.task.findMany({ where: { publisherId: userId } }),
    this.prisma.order.findMany({ where: { helperId: userId } }),
    this.prisma.review.findMany({ where: { OR: [{ reviewerId: userId }, { revieweeId: userId }] } }),
    this.prisma.transaction.findMany({
      where: { wallet: { userId } }
    }),
    this.prisma.ticket.findMany({ where: { userId } })
  ]);
  
  // 2. 组装 JSON
  const exportData = {
    exportDate: new Date().toISOString(),
    user: { ...user, password: undefined, openid: undefined },
    tasks,
    orders,
    reviews,
    transactions,
    tickets
  };
  
  // 3. AES 加密
  const encrypted = this.encrypt(JSON.stringify(exportData));
  
  // 4. 上传到 COS（临时 URL）
  const key = `gdpr-exports/${userId}/${Date.now()}.json`;
  await this.cos.putObject({
    Bucket: this.config.get('COS_BUCKET'),
    Key: key,
    Body: encrypted,
    Expires: 3600 // 1小时有效
  });
  
  const url = await this.cos.getSignedUrl('getObject', {
    Bucket: this.config.get('COS_BUCKET'),
    Key: key,
    Expires: 3600
  });
  
  return { downloadUrl: url, expiresIn: 3600 };
}

// 数据删除（GDPR 被遗忘权）
@Delete('account')
@UseGuards(JwtAuthGuard)
async deleteAccount(@Req() req) {
  const userId = req.user.sub;
  
  // 1. 匿名化而非物理删除（保留交易记录合规）
  await this.prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        phone: null,
        nickname: '已注销用户',
        avatar: null,
        status: 'DELETED',
        deletedAt: new Date()
      }
    });
    // 清除钱包
    await tx.wallet.update({
      where: { userId },
      data: { balance: 0, frozen: 0 }
    });
  });
  
  // 2. 清除 Redis 会话
  await this.redis.del(`session:${userId}`);
  await this.redis.del(`online:${userId}`);
  
  return { message: '账号已注销，数据已匿名化' };
}
```

### 8. 对应需求条目
#69, #70, #96, #97, #98, #99

## 验收标准
- [ ] 迁移脚本可重复执行（幂等）
- [ ] 全量备份自动上传 S3/COS
- [ ] 增量备份（Binlog）正常
- [ ] 恢复脚本验证通过
- [ ] 脱敏后数据保留统计特征
- [ ] GDPR 导出接口返回加密文件
- [ ] 账号注销后数据匿名化
- [ ] Cron 定时任务生效
- [ ] 备份保留 30 天自动清理

## 参考文件
- `specs/01-auth.md` → 数据安全
- `specs/06-ops.md` → 数据导出
- `.trae/memory.md` → 禁止事项 #5（禁止删除数据）
