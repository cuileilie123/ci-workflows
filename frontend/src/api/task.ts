import { request } from '@/utils/request';
import type {
  CreateTaskPayload,
  Task,
  TaskCategory,
  TaskListResult,
  TaskSearchResult,
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

  /** 关键词搜索 */
  search(q: string, page = 1): Promise<TaskSearchResult> {
    return request<TaskSearchResult>({
      url: `/tasks/search?q=${encodeURIComponent(q)}&page=${page}`,
    });
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

  /** 取消任务（仅发布者） */
  cancel(id: string): Promise<Task> {
    return request<Task>({ url: `/tasks/${id}`, method: 'DELETE' });
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
