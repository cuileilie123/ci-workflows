/** 用户角色 */
export type UserRole = 'USER' | 'HELPER' | 'ADMIN';

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
export type TaskStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

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
  images: string[];
  distance?: number;
  createdAt: string;
  expireAt: string;
  publisher: PublisherSummary;
}

/** 列表响应 */
export interface TaskListResult {
  list: TaskListItem[];
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
  images?: string[];
  expireAt?: string;
}

/** 上传响应 */
export interface UploadResult {
  fileKey: string;
  url: string;
}

/** 订单状态 */
export type OrderStatus = 'PENDING' | 'PAID' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';

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
