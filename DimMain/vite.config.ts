import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite 构建配置
 * 配置 React 插件，确保 WebGPU 相关 Three.js 模块可正常导入
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      /* Three.js WebGPU 渲染器使用 addons 路径导入 */
      'three/addons': 'three/examples/jsm',
    },
  },
  optimizeDeps: {
    /* 预构建 three.js 和 WebGPU 模块以加速开发模式启动 */
    include: ['three', 'three/webgpu'],
    /* opencascade.js 包含 WASM，需排除预构建避免冲突 */
    exclude: ['opencascade.js'],
    esbuildOptions: {
      /* 确保支持 top-level await */
      target: 'esnext',
    },
  },
  /* 确保 .wasm 文件可被正确加载 */
  assetsInclude: ['**/*.wasm'],
});
