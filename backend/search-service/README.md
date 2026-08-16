# Elasticsearch 搜索服务

## 功能特性

- **中文分词**: 使用 IK 分词器实现准确的中文分词
- **拼音搜索**: 支持拼音搜索（"kuaidi" → "快递"）
- **多字段匹配**: 标题（权重3）、描述（权重1.5）、位置（权重2）
- **搜索建议**: 自动补全功能
- **高亮显示**: 搜索结果关键词高亮
- **聚合统计**: 分类统计、价格区间统计
- **距离排序**: 基于坐标的距离排序
- **同义词**: 支持同义词扩展

## 快速开始

### 1. 启动基础设施

```bash
docker-compose up -d elasticsearch
```

### 2. 安装 ES 插件（IK + 拼音）

```bash
cd backend/search-service
bash install-plugins.sh
```

或者手动安装：

```bash
docker exec nh-elasticsearch bin/elasticsearch-plugin install https://github.com/medcl/elasticsearch-analysis-ik/releases/download/v8.12.0/elasticsearch-analysis-ik-8.12.0.zip
docker exec nh-elasticsearch bin/elasticsearch-plugin install https://github.com/medcl/elasticsearch-analysis-pinyin/releases/download/v8.12.0/elasticsearch-analysis-pinyin-8.12.0.zip
```

重启 ES：

```bash
docker-compose restart elasticsearch
```

### 3. 初始化索引

```bash
cd backend/search-service
node init-index.cjs
```

### 4. 启动 BFF 服务

```bash
cd bff
pnpm start:dev
```

BFF 启动时会自动创建 ES 索引（如果不存在）。

## API 接口

### 搜索任务

```
GET /api/v1/search
```

**参数**:
- `q`: 搜索关键词
- `category`: 任务分类（DELIVERY/SHOPPING/CLEANING/REPAIR/TUTORING/PET_CARE/MOVING/OTHER）
- `minPrice`: 最低价格
- `maxPrice`: 最高价格
- `lng`: 经度
- `lat`: 纬度
- `page`: 页码（默认 1）
- `size`: 每页数量（默认 20）

**响应**:
```json
{
  "code": 0,
  "data": {
    "items": [...],
    "total": 100,
    "aggregations": {
      "by_category": [...],
      "price_stats": { "min": 10, "max": 500, "avg": 150 }
    },
    "duration": 45
  }
}
```

### 搜索建议

```
GET /api/v1/search/suggest?q=快递
```

**响应**:
```json
{
  "code": 0,
  "data": ["快递代拿", "快递送货", "快递帮忙取"]
}
```

## 前端使用

### 搜索页面

访问 `/pages/search/index` 即可使用搜索功能。

### 从其他页面跳转

```javascript
uni.navigateTo({
  url: '/pages/search/index?q=快递'
});
```

## 索引结构

```json
{
  "settings": {
    "analysis": {
      "analyzer": {
        "ik_smart_pinyin": {
          "type": "custom",
          "tokenizer": "ik_smart",
          "filter": ["pinyin_filter", "lowercase"]
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "analyzer": "ik_max_word",
        "search_analyzer": "ik_smart",
        "fields": {
          "pinyin": {
            "type": "text",
            "analyzer": "ik_smart_pinyin"
          }
        }
      }
    }
  }
}
```

## 同步机制

- **创建任务**: 自动同步到 ES
- **更新任务**: 自动更新 ES 索引
- **取消/完成任务**: 更新状态到 ES
- **失败处理**: 异步同步，失败记录日志，不阻塞主流程

## 环境变量

```bash
ES_NODE=http://localhost:9200
```

## 性能优化

- 索引分片: 3
- 副本数: 1
- 搜索缓存: Redis 缓存热门搜索
- 异步同步: 不阻塞主流程

## 故障排查

### ES 连接失败

```bash
# 检查 ES 状态
curl http://localhost:9200

# 查看日志
docker logs nh-elasticsearch
```

### 分词不准确

```bash
# 测试分词
curl -X POST http://localhost:9200/tasks/_analyze -H 'Content-Type: application/json' -d '{
  "analyzer": "ik_max_word",
  "text": "快递代拿"
}'
```

### 索引重建

```bash
node init-index.cjs
```
