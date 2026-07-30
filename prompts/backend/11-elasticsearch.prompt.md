---
name: elasticsearch-search
description: 实现 Elasticsearch 全文搜索（任务搜索+IK分词+高亮）
model: claude-4-sonnet
tags: [backend, search, java]
depends_on: [task-service]
---

# 任务：实现 Elasticsearch 全文搜索

## 目标
搭建 ES 搜索服务，支持中文分词、多字段匹配、高亮、聚合统计。

## 具体步骤

### 1. ES 索引配置 `backend/search-service/config/task-index.json`
```json
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "analysis": {
      "analyzer": {
        "ik_smart_pinyin": {
          "type": "custom",
          "tokenizer": "ik_smart",
          "filter": ["pinyin_filter", "lowercase"]
        }
      },
      "filter": {
        "pinyin_filter": {
          "type": "pinyin",
          "first_letter": "prefix",
          "padding_char": " "
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "id":          { "type": "long" },
      "title":       { "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart", "fields": { "pinyin": { "type": "text", "analyzer": "ik_smart_pinyin" } } },
      "description": { "type": "text", "analyzer": "ik_max_word", "search_analyzer": "ik_smart" },
      "location":    { "type": "text", "analyzer": "ik_smart" },
      "category":    { "type": "keyword" },
      "price":       { "type": "double" },
      "lng":         { "type": "double" },
      "lat":         { "type": "double" },
      "geohash":     { "type": "keyword" },
      "status":      { "type": "keyword" },
      "publisher_id": { "type": "long" },
      "created_at":  { "type": "date" },
      "suggest":     { "type": "completion", "analyzer": "ik_max_word" }
    }
  }
}
```

### 2. Java 搜索服务 `SearchService.java`
```java
@Service
public class SearchService {
  
  @Autowired
  private ElasticsearchClient esClient;
  
  private static final String INDEX = "tasks";
  
  // 同步任务到 ES（BFF 调用）
  public void indexTask(TaskDTO task) {
    TaskDocument doc = TaskDocument.builder()
      .id(task.getId())
      .title(task.getTitle())
      .description(task.getDescription())
      .location(task.getAddress())
      .category(task.getCategory())
      .price(task.getPrice())
      .lng(task.getLng())
      .lat(task.getLat())
      .geohash(task.getGeohash())
      .status(task.getStatus())
      .publisherId(task.getPublisherId())
      .createdAt(task.getCreatedAt())
      .suggest(new Completion(List.of(task.getTitle())))
      .build();
    
    esClient.index(i -> i
      .index(INDEX)
      .id(String.valueOf(doc.getId()))
      .document(doc)
    );
  }
  
  // 搜索
  public SearchResult search(String query, Double lng, Double lat,
                             String category, Double minPrice, Double maxPrice,
                             int page, int size) {
    
    // 构建 Bool Query
    BoolQuery.Builder bool = new BoolQuery.Builder();
    
    // 多字段匹配（标题权重最高）
    bool.must(MultiMatchQuery.of(m -> m
      .query(query)
      .fields(List.of("title^3", "description^1.5", "location^2"))
      .type(TextQueryType.BEST_FIELDS)
      .fuzziness("AUTO")
    )._toQuery());
    
    // 分类过滤
    if (category != null) {
      bool.filter(TermQuery.of(t -> t.field("category").value(category))._toQuery());
    }
    
    // 价格区间
    bool.filter(RangeQuery.of(r -> r
      .field("price")
      .gte(JsonData.of(minPrice != null ? minPrice : 0))
      .lte(JsonData.of(maxPrice != null ? maxPrice : 99999))
    )._toQuery());
    
    // 仅搜索开放状态的任务
    bool.filter(TermQuery.of(t -> t.field("status").value("OPEN"))._toQuery());
    
    SearchResponse<TaskDocument> response = esClient.search(s -> s
      .index(INDEX)
      .query(bool.build()._toQuery())
      .from((page - 1) * size)
      .size(size)
      .sort(sort -> sort.field(f -> f.field("created_at").order(SortOrder.Desc)))
      .highlight(h -> h
        .fields("title", f -> f.preTags("<em>").postTags("</em>"))
        .fields("description", f -> f.preTags("<em>").postTags("</em>"))
      )
      .aggregations("by_category", a -> a.terms(t -> t.field("category").size(20)))
      .aggregations("price_stats", a -> a.stats(s -> s.field("price")))
    , TaskDocument.class);
    
    // 距离排序（如果传了坐标）
    if (lng != null && lat != null) {
      // 使用 script_score 计算距离
      // ...
    }
    
    return SearchResult.builder()
      .items(response.hits().hits().stream()
        .map(hit -> mapToDTO(hit.source(), hit.highlight()))
        .collect(Collectors.toList()))
      .total(response.hits().total().value())
      .aggregations(extractAggs(response))
      .build();
  }
  
  // 搜索建议（自动补全）
  public List<String> suggest(String prefix) {
    SearchResponse<Void> response = esClient.search(s -> s
      .index(INDEX)
      .suggest(su -> su
        .suggesters("title_suggest", sug -> sug
          .prefix(prefix)
          .completion(c -> c.field("suggest").size(10))
        )
      )
    , Void.class);
    
    return response.suggest().get("title_suggest").get(0).options().stream()
      .map(opt -> opt.text())
      .collect(Collectors.toList());
  }
}
```

