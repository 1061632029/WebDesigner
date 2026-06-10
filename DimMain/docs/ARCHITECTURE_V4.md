# Dim WebGPU Engine — 架构设计文档 V4

> 版本：0.4.0  
> 更新日期：2026-05-22  
> 项目名称：`dim-webgpu-engine`

---

## 1. 文档概述

本文档是 Dim WebGPU Engine 架构文档的第四版，在 V3（建筑对象系统 + 交互建模）基础上，新增 **墙体连接拓扑系统**、**交汇处几何裁切（Miter）**、**纹理/材质系统** 和 **拖拽贴图** 的架构设计。

**V4 核心变更：**
- 新增墙体连接管理器（WallConnectionManager）：端点吸附、拓扑图、Miter 计算
- 新增交汇处几何裁切（Miter）：两墙 L 形交汇时自动斜切对齐
- 新增纹理服务（TextureService）和纹理预设（TexturePresets）
- 新增材质面板（MaterialPanel）和拖拽贴图上下文（TextureDragContext）
- 新增天空盒（Skybox）和网格辅助器（GridHelper）组件
- 建筑对象数据模型扩展（MaterialProperties、WallJoint、SnapResult、MiterParams）

---

## 2. V4 新增技术选型理由

### 2.1 为什么用 Joint 图而非邻接表管理墙体连接？

| 方案 | 数据结构 | 优点 | 缺点 |
|------|---------|------|------|
| **邻接表** | wallId → [connectedWallIds] | 简单 | 无法区分起点/终点连接 |
| **Joint 图** | Joint(position, connections[]) + wallToJoints 映射 | 精确的端点级连接 + 支持多墙交汇 | 稍复杂 |
| **空间索引（R-Tree）** | 端点坐标索引 | 范围查询快 | 维护成本高，小规模无优势 |

**选择 Joint 图的理由：**

1. **端点级精度**：每面墙有起点和终点，需要精确知道"哪个端点连接到哪个节点"
2. **多墙交汇**：一个 Joint 可连接 2+ 面墙，天然支持 T 形、十字形交叉
3. **Miter 计算需要**：计算交汇角度时需要知道每面墙在 Joint 处的方向向量
4. **序列化友好**：Joint 图可直接 JSON 序列化，支持保存/加载

### 2.2 为什么用 Miter Offset 而非 CSG 布尔运算处理墙体交汇？

| 方案 | 算法 | 性能 | 效果 |
|------|------|------|------|
| **CSG 布尔运算** | 两墙 Mesh 做 union/intersection | ⭐⭐ 慢（需网格重新三角化） | ⭐⭐⭐⭐⭐ 精确 |
| **Miter Offset** | 端点沿方向偏移 | ⭐⭐⭐⭐⭐ 快（纯数学计算） | ⭐⭐⭐⭐ 良好（两墙交汇） |
| **不处理** | 墙体端面重叠 | ⭐⭐⭐⭐⭐ 零开销 | ⭐ 视觉差 |

**选择 Miter Offset 的理由：**

1. **实时性**：画墙时每帧都可能触发相邻墙重建，Miter Offset 只需 `O(1)` 三角函数计算
2. **渐进式**：当前只处理两墙交汇（2 连接节点），三墙以上交汇（T 形）暂不 miter，留给后续 CSG
3. **零依赖**：不需要引入额外的 CSG 库
4. **可预测**：offset = thickness/2 / tan(θ/2)，公式确定性强，不存在网格精度问题

### 2.3 为什么用面级独立材质而非单材质 + UV 分区？

| 方案 | 实现 | 优点 | 缺点 |
|------|------|------|------|
| **面级独立材质** | materials[] 数组 + geometry.addGroup | 每面可独立换纹理/颜色 | 材质对象多 |
| **单材质 + UV 分区** | 一个材质 + 纹理 atlas | 材质对象少 | UV 管理复杂，换面纹理需重建 UV |

**选择面级独立材质的理由：**

