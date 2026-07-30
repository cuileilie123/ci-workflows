# 需求规格：任务发布与接单

## 1. 发布任务
- 字段：标题（max 50）、描述（max 500）、价格（Decimal）、分类、位置、截止时间
- 图片最多 6 张，上传至 COS，返回 `fileKey`
- 位置通过腾讯地图 `chooseLocation` 选择
- 发布前文本安全检测（`security.msgSecCheck`）
- 发布前图片安全检测（`security.imgSecCheck`）

## 2. 任务状态机
```
OPEN → ASSIGNED → IN_PROGRESS → COMPLETED → SETTLED
                ↘ CANCELLED ↗
```

## 3. 附近任务列表
- 基于用户当前位置 + GeoHash 半径 3km
- 分页加载（pageSize=20）
- 筛选：分类、价格区间、距离排序
- 缓存：Redis Key=`nearby:{geohash7}:{page}`，TTL=60s

## 4. 接单逻辑
- 发布者不能接自己的单
- 信用分 < 60 不能接单
- 接单后锁定任务（分布式锁，TTL=30min）
- 超时未开始自动释放

## 5. 搜索
- Elasticsearch 全文检索
- IK 中文分词 + 同义词扩展
- 搜索字段：标题、描述、位置名

## 6. 对应需求条目
#5, #6, #7, #10, #11, #12, #15, #33, #34, #35, #54, #60, #61, #84
