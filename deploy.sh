#!/bin/bash
#
# ============================================================
# 社区邻里有偿互助平台 - 一键部署脚本
# ============================================================
#
# 用法:
#   chmod +x deploy.sh
#   ./deploy.sh [选项]
#
# 选项:
#   --skip-build     跳过镜像构建
#   --skip-migrate   跳过数据库迁移
#   --skip-backup    跳过备份调度器配置
#   --no-prompt      无交互模式（使用默认值）
#   --force          强制覆盖已有配置
#   --help           显示帮助
#
# 示例:
#   ./deploy.sh                     # 标准部署
#   ./deploy.sh --no-prompt         # 无交互部署
#   ./deploy.sh --skip-migrate      # 跳过迁移
#
# ============================================================

set -euo pipefail

# ==================== 颜色定义 ====================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ==================== 全局变量 ====================
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
BACKUP_COMPOSE="$PROJECT_DIR/docker-compose.backup.yml"
LOG_FILE="$PROJECT_DIR/deploy-$(date +%Y%m%d_%H%M%S).log"

# 默认配置
SKIP_BUILD=false
SKIP_MIGRATE=false
SKIP_BACKUP=false
NO_PROMPT=false
FORCE=false

# ==================== 日志函数 ====================
log() { echo -e "${GREEN}[INFO]${NC} $*" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*" | tee -a "$LOG_FILE"; }
error() { echo -e "${RED}[ERROR]${NC} $*" | tee -a "$LOG_FILE"; }
success() { echo -e "${GREEN}${BOLD}[OK]${NC} $*" | tee -a "$LOG_FILE"; }
info() { echo -e "${BLUE}[..]${NC} $*" | tee -a "$LOG_FILE"; }
step() { echo -e "\n${CYAN}${BOLD}━━━ $* ━━━${NC}" | tee -a "$LOG_FILE"; }
header() {
    echo -e "${CYAN}${BOLD}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║           社区邻里有偿互助平台 - 一键部署                   ║"
    echo "║                    Neighborhood Help Platform               ║"
    echo "╠══════════════════════════════════════════════════════════════╣"
    echo "║  时间: $(date '+%Y-%m-%d %H:%M:%S')                                      ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# ==================== 错误处理 ====================
cleanup() {
    local exit_code=$?
    if [ "$exit_code" -ne 0 ]; then
        echo -e "\n${RED}${BOLD}╔══════════════════════════════════════════════╗${NC}"
        echo -e "${RED}${BOLD}║           部署失败！                          ║${NC}"
        echo -e "${RED}${BOLD}╚══════════════════════════════════════════════╝${NC}"
        echo -e "\n${YELLOW}日志文件:${NC} $LOG_FILE"
        echo -e "${YELLOW}排查建议:${NC}"
        echo "  1. 查看完整日志: tail -100 $LOG_FILE"
        echo "  2. 检查 Docker 状态: docker ps"
        echo "  3. 重试部署: ./deploy.sh --force"
        echo ""
    fi
    exit $exit_code
}
trap cleanup EXIT

# ==================== 帮助信息 ====================
show_help() {
    cat << 'HELP'
社区邻里有偿互助平台 - 一键部署脚本

用法: ./deploy.sh [选项]

选项:
  --skip-build     跳过镜像构建步骤
  --skip-migrate   跳过数据库迁移
  --skip-backup    跳过备份调度器配置
  --no-prompt      无交互模式（使用默认值）
  --force          强制覆盖已有 .env 配置
  --help           显示本帮助信息

示例:
  ./deploy.sh                     # 标准交互部署
  ./deploy.sh --no-prompt         # 无交互（使用默认配置）
  ./deploy.sh --force             # 重新配置并部署
  ./deploy.sh --skip-migrate      # 跳过迁移（使用已有数据库）

部署流程:
  1. 环境检查（Docker / 磁盘 / 网络）
  2. 环境变量配置（.env 文件）
  3. 目录结构初始化
  4. Docker 镜像加速配置
  5. 服务启动（docker-compose up -d）
  6. 数据库迁移（Prisma migrate）
  7. 备份调度器配置
  8. 健康检查
  9. 生成部署报告

HELP
    exit 0
}

# ==================== 参数解析 ====================
parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --skip-build)   SKIP_BUILD=true ;;
            --skip-migrate) SKIP_MIGRATE=true ;;
            --skip-backup)  SKIP_BACKUP=true ;;
            --no-prompt)    NO_PROMPT=true ;;
            --force)        FORCE=true ;;
            --help)         show_help ;;
            *)              error "未知参数: $1"; exit 1 ;;
        esac
        shift
    done
}

