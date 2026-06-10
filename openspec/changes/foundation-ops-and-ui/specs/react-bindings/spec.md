## ADDED Requirements

### Requirement: SelectionContext 选中状态上下文
引擎 MUST 提供 `SelectionContext` 与配套 `useSelectionContext()` Hook，向 React 子组件暴露当前选中对象集合及其变更订阅。

#### Scenario: 子组件读取当前选中
- **WHEN** 子组件调用 `useSelectionContext()`
- **THEN** 返回值 MUST 至少包含 `{ selected: Array<SelectedItem>, count: number, primary: SelectedItem | null }`
- **AND** 选中变化时使用该 Hook 的组件 MUST 自动重新渲染

#### Scenario: SelectionContext 单一实例
- **THEN** 一棵 React 树中 MUST 仅存在一个 `SelectionContext.Provider`，且与底层 `SelectionManager` 单例对应

### Requirement: HistoryContext 命令栈状态上下文
引擎 MUST 提供 `HistoryContext` 与 `useHistoryContext()` Hook，向 React 子组件暴露撤销/重做可用状态。

#### Scenario: 工具栏按钮联动栈状态
- **GIVEN** 撤销栈为空，重做栈为空
- **THEN** `useHistoryContext()` 返回的 `canUndo` MUST 为 `false`、`canRedo` MUST 为 `false`
- **AND** 顶部工具栏的撤销/重做按钮 MUST 显示禁用态

#### Scenario: 提交命令后按钮状态变化
- **WHEN** 通过 `historyManager.execute(...)` 提交一条命令
- **THEN** `useHistoryContext()` 返回的 `canUndo` MUST 变为 `true`
- **AND** 工具栏撤销按钮 MUST 启用并 tooltip 显示该命令的 label

### Requirement: GizmoContext 变换工具状态上下文
引擎 MUST 提供 `GizmoContext` 与 `useGizmoContext()` Hook，向 React 子组件暴露当前变换模式与切换方法。

#### Scenario: 子组件读取当前模式
- **WHEN** 子组件调用 `useGizmoContext()`
- **THEN** 返回值 MUST 至少包含 `{ mode: 'select' | 'move' | 'rotate' | 'scale', setMode(next): void }`
- **AND** 模式变化时使用该 Hook 的组件 MUST 自动重新渲染

#### Scenario: 工具栏按钮通过 Hook 切换模式
- **WHEN** 用户点击 `tb-move` 工具栏按钮
- **THEN** 按钮内部 MUST 调用 `gizmoContext.setMode('move')`
- **AND** Gizmo 服务 MUST 在下一帧内响应模式变化（更新手柄外观）
