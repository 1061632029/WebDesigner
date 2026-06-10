## ADDED Requirements

### Requirement: 相机平滑过渡到目标位姿
CameraManager / OrbitControlsWrapper SHALL 提供 `transitionTo(targetPosition, targetLookAt, durationMs)` 方法，将当前活动相机以平滑动画切换到目标位置与目标观察点。

#### Scenario: 触发过渡
- **WHEN** 调用 `transitionTo(new Vector3(0, 0, 10), new Vector3(0, 0, 0), 400)`
- **THEN** 主相机 MUST 在约 400ms 内从当前位姿平滑过渡到 `(0, 0, 10)` 朝向原点
- **AND** 过渡曲线 MUST 使用 ease-in-out（如 `easeInOutCubic`）
- **AND** 返回的 Promise MUST 在过渡完成时 resolve

#### Scenario: 过渡期间禁用用户输入
- **WHEN** 过渡正在进行
- **THEN** OrbitControls 的用户输入（旋转 / 平移 / 缩放）MUST 被忽略
- **AND** 过渡结束后 OrbitControls 的输入响应 MUST 自动恢复

#### Scenario: 过渡中断
- **GIVEN** 一次过渡正在进行
- **WHEN** 调用方再次调用 `transitionTo(...)` 触发新的过渡
- **THEN** 上一次的 Promise MUST 以中断状态结束（reject 或携带 `cancelled: true` 字段，由实现选择并保持一致）
- **AND** 新过渡 MUST 从当前实际位姿开始

## MODIFIED Requirements

### Requirement: OrbitControls 轨道控制器集成
引擎 MUST 集成 Three.js OrbitControls，支持鼠标/触摸交互控制相机的旋转、缩放和平移。OrbitControls SHALL 可配置启用/禁用，并 SHALL 支持运行时被其他交互工具（如 Gizmo、ViewCube 过渡）临时禁用。

#### Scenario: 启用轨道控制器
- **WHEN** 引擎初始化时启用 OrbitControls
- **THEN** 用户可通过鼠标左键拖拽旋转、滚轮缩放、右键拖拽平移来控制相机视角

#### Scenario: 禁用轨道控制器
- **WHEN** 通过 API 禁用 OrbitControls
- **THEN** 鼠标/触摸交互不再影响相机视角

#### Scenario: 配置控制器参数
- **WHEN** 设置 OrbitControls 的参数（如 enableDamping、dampingFactor、minDistance、maxDistance）
- **THEN** 控制器行为按配置参数生效

#### Scenario: 被外部工具临时禁用
- **GIVEN** OrbitControls 当前 `enabled === true`
- **WHEN** Gizmo 拖拽开始或 ViewCube 触发相机过渡
- **THEN** OrbitControls MUST 暂时被禁用（不再响应鼠标输入）
- **AND** 当外部工具操作结束时 OrbitControls MUST 自动恢复到禁用前的 enabled 状态
