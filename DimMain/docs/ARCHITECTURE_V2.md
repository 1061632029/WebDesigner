# Dim WebGPU Engine — 架构设计文档 V2

> 版本：0.2.0  
> 更新日期：2026-05-21  
> 项目名称：`dim-webgpu-engine`

---

## 1. 项目概述

Dim WebGPU Engine 是一个基于 **Three.js + WebGPU + React** 的三维设计引擎平台。采用 **前后端分离 + Monorepo** 架构，前端负责 3D 渲染和 UI 交互，后端负责 CAD 图形处理、参数化建模和模型转码等重计算任务。

**核心目标：**

- 利用 WebGPU 实现高性能三维渲染
- 参照三维家风格的专业 UI 布局（侧边导航 + 工具栏 + 属性面板）
- 插件化面板系统，简洁的功能注册接口
- Node.js 调度层 + C++ 计算层的高并发后端架构
- 火山引擎 TOS 云存储支持

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         前端 (DimMain)                              │
│                React 18 + Three.js r170 + WebGPU + Vite 6          │
│                                                                     │
│  ┌──────┬───────────┬───────────────────────────┬────────────────┐  │
│  │ Side │  Left     │      TopToolbar           │                │  │
│  │ Nav  │  Panel    ├───────────────────────────┤  Right         │  │
│  │      │           │                           │  Property      │  │
│  │ 图标 │  功能卡片  │    3D Viewport (Canvas)   │  Panel         │  │
│  │ 导航 │  分组列表  │    WebGPU 渲染            │  属性编辑器     │  │
│  │      │           │                           │  滑块/开关/颜色 │  │
│  └──────┴───────────┴───────────────────────────┴────────────────┘  │
│                              StatusBar                              │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ REST API + WebSocket
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Node.js 调度层 (DimServer)                        │
│                   Fastify + TypeScript + BullMQ                     │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ API Routes  │  │ Task Queue   │  │ Storage Provider          │  │
│  │ CAD/转码/   │  │ BullMQ+Redis │  │ LocalFile / TOS / S3     │  │
│  │ 参数化      │  │ 优先级/重试  │  │ 火山引擎 TOS             │  │
│  └──────┬──────┘  └──────┬───────┘  └───────────────────────────┘  │
│         │                │                                          │
│         ▼                ▼                                          │
│  ┌─────────────────────────────┐                                   │
│  │ Worker Threads / 子进程      │                                   │
│  │ C++ NAPI 绑定              │                                    │
│  └──────────────┬──────────────┘                                   │
└─────────────────┼──────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   C++ 计算层 (DimCompute)                           │
│                                                                     │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ CAD 内核         │  │ 参数化引擎        │  │ 模型转码器       │  │
│  │ OpenCascade     │  │ 约束求解/布尔运算  │  │ assimp + OCCT   │  │
│  │ STEP/DXF/DWG   │  │ 倒角/圆角/阵列    │  │ STEP→GLTF/GLB   │  │
│  └─────────────────┘  └──────────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 技术栈总览

| 层级 | 技术 | 版本 | 角色 |
|------|------|------|------|
| **前端渲染** | Three.js | r170 | 3D 图形基础设施 |
| **前端渲染** | WebGPU | 浏览器原生 | GPU 渲染后端 |
| **前端框架** | React | 18.3.1 | 声明式 UI + 场景描述 |
| **前端构建** | Vite | 6.x | ESM 构建工具 |
| **前端语言** | TypeScript | 5.6.x | 前端类型安全 |
| **Node 调度** | Fastify | 5.x | HTTP 服务框架 |
| **任务队列** | BullMQ | 5.x | 分布式异步任务 |
| **队列存储** | Redis | 7.x | BullMQ 后端存储 |
| **云存储** | 火山引擎 TOS | @volcengine/tos-sdk | 3D 资源云存储 |
| **数据库** | SQLite / 火山云 DB | better-sqlite3 | 元数据持久化 |
| **C++ 计算** | OpenCascade | 7.7+ | CAD 内核 |
| **C++ 计算** | assimp | 5.x | 模型格式转换 |
| **C++ 绑定** | Node-API (NAPI) | v8 | C++ ↔ Node.js 桥接 |
| **包管理** | pnpm workspace | 10.x | Monorepo 管理 |

---

## 4. Monorepo 项目结构

