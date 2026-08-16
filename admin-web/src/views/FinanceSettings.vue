<template>
  <div class="finance-settings-page">
    <el-card>
      <template #header>
        <div class="card-header">
          <div>
            <h2>🏦 财务设置</h2>
            <p class="subtitle">平台佣金收款账号（分账接收方配置）。老板在此配置后，新订单支付成功时将 platformFee 自动分到该账号。</p>
          </div>
          <el-tag v-if="dataSource" type="success" size="large">
            上次更新：{{ formatTime(dataSource.updatedAt) }}
          </el-tag>
        </div>
      </template>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="200px"
        label-position="right"
        status-icon
      >
        <!-- ========== 分账总控 ========== -->
        <el-divider content-position="left">分账总控</el-divider>
        <el-form-item label="启用平台分账">
          <el-switch
            v-model="form.profitSharingEnabled"
            active-text="开启（新订单将触发分账 API）"
            inactive-text="关闭（所有资金留在主商户号，仅系统做账）"
          />
        </el-form-item>

        <!-- ========== 佣金收款账号 ========== -->
        <template v-if="form.profitSharingEnabled">
          <el-divider content-position="left">佣金收款账号（分账接收方）</el-divider>
          <el-form-item label="接收方类型" prop="receiverType">
            <el-radio-group v-model="form.receiverType">
              <el-radio label="MERCHANT_ID">微信支付商户号（推荐）</el-radio>
              <el-radio label="PERSONAL_OPENID">个人 OpenID（零钱）</el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item
            v-if="form.receiverType === 'MERCHANT_ID'"
            label="接收方商户号"
            prop="receiverMchId"
          >
            <el-input
              v-model="form.receiverMchId"
              placeholder="如 1600000000（8~32 位数字）"
              maxlength="32"
              clearable
            />
            <template #tip>
              佣金将分到该商户号。需先在微信支付商户平台将此商户号添加为分账接收方。
            </template>
          </el-form-item>

          <el-form-item
            v-if="form.receiverType === 'PERSONAL_OPENID'"
            label="个人 OpenID"
            prop="receiverOpenid"
          >
            <el-input
              v-model="form.receiverOpenid"
              placeholder="如 oABC1234567890abcdef"
              maxlength="64"
              clearable
            />
          </el-form-item>

          <el-form-item label="接收方名称" prop="receiverName">
            <el-input
              v-model="form.receiverName"
              placeholder="如 XX 科技有限公司（建议与微信商户平台登记一致）"
              maxlength="128"
              clearable
            />
          </el-form-item>

          <el-alert
            v-if="form.receiverType === 'PERSONAL_OPENID'"
            title="接收方为「个人零钱」需先在微信商户平台完成个人实名认证，且分账比例有限制，推荐使用「微信支付商户号」。"
            type="warning"
            show-icon
            :closable="false"
            style="margin-bottom: 18px"
          />
        </template>

        <!-- ========== 高级配置 ========== -->
        <el-divider content-position="left">
          <el-button type="primary" link @click="expanded = !expanded">
            {{ expanded ? '▲ 收起高级配置' : '▼ 展开高级配置（主商户号 / AppID 覆盖）' }}
          </el-button>
        </el-divider>
        <template v-if="expanded">
          <el-form-item label="主商户号" prop="mainMchId">
            <el-input
              v-model="form.mainMchId"
              placeholder="留空则使用 .env 配置的 WX_MCH_ID（8~32 位数字）"
              maxlength="32"
              clearable
            />
          </el-form-item>
          <el-form-item label="小程序 AppID" prop="mainAppId">
            <el-input
              v-model="form.mainAppId"
              placeholder="留空则使用 .env 配置的 WX_APP_ID（wx 开头 16 位）"
              maxlength="32"
              clearable
            />
          </el-form-item>
        </template>

        <!-- 保存 -->
        <el-form-item>
          <el-button type="primary" size="large" :loading="saving" @click="onSave">
            💾 保存设置
          </el-button>
          <el-button size="large" @click="load">🔄 重新加载</el-button>
          <span style="margin-left: 16px; color: #999; font-size: 13px">
            保存后立即生效，下一笔订单的支付回调就会用到新配置
          </span>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../api'

