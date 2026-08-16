module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    'vue/setup-compiler-macros': true,
  },
  globals: {
    uni: 'readonly',
    UniApp: 'readonly',
    wx: 'readonly',
    plus: 'readonly',
    getCurrentPages: 'readonly',
    getApp: 'readonly',
    QQMapWX: 'readonly',
  },
  extends: [
    'eslint:recommended',
    'plugin:vue/vue3-recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'warn',
    'vue/multi-word-component-names': 'off',
  },
  ignorePatterns: ['dist', 'node_modules', '*.d.ts'],
};
