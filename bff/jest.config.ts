/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  // 单元测试：匹配 .spec.ts 但排除 .integration.spec.ts
  testRegex: '.*(?<!integration)\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // 支持 @/* 路径别名
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
