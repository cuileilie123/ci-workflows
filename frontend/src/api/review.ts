import { request } from '@/utils/request';

/** 评价数据 */
export interface ReviewData {
  id: string;
  orderId: string;
  rating: number;
  tags: string[];
  comment: string | null;
  createdAt: string;
  reviewer: {
    id: string;
    nickname: string;
    avatar: string | null;
  };
  reviewee?: {
    id: string;
    nickname: string;
    avatar: string | null;
  };
}

/** 信用分详情 */
export interface CreditDetail {
  score: number;
  level: string;
  totalReviews: number;
  avgRating: number;
  distribution: Record<number, number>;
  completedCount: number;
}

/** 评价列表响应 */
export interface ReviewListResult {
  list: ReviewData[];
  page: number;
  hasMore: boolean;
  total: number;
}

export const reviewApi = {
  /** 提交评价 */
  create(params: {
    orderId: string;
    revieweeId: string;
    rating: number;
    tags?: string[];
    comment?: string;
  }): Promise<ReviewData> {
    return request<ReviewData>({
      url: '/reviews',
      method: 'POST',
      data: params as unknown as Record<string, unknown>,
    });
  },

  /** 查看订单评价 */
  getByOrder(orderId: string): Promise<ReviewData[]> {
    return request<ReviewData[]>({
      url: `/reviews/order/${orderId}`,
    });
  },

  /** 获取用户全部评价 */
  getUserReviews(userId: string, page = 1): Promise<ReviewListResult> {
    return request<ReviewListResult>({
      url: `/reviews/user/${userId}?page=${page}`,
    });
  },

  /** 获取用户信用分详情 */
  getCredit(userId: string): Promise<CreditDetail> {
    return request<CreditDetail>({
      url: `/reviews/credit/${userId}`,
    });
  },
};