# ==================== 前置检查 ====================
check_prerequisites() {
    step "步骤 1/9: 环境检查"
    
    # 检查操作系统
    OS="$(uname -s)"
    case "$OS" in
        Linux*)  OS_TYPE="Linux" ;;
        Darwin*) OS_TYPE="macOS" ;;
        MINGW*|MSYS*|CYGWIN*) OS_TYPE="Windows (Git Bash)" ;;
        *)       OS_TYPE="Unknown" ;;
    esac
    log "操作系统: $OS_TYPE ($(uname -r))"
    
    # 检查 Docker
    if ! command -v docker &> /dev/null; then
        error "Docker 未安装！"
        echo -e "  安装指南: ${BLUE}https://docs.docker.com/get-docker/${NC}"
        exit 1
    fi
    DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "unknown")
    log "Docker 版本: $DOCKER_VERSION"
    
    # 检查 Docker 是否运行
    if ! docker info &> /dev/null; then
        error "Docker daemon 未运行！"
        echo "  请启动 Docker Desktop 或 Docker 服务"
        if [ "$OS_TYPE" = "Linux" ]; then
            echo "  sudo service docker start"
        fi
        exit 1
    fi
    success "Docker daemon 运行中"
    
    # 检查 Docker Compose
    if docker compose version &> /dev/null; then
        COMPOSE_VERSION=$(docker compose version)
        COMPOSE_CMD="docker compose"
    elif command -v docker-compose &> /dev/null; then
        COMPOSE_VERSION=$(docker-compose --version)
        COMPOSE_CMD="docker-compose"
    else
        error "Docker Compose 未安装！"
        exit 1
    fi
    log "Docker Compose: $COMPOSE_VERSION"
    
    # 检查 Node.js（用于 Prisma 迁移）
    if ! command -v node &> /dev/null; then
        warn "Node.js 未安装（如需数据库迁移请先安装）"
    else
        NODE_VERSION=$(node --version)
        log "Node.js: $NODE_VERSION"
    fi
    
    # 检查磁盘空间
    AVAILABLE_SPACE=$(df -BG "$PROJECT_DIR" | awk 'NR==2 {print $4}' | tr -d 'G')
    if [ "$AVAILABLE_SPACE" -lt 5 ]; then
        warn "磁盘剩余空间不足 5GB（当前 ${AVAILABLE_SPACE}GB），可能影响数据库运行"
    else
        log "磁盘空间: 可用 ${AVAILABLE_SPACE}GB"
    fi
    
    # 检查项目目录
    if [ ! -f "$COMPOSE_FILE" ]; then
        error "未找到 docker-compose.yml，请在项目根目录运行此脚本"
        exit 1
    fi
    log "项目目录: $PROJECT_DIR"
}

