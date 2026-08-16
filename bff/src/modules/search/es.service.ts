import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import { Task } from '@prisma/client';

export interface TaskDocument {
  id: number;
  title: string;
  description: string;
  location: string;
  category: string;
  price: number;
  lng: number;
  lat: number;
  geohash: string;
  status: string;
  publisherId: number;
  createdAt: string;
  suggest: string[];
}

export interface SearchParams {
  query: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  lng?: number;
  lat?: number;
  page?: number;
  size?: number;
}

export interface SearchResult {
  items: Array<TaskDocument & { highlight?: Record<string, string[]> }>;
  total: number;
  aggregations: {
    by_category: Array<{ key: string; doc_count: number }>;
    price_stats: { min: number; max: number; avg: number };
  };
}

@Injectable()
export class EsService implements OnModuleInit {
  private readonly logger = new Logger(EsService.name);
  private client!: Client;
  private readonly indexName = 'tasks';
  private unavailable = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const node = this.configService.get<string>('ES_URL', 'http://localhost:9200');
    this.client = new Client({ node, requestTimeout: 3000, pingTimeout: 2000 });

    try {
      const health = await Promise.race([
        this.client.cluster.health(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('ES health check timeout (3s)')), 3000),
        ),
      ]);
      this.logger.log(`ES connected, status: ${health.status}`);
      this.unavailable = false;

      // 确保索引存在
      await Promise.race([
        this.ensureIndex(),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch (error: unknown) {
      this.logger.warn(`ES connection failed: ${(error as Error).message}`);
      this.unavailable = true;
    }
  }

  async checkHealth(): Promise<boolean> {
    if (this.unavailable) return false;
    try {
      await this.client.ping();
      return true;
    } catch {
      this.unavailable = true;
      return false;
    }
  }

  private async ensureIndex() {
    const exists = await this.client.indices.exists({ index: this.indexName });

    if (!exists) {
      await this.createIndex();
      this.logger.log('ES index created');
    }
  }

  private async createIndex() {
    await this.client.indices.create({
      index: this.indexName,
      body: {
        settings: {
          number_of_shards: 3,
          number_of_replicas: 1,
          analysis: {
            analyzer: {
              ik_smart_pinyin: {
                type: 'custom',
                tokenizer: 'ik_smart',
                filter: ['pinyin_filter', 'lowercase'],
              },
            },
            filter: {
              pinyin_filter: {
                type: 'pinyin',
                first_letter: 'prefix',
                padding_char: ' ',
              },
            },
          },
        },
        mappings: {
          properties: {
            id: { type: 'long' },
            title: {
              type: 'text',
              analyzer: 'ik_max_word',
              search_analyzer: 'ik_smart',
              fields: {
                pinyin: {
                  type: 'text',
                  analyzer: 'ik_smart_pinyin',
                },
              },
            },
            description: {
              type: 'text',
              analyzer: 'ik_max_word',
              search_analyzer: 'ik_smart',
            },
            location: {
              type: 'text',
              analyzer: 'ik_smart',
            },
            category: { type: 'keyword' },
            price: { type: 'double' },
            lng: { type: 'double' },
            lat: { type: 'double' },
            geohash: { type: 'keyword' },
            status: { type: 'keyword' },
            publisher_id: { type: 'long' },
            created_at: { type: 'date' },
            suggest: {
              type: 'completion',
              analyzer: 'ik_max_word',
            },
          },
        },
      },
    } as unknown as Parameters<Client['indices']['create']>[0]);
  }

  async indexTask(task: Task): Promise<void> {
    try {
      const doc: TaskDocument = {
        id: Number(task.id),
        title: task.title,
        description: task.description,
        location: task.address,
        category: task.categoryId ? String(task.categoryId) : '',
        price: Number(task.price),
        lng: Number(task.lng),
        lat: Number(task.lat),
        geohash: task.geohash,
        status: task.status,
        publisherId: Number(task.publisherId),
        createdAt: task.createdAt.toISOString(),
        suggest: [task.title],
      };

      await this.client.index({
        index: this.indexName,
        id: String(doc.id),
        document: doc,
      });

      this.logger.debug(`Task ${doc.id} indexed to ES`);
    } catch (error: unknown) {
      this.logger.error(`Failed to index task ${task.id}: ${(error as Error).message}`);
    }
  }

  async updateTask(taskId: number, updates: Partial<Task>): Promise<void> {
    try {
      await this.client.update({
        index: this.indexName,
        id: String(taskId),
        body: { doc: updates },
      } as unknown as Parameters<Client['update']>[0]);
      this.logger.debug(`Task ${taskId} updated in ES`);
    } catch (error: unknown) {
      this.logger.error(`Failed to update task ${taskId}: ${(error as Error).message}`);
    }
  }

  async deleteTask(taskId: number): Promise<void> {
    try {
      await this.client.delete({
        index: this.indexName,
        id: String(taskId),
      });
      this.logger.debug(`Task ${taskId} deleted from ES`);
    } catch (error: unknown) {
      this.logger.error(`Failed to delete task ${taskId}: ${(error as Error).message}`);
    }
  }

  async search(params: SearchParams): Promise<SearchResult> {
    const emptyResult: SearchResult = {
      items: [],
      total: 0,
      aggregations: {
        by_category: [],
        price_stats: { min: 0, max: 0, avg: 0 },
      },
    };

    if (!(await this.checkHealth())) {
      this.logger.warn('ES unavailable, returning empty search result');
      return emptyResult;
    }

    try {
      const {
        query,
        category,
        minPrice = 0,
        maxPrice = 99999,
        lng,
        lat,
        page = 1,
        size = 20,
      } = params;

      // 构建 Bool Query
      const boolQuery: { bool: { must: unknown[]; filter: unknown[] } } = {
        bool: {
          must: [],
          filter: [],
        },
      };

      // 多字段匹配（支持拼音）
      if (query) {
        boolQuery.bool.must.push({
          multi_match: {
            query,
            fields: ['title^3', 'title.pinyin^2', 'description^1.5', 'location^2'],
            type: 'best_fields',
            fuzziness: 'AUTO',
          },
        });
      }

      // 分类过滤
      if (category) {
        boolQuery.bool.filter.push({
          term: { category },
        });
      }

      // 价格区间
      boolQuery.bool.filter.push({
        range: {
          price: {
            gte: minPrice,
            lte: maxPrice,
          },
        },
      });

      // 仅搜索开放状态的任务
      boolQuery.bool.filter.push({
        term: { status: 'OPEN' },
      });

      // 如果有坐标，添加距离排序
      const sort: Array<Record<string, unknown>> = [
        { _score: { order: 'desc' } },
        { created_at: { order: 'desc' } },
      ];

      if (lng != null && lat != null) {
        // 使用 script 计算距离并排序
        sort.unshift({
          _script: {
            type: 'number',
            script: {
              lang: 'painless',
              source:
                'double lat1 = params.lat * 3.141592653589793 / 180; double lat2 = doc["lat"].value * 3.141592653589793 / 180; double dlat = lat2 - lat1; double dlon = (params.lng - doc["lng"].value) * 3.141592653589793 / 180; double a = Math.sin(dlat/2)*Math.sin(dlat/2) + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)*Math.sin(dlon/2); double c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); return 6371000 * c;',
              params: { lat, lng },
            },
            order: 'asc',
          },
        });
      }

      const response = await this.client.search({
        index: this.indexName,
        body: {
          query: boolQuery,
          from: (page - 1) * size,
          size,
          sort,
          highlight: {
            fields: {
              title: {
                pre_tags: ['<em>'],
                post_tags: ['</em>'],
              },
              description: {
                pre_tags: ['<em>'],
                post_tags: ['</em>'],
              },
            },
          },
          aggs: {
            by_category: {
              terms: { field: 'category', size: 20 },
            },
            price_stats: {
              stats: { field: 'price' },
            },
          },
        },
      } as unknown as Parameters<Client['search']>[0]);

      const hits = response.hits;
      const items = hits.hits.map((hit) => ({
        ...(hit._source as TaskDocument),
        highlight: hit.highlight,
      }));

      const aggs = response.aggregations as unknown as {
        by_category?: { buckets: Array<{ key: string; doc_count: number }> };
        price_stats?: { min: number; max: number; avg: number };
      };

      return {
        items,
        total: typeof hits.total === 'object' ? hits.total.value : hits.total || 0,
        aggregations: {
          by_category: aggs?.by_category?.buckets || [],
          price_stats: aggs?.price_stats
            ? {
                min: aggs.price_stats.min,
                max: aggs.price_stats.max,
                avg: aggs.price_stats.avg,
              }
            : { min: 0, max: 0, avg: 0 },
        },
      };
    } catch (error: unknown) {
      this.logger.error(`Search failed: ${(error as Error).message}`);
      this.unavailable = true;
      return emptyResult;
    }
  }

  async suggest(prefix: string): Promise<string[]> {
    if (!(await this.checkHealth())) {
      this.logger.warn('ES unavailable, returning empty suggest result');
      return [];
    }

    try {
      const response = await this.client.search({
        index: this.indexName,
        body: {
          suggest: {
            title_suggest: {
              prefix,
              completion: {
                field: 'suggest',
                size: 10,
              },
            },
          },
        },
      } as unknown as Parameters<Client['search']>[0]);

      const suggest = response.suggest?.['title_suggest'];
      if (!suggest || suggest.length === 0) return [];

      const options = suggest[0].options as unknown as Array<{
        _text?: string;
        _source?: { title?: string };
      }>;
      return options.map((opt) => opt._text || opt._source?.title || '').filter(Boolean);
    } catch (error: unknown) {
      this.logger.error(`Suggest failed: ${(error as Error).message}`);
      this.unavailable = true;
      return [];
    }
  }

  async syncAllTasks(tasks: Task[]): Promise<void> {
    const bulkOperations = [];
    for (const task of tasks) {
      bulkOperations.push({ index: { _index: this.indexName, _id: String(task.id) } });
      bulkOperations.push({
        id: Number(task.id),
        title: task.title,
        description: task.description,
        location: task.address,
        category: task.categoryId ? String(task.categoryId) : '',
        price: Number(task.price),
        lng: Number(task.lng),
        lat: Number(task.lat),
        geohash: task.geohash,
        status: task.status,
        publisherId: Number(task.publisherId),
        createdAt: task.createdAt.toISOString(),
        suggest: [task.title],
      });
    }

    if (bulkOperations.length > 0) {
      await this.client.bulk({ body: bulkOperations });
      this.logger.log(`Synced ${tasks.length} tasks to ES`);
    }
  }
}