1. **拖拽贴图需求**：用户可拖拽纹理到墙体的某一面（前/后/顶），每面需独立材质
2. **Three.js 原生支持**：`Mesh(geometry, materials[])` + `geometry.addGroup()` 是标准 API
3. **运行时灵活**：换面纹理只需替换 `materials[faceIndex]`，不需要重建几何体

---

## 3. 墙体连接拓扑系统

### 3.1 数据模型

```
WallJoint (连接节点)
│  id: string           ← 全局唯一 ID
│  position: Point2D    ← 节点在世界坐标中的位置
│  connections: WallConnection[]  ← 连接到此节点的墙体端点列表
│
WallConnection (连接记录)
│  wallId: string       ← 墙体 ID
│  endpoint: 'start' | 'end'  ← 该墙体连接的端点
│
MiterParams (斜切偏移)
│  startOffset: number  ← 起点沿方向的偏移量
│  endOffset: number    ← 终点沿方向的偏移量
│
SnapResult (吸附结果)
│  snapped: boolean     ← 是否吸附
│  position: Point2D    ← 吸附后坐标
│  jointId: string|null ← 吸附到的节点 ID
```

### 3.2 WallConnectionManager 核心架构

```
WallConnectionManager
│
├── 数据层
│   ├── _joints: Map<string, WallJoint>          ← 所有节点
│   └── _wallToJoints: Map<string, {start, end}> ← 墙体→节点映射
│
├── 吸附检测
│   └── snap(point, threshold) → SnapResult
│       · 遍历所有节点，找阈值内最近的
│       · 复杂度 O(N)，N = 节点数（足够小场景）
│
├── 连接操作
│   ├── registerWall(wallId, startPos, endPos)
│   │   · 对每个端点执行 snap → 吸附到已有节点或创建新节点
│   ├── disconnectWall(wallId)
│   │   · 从节点移除连接 → 空节点自动清理
│   └── connectWallEndpoint(wallId, endpoint, jointId, position)
│
├── Miter 计算
│   ├── computeMiterForWall(wallId, start, end, thickness, callback)
│   │   · 查询起点/终点节点 → 计算每端 miter offset
│   └── _computeEndpointMiter(jointId, wallId, ...)
│       · 只处理 2 连接节点
│       · 计算两墙方向夹角 θ
│       · offset = thickness/2 / tan(θ/2)
│       · 最大限制为墙长 30%
│
└── 查询
    ├── getJointConnections(jointId) → WallConnection[]
    ├── getWallJoints(wallId) → {start, end}
    └── getAllJoints() → WallJoint[]
```

### 3.3 端点吸附流程

```
用户移动鼠标
  │
  ▼
WallDrawTool._handleMouseMove()
  │
  ├─ screenToGround() → rawPoint
  │
  ├─ _applySnap(rawPoint)
  │   ├─ connectionManager.snap(rawPoint, SNAP_THRESHOLD=0.15m)
  │   │   ├─ 遍历所有 Joint
  │   │   └─ 找到阈值内最近的 → SnapResult
  │   │
  │   ├─ if snapped → _showSnapMarker(绿色 Torus 环)
  │   └─ else       → _clearSnapMarker()
  │
  └─ 返回吸附后的 point

用户点击
  │
  ├─ _applySnap(rawPoint) → point（使用吸附坐标）
  │
  └─ _handleStraightWallClick(point)
      └─ objectManager.createStraightWall(start, end)
          └─ addObject() → registerWall() → 重建自身 + 相邻墙体
```

### 3.4 Miter 裁切算法

```
两墙 L 形交汇（90° 示例）:

  墙体A (水平)      墙体B (垂直)
  ═══════╗           ║
         ║           ║
         ║           ║

计算步骤:
  1. Joint 有 2 个连接: A.end + B.start
  2. A 从 Joint 出发方向: dirA = normalize(A.start - Joint)
  3. B 从 Joint 出发方向: dirB = normalize(B.end - Joint)
  4. 夹角 θ = acos(dot(dirA, dirB)) = 90°
  5. offset = thickness/2 / tan(θ/2) = thickness/2 / tan(45°) = thickness/2
  6. A.endOffset = thickness/2（A 终点向外延伸半个厚度）
  7. B.startOffset = thickness/2（B 起点向外延伸半个厚度）

效果: 两墙端面在 45° 斜切线处对齐，无缝隙无重叠

  墙体A (水平)      墙体B (垂直)
  ═══════╲           ║
          ╲          ║
           ║         ║
```

