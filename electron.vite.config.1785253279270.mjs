// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, mkdirSync } from "fs";
var __electron_vite_injected_dirname = "C:\\Users\\JulianLacis\\AppData\\Local\\Projects\\personal\\nexy";
function copyWorkers() {
  return {
    name: "copy-cjs-workers",
    closeBundle() {
      const src = resolve(__electron_vite_injected_dirname, "src/main/desktop-navigator-bridge-worker.cjs");
      const outDir = resolve(__electron_vite_injected_dirname, "dist/main");
      mkdirSync(outDir, { recursive: true });
      copyFileSync(src, resolve(outDir, "desktop-navigator-bridge-worker.cjs"));
    }
  };
}
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyWorkers()],
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "src/main/index.ts")
      }
    },
    resolve: {
      alias: {
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        input: {
          index: resolve(__electron_vite_injected_dirname, "src/preload/index.ts"),
          overlay: resolve(__electron_vite_injected_dirname, "src/preload/overlay.ts")
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    }
  },
  renderer: {
    server: {
      host: "127.0.0.1",
      port: 5100
    },
    plugins: [react()],
    root: resolve(__electron_vite_injected_dirname, "src/renderer"),
    build: {
      outDir: resolve(__electron_vite_injected_dirname, "dist/renderer"),
      rollupOptions: {
        input: {
          index: resolve(__electron_vite_injected_dirname, "src/renderer/index.html"),
          overlay: resolve(__electron_vite_injected_dirname, "src/renderer/overlay.html")
        },
        output: {
          entryFileNames: "[name].js"
        }
      }
    },
    resolve: {
      alias: {
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared")
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