```
Dim+WebGPU/
├── pnpm-workspace.yaml              # pnpm workspace 配置
├── package.json                      # 根 package（scripts 管理）
├── tsconfig.base.json               # 共享 TS 基础配置
│
├── DimShared/                        # 🟡 共享类型包
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                 #   统一导出
│       ├── api-types.ts             #   API 请求/响应类型
│       ├── scene-types.ts           #   场景数据模型
│       ├── panel-types.ts           #   面板配置类型
│       ├── task-types.ts            #   任务状态类型
│       └── storage-types.ts         #   存储相关类型
│
├── DimMain/                          # 🟢 前端应用
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── core/                    #   3D 引擎核心
│       ├── scene/                   #   场景管理
│       ├── camera/                  #   相机系统
│       ├── geometry/                #   几何体工厂
│       ├── material/                #   材质工厂
│       ├── lighting/                #   光照工厂
│       ├── layout/                  #   🆕 布局系统
│       ├── panel/                   #   🆕 面板管理器
│       ├── api/                     #   🆕 API 调用层
│       ├── react/                   #   React 绑定层
│       │   ├── components/
│       │   │   ├── layout/          #   🆕 布局组件
│       │   │   ├── controls/        #   🆕 通用控件
│       │   │   └── ...              #   3D 组件（已有）
│       │   ├── hooks/
│       │   └── context/
│       ├── demo/
│       └── types/
│
├── DimServer/                        # 🔵 后端服务
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                 #   Fastify 服务入口
│       ├── config/                  #   服务配置
│       ├── routes/                  #   API 路由
│       ├── services/                #   业务服务
│       ├── queue/                   #   任务队列
│       ├── compute/                 #   C++ 计算层绑定
│       ├── storage/                 #   存储抽象层
│       └── websocket/               #   WebSocket 推送
│
└── openspec/                         # 规范文档
```

---

## 5. 前端 UI 布局系统

### 5.1 布局结构（参照三维家风格）

```
┌──────┬───────────┬─────────────────────────────┬──────────────────┐
│56px  │  240px    │        TopToolbar 48px       │     280px        │
│      │           ├─────────────────────────────┤                  │
│ Side │  Left     │                             │   Right          │
│ Nav  │  Panel    │                             │   Property       │
│      │           │     3D Viewport             │   Panel          │
│ 图标 │  分组标题  │     (Canvas)                │  ┌────────────┐ │
│ +    │  ┌──┐┌──┐ │     WebGPU 渲染             │  │ 属性分组   │ │
│ 文字 │  │卡││卡│ │                             │  │ 滑块/开关  │ │
│      │  └──┘└──┘ │                             │  │ 颜色/数值  │ │
│ 选中 │  ...      │                             │  └────────────┘ │
│ 高亮 │  可折叠   │                             │  可折叠         │
└──────┴───────────┴─────────────────────────────┴──────────────────┘
│                        StatusBar 28px                             │
└───────────────────────────────────────────────────────────────────┘
```

### 5.2 面板管理器 API

```typescript
// 简洁的注册接口
const panel = usePanel();

// 侧边导航
panel.addNav('定制', '🔧', 'custom-panel');

// 左侧面板内容
panel.addLeftPanel('custom-panel', {
  groups: [
    { title: '硬装定制', items: [
      { icon: '🧱', label: '铺砖', action: startTiling },
    ]},
  ]
});

// 顶部工具栏
panel.addTool('保存', '💾', saveProject, { shortcut: 'Ctrl+S' });

// 右侧属性
panel.addProperty('基础参数', [
  { type: 'number', label: '层高', unit: 'mm', default: 2800, onChange: setHeight },
  { type: 'slider', label: '不透明度', min: 0, max: 100, onChange: setOpacity },
  { type: 'toggle', label: '显示墙体', default: false, onChange: toggleWalls },
]);
```

---

## 6. 后端 API 设计

### 6.1 CAD 图形处理

```
POST   /api/cad/parse           上传并解析 CAD 文件
POST   /api/cad/boolean         布尔运算
POST   /api/cad/export          导出 CAD 文件
```

### 6.2 参数化建模

```
POST   /api/parametric/generate   参数化生成几何体
POST   /api/parametric/update     参数更新重算
POST   /api/parametric/batch      批量计算
```

### 6.3 模型转码

```
POST   /api/convert/to-gltf      转换为 GLTF/GLB
POST   /api/convert/to-step      转换为 STEP
POST   /api/convert/compress     Draco 压缩
POST   /api/convert/lod          LOD 生成
```

### 6.4 任务管理

```
GET    /api/tasks/:id            查询任务状态
GET    /api/tasks/:id/progress   SSE 实时进度
DELETE /api/tasks/:id            取消任务
WS     /ws/progress              WebSocket 进度推送
```

### 6.5 存储管理

```
POST   /api/storage/upload       上传文件（→ TOS）
GET    /api/storage/:key         下载/获取签名 URL
DELETE /api/storage/:key         删除文件
GET    /api/storage/list         列举文件
```

---

## 7. 存储抽象层

```typescript
interface IStorageProvider {
  upload(key: string, data: Buffer | ReadableStream, metadata?: FileMetadata): Promise<string>;
  download(key: string): Promise<ReadableStream>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
  list(prefix: string): Promise<FileInfo[]>;
}

// 实现：
// - LocalFileStorage    开发环境，文件存本地磁盘
// - VolcengineTOSStorage  生产环境，火山引擎 TOS
// - AWSS3Storage         备选，AWS S3 兼容
```

---

## 8. 高并发任务调度

```
前端请求 → Fastify API → TaskService → BullMQ 入队
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
              Worker #1              Worker #2              Worker #N
              (C++ NAPI)             (C++ NAPI)             (C++ NAPI)
              CAD 处理               模型转码                参数化计算
                    │                      │                      │
                    └──────────────────────┼──────────────────────┘
                                           │
                                    进度 → WebSocket → 前端
```

---

*文档结束*
