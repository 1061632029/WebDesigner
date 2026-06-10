## Context

DimMain 是基于 Three.js WebGPU 渲染管线 + React 18 函数式组件 + Vite 5 的桌面级 3D 建模前端。当前已有 `SceneManager` / `RenderLoop` / `OrbitControlsWrapper` / `SelectionManager` / `BuildingObjectManager` / `PanelManager` 等核心服务，整体架构遵循"OOP 单一职责服务类 + React Context 暴露给视图层"的模式（见 `docs/ARCHITECTURE_V4.md`）。

本次变更引入 5 个新能力 + 修改 2 个现有能力，全部为前端工程内部改动，无后端 API 与持久化变更。重点在于：
- 引入命令栈（历史系统）— 一个新的横向服务，几乎所有"可撤销"操作都要绕道这里
- 引入变换 Gizmo — 需要与 `OrbitControls` 进行事件冲突隔离
- 让属性面板"活"起来 — 选中→属性、属性→对象的双向绑定
- 加一个独立渲染的 ViewCube — 不能干扰主渲染管线，但需要与主相机同步

## Goals / Non-Goals

**Goals:**
- 选中→变换→修改属性→撤销重做的闭环可在一个 demo 场景内完整跑通。
- 所有新增模块遵循现有 OOP + React Context 模式：服务类负责状态与逻辑，Context 暴露给 React 组件，Hook 提供使用门面。
- 命令栈是唯一的"可撤销操作入口"：所有 mutate 类操作（创建/删除/变换/属性修改）均通过 `CommandHistoryManager.execute(command)` 提交，禁止直接修改对象。
- 顶部工具栏 5 个按钮（选择/移动/旋转/缩放/撤销/重做）从 UI 占位变为真正可用的功能。
- ViewCube 不占用主渲染帧时间预算（< 1ms/frame），独立 Canvas 渲染。
- 严格遵循 `01_代码规范.md`：单一职责拆文件 / 显式类型 / 中文关键流程注释。

**Non-Goals:**
- 多选对象的批量 Gizmo 操作（当前 SelectionManager 已支持多选，但本次 Gizmo 只处理"单选时附加"；多选时 Gizmo 隐藏）。
- 操作合并（如连续拖动 Gizmo 时不进行 command coalescing，每次拖拽结束都是一个独立 command；优化可放后续）。
- 持久化历史栈（页面刷新后清空）。
- ViewCube 的"前/后"等文字本地化（先用固定中文："前/后/左/右/上/下"）。
- 属性面板的脏值校验、错误提示样式（先用 `console.warn` 给出反馈即可）。
- ViewCube 拖拽旋转视角（仅支持点击切换视角；拖拽视角靠主视口的 OrbitControls）。

## Decisions

### Decision 1: 命令栈使用同步 `ICommand` 接口，不支持异步命令

**选择**: 定义 `ICommand` 接口为同步契约：
```ts
interface ICommand {
  readonly label: string;
  execute(): void;
  undo(): void;
}
```

**替代方案**:
- 异步 Promise 命令（`execute(): Promise<void>`）：可支持网络请求类操作，但大幅增加并发推理复杂度（撤销时若还有 pending execute 怎么办？），本次范围内的所有操作都是本地内存操作，没必要。

**理由**: 本次范围内所有 mutate 操作均为同步（移动 Mesh / 修改材质 / 增删 BuildingObject），同步契约更简单可靠。后续若有异步命令需求，可引入 `IAsyncCommand` 子接口而非破坏现有契约。

---

### Decision 2: Gizmo 拖拽期间禁用 `OrbitControls`

**选择**: 在 `TransformGizmo` 构造时监听 `TransformControls` 的 `dragging-changed` 事件：
- 当 `event.value === true`（开始拖拽）→ `orbitControlsWrapper.disable()`
- 当 `event.value === false`（结束拖拽）→ `orbitControlsWrapper.enable()` + 构造并提交 `TransformCommand`

**替代方案**:
- 在 OrbitControls 内部主动忽略 Gizmo 范围内的事件：需要复杂的命中测试，且 Three.js 的两个 Controls 不共享事件系统。

**理由**: 这是 Three.js 官方示例中的标准做法，简单可靠，无副作用。

---

### Decision 3: ViewCube 使用独立 `THREE.WebGLRenderer` + 共享相机四元数同步

**选择**: ViewCube 使用一个独立的 `WebGLRenderer`（WebGL 而非 WebGPU，避免双 WebGPU 上下文冲突）渲染到右上角一个 128×128 的 absolute-positioned canvas；每帧从主相机读取旋转四元数，应用到 ViewCube 内部的反向相机上，使立方体相对屏幕的朝向反映主视角。

**替代方案**:
- 纯 CSS 3D Transform 模拟：实现简单但点击命中检测复杂、抗锯齿差。
- 在主 Scene 中作为 Overlay 渲染：会污染主场景对象树，且与后处理流水线冲突。
- WebGPU 共享上下文：实现复杂，性价比低。

**理由**: 独立 WebGL renderer 完全隔离，CSS 定位轻量，鼠标命中检测可复用 Three.js 的 Raycaster。128×128 立方体场景渲染开销 < 0.5ms。

---

### Decision 4: 相机过渡动画使用基于时间的 slerp + 主 RenderLoop 驱动

**选择**: 在 `OrbitControlsWrapper` 上新增方法：
```ts
transitionTo(targetPosition: Vector3, targetLookAt: Vector3, durationMs: number): Promise<void>
```
内部记录起始位姿与目标位姿，每帧基于 `(now - startTime) / durationMs` 计算插值因子 `t`，使用 `easeInOutCubic(t)`：
- 位置：`Vector3.lerpVectors(start, end, t)`
- 朝向：`Quaternion.slerpQuaternions(startQuat, endQuat, t)`（通过 lookAt 矩阵推出目标四元数）

