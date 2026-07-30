---
name: task-publish
description: 实现任务发布页面（表单+地图+图片上传）
model: claude-4-sonnet
tags: [frontend, task]
depends_on: [init-miniprogram, wx-login]
---

# 任务：实现任务发布页面

## 目标
创建完整的任务发布表单，包含标题、描述、价格、分类、位置选择、图片上传。

## 具体步骤

### 1. 创建 `src/pages/task/publish.vue`

**表单字段：**
| 字段 | 类型 | 校验规则 |
|------|------|---------|
| title | input | 必填，2-50 字 |
| category | picker | 必选，从枚举列表选 |
| description | textarea | 必填，10-500 字 |
| price | number | 必填，0.01-10000，两位小数 |
| location | 地图选择 | 必选 |
| images | 上传 | 最多 6 张，每张 < 5MB |
| expireAt | datetime | 可选，默认 24h 后 |

**分类枚举：**
```typescript
enum TaskCategory {
  DELIVERY = '代拿快递',
  SHOPPING = '代买物品',
  CLEANING = '家政清洁',
  REPAIR = '维修安装',
  TUTORING = '辅导教学',
  PET_CARE = '宠物照看',
  MOVING = '搬家搬运',
  OTHER = '其他'
}
```

### 2. 图片上传
- 使用 `wx.chooseMedia` 选择图片
- 前端压缩：宽高 > 1280 自动压缩
- 调用 `wx.uploadFile` 上传到 COS（通过后端预签名 URL）
- 上传进度条展示
- 支持拖拽排序、删除

### 3. 位置选择
- 调用腾讯地图 `chooseLocation`
- 展示 POI 名称 + 详细地址
- 支持搜索周边地点
- 记录 `latitude`, `longitude`, `address`

### 4. 表单校验
- 使用 `async-validator` 库
- 失焦校验 + 提交前全量校验
- 错误提示红框 + 文字

### 5. 提交逻辑
- POST `/api/v1/tasks` 携带完整表单
- 成功后 Toast "发布成功" → 跳转任务详情页
- 失败保留表单数据，提示重试

## 验收标准
- [ ] 所有字段校验正确
- [ ] 图片上传进度可见
- [ ] 地图选点正常返回坐标
- [ ] 提交后跳转详情页
- [ ] 网络异常时表单数据不丢失

## 参考文件
- `specs/02-task.md` → 发布任务章节
- `.trae/memory.md` → 已知坑（uploadFile 不支持 PUT）
