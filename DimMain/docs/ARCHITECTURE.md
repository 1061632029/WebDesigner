
> 版本：0.1.0  
> 更新日期：2026-05-21  
> 项目名称：`dim-webgpu-engine`

---

## 1. 项目概述

Dim WebGPU Engine 是一个基于 **Three.js + WebGPU + React** 的轻量级三维渲染引擎。项目采用三层架构设计，将底层图形渲染、中间功能模块和上层声明式 React 组件进行清晰分离，提供了一套简洁的声明式 3D 场景构建 API。

**核心目标：**

- 利用 WebGPU 新一代图形 API 实现高性能三维渲染
- 通过 React 组件化方式声明式构建三维场景
- 模块化架构设计，职责清晰，易于扩展

---

## 2. 技术栈详解

### 2.1 Three.js（r170 / 0.170.0）

**技术简介：**  
Three.js 是目前最广泛使用的 JavaScript 3D 图形库，封装了 WebGL/WebGPU 底层 API，提供了场景图（Scene Graph）、几何体（Geometry）、材质（Material）、光照（Light）、相机（Camera）、渲染器（Renderer）等完整的 3D 图形抽象层。

**版本选择理由：**  
r170 是 Three.js 中 WebGPU 支持趋于成熟的版本。从 r160 开始，Three.js 将 WebGPURenderer 从 `examples/jsm` 移入主包的 `src/renderers/webgpu/` 目录，并提供了 `three/webgpu` 打包入口，标志着 WebGPU 后端从实验性功能升级为一等公民。r170 的 WebGPURenderer 已经支持自动回退到 WebGL、完整的节点材质系统（Node Material System）和异步渲染器初始化。

**在项目中的具体作用：**

| 使用场景 | 涉及文件 | 说明 |
|---------|---------|------|
| WebGPU 渲染器 | `core/Engine.ts` | 通过 `import { WebGPURenderer } from 'three/webgpu'` 导入，负责三维场景的 GPU 渲染 |
| 场景管理 | `scene/SceneManager.ts` | 使用 `THREE.Scene` 作为场景容器，管理所有 3D 对象的父子层级关系 |
| 相机系统 | `camera/CameraManager.ts` | 使用 `THREE.PerspectiveCamera` 和 `THREE.OrthographicCamera` 构建视角投影 |
| 轨道控制器 | `camera/OrbitControlsWrapper.ts` | 使用 `three/examples/jsm/controls/OrbitControls.js` 实现鼠标/触摸交互控制 |
| 几何体创建 | `geometry/GeometryFactory.ts` | 封装 `BoxGeometry`、`SphereGeometry`、`PlaneGeometry`、`CylinderGeometry`、`TorusGeometry` |
| 材质创建 | `material/MaterialFactory.ts` | 封装 `MeshStandardMaterial`、`MeshBasicMaterial`、`MeshPhysicalMaterial` |
| 光照创建 | `lighting/LightFactory.ts` | 封装 `AmbientLight`、`DirectionalLight`、`PointLight` |
| 时间管理 | `core/Engine.ts` | 使用 `THREE.Clock` 计算帧间隔（deltaTime）和累计时间（elapsedTime） |

**关键配置：**

```typescript
// vite.config.ts — 预构建优化
optimizeDeps: {
  include: ['three', 'three/webgpu'],  // 将 Three.js 加入 Vite 预构建列表
}

// vite.config.ts — 路径别名
resolve: {
  alias: {
    'three/addons': 'three/examples/jsm',  // addons 路径映射
  },
}
```

---

### 2.2 WebGPU（浏览器原生 API）

**技术简介：**  
WebGPU 是 W3C 标准化的下一代 Web 图形和计算 API，设计目标是替代 WebGL，提供更接近底层硬件的 GPU 访问能力。相比 WebGL，WebGPU 具有更高效的多线程渲染管线、Compute Shader 支持、更好的 GPU 资源管理和更低的 CPU 开销。

**版本选择理由：**  
WebGPU 于 2023 年在 Chrome 113+ 中正式发布，目前 Chrome、Edge、Firefox（Nightly）、Safari（Technology Preview）均已支持。项目选择 WebGPU 作为渲染后端，面向现代浏览器环境。

