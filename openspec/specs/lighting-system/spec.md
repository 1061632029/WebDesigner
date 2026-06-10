## ADDED Requirements

### Requirement: 环境光支持
引擎 MUST 提供 LightFactory 类，支持创建 Three.js AmbientLight（环境光）。环境光 SHALL 均匀照亮场景中的所有物体，可配置颜色和强度。

#### Scenario: 创建环境光
- **WHEN** 调用 LightFactory 的 `createAmbientLight()` 方法，传入 color 和 intensity 参数
- **THEN** 返回一个配置正确的 AmbientLight 实例

#### Scenario: 使用默认参数创建环境光
- **WHEN** 调用 LightFactory 的 `createAmbientLight()` 方法不传入任何参数
- **THEN** 使用默认值创建环境光（color=0xffffff, intensity=0.5）

### Requirement: 平行光支持
LightFactory MUST 支持创建 Three.js DirectionalLight（平行光）。平行光 SHALL 模拟太阳光照效果，可配置颜色、强度和方向。

#### Scenario: 创建平行光
- **WHEN** 调用 LightFactory 的 `createDirectionalLight()` 方法，传入 color、intensity 和 position 参数
- **THEN** 返回一个配置正确的 DirectionalLight 实例，光源位置设为指定坐标

#### Scenario: 使用默认参数创建平行光
- **WHEN** 调用 LightFactory 的 `createDirectionalLight()` 方法不传入任何参数
- **THEN** 使用默认值创建平行光（color=0xffffff, intensity=1.0, position=(5, 5, 5)）

### Requirement: 点光源支持
LightFactory MUST 支持创建 Three.js PointLight（点光源）。点光源 SHALL 从一个点向所有方向发射光线，可配置颜色、强度、距离和衰减。

#### Scenario: 创建点光源
- **WHEN** 调用 LightFactory 的 `createPointLight()` 方法，传入 color、intensity、distance、decay 参数
- **THEN** 返回一个配置正确的 PointLight 实例

#### Scenario: 使用默认参数创建点光源
- **WHEN** 调用 LightFactory 的 `createPointLight()` 方法不传入任何参数
- **THEN** 使用默认值创建点光源（color=0xffffff, intensity=1.0, distance=0, decay=2）

### Requirement: 光源动态属性更新
所有光源 MUST 支持运行时动态修改颜色、强度和位置属性，修改后 SHALL 在下一帧渲染时生效。

#### Scenario: 动态修改光源强度
- **WHEN** 通过光源实例修改 intensity 属性为新的值
- **THEN** 下一帧渲染时场景光照按新强度计算

#### Scenario: 动态修改光源位置
- **WHEN** 通过光源实例修改 position 属性为新的坐标
- **THEN** 下一帧渲染时光照方向按新位置计算
