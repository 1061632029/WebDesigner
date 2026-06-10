## ADDED Requirements

### Requirement: 实时鼠标世界坐标显示
状态栏 SHALL 实时显示鼠标在 XZ 平面（Y=0）上的世界坐标投影，格式 `(x.xx, 0.00, z.xx)`，单位米，保留两位小数。

#### Scenario: 鼠标在视口内移动
- **GIVEN** 用户已将鼠标移入 3D 视口区域
- **WHEN** 鼠标位置变化
- **THEN** 状态栏的坐标显示 MUST 在下一帧内更新

#### Scenario: 鼠标移出视口
- **WHEN** 鼠标离开视口
- **THEN** 状态栏坐标显示 MUST 显示占位 `—` 或保持最后一次有效坐标（具体由实现选择，必须确定且一致）

### Requirement: 选中对象信息显示
状态栏 SHALL 显示当前选中对象的名称与选中数量。

#### Scenario: 无选中
- **WHEN** 选中集合为空
- **THEN** 状态栏 MUST 显示 `未选中对象` 或类似占位文本

#### Scenario: 单选
- **GIVEN** 一个名为 `墙体-3` 的对象被选中
- **THEN** 状态栏 MUST 显示 `选中: 墙体-3`

#### Scenario: 多选
- **GIVEN** 3 个对象被同时选中
- **THEN** 状态栏 MUST 显示 `选中: 3 个对象`

### Requirement: 帧率显示
状态栏 SHALL 显示主渲染循环的实时帧率（FPS），基于最近 30 帧滑动窗口计算。

#### Scenario: 帧率每秒至少更新两次
- **WHEN** 渲染循环正常运行
- **THEN** 状态栏的 FPS 显示 MUST 在不超过 500ms 间隔内刷新一次
- **AND** 显示为整数 `60 FPS` 或类似格式

### Requirement: 场景对象总数
状态栏 SHALL 显示 `BuildingObjectManager` 中当前管理的可见建筑对象总数。

#### Scenario: 添加对象后计数刷新
- **GIVEN** 当前对象总数为 5
- **WHEN** 用户绘制完成一面新墙
- **THEN** 状态栏对象计数 MUST 在该命令执行后刷新为 6

#### Scenario: 撤销创建后计数刷新
- **GIVEN** 用户刚刚绘制一面墙使总数从 5 变为 6
- **WHEN** 用户按下 `Ctrl+Z`
- **THEN** 状态栏对象计数 MUST 刷新为 5