**在项目中的具体作用：**

| 使用场景 | 涉及文件 | 说明 |
|---------|---------|------|
| 渲染后端 | `core/Engine.ts` | `WebGPURenderer` 在 `init()` 方法中异步请求 GPU 设备（`navigator.gpu`），创建渲染管线 |
| 可用性检测 | `core/Engine.ts` | `checkWebGPUSupport()` 静态方法检测 `navigator.gpu` 是否存在 |
| 错误降级 | `react/components/Canvas.tsx` | WebGPU 不可用时显示友好提示 UI，引导用户使用支持的浏览器 |
| 类型声明 | `types/three-webgpu.d.ts` | 为 `three/webgpu` 模块提供 TypeScript 类型定义 |

**关键配置：**

```typescript
// Engine.ts — WebGPU 可用性检测
public static checkWebGPUSupport(): boolean {
  return 'gpu' in navigator;
}

// Engine.ts — 异步初始化（WebGPU 需要异步请求 GPU 适配器）
await this._renderer.init();
```

**浏览器兼容性要求：**
- Chrome 113+ ✅
- Edge 113+ ✅
- Firefox Nightly（需手动开启 `dom.webgpu.enabled`）⚠️
- Safari Technology Preview（部分支持）⚠️

---

### 2.3 React（18.3.1）

**技术简介：**  
React 是 Meta 开发的声明式 UI 组件库，基于虚拟 DOM 实现高效的 UI 更新。React 18 引入了并发模式（Concurrent Mode）、自动批处理（Automatic Batching）和 Suspense 增强。

**版本选择理由：**  
React 18.3.x 是 React 18 系列的稳定版本，支持 `createRoot` API、StrictMode 的双重渲染检测和 Hooks 全套功能，是当前生产环境的推荐版本。

**在项目中的具体作用：**

| 使用场景 | 涉及文件 | 说明 |
|---------|---------|------|
| 应用入口 | `main.tsx` | `ReactDOM.createRoot()` 挂载根组件，启用 `StrictMode` |
| Context 状态传递 | `react/context/EngineContext.tsx` | `React.createContext` 创建引擎实例上下文，向组件树传递 `Engine` 实例 |
| 自定义 Hooks | `react/hooks/useEngine.ts` | `useContext` 获取引擎实例 |
| 帧回调 Hook | `react/hooks/useFrame.ts` | `useEffect` + `useRef` 管理帧回调的注册/注销生命周期 |
| 声明式场景组件 | `react/components/Canvas.tsx` | 引擎初始化、渲染循环启动、Context Provider 包裹 |
| 声明式 3D 对象 | `react/components/Mesh.tsx` | `useEffect` 管理 Three.js Mesh 的创建、属性更新和销毁 |
| 声明式光源 | `react/components/Light.tsx` | `useEffect` 管理 AmbientLight / DirectionalLight / PointLight 生命周期 |
| 声明式相机 | `react/components/Camera.tsx` | `useEffect` 创建 PerspectiveCamera 并配置 OrbitControls |
| Demo 场景 | `App.tsx`, `demo/RotatingBox.tsx` | 组合使用上述组件构建完整的三维演示场景 |

**关键设计：**  
React 在本项目中充当"声明式场景描述层"，**不直接参与 3D 渲染**。React 组件通过 `useEffect` 生命周期调用引擎核心层的命令式 API，实现了声明式描述 ↔ 命令式执行的桥接。

---

### 2.4 TypeScript（5.6.x，严格模式）

**技术简介：**  
TypeScript 是 JavaScript 的超集，通过静态类型系统在编译期捕获类型错误，提升大型项目的可维护性和开发者体验。

**版本选择理由：**  
TypeScript 5.6 支持最新的 ES2020+ 特性、改进的类型推导、以及更好的 module resolution 策略（`bundler` 模式），与 Vite 6 完美配合。

**在项目中的具体作用：**

