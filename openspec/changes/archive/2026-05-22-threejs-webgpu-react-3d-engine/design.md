## Context

本项目是一个全新的三维引擎项目，目标是利用 Three.js 的 WebGPURenderer 结合 React 生态，构建一个轻量级、组件化的三维渲染引擎。当前市面上 @react-three/fiber (R3F) 是 React + Three.js 的主流方案，但它基于 WebGL 渲染器，尚未深度适配 WebGPU。本项目旨在从零构建一个面向 WebGPU 的 React 三维引擎，代码放置在 DimMain 目录下。

**技术栈约束**：
- 前端框架：React 18+ (函数组件 + Hooks)
- 渲染引擎：Three.js (r160+)，使用 WebGPURenderer
- 语言：TypeScript（严格模式）
- 构建工具：Vite 5+
- 包管理：pnpm

## Goals / Non-Goals

**Goals:**

- 提供可用的 WebGPU 三维渲染能力，支持基础场景搭建
- 实现 React 声明式组件 API，开发者可通过 JSX 描述三维场景
- 封装引擎核心（渲染循环、场景管理、相机控制），降低直接操作 Three.js API 的复杂度
- 支持基础几何体、材质、光照的声明式创建
- 提供一个完整的 Demo 场景作为使用示例

**Non-Goals:**

- 不实现物理引擎集成（如 Cannon.js、Rapier）
- 不实现后处理（Post-processing）管线
- 不实现骨骼动画、粒子系统等高级特性
- 不实现 GLTF/OBJ 等模型加载器（首期）
- 不实现编辑器 UI（Inspector、Hierarchy 等）
- 不兼容 WebGL 降级渲染（仅 WebGPU）

## Decisions

### 决策 1：使用 Three.js WebGPURenderer 而非原生 WebGPU API

**选择**：Three.js WebGPURenderer

**理由**：
- Three.js 已封装了 WebGPU 的底层细节（着色器编译、Pipeline 管理、Buffer 管理），开发效率远高于原生 WebGPU
- Three.js 的场景图、几何体、材质体系成熟稳定，无需重新造轮子
- WebGPURenderer 由 Three.js 核心团队维护，与 Three.js 生态完全兼容

**备选方案**：
- 原生 WebGPU API：灵活性最高，但开发成本过高，不适合"简单引擎"定位
- Babylon.js WebGPU：同样优秀，但 Three.js 社区生态更大，文档更丰富

### 决策 2：引擎架构采用分层设计

**选择**：三层架构（Core Layer → Engine Layer → React Layer）

**架构分层**：
```
┌─────────────────────────────┐
│       React Layer           │  ← 声明式组件 (Canvas, Mesh, Light...)
│       (react-bindings)      │     自定义 Hooks (useFrame, useEngine)
├─────────────────────────────┤
│       Engine Layer          │  ← 引擎核心逻辑
│  (scene, camera, geometry,  │     场景管理、相机、几何体、材质、光照
│   material, lighting)       │
├─────────────────────────────┤
│       Core Layer            │  ← 渲染器管理
│       (engine-core)         │     WebGPURenderer、渲染循环、帧调度
└─────────────────────────────┘
```

**理由**：
- 分层设计使引擎核心不依赖 React，可独立使用
- React Layer 仅作为声明式封装，底层替换不影响上层 API
- 每层职责清晰，便于独立测试和维护

### 决策 3：React 集成方案采用自定义 Reconciler 思路的简化版

**选择**：基于 React Context + Hooks + useEffect 生命周期管理的轻量方案

**理由**：
- 完整的 React Reconciler（如 R3F）实现复杂度极高，不适合简单引擎
- 使用 Context 传递引擎实例，useEffect 管理 Three.js 对象的创建/销毁，足以满足声明式场景描述需求
- 后期如有需要可升级为 Reconciler 方案

**备选方案**：
- React Custom Reconciler：功能最强但实现复杂度过高
- 纯命令式 API + React 包装：过于简单，无法实现真正的声明式体验

### 决策 4：项目目录结构

**选择**：按模块职责划分目录

```
DimMain/
├── src/
│   ├── core/               # 引擎核心（渲染器、渲染循环）
│   │   ├── Engine.ts
│   │   └── RenderLoop.ts
│   ├── scene/              # 场景管理
│   │   └── SceneManager.ts
│   ├── camera/             # 相机系统
│   │   ├── CameraManager.ts
│   │   └── OrbitControlsWrapper.ts
│   ├── geometry/           # 几何体系统
│   │   └── GeometryFactory.ts
│   ├── material/           # 材质系统
│   │   └── MaterialFactory.ts
│   ├── lighting/           # 光照系统
│   │   └── LightFactory.ts
│   ├── react/              # React 绑定层
│   │   ├── components/     # React 组件
│   │   │   ├── Canvas.tsx
│   │   │   ├── Mesh.tsx
│   │   │   ├── Light.tsx
│   │   │   └── Camera.tsx
│   │   ├── hooks/          # 自定义 Hooks
│   │   │   ├── useEngine.ts
│   │   │   └── useFrame.ts
│   │   └── context/        # React Context
│   │       └── EngineContext.tsx
│   ├── App.tsx             # Demo 入口
│   └── main.tsx            # 应用入口
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### 决策 5：WebGPU 可用性检测

**选择**：启动时检测，不可用则显示友好提示

**理由**：
- WebGPU 尚未在所有浏览器普及，启动时检测 `navigator.gpu` 是否存在
- 不支持时显示明确的文字提示，而非空白页面或报错
- 不做 WebGL 降级（Non-Goal），保持代码简洁

## Risks / Trade-offs

- **[WebGPU 兼容性]** WebGPU 目前仅在 Chrome 113+、Edge 113+ 稳定支持，Firefox 和 Safari 支持有限 → 在入口处做能力检测，显示不支持提示；文档中标注浏览器要求
- **[Three.js WebGPU API 稳定性]** Three.js 的 WebGPU 相关 API（如 NodeMaterial 系统）仍在活跃开发中，可能存在 Breaking Changes → 锁定 Three.js 版本，定期评估升级
- **[性能开销]** React 的声明式更新可能在高频场景变更时引入额外开销 → 渲染循环独立于 React 更新周期，使用 useFrame Hook 进行帧级别更新而非 setState
- **[简化方案的局限性]** 基于 Context + Hooks 的方案在深层嵌套场景图时可能存在性能问题 → 首期聚焦简单场景，后期可引入 Reconciler 方案优化
