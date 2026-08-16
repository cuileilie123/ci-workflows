/**
 * ES 索引初始化脚本
 * 用法: node init-index.js
 */

const http = require('http');

const ES_HOST = process.env.ES_HOST || 'localhost';
const ES_PORT = process.env.ES_PORT || '9200';
const INDEX_NAME = 'tasks';

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function initIndex() {
  const baseUrl = `http://${ES_HOST}:${ES_PORT}`;

  console.log(`Checking ES connection at ${baseUrl}...`);

  // 检查连接
  try {
    await request({ path: `${baseUrl}/`, method: 'GET' });
    console.log('ES connected');
  } catch (e) {
    console.error('Failed to connect to ES:', e.message);
    process.exit(1);
  }

  // 删除已存在的索引
  console.log(`Deleting index ${INDEX_NAME} if exists...`);
  await request({
    path: `${baseUrl}/${INDEX_NAME}`,
    method: 'DELETE',
  }).catch(() => {});

  // 创建索引
  console.log(`Creating index ${INDEX_NAME}...`);
  const result = await request(
    {
      path: `${baseUrl}/${INDEX_NAME}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    },
    {
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
    }
  );

  console.log('Index created:', result);

  // 测试搜索
  console.log('\nTesting search...');
  const testResult = await request({
    path: `${baseUrl}/${INDEX_NAME}/_search`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, {
    query: {
      multi_match: {
        query: '快递',
        fields: ['title^3', 'title.pinyin^2', 'description^1.5', 'location^2'],
      },
    },
  });

  console.log('Test search result:', JSON.stringify(testResult, null, 2));
  console.log('\nIndex initialization completed!');
}

initIndex().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