| 使用场景 | 涉及文件 | 说明 |
|---------|---------|------|
| 全局类型安全 | 所有 `.ts` / `.tsx` 文件 | 所有变量、参数、返回值均使用显式类型声明（遵循项目编码规范） |
| 接口定义 | 各模块文件 | 定义了 `EngineOptions`、`PerspectiveCameraOptions`、`StandardMaterialOptions`、`CanvasProps`、`MeshProps` 等 20+ 接口 |
| 类型导出 | `core/Engine.ts` | 导出 `FrameCallback` 类型供 Hooks 和 RenderLoop 使用 |
| 自定义类型声明 | `types/three-webgpu.d.ts` | 为 `three/webgpu` 和 `three/src/renderers/webgpu/WebGPURenderer.js` 提供类型声明 |
| 泛型约束 | `react/hooks/*.ts` | `React.MutableRefObject<T>` 等泛型类型的显式使用 |

**关键配置（tsconfig.json）：**

```json
{
  "compilerOptions": {
    "target": "ES2020",           // 编译目标：ES2020（支持可选链、空值合并等）
    "strict": true,               // 启用全部严格检查
    "noUnusedLocals": true,       // 禁止未使用的局部变量
    "noUnusedParameters": true,   // 禁止未使用的函数参数
    "noUncheckedIndexedAccess": true,  // 索引访问返回 T | undefined
    "jsx": "react-jsx",           // React 17+ 的自动 JSX 转换
    "moduleResolution": "bundler" // Vite 兼容的模块解析策略
  }
}
```

---

### 2.5 Vite（6.x）

**技术简介：**  
Vite 是下一代前端构建工具，开发模式基于 ESM 原生模块实现毫秒级热更新（HMR），生产构建基于 Rollup 实现 Tree-shaking 和代码分割。

**版本选择理由：**  
Vite 6 是当前最新的稳定大版本，提供了更快的依赖预构建、改进的 CSS 处理和更好的大型依赖支持，特别适合 Three.js 这种体积庞大的库。

**在项目中的具体作用：**

| 使用场景 | 涉及文件 | 说明 |
|---------|---------|------|
| 开发服务器 | `vite.config.ts` | `vite dev` 启动开发服务器，支持 ESM 热更新 |
| React JSX 转换 | `vite.config.ts` | `@vitejs/plugin-react` 插件处理 JSX/TSX 编译 |
| 依赖预构建 | `vite.config.ts` | `optimizeDeps.include` 预构建 `three` 和 `three/webgpu`，避免开发模式下大量 ESM 请求 |
| 路径别名 | `vite.config.ts` | `resolve.alias` 映射 `three/addons` 到 `three/examples/jsm` |
| ESBuild 配置 | `vite.config.ts` | `esbuildOptions.target: 'esnext'` 确保支持 top-level await |
| 生产构建 | `package.json` | `tsc -b && vite build` 先类型检查再打包 |

