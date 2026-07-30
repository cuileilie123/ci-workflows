/** 用户角色 */
export type UserRole = 'USER' | 'HELPER' | 'ADMIN';

/** 用户信息 */
export interface User {
  id: number;
  openid: string;
  nickname: string;
  avatar: string;
  phone: string;
  creditScore: number;
  role: UserRole;
  createdAt: string;
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
