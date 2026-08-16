# Task 014: Elasticsearch 全文搜索

- **Prompts**:
  - `prompts/backend/11-elasticsearch.prompt.md`
- **执行顺序**: 14
- **状态**: completed
- **依赖**: Task 003
- **预估时间**: 2 小时
- **说明**: ES 索引 + IK 分词 + 拼音搜索 + 高亮 + 自动补全
- **验收**:
  - [x] 中文分词准确（IK 生效）
  - [x] 拼音搜索可用（"kuaidi" → 快递）
  - [x] 搜索结果高亮关键词
  - [x] 自动补全建议正确
  - [x] 同义词搜索生效
  - [x] 按距离排序正确
  - [x] 聚合统计（分类/价格区间）正确
  - [x] 搜索延迟 < 100ms
