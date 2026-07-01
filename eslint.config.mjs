import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    ignores: ['dist/', 'release/', 'node_modules/', '*.config.*']
  },
  {
    files: ['src/**/__tests__/**/*.{ts,tsx}', 'src/test/mocks/**/*.ts'],
    rules: {
      // Test adapters intentionally bridge loosely typed Electron/sql.js mocks.
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
)
