## ADDED Requirements

### Requirement: 变换 Gizmo 模式切换
系统 SHALL 提供四种工具模式（select / move / rotate / scale），同一时刻仅一种激活；模式切换通过工具栏按钮或快捷键 `Q`（选择）/ `G`（移动）/ `R`（旋转）/ `S`（缩放）触发。

#### Scenario: 通过快捷键切换到移动模式
- **WHEN** 用户在视口聚焦状态下按下 `G` 键
- **THEN** 当前激活的 Gizmo 模式 MUST 变为 `move`
- **AND** 顶部工具栏中 `tb-move` 按钮 MUST 显示高亮态
- **AND** 若当前已选中一个对象，Gizmo MUST 立即以平移手柄形态附加到该对象

#### Scenario: 通过工具栏切换到旋转模式
- **WHEN** 用户点击工具栏的 `tb-rotate` 按钮
- **THEN** 激活模式 MUST 变为 `rotate`
- **AND** 已存在的 Gizmo MUST 在不切换附加目标的前提下切换为旋转环手柄外观

#### Scenario: 切换到选择模式
- **WHEN** 用户按下 `Q` 键或点击 `tb-select`
- **THEN** 激活模式 MUST 变为 `select`
- **AND** Gizmo MUST 从场景中隐藏（detach）

### Requirement: Gizmo 与选中状态联动
系统 SHALL 根据 `SelectionManager` 的当前选中集合自动管理 Gizmo 的附加与分离。

#### Scenario: 单选对象时 Gizmo 附加
- **WHEN** 选中集合大小由 0 变为 1
- **AND** 当前 Gizmo 模式不为 `select`
- **THEN** Gizmo MUST 附加到该唯一选中对象上
- **AND** Gizmo 中心位置 MUST 与对象的世界位置一致

#### Scenario: 多选时 Gizmo 隐藏
- **WHEN** 选中集合大小由 1 变为 ≥ 2
- **THEN** Gizmo MUST 从场景中分离（detach）

#### Scenario: 取消选中时 Gizmo 隐藏
- **WHEN** 选中集合大小由 1 变为 0
- **THEN** Gizmo MUST 从场景中分离

### Requirement: Gizmo 与相机控制器互斥
系统 MUST 在用户拖拽 Gizmo 手柄期间禁用 `OrbitControlsWrapper`，避免视角同时旋转/平移。

#### Scenario: Gizmo 开始拖拽时禁用 OrbitControls
- **WHEN** 用户在 Gizmo 手柄上按下鼠标开始拖拽
- **THEN** `OrbitControlsWrapper.disable()` MUST 被调用
- **AND** 主相机 MUST 不响应同次鼠标拖拽

#### Scenario: Gizmo 结束拖拽时恢复 OrbitControls
- **WHEN** 用户松开鼠标结束 Gizmo 拖拽
- **THEN** `OrbitControlsWrapper.enable()` MUST 被调用

### Requirement: Gizmo 操作生成可撤销命令
系统 MUST 在 Gizmo 拖拽结束时提交一次 `TransformCommand` 到命令栈，记录变换前后的位置/旋转/缩放快照。

#### Scenario: 拖拽 Gizmo 后撤销
- **GIVEN** 用户使用移动 Gizmo 将对象 A 从位置 P1 拖到位置 P2
- **WHEN** 用户按下 `Ctrl+Z`
- **THEN** 对象 A 的位置 MUST 回到 P1
- **AND** Gizmo MUST 仍附加到对象 A（如其仍为唯一选中对象）

#### Scenario: 拖拽中无中间命令
- **WHEN** 用户在一次连续拖拽中经过 N 个中间位置
- **THEN** 命令栈 MUST 仅新增 1 条命令（拖拽开始位姿 → 拖拽结束位姿）
