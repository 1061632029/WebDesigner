# Dim WebGPU Engine — 架构设计文档 V3

> 版本：0.3.0  
> 更新日期：2026-05-21  
> 项目名称：`dim-webgpu-engine`

---

## 1. 文档概述

本文档是 Dim WebGPU Engine 架构文档的第三版，在 V1（基础渲染引擎）和 V2（全栈平台架构）基础上，新增 **建筑对象系统** 和 **交互建模系统** 的架构设计，并系统性阐述技术选型理由和技术路线。

**V3 核心变更：**
- 新增可扩展的建筑对象数据模型（墙体/柱/门窗...）
- 新增交互式墙体绘制工具（直墙/弧形墙/矩形墙）
- 新增全局 ID 系统
- 新增射线投射交互层

---

## 2. 技术路线与选型理由

### 2.1 为什么选用 Three.js 而非原生 WebGPU API？

| 维度 | Three.js | 原生 WebGPU | Babylon.js |
|------|---------|------------|------------|
| **开发效率** | ⭐⭐⭐⭐⭐ 高度封装 | ⭐⭐ 极底层 | ⭐⭐⭐⭐ 高度封装 |
| **场景图系统** | ✅ 内置成熟 | ❌ 需自行实现 | ✅ 内置成熟 |
| **材质系统** | ✅ PBR + 节点材质 | ❌ 需自写 WGSL | ✅ PBR + 节点材质 |
| **社区生态** | ⭐⭐⭐⭐⭐ npm 周下载 500 万+ | ⭐ 极少 | ⭐⭐⭐ 活跃但小众 |
| **WebGPU 支持** | ✅ r160+ 一等公民 | ✅ 原生 | ✅ 早期支持 |
| **TypeScript** | ✅ @types/three 完善 | ✅ 浏览器内置类型 | ✅ 原生 TS |
| **React 集成** | R3F 生态 + 自定义方案 | 无 | 无成熟方案 |

**选择 Three.js 的决定性理由：**

1. **场景图 + 几何体 + 材质**一套完整的 3D 图形抽象层已经成熟稳定，无需重造轮子
2. **WebGPURenderer 由核心团队维护**，从 r160 起 `three/webgpu` 成为一等打包入口
3. **社区生态最大**，遇到问题时资料最多、解决方案最快
4. 项目定位是"建筑设计引擎"而非"图形渲染器"，应将精力聚焦在业务逻辑而非底层渲染

### 2.2 为什么选用 WebGPU 而非 WebGL？

**WebGPU 相对 WebGL 的核心优势：**

| 特性 | WebGL 2.0 | WebGPU |
|------|----------|--------|
| **CPU 开销** | 高（同步状态机模型） | 低（命令缓冲区批处理） |
| **Compute Shader** | ❌ 不支持 | ✅ 原生支持 |
| **多线程渲染** | ❌ 单线程 | ✅ 多线程命令编码 |
| **GPU 资源管理** | 隐式管理，黑盒 | 显式管理，可预测 |
| **Shader 语言** | GLSL（文本） | WGSL（结构化） |
| **标准化** | Khronos（已冻结） | W3C（活跃演进） |

**选择 WebGPU 的决定性理由：**

1. **面向未来**：WebGL 已进入维护模式，WebGPU 是 W3C 正在标准化的下一代 Web 图形 API
2. **Compute Shader**：建筑设计场景中的碰撞检测、网格简化、LOD 计算等未来可利用 GPU 并行计算
3. **性能**：建筑场景可能包含大量墙体/家具/配件等对象，WebGPU 的低 CPU 开销在大场景中优势明显
4. **Three.js 原生支持**：`WebGPURenderer` 已稳定可用，且自动回退到 WebGL，无兼容性风险

**浏览器支持现状（2026 年）：**
- Chrome 113+ ✅（2023.5 起稳定）
- Edge 113+ ✅
- Firefox 126+ ✅（2024 起默认启用）
- Safari 18+ ✅（macOS Sequoia 起默认启用）

### 2.3 为什么用 React 而非 Vue / Svelte / 原生 DOM？

