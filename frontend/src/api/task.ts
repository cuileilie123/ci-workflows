import { request } from '@/utils/request';
import type {
  CreateTaskPayload,
  Task,
  TaskCategory,
  TaskListResult,
  TaskSearchResult,
  TaskStatus,
  CancelTaskResult,
} from '@/types';

export const taskApi = {
  /** 发布任务 */
  create(payload: CreateTaskPayload): Promise<Task> {
    return request<Task>({ url: '/tasks', method: 'POST', data: payload as unknown as Record<string, unknown> });
  },

  /** 附近任务列表 */
  listNearby(params: {
    lat: number;
    lng: number;
    page?: number;
    category?: TaskCategory;
  }): Promise<TaskListResult> {
    const query: string[] = [`lat=${params.lat}`, `lng=${params.lng}`];
    if (params.page) query.push(`page=${params.page}`);
    if (params.category) query.push(`category=${params.category}`);
    return request<TaskListResult>({ url: `/tasks?${query.join('&')}` });
  },

  /** 关键词搜索（ES 搜索，与搜索页一致） */
  async search(q: string, page = 1, size = 20): Promise<TaskSearchResult> {
    const query: string[] = [`q=${encodeURIComponent(q)}`, `page=${page}`, `size=${size}`];
    const result = await request<{
      items: Array<{
        id: number;
        title: string;
        description: string;
        location: string;
        category: string;
        price: number;
        lng: number;
        lat: number;
        status: string;
        createdAt: string;
      }>;
      total: number;
      duration: number;
    }>({
      url: `/search?${query.join('&')}`,
      method: 'GET',
    });
    const list = (result.items || []).map((item) => ({
      id: String(item.id),
      title: item.title,
      price: item.price.toFixed(2),
      category: item.category as TaskCategory,
      status: item.status as TaskStatus,
      address: item.location,
      urgency: 'NORMAL' as const,
      images: [],
      lat: item.lat,
      lng: item.lng,
      createdAt: item.createdAt,
      expireAt: new Date().toISOString(),
      publisher: { nickname: '', avatar: null },
    }));
    const hasMore = list.length === size;
    return { list, page, hasMore, total: result.total };
  },

  /** 我的发布任务列表 */
  myTasks(params: { status?: string; page?: number }): Promise<TaskListResult> {
    const query: string[] = [];
    if (params.status) query.push(`status=${params.status}`);
    if (params.page) query.push(`page=${params.page}`);
    const qs = query.length ? `?${query.join('&')}` : '';
    return request<TaskListResult>({ url: `/tasks/my${qs}` });
  },

  /** 任务详情 */
  detail(id: string): Promise<Task> {
    return request<Task>({ url: `/tasks/${id}` });
  },

  /** 更新任务（仅发布者） */
  update(id: string, payload: Partial<CreateTaskPayload>): Promise<Task> {
    return request<Task>({
      url: `/tasks/${id}`,
      method: 'PUT',
      data: payload as unknown as Record<string, unknown>,
    });
  },

  /** 取消任务（仅发布者，返回是否含已支付订单以引导退款） */
  cancel(id: string): Promise<CancelTaskResult> {
    return request<CancelTaskResult>({ url: `/tasks/${id}`, method: 'DELETE' });
  },

  /** 接单 */
  accept(id: string): Promise<Task> {
    return request<Task>({ url: `/tasks/${id}/accept`, method: 'POST' });
  },

  /** 开始服务 */
  start(id: string): Promise<Task> {
    return request<Task>({ url: `/tasks/${id}/start`, method: 'POST' });
  },

  /** 确认完成 */
  complete(id: string): Promise<Task> {
    return request<Task>({ url: `/tasks/${id}/complete`, method: 'POST' });
  },
};