---

## 4. 纹理与材质系统

### 4.1 TextureService

```
TextureService (单例)
│
├── 纹理缓存
│   └── _cache: Map<string, THREE.Texture>
│       · 相同 URL 只加载一次
│
├── 加载方法
│   └── load(url) → Promise<THREE.Texture>
│       · THREE.TextureLoader 异步加载
│       · 加载完成后缓存
│
└── 清理
    └── dispose() → 释放所有缓存纹理
```

### 4.2 TexturePresets

```
预定义纹理分类:
  wall-white    → 白色墙面
  wall-brick    → 红砖墙
  wall-concrete → 混凝土
  floor-wood    → 木地板
  floor-tile    → 瓷砖
  ...

每个预设包含:
  id: string
  name: string
  category: string
  thumbnailUrl: string
  textureUrl: string
  repeat: { x, y }
```

### 4.3 拖拽贴图流程

```
MaterialPanel (左侧面板)
  │  显示纹理预设缩略图
  │
  ├─ 用户开始拖拽 → TextureDragContext.startDrag(preset)
  │
  ├─ 用户拖拽到 3D 视口 → Canvas onDrop
  │   ├─ Raycaster 检测命中的 Mesh
  │   ├─ 通过 mesh.userData.buildingObjectId 反查 BuildingObject
  │   ├─ 通过 face index → material group index 确定命中的面
  │   └─ TextureService.load(url) → 替换该面的材质纹理
  │
  └─ 拖拽结束 → TextureDragContext.endDrag()
```

---

