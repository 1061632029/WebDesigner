## Why

当前 DimMain 已具备墙体绘制与选择/高亮等核心功能，但整体建模操作仍未闭环：顶部工具栏的"移动/旋转/缩放/撤销/重做"按钮全部为占位 `noop`，右侧属性面板显示的是硬编码示例数据而无法响应选中对象，底部状态栏只显示版本号，且 3D 视口缺少明确指示当前视角方向的部件，用户无法快速回到标准视角。本次变更聚焦于"让用户能选中→变换→修改属性→撤销重做"这条核心交互闭环，并补齐与视角操作强相关的界面基础部件，为后续功能模块（门窗、楼层、导出等）提供稳定的交互地基。

## What Changes

- **新增 Gizmo 变换交互**：在 3D 视口中提供移动 / 旋转 / 缩放三种 Gizmo（基于 Three.js `TransformControls`），选中对象时自动附加，取消选中时自动移除。
- **顶部工具栏联动 Gizmo**：`tb-select`、`tb-move`、`tb-rotate`、`tb-scale` 四个按钮从 `noop` 改为切换变换模式，并支持 `Q/G/R/S` 快捷键；当前激活模式按钮高亮显示。
- **右侧属性面板联动选中对象**：选中变化时重建属性分组（`变换` / `材质` / `渲染`），数值实时反映被选对象真实属性；修改控件值实时回写到对象；未选中时显示"选择对象以查看属性"占位。
- **新增 Undo / Redo 命令栈**：引入 Command 模式的历史管理器，覆盖创建、删除、变换（移动 / 旋转 / 缩放）、属性修改四类操作；支持 `Ctrl+Z` / `Ctrl+Y` 快捷键；工具栏 `tb-undo` / `tb-redo` 状态联动（栈空时灰显）；栈深度上限 50。
- **底部状态栏增强**：实时显示鼠标在 XZ 平面的世界坐标、当前选中对象名称与数量、场景对象总数、FPS 帧率。
- **新增 ViewCube 视图立方体**：右上角 3D 可交互立方体，与 OrbitControls 实时同步显示当前视角方向；点击 6 个面 / 12 条棱 / 8 个角时相机平滑过渡（约 400ms 缓动）到对应标准视角；不参与主渲染管线（独立 Canvas / 覆盖层）。

## Capabilities

### New Capabilities

- `transform-gizmo`: 变换 Gizmo 系统，封装 Three.js `TransformControls`，提供移动 / 旋转 / 缩放三种模式切换、与 `SelectionManager` 联动、与 `OrbitControls` 冲突隔离（拖拽时禁用相机控制）、与 Undo 栈集成。
- `command-history`: Undo / Redo 命令栈系统，定义 `ICommand` 接口（`execute` / `undo` / `label`）与 `CommandHistoryManager`（执行、撤销、重做、栈深度限制、订阅变更）；提供创建 / 删除 / 变换 / 属性修改四个内置命令实现。
- `property-binding`: 选中对象与右侧属性面板的双向绑定，定义 `IPropertyProvider` 接口（输入选中对象 → 输出 `PropertyGroup[]`），管理选中变化时的属性面板重建与控件回写。
- `status-bar`: 底部状态栏数据聚合与渲染，定义 `StatusBarDataSource`（鼠标世界坐标 / 选中信息 / 帧率 / 对象总数）及 React 组件，由 `RenderLoop` 与交互事件驱动。
- `view-cube`: 视图立方体部件，独立 Canvas 渲染立方体并通过四元数与主相机同步；点击命中区（面 / 棱 / 角）触发主相机过渡动画；提供 `ICameraTransition` 接口处理缓动。

### Modified Capabilities

- `camera-system`: 新增"相机过渡到目标位姿"的需求（被 ViewCube 调用），需提供 `transitionTo(position, target, duration)` 能力；OrbitControls 在 Gizmo 拖拽期间需要可暂时禁用。
- `react-bindings`: 新增 `SelectionContext`（暴露当前选中对象与变更订阅）、`HistoryContext`（暴露命令栈状态）、`GizmoContext`（暴露当前变换模式）三个 Context，供工具栏与属性面板消费。

## Impact

**新增代码模块（DimMain/src/）**：
- `interaction/TransformGizmo.ts`：Gizmo 封装类
- `history/ICommand.ts` / `history/CommandHistoryManager.ts` / `history/commands/*.ts`：命令栈与具体命令实现
- `panel/PropertyBindingService.ts`：选中→属性绑定服务
- `react/components/layout/StatusBar.tsx`：增强的状态栏组件
- `react/components/ViewCube.tsx` 与 `viewcube/ViewCubeRenderer.ts`：视图立方体
- `react/context/SelectionContext.tsx` / `HistoryContext.tsx` / `GizmoContext.tsx`：新增三个 React Context

**修改代码模块**：
- `camera/OrbitControlsWrapper.ts`：新增 `transitionTo` 与拖拽期间禁用控制接口
- `demo/useDemoSetup.ts`：移除硬编码属性数据，改为通过 `PropertyBindingService` 动态生成；将工具栏 `noop` 替换为真实回调
- `react/components/layout/AppShell.tsx`：在视口区域叠加 ViewCube，并使用新的 StatusBar 替换内联状态栏
- `react/components/layout/TopToolbar.tsx`：渲染时显示当前激活 Gizmo 模式的高亮态
- `interaction/SelectionManager.ts`：暴露选中变化订阅事件（若尚未公开）

**依赖**：
- 复用 Three.js 已有的 `TransformControls`（来自 `three/examples/jsm/controls/TransformControls.js`），无需新增 npm 包。
- ViewCube 渲染使用一个独立的 `WebGLRenderer` 实例（轻量小窗口）或纯 Canvas 2D 透视模拟；最终方案在 `design.md` 决定。

**不在本次范围**：基础几何体放置、场景树面板、CAD 导入、灯光管理、测量工具、布尔运算（保留 `noop` 占位即可）。
