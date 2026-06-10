## ADDED Requirements

### Requirement: 透视相机支持
引擎 MUST 支持创建 Three.js PerspectiveCamera，并提供视场角（fov）、近裁剪面（near）、远裁剪面（far）的配置能力。透视相机 SHALL 作为默认相机类型。

#### Scenario: 创建透视相机
- **WHEN** 通过 CameraManager 创建透视相机，传入 fov、near、far 参数
- **THEN** 返回一个配置正确的 PerspectiveCamera 实例，宽高比根据当前渲染器尺寸自动计算

#### Scenario: 使用默认参数创建透视相机
- **WHEN** 通过 CameraManager 创建透视相机但不传入任何参数
- **THEN** 使用默认值创建相机（fov=75, near=0.1, far=1000）

### Requirement: 正交相机支持
引擎 MUST 支持创建 Three.js OrthographicCamera，并提供上下左右边界和近远裁剪面的配置能力。

#### Scenario: 创建正交相机
- **WHEN** 通过 CameraManager 创建正交相机
- **THEN** 返回一个配置正确的 OrthographicCamera 实例，边界根据当前渲染器尺寸自动计算

### Requirement: 相机位置与朝向控制
CameraManager MUST 提供设置相机位置（position）和观察目标（lookAt）的方法。

#### Scenario: 设置相机位置
- **WHEN** 调用 CameraManager 的 `setPosition(x, y, z)` 方法
- **THEN** 当前活动相机的位置更新为指定坐标

#### Scenario: 设置相机观察目标
- **WHEN** 调用 CameraManager 的 `setLookAt(x, y, z)` 方法
- **THEN** 当前活动相机朝向指定坐标点

### Requirement: OrbitControls 轨道控制器集成
引擎 MUST 集成 Three.js OrbitControls，支持鼠标/触摸交互控制相机的旋转、缩放和平移。OrbitControls SHALL 可配置启用/禁用。

#### Scenario: 启用轨道控制器
- **WHEN** 引擎初始化时启用 OrbitControls
- **THEN** 用户可通过鼠标左键拖拽旋转、滚轮缩放、右键拖拽平移来控制相机视角

#### Scenario: 禁用轨道控制器
- **WHEN** 通过 API 禁用 OrbitControls
- **THEN** 鼠标/触摸交互不再影响相机视角

#### Scenario: 配置控制器参数
- **WHEN** 设置 OrbitControls 的参数（如 enableDamping、dampingFactor、minDistance、maxDistance）
- **THEN** 控制器行为按配置参数生效

### Requirement: 相机宽高比自动更新
当渲染器尺寸变化时，CameraManager MUST 自动更新当前活动相机的宽高比并调用 `updateProjectionMatrix()`。

#### Scenario: 渲染器尺寸变化时更新相机
- **WHEN** 引擎检测到容器尺寸变化
- **THEN** 当前活动相机的 aspect ratio 自动更新，投影矩阵重新计算