## 5. 更新后的分层架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                    应用层 (App / Demo)                                │
│  App.tsx  ·  WallDrawScene.tsx  ·  DrawToolHud                      │
│  组合使用下层模块构建建筑设计场景                                       │
├─────────────────────────────────────────────────────────────────────┤
│              建筑对象层 (building/) ← V3 + V4 增强                    │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ BuildingTypes│  │ BuildingObject   │  │ WallDrawTool         │  │
│  │ (数据模型)    │  │ Manager          │  │ (绘制工具状态机)      │  │
│  │ Wall/Column  │  │ (增删改查/序列化) │  │ 直墙/弧形墙/矩形墙   │  │
│  │ Joint/Miter  │  │ (Miter 重建触发) │  │ 端点吸附 + 绿色标记  │  │
│  ├──────────────┤  ├──────────────────┤  ├──────────────────────┤  │
│  │ IdGenerator  │  │ WallGeometry     │  │ WallConnection       │  │
│  │ (全局 ID)    │  │ Builder          │  │ Manager              │  │
│  │              │  │ (Miter 支持)     │  │ (拓扑图 + 吸附 +    │  │
│  │              │  │                  │  │  Miter 计算)         │  │
│  └──────────────┘  └──────────────────┘  └──────────────────────┘  │
│  职责：建筑对象的数据模型、几何生成、连接拓扑、交互绘制                  │
├─────────────────────────────────────────────────────────────────────┤
│              纹理/材质层 (material/) ← V4 新增                        │
│  ┌──────────────────┐  ┌────────────────┐  ┌──────────────────┐    │
│  │ MaterialFactory  │  │ TextureService │  │ TexturePresets   │    │
│  │ (Standard/Basic/ │  │ (加载+缓存)     │  │ (预设纹理库)      │    │
│  │  Physical)       │  │                │  │                  │    │
│  └──────────────────┘  └────────────────┘  └──────────────────┘    │
│  职责：材质创建、纹理加载缓存、预设纹理管理                              │
├─────────────────────────────────────────────────────────────────────┤
│              交互层 (interaction/)                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  RaycastHelper                                               │  │
│  │  屏幕坐标 → NDC → 射线 → 地平面交点 → Point2D                │  │
│  │  + 对象拾取（mesh 命中检测 + face index 确定）                │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  职责：将用户的屏幕操作转换为三维空间中的交互事件                       │
├─────────────────────────────────────────────────────────────────────┤
│              React 绑定层 (react/)                                    │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────────────────────┐  │
│  │  Components   │  │   Hooks     │  │    Context                │  │
│  │  Canvas       │  │  useEngine  │  │  EngineContext            │  │
│  │  Mesh         │  │  useFrame   │  │  PanelContext             │  │
│  │  Light (x3)   │  │  useDrawTool│  │  DrawToolContext          │  │
│  │  Camera       │  │  usePanel   │  │  TextureDragContext ← V4  │  │
│  │  GridHelper   │  │  useOcct    │  │                           │  │
│  │  Skybox       │  │             │  │                           │  │
│  │  CadMesh      │  │             │  │                           │  │
│  │  Layout (x7)  │  │             │  │                           │  │
│  └──────────────┘  └─────────────┘  └───────────────────────────┘  │
│  职责：声明式 API ↔ 命令式引擎 API 的桥接层                           │
├─────────────────────────────────────────────────────────────────────┤
│              功能模块层 (scene/camera/geometry/lighting)               │
│  ┌──────────┐ ┌──────────────┐ ┌─────────────────────────────────┐ │
│  │ Scene    │ │ Camera       │ │ Factories                       │ │
│  │ Manager  │ │ Manager      │ │ GeometryFactory                 │ │
│  │          │ │ OrbitControls│ │ LightFactory                    │ │
│  │          │ │ Wrapper      │ │                                 │ │
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
├── material/                       # 🔴 材质与纹理系统 ← V4 增强
│   ├── MaterialFactory.ts         #   材质工厂（Standard/Basic/Physical）
│   ├── TextureService.ts          #   纹理加载器+缓存 ← V4 新增
│   └── TexturePresets.ts          #   预设纹理库 ← V4 新增
│
├── lighting/                       # 🟣 光照工厂
│   └── LightFactory.ts
│
├── building/                       # 🏗️ 建筑对象系统 ← V4 增强
│   ├── BuildingTypes.ts           #   数据模型（+Joint/Snap/Miter 类型）
│   ├── IdGenerator.ts             #   全局 ID 生成器
│   ├── WallGeometryBuilder.ts     #   墙体几何构建器（+Miter 偏移支持）
│   ├── WallConnectionManager.ts   #   墙体连接管理器 ← V4 新增
│   ├── BuildingObjectManager.ts   #   建筑对象管理器（+连接集成+Miter 重建）
│   └── WallDrawTool.ts            #   墙体绘制工具（+端点吸附+绿色标记）
│
├── interaction/                    # 🖱️ 交互系统
│   └── RaycastHelper.ts          #   射线投射辅助器
│
├── panel/                          # 📋 面板系统
│   ├── PanelTypes.ts
│   └── PanelManager.ts
│
├── cad/                            # ⚙️ CAD 集成
│   ├── OcctWasmLoader.ts
│   ├── OcctShapeBuilder.ts
│   ├── OcctBooleanOps.ts
│   └── OcctMeshConverter.ts
│
├── react/                          # ⚛️ React 绑定层
│   ├── context/
│   │   ├── EngineContext.tsx
│   │   ├── PanelContext.tsx
│   │   ├── DrawToolContext.tsx
│   │   └── TextureDragContext.tsx  # ← V4 新增
│   ├── hooks/
│   │   ├── useEngine.ts
│   │   ├── useFrame.ts
│   │   ├── useDrawTool.ts
│   │   ├── usePanel.ts
│   │   └── useOcct.ts
│   └── components/
│       ├── Canvas.tsx
│       ├── Mesh.tsx
│       ├── Light.tsx
│       ├── Camera.tsx
│       ├── CadMesh.tsx
│       ├── GridHelper.tsx         # ← V4 新增
│       ├── Skybox.tsx             # ← V4 新增
│       └── layout/
│           ├── AppShell.tsx
│           ├── LayoutStyles.ts
│           ├── SideNav.tsx
│           ├── TopToolbar.tsx
│           ├── LeftPanel.tsx
│           ├── RightPropertyPanel.tsx
│           └── MaterialPanel.tsx   # ← V4 新增
│
├── demo/                           # 📦 示例
│   ├── RotatingBox.tsx
│   ├── WallDrawScene.tsx
│   └── useDemoSetup.ts
│
├── types/                          # 📝 类型声明
│   └── three-webgpu.d.ts
│
├── App.tsx                         # 应用根组件
└── main.tsx                        # 入口
```

---

## 7. 模块依赖关系图（V4 更新）

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
               │  │ Manager        │  │ (状态机 + 吸附)   │
               │  └───────┬────────┘  └──────┬───────────┘
               │          │                  │
               │    ┌─────┴─────┐     ┌──────┴──────┐
               │    ▼           ▼     ▼             ▼
               │ ┌────────┐ ┌──────────────┐ ┌──────────────┐
               │ │WallGeom│ │WallConnection│ │ RaycastHelper│
               │ │Builder │ │Manager       │ └──────────────┘
               │ │(+Miter)│ │(拓扑+吸附    │
               │ └────────┘ │ +Miter 计算) │
               │            └──────────────┘
               │
               │  ┌────────────────┐
               │  │ TextureService │ ← 纹理加载
               │  │ TexturePresets │ ← 预设库
               │  │ MaterialPanel  │ ← 拖拽面板
               │  │ TextureDrag    │
               │  │ Context        │ ← 拖拽状态
               │  └────────────────┘
               │
               ▼
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

## 8. 关键设计决策汇总（V4 更新）

| # | 决策 | 选择 | 核心理由 |
|---|------|------|---------|
| 1 | 渲染库 | Three.js（非原生 WebGPU） | 成熟场景图 + 最大社区生态 |
| 2 | GPU 后端 | WebGPU（非 WebGL） | 面向未来 + Compute Shader + 低 CPU 开销 |
| 3 | UI 框架 | React（非 Vue/Svelte） | 3D 生态最完善 + Hooks 范式适合 3D 生命周期 |
| 4 | React 集成 | Context + Hooks（非 Reconciler） | 架构简单 + 引擎独立 + 低风险 |
| 5 | 墙体几何 | BufferGeometry（非 OCCT） | 简单挤出体无需 B-Rep + 实时预览需求 |
| 6 | 弧形墙表示 | bulge 因子（DXF 标准） | 行业标准 + 最少参数 + 退化性好 |
| 7 | 对象管理 | 数据/渲染分离双 Map | 序列化友好 + 渲染无关测试 |
| 8 | 墙体连接 | Joint 图（非邻接表） | 端点级精度 + 多墙交汇 + Miter 计算需要 |
| 9 | 交汇处理 | Miter Offset（非 CSG 布尔） | 实时性 O(1) + 零依赖 + 可预测 |
| 10 | 面级材质 | materials[] 数组（非 UV atlas） | 拖拽贴图需求 + Three.js 原生支持 |
| 11 | 端点吸附 | 0.15m 阈值 + 绿色 Torus 标记 | 视觉直观 + 阈值适合建筑尺度 |
| 12 | 单位 | 米制（1 单位 = 1 米） | 简化计算，UI 显示转 mm |

---

## 9. 未来演进路线

### 近期（V4.1）
- [ ] 三墙以上交汇的 Miter 处理（T 形、十字形）
- [ ] 撤销/重做系统（基于 BuildingObject 序列化快照）
- [ ] 对象选择和属性编辑（右侧面板联动）
- [ ] 网格吸附（Grid Snap）

### 中期（V5）
- [ ] 柱子（ColumnData + ColumnGeometryBuilder）
- [ ] 门窗洞口（在墙体上开洞）
- [ ] 楼板/天花板
- [ ] 2D 平面图视图（正交相机俯视）
- [ ] 纹理 UV 精确控制（旋转/缩放/偏移）

### 长期（V6+）
- [ ] OCCT 布尔运算集成（复杂交汇处理）
- [ ] 参数化约束系统
- [ ] STEP/DXF 导入导出
- [ ] GPU Compute Shader 加速碰撞检测
- [ ] 空间索引（BVH/R-Tree）优化大场景吸附查询

---

*文档结束*