**关键配置：**

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { 'three/addons': 'three/examples/jsm' },
  },
  optimizeDeps: {
    include: ['three', 'three/webgpu'],
    esbuildOptions: { target: 'esnext' },
  },
});
```

---

### 2.6 pnpm（包管理器）

**技术简介：**  
pnpm 是高性能的 Node.js 包管理器，通过硬链接和内容寻址存储实现极快的安装速度和磁盘空间节约。相比 npm/yarn，pnpm 的 `node_modules` 采用非扁平结构（strict mode），强制依赖声明的正确性。

**在项目中的具体作用：**
- 管理项目依赖安装（`pnpm install`）
- 通过 `pnpm-lock.yaml` 锁定依赖版本，确保团队环境一致性
- 非扁平 `node_modules` 结构天然阻止了幽灵依赖（phantom dependencies）

---

### 2.7 OrbitControls（Three.js Addons）

**技术简介：**  
OrbitControls 是 Three.js 官方提供的相机轨道控制器插件，支持鼠标拖拽旋转、滚轮缩放、右键平移等交互操作，是三维场景中最常用的相机控制方式。

**在项目中的具体作用：**

| 使用场景 | 涉及文件 | 说明 |
|---------|---------|------|
| 控制器封装 | `camera/OrbitControlsWrapper.ts` | 封装 OrbitControls，提供 `configure()`、`enable()`、`disable()`、`update()`、`dispose()` 方法 |
| 相机集成 | `camera/CameraManager.ts` | `enableOrbitControls()` / `disableOrbitControls()` 方法管理控制器生命周期 |
| React 绑定 | `react/components/Camera.tsx` | `PerspectiveCamera` 组件的 `enableOrbitControls` 属性声明式启用控制器 |
| 每帧更新 | `core/Engine.ts` | `_onFrame()` 中调用 `cameraManager.updateControls()` 更新阻尼效果 |

---

### 技术栈版本汇总

| 技术 | 版本 | 类别 | 角色 |
|------|------|------|------|
| Three.js | 0.170.0 (r170) | 运行时依赖 | 3D 图形基础设施 |
| WebGPU | 浏览器原生 | 运行时环境 | GPU 渲染后端 |
| React | 18.3.1 | 运行时依赖 | 声明式 UI/场景描述 |
| React DOM | 18.3.1 | 运行时依赖 | DOM 渲染桥接 |
| TypeScript | ~5.6.2 | 开发依赖 | 类型安全 |
| Vite | ^6.0.0 | 开发依赖 | 构建工具 |
| @vitejs/plugin-react | ^4.3.4 | 开发依赖 | React JSX 编译 |
| @types/three | ^0.170.0 | 开发依赖 | Three.js 类型声明 |
| @types/react | ^18.3.12 | 开发依赖 | React 类型声明 |
| pnpm | 10.32+ | 工具链 | 包管理器 |

---

## 3. 架构分层图

```
┌─────────────────────────────────────────────────────────────┐
│                    应用层 (App / Demo)                       │
│  App.tsx  ·  RotatingBox.tsx                                │
│  组合使用下层组件构建完整的三维演示场景                         │
├─────────────────────────────────────────────────────────────┤
│              React 绑定层 (react/)                           │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────────────┐  │
│  │  Components   │  │   Hooks     │  │    Context        │  │
│  │  Canvas       │  │  useEngine  │  │  EngineContext    │  │
│  │  Mesh         │  │  useFrame   │  │                   │  │
│  │  Light (x3)   │  │             │  │                   │  │
│  │  Camera       │  │             │  │                   │  │
│  └──────────────┘  └─────────────┘  └───────────────────┘  │
│  职责：声明式 API ↔ 命令式引擎 API 的桥接层                    │
├─────────────────────────────────────────────────────────────┤
│              功能模块层 (scene/camera/geometry/...)           │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────────────────┐ │
│  │ Scene    │ │ Camera       │ │ Factories               │ │
│  │ Manager  │ │ Manager      │ │ GeometryFactory         │ │
│  │          │ │ OrbitControls│ │ MaterialFactory         │ │
│  │          │ │ Wrapper      │ │ LightFactory            │ │
│  └──────────┘ └──────────────┘ └─────────────────────────┘ │
│  职责：封装 Three.js API，提供引擎级的功能抽象                  │
├─────────────────────────────────────────────────────────────┤
│              引擎核心层 (core/)                               │
│  ┌──────────────────────┐  ┌───────────────────────────┐   │
│  │ Engine               │  │ RenderLoop                │   │
│  │ · WebGPURenderer 管理│  │ · requestAnimationFrame   │   │
│  │ · 生命周期控制        │  │ · 帧回调注册/执行          │   │
│  │ · 尺寸自适应          │  │ · 启动/停止控制           │   │
│  │ · 资源释放            │  │                           │   │
│  └──────────────────────┘  └───────────────────────────┘   │
│  职责：渲染器管理 + 渲染循环驱动                               │
├─────────────────────────────────────────────────────────────┤
│         Three.js r170 + WebGPU Backend                      │
│         (three/webgpu → WebGPURenderer → GPU)               │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 目录结构

