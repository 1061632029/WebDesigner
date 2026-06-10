## ADDED Requirements

### Requirement: ViewCube 渲染与位置
系统 SHALL 在 3D 视口的右上角渲染一个 128×128 像素（或可配置尺寸）的交互式立方体，作为视角方向指示器。

#### Scenario: ViewCube 出现在右上角
- **GIVEN** 应用已加载 demo 场景
- **WHEN** 视口可见
- **THEN** ViewCube MUST 出现在视口右上角，距视口右边缘与上边缘各 16px
- **AND** ViewCube MUST 始终位于场景内容之上（z-index 高于 3D Canvas，低于模态弹层）

#### Scenario: ViewCube 标签显示
- **THEN** 立方体的 6 个面 MUST 分别标注中文文字：`前` / `后` / `左` / `右` / `上` / `下`
- **AND** 文字 MUST 始终保持正向阅读方向（与该面在屏幕上的可见朝向对齐）

### Requirement: 视角同步
ViewCube SHALL 实时反映主相机的旋转，使立方体的朝向变化与用户视角变化保持一致。

#### Scenario: 用户旋转主视角时立方体随动
- **GIVEN** 用户拖动主视口旋转 OrbitControls
- **WHEN** 主相机旋转
- **THEN** ViewCube 内部的立方体显示 MUST 同步旋转
- **AND** 当前面向用户的面 MUST 始终对应主相机的近似最近标准朝向

#### Scenario: 相机静止时跳过渲染
- **WHEN** 主相机连续两帧间的四元数变化 dot product > 0.9999（视为未变化）
- **THEN** ViewCube 渲染器 MAY 跳过当前帧的重绘以节省性能

### Requirement: 点击切换视角
ViewCube SHALL 支持点击 6 个面、12 条棱、8 个顶角共 26 个可点击区域，并触发主相机平滑过渡到对应标准视角。

#### Scenario: 点击面切换到正视角
- **WHEN** 用户点击 ViewCube 的 `前` 面
- **THEN** 主相机 MUST 在约 400ms 内平滑过渡到 +Z 方向正对场景中心（Y 轴朝上）的位置
- **AND** OrbitControls 在过渡期间 MUST 被禁用
- **AND** 过渡结束后 OrbitControls MUST 自动恢复

#### Scenario: 点击棱切换到等轴视角
- **WHEN** 用户点击 ViewCube 的 `前上` 棱（前面与上面之间的棱）
- **THEN** 主相机 MUST 平滑过渡到俯视前方约 45° 的位置

#### Scenario: 点击顶角切换到斜 45° 等轴视角
- **WHEN** 用户点击 ViewCube 的 `前右上` 顶角
- **THEN** 主相机 MUST 平滑过渡到正对该顶角连接原点的方向（约前 45° + 右 45° + 上 35.26° 的标准等轴视角）

### Requirement: 不干扰主渲染管线
ViewCube SHALL 在独立的 Canvas 上渲染，不向主 Scene 添加任何对象，且不引入额外的 WebGPU 上下文。

#### Scenario: 独立 Canvas 隔离
- **THEN** ViewCube 的 DOM 节点 MUST 是一个独立的 `<canvas>` 元素，与主 3D Canvas 无嵌套关系
- **AND** ViewCube MUST 使用 `THREE.WebGLRenderer`（WebGL），不使用 WebGPU
- **AND** 主 `Scene.children` MUST NOT 包含任何 ViewCube 相关的对象（Mesh / Helper 等）

#### Scenario: 主渲染管线性能预算
- **WHEN** ViewCube 正常运行
- **THEN** ViewCube 渲染 MUST 不增加主渲染循环每帧时间预算超过 1ms（在中端硬件上）