### 3. BFF 同步逻辑 `src/modules/task/task.service.ts`
```typescript
// 发布任务后同步到 ES
async createTask(dto: CreateTaskDto, userId: number) {
  const task = await this.prisma.task.create({ data: { ...dto, publisherId: userId } });
  
  // 异步同步到 ES（不阻塞主流程）
  this.esSyncService.indexTask(task).catch(err => {
    this.logger.error(`ES sync failed: ${err.message}`);
    // 写入重试队列
    this.mqProducer.publish('task.es_sync_retry', { taskId: task.id });
  });
  
  return task;
}
```

### 4. Go 端搜索代理 `backend/search-proxy/main.go`
```go
package main

import (
  "github.com/elastic/go-elasticsearch/v8"
  "github.com/gin-gonic/gin"
)

func main() {
  es, _ := elasticsearch.NewDefaultClient()
  r := gin.Default()
  
  r.GET("/api/v1/search", func(c *gin.Context) {
    query := c.Query("q")
    category := c.Query("category")
    page := c.GetInt("page")
    if page == 0 { page = 1 }
    
    // 构建 ES 查询
    body := map[string]interface{}{
      "query": map[string]interface{}{
        "bool": map[string]interface{}{
          "must": []map[string]interface{}{
            {
              "multi_match": map[string]interface{}{
                "query":  query,
                "fields": []string{"title^3", "description^1.5", "location^2"},
              },
            },
          },
          "filter": []map[string]interface{}{
            {"term": map[string]interface{}{"status": "OPEN"}},
          },
        },
      },
      "highlight": map[string]interface{}{
        "fields": map[string]interface{}{
          "title":       map[string]interface{}{},
          "description": map[string]interface{}{},
        },
      },
      "from": (page - 1) * 20,
      "size": 20,
      "sort": []map[string]interface{}{
        {"_score": map[string]string{"order": "desc"}},
        {"created_at": map[string]string{"order": "desc"}},
      },
    }
    
    // 执行搜索
    res, _ := es.Search(
      es.Search.WithIndex("tasks"),
      es.Search.WithBody(encode(body)),
    )
    defer res.Body.Close()
    
    c.JSON(200, decode(res.Body))
  })
  
  r.Run(":9201")
}
```

### 5. 同义词词典 `config/synonyms.txt`
```
快递,跑腿,代拿
打扫,清洁,保洁
修理,维修,修东西
辅导,补课,家教
搬家,搬运,搬东西
宠物,猫,狗,遛狗,喂猫
```

### 6. 前端搜索组件 `components/search-bar/index.vue`
```vue
<template>
  <div class="search-bar">
    <input
      v-model="keyword"
      @input="onInput"
      @focus="showSuggest = true"
      @blur="hideSuggest"
      placeholder="搜索任务..."
    />
    <!-- 搜索建议下拉 -->
    <ul v-if="showSuggest && suggestions.length" class="suggest-list">
      <li v-for="s in suggestions" :key="s" @click="selectSuggestion(s)">
        {{ s }}
      </li>
    </ul>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { debounce } from 'lodash';

const keyword = ref('');
const suggestions = ref([]);
const showSuggest = ref(false);

const fetchSuggest = debounce(async (q) => {
  if (!q) { suggestions.value = []; return; }
  const { data } = await axios.get('/api/v1/search/suggest', { params: { q } });
  suggestions.value = data;
}, 300);

watch(keyword, (val) => fetchSuggest(val));

function selectSuggestion(s) {
  keyword.value = s;
  showSuggest.value = false;
  // 触发搜索
  emit('search', s);
}
</script>
```

### 7. 对应需求条目
#6, #7, #60, #61, #62

## 验收标准
- [ ] 中文分词准确（IK 生效）
- [ ] 拼音搜索可用（"kuaidi" → 快递）
- [ ] 搜索结果高亮关键词
- [ ] 自动补全建议正确
- [ ] 同义词搜索生效
- [ ] 按距离排序正确
- [ ] 聚合统计（分类/价格区间）正确
- [ ] 搜索延迟 < 100ms

## 参考文件
- `specs/02-task.md` → 搜索章节
- `.trae/memory.md` → ADR-003