```
DimMain/
├── index.html                          # HTML 入口（全屏 CSS + #root 挂载点）
├── package.json                        # 项目配置与依赖声明
├── pnpm-lock.yaml                      # pnpm 锁文件
├── tsconfig.json                       # TypeScript 严格模式配置
├── vite.config.ts                      # Vite 构建配置（React 插件 + Three.js 优化）
│
└── src/
    ├── main.tsx                        # React 应用入口（createRoot + StrictMode）
    ├── App.tsx                         # Demo 根组件（场景组合）
    ├── vite-env.d.ts                   # Vite 环境类型声明
    │
    ├── core/                           # 🔵 引擎核心层
    │   ├── Engine.ts                   #   引擎主类：初始化、渲染、销毁
    │   └── RenderLoop.ts              #   渲染循环：rAF 驱动 + 帧回调管理
    │
    ├── scene/                          # 🟢 场景管理
    │   └── SceneManager.ts            #   场景节点增删 + 背景设置 + 资源释放
    │
    ├── camera/                         # 🟡 相机系统
    │   ├── CameraManager.ts           #   相机创建/切换/宽高比更新
    │   └── OrbitControlsWrapper.ts    #   轨道控制器封装
    │
    ├── geometry/                       # 🟠 几何体工厂
    │   └── GeometryFactory.ts         #   Box/Sphere/Plane/Cylinder/Torus
    │
    ├── material/                       # 🔴 材质工厂
    │   └── MaterialFactory.ts         #   Standard/Basic/Physical PBR
    │
    ├── lighting/                       # 🟣 光照工厂
    │   └── LightFactory.ts            #   Ambient/Directional/Point
    │
    ├── react/                          # ⚛️ React 绑定层
    │   ├── context/
    │   │   └── EngineContext.tsx       #   React Context 定义
    │   ├── hooks/
    │   │   ├── useEngine.ts           #   获取引擎实例 Hook
    │   │   └── useFrame.ts            #   帧回调注册 Hook
    │   └── components/
    │       ├── Canvas.tsx              #   根容器组件（引擎初始化 + Context Provider）
    │       ├── Mesh.tsx                #   网格组件（几何体 + 材质 + 变换）
    │       ├── Light.tsx               #   光源组件（Ambient/Directional/Point）
    │       └── Camera.tsx              #   透视相机组件（含 OrbitControls）
    │
    ├── demo/                           # 📦 示例代码
    │   └── RotatingBox.tsx            #   旋转立方体（useFrame 动画演示）
    │
    └── types/                          # 📝 自定义类型声明
        └── three-webgpu.d.ts          #   three/webgpu 模块类型定义
```

---

## 5. 核心模块详解

### 5.1 Engine（引擎核心）

**文件：** `core/Engine.ts`  
**职责：** 整个三维引擎的入口点，统一管理渲染器、场景、相机和渲染循环。

| 方法 | 说明 |
|------|------|
| `constructor(options)` | 创建引擎实例，初始化 SceneManager、CameraManager、RenderLoop |
| `async init()` | 异步初始化 WebGPURenderer（检测 WebGPU → 创建渲染器 → 设置尺寸 → 挂载 canvas → 设置 ResizeObserver） |
| `start()` / `stop()` | 启动/停止渲染循环和时钟 |
| `onFrame(callback)` | 注册帧回调函数，返回取消注册函数 |
| `dispose()` | 完整的资源释放链：停止循环 → 移除监听 → 销毁场景 → 销毁控制器 → 销毁渲染器 → 移除 canvas |

**属性：**
- `renderer` — WebGPURenderer 实例
- `sceneManager` — 场景管理器
- `cameraManager` — 相机管理器
- `isReady` — 引擎是否已就绪

### 5.2 RenderLoop（渲染循环）

**文件：** `core/RenderLoop.ts`  
**职责：** 基于 `requestAnimationFrame` 驱动每帧更新，管理帧回调函数列表。

| 方法 | 说明 |
|------|------|
| `start()` / `stop()` | 启动/停止 rAF 循环 |
| `addFrameCallback(callback)` | 注册帧回调，返回取消函数 |
| `executeCallbacks(dt, elapsed)` | 执行所有注册的帧回调 |
| `clearCallbacks()` | 清除所有帧回调 |

### 5.3 SceneManager（场景管理）

**文件：** `scene/SceneManager.ts`  
**职责：** 创建和管理 Three.js Scene 实例。

