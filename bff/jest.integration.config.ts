import { Config } from '@jest/types';

const config: Config.InitialOptions = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  // 集成测试用例后缀：.integration.spec.ts
  // 只匹配需要真实 DB 的集成测试
  testRegex: '.*\\.integration\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@neighborhood-help/test-utils$': '<rootDir>/../../packages/test-utils/src',
    '^@neighborhood-help/test-utils/(.*)$': '<rootDir>/../../packages/test-utils/src/$1',
  },
};

export default config;