const formRef = ref(null)
const saving = ref(false)
const expanded = ref(false)
const dataSource = ref(null)

const form = reactive({
  profitSharingEnabled: true,
  receiverType: 'MERCHANT_ID',
  receiverMchId: '',
  receiverName: '',
  receiverOpenid: '',
  mainMchId: '',
  mainAppId: '',
})

const rules = {
  receiverMchId: [
    {
      validator: (rule, v, cb) => {
        if (!form.profitSharingEnabled) return cb()
        if (form.receiverType !== 'MERCHANT_ID') return cb()
        if (!/^\d{8,32}$/.test((v || '').trim())) {
          return cb(new Error('商户号必须是 8~32 位数字'))
        }
        cb()
      },
      trigger: 'blur',
    },
  ],
  receiverOpenid: [
    {
      validator: (rule, v, cb) => {
        if (!form.profitSharingEnabled) return cb()
        if (form.receiverType !== 'PERSONAL_OPENID') return cb()
        if (!(v || '').trim()) return cb(new Error('接收方类型为个人时，OpenID 必填'))
        cb()
      },
      trigger: 'blur',
    },
  ],
  mainMchId: [
    {
      validator: (rule, v, cb) => {
        if (!v) return cb()
        if (!/^\d{8,32}$/.test(v.trim())) return cb(new Error('主商户号格式不正确（8~32 位数字）'))
        cb()
      },
      trigger: 'blur',
    },
  ],
  mainAppId: [
    {
      validator: (rule, v, cb) => {
        if (!v) return cb()
        if (!/^wx[a-f0-9]{16}$/.test(v.trim())) return cb(new Error('AppID 格式不正确（wx 开头 16 位）'))
        cb()
      },
      trigger: 'blur',
    },
  ],
}

function formatTime(s) {
  if (!s) return '-'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  try {
    const res = await api.get('/finance-settings')
    // admin-web axios 配置了 /api/v1/admin 前缀，BFF 实际路由是 /admin/finance-settings
    // BFF controller 上 @Controller('admin/finance-settings') 所以 url 已经对了
    dataSource.value = res?.data ?? res
    if (dataSource.value) {
      form.profitSharingEnabled = dataSource.value.profitSharingEnabled ?? true
      form.receiverType = dataSource.value.receiverType || 'MERCHANT_ID'
      form.receiverMchId = dataSource.value.receiverMchId || ''
      form.receiverName = dataSource.value.receiverName || ''
      form.receiverOpenid = dataSource.value.receiverOpenid || ''
      form.mainMchId = dataSource.value.mainMchId || ''
      form.mainAppId = dataSource.value.mainAppId || ''
    }
  } catch (e) {
    ElMessage.error('加载失败：' + (e?.response?.data?.message || e?.message || '未知错误'))
  }
}

async function onSave() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  if (form.profitSharingEnabled) {
    const confirmRes = await ElMessageBox.confirm(
      '保存后，下一笔订单的支付回调将按该配置触发分账。请确认配置与微信商户后台一致。是否继续？',
      '请确认保存',
      { type: 'warning', confirmButtonText: '确认保存', cancelButtonText: '取消' },
    ).catch(() => 'cancel')
    if (confirmRes === 'cancel') return
  }
  saving.value = true
  try {
    const payload = {
      ...form,
      receiverMchId: form.receiverMchId || null,
      receiverName: form.receiverName || null,
      receiverOpenid: form.receiverOpenid || null,
      mainMchId: form.mainMchId || null,
      mainAppId: form.mainAppId || null,
    }
    const res = await api.put('/finance-settings', payload)
    dataSource.value = res?.data ?? res
    ElMessage.success('保存成功 ✅ 已立即生效')
  } catch (e) {
    ElMessage.error('保存失败：' + (e?.response?.data?.message || e?.message || '未知错误'))
  } finally {
    saving.value = false
  }
}

onMounted(() => load())
</script>

<style scoped>
.finance-settings-page {
  padding: 16px 4px;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-header h2 {
  margin: 0 0 6px 0;
  font-size: 20px;
}
.subtitle {
  margin: 0;
  color: #666;
  font-size: 13px;
}
</style>
