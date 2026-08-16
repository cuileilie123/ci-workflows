/** 用户角色 */
export type UserRole = 'USER' | 'HELPER' | 'ADMIN' | 'SUPER_ADMIN' | 'BOSS' | 'STAFF';

/** 用户状态 */
export type UserStatus = 'ACTIVE' | 'BANNED' | 'DELETED';

/** 微信授权用户信息（chooseAvatar / nickname 输入框获取） */
export interface WxUserInfo {
  nickname?: string;
  avatarUrl?: string;
}

/** 登录用户信息（与 BFF UserInfoPayload 对齐） */
export interface User {
  id: string;
  openid: string;
  nickname: string;
  avatar: string | null;
  phone: string | null;
  creditScore: number;
  role: UserRole;
  status: UserStatus;
}

/** 登录 / 刷新响应（与 BFF LoginResult 对齐） */
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}

/** 任务状态 */
export type TaskStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'PRICE_PENDING' | 'EXPIRED';

/** 任务分类（与 BFF Prisma 枚举对齐） */
export type TaskCategory =
  | 'DELIVERY'
  | 'SHOPPING'
  | 'CLEANING'
  | 'REPAIR'
  | 'TUTORING'
  | 'PET_CARE'
  | 'MOVING'
  | 'OTHER';

/** 分类展示名 */
export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  DELIVERY: '代拿快递',
  SHOPPING: '代买物品',
  CLEANING: '家政清洁',
  REPAIR: '维修安装',
  TUTORING: '辅导教学',
  PET_CARE: '宠物照看',
  MOVING: '搬家搬运',
  OTHER: '其他',
};

/** 发布者摘要 */
export interface PublisherSummary {
  nickname: string;
  avatar: string | null;
}

/** 任务列表项（与 BFF TaskListItem 对齐） */
export interface TaskListItem {
  id: string;
  title: string;
  price: string;
  category: TaskCategory;
  status: TaskStatus;
  address: string;
  urgency: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  images: string[];
  distance?: number;
  createdAt: string;
  expireAt: string;
  publisher: PublisherSummary;
}

/** 列表响应 */
export interface TaskListResult {
  list: TaskListItem[];
  total: number;
  page: number;
  hasMore: boolean;
}

/** 搜索响应 */
export interface TaskSearchResult extends TaskListResult {
  total: number;
}

/** 任务详情（与 BFF Task 对齐，BigInt id 序列化为 string） */
export interface Task {
  id: string;
  publisherId: string;
  helperId: string | null;
  title: string;
  description: string;
  price: string;
  lng: number;
  lat: number;
  geohash: string;
  address: string;
  category: TaskCategory;
  urgency: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  images: string[];
  status: TaskStatus;
  expireAt: string;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  publisher?: PublisherSummary;
}

/** 发布任务入参 */
export interface CreateTaskPayload {
  title: string;
  category: TaskCategory;
  description: string;
  price: number;
  lat: number;
  lng: number;
  address: string;
  urgency: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  images?: string[];
  expireAt?: string;
}

/** 上传响应 */
export interface UploadResult {
  fileKey: string;
  url: string;
}

/** 订单状态 */
export type OrderStatus = 'PENDING' | 'PAID' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED' | 'REFUND_PENDING';

/** 退款状态 */
export type RefundStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'NONE';

/** 退款申请信息（与 BFF getRefundStatus 返回结构对齐） */
export interface RefundRequestInfo {
  status: RefundStatus;
  amount: number;
  requestedAt: string | null;
  processedAt: string | null;
  refundId: string | null;
  failReason: string | null;
}

/** 取消任务返回（含已支付订单信息，用于引导退款） */
export interface CancelTaskResult extends Task {
  hasPaidOrder: boolean;
  orderId?: string;
}

/** 订单信息 */
export interface Order {
  id: number;
  taskId: number;
  helperId: number;
  totalAmount: number;
  platformFee: number;
  status: OrderStatus;
  createdAt: string;
}

/** 统一 API 响应 */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/** 工作人员细粒度权限编码 */
export type StaffPermissionCode =
  | 'PROFIT_SHARING_MANAGE'
  | 'ORDER_PRICE_MANAGE'
  | 'TASK_CATEGORY_MANAGE';

