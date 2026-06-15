import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite 构建配置
 * 配置 React 插件、依赖预构建、资源加载与生产环境拆包策略。
 */
const config: UserConfig = defineConfig({
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
  build: {
    rollupOptions: {
      output: {
        /**
         * 根据依赖来源拆分生产环境 chunk，降低主包体积并提升浏览器缓存命中率。
         * @param id 模块绝对路径或虚拟模块标识。
         * @returns chunk 名称；返回 undefined 时交给 Rollup 默认处理。
         */
        manualChunks(id: string): string | undefined {
          /* React 生态单独拆包，通常变更频率低，适合长期缓存。 */
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }

          /* Three.js 体积较大，单独拆包，避免挤入业务主包。 */
          if (id.includes('node_modules/three')) {
            return 'vendor-three';
          }

          /* OpenCascade 包含较重的几何内核逻辑，单独拆包便于缓存。 */
          if (id.includes('node_modules/opencascade.js')) {
            return 'vendor-opencascade';
          }

          /* 工作区公共模块单独拆包，便于共享逻辑与主应用缓存分离。 */
          if (id.includes('DimShared') || id.includes('node_modules/dim-shared')) {
            return 'shared';
          }

          /* 其他第三方依赖统一放到 vendor，避免主业务包继续膨胀。 */
          if (id.includes('node_modules')) {
            return 'vendor';
          }

          return undefined;
        },
      },
    },
  },
  /* 确保 .wasm 文件可被正确加载 */
  assetsInclude: ['**/*.wasm'],
});

export default config;
