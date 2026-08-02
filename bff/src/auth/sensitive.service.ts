import { Injectable, Logger } from '@nestjs/common';

/**
 * 敏感词检测服务
 *
 * 本实现使用本地词库，满足 Task 002 "敏感昵称被拦截" 验收。
 * 生产环境应改用微信 security.msgSecCheck（需平台 access_token）。
 */
const DEFAULT_SENSITIVE_WORDS: string[] = [
  '管理员',
  'admin',
  '官方',
  '客服',
  '微信',
  '腾讯',
  '系统',
  '违规',
  '广告',
  '色情',
  '赌博',
  '毒品',
  '诈骗',
  '枪支',
  '代开',
  '刷单',
  '兼职',
  '中奖',
];

@Injectable()
export class SensitiveService {
  private readonly logger = new Logger(SensitiveService.name);
  private readonly words: Set<string>;

  constructor() {
    this.words = new Set(DEFAULT_SENSITIVE_WORDS);
  }

  /** 命中敏感词返回 true */
  isSensitive(text: string | undefined | null): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    for (const w of this.words) {
      if (lower.includes(w.toLowerCase())) {
        this.logger.warn(`敏感词命中: ${w} (昵称: ${text})`);
        return true;
      }
    }
    return false;
  }
}