| 方法 | 说明 |
|------|------|
| `getScene()` | 获取当前 Scene 实例 |
| `add(object)` / `remove(object)` | 添加/移除 Object3D 节点 |
| `setBackground(color)` | 设置场景背景色 |
| `dispose()` | 遍历释放所有子节点的 Geometry 和 Material |

### 5.4 CameraManager（相机管理）

**文件：** `camera/CameraManager.ts`  
**职责：** 创建和管理相机实例，集成轨道控制器。

| 方法 | 说明 |
|------|------|
| `createPerspectiveCamera(options?)` | 创建透视相机（默认 fov=75, near=0.1, far=1000） |
| `createOrthographicCamera(...)` | 创建正交相机 |
| `setPosition(x, y, z)` | 设置活动相机位置 |
| `setLookAt(x, y, z)` | 设置活动相机观察目标 |
| `updateAspect(w, h)` | 更新宽高比（窗口大小变化时自动调用） |
| `enableOrbitControls(dom, target?)` | 启用轨道控制器 |
| `disableOrbitControls()` | 禁用并销毁轨道控制器 |
| `updateControls()` | 每帧更新控制器状态（阻尼效果必须） |

### 5.5 OrbitControlsWrapper（轨道控制器封装）

**文件：** `camera/OrbitControlsWrapper.ts`  
**职责：** 封装 Three.js OrbitControls，提供配置接口。

**默认配置：** enableDamping=true, dampingFactor=0.05, minDistance=1, maxDistance=100, enablePan=true

### 5.6 GeometryFactory（几何体工厂）

**文件：** `geometry/GeometryFactory.ts`  
**职责：** 提供静态工厂方法创建基础几何体。

| 方法 | 默认参数 |
|------|---------|
| `createBox(w, h, d)` | 1 × 1 × 1 |
| `createSphere(r, wSeg, hSeg)` | r=1, 32×16 分段 |
| `createPlane(w, h)` | 1 × 1 |
| `createCylinder(rTop, rBot, h, seg)` | r=1, h=1, 32 分段 |
| `createTorus(r, tube, rSeg, tSeg)` | r=1, tube=0.4, 16×48 分段 |

### 5.7 MaterialFactory（材质工厂）

**文件：** `material/MaterialFactory.ts`  
**职责：** 提供静态工厂方法创建 PBR 材质。

| 方法 | 材质类型 | 特点 |
|------|---------|------|
| `createStandard(options?)` | MeshStandardMaterial | 标准 PBR（color, metalness, roughness） |
| `createBasic(options?)` | MeshBasicMaterial | 不受光照影响，纯颜色 |
| `createPhysical(options?)` | MeshPhysicalMaterial | 高级 PBR（+ clearcoat, transmission） |

### 5.8 LightFactory（光照工厂）

**文件：** `lighting/LightFactory.ts`  
**职责：** 提供静态工厂方法创建光源。

| 方法 | 光源类型 | 默认参数 |
|------|---------|---------|
| `createAmbientLight(options?)` | AmbientLight | color=0xffffff, intensity=0.5 |
| `createDirectionalLight(options?)` | DirectionalLight | intensity=1.0, position=[5,5,5] |
| `createPointLight(options?)` | PointLight | intensity=1.0, distance=0, decay=2 |

---

## 6. React 绑定层详解

### 6.1 EngineContext（引擎上下文）

**文件：** `react/context/EngineContext.tsx`

```
EngineContext: React.Context<{ engine: Engine } | null>
```

- 默认值为 `null`，仅在 `Canvas` 组件内部有效值
- 子组件通过 `useContext(EngineContext)` 获取引擎实例

### 6.2 useEngine Hook

**文件：** `react/hooks/useEngine.ts`

- 从 Context 中获取 Engine 实例
- 在 Canvas 外调用时抛出明确错误信息

### 6.3 useFrame Hook

**文件：** `react/hooks/useFrame.ts`

- 注册帧回调函数（接收 deltaTime 和 elapsedTime）
- 通过 `useRef` 始终持有最新的回调引用（避免闭包陈旧问题）
- 组件卸载时自动注销帧回调

### 6.4 Canvas 组件

