## ADDED Requirements

### Requirement: 属性提供器接口
系统 SHALL 定义 `IPropertyProvider` 接口，将"如何把对象转换为 PropertyGroup 列表"的逻辑与对象数据模型解耦。

#### Scenario: 实现自定义 Provider
- **WHEN** 开发者新增一种建筑对象类型
- **THEN** 该类型 MUST 通过新增实现 `IPropertyProvider` 的类暴露其属性表单
- **AND** 既有 Provider 与既有代码 MUST NOT 被修改

#### Scenario: Provider 适配判定
- **GIVEN** 多个 Provider 已注册
- **WHEN** 选中变化时调用 `PropertyBindingService.buildFor(target)`
- **THEN** 系统 MUST 按注册顺序遍历 Provider，调用第一个 `canHandle(target)` 返回 `true` 的 Provider 的 `build()` 方法

### Requirement: 属性绑定服务
系统 SHALL 提供 `PropertyBindingService`，订阅选中变化并刷新右侧属性面板。

#### Scenario: 选中对象时属性面板更新
- **GIVEN** 当前选中集合为空，属性面板显示"选择对象以查看属性"
- **WHEN** 用户点击场景中的一面墙体使其被选中
- **THEN** 属性面板 MUST 在下一帧前显示该墙体的属性分组（变换 / 材质 / 渲染 等）
- **AND** 属性值 MUST 反映该墙体的真实数据（颜色 / 厚度 / 高度 / 标高 等）

#### Scenario: 取消选中时属性面板清空
- **WHEN** 选中集合变为空
- **THEN** 属性面板 MUST 显示"选择对象以查看属性"占位提示

#### Scenario: 多选时显示共同属性
- **GIVEN** 选中两个同类型对象
- **WHEN** 属性面板更新
- **THEN** 属性面板 MUST 仅显示这些对象共有的属性键
- **AND** 当某属性在不同对象间数值不同，对应控件 MUST 显示"—"或空值占位（不影响修改：修改时统一应用到所有选中对象）

### Requirement: 控件值变更回写
系统 SHALL 让属性面板控件的修改通过命令栈提交，使其可被撤销。

#### Scenario: 修改墙体厚度
- **GIVEN** 已选中一面墙体，其厚度为 0.24
- **WHEN** 用户在属性面板将厚度输入框修改为 0.30 并触发提交
- **THEN** 系统 MUST 提交一条 `PropertyChangeCommand`（before=0.24, after=0.30）
- **AND** 墙体几何体 MUST 重新生成以反映新厚度
- **AND** 用户按下 `Ctrl+Z` 后厚度 MUST 回到 0.24

#### Scenario: 滑块即时反馈不等于即时提交
- **WHEN** 用户拖动滑块控件
- **THEN** 控件值 MAY 实时更新视图（preview）
- **AND** 仅在用户松开滑块（commit）时才 MUST 提交一条 `PropertyChangeCommand`

### Requirement: 内置属性提供器
系统 SHALL 内置 3 个属性提供器覆盖现有对象类型。

#### Scenario: WallPropertyProvider 适用墙体
- **GIVEN** 一个 `WallData`（直墙/弧形墙/矩形墙）对象
- **WHEN** 该对象被选中
- **THEN** 属性面板 MUST 至少显示以下属性：颜色、厚度、高度、底部标高、金属度、粗糙度、可见性、是否锁定

#### Scenario: ColumnPropertyProvider 适用柱子
- **GIVEN** 一个 `ColumnData` 对象
- **WHEN** 该对象被选中
- **THEN** 属性面板 MUST 显示：颜色、宽度、深度、高度、底部标高、绕 Y 轴旋转角度

#### Scenario: GenericMeshPropertyProvider 兜底
- **GIVEN** 一个普通 `THREE.Mesh`（既非 WallData 也非 ColumnData，例如旋转的演示立方体）
- **WHEN** 该对象被选中
- **THEN** 属性面板 MUST 显示：位置(XYZ)、旋转(XYZ)、缩放(XYZ)、颜色