/** 当前登录用户的有效权限 */
export interface MyPermissions {
  role: UserRole;
  permissions: StaffPermissionCode[];
}

/** 分段抽佣区间 */
export interface CommissionTier {
  rangeStart: number;
  rangeEnd: number | null;
  platformRate: number;
}

/** 分账规则（管理端完整字段） */
export interface ProfitSharingRule {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName?: string;
  mode: 'FLAT' | 'TIERED';
  platformRate: number;
  helperRate: number;
  tiers: CommissionTier[] | null;
  minPlatformFee: number | null;
  maxPlatformFee: number | null;
  isActive: boolean;
  validFrom: string | null;
  validTo: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

/** 分账规则（用户端只读：生效中） */
export interface ActiveProfitSharingRule {
  id: string;
  name: string;
  categoryId: string | null;
  categoryName?: string;
  mode: 'FLAT' | 'TIERED';
  platformRate: number;
  helperRate: number;
  tiers: CommissionTier[] | null;
  isActive: boolean;
  priority: number;
}

/** 微信支付渠道费率（只读） */
export interface WechatFeeRate {
  rate: number;
  percent: number;
  description: string;
}

/** 任务类别（管理端） */
export interface TaskCategoryItem {
  id: string;
  code: string;
  name: string;
  icon: string | null;
  sort: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 改价任务项 */
export interface PriceModifiableTask {
  id: string;
  title: string;
  price: number;
  status: TaskStatus;
  address: string;
  categoryName?: string;
  publisherId: string;
  publisherNickname?: string;
  helperId: string | null;
  createdAt: string;
}

/** 待确认改价单 */
export interface PendingPriceChange {
  id: string;
  taskId: string;
  taskTitle: string;
  oldPrice: number;
  newPrice: number;
  reason: string | null;
  previousStatus: TaskStatus;
  status: string;
  createdAt: string;
}

/** 工作人员及其权限（老板视角） */
export interface StaffWithPermissions {
  userId: string;
  nickname: string;
  avatar: string | null;
  role: string;
  permissions: { permission: StaffPermissionCode; label: string; grantedAt: string }[];
}

/** 可分配权限项 */
export interface AvailablePermission {
  permission: StaffPermissionCode;
  label: string;
}

/** 平台财务设置（平台佣金收款账号配置，老板单例） */
export type ReceiverType = 'MERCHANT_ID' | 'PERSONAL_OPENID';
export interface PlatformFinanceSetting {
  id: string;
  /** 分账总控开关：true=按配置分账；false=全留主商户号 */
  profitSharingEnabled: boolean;
  /** 接收方类型：MERCHANT_ID=独立商户号（推荐）；PERSONAL_OPENID=个人零钱 */
  receiverType: ReceiverType;
  /** 接收方商户号，receiverType=MERCHANT_ID 时必填 */
  receiverMchId: string | null;
  /** 接收方名称 */
  receiverName: string | null;
  /** 接收方个人 openid，receiverType=PERSONAL_OPENID 时必填 */
  receiverOpenid: string | null;
  /** 可选：主商户号（覆盖 .env WX_MCH_ID） */
  mainMchId: string | null;
  /** 可选：AppID（覆盖 .env WX_APP_ID） */
  mainAppId: string | null;
  updatedBy: string | null;
  updatedAt: string;
  createdAt: string;
  /** upsert 结果来源，仅 save 返回时有值 */
  source?: 'created' | 'updated';
}

// ============ 认证绑定（手机号 / 银行卡 / 实名） ============

/** 认证状态（与 BFF VerificationStatus 对齐） */
export interface VerificationStatus {
  phoneBound: boolean;
  bankCardBound: boolean;
  realNameVerified: boolean;
  phone: string | null;
  realName: string | null;
  bankCardCount: number;
  canUseCoreFeatures: boolean;
  canWithdraw: boolean;
}

/** 银行卡信息（脱敏，与 BFF BankCardInfo 对齐） */
export interface BankCardInfo {
  id: string;
  holderName: string;
  bankName: string;
  cardNumberMasked: string;
  lastFour: string;
  isDefault: boolean;
  createdAt: string;
}

/** 实名认证信息（脱敏，与 BFF RealNameInfo 对齐） */
export interface RealNameInfo {
  id: string;
  realName: string;
  idCardMasked: string;
  status: string;
  submittedAt: string;
}