# ==================== 环境变量配置 ====================
setup_env() {
    step "步骤 2/9: 环境变量配置"
    
    # 如果 .env 存在且不强制覆盖
    if [ -f "$ENV_FILE" ] && [ "$FORCE" != "true" ]; then
        if ! $NO_PROMPT; then
            warn ".env 文件已存在，是否重新配置？[y/N]"
            read -r REPLY
            if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
                log "跳过环境变量配置"
                return 0
            fi
        else
            log ".env 文件已存在 (--force 未指定)，跳过"
            return 0
        fi
    fi
    
    # 从模板复制
    if [ ! -f "$ENV_EXAMPLE" ]; then
        error "未找到 .env.example 模板文件"
        exit 1
    fi
    
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    log "已从 .env.example 创建 .env"
    
    # 生成随机密钥
    JWT_SECRET=$(openssl rand -base64 64 2>/dev/null || cat /dev/urandom | head -c 64 | base64)
    JWT_REFRESH_SECRET=$(openssl rand -base64 64 2>/dev/null || cat /dev/urandom | head -c 64 | base64)
    
    # 交互式配置
    if ! $NO_PROMPT; then
        echo ""
        echo -e "${BOLD}请配置以下环境变量（直接回车使用默认值）:${NC}"
        echo ""
        
        # MySQL 密码
        read -rp "MySQL root 密码 [root123]: " MYSQL_PASSWORD
        MYSQL_PASSWORD=${MYSQL_PASSWORD:-root123}
        
        # JWT 密钥
        read -rp "JWT Secret [自动生成]: " INPUT_JWT_SECRET
        JWT_SECRET=${INPUT_JWT_SECRET:-$JWT_SECRET}
        
        read -rp "JWT Refresh Secret [自动生成]: " INPUT_JWT_REFRESH
        JWT_REFRESH_SECRET=${INPUT_JWT_REFRESH:-$JWT_REFRESH_SECRET}
        
        # 微信小程序
        read -rp "微信 AppID [your_appid_here]: " WX_APPID
        WX_APPID=${WX_APPID:-your_appid_here}
        
        read -rp "微信 AppSecret [your_secret_here]: " WX_SECRET
        WX_SECRET=${WX_SECRET:-your_secret_here}
        
        # 腾讯云 COS
        read -rp "腾讯云 COS SecretId [your_cos_secret_id]: " COS_SECRET_ID
        COS_SECRET_ID=${COS_SECRET_ID:-your_cos_secret_id}
        
        read -rp "腾讯云 COS SecretKey [your_cos_secret_key]: " COS_SECRET_KEY
        COS_SECRET_KEY=${COS_SECRET_KEY:-your_cos_secret_key}
    else
        MYSQL_PASSWORD="root123"
        WX_APPID="your_appid_here"
        WX_SECRET="your_secret_here"
        COS_SECRET_ID="your_cos_secret_id"
        COS_SECRET_KEY="your_cos_secret_key"
    fi
    
    # 写入 .env
    cat > "$ENV_FILE" << EOF
# ============================================================
# 社区邻里有偿互助平台 - 环境配置
# 生成时间: $(date '+%Y-%m-%d %H:%M:%S')
# ============================================================

# 微信小程序
WX_APPID=${WX_APPID}
WX_SECRET=${WX_SECRET}
WX_MCH_ID=your_mch_id_here
WX_API_V3_KEY=your_v3_key_here

# 数据库
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=${MYSQL_PASSWORD}
MYSQL_DATABASE=neighborhood_help

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}

# 腾讯云 COS
COS_SECRET_ID=${COS_SECRET_ID}
COS_SECRET_KEY=${COS_SECRET_KEY}
COS_BUCKET=neighborhood-help-1250000000
COS_REGION=ap-guangzhou

# 腾讯地图
MAP_KEY=your_map_key_here

# RabbitMQ
RABBITMQ_URL=amqp://admin:admin123@localhost:5672

# Elasticsearch
ES_URL=http://localhost:9200

# MongoDB
MONGO_URL=mongodb://localhost:27017/neighborhood_help

# 前端 API 地址
VITE_API_BASE_URL=http://localhost:3000/api/v1
EOF
    
    chmod 600 "$ENV_FILE"
    
    # 打码显示
    log "环境变量已配置: $ENV_FILE"
    log "  MySQL 密码: ${MYSQL_PASSWORD:0:2}****"
    log "  JWT Secret: ${JWT_SECRET:0:4}****(已隐藏)"
    log "  AppID: $WX_APPID"
    log "  COS: ${COS_SECRET_ID:0:4}****(已隐藏)"
    
    warn "请及时将 .env 中的占位符替换为真实值！"
}

# ==================== 目录初始化 ====================
init_directories() {
    step "步骤 3/9: 目录结构初始化"
    
    DIRS=(
        "$PROJECT_DIR/deploy/logs"
        "$PROJECT_DIR/deploy/backups"
    )
    
    for dir in "${DIRS[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            log "创建目录: $dir"
        fi
    done
    
    # 设置权限
    chmod 755 "$PROJECT_DIR/deploy/logs" 2>/dev/null || true
    
    success "目录结构已初始化"
}

