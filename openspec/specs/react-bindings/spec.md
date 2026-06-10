## ADDED Requirements

### Requirement: Canvas 根组件
引擎 MUST 提供 `<Canvas>` React 组件作为三维场景的根容器。Canvas 组件 SHALL 负责初始化引擎实例、创建 WebGPURenderer、启动渲染循环，并通过 React Context 向子组件提供引擎实例。

#### Scenario: 渲染 Canvas 组件
- **WHEN** 在 React 应用中渲染 `<Canvas>` 组件
- **THEN** 自动创建引擎实例和 WebGPURenderer，canvas 元素挂载到 DOM，渲染循环启动

#### Scenario: Canvas 组件卸载时清理资源
- **WHEN** `<Canvas>` 组件从 React 树中卸载
- **THEN** 引擎实例被销毁，所有 GPU 资源释放，渲染循环停止

#### Scenario: Canvas 组件接收尺寸属性
- **WHEN** 为 `<Canvas>` 组件设置 style 属性（如 width、height）
- **THEN** 渲染器按指定尺寸初始化，并支持自适应

### Requirement: Mesh 网格组件
引擎 MUST 提供 `<Mesh>` React 组件，用于声明式创建 Three.js Mesh 对象。Mesh 组件 SHALL 接受 geometry、material、position、rotation、scale 等属性。

#### Scenario: 渲染 Mesh 组件
- **WHEN** 在 `<Canvas>` 内渲染 `<Mesh geometry="box" material="standard" position={[0, 0, 0]}>` 组件
- **THEN** 在场景中创建一个使用 BoxGeometry 和 MeshStandardNodeMaterial 的 Mesh 对象，位于原点

#### Scenario: 动态更新 Mesh 属性
- **WHEN** Mesh 组件的 position 属性从 [0,0,0] 变更为 [1,2,3]
- **THEN** 对应的 Three.js Mesh 对象位置更新为 (1,2,3)

#### Scenario: Mesh 组件卸载时清理
- **WHEN** `<Mesh>` 组件从 React 树中卸载
- **THEN** 对应的 Three.js Mesh 对象从场景中移除，几何体和材质资源释放

### Requirement: Light 光源组件
引擎 MUST 提供 `<AmbientLight>`、`<DirectionalLight>`、`<PointLight>` React 组件，用于声明式创建光源。

#### Scenario: 渲染环境光组件
- **WHEN** 在 `<Canvas>` 内渲染 `<AmbientLight color={0xffffff} intensity={0.5} />`
- **THEN** 场景中创建一个环境光，颜色白色，强度 0.5

#### Scenario: 渲染平行光组件
- **WHEN** 在 `<Canvas>` 内渲染 `<DirectionalLight position={[5, 5, 5]} intensity={1.0} />`
- **THEN** 场景中创建一个平行光，位于 (5,5,5)，强度 1.0

#### Scenario: 动态更新光源属性
- **WHEN** 光源组件的 intensity 属性发生变化
- **THEN** 对应的 Three.js 光源对象强度同步更新

### Requirement: Camera 相机组件
引擎 MUST 提供 `<PerspectiveCamera>` React 组件，用于声明式配置相机。相机组件 SHALL 支持设置 fov、near、far、position 属性。

#### Scenario: 渲染透视相机组件
- **WHEN** 在 `<Canvas>` 内渲染 `<PerspectiveCamera fov={75} position={[0, 2, 5]} />`
- **THEN** 引擎的活动相机设为透视相机，fov=75，位置 (0,2,5)

#### Scenario: 启用 OrbitControls
- **WHEN** 为 `<PerspectiveCamera>` 设置 `enableOrbitControls={true}`
- **THEN** OrbitControls 被激活，用户可通过鼠标交互控制相机

### Requirement: EngineContext 上下文
引擎 MUST 通过 React Context（EngineContext）向所有子组件提供引擎实例的访问能力。

#### Scenario: 子组件通过 Context 获取引擎实例
- **WHEN** 在 `<Canvas>` 的子组件中调用 `useEngine()` Hook
- **THEN** 返回当前引擎实例，包含 renderer、scene、camera 等核心引用

### Requirement: useFrame 帧回调 Hook
引擎 MUST 提供 `useFrame` 自定义 Hook，允许组件注册帧回调函数。回调在每帧渲染前被调用。

#### Scenario: 使用 useFrame 注册帧回调
- **WHEN** 在组件内调用 `useFrame((delta, elapsed) => { /* 动画逻辑 */ })`
- **THEN** 传入的回调函数在每帧渲染前被调用，接收 delta time 和 elapsed time

#### Scenario: 组件卸载时自动注销帧回调
- **WHEN** 使用了 `useFrame` 的组件从 React 树中卸载
- **THEN** 其注册的帧回调自动被注销，不再在后续帧中被调用

### Requirement: useEngine 引擎访问 Hook
引擎 MUST 提供 `useEngine` 自定义 Hook，返回当前引擎实例。该 Hook MUST 在 `<Canvas>` 组件树内调用，否则抛出错误。

#### Scenario: 在 Canvas 内使用 useEngine
- **WHEN** 在 `<Canvas>` 子组件中调用 `useEngine()`
- **THEN** 返回引擎实例对象，包含 renderer、sceneManager、cameraManager 等属性

#### Scenario: 在 Canvas 外使用 useEngine
- **WHEN** 在 `<Canvas>` 外部调用 `useEngine()`
- **THEN** 抛出错误，提示必须在 Canvas 组件内使用
