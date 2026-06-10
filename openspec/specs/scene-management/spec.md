## ADDED Requirements

### Requirement: 场景创建与管理
引擎 MUST 提供 SceneManager 类，负责创建和管理 Three.js Scene 实例。SceneManager SHALL 持有当前活动场景的引用，并提供场景的创建和切换能力。

#### Scenario: 创建默认场景
- **WHEN** 引擎初始化完成
- **THEN** SceneManager 自动创建一个默认的 Three.js Scene 实例作为当前活动场景

#### Scenario: 获取当前活动场景
- **WHEN** 通过 SceneManager 获取当前场景
- **THEN** 返回当前活动的 Three.js Scene 实例

### Requirement: 场景节点添加与移除
SceneManager MUST 支持向当前场景中添加和移除 Three.js Object3D 节点。添加和移除操作 SHALL 立即反映在场景图中。

#### Scenario: 添加节点到场景
- **WHEN** 调用 SceneManager 的 `add()` 方法传入一个 Object3D 对象
- **THEN** 该对象被添加到当前活动场景中，下一帧渲染时可见

#### Scenario: 从场景中移除节点
- **WHEN** 调用 SceneManager 的 `remove()` 方法传入一个已存在的 Object3D 对象
- **THEN** 该对象从当前活动场景中移除，下一帧渲染时不可见

### Requirement: 场景背景设置
SceneManager MUST 支持设置场景的背景颜色。背景颜色 SHALL 接受十六进制颜色值或 Three.js Color 对象。

#### Scenario: 设置场景背景颜色
- **WHEN** 调用 SceneManager 的 `setBackground()` 方法传入一个颜色值（如 0x000000）
- **THEN** 场景的背景色被更新为指定颜色，下一帧渲染时生效

### Requirement: 场景销毁
SceneManager MUST 提供 `dispose()` 方法，销毁场景中的所有节点并释放相关资源。

#### Scenario: 销毁场景
- **WHEN** 调用 SceneManager 的 `dispose()` 方法
- **THEN** 场景中所有子节点被遍历并调用其 dispose 方法（如有），场景被清空
