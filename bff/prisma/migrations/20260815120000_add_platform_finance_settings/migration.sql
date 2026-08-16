-- CreateTable
-- 平台财务设置（单例：id=1，仅老板账号可编辑）
-- 收款账号配置保存后，微信支付回调触发分账时会从这里读取接收方，
-- 优先级高于 .env 里的 WX_PROFIT_SHARING_*（DB 未配置时才回落到 env）。
CREATE TABLE IF NOT EXISTS `platform_finance_settings` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    -- 是否启用分账：开关，总控，关闭则不分账（钱留在主商户号）
    `profit_sharing_enabled` BOOLEAN NOT NULL DEFAULT true,
    -- 接收方类型：MERCHANT_ID = 微信支付商户号（推荐）；PERSONAL_OPENID = 个人零钱（需额外验证）
    `receiver_type` VARCHAR(20) NOT NULL DEFAULT 'MERCHANT_ID',
    -- 接收方商户号（receiverType=MERCHANT_ID 时必填，如 1600000000）
    `receiver_mch_id` VARCHAR(32) NULL,
    -- 接收方名称（微信商户平台登记的主体名称，如 XX 科技有限公司）
    `receiver_name` VARCHAR(128) NULL,
    -- 接收方个人 openid（receiverType=PERSONAL_OPENID 时必填）
    `receiver_openid` VARCHAR(64) NULL,
    -- 主商户号（可选覆盖 env，方便老板配置，不必找运维改配置文件）；为空则回落到 env.WX_MCH_ID
    `main_mch_id` VARCHAR(32) NULL,
    -- 小程序 AppID（可选覆盖 env）；为空则回落到 env.WX_APP_ID
    `main_app_id` VARCHAR(32) NULL,
    -- 元数据
    `updated_by` BIGINT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