| 维度 | React 18 | Vue 3 | Svelte 5 | 原生 DOM |
|------|---------|-------|---------|---------|
| **组件化** | ✅ 函数组件 + Hooks | ✅ Composition API | ✅ Runes | ❌ 手动管理 |
| **生态规模** | ⭐⭐⭐⭐⭐ 最大 | ⭐⭐⭐⭐ | ⭐⭐⭐ | N/A |
| **3D 生态** | R3F、Drei、Leva | TresJS（小） | Threlte（小） | 无 |
| **TypeScript** | ✅ @types/react 完善 | ✅ 内置支持 | ✅ 内置支持 | ✅ |
| **并发模式** | ✅ Concurrent | ❌ | ❌ | N/A |
| **团队熟悉度** | ⭐⭐⭐⭐⭐ | 视情况 | 视情况 | 视情况 |

**选择 React 的决定性理由：**

1. **3D 生态最完善**：React Three Fiber (R3F) 证明了 React + Three.js 的可行性，大量实践经验可参考
2. **函数组件 + Hooks 范式**非常适合 3D 对象的声明式生命周期管理（useEffect 创建/销毁、useFrame 帧更新）
3. **Context API** 天然适合传递引擎实例等全局状态
4. **社区规模最大**，UI 组件库（Ant Design、MUI）、状态管理（Zustand、Jotai）等周边生态丰富

### 2.4 为什么用 Context + Hooks 而非 React Three Fiber 的 Reconciler 方案？

**R3F Reconciler 方案：**
- 实现完整的 React Custom Reconciler，将 JSX 节点直接映射到 Three.js 对象树
- 优点：声明式体验最好，可直接 `<mesh><boxGeometry /><meshStandardMaterial /></mesh>`
- 缺点：实现复杂度极高（约 3000+ 行 reconciler 代码），维护成本高

**本项目的 Context + Hooks 方案：**
- 使用标准 React API（createContext、useEffect、useRef）桥接声明式和命令式
- 优点：架构简单、调试直观、引擎核心层完全不依赖 React
- 缺点：嵌套层级深时 useEffect 链可能复杂

**选择 Context + Hooks 的决定性理由：**

1. 项目是**建筑设计工具**而非通用 3D 框架，不需要支持任意嵌套的 JSX 3D 节点树
2. 建筑对象的管理由 `BuildingObjectManager` 统一处理，不需要 React 参与对象树的调度
3. 引擎核心层**完全独立于 React**，便于未来迁移到其他 UI 框架或非 UI 场景（如 Node.js 端渲染）
4. 降低技术风险，标准 React API 的行为可预测，不存在 reconciler 版本兼容问题

### 2.5 为什么用纯 BufferGeometry 生成墙体而非 OCCT B-Rep？

| 维度 | BufferGeometry（Three.js） | OCCT B-Rep（OpenCascade） |
|------|--------------------------|--------------------------|
| **适用场景** | 简单挤出体（墙/柱/梁） | 复杂曲面、精确建模 |
| **性能** | ⭐⭐⭐⭐⭐ 直接生成 GPU 可用数据 | ⭐⭐ 需 tessellate 转换 |
| **依赖体积** | 0（Three.js 自带） | ~40MB WASM 包 |
| **初始化时间** | 0ms | ~2s（WASM 加载） |
| **适合实时预览** | ✅ 毫秒级更新 | ❌ 转换开销大 |

**选择 BufferGeometry 的决定性理由：**

1. **墙体是简单挤出体**：直墙 = 中心线 + 法线偏移 + 高度拉伸 = 8 个顶点 12 个三角形，完全不需要 B-Rep
2. **实时预览需求**：拖拽画墙时每帧都要重建预览几何体，BufferGeometry 可在 < 1ms 内完成
3. **零额外依赖**：不需要加载 40MB 的 OCCT WASM
4. **复杂建模保留 OCCT 通道**：项目已集成 OCCT（`cad/` 目录），未来布尔运算、倒角等可通过后端 API 调用

### 2.6 为什么用 bulge 因子表示弧形墙？

**备选方案对比：**

| 方案 | 参数 | 优点 | 缺点 |
|------|------|------|------|
| **圆心 + 半径 + 起止角** | cx, cz, r, θ_start, θ_end | 几何含义明确 | 6 个参数，冗余 |
| **三点定弧** | p1, p2, p3 | 直观 | 存储 3 个点 = 6 数值 |
| **bulge 因子** | start, end, bulge | DXF/DWG 行业标准，仅 1 个额外参数 | 需理解 bulge = tan(θ/4) |

**选择 bulge 的理由：**

