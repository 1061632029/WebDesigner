## 1. 项目初始化与脚手架搭建

- [x] 1.1 使用 Vite 创建 React + TypeScript 项目脚手架（在 DimMain 目录下），配置 pnpm 作为包管理器
- [x] 1.2 安装核心依赖：three（r160+）、@types/three，配置 TypeScript 严格模式
- [x] 1.3 配置 Vite 构建工具（vite.config.ts），确保 WebGPU 相关模块可正常导入
- [x] 1.4 创建项目目录结构（src/core、src/scene、src/camera、src/geometry、src/material、src/lighting、src/react）

## 2. 引擎核心模块 (engine-core)

- [x] 2.1 实现 Engine 类：WebGPURenderer 初始化（异步 init）、canvas 挂载、设备像素比配置
- [x] 2.2 实现 WebGPU 可用性检测逻辑（检查 navigator.gpu），不可用时抛出明确错误
- [x] 2.3 实现 RenderLoop 类：基于 requestAnimationFrame 的渲染循环，支持 start/stop 控制
- [x] 2.4 实现帧回调注册/注销机制，回调接收 delta time 和 elapsed time 参数
- [x] 2.5 实现渲染尺寸自适应：使用 ResizeObserver 监听容器尺寸变化，自动更新渲染器和相机
- [x] 2.6 实现 Engine 的 dispose() 方法：释放 GPU 资源、停止渲染循环、清理 DOM

## 3. 场景管理模块 (scene-management)

- [x] 3.1 实现 SceneManager 类：创建和管理 Three.js Scene 实例
- [x] 3.2 实现场景节点的 add/remove 方法
- [x] 3.3 实现场景背景颜色设置（setBackground）
- [x] 3.4 实现 SceneManager 的 dispose() 方法：遍历销毁所有子节点

## 4. 相机系统模块 (camera-system)

- [x] 4.1 实现 CameraManager 类：支持创建 PerspectiveCamera（含默认参数 fov=75, near=0.1, far=1000）
- [x] 4.2 实现 OrthographicCamera 创建支持
- [x] 4.3 实现相机位置（setPosition）和观察目标（setLookAt）控制方法
- [x] 4.4 集成 OrbitControls 轨道控制器：封装 OrbitControlsWrapper，支持启用/禁用和参数配置
- [x] 4.5 实现相机宽高比自动更新（响应渲染器尺寸变化）

## 5. 几何体系统模块 (geometry-system)

- [x] 5.1 实现 GeometryFactory 类：createBox 方法（默认 1×1×1）
- [x] 5.2 实现 createSphere 方法（默认 radius=1）
- [x] 5.3 实现 createPlane 方法（默认 1×1）
- [x] 5.4 实现 createCylinder 方法
- [x] 5.5 实现 createTorus 方法

## 6. 材质系统模块 (material-system)

- [x] 6.1 实现 MaterialFactory 类：createStandard 方法，创建 MeshStandardNodeMaterial（默认 color=0xffffff, metalness=0.0, roughness=0.5）
- [x] 6.2 实现 createBasic 方法，创建 MeshBasicNodeMaterial
- [x] 6.3 实现 createPhysical 方法，创建 MeshPhysicalNodeMaterial（支持 clearcoat、transmission）
- [x] 6.4 实现材质透明度配置支持（transparent、opacity 属性）

## 7. 光照系统模块 (lighting-system)

- [x] 7.1 实现 LightFactory 类：createAmbientLight 方法（默认 color=0xffffff, intensity=0.5）
- [x] 7.2 实现 createDirectionalLight 方法（默认 intensity=1.0, position=(5,5,5)）
- [x] 7.3 实现 createPointLight 方法（默认 intensity=1.0, distance=0, decay=2）

## 8. React 绑定层 (react-bindings)

- [x] 8.1 实现 EngineContext：创建 React Context，定义引擎实例类型
- [x] 8.2 实现 useEngine Hook：从 Context 获取引擎实例，Canvas 外调用时抛出错误
- [x] 8.3 实现 useFrame Hook：注册帧回调，组件卸载时自动注销
- [x] 8.4 实现 Canvas 根组件：初始化引擎、启动渲染循环、通过 Context 提供引擎实例、卸载时清理资源
- [x] 8.5 实现 Mesh 组件：声明式创建网格，支持 geometry/material/position/rotation/scale 属性，响应属性变更，卸载时清理
- [x] 8.6 实现 AmbientLight、DirectionalLight、PointLight 光源组件：声明式创建光源，支持属性动态更新
- [x] 8.7 实现 PerspectiveCamera 组件：声明式配置相机，支持 enableOrbitControls 属性

