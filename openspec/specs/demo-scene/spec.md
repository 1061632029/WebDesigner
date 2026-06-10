## ADDED Requirements

### Requirement: 示例场景展示
引擎 MUST 提供一个完整的 Demo 场景，展示引擎的核心渲染能力。Demo 场景 SHALL 包含多个不同几何体、多种材质、多个光源，以及可交互的相机控制。

#### Scenario: 加载 Demo 场景
- **WHEN** 用户在浏览器中打开应用
- **THEN** 显示一个包含多个三维物体的场景，物体使用不同的几何体和材质

### Requirement: Demo 场景包含多种几何体
Demo 场景 MUST 至少包含 3 种不同的几何体（如立方体、球体、平面），展示几何体系统的能力。

#### Scenario: 场景中展示多种几何体
- **WHEN** Demo 场景渲染完成
- **THEN** 场景中可见至少一个立方体、一个球体和一个地面平面

### Requirement: Demo 场景包含多种材质
Demo 场景 MUST 为不同物体使用不同的材质配置（如不同颜色、不同金属度/粗糙度），展示材质系统的能力。

#### Scenario: 场景中展示多种材质
- **WHEN** Demo 场景渲染完成
- **THEN** 场景中的物体使用了至少 2 种不同配置的材质（如一个金属材质、一个粗糙材质）

### Requirement: Demo 场景包含光照
Demo 场景 MUST 包含至少一个环境光和一个平行光，使场景具有合理的光照效果。

#### Scenario: 场景中包含光照
- **WHEN** Demo 场景渲染完成
- **THEN** 场景中的物体有明暗变化，能看到光照和阴影效果

### Requirement: Demo 场景支持相机交互
Demo 场景 MUST 启用 OrbitControls，用户可通过鼠标交互控制观察视角。

#### Scenario: 用户交互控制相机
- **WHEN** 用户在 Demo 场景中拖拽鼠标左键
- **THEN** 相机绕场景中心旋转，视角随鼠标移动而变化
- **WHEN** 用户滚动鼠标滚轮
- **THEN** 相机距离场景中心的距离发生变化（缩放）

### Requirement: Demo 场景包含简单动画
Demo 场景 MUST 包含至少一个持续旋转的物体，展示 useFrame 帧回调和渲染循环的能力。

#### Scenario: 物体持续旋转
- **WHEN** Demo 场景运行时
- **THEN** 至少有一个物体绕自身 Y 轴持续旋转

### Requirement: WebGPU 不可用时显示提示
Demo 场景 MUST 在 WebGPU 不可用时显示友好的文字提示，告知用户需要使用支持 WebGPU 的浏览器。

#### Scenario: 浏览器不支持 WebGPU
- **WHEN** 用户使用不支持 WebGPU 的浏览器打开 Demo
- **THEN** 页面显示明确的提示信息，说明需要 Chrome 113+ 或 Edge 113+ 等支持 WebGPU 的浏览器
