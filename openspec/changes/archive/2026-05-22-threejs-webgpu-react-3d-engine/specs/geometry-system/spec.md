## ADDED Requirements

### Requirement: 基础几何体工厂
引擎 MUST 提供 GeometryFactory 类，支持创建常用的基础几何体。GeometryFactory SHALL 封装 Three.js 内置几何体类，返回对应的 BufferGeometry 实例。

#### Scenario: 创建立方体几何体
- **WHEN** 调用 GeometryFactory 的 `createBox()` 方法，传入 width、height、depth 参数
- **THEN** 返回一个配置正确的 BoxGeometry 实例

#### Scenario: 创建球体几何体
- **WHEN** 调用 GeometryFactory 的 `createSphere()` 方法，传入 radius、widthSegments、heightSegments 参数
- **THEN** 返回一个配置正确的 SphereGeometry 实例

#### Scenario: 创建平面几何体
- **WHEN** 调用 GeometryFactory 的 `createPlane()` 方法，传入 width、height 参数
- **THEN** 返回一个配置正确的 PlaneGeometry 实例

### Requirement: 圆柱体几何体支持
GeometryFactory MUST 支持创建圆柱体几何体，可配置顶部半径、底部半径、高度和分段数。

#### Scenario: 创建圆柱体几何体
- **WHEN** 调用 GeometryFactory 的 `createCylinder()` 方法，传入 radiusTop、radiusBottom、height、radialSegments 参数
- **THEN** 返回一个配置正确的 CylinderGeometry 实例

### Requirement: 圆环几何体支持
GeometryFactory MUST 支持创建圆环（Torus）几何体，可配置主半径、管半径和分段数。

#### Scenario: 创建圆环几何体
- **WHEN** 调用 GeometryFactory 的 `createTorus()` 方法，传入 radius、tube、radialSegments、tubularSegments 参数
- **THEN** 返回一个配置正确的 TorusGeometry 实例

### Requirement: 几何体默认参数
所有几何体创建方法 MUST 提供合理的默认参数值，使调用方可以不传任何参数即可创建标准尺寸的几何体。

#### Scenario: 使用默认参数创建几何体
- **WHEN** 调用任意几何体创建方法不传入任何参数
- **THEN** 使用合理默认值创建几何体（如 Box 默认 1×1×1，Sphere 默认 radius=1）