## 9. 示例场景 (demo-scene)

- [x] 9.1 实现 App.tsx Demo 场景：使用 Canvas 组件构建包含多种几何体（立方体、球体、地面平面）的场景
- [x] 9.2 为场景中的物体配置不同材质（金属材质、粗糙材质等）
- [x] 9.3 添加环境光和平行光到 Demo 场景
- [x] 9.4 配置透视相机和 OrbitControls 交互
- [x] 9.5 使用 useFrame 实现至少一个物体的持续旋转动画
- [x] 9.6 实现 WebGPU 不可用时的友好提示 UI

## 10. 收尾与验证

- [x] 10.1 确保所有模块的文件拆分符合单一职责原则，每个类/接口独立文件
- [x] 10.2 验证完整 Demo 在支持 WebGPU 的浏览器中正常运行
- [x] 10.3 验证不支持 WebGPU 的浏览器中显示友好提示

---

## 第二阶段：Monorepo + 后端骨架 + UI 布局系统

### 11. Monorepo 架构搭建

- [x] 11.1 设置 pnpm workspace monorepo（DimMain/DimServer/DimShared 三个工作区）
- [x] 11.2 创建根级 package.json（统一脚本 dev:main/dev:server/build）
- [x] 11.3 创建 tsconfig.base.json 共享 TypeScript 严格模式基础配置

### 12. DimShared 共享类型包

- [x] 12.1 创建 api-types.ts（CAD 解析、布尔运算、参数化建模、模型转码的请求/响应类型）
- [x] 12.2 创建 task-types.ts（异步任务状态、进度推送、WebSocket 消息类型）
- [x] 12.3 创建 storage-types.ts（文件元数据、上传响应、火山引擎 TOS 存储提供者类型）
- [x] 12.4 创建 index.ts 统一导出

### 13. DimServer 后端骨架

- [x] 13.1 创建 Fastify + TypeScript 项目骨架（package.json/tsconfig.json）
- [x] 13.2 实现 ServerConfig（服务配置，含火山引擎 TOS 环境变量预留）
- [x] 13.3 实现 IStorageProvider 存储抽象接口（LocalFile/TOS/S3 统一 API）
- [x] 13.4 实现 CadRoutes（CAD 解析/布尔运算/导出 mock 路由）
- [x] 13.5 实现 ConvertRoutes（格式转换/Draco 压缩/LOD 生成 mock 路由）
- [x] 13.6 实现 ParametricRoutes（参数化生成/更新/批量计算 mock 路由）
- [x] 13.7 实现 TaskRoutes（任务查询/取消 mock 路由）
- [x] 13.8 实现 StorageRoutes（文件上传/列举/删除 mock 路由）
- [x] 13.9 实现 index.ts 服务入口（CORS + 路由注册 + 健康检查）

### 14. 前端面板系统

- [x] 14.1 创建 PanelTypes.ts（NavItem/LeftPanelConfig/ToolbarItem/PropertyGroup 等类型定义）
- [x] 14.2 实现 PanelManager 核心管理器（发布-订阅模式，注册/注销/状态管理）
- [x] 14.3 实现 PanelContext + usePanel/usePanelData Hook（useSyncExternalStore 并发安全）
- [x] 14.4 实现 LayoutStyles.ts（三维家风格布局样式常量）

### 15. 前端布局组件

- [x] 15.1 实现 SideNav 侧边导航栏组件（图标+文字，选中高亮）
- [x] 15.2 实现 TopToolbar 顶部工具栏组件
- [x] 15.3 实现 LeftPanel 左侧功能面板组件（分组卡片网格）
- [x] 15.4 实现 RightPropertyPanel 右侧属性面板组件（折叠分组 + 6 种控件：数值/滑块/开关/颜色/下拉/按钮）
- [x] 15.5 实现 AppShell 布局骨架（PanelManager 生命周期 + 五区域组合）

### 16. 集成与验证

- [x] 16.1 创建 useDemoSetup Hook（注册示例导航/面板/工具栏/属性数据）
- [x] 16.2 更新 App.tsx 集成 AppShell + Canvas + Demo 场景
- [x] 16.3 验证 Vite 开发服务器正常启动（http://localhost:5173）
