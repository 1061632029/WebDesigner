## Why

当前 Web 三维开发领域，WebGPU 作为下一代图形 API 正在逐步取代 WebGL，提供更强大的 GPU 计算能力和更低的开销。Three.js 已经内置了 WebGPURenderer 支持，但缺少与 React 生态的深度集成方案。我们需要构建一个基于 Three.js WebGPU 渲染器的简单三维引擎，并通过 React 组件化封装，降低三维应用开发门槛，让开发者能以声明式的方式构建三维场景。

## What Changes

- 新建基于 Vite + React + TypeScript 的项目脚手架
- 集成 Three.js WebGPURenderer 作为核心渲染后端
- 实现引擎核心模块：场景管理、相机系统、渲染循环
- 实现基础几何体系统（立方体、球体、平面等）
- 实现基础材质系统（基于 Three.js NodeMaterial / WebGPU 材质）
- 实现基础光照系统（环境光、平行光、点光源）
- 封装 React 组件层（Canvas、Scene、Mesh、Light 等声明式组件）
- 实现轨道控制器（OrbitControls）集成
- 提供一个示例 Demo 场景展示引擎能力

## Capabilities

### New Capabilities

- `engine-core`: 引擎核心模块，包含渲染循环、WebGPURenderer 初始化与管理、帧调度
- `scene-management`: 场景图管理，支持场景节点的创建、销毁、层级关系维护
- `camera-system`: 相机系统，支持透视相机和正交相机，集成 OrbitControls 轨道控制器
- `geometry-system`: 几何体系统，提供基础几何体（BoxGeometry、SphereGeometry、PlaneGeometry 等）
- `material-system`: 材质系统，封装 Three.js WebGPU 兼容材质（MeshStandardNodeMaterial 等）
- `lighting-system`: 光照系统，支持环境光、平行光、点光源的创建与管理
- `react-bindings`: React 组件绑定层，提供 Canvas、Scene、Mesh、Light 等声明式 React 组件和自定义 Hooks
- `demo-scene`: 示例场景，展示引擎核心能力的完整 Demo

### Modified Capabilities

（无，这是全新项目）

## Impact

- **依赖项**: 引入 three.js（含 WebGPU 模块）、React 18+、TypeScript、Vite 构建工具
- **浏览器兼容性**: 需要支持 WebGPU 的浏览器（Chrome 113+、Edge 113+、Firefox Nightly），不支持 WebGPU 时应有优雅降级提示
- **代码结构**: 在 DimMain 目录下建立完整的前端项目结构
- **API 表面**: 对外暴露 React 组件 API 和引擎核心 API
