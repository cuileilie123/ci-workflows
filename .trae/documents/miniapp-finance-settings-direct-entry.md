# 小程序个人中心增加「财务设置」直达入口

## Summary

在个人中心页 [/pages/user/profile.vue](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue) 增加一个仅 BOSS 老板级账号可见的「财务设置」入口卡片,点击直达 [/pages/admin/finance-settings](file:///d:/neighborhood-help/frontend/src/pages/admin/finance-settings.vue) 配置页,**免去先进「中端管理」再点「财务设置」的二级菜单跳转**。

改造范围极小:仅修改 profile.vue 1 个文件(template + script + style 各加一段),**不新增页面、不新增路由、不新增 API、不动后端**。复用已有的 `perm.isBoss` 权限字段与 `/pages/admin/finance-settings` 路由。

---

## Current State Analysis(现状分析)

### 现有入口链路

```
个人中心 profile.vue
  └─ 「中端管理」入口 (v-if="perm.hasAnyAdminEntry")  ← 所有管理权限用户可见
      └─ 跳转 /pages/admin/index.vue
          └─ 「财务设置」入口 (v-if="perm.isBoss")  ← 仅 BOSS 可见
              └─ 跳转 /pages/admin/finance-settings.vue
```

**问题**:BOSS 想改分账配置,需要 2 次点击(profile → 中端管理 → 财务设置),且个人中心首页没有任何「财务」相关的直达入口,与钱包卡片(顶部绿色卡片)在视觉上割裂。

### 关键现状文件

| 文件 | 关键行 | 现状 |
|---|---|---|
| [profile.vue](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue) | L54-L62 | 已有「中端管理」入口卡片,样式类 `admin-entry`(蓝紫渐变 #5c6bc0→#3949ab) |
| [profile.vue](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue) | L135 | 已注入 `const perm = usePermissionStore()` |
| [profile.vue](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue) | L219-L221 | 已有 `goAdmin()` 跳转函数,可参照写 `goFinanceSettings()` |
| [profile.vue](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue) | L306 | `onShow` 中已调用 `perm.load()`,权限数据已就绪 |
| [profile.vue](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue) | L483-L514 | `.admin-entry` 系列样式定义(可参照写 `.finance-entry`) |
| [profile.vue](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue) | L601-L604 | `.menu-arrow` 样式(箭头 ›,可直接复用) |
| [permission.ts](file:///d:/neighborhood-help/frontend/src/store/permission.ts) | L15 | `isBoss = role === 'BOSS' \|\| role === 'SUPER_ADMIN'` |
| [admin/index.vue](file:///d:/neighborhood-help/frontend/src/pages/admin/index.vue) | L9-L16 | 现有「财务设置」入口,图标 🏦、文案"配置平台佣金收款账号(分账接收方)" |
| [pages.json](file:///d:/neighborhood-help/frontend/src/pages.json) | ~L198-L202 | `/pages/admin/finance-settings` 路由**已注册**,无需新增 |

---

## Proposed Changes(改造内容)

### 仅修改 1 个文件:[profile.vue](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue)

#### 改动 1:template —— 在「中端管理」入口**之前**插入「财务设置」直达入口

**位置**:在 [profile.vue:53](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue#L53)(订单入口 `</view>` 闭合后)与 [profile.vue:54](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue#L54)(`<!-- 中端管理入口 -->` 注释)之间插入。

**为什么放在「中端管理」之前**:财务设置是 BOSS 高频且重要的操作,位置应高于通用「中端管理」聚合入口;且紧贴钱包卡片(顶部绿色),形成「钱包 → 财务设置」的视觉连贯。

**新增代码**:

```vue
<!-- 财务设置直达入口（仅老板级账号可见，免进二级菜单） -->
<view v-if="perm.isBoss" class="finance-entry" @click="goFinanceSettings">
  <text class="finance-icon">🏦</text>
  <view class="finance-info">
    <text class="finance-title">财务设置</text>
    <text class="finance-desc">配置平台佣金收款账号（分账接收方）</text>
  </view>
  <text class="menu-arrow">›</text>
</view>
```

**视觉一致性**:图标 🏦、标题"财务设置"、描述"配置平台佣金收款账号(分账接收方)"与 [admin/index.vue:10-13](file:///d:/neighborhood-help/frontend/src/pages/admin/index.vue#L10-L13) 现有入口完全一致,BOSS 在两处入口看到的是同一组文案。

#### 改动 2:script —— 在 `goAdmin()` 函数后新增 `goFinanceSettings()` 函数

**位置**:在 [profile.vue:219-221](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue#L219-L221) `goAdmin()` 函数闭合后插入。

**新增代码**:

```typescript
function goFinanceSettings(): void {
  uni.navigateTo({ url: '/pages/admin/finance-settings' });
}
```

#### 改动 3:style —— 在 `.admin-entry` 样式块**之前**新增 `.finance-entry` 系列样式

**位置**:在 [profile.vue:482](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue#L482)(`// 中端管理入口` 注释)之前插入。

**为什么新增样式而不复用 `.admin-entry`**:
- 与「中端管理」蓝紫渐变做视觉区分,让 BOSS 一眼识别这是「财务」专属入口
- 选用橙色渐变 `#ff9800 → #f57c00`,与「待确认改价」卡片左边框 `#ff9800`([profile.vue:522](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue#L522))呼应,暗示「财务相关重要操作」
- `menu-arrow` 类已存在([profile.vue:601-604](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue#L601-L604)),直接复用,无需重写

**新增代码**:

```scss
// 财务设置直达入口
.finance-entry {
  margin-top: 24rpx;
  padding: 28rpx;
  background: linear-gradient(135deg, #ff9800, #f57c00);
  border-radius: 20rpx;
  display: flex;
  align-items: center;
  gap: 20rpx;
  color: #fff;
}

.finance-icon {
  font-size: 44rpx;
}

.finance-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.finance-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #fff;
}

.finance-desc {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.85);
}
```

---

## Assumptions & Decisions(假设与决策)

1. **权限边界沿用 `perm.isBoss`**:与 [admin/index.vue:9](file:///d:/neighborhood-help/frontend/src/pages/admin/index.vue#L9) 现有「财务设置」入口权限边界完全一致(`isBoss = BOSS || SUPER_ADMIN`,见 [permission.ts:15](file:///d:/neighborhood-help/frontend/src/store/permission.ts#L15))。用户选择"仅 BOSS 老板账号",此处"老板账号"包含 SUPER_ADMIN(超级管理员),与现有约定一致,避免出现"从 A 入口能进、从 B 入口不能进"的不一致。**不修改 permission store**。

2. **不动后端、不动 BFF、不动路由**:`GET/PUT /admin/finance-settings` 接口已就绪([finance-settings.controller.ts](file:///d:/neighborhood-help/bff/src/modules/admin/finance-settings/finance-settings.controller.ts)),`/pages/admin/finance-settings` 路由已注册([pages.json:198-202](file:///d:/neighborhood-help/frontend/src/pages.json#L198-L202)),前端 API 封装 `financeSettingsApi` 已就绪([admin.ts](file:///d:/neighborhood-help/frontend/src/api/admin.ts))。本改造纯前端、纯 UI。

3. **不删除「中端管理」入口**:保留 [profile.vue:54-62](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue#L54-L62) 现有「中端管理」聚合入口不动。BOSS 在个人中心会看到两个入口卡片(橙色「财务设置」+ 蓝紫「中端管理」),工作人员只看到「中端管理」一个。这是预期行为,因为财务设置是 BOSS 高频直达场景,值得独立卡片。

4. **样式色彩选择**:橙色 `#ff9800 → #f57c00`。备选方案有:复用 `.admin-entry` 蓝紫(无区分度)、用绿色(与钱包卡片冲突)。橙色既区分又呼应「待确认改价」的财务语义,为最优选。

5. **`onShow` 中 `perm.load()` 已存在**([profile.vue:306](file:///d:/neighborhood-help/frontend/src/pages/user/profile.vue#L306)),新增入口的 `v-if="perm.isBoss"` 可直接生效,无需改动数据加载逻辑。

---

## Verification Steps(验证步骤)

执行者完成后,按以下步骤在微信开发者工具中验证:

1. **BOSS 账号验证**:
   - 用 BOSS 账号登录小程序
   - 进入「我的」(个人中心)页面
   - 预期:在「钱包卡片」下方、「中端管理」入口上方,看到橙色渐变的「财务设置」入口卡片,图标 🏦,标题"财务设置",描述"配置平台佣金收款账号(分账接收方)"
   - 点击该卡片,预期直接跳转到 `/pages/admin/finance-settings` 配置页(无需经过「中端管理」)

2. **SUPER_ADMIN 账号验证**:
   - 用 SUPER_ADMIN 账号登录
   - 预期:同样能看到「财务设置」直达入口(因 `isBoss` 包含 SUPER_ADMIN)

3. **普通工作人员(STAFF)验证**:
   - 用 STAFF 账号登录(有 `ORDER_PRICE_MANAGE` 等权限但非 BOSS)
   - 预期:**看不到**「财务设置」直达入口,但仍能看到「中端管理」入口

4. **普通用户验证**:
   - 用无任何管理权限的普通用户登录
   - 预期:两个入口(「财务设置」「中端管理」)都看不到

5. **功能链路验证**:
   - BOSS 点击新入口进入配置页后,修改分账开关或接收方商户号,点保存
   - 预期:保存成功后重新进入页面,配置已持久化(验证 API 调用正常,与从「中端管理」进入的行为完全一致)

6. **回归验证**:
   - 从「中端管理」入口进入,再点「财务设置」,行为应与直达入口完全一致(同一路由)

7. **lint/build 验证**:
   - 在 frontend 目录执行 `pnpm lint` 与 `pnpm build`,预期退出码均为 0(避免新增未使用变量、类型错误等)

---

## 不在本次范围内

- ❌ 不修改后端 BFF 接口或数据库
- ❌ 不新增页面或路由
- ❌ 不修改 permission store
- ❌ 不调整 `/pages/admin/finance-settings.vue` 配置页本身的字段或交互(若需要,请另起任务)
- ❌ 不删除现有「中端管理」入口
