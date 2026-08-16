import { request } from '@/utils/request';

export interface SearchParams {
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  lng?: number;
  lat?: number;
  page?: number;
  size?: number;
}

export interface SearchResult {
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
    highlight?: Record<string, string[]>;
  }>;
  total: number;
  aggregations: {
    by_category: Array<{ key: string; doc_count: number }>;
    price_stats: { min: number; max: number; avg: number };
  };
  duration: number;
}

/**
 * 搜索任务
 */
export function searchTasks(params: SearchParams) {
  const query: string[] = [];
  if (params.q) query.push(`q=${encodeURIComponent(params.q)}`);
  if (params.category) query.push(`category=${params.category}`);
  if (params.minPrice !== undefined) query.push(`minPrice=${params.minPrice}`);
  if (params.maxPrice !== undefined) query.push(`maxPrice=${params.maxPrice}`);
  if (params.lng !== undefined) query.push(`lng=${params.lng}`);
  if (params.lat !== undefined) query.push(`lat=${params.lat}`);
  if (params.page) query.push(`page=${params.page}`);
  if (params.size) query.push(`size=${params.size}`);
  
  const queryString = query.length > 0 ? `?${query.join('&')}` : '';
  return request<SearchResult>({ url: `/search${queryString}`, method: 'GET' });
}

/**
 * 获取搜索建议
 */
export function getSuggestions(q: string) {
  return request<string[]>({ url: `/search/suggest?q=${encodeURIComponent(q)}`, method: 'GET' });
}
