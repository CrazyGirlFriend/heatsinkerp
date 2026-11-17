import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  { ...js.configs.recommended, files: ['src/**/*.{ts,vue}'] },
  ...ts.configs.recommended.map((config) => ({ ...config, files: ['src/**/*.{ts,vue}'] })),
  ...vue.configs['flat/essential'],
  {
    files: ['src/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: ts.parser, extraFileExtensions: ['.vue'] },
    },
  },
  {
    files: ['src/**/*.{ts,vue}'],
    rules: {
      // TypeScript performs symbol resolution (including browser DOM globals).
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  { files: ['src/**/*.test.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  {
    files: ['src/pages/**/*.vue', 'src/components/**/*.vue'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/services/httpClient',
              importNames: ['httpRequest'],
              message: '业务请求放在 services，页面和组件调用业务 API。',
            },
            { name: 'axios', message: '统一通过业务 API 和 httpClient 发起请求。' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/pages/**/*.vue', 'src/components/*.vue'],
    ignores: [
      'src/components/App*.vue',
      'src/components/ColumnManagedTable.vue',
      'src/components/WorkspacePagination.vue',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "ImportDeclaration[source.value='element-plus'] > ImportSpecifier[imported.name=/^(ElButton|ElInput|ElSelect|ElDatePicker|ElInputNumber|ElDialog|ElDrawer|ElTable|ElPagination)$/]",
          message:
            '业务页面复用 App 控件、WorkspaceTable 和 WorkspacePagination；底层实现留在适配组件。',
        },
      ],
    },
  },
  {
    files: ['src/services/**/*.ts', 'src/utils/**/*.ts', 'src/types/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/pages/*',
                '@/components/*',
                '@/composables/*',
                '@/stores/*',
                '../pages/*',
                '../components/*',
                '../composables/*',
                '../stores/*',
              ],
              message:
                '底层服务、类型和工具不能反向依赖页面状态；共享契约放 types，状态变化通过事件通知。',
            },
          ],
        },
      ],
    },
  },
]
