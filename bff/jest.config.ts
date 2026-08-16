/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  // 单元测试：匹配 .spec.ts 但排除 .integration.spec.ts
  testRegex: '.*(?<!integration)\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // 支持 @/* 路径别名 + workspace 内部包
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@neighborhood-help/test-utils$': '<rootDir>/../../packages/test-utils/src',
    '^@neighborhood-help/test-utils/(.*)$': '<rootDir>/../../packages/test-utils/src/$1',
  },
};
