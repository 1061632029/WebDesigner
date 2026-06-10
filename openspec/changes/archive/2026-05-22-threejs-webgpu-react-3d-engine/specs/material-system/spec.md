## ADDED Requirements

### Requirement: 标准材质支持
引擎 MUST 提供 MaterialFactory 类，支持创建 Three.js WebGPU 兼容的标准 PBR 材质（MeshStandardNodeMaterial）。材质 SHALL 支持配置颜色、金属度、粗糙度等基础 PBR 属性。

#### Scenario: 创建标准材质
- **WHEN** 调用 MaterialFactory 的 `createStandard()` 方法，传入 color、metalness、roughness 参数
- **THEN** 返回一个配置正确的 MeshStandardNodeMaterial 实例

#### Scenario: 使用默认参数创建标准材质
- **WHEN** 调用 MaterialFactory 的 `createStandard()` 方法不传入任何参数
- **THEN** 使用默认值创建材质（color=0xffffff, metalness=0.0, roughness=0.5）

### Requirement: 基础材质支持
MaterialFactory MUST 支持创建不受光照影响的基础材质（MeshBasicNodeMaterial），用于不需要光照计算的场景。

#### Scenario: 创建基础材质
- **WHEN** 调用 MaterialFactory 的 `createBasic()` 方法，传入 color 参数
- **THEN** 返回一个配置正确的 MeshBasicNodeMaterial 实例，该材质不受场景光照影响

### Requirement: 物理材质支持
MaterialFactory MUST 支持创建增强的物理材质（MeshPhysicalNodeMaterial），提供清漆（clearcoat）、透射（transmission）等高级 PBR 属性配置。

#### Scenario: 创建物理材质
- **WHEN** 调用 MaterialFactory 的 `createPhysical()` 方法，传入 color、metalness、roughness、clearcoat、transmission 参数
- **THEN** 返回一个配置正确的 MeshPhysicalNodeMaterial 实例

### Requirement: 材质颜色动态更新
所有材质 MUST 支持运行时动态修改颜色属性，修改后 SHALL 在下一帧渲染时生效。

#### Scenario: 动态修改材质颜色
- **WHEN** 通过材质实例修改 color 属性为新的颜色值
- **THEN** 下一帧渲染时网格显示新的颜色

### Requirement: 材质透明度支持
MaterialFactory 创建的材质 MUST 支持配置透明度（opacity）和透明开关（transparent），使网格可以半透明显示。

#### Scenario: 创建半透明材质
- **WHEN** 创建材质时设置 transparent=true 和 opacity=0.5
- **THEN** 使用该材质的网格以 50% 透明度渲染
