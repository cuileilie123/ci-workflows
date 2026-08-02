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

/** 任务信息 */
export interface Task {
  id: number;
  publisherId: number;
  title: string;
  description: string;
  price: number;
  lng: number;
  lat: number;
  geohash: string;
  status: TaskStatus;
  expireAt: string;
  createdAt: string;
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