1. **DXF/DWG 行业标准**：与 AutoCAD 数据格式一致，导入导出零转换
2. **最少参数**：在 start + end 基础上只多 1 个数值（bulge），序列化最紧凑
3. **退化性好**：bulge = 0 时精确等于直线，无需特殊判断
4. **对称性好**：正值左凸、负值右凸，符合直觉

### 2.7 为什么采用数据/渲染分离的双 Map 管理？

```
BuildingObjectManager
├── _objects: Map<string, BuildingObject>   ← 纯数据（可序列化）
└── _meshes:  Map<string, THREE.Mesh>       ← 渲染实例（GPU 资源）
```

**选择分离架构的理由：**

1. **序列化友好**：纯数据层可直接 `JSON.stringify()` → 保存/撤销/重做/网络传输
2. **渲染无关测试**：可在无 WebGPU 环境下测试数据逻辑
3. **按需重建**：修改属性时只需更新数据 + 重建 Mesh，不需要维护双向绑定
4. **查询高效**：按 ID 查数据 O(1)、按类别过滤用 forEach，无需遍历场景图

---

## 3. 更新后的分层架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                    应用层 (App / Demo)                                │
│  App.tsx  ·  WallDrawScene.tsx  ·  DrawToolHud                      │
│  组合使用下层模块构建建筑设计场景                                       │
├─────────────────────────────────────────────────────────────────────┤
│              建筑对象层 (building/) ← 🆕 V3 新增                      │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ BuildingTypes│  │ BuildingObject   │  │ WallDrawTool         │  │
│  │ (数据模型)    │  │ Manager          │  │ (绘制工具状态机)      │  │
│  │ Wall/Column  │  │ (增删改查/序列化) │  │ 直墙/弧形墙/矩形墙   │  │
│  ├──────────────┤  ├──────────────────┤  ├──────────────────────┤  │
│  │ IdGenerator  │  │ WallGeometry     │  │ IGeometryBuilder     │  │
│  │ (全局 ID)    │  │ Builder          │  │ (几何构建器接口)      │  │
│  └──────────────┘  └──────────────────┘  └──────────────────────┘  │
│  职责：建筑对象的数据模型、几何生成、交互绘制                           │
├─────────────────────────────────────────────────────────────────────┤
│              交互层 (interaction/) ← 🆕 V3 新增                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  RaycastHelper                                               │  │
│  │  屏幕坐标 → NDC → 射线 → 地平面交点 → Point2D                │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  职责：将用户的屏幕操作转换为三维空间中的交互事件                       │
├─────────────────────────────────────────────────────────────────────┤
│              React 绑定层 (react/)                                    │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────────────────────┐  │
│  │  Components   │  │   Hooks     │  │    Context                │  │
│  │  Canvas       │  │  useEngine  │  │  EngineContext            │  │
│  │  Mesh         │  │  useFrame   │  │  PanelContext             │  │
│  │  Light (x3)   │  │  useDrawTool│  │                           │  │
│  │  Camera       │  │  usePanel   │  │                           │  │
│  │  Layout (x5)  │  │             │  │                           │  │
│  └──────────────┘  └─────────────┘  └───────────────────────────┘  │
│  职责：声明式 API ↔ 命令式引擎 API 的桥接层                           │
├─────────────────────────────────────────────────────────────────────┤
│              功能模块层 (scene/camera/geometry/material/lighting)      │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────────────────────────┐ │
│  │ Scene    │ │ Camera       │ │ Factories                       │ │
│  │ Manager  │ │ Manager      │ │ GeometryFactory                 │ │
│  │          │ │ OrbitControls│ │ MaterialFactory                 │ │
│  │          │ │ Wrapper      │ │ LightFactory                    │ │
│  └──────────┘ └──────────────┘ └─────────────────────────────────┘ │
│  职责：封装 Three.js API，提供引擎级的功能抽象                         │
├─────────────────────────────────────────────────────────────────────┤
│              引擎核心层 (core/)                                       │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐    │
│  │ Engine               │  │ RenderLoop                       │    │
│  │ · WebGPURenderer 管理│  │ · requestAnimationFrame 驱动     │    │
│  │ · 生命周期控制        │  │ · 帧回调注册/执行                 │    │
│  │ · 尺寸自适应          │  │ · 启动/停止控制                  │    │
│  └──────────────────────┘  └──────────────────────────────────┘    │
│  职责：渲染器管理 + 渲染循环驱动                                      │
├─────────────────────────────────────────────────────────────────────┤
│              Three.js r170 + WebGPU Backend                          │
│              (three/webgpu → WebGPURenderer → GPU)                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. 建筑对象系统详解