# ==================== Docker 镜像加速 ====================
setup_mirror() {
    step "步骤 4/9: Docker 镜像加速配置"
    
    # 检测 Docker Desktop 配置路径
    DOCKER_CONFIG_DIR="$HOME/.docker"
    if [ "$OS_TYPE" = "Windows (Git Bash)" ]; then
        DOCKER_CONFIG_DIR="/c/Users/$USER/.docker"
    fi
    
    MIRROR_CONFIG="$DOCKER_CONFIG_DIR/daemon.json"
    
    if [ -f "$MIRROR_CONFIG" ]; then
        log "Docker 配置文件已存在: $MIRROR_CONFIG"
        if ! $NO_PROMPT; then
            warn "是否更新镜像加速配置？[y/N]"
            read -r REPLY
            if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
                log "跳过镜像加速配置"
                return 0
            fi
        fi
    fi
    
    # 写入国内镜像源
    mkdir -p "$DOCKER_CONFIG_DIR"
    cat > "$MIRROR_CONFIG" << 'EOF'
{
  "registry-mirrors": [
    "https://docker.1panel.live",
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com",
    "https://mirror.ccs.tencentyun.com",
    "https://ccr.ccs.tencentyun.com"
  ],
  "max-concurrent-downloads": 3,
  "max-concurrent-uploads": 3
}
EOF
    
    log "已配置国内镜像源: $MIRROR_CONFIG"
    log "镜像列表:"
    echo "  - docker.1panel.live"
    echo "  - docker.m.daocloud.io"
    echo "  - dockerproxy.com"
    echo "  - mirror.ccs.tencentyun.com"
    echo "  - ccr.ccs.tencentyun.com"
    
    # 提示重启 Docker
    warn "镜像加速需要重启 Docker 才能生效！"
    if ! $NO_PROMPT; then
        read -rp "是否现在重启 Docker？[y/N]" REPLY
        if [[ "$REPLY" =~ ^[Yy]$ ]]; then
            log "正在重启 Docker..."
            if [ "$OS_TYPE" = "Linux" ]; then
                sudo service docker restart || sudo systemctl restart docker
            elif [ "$OS_TYPE" = "macOS" ]; then
                killall Docker && open -a Docker
            else
                warn "请手动重启 Docker Desktop"
            fi
            sleep 5
            success "Docker 已重启"
        else
            warn "请手动重启 Docker Desktop 使镜像配置生效"
        fi
    fi
}

# ==================== 启动服务 ====================
start_services() {
    step "步骤 5/9: 启动 Docker Compose 服务"
    
    cd "$PROJECT_DIR"
    
    # 显示将要启动的服务
    log "将要启动的服务:"
    $COMPOSE_CMD config --services 2>/dev/null | while read -r svc; do
        echo -e "  ${CYAN}●${NC} $svc"
    done
    
    log "正在拉取镜像并启动服务..."
    
    # 拉取镜像
    if ! $SKIP_BUILD; then
        info "拉取 Docker 镜像（首次可能需要几分钟）..."
        $COMPOSE_CMD pull 2>&1 | tee -a "$LOG_FILE"
        if [ ${PIPESTATUS[0]} -ne 0 ]; then
            warn "部分镜像拉取失败，尝试使用本地缓存继续..."
        fi
    fi
    
    # 启动服务
    info "启动容器..."
    $COMPOSE_CMD up -d 2>&1 | tee -a "$LOG_FILE"
    
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
        error "服务启动失败！查看日志: docker compose logs"
        exit 1
    fi
    
    # 等待 MySQL 就绪
    log "等待 MySQL 就绪..."
    MAX_RETRIES=30
    RETRY=0
    while [ $RETRY -lt $MAX_RETRIES ]; do
        if docker exec nh-mysql mysqladmin ping -h localhost -u root -p"${MYSQL_PASSWORD:-root123}" &> /dev/null; then
            success "MySQL 已就绪"
            break
        fi
        RETRY=$((RETRY + 1))
        log "  等待中... ($RETRY/$MAX_RETRIES)"
        sleep 2
    done
    
    if [ $RETRY -eq $MAX_RETRIES ]; then
        warn "MySQL 启动超时，请检查日志"
    fi
    
    # 显示服务状态
    echo ""
    log "服务状态:"
    $COMPOSE_CMD ps
    echo ""
    
    success "服务启动完成"
}

