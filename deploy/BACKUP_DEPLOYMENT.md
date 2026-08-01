# 生产环境部署指南

> 本指南详细说明如何在生产环境配置数据库备份定时任务
> 
> 覆盖方式：**Docker Compose** | **宿主机 Cron** | **K8s CronJob** | **腾讯云 SCF**

---

## 目录

1. [前置条件](#1-前置条件)
2. [方式一：Docker Compose（推荐）](#2-方式一docker-compose)
3. [方式二：宿主机 Cron](#3-方式二宿主机-cron)
4. [方式三：Kubernetes CronJob](#4-方式三kubernetes-cronjob)
5. [方式四：腾讯云 SCF](#5-方式四腾讯云-scf)
6. [环境变量配置](#6-环境变量配置)
7. [日志管理](#7-日志管理)
8. [监控告警](#8-监控告警)
9. [故障排查](#9-故障排查)

---

## 1. 前置条件

### 1.1 基础要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Linux (Ubuntu 20.04+ / CentOS 7+) |
| Docker | 20.10+ |
| MySQL | 8.0+ |
| 磁盘空间 | ≥ 10GB（用于本地备份存储） |
| 网络 | 能访问 MySQL 主库（端口 3306） |

### 1.2 可选组件

| 组件 | 用途 | 安装文档 |
|------|------|----------|
| coscmd | 上传备份到腾讯云 COS | [COS 官方文档](https://cloud.tencent.com/document/product/436/10976) |
| Prometheus | 备份任务监控 | [Prometheus 官方文档](https://prometheus.io/docs/introduction/overview/) |
| Alertmanager | 告警通知（邮件/钉钉/企微） | [Alertmanager 官方文档](https://prometheus.io/docs/alerting/latest/overview/) |

### 1.3 安全建议

```bash
# 1. 创建专用备份账号（不要用 root）
mysql -uroot -p -e "
CREATE USER 'backup'@'%' IDENTIFIED BY 'strong_password_here';
GRANT SELECT, SHOW VIEW, EVENT, TRIGGER ON neighborhood_help.* TO 'backup'@'%';
FLUSH PRIVILEGES;
"

# 2. 创建备份目录并设置权限
mkdir -p /backup/mysql
chown -R mysql:mysql /backup/mysql
chmod 750 /backup/mysql

# 3. 禁止密码在命令行出现（可选）
# 使用 ~/.my.cnf 存储凭据
cat > ~/.my.cnf << EOF
[client]
user=backup
password=strong_password_here
host=mysql
EOF
chmod 600 ~/.my.cnf
```

---

## 2. 方式一：Docker Compose

### 2.1 架构

```
┌─────────────────────────────────────────────┐
│               Docker Host                    │
│                                              │
│  ┌──────────┐     ┌──────────────────────┐  │
│  │ MySQL    │────▶│  Backup Container   │  │
│  │ Container│     │  (基于 mysql:8.0)   │  │
│  └──────────┘     │                     │  │
│                   │  - crond 守护进程    │  │
│                   │  - /scripts/ 挂载    │  │
│                   │  - /backup/ 数据卷   │  │
│                   └──────────────────────┘  │
│                            │                 │
│                            ▼                 │
│                   ┌──────────────────────┐  │
│                   │  COS (可选)          │  │
│                   └──────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 2.2 docker-compose.backup.yml

创建独立的备份服务配置文件：

```yaml
# docker-compose.backup.yml
# 独立备份服务，可单独启动

version: '3.8'

services:
  backup-scheduler:
    image: mysql:8.0
    container_name: nh-backup-scheduler
    restart: unless-stopped
    
    # 挂载脚本目录和备份卷
    volumes:
      - ./scripts:/scripts:ro          # 只读挂载脚本
      - backup_data:/backup/mysql       # 持久化备份存储
      - ./deploy/cron:/etc/cron.d:ro   # Cron 配置
    
    # 环境变量
    environment:
      - MYSQL_HOST=mysql
      - MYSQL_USER=backup
      - MYSQL_PASSWORD=${MYSQL_PASSWORD}
      - MYSQL_DATABASE=neighborhood_help
      - TZ=Asia/Shanghai
      # 可选：腾讯云 COS
      - COS_SECRET_ID=${COS_SECRET_ID}
      - COS_SECRET_KEY=${COS_SECRET_KEY}
      - COS_BUCKET=${COS_BUCKET:-neighborhood-help-1250000000}
    
    # 安装 cron + coscmd，然后启动 cron 守护进程
    command: >
      bash -c "
        apt-get update &&
        apt-get install -y cron python3-pip &&
        pip3 install coscmd &&
        coscmd config --secret_id=\${COS_SECRET_ID} --secret_key=\${COS_SECRET_KEY} --region=ap-guangzhou &&
        cp /etc/cron.d/backup-cron /etc/cron.d/backup-cron &&
        chmod 0644 /etc/cron.d/backup-cron &&
        touch /var/log/backup.log /var/log/binlog-backup.log /var/log/verify.log /var/log/cleanup.log &&
        crontab /etc/cron.d/backup-cron &&
        cron -f
      "
    
    # 依赖 MySQL 服务
    depends_on:
      mysql:
        condition: service_healthy
    
    # 健康检查
    healthcheck:
      test: ["CMD", "bash", "-c", "pgrep cron || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

  backup-executor:
    image: mysql:8.0
    container_name: nh-backup-executor
    profiles: ["executor"]  # 手动执行时启动
    volumes:
      - ./scripts:/scripts:ro
      - backup_data:/backup/mysql
    environment:
      - MYSQL_HOST=mysql
      - MYSQL_USER=backup
      - MYSQL_PASSWORD=${MYSQL_PASSWORD}
      - MYSQL_DATABASE=neighborhood_help
    depends_on:
      mysql:
        condition: service_healthy
    # 按需手动执行：docker compose --profile executor run backup-executor bash /scripts/backup.sh

volumes:
  backup_data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/backup/mysql  # 宿主机路径
```

### 2.3 Cron 配置文件

```bash
# deploy/cron/backup-cron
# 注意：修改后需重启容器生效

# 环境变量（cron 不会读取 .env，需显式声明）
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MYSQL_HOST=mysql
MYSQL_USER=backup
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=neighborhood_help
TZ=Asia/Shanghai

# 每日 03:00 全量备份
0 3 * * * root bash /scripts/backup.sh >> /var/log/backup.log 2>&1

# 每 6 小时增量备份
0 */6 * * * root bash /scripts/binlog-backup.sh >> /var/log/binlog-backup.log 2>&1

# 每周日 04:00 验证备份
0 4 * * 0 root bash /scripts/verify-backup.sh >> /var/log/verify.log 2>&1

# 每月 1 号 05:00 清理旧备份
0 5 1 * * root bash /scripts/cleanup-old-backups.sh >> /var/log/cleanup.log 2>&1
```

### 2.4 部署步骤

```bash
# 1. 创建宿主机备份目录
sudo mkdir -p /data/backup/mysql
sudo chown -R 999:999 /data/backup/mysql  # mysql 容器内 uid=999

# 2. 修改环境变量
cp .env.production .env
# 编辑 MYSQL_PASSWORD, COS_SECRET_ID, COS_SECRET_KEY

# 3. 修改 Cron 配置中的密码（不能从 .env 读取）
#    编辑 deploy/cron/backup-cron，替换 MYSQL_PASSWORD=your_password

# 4. 启动备份调度器
docker compose -f docker-compose.backup.yml up -d

# 5. 查看日志
docker compose -f docker-compose.backup.yml logs -f backup-scheduler

# 6. 手动执行一次备份（可选）
docker compose -f docker-compose.backup.yml --profile executor run \
  backup-executor bash /scripts/backup.sh

# 7. 验证备份
docker exec nh-mysql bash /scripts/verify-backup.sh
```

### 2.5 查看备份状态

```bash
# 查看备份文件
docker exec nh-backup-scheduler ls -lh /backup/mysql/

# 查看备份日志
docker exec nh-backup-scheduler cat /var/log/backup.log | tail -20

# 查看备份记录
docker exec nh-backup-scheduler cat /backup/mysql/backup_log.csv

# 查看定时任务执行情况
docker exec nh-backup-scheduler crontab -l
docker exec nh-backup-scheduler cat /etc/cron.d/backup-cron
```

---

## 3. 方式二：宿主机 Cron

### 3.1 适用场景

- 单机部署
- 不想额外运行备份容器
- 直接在 MySQL 服务器上执行

### 3.2 安装步骤

```bash
# 1. 安装 cron（如未安装）
# Ubuntu/Debian
sudo apt-get update && sudo apt-get install -y cron

# CentOS/RHEL
sudo yum install -y crontabs

# 2. 安装 coscmd（可选）
pip3 install coscmd
coscmd config --secret_id=YOUR_SECRET_ID --secret_key=YOUR_SECRET_KEY --region=ap-guangzhou

# 3. 创建脚本目录
sudo mkdir -p /opt/backup/scripts
sudo mkdir -p /data/backup/mysql

# 4. 复制脚本
sudo cp scripts/backup.sh /opt/backup/scripts/
sudo cp scripts/binlog-backup.sh /opt/backup/scripts/
sudo cp scripts/verify-backup.sh /opt/backup/scripts/
sudo cp scripts/cleanup-old-backups.sh /opt/backup/scripts/
sudo cp scripts/restore.sh /opt/backup/scripts/

# 5. 设置权限
sudo chmod +x /opt/backup/scripts/*.sh
sudo chown -R backup:backup /opt/backup /data/backup/mysql

# 6. 创建备份配置文件
sudo cat > /opt/backup/env.conf << 'EOF'
# MySQL 连接
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=backup
MYSQL_PASSWORD=strong_password
MYSQL_DATABASE=neighborhood_help

# 备份路径
BACKUP_DIR=/data/backup/mysql

# 保留天数
RETENTION_DAYS=30

# 时区
TZ=Asia/Shanghai
EOF
sudo chmod 600 /opt/backup/env.conf
```

### 3.3 脚本修改

```bash
# 修改 backup.sh 头部，加载配置
# 在 #!/bin/bash 之后添加：

source /opt/backup/env.conf

# 如果你不想修改原脚本，可以创建 wrapper：
sudo cat > /opt/backup/run-backup.sh << 'EOF'
#!/bin/bash
source /opt/backup/env.conf
export MYSQL_HOST MYSQL_PORT MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE
cd /opt/backup/scripts
exec bash backup.sh
EOF
sudo chmod +x /opt/backup/run-backup.sh

# 同样创建其他 wrapper
sudo cat > /opt/backup/run-verify.sh << 'EOF'
#!/bin/bash
source /opt/backup/env.conf
cd /opt/backup/scripts
exec bash verify-backup.sh
EOF

sudo cat > /opt/backup/run-cleanup.sh << 'EOF'
#!/bin/bash
source /opt/backup/env.conf
cd /opt/backup/scripts
exec bash cleanup-old-backups.sh
EOF
```

### 3.4 配置 Cron

```bash
# 编辑 root 或 backup 用户的 crontab
sudo crontab -u backup -e

# 添加以下内容：

# 环境变量
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 每日 03:00 全量备份
0 3 * * * /opt/backup/run-backup.sh >> /var/log/backup.log 2>&1

# 每 6 小时增量备份
0 */6 * * * bash /opt/backup/scripts/binlog-backup.sh >> /var/log/binlog-backup.log 2>&1

# 每周日 04:00 验证备份
0 4 * * 0 /opt/backup/run-verify.sh >> /var/log/verify.log 2>&1

# 每月 1 号 05:00 清理旧备份
0 5 1 * * * /opt/backup/run-cleanup.sh >> /var/log/cleanup.log 2>&1
```

### 3.5 管理命令

```bash
# 查看当前 cron 任务
crontab -l

# 查看 cron 服务状态
sudo service cron status    # Ubuntu
sudo systemctl status crond # CentOS

# 重启 cron 服务
sudo service cron restart
sudo systemctl restart crond

# 实时查看日志
tail -f /var/log/backup.log

# 查看备份状态
ls -lh /data/backup/mysql/
cat /data/backup/mysql/backup_log.csv

# 手动执行备份
/opt/backup/run-backup.sh

# 手动验证
/opt/backup/run-verify.sh

# 手动恢复
cd /opt/backup/scripts
bash restore.sh /data/backup/mysql/full_YYYYMMDD_HHMMSS.sql.gz
```

---

## 4. 方式三：Kubernetes CronJob

### 4.1 架构

```
┌─────────────────────────────────────────┐
│              Kubernetes Cluster          │
│                                          │
│  ┌──────────┐     ┌──────────────────┐  │
│  │  MySQL   │     │  CronJob         │  │
│  │  Pod     │────▶│  ┌────────────┐  │  │
│  └──────────┘     │  │ Backup Pod │  │  │
│                   │  │ (Job)      │  │  │
│  ┌──────────┐     │  └────────────┘  │  │
│  │  PVC     │◀────│  备份写入 PVC   │  │  │
│  │ (Backup) │     └──────────────────┘  │
│  └──────────┘              │             │
│                            ▼             │
│                   ┌──────────────────┐  │
│                   │  COS / S3        │  │
│                   └──────────────────┘  │
└─────────────────────────────────────────┘
```

### 4.2 部署文件

```yaml
# k8s/backup-cronjob.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: backup
---
apiVersion: v1
kind: Secret
metadata:
  name: mysql-backup-secret
  namespace: backup
type: Opaque
stringData:
  MYSQL_PASSWORD: "your_password"
  MYSQL_USER: "backup"
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: backup-storage
  namespace: backup
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 50Gi
  storageClassName: standard
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: mysql-full-backup
  namespace: backup
  labels:
    app: backup
    type: full
spec:
  schedule: "0 3 * * *"  # 每日 03:00
  timeZone: "Asia/Shanghai"
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 7
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 1
      activeDeadlineSeconds: 3600  # 1 小时超时
      template:
        spec:
          restartPolicy: OnFailure
          securityContext:
            runAsUser: 999
            fsGroup: 999
          containers:
            - name: backup
              image: mysql:8.0
              command:
                - bash
                - -c
                - |
                  set -e
                  DATE=$(date +%Y%m%d_%H%M%S)
                  BACKUP_DIR="/backup/mysql"
                  DB_NAME="${MYSQL_DATABASE}"
                  
                  mkdir -p "$BACKUP_DIR"
                  
                  mysqldump \
                    --single-transaction \
                    --routines --triggers --events \
                    --databases "$DB_NAME" \
                    --hex-blob --set-charset \
                    --default-character-set=utf8mb4 \
                    -h "${MYSQL_HOST}" -u "${MYSQL_USER}" -p"${MYSQL_PASSWORD}" \
                    | gzip > "$BACKUP_DIR/full_$DATE.sql.gz"
                  
                  if gunzip -c "$BACKUP_DIR/full_$DATE.sql.gz" | tail -5 | grep -q "Dump completed"; then
                    echo "✅ 备份成功: full_$DATE.sql.gz"
                    echo "$DATE,full_$DATE.sql.gz,$(stat -c%s "$BACKUP_DIR/full_$DATE.sql.gz")" >> "$BACKUP_DIR/backup_log.csv"
                  else
                    echo "❌ 备份失败"
                    exit 1
                  fi
              env:
                - name: MYSQL_HOST
                  value: "mysql.primary.svc.cluster.local"
                - name: MYSQL_PORT
                  value: "3306"
                - name: MYSQL_DATABASE
                  value: "neighborhood_help"
                - name: MYSQL_USER
                  valueFrom:
                    secretKeyRef:
                      name: mysql-backup-secret
                      key: MYSQL_USER
                - name: MYSQL_PASSWORD
                  valueFrom:
                    secretKeyRef:
                      name: mysql-backup-secret
                      key: MYSQL_PASSWORD
              volumeMounts:
                - name: backup-volume
                  mountPath: /backup/mysql
              resources:
                requests:
                  memory: "256Mi"
                  cpu: "100m"
                limits:
                  memory: "512Mi"
                  cpu: "500m"
          volumes:
            - name: backup-volume
              persistentVolumeClaim:
                claimName: backup-storage
          nodeSelector:
            kubernetes.io/os: linux
---
# 验证 CronJob
apiVersion: batch/v1
kind: CronJob
metadata:
  name: mysql-backup-verify
  namespace: backup
spec:
  schedule: "0 4 * * 0"  # 每周日 04:00
  timeZone: "Asia/Shanghai"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: verify
              image: mysql:8.0
              command:
                - bash
                - -c
                - |
                  BACKUP_DIR="/backup/mysql"
                  LATEST=$(ls -t "$BACKUP_DIR"/full_*.sql.gz 2>/dev/null | head -1)
                  
                  if [ -z "$LATEST" ]; then
                    echo "❌ 未找到备份"
                    exit 1
                  fi
                  
                  if gunzip -c "$LATEST" | tail -5 | grep -q "Dump completed"; then
                    echo "✅ 验证通过: $LATEST"
                  else
                    echo "❌ 验证失败: $LATEST"
                    exit 1
                  fi
              volumeMounts:
                - name: backup-volume
                  mountPath: /backup/mysql
          volumes:
            - name: backup-volume
              persistentVolumeClaim:
                claimName: backup-storage
---
# 清理 CronJob
apiVersion: batch/v1
kind: CronJob
metadata:
  name: mysql-backup-cleanup
  namespace: backup
spec:
  schedule: "0 5 1 * *"  # 每月 1 号 05:00
  timeZone: "Asia/Shanghai"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: cleanup
              image: busybox:stable
              command:
                - sh
                - -c
                - |
                  BACKUP_DIR="/backup/mysql"
                  RETENTION_DAYS=30
                  
                  DELETED=0
                  if [ -d "$BACKUP_DIR" ]; then
                    find "$BACKUP_DIR" -name "full_*.sql.gz" -mtime +$RETENTION_DAYS -delete -print 2>/dev/null | while read f; do
                      echo "🗑️ 已删除: $f"
                      DELETED=$((DELETED + 1))
                    done
                  fi
                  echo "✅ 清理完成，共删除 ${DELETED} 个文件"
              volumeMounts:
                - name: backup-volume
                  mountPath: /backup/mysql
          volumes:
            - name: backup-volume
              persistentVolumeClaim:
                claimName: backup-storage
```

### 4.3 部署和管理

```bash
# 1. 创建命名空间和密钥
kubectl create namespace backup
kubectl create secret generic mysql-backup-secret \
  --namespace backup \
  --from-literal=MYSQL_USER='backup' \
  --from-literal=MYSQL_PASSWORD='your_password'

# 2. 部署所有 CronJob
kubectl apply -f k8s/backup-cronjob.yaml

# 3. 查看 CronJob 状态
kubectl get cronjobs -n backup
kubectl describe cronjob mysql-full-backup -n backup

# 4. 手动触发一次备份
kubectl create job backup-manual --from=cronjob/mysql-full-backup -n backup

# 5. 查看备份 Pod 日志
kubectl get pods -n backup
kubectl logs -n backup pod/backup-manual-xxxxx

# 6. 查看备份文件
kubectl exec -n backup deployment/backup-viewer -- ls -lh /backup/mysql/
# 或
kubectl exec -n backup <pod-name> -- ls -lh /backup/mysql/

# 7. 恢复备份（临时 Pod）
kubectl run restore-job -n backup --rm -it --restart=Never \
  --image=mysql:8.0 \
  --overrides='
  {
    "spec": {
      "volumes": [{"name": "backup", "persistentVolumeClaim": {"claimName": "backup-storage"}}],
      "containers": [{
        "name": "restore",
        "image": "mysql:8.0",
        "command": ["bash", "-c", "gunzip -c /backup/mysql/full_*.sql.gz | mysql -h mysql.primary.svc.cluster.local -u backup -p$MYSQL_PASSWORD neighborhood_help"],
        "env": [{"name": "MYSQL_PASSWORD", "value": "your_password"}],
        "volumeMounts": [{"name": "backup", "mountPath": "/backup/mysql"}]
      }]
    }
  }' \
  -- /bin/bash

# 8. 清理
kubectl delete -f k8s/backup-cronjob.yaml
kubectl delete pvc backup-storage -n backup
```

---

## 5. 方式四：腾讯云 SCF

### 5.1 架构

```
┌─────────────────────────────────────────┐
│            腾讯云                        │
│                                          │
│  ┌──────────┐    ┌──────────────────┐  │
│  │ 云函数    │    │ 云数据库 MySQL    │  │
│  │ (SCF)    │────▶│ (内网访问)       │  │
│  └──────────┘    └──────────────────┘  │
│       │                                  │
│       ▼                                  │
│  ┌──────────┐                           │
│  │ 对象存储  │                           │
│  │ (COS)    │◀── 备份文件上传           │
│  └──────────┘                           │
│       │                                  │
│       ▼                                  │
│  ┌──────────┐                           │
│  │ 定时触发  │                           │
│  │ (Timer)  │                           │
│  └──────────┘                           │
└─────────────────────────────────────────┘
```

### 5.2 函数代码

```python
# scf/backup.py
import os
import gzip
import subprocess
import datetime
import json
import base64

# 环境变量
MYSQL_HOST = os.environ.get('MYSQL_HOST', '127.0.0.1')
MYSQL_PORT = os.environ.get('MYSQL_PORT', '3306')
MYSQL_USER = os.environ.get('MYSQL_USER', 'backup')
MYSQL_PASSWORD = os.environ.get('MYSQL_PASSWORD', '')
MYSQL_DATABASE = os.environ.get('MYSQL_DATABASE', 'neighborhood_help')
COS_BUCKET = os.environ.get('COS_BUCKET', 'neighborhood-help-1250000000')

def handler(event, context):
    """SCF 定时触发入口"""
    try:
        date_str = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_key = f"backups/mysql/full_{date_str}.sql.gz"
        local_file = f"/tmp/full_{date_str}.sql.gz"
        
        # 执行 mysqldump
        cmd = [
            'mysqldump',
            '--single-transaction',
            '--routines', '--triggers', '--events',
            '--databases', MYSQL_DATABASE,
            '--hex-blob', '--set-charset',
            '--default-character-set=utf8mb4',
            '-h', MYSQL_HOST,
            '-P', MYSQL_PORT,
            '-u', MYSQL_USER,
            f'-p{MYSQL_PASSWORD}'
        ]
        
        with open(local_file, 'wb') as f:
            proc = subprocess.Popen(cmd, stdout=f, stderr=subprocess.PIPE)
            _, stderr = proc.communicate()
            
            if proc.returncode != 0:
                return {
                    'statusCode': 500,
                    'body': json.dumps({
                        'success': False,
                        'error': stderr.decode()
                    })
                }
        
        # 验证备份
        with gzip.open(local_file, 'rb') as f:
            content = f.read()
            if b'Dump completed' not in content[-200:]:
                return {
                    'statusCode': 500,
                    'body': json.dumps({
                        'success': False,
                        'error': '备份完整性验证失败'
                    })
                }
        
        # 上传到 COS（如果配置了）
        if COS_BUCKET and COS_BUCKET != 'neighborhood-help-1250000000':
            try:
                from qcloud_cos import CosConfig, CosS3Client
                region = os.environ.get('COS_REGION', 'ap-guangzhou')
                secret_id = os.environ.get('COS_SECRET_ID', '')
                secret_key = os.environ.get('COS_SECRET_KEY', '')
                
                if secret_id and secret_key:
                    config = CosConfig(Region=region, SecretId=secret_id, SecretKey=secret_key)
                    client = CosS3Client(config)
                    client.upload_file(
                        Bucket=COS_BUCKET,
                        Key=backup_key,
                        Body=open(local_file, 'rb')
                    )
                    cos_url = f"cos://{COS_BUCKET}/{backup_key}"
                else:
                    cos_url = 'not_configured'
            except Exception as e:
                cos_url = f'upload_failed: {str(e)}'
        
        file_size = os.path.getsize(local_file)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'success': True,
                'message': '备份完成',
                'backup_file': local_file,
                'backup_key': backup_key,
                'file_size': file_size,
                'cos_upload': cos_url,
                'database': MYSQL_DATABASE,
                'timestamp': date_str
            }, ensure_ascii=False)
        }
        
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({
                'success': False,
                'error': str(e)
            })
        }
```

### 5.3 部署步骤

```bash
# 方式一：控制台部署
# 1. 登录腾讯云控制台 → 云函数 SCF
# 2. 创建函数：
#    - 函数名：mysql-backup
#    - 运行环境：Python 3.10
#    - 内存：256MB
#    - 超时：300 秒
#    - 环境变量：
#      MYSQL_HOST=10.0.0.100
#      MYSQL_PORT=3306
#      MYSQL_USER=backup
#      MYSQL_PASSWORD=xxxxxx
#      MYSQL_DATABASE=neighborhood_help
#      COS_BUCKET=neighborhood-help-1250000000
#      COS_SECRET_ID=xxxxxx
#      COS_SECRET_KEY=xxxxxx
#      COS_REGION=ap-guangzhou
# 3. 上传代码包（包含 PyMySQL、cos-python-sdk-v5）
# 4. 添加触发器 → 定时触发：
#    - 触发周期：每日
#    - 触发时间：03:00
#    - 时区：Asia/Shanghai
# 5. 网络配置：选择 VPC（需与 MySQL 同 VPC）

# 方式二：命令行部署（Serverless Framework）
# serverless.yml
# service: mysql-backup
# provider:
#   name: qcloud
#   region: ap-guangzhou
#   vpc:
#     vpcId: vpc-xxxxxxxx
#     subnetId: subnet-xxxxxxxx
# functions:
#   mysqlBackup:
#     handler: backup.handler
#     runtime: Python3.10
#     memorySize: 256
#     timeout: 300
#     environment:
#       MYSQL_HOST: ${env:MYSQL_HOST}
#       MYSQL_PASSWORD: ${env:MYSQL_PASSWORD}
#       COS_SECRET_ID: ${env:COS_SECRET_ID}
#     events:
#       - timer:
#           name: dailyBackup
#           expression: "0 0 3 * * * *"
# serverless deploy
```

### 5.4 安全组配置

```
# SCF 访问 MySQL 需放通
# MySQL 安全组/防火墙添加：
# 源 IP: SCF 出口 IP（控制台查询）
# 端口: 3306
# 协议: TCP
```

---

## 6. 环境变量配置

### 6.1 变量说明

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `MYSQL_HOST` | ✅ | mysql | MySQL 主机地址 |
| `MYSQL_PORT` | ✅ | 3306 | MySQL 端口 |
| `MYSQL_USER` | ✅ | root | MySQL 用户名（建议用 backup） |
| `MYSQL_PASSWORD` | ✅ | root123 | MySQL 密码 |
| `MYSQL_DATABASE` | ✅ | neighborhood_help | 备份的数据库名 |
| `BACKUP_DIR` | ❌ | /backup/mysql | 备份存储路径 |
| `RETENTION_DAYS` | ❌ | 30 | 本地备份保留天数 |
| `COS_SECRET_ID` | ❌ | - | 腾讯云 COS SecretId |
| `COS_SECRET_KEY` | ❌ | - | 腾讯云 COS SecretKey |
| `COS_BUCKET` | ❌ | neighborhood-help-1250000000 | COS 存储桶名 |
| `COS_REGION` | ❌ | ap-guangzhou | COS 区域 |
| `TZ` | ❌ | UTC | 时区（建议 Asia/Shanghai） |

### 6.2 .env 文件示例

```bash
# .env.production
# MySQL 连接
MYSQL_HOST=10.0.0.100
MYSQL_PORT=3306
MYSQL_USER=backup
MYSQL_PASSWORD=your_strong_password_here
MYSQL_DATABASE=neighborhood_help

# 腾讯云 COS（可选）
COS_SECRET_ID=your_cos_secret_id
COS_SECRET_KEY=your_cos_secret_key
COS_BUCKET=neighborhood-help-1250000000
COS_REGION=ap-guangzhou

# 其他
TZ=Asia/Shanghai
```

### 6.3 密码安全

```bash
# 1. 不要将密码提交到 Git
echo ".env.production" >> .gitignore

# 2. 使用 .env.example 作为模板（不含真实密码）
cp .env.example .env.production

# 3. 限制文件权限
chmod 600 .env.production

# 4. Kubernetes 使用 Secret 对象（推荐）
kubectl create secret generic mysql-backup-secret \
  --from-literal=MYSQL_PASSWORD='strong_password' \
  --from-literal=COS_SECRET_ID='xxx' \
  --from-literal=COS_SECRET_KEY='xxx'

# 5. Docker Compose 使用 .env 文件（不要用 command 传递密码）
#    ✗ 错误：command: ["mysqldump", "-p", "password"]
#    ✓ 正确：environment: MYSQL_PASSWORD=${MYSQL_PASSWORD}
```

---

## 7. 日志管理

### 7.1 日志文件

| 日志文件 | 内容 | 位置 |
|----------|------|------|
| `backup.log` | 全量备份执行日志 | `/var/log/backup.log` |
| `binlog-backup.log` | Binlog 备份日志 | `/var/log/binlog-backup.log` |
| `verify.log` | 备份验证日志 | `/var/log/verify.log` |
| `cleanup.log` | 清理日志 | `/var/log/cleanup.log` |
| `backup_log.csv` | 备份记录表 | `/backup/mysql/backup_log.csv` |

### 7.2 日志轮转配置

```bash
# /etc/logrotate.d/backup
/var/log/backup.log
/var/log/binlog-backup.log
/var/log/verify.log
/var/log/cleanup.log
{
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
    postrotate
        /usr/bin/killall -HUP rsyslogd 2>/dev/null || true
    endscript
}
```

```bash
# 手动测试轮转
sudo logrotate -f /etc/logrotate.d/backup
sudo logrotate -d /etc/logrotate.d/backup  # 调试模式
```

### 7.3 查看日志

```bash
# 实时查看备份日志
tail -f /var/log/backup.log

# 查看最近 100 行
tail -n 100 /var/log/backup.log

# 查看所有日志
less /var/log/backup.log

# Docker 容器日志
docker logs nh-backup-scheduler --tail 100 -f
```

---

## 8. 监控告警

### 8.1 Prometheus 监控

```yaml
# prometheus/backup-exporter.yaml
# 备份状态检测脚本
# 需配合 node_exporter 的 textfile collector

# /usr/local/bin/backup-exporter.sh
#!/bin/bash
BACKUP_DIR="/backup/mysql"
METRICS_FILE="/var/lib/node_exporter/backup_metrics.prom"
MAX_AGE_HOURS=25  # 超过 25 小时无备份则告警

cat > "$METRICS_FILE" << EOF
# HELP backup_last_success_timestamp_seconds Last successful backup timestamp
# TYPE backup_last_success_timestamp_seconds gauge
backup_last_success_timestamp_seconds $(date +%s)
# HELP backup_last_backup_age_seconds Age of last backup in seconds
# TYPE backup_last_backup_age_seconds gauge
EOF

# 检查最近的备份
LATEST=$(ls -t "$BACKUP_DIR"/full_*.sql.gz 2>/dev/null | head -1)
if [ -n "$LATEST" ]; then
    AGE=$(($(date +%s) - $(stat -c %Y "$LATEST")))
    SIZE=$(stat -c %s "$LATEST")
    echo "backup_last_backup_age_seconds $AGE" >> "$METRICS_FILE"
    echo "backup_last_backup_size_bytes $SIZE" >> "$METRICS_FILE"
    
    if [ "$AGE" -gt "$((MAX_AGE_HOURS * 3600))" ]; then
        echo "backup_healthy 0" >> "$METRICS_FILE"
    else
        echo "backup_healthy 1" >> "$METRICS_FILE"
    fi
else
    echo "backup_last_backup_age_seconds 999999" >> "$METRICS_FILE"
    echo "backup_healthy 0" >> "$METRICS_FILE"
fi

echo "# HELP backup_healthy Backup health status (1=ok, 0=alert)" >> "$METRICS_FILE"
echo "# TYPE backup_healthy gauge" >> "$METRICS_FILE"
```

### 8.2 Alertmanager 告警规则

```yaml
# alert_rules.yaml
groups:
  - name: backup_alerts
    rules:
      - alert: BackupNotRunning
        expr: backup_healthy == 0
        for: 1h
        labels:
          severity: critical
          team: dba
        annotations:
          summary: "数据库备份中断"
          description: "最近 25 小时内没有成功的备份，请立即检查。"
          runbook_url: "https://wiki.example.com/backup/troubleshooting"
          
      - alert: BackupFailed
        expr: increase(backup_failed_total[1h]) > 0
        for: 0m
        labels:
          severity: critical
          team: dba
        annotations:
          summary: "备份任务失败"
          description: "备份脚本执行失败，详见日志 /var/log/backup.log"
          
      - alert: BackupOld
        expr: backup_last_backup_age_seconds > 86400
        for: 2h
        labels:
          severity: warning
          team: dba
        annotations:
          summary: "备份文件超过 24 小时"
          description: "最近一次备份已超过 24 小时，可能存在问题。"
          
      - alert: BackupSizeAbnormal
        expr: backup_last_backup_size_bytes < 1000
        for: 1h
        labels:
          severity: warning
          team: dba
        annotations:
          summary: "备份文件异常小"
          description: "备份文件大小小于 1KB，可能数据不完整。"
          
      - alert: DiskSpaceWarning
        expr: (node_filesystem_avail_bytes{fstype="ext4"} / node_filesystem_size_bytes) < 0.1
        for: 4h
        labels:
          severity: warning
          team: dba
        annotations:
          summary: "备份磁盘空间不足"
          description: "备份目录所在磁盘剩余空间不足 10%。"
```

### 8.3 告警通知渠道

```yaml
# alertmanager.yml
receivers:
  - name: email
    email_configs:
      - to: dba@example.com
        from: alertmanager@example.com
        smarthost:
          url: smtp.example.com:587
          require_tls: true
          auth_username: alertmanager@example.com
          auth_password: ${SMTP_PASSWORD}

  - name: dingtalk
    webhook_configs:
      - url: https://oapi.dingtalk.com/robot/send?access_token=${DINGTALK_TOKEN}
        send_resolved: true

  - name: wechat
    wechat_configs:
      - corp_id: ww1234567890
        agent_id: 1000001
        api_secret: ${WECHAT_SECRET}
        to_user: "@all"

route:
  group_by: ['alertname']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 1h
  receiver: email
  routes:
    - match:
        severity: critical
      receiver: dingtalk
      group_wait: 0s
      repeat_interval: 10m
    - match:
        severity: warning
      receiver: wechat
```

---

## 9. 故障排查

### 9.1 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| Cron 任务不执行 | cron 服务未启动 | `sudo service cron start` |
| Cron 找不到脚本 | 路径错误 | 使用绝对路径 |
| MySQL 连接失败 | 密码/主机错误 | 检查 `.env` 和 `env.conf` |
| 备份为空 | mysqldump 选项错误 | 检查 `--databases` 参数 |
| COS 上传失败 | 密钥/桶配置错误 | 测试 coscmd 连接 |
| 权限不足 | 备份账号权限不够 | `GRANT SELECT, SHOW VIEW ON *.* TO 'backup'@'%'` |
| 磁盘空间不足 | 备份文件过大 | 清理旧备份，扩容磁盘 |

### 9.2 诊断命令

```bash
# 检查 cron 服务
sudo service cron status
sudo systemctl status cron

# 手动测试 cron 表达式
# 使用 https://crontab.guru 验证

# 检查脚本语法
bash -n /opt/backup/scripts/backup.sh

# 手动执行脚本并查看详细输出
bash -x /opt/backup/scripts/backup.sh 2>&1

# 测试 MySQL 连接
mysql -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASSWORD -e "SELECT 1"

# 测试 mysqldump
mysqldump -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASSWORD --databases neighborhood_help --no-data

# 检查备份目录权限
ls -la /backup/mysql/
stat -c "%a %U:%G" /backup/mysql/

# 检查磁盘空间
df -h /backup/mysql/
du -sh /backup/mysql/*

# 查看 cron 执行历史
grep CRON /var/log/syslog | tail -20
```

### 9.3 备份验证脚本

```bash
# 完整的健康检查脚本
#!/bin/bash
# /opt/backup/health-check.sh

BACKUP_DIR="/backup/mysql"
MAX_AGE_HOURS=25
MIN_SIZE_BYTES=1000
STATUS_FILE="/tmp/backup_health_status"

echo "=== 备份健康检查 ==="

# 1. 检查最近备份
LATEST=$(ls -t "$BACKUP_DIR"/full_*.sql.gz 2>/dev/null | head -1)
if [ -z "$LATEST" ]; then
    echo "❌ 未找到任何备份"
    echo "ERROR:NO_BACKUP" > "$STATUS_FILE"
    exit 1
fi

# 2. 检查年龄
AGE_HOURS=$(( ($(date +%s) - $(stat -c %Y "$LATEST")) / 3600 ))
if [ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]; then
    echo "❌ 备份已超过 $MAX_AGE_HOURS 小时（实际 ${AGE_HOURS}h）"
    echo "ERROR:BACKUP_TOO_OLD" > "$STATUS_FILE"
    exit 1
fi
echo "✅ 备份年龄: ${AGE_HOURS}h"

# 3. 检查大小
SIZE=$(stat -c %s "$LATEST")
if [ "$SIZE" -lt "$MIN_SIZE_BYTES" ]; then
    echo "❌ 备份文件过小: ${SIZE} bytes"
    echo "ERROR:BACKUP_TOO_SMALL" > "$STATUS_FILE"
    exit 1
fi
echo "✅ 备份大小: ${SIZE} bytes"

# 4. 检查完整性
if gunzip -c "$LATEST" 2>/dev/null | tail -5 | grep -q "Dump completed"; then
    echo "✅ 备份完整性: 通过"
else
    echo "❌ 备份损坏"
    echo "ERROR:BACKUP_CORRUPT" > "$STATUS_FILE"
    exit 1
fi

# 5. 检查 MySQL 连通性
if mysql -h "$MYSQL_HOST" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" -e "SELECT 1" > /dev/null 2>&1; then
    echo "✅ MySQL 连通性: 正常"
else
    echo "❌ MySQL 无法连接"
    echo "ERROR:MYSQL_UNREACHABLE" > "$STATUS_FILE"
    exit 1
fi

# 6. 检查磁盘空间
DISK_USAGE=$(df "$BACKUP_DIR" | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK_USAGE" -gt 90 ]; then
    echo "⚠️  磁盘使用率: ${DISK_USAGE}%"
else
    echo "✅ 磁盘使用率: ${DISK_USAGE}%"
fi

echo "✅ 健康检查通过"
echo "OK" > "$STATUS_FILE"
exit 0
```

### 9.4 恢复操作手册

```bash
# 场景一：误删数据，恢复单个表
# 1. 找到备份文件
LATEST=$(ls -t /backup/mysql/full_*.sql.gz | head -1)

# 2. 提取单个表
gunzip -c "$LATEST" | sed -n '/Table structure for table `users`/,/Table structure/p' > /tmp/users_backup.sql

# 3. 恢复单表
mysql -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASSWORD neighborhood_help < /tmp/users_backup.sql

# 场景二：完全恢复整个数据库
# ⚠️ 警告：这会删除所有现有数据！

# 1. 确认备份文件
ls -lh /backup/mysql/full_*.sql.gz

# 2. 交互式恢复（推荐）
bash /opt/backup/scripts/restore.sh /backup/mysql/full_YYYYMMDD_HHMMSS.sql.gz

# 3. 或手动恢复
gunzip -c /backup/mysql/full_YYYYMMDD_HHMMSS.sql.gz | \
  mysql -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASSWORD

# 4. 验证恢复
mysql -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASSWORD \
  -e "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM tasks;"

# 场景三：从 COS 恢复
# 1. 下载备份
coscmd download backups/mysql/full_YYYYMMDD_HHMMSS.sql.gz /tmp/restore.sql.gz

# 2. 恢复
gunzip -c /tmp/restore.sql.gz | mysql -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASSWORD
```

---

## 附录 A：端口要求

| 服务 | 端口 | 用途 |
|------|------|------|
| MySQL | 3306 | 备份源 |
| COS | 443 (HTTPS) | 备份目标（可选） |
| Prometheus | 9090 | 监控采集 |
| Alertmanager | 9093 | 告警路由 |

## 附录 B：最低资源配置

| 组件 | CPU | 内存 | 存储 |
|------|-----|------|------|
| 备份容器/主机 | 0.5 核 | 256 MB | 50 GB |
| K8s CronJob | 0.5 核 | 256 MB | PVC 50 GB |
| SCF | - | 256 MB | COS 无限 |

## 附录 C：参考链接

- [MySQL 8.0 Reference Manual - mysqldump](https://dev.mysql.com/doc/refman/8.0/en/mysqldump.html)
- [Cron 表达式在线工具](https://crontab.guru/)
- [Prometheus Alerting Rules](https://prometheus.io/docs/alerting/latest/alerting_rules/)
- [腾讯云 COS 文档](https://cloud.tencent.com/document/product/436)
- [Kubernetes CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)