### 4.1 数据模型层次

```
BuildingObjectBase (公共基类)
│  id: string           ← 全局唯一 ID（IdGenerator 生成）
│  category: BuildingCategory   ← 对象类别 ('wall' | 'column' | ...)
│  name: string         ← 用户可见名称
│  visible: boolean     ← 可见性
│  locked: boolean      ← 锁定状态
│  height: number       ← 高度
│  elevation: number    ← 底部标高
│
├── WallData (墙体联合类型)
│   ├── StraightWallData    ← 直墙：start + end + thickness
│   ├── ArcWallData         ← 弧形墙：start + end + bulge + segments + thickness
│   └── RectWallData        ← 矩形墙：corner1 + corner2 + childWallIds[4]
│
├── ColumnData (柱子) ← 扩展预留
│   shape + center + width + depth + rotation
│
└── ... (DoorData, WindowData, SlabData 等未来扩展)
```

**扩展新对象类别只需三步：**
1. 定义 `XxxData extends BuildingObjectBase`
2. 实现 `XxxGeometryBuilder`
3. 在 `BuildingObjectManager` 中注册构建器

### 4.2 全局 ID 系统

```
格式：{时间戳前缀(36进制)}-{类别}-{自增序号}
示例：m1a2b3c-wall-1, m1a2b3c-wall-2, m1a2b3c-column-3

特性：
- 应用生命周期内全局唯一
- 包含类别信息，便于调试
- 存入 THREE.Mesh.userData.buildingObjectId，射线拾取时可反查
```

### 4.3 BuildingObjectManager 核心架构

```
BuildingObjectManager
│
├── 数据层
│   └── _objects: Map<string, BuildingObject>
│       · addObject() / removeObject() / updateObject()
│       · getById() / getByCategory() / getAll()
│       · serialize() / deserialize()
│
├── 渲染层
│   └── _meshes: Map<string, THREE.Mesh>
│       · _createWallMesh() → geometry + material → scene.add()
│       · _removeMeshFromScene() → scene.remove() + geometry.dispose()
│
├── 事件层
│   └── _listeners: Set<ChangeCallback>
│       · onChange() → 订阅增删改事件
│       · _notify() → 通知所有监听器
│
└── 便捷方法
    · createStraightWall(start, end, thickness?, height?)
    · createRectWall(corner1, corner2, thickness?, height?)
```

### 4.4 WallDrawTool 状态机

```
模式 (DrawToolMode):
  'none' | 'straight-wall' | 'arc-wall' | 'rect-wall'

状态 (DrawToolState):
  'idle' | 'picking-start' | 'picking-end' | 'picking-bulge' | 'preview'

直墙绘制流程:
  activate('straight-wall')
    → picking-start
      → [click] → picking-end + 显示起点标记
        → [mousemove] → 实时预览半透明墙体
          → [click] → 创建墙体 → (连续模式: 终点→新起点, 继续 picking-end)
            → [Esc/右键] → picking-start (取消当前段)

矩形墙绘制流程:
  activate('rect-wall')
    → picking-start
      → [click] → picking-end
        → [mousemove] → 预览矩形四面墙
          → [click] → 创建四面直墙 → picking-start

弧形墙绘制流程:
  activate('arc-wall')
    → picking-start
      → [click] → picking-end
        → [click] → picking-bulge
          → [click] → 创建弧形墙 → picking-start
```

### 4.5 墙体几何生成算法

**直墙（StraightWall）：**
```
输入: start(P2D), end(P2D), thickness, height, elevation
算法:
  1. dir = normalize(end - start)           // 中心线方向
  2. normal = perpendicular(dir)             // XZ 平面法线
  3. 底面 4 角 = start/end ± normal × thickness/2
  4. 顶面 4 角 = 底面 + Y × height
  5. 6 面 × 4 顶点 = 24 非共享顶点（独立法线）
  6. 12 个三角形 → BufferGeometry
输出: BufferGeometry（约 24 顶点，36 索引）
```