**文件：** `react/components/Canvas.tsx`

**生命周期：**
1. 组件挂载 → 创建 Engine 实例（传入 container DOM 引用）
2. 异步调用 `engine.init()` → 等待 WebGPURenderer 初始化
3. 调用 `engine.start()` → 启动渲染循环
4. 设置 `isReady = true` → 渲染 Context Provider + 子组件
5. 组件卸载 → 调用 `engine.dispose()` → 释放所有资源

**状态管理：**
- `isReady` — 引擎是否就绪（就绪后才渲染子组件）
- `error` — 初始化错误（显示错误提示 UI）
- `disposed` 标志位 — 防止 StrictMode 双重渲染导致的资源泄漏

### 6.5 Mesh 组件

**文件：** `react/components/Mesh.tsx`

| 属性 | 类型 | 说明 |
|------|------|------|
| `geometry` | `'box' \| 'sphere' \| 'plane' \| 'cylinder' \| 'torus'` | 几何体类型 |
| `material` | `'standard' \| 'basic' \| 'physical'` | 材质类型 |
| `position` | `[x, y, z]` | 位置 |
| `rotation` | `[x, y, z]` | 旋转（弧度） |
| `scale` | `[x, y, z]` | 缩放 |
| `color` | `number` | 颜色（十六进制） |
| `metalness` | `number` | 金属度 |
| `roughness` | `number` | 粗糙度 |
| `onCreated` | `(mesh) => void` | Mesh 创建后回调 |

### 6.6 Light 组件

**文件：** `react/components/Light.tsx`

导出三个函数组件：`AmbientLight`、`DirectionalLight`、`PointLight`，属性与 LightFactory 的配置选项一一对应。

### 6.7 PerspectiveCamera 组件

**文件：** `react/components/Camera.tsx`

| 属性 | 类型 | 说明 |
|------|------|------|
| `fov` | `number` | 视场角（度） |
| `near` / `far` | `number` | 近/远裁剪面 |
| `position` | `[x, y, z]` | 相机位置 |
| `lookAt` | `[x, y, z]` | 观察目标 |
| `enableOrbitControls` | `boolean` | 是否启用轨道控制器 |

---

## 7. 数据流与生命周期

### 7.1 初始化流程

```
React 渲染 <App>
  └→ <Canvas> 组件挂载
       └→ containerRef 获取 DOM 元素
            └→ new Engine({ container }) 创建引擎实例
                 ├→ new SceneManager()     创建场景
                 ├→ new CameraManager()    创建相机
                 └→ new RenderLoop(onFrame) 创建渲染循环
            └→ engine.init() 异步初始化
                 ├→ checkWebGPUSupport()   检测 WebGPU
                 ├→ new WebGPURenderer()   创建渲染器
                 ├→ renderer.init()        GPU 设备请求（异步）
                 ├→ renderer.setSize()     设置尺寸
                 ├→ container.appendChild(canvas) 挂载画布
                 └→ setupResizeObserver()  监听尺寸变化
            └→ engine.start()  启动时钟 + 渲染循环
            └→ setIsReady(true) → 渲染子组件（场景内容）
                 ├→ <PerspectiveCamera> → 创建相机 + OrbitControls
                 ├→ <AmbientLight> → 添加环境光到场景
                 ├→ <DirectionalLight> → 添加平行光到场景
                 ├→ <Mesh> → 创建 Mesh 添加到场景
                 └→ <RotatingBox> → 创建 Mesh + 注册帧回调
```

### 7.2 每帧渲染流程

```
requestAnimationFrame 触发
  └→ RenderLoop._tick()
       └→ Engine._onFrame()
            ├→ clock.getDelta()              获取帧间隔
            ├→ clock.getElapsedTime()        获取累计时间
            ├→ renderLoop.executeCallbacks() 执行所有帧回调
            │    └→ (例如 RotatingBox 的旋转更新)
            ├→ cameraManager.updateControls() 更新轨道控制器阻尼
            └→ renderer.render(scene, camera) GPU 渲染
       └→ requestAnimationFrame(_tick)  请求下一帧
```

### 7.3 资源释放流程