过渡期间禁用 OrbitControls 用户输入。

**替代方案**:
- 引入 tween.js / GSAP：增加依赖，本次需求单一过渡曲线即可。
- 直接 setTimeout 系列：精度差，无法与 RAF 对齐。

**理由**: 项目已有 `RenderLoop` 提供逐帧回调机制，自然嵌入即可；缓动函数纯函数极轻量。

---

### Decision 5: 属性绑定使用 `IPropertyProvider` 策略模式

**选择**: 定义：
```ts
interface IPropertyProvider<T = unknown> {
  /** 该 Provider 能处理的对象类型判定 */
  canHandle(target: T): boolean;
  /** 为目标对象生成属性分组 */
  build(target: T, ctx: PropertyBuildContext): PropertyGroup[];
}
```
`PropertyBindingService` 维护已注册 Provider 列表，选中变化时遍历找到第一个 `canHandle` 返回 true 的 Provider 调用 `build`。本次内置三个 Provider：
- `WallPropertyProvider`：处理 `WallData`（厚度 / 高度 / 标高 / 颜色 / 金属度 / 粗糙度）
- `ColumnPropertyProvider`：处理 `ColumnData`
- `GenericMeshPropertyProvider`：兜底处理任意 `THREE.Mesh`（位置 / 旋转 / 缩放 / 颜色）

控件 `onChange` 回调内部构造 `PropertyChangeCommand` 并提交命令栈。

**替代方案**:
- 在每个对象类上直接挂 `getProperties()` 方法：耦合数据模型与 UI 表达，违反单一职责。
- 全部用反射/装饰器：在没有运行时反射的 TS 环境中复杂度高。

**理由**: 策略模式与现有 `IGeometryBuilder` 模式一致；新增对象类型时只需新增 Provider 而无需改既有代码。

---

### Decision 6: 多选时 Gizmo 隐藏，仅在单选时显示

**选择**: `TransformGizmo` 订阅 `SelectionManager` 的选中变化：
- 选中集合大小 === 1：`attach(selectedObject)`
- 否则：`detach()`

**替代方案**:
- 多选时附加到选中包围盒中心：需要额外的 group object，命令栈也变复杂（需要保存每个对象的相对偏移）。可在后续迭代加入。

**理由**: 减少首版实现风险，单选 Gizmo 已能覆盖 80% 使用场景。

---

### Decision 7: 状态栏 FPS 与鼠标坐标分别由不同源驱动

**选择**:
- FPS：在 `RenderLoop` 内部维护一个滑动窗口（最近 30 帧），通过 `addFrameListener` 提供数据；StatusBar 通过新增 `IFrameStatsProvider` 接口读取。
- 鼠标坐标：StatusBar 自己监听 Canvas 的 `pointermove` 事件，用 `RaycastHelper` 投影到 Y=0 平面。
- 选中信息：通过 `SelectionContext` 订阅。
- 对象总数：通过 `BuildingContext.objectManager.getAll().length` + `toolVersion` 触发刷新。

**替代方案**: 把所有数据塞进一个集中的 `StatusBarStore`：增加同步复杂度，且 React 已经天然能聚合多个 Context。

**理由**: 数据源天然分散，React 重渲染粒度由各自 Context 控制即可。

## Risks / Trade-offs

- **[风险] `TransformControls` 与 `OrbitControls` 同时绑定 Canvas 时事件优先级冲突** → 缓解：通过 `dragging-changed` 在 Gizmo 拖拽期间硬禁用 OrbitControls，且只让 Gizmo 监听 `pointerdown` 时 `event.stopPropagation()`（如 Three.js 示例所示）。
- **[风险] 命令栈中保存 BufferGeometry 引用导致 GPU 资源无法释放（删除墙体后用户撤销重建时再次推送时旧 geometry 已 dispose）** → 缓解：`DeleteCommand` 不 dispose，仅从场景移除 + 从 manager 列表 detach；只有"清空场景"或"超出栈深度被丢弃的命令"才真正 dispose。设计 `dispose()` 钩子在命令出栈时调用。
- **[风险] 同帧内多次 Gizmo 拖动产生大量命令爆栈** → 缓解：通过 `dragging-changed` 事件触发命令（仅在拖拽结束时提交一次），而非 `objectChange`。
- **[风险] ViewCube 独立 renderer 在低端机上仍可能拖慢主循环** → 缓解：ViewCube 的渲染只在相机四元数发生变化（dot product < 0.9999）时触发，相机静止时跳过；并提供 `enabled: boolean` 用户开关。
- **[风险] 属性面板每次选中变化都重建整个 React 子树，可能闪烁** → 缓解：`PropertyControl` 组件按 `item.id` key 渲染，相同 id 的控件复用；面板分组数据使用 `useMemo` 缓存。
- **[风险] 命令栈与 BuildingObjectManager 的内部状态可能不一致（如外部直接调用 manager.add）** → 缓解：在 `useDemoSetup` 与 `WallDrawTool` 中所有创建路径都走 `CreateCommand`；为后续维护编写 ESLint 规则限制（可选，本次提案不强制）。
- **[Trade-off] 不做命令合并（coalescing）** → 后果：用户连续拖动属性面板滑块时，每次微调都是一个命令，撤销需多次按 Ctrl+Z。后续可通过 `CoalesceWindowMs` 实现，本次接受现状。
- **[Trade-off] ViewCube 不支持拖拽旋转视角** → 后果：用户需在主视口拖拽。文档与 tooltip 中说明。