**弧形墙（ArcWall）：**
```
输入: start(P2D), end(P2D), bulge, segments, thickness, height
算法:
  1. bulge → 圆心(cx,cz) + 半径(r) + 起止角
  2. 等分 segments 段 → N+1 个中心线采样点
  3. 每个点计算法线偏移 → 内外两条弧线
  4. 逐段生成: 外侧面 + 内侧面 + 顶面 + 底面
  5. 起点端面 + 终点端面
输出: BufferGeometry（约 (segments×16 + 8) 顶点）
```

---

## 5. 交互系统

### 5.1 射线投射流程

```
用户点击屏幕 (clientX, clientY)
  │
  ▼
RaycastHelper.screenToGround()
  ├─ 1. 屏幕坐标 → NDC 坐标 ([-1,1] 范围)
  │     ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
  │     ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
  │
  ├─ 2. NDC → 射线 (Raycaster.setFromCamera)
  │
  ├─ 3. 射线与地平面 (Y=0) 求交 (ray.intersectPlane)
  │
  └─ 4. 交点 → Point2D { x, z }
```

---

## 6. 更新后的目录结构

```
DimMain/src/
├── core/                           # 🔵 引擎核心层
│   ├── Engine.ts                   #   引擎主类
│   └── RenderLoop.ts              #   渲染循环
│
├── scene/                          # 🟢 场景管理
│   └── SceneManager.ts
│
├── camera/                         # 🟡 相机系统
│   ├── CameraManager.ts
│   └── OrbitControlsWrapper.ts
│
├── geometry/                       # 🟠 几何体工厂
│   └── GeometryFactory.ts
│
├── material/                       # 🔴 材质工厂
│   └── MaterialFactory.ts
│
├── lighting/                       # 🟣 光照工厂
│   └── LightFactory.ts
│
├── building/                       # 🏗️ 建筑对象系统 ← V3 新增
│   ├── BuildingTypes.ts           #   数据模型（Base + Wall + Column + ...）
│   ├── IdGenerator.ts             #   全局 ID 生成器
│   ├── WallGeometryBuilder.ts     #   墙体几何构建器
│   ├── BuildingObjectManager.ts   #   建筑对象管理器
│   └── WallDrawTool.ts            #   墙体绘制工具（状态机）
│
├── interaction/                    # 🖱️ 交互系统 ← V3 新增
│   └── RaycastHelper.ts          #   射线投射辅助器
│
├── panel/                          # 📋 面板系统
│   ├── PanelTypes.ts
│   └── PanelManager.ts
│
├── cad/                            # ⚙️ CAD 集成
│   ├── OcctTypes.ts
│   ├── OcctWasmLoader.ts
│   ├── OcctShapeBuilder.ts
│   ├── OcctBooleanOps.ts
│   └── OcctMeshConverter.ts
│
├── react/                          # ⚛️ React 绑定层
│   ├── context/
│   │   ├── EngineContext.tsx
│   │   └── PanelContext.tsx
│   ├── hooks/
│   │   ├── useEngine.ts
│   │   ├── useFrame.ts
│   │   ├── useDrawTool.ts         # ← V3 新增
│   │   ├── usePanel.ts
│   │   └── useOcct.ts
│   └── components/
│       ├── Canvas.tsx
│       ├── Mesh.tsx
│       ├── Light.tsx
│       ├── Camera.tsx
│       ├── CadMesh.tsx
│       └── layout/
│           ├── AppShell.tsx
│           ├── SideNav.tsx
│           ├── TopToolbar.tsx
│           ├── LeftPanel.tsx
│           └── RightPropertyPanel.tsx
│
├── demo/                           # 📦 示例
│   ├── RotatingBox.tsx            #   旋转立方体 Demo
│   ├── WallDrawScene.tsx          #   墙体绘制 Demo ← V3 新增
│   └── useDemoSetup.ts
│
├── types/                          # 📝 类型声明
│   └── three-webgpu.d.ts
│
├── App.tsx                         # 应用根组件
└── main.tsx                        # 入口
```

---

## 7. 模块依赖关系图（V3 更新）