```
Canvas 组件卸载
  └→ engine.dispose()
       ├→ stop()                    停止渲染循环 + 时钟
       ├→ resizeObserver.disconnect() 移除尺寸监听
       ├→ sceneManager.dispose()    遍历释放 Geometry + Material
       ├→ cameraManager.dispose()   销毁 OrbitControls
       ├→ renderer.dispose()        释放 GPU 资源
       ├→ removeChild(canvas)       移除 canvas DOM
       └→ renderLoop.clearCallbacks() 清除帧回调
```

---

## 8. 模块依赖关系图

```
                        ┌──────────┐
                        │  App.tsx │
                        └─────┬────┘
                              │ uses
               ┌──────────────┼──────────────┐
               ▼              ▼              ▼
         ┌──────────┐  ┌──────────┐  ┌─────────────┐
         │  Canvas  │  │   Mesh   │  │RotatingBox  │
         └────┬─────┘  └────┬─────┘  └──────┬──────┘
              │              │               │
              │         ┌────┴────┐     ┌────┴────┐
              │         │useEngine│     │useFrame │
              │         └────┬────┘     └────┬────┘
              │              │               │
              ▼              ▼               ▼
       ┌─────────────────────────────────────────┐
       │           EngineContext                  │
       └──────────────────┬──────────────────────┘
                          │ provides
                          ▼
                    ┌───────────┐
                    │  Engine   │
                    └─────┬─────┘
           ┌──────────┬───┴───┬──────────┐
           ▼          ▼       ▼          ▼
     ┌───────────┐ ┌──────┐ ┌──────┐ ┌───────────┐
     │RenderLoop │ │Scene │ │Camera│ │WebGPU     │
     │           │ │Mgr   │ │Mgr   │ │Renderer   │
     └───────────┘ └──┬───┘ └──┬───┘ └───────────┘
                      │        │
                      │   ┌────┴──────┐
                      │   │OrbitCtrl  │
                      │   │Wrapper    │
                      │   └───────────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │Geometry  │ │Material  │ │Light     │
    │Factory   │ │Factory   │ │Factory   │
    └──────────┘ └──────────┘ └──────────┘
```

---

## 9. 关键设计决策

### 9.1 为何选择 `three/webgpu` 而非 WebGLRenderer？

- **性能优势：** WebGPU 提供更低的 CPU 开销、更高效的 GPU 资源管理和 Compute Shader 支持
- **面向未来：** WebGPU 是 W3C 标准化的下一代 Web 图形 API，WebGL 已进入维护模式
- **Three.js 官方支持：** r170 提供了 `three/webgpu` 打包入口，WebGPURenderer 自动回退到 WebGL

### 9.2 工厂模式 vs 直接实例化

采用**静态工厂方法**模式（`GeometryFactory.createBox()`），优势：
- 统一参数默认值管理，减少重复代码
- 隐藏 Three.js API 的构造细节
- 便于未来替换底层实现（如节点材质迁移）

### 9.3 React Context + Hooks 的绑定策略

采用 **Context + useEffect** 模式（而非 React Three Fiber 的 reconciler 方案），原因：
- **架构简单：** 不需要自定义 React reconciler，降低复杂度
- **引擎独立：** 引擎核心层不依赖 React，可独立使用
- **学习成本低：** 仅使用标准的 React Hooks API

### 9.4 异步初始化 + StrictMode 兼容

- WebGPURenderer 需要异步初始化（`await renderer.init()`），因此 Engine 采用 `constructor + async init()` 两步初始化模式
- Canvas 组件通过 `disposed` 标志位防止 React StrictMode 双重渲染导致的资源泄漏

### 9.5 单一职责的文件拆分

- 每个类/接口独立一个文件，文件名与类名一致
- 工厂类（Factory）采用纯静态方法，无实例状态
- React 组件按功能分文件：Canvas、Mesh、Light、Camera

---

## 10. 快速启动

```bash
# 安装依赖
cd DimMain
pnpm install

# 启动开发服务器
pnpm dev

# 使用支持 WebGPU 的浏览器访问
# Chrome 113+ / Edge 113+
```

---

*文档结束*
