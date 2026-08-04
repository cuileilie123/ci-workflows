import { Injectable, Logger, BadRequestException } from '@nestjs/common';

/**
 * 敏感词检测服务（跨模块共享）。
 *
 * 本实现使用本地词库，满足"敏感昵称/敏感内容被拦截"验收。
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
        this.logger.warn(`敏感词命中: ${w} (文本: ${text})`);
        return true;
      }
    }
    return false;
  }

  /** 命中则抛 400，便于在服务层直接调用 */
  checkAndThrow(text: string | undefined | null, label = '内容'): void {
    if (this.isSensitive(text)) {
      throw new BadRequestException(`${label}含敏感词，请修改后重试`);
    }
  }

  /**
   * 替换文本中的敏感词为 ***（用于聊天消息，非拦截）。
   * 当前用 Set + 正则实现，后续可升级为 Trie 树提升长文本性能。
   */
  filter(text: string | undefined | null): string {
    if (!text) return '';
    let result = text;
    for (const w of this.words) {
      result = result.replace(new RegExp(w, 'gi'), '***');
    }
    return result;
  }
}
