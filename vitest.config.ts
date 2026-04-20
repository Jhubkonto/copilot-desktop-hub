import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          include: ['src/main/__tests__/**/*.test.ts'],
          environment: 'node'
        },
        resolve: {
          alias: {
            '@shared': resolve(__dirname, 'src/shared')
          }
        }
      },
      {
        test: {
          name: 'renderer',
          include: ['src/renderer/__tests__/**/*.test.{ts,tsx}'],
          environment: 'happy-dom',
          setupFiles: ['src/test/setup-renderer.ts']
        },
        esbuild: {
          jsx: 'automatic'
        },
        resolve: {
          alias: {
            '@shared': resolve(__dirname, 'src/shared')
          }
        }
      }
    ]
  }
})