```
                         ┌──────────┐
                         │  App.tsx │
                         └─────┬────┘
                               │ uses
                ┌──────────────┼──────────────────┐
                ▼              ▼                  ▼
          ┌──────────┐  ┌──────────────┐  ┌───────────────┐
          │  Canvas  │  │ WallDraw     │  │  DemoSetup    │
          │          │  │ Scene        │  │               │
          └────┬─────┘  └──────┬───────┘  └───────────────┘
               │               │
               │          ┌────┴────────┐
               │          │ DrawToolHud │
               │          └────┬────────┘
               │               │
               │          ┌────┴────────┐
               │          │ useDrawTool │
               │          └────┬────────┘
               │               │
               │    ┌──────────┴──────────┐
               │    ▼                     ▼
               │  ┌────────────────┐  ┌──────────────────┐
               │  │ BuildingObject │  │ WallDrawTool     │
               │  │ Manager        │  │ (状态机)          │
               │  └───────┬────────┘  └──────┬───────────┘
               │          │                  │
               │          │           ┌──────┴──────┐
               │          │           ▼             ▼
               │          │    ┌────────────┐ ┌──────────────┐
               │          │    │ WallGeom   │ │ RaycastHelper│
               │          │    │ Builder    │ └──────────────┘
               │          │    └────────────┘
               │          │
               ▼          ▼
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
      └───────────┘ └──────┘ └──────┘ └───────────┘
```

---

## 8. 技术栈版本汇总（V3 更新）

| 技术 | 版本 | 类别 | 角色 |
|------|------|------|------|
| Three.js | 0.170.0 (r170) | 运行时依赖 | 3D 图形基础设施 |
| WebGPU | 浏览器原生 | 运行时环境 | GPU 渲染后端 |
| React | 18.3.1 | 运行时依赖 | 声明式 UI + 场景描述 |
| React DOM | 18.3.1 | 运行时依赖 | DOM 渲染桥接 |
| TypeScript | ~5.6.2 | 开发依赖 | 类型安全（严格模式 + noUncheckedIndexedAccess） |
| Vite | ^6.0.0 | 开发依赖 | ESM 构建工具 |
| @vitejs/plugin-react | ^4.3.4 | 开发依赖 | React JSX 编译 |
| @types/three | ^0.170.0 | 开发依赖 | Three.js 类型声明 |
| @types/react | ^18.3.12 | 开发依赖 | React 类型声明 |
| pnpm | 10.32+ | 工具链 | Monorepo 包管理 |
| Fastify | 5.x | 后端运行时 | HTTP 服务框架 |
| BullMQ | 5.x | 后端运行时 | 异步任务队列 |
| OpenCascade | 7.7+ WASM | 计算层 | CAD 内核 |

---

## 9. 关键设计决策汇总

| # | 决策 | 选择 | 核心理由 |
|---|------|------|---------|
| 1 | 渲染库 | Three.js（非原生 WebGPU） | 成熟场景图 + 最大社区生态 |
| 2 | GPU 后端 | WebGPU（非 WebGL） | 面向未来 + Compute Shader + 低 CPU 开销 |
| 3 | UI 框架 | React（非 Vue/Svelte） | 3D 生态最完善 + Hooks 范式适合 3D 生命周期 |
| 4 | React 集成 | Context + Hooks（非 Reconciler） | 架构简单 + 引擎独立 + 低风险 |
| 5 | 墙体几何 | BufferGeometry（非 OCCT） | 简单挤出体无需 B-Rep + 实时预览需求 |
| 6 | 弧形墙表示 | bulge 因子（DXF 标准） | 行业标准 + 最少参数 + 退化性好 |
| 7 | 对象管理 | 数据/渲染分离双 Map | 序列化友好 + 渲染无关测试 |
| 8 | 坐标系 | XZ 平面绘制 + Y 朝上 | 建筑行业标准 + Three.js 默认 |
| 9 | 单位 | 米制（1 单位 = 1 米） | 简化计算，UI 显示转 mm |
| 10 | 对象 ID | 全局唯一 + 包含类别 | 调试友好 + 射线拾取反查 |

---

## 10. 未来演进路线

### 近期（V3.1）
- [ ] 弧形墙完整创建方法（当前暂用直墙近似）
- [ ] 撤销/重做系统（基于 BuildingObject 序列化快照）
- [ ] 对象选择和属性编辑（右侧面板联动）
- [ ] 网格吸附（Grid Snap）

### 中期（V4）
- [ ] 柱子（ColumnData + ColumnGeometryBuilder）
- [ ] 门窗洞口（在墙体上开洞）
- [ ] 楼板/天花板
- [ ] 2D 平面图视图（正交相机俯视）

### 长期（V5+）
- [ ] OCCT 布尔运算集成（墙体交叉处理）
- [ ] 参数化约束系统
- [ ] STEP/DXF 导入导出
- [ ] GPU Compute Shader 加速碰撞检测

---

*文档结束*
