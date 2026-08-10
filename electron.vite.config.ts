import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, mkdirSync } from 'fs'

// Rollup plugin that copies static .cjs worker scripts to dist/main/
function copyWorkers(): import('vite').Plugin {
  return {
    name: 'copy-cjs-workers',
    closeBundle() {
      const src = resolve(__dirname, 'src/main/desktop-navigator-bridge-worker.cjs')
      const outDir = resolve(__dirname, 'dist/main')
      mkdirSync(outDir, { recursive: true })
      copyFileSync(src, resolve(outDir, 'desktop-navigator-bridge-worker.cjs'))
      copyFileSync(
        resolve(__dirname, 'src/main/supertonic-worker.cjs'),
        resolve(outDir, 'supertonic-worker.cjs'),
      )
      copyFileSync(
        resolve(__dirname, 'src/main/user-input-mcp-worker.cjs'),
        resolve(outDir, 'user-input-mcp-worker.cjs'),
      )
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyWorkers()],
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts')
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          overlay: resolve(__dirname, 'src/preload/overlay.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        }
      }
    }
  },
  renderer: {
    server: {
      host: '127.0.0.1',
      port: 5100,
    },
    plugins: [react()],
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      // AudioWorklet modules must remain self-hosted files under the production CSP.
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
        },
        output: {
          entryFileNames: '[name].js',
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  }
})
