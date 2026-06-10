## ADDED Requirements

### Requirement: 命令接口契约
系统 SHALL 定义同步 `ICommand` 接口作为所有可撤销操作的统一契约，包含 `label: string`、`execute(): void`、`undo(): void` 三个成员。

#### Scenario: 实现自定义命令
- **WHEN** 开发者新增一个可撤销操作
- **THEN** 该操作 MUST 实现 `ICommand` 接口
- **AND** `execute()` 与 `undo()` MUST 形成幂等对，即任意次数的 `execute()` → `undo()` 序列执行后系统状态与执行前一致

### Requirement: 命令执行与栈管理
系统 SHALL 提供 `CommandHistoryManager` 负责命令的执行、撤销、重做与栈深度管理。

#### Scenario: 执行命令推入撤销栈
- **WHEN** 调用 `historyManager.execute(command)`
- **THEN** `command.execute()` MUST 被立即调用一次
- **AND** 该命令 MUST 被推入撤销栈顶
- **AND** 重做栈 MUST 被清空

#### Scenario: 撤销操作
- **GIVEN** 撤销栈非空且栈顶命令为 C
- **WHEN** 调用 `historyManager.undo()`
- **THEN** `C.undo()` MUST 被调用
- **AND** C MUST 从撤销栈弹出
- **AND** C MUST 被压入重做栈

#### Scenario: 重做操作
- **GIVEN** 重做栈非空且栈顶命令为 C
- **WHEN** 调用 `historyManager.redo()`
- **THEN** `C.execute()` MUST 被再次调用
- **AND** C MUST 从重做栈弹出
- **AND** C MUST 被压回撤销栈

#### Scenario: 撤销栈深度上限
- **GIVEN** 撤销栈已有 50 条命令
- **WHEN** 调用 `historyManager.execute(newCommand)`
- **THEN** 撤销栈底部最早的命令 MUST 被丢弃
- **AND** 若该被丢弃命令实现了可选的 `dispose(): void` 方法，则 `dispose()` MUST 被调用

#### Scenario: 空栈撤销/重做
- **GIVEN** 撤销栈为空
- **WHEN** 调用 `historyManager.undo()`
- **THEN** 不 MUST 抛出异常
- **AND** 不 MUST 触发任何副作用

### Requirement: 历史状态变更订阅
系统 SHALL 允许外部订阅命令栈的状态变化（用于工具栏按钮启用态联动）。

#### Scenario: 订阅栈状态变更
- **GIVEN** 一个观察者已通过 `historyManager.subscribe(listener)` 注册
- **WHEN** 撤销栈或重做栈大小变化（execute / undo / redo / clear）
- **THEN** `listener(state)` MUST 被调用
- **AND** `state` MUST 包含 `canUndo: boolean`、`canRedo: boolean`、`undoLabel: string | null`、`redoLabel: string | null` 四个字段

### Requirement: 全局快捷键
系统 MUST 在视口/Canvas 聚焦时支持 `Ctrl+Z`（撤销）与 `Ctrl+Y` / `Ctrl+Shift+Z`（重做）快捷键。

#### Scenario: 按下 Ctrl+Z
- **WHEN** 用户在视口聚焦状态下按下 `Ctrl+Z`
- **THEN** `historyManager.undo()` MUST 被调用

#### Scenario: 文本输入框聚焦时快捷键不触发
- **GIVEN** 用户当前焦点在一个 `<input>` 或 `<textarea>` 元素上
- **WHEN** 用户按下 `Ctrl+Z`
- **THEN** `historyManager.undo()` MUST NOT 被调用
- **AND** 浏览器默认行为（输入框文本撤销）MUST 保留

### Requirement: 内置命令实现
系统 SHALL 内置 4 个命令类，覆盖核心 mutate 操作。

#### Scenario: 创建对象命令（CreateCommand）
- **WHEN** 用户绘制完成一面墙体
- **THEN** 系统 MUST 提交 `CreateCommand`，其 `execute()` 调用 `BuildingObjectManager.add(data)`，`undo()` 调用 `BuildingObjectManager.remove(id)`

#### Scenario: 删除对象命令（DeleteCommand）
- **WHEN** 用户按下 Delete 键删除选中对象
- **THEN** 系统 MUST 提交 `DeleteCommand`
- **AND** `execute()` MUST 仅从 manager 与场景移除对象，不调用 `geometry.dispose()` 或 `material.dispose()`
- **AND** 仅当该命令被栈丢弃（超出深度上限）时，才调用 `dispose()` 释放 GPU 资源

#### Scenario: 变换命令（TransformCommand）
- **WHEN** Gizmo 拖拽结束
- **THEN** 系统 MUST 提交 `TransformCommand` 携带 before/after 位置、旋转、缩放快照
- **AND** `undo()` MUST 还原 before 快照

#### Scenario: 属性修改命令（PropertyChangeCommand）
- **WHEN** 用户在属性面板修改一个数值
- **THEN** 系统 MUST 提交 `PropertyChangeCommand` 携带 `{ targetId, propertyPath, before, after }`
- **AND** `undo()` MUST 将该路径属性还原为 before 值