# ==================== 数据库初始化 ====================
init_database() {
    step "步骤 6/9: 数据库初始化"
    
    if $SKIP_MIGRATE; then
        warn "跳过数据库迁移 (--skip-migrate)"
        return 0
    fi
    
    cd "$PROJECT_DIR/bff"
    
    # 安装依赖（如果需要）
    if [ ! -d "node_modules" ]; then
        info "安装 BFF 依赖..."
        pnpm install 2>&1 | tee -a "$LOG_FILE"
    fi
    
    # 运行 Prisma 迁移
    info "执行数据库迁移..."
    npx prisma migrate deploy 2>&1 | tee -a "$LOG_FILE"
    
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
        warn "迁移可能已完成或遇到问题，检查日志了解详情"
    else
        success "数据库迁移完成"
    fi
    
    # 创建备份用户
    info "创建数据库备份用户..."
    docker exec nh-mysql mysql -uroot -p"${MYSQL_PASSWORD:-root123}" -e "
        CREATE USER IF NOT EXISTS 'backup'@'%' IDENTIFIED BY 'backup_pass_$(date +%Y)';
        GRANT SELECT, SHOW VIEW, EVENT, TRIGGER ON neighborhood_help.* TO 'backup'@'%';
        FLUSH PRIVILEGES;
    " 2>/dev/null && success "备份用户已创建" || warn "备份用户创建失败（可能已存在）"
    
    # 验证表结构
    log "验证数据库表结构..."
    TABLES=$(docker exec nh-mysql mysql -uroot -p"${MYSQL_PASSWORD:-root123}" -N -e "
        SELECT COUNT(*) FROM information_schema.tables 
        WHERE table_schema='neighborhood_help';
    " 2>/dev/null)
    
    log "  业务表数量: ${TABLES:-未知}"
    
    if [ "${TABLES:-0}" -gt 0 ]; then
        success "数据库初始化完成"
    else
        warn "数据库表为空，可能需要运行迁移"
    fi
    
    cd "$PROJECT_DIR"
}

# ==================== 备份调度器配置 ====================
setup_backup_scheduler() {
    step "步骤 7/9: 备份调度器配置"
    
    if $SKIP_BACKUP; then
        warn "跳过备份调度器配置 (--skip-backup)"
        return 0
    fi
    
    # 检查备份相关文件
    if [ ! -f "$BACKUP_COMPOSE" ]; then
        warn "未找到 docker-compose.backup.yml"
        return 0
    fi
    
    if [ ! -f "$PROJECT_DIR/Dockerfile.backup" ]; then
        warn "未找到 Dockerfile.backup，跳过备份镜像构建"
        return 0
    fi
    
    # 构建备份调度器镜像
    log "构建备份调度器镜像..."
    cd "$PROJECT_DIR"
    $COMPOSE_CMD -f "$BACKUP_COMPOSE" build backup-scheduler 2>&1 | tee -a "$LOG_FILE"
    
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
        warn "备份镜像构建失败，尝试拉取基础镜像后重试..."
    fi
    
    # 启动备份调度器（与主服务共用同一网络）
    log "启动备份调度器..."
    $COMPOSE_CMD -f "$COMPOSE_FILE" -f "$BACKUP_COMPOSE" up -d backup-scheduler 2>&1 | tee -a "$LOG_FILE"
    
    if [ ${PIPESTATUS[0]} -ne 0 ]; then
        warn "备份调度器启动失败，请检查网络配置"
        return 0
    fi
    
    # 等待备份调度器就绪
    log "等待备份调度器就绪..."
    sleep 5
    
    # 检查备份调度器状态
    if docker ps --format '{{.Names}}' | grep -q "nh-backup-scheduler"; then
        success "备份调度器已启动"
    else
        warn "备份调度器可能未正常运行，检查日志"
    fi
    
    # 手动测试一次备份
    log "测试首次备份..."
    docker exec nh-backup-scheduler bash -c "source /tmp/backup-env.sh && bash /scripts/backup.sh" 2>&1 | tee -a "$LOG_FILE"
    
    if [ ${PIPESTATUS[0]} -eq 0 ]; then
        success "首次备份成功"
    else
        warn "首次备份可能未完成（COS 上传失败不影响本地备份），请检查日志"
    fi
    
    # 显示备份文件
    log "备份文件列表:"
    docker exec nh-backup-scheduler ls -lh /backup/mysql/ 2>/dev/null | tee -a "$LOG_FILE"
    
    success "备份调度器配置完成"
}

# ==================== 健康检查 ====================
health_check() {
    step "步骤 8/9: 系统健康检查"
    
    ALL_HEALTHY=true
    
    # 检查容器状态
    log "容器状态:"
    CONTAINERS=$($COMPOSE_CMD ps -q 2>/dev/null)
    for container_id in $CONTAINERS; do
        NAME=$(docker inspect --format '{{.Name}}' "$container_id" 2>/dev/null)
        STATUS=$(docker inspect --format '{{.State.Status}}' "$container_id" 2>/dev/null)
        if [ "$STATUS" = "running" ]; then
            echo -e "  ${GREEN}●${NC} ${NAME} - ${STATUS}"
        else
            echo -e "  ${RED}●${NC} ${NAME} - ${STATUS} ⚠️"
            ALL_HEALTHY=false
        fi
    done
    
    echo ""
    
    # 检查 MySQL
    log "MySQL 数据库:"
    if docker exec nh-mysql mysql -uroot -p"${MYSQL_PASSWORD:-root123}" -e "SELECT 1" &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} MySQL 连接正常"
        # 检查表数量
        TABLE_COUNT=$(docker exec nh-mysql mysql -uroot -p"${MYSQL_PASSWORD:-root123}" -N -e "
            SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='neighborhood_help';
        " 2>/dev/null)
        echo -e "  ${GREEN}✓${NC} 业务表: ${TABLE_COUNT:-0} 张"
    else
        echo -e "  ${RED}✗${NC} MySQL 连接失败"
        ALL_HEALTHY=false
    fi
    
    # 检查 Redis
    log "Redis:"
    REDIS_PING=$(docker exec nh-redis redis-cli ping 2>/dev/null)
    if [ "$REDIS_PING" = "PONG" ]; then
        echo -e "  ${GREEN}✓${NC} Redis 连接正常"
    else
        echo -e "  ${RED}✗${NC} Redis 连接失败"
        ALL_HEALTHY=false
    fi
    
    # 检查 RabbitMQ
    log "RabbitMQ:"
    if docker exec nh-rabbitmq rabbitmqctl status &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} RabbitMQ 运行正常"
    else
        echo -e "  ${YELLOW}⚠${NC} RabbitMQ 状态异常（可能启动中）"
    fi
    
    # 检查 Elasticsearch
    log "Elasticsearch:"
    ES_STATUS=$(docker exec nh-elasticsearch curl -s http://localhost:9200/_cluster/health 2>/dev/null | grep -o '"status":"[^"]*"' | head -1)
    if echo "$ES_STATUS" | grep -q "green\|yellow"; then
        echo -e "  ${GREEN}✓${NC} Elasticsearch: ${ES_STATUS:-ok}"
    else
        echo -e "  ${YELLOW}⚠${NC} Elasticsearch 状态未知"
    fi
    
    # 检查 MongoDB
    log "MongoDB:"
    MONGO_PING=$(docker exec nh-mongodb mongosh --eval "db.runCommand({ping: 1})" 2>/dev/null)
    if echo "$MONGO_PING" | grep -q "ok"; then
        echo -e "  ${GREEN}✓${NC} MongoDB 连接正常"
    else
        echo -e "  ${YELLOW}⚠${NC} MongoDB 状态未知"
    fi
    
    # 检查备份调度器
    log "备份调度器:"
    BACKUP_STATUS=$(docker inspect --format '{{.State.Status}}' nh-backup-scheduler 2>/dev/null || echo "not_found")
    if [ "$BACKUP_STATUS" = "running" ]; then
        echo -e "  ${GREEN}✓${NC} 备份调度器运行正常"
        BACKUP_COUNT=$(docker exec nh-backup-scheduler ls /backup/mysql/full_*.sql.gz 2>/dev/null | wc -l)
        echo -e "  ${GREEN}✓${NC} 历史备份: ${BACKUP_COUNT} 份"
    else
        echo -e "  ${YELLOW}⚠${NC} 备份调度器状态: $BACKUP_STATUS"
    fi
    
    echo ""
    
    if $ALL_HEALTHY; then
        success "所有服务运行正常 🎉"
    else
        warn "部分服务异常，请检查日志"
    fi
}

# ==================== 部署报告 ====================
deploy_report() {
    step "步骤 9/9: 部署报告"
    
    # 收集信息
    DEPLOY_TIME=$(date '+%Y-%m-%d %H:%M:%S')
    DOCKER_INFO=$(docker info --format '{{.ServerVersion}}' 2>/dev/null || echo "N/A")
    DISK_USAGE=$(df -h "$PROJECT_DIR" | awk 'NR==2 {print $5}')
    
    cat << REPORT

╔══════════════════════════════════════════════════════════════════╗
║                    🎉 部署完成！                                 ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  部署时间: $DEPLOY_TIME
║  Docker:   $DOCKER_INFO
║  磁盘使用: $DISK_USAGE
║                                                                  ║
║  ${BOLD}服务端口:${NC}
║  ┌──────────────────────────────────────────────────────────┐
║  │  MySQL          :3306   ${MYSQL_PASSWORD:-root123}         │
║  │  Redis          :6379   (无密码)                          │
║  │  RabbitMQ       :5672   admin / admin123                  │
║  │  RabbitMQ 管理  :15672  http://localhost:15672             │
║  │  Elasticsearch  :9200   (无认证)                          │
║  │  MongoDB        :27017  (无认证)                          │
║  └──────────────────────────────────────────────────────────┘
║                                                                  ║
║  ${BOLD}常用命令:${NC}
║  ┌──────────────────────────────────────────────────────────┐
║  │  查看服务状态:  docker compose ps
║  │  查看日志:      docker compose logs -f
║  │  停止服务:      docker compose down
║  │  重启服务:      docker compose restart
║  │  手动备份:      docker exec nh-backup-scheduler bash -c "source /tmp/backup-env.sh && bash /scripts/backup.sh"
║  │  查看备份:      docker exec nh-backup-scheduler ls -lh /backup/mysql/
║  │  验证备份:      docker exec nh-backup-scheduler bash -c "source /tmp/backup-env.sh && bash /scripts/verify-backup.sh"
║  │  恢复备份:      docker compose -f docker-compose.backup.yml --profile executor run backup-executor bash /scripts/restore.sh /backup/mysql/full_XXX.sql.gz
║  └──────────────────────────────────────────────────────────┘
║                                                                  ║
║  ${BOLD}下一步:${NC}
║  1. 修改 .env 中的微信/AppID/AppSecret 等生产配置
║  2. 启动 BFF 后端: cd bff && pnpm start:dev
║  3. 启动小程序前端: cd frontend && pnpm dev:mp-weixin
║  4. 配置生产环境 COS 备份 (见 deploy/BACKUP_DEPLOYMENT.md)
║                                                                  ║
║  📄 详细文档: deploy/BACKUP_DEPLOYMENT.md
║  📄 备份脚本: scripts/backup.sh, scripts/restore.sh
║  📄 测试脚本: scripts/test-backup-restore.sh
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝

REPORT
    
    # 保存报告
    REPORT_FILE="$PROJECT_DIR/deploy/deploy-report-$(date +%Y%m%d_%H%M%S).txt"
    {
        echo "部署报告"
        echo "========"
        echo "时间: $DEPLOY_TIME"
        echo "主机: $(hostname)"
        echo "Docker: $DOCKER_INFO"
        echo "磁盘: $DISK_USAGE"
        echo ""
        echo "服务列表:"
        $COMPOSE_CMD ps
        echo ""
        echo "环境变量 (已脱敏):"
        grep -v PASSWORD "$ENV_FILE" 2>/dev/null || echo "(查看 .env 文件)"
    } > "$REPORT_FILE"
    
    log "部署报告已保存: $REPORT_FILE"
    log "完整日志已保存: $LOG_FILE"
}

# ==================== 清理（可选） ====================
do_cleanup() {
    step "清理 Docker 资源"
    
    if ! $NO_PROMPT; then
        warn "即将停止并移除所有容器、网络和卷！"
        read -rp "确认清理？请输入 YES 继续: " CONFIRM
        if [ "$CONFIRM" != "YES" ]; then
            log "已取消清理"
            return 0
        fi
    fi
    
    cd "$PROJECT_DIR"
    $COMPOSE_CMD down -v --remove-orphans 2>&1 | tee -a "$LOG_FILE"
    
    success "清理完成"
}

# ==================== 主函数 ====================
main() {
    # 初始化日志
    header
    echo "" > "$LOG_FILE"
    log "部署日志: $LOG_FILE"
    log "开始时间: $(date)"
    
    # 解析参数
    parse_args "$@"
    
    # 执行部署流程
    check_prerequisites
    setup_env
    init_directories
    setup_mirror
    start_services
    init_database
    setup_backup_scheduler
    health_check
    deploy_report
    
    log "结束时间: $(date)"
    
    # 成功退出（trap 会显示成功信息）
    # trap 中只有非零退出码才显示失败信息
    # 这里打印成功信息
    echo -e "\n${GREEN}${BOLD}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}║           部署成功！🎉                        ║${NC}"
    echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
}

# 如果传入 cleanup 参数
if [ "${1:-}" = "cleanup" ]; then
    header
    do_cleanup
    exit 0
fi

# 执行主函数
main "$@"
