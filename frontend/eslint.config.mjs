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
]
