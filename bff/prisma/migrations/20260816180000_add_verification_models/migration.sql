-- CreateTable
-- 银行卡绑定（用户提现前置条件：须完成手机号绑定、银行卡绑定、实名认证）
CREATE TABLE IF NOT EXISTS `bank_cards` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `holder_name` VARCHAR(32) NOT NULL COMMENT '持卡人姓名（须与实名认证一致）',
    `bank_name` VARCHAR(64) NOT NULL COMMENT '银行名称',
    `card_number` VARCHAR(32) NOT NULL COMMENT '卡号（完整存储，接口返回时脱敏）',
    `last_four` VARCHAR(4) NOT NULL COMMENT '后四位（用于展示）',
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    INDEX `bank_cards_user_id_idx` (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
-- 实名认证（用户使用核心功能与提现的前置条件）
CREATE TABLE IF NOT EXISTS `real_name_verifications` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `real_name` VARCHAR(32) NOT NULL COMMENT '真实姓名',
    `id_card_number` VARCHAR(32) NOT NULL COMMENT '身份证号（完整存储，接口返回时脱敏）',
    `id_card_last_four` VARCHAR(4) NOT NULL COMMENT '身份证后四位（用于展示）',
    `status` ENUM('PENDING', 'VERIFIED', 'REJECTED') NOT NULL DEFAULT 'VERIFIED' COMMENT '提交并通过格式校验即视为 VERIFIED',
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`),
    UNIQUE INDEX `real_name_verifications_user_id_key` (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bank_cards`
    ADD CONSTRAINT `bank_cards_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `real_name_verifications`
    ADD CONSTRAINT `real_name_verifications_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE;
