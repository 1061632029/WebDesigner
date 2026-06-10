## ADDED Requirements

### Requirement: WebGPU 渲染器初始化
引擎 SHALL 使用 Three.js WebGPURenderer 作为唯一渲染后端。引擎初始化时 MUST 创建 WebGPURenderer 实例，配置 canvas 元素、设备像素比和渲染尺寸。WebGPURenderer 的初始化是异步操作，引擎 MUST 等待 `renderer.init()` 完成后才可开始渲染。

#### Scenario: 成功初始化 WebGPURenderer
- **WHEN** 调用引擎初始化方法并传入一个有效的 HTML 容器元素
- **THEN** 引擎创建 WebGPURenderer 实例，将 canvas 挂载到容器元素中，渲染器就绪状态设为 true

#### Scenario: 浏览器不支持 WebGPU
- **WHEN** 调用引擎初始化方法但 `navigator.gpu` 不存在
- **THEN** 引擎抛出明确的错误信息，指示当前浏览器不支持 WebGPU

### Requirement: 渲染循环管理
引擎 MUST 提供渲染循环（Render Loop）机制，使用 `requestAnimationFrame` 驱动每帧更新。渲染循环 SHALL 支持启动、暂停和恢复操作。每帧 MUST 按顺序执行：帧回调函数列表 → 渲染场景。

#### Scenario: 启动渲染循环
- **WHEN** 调用引擎的 `start()` 方法
- **THEN** 渲染循环开始运行，每帧调用已注册的帧回调并执行渲染

#### Scenario: 暂停和恢复渲染循环
- **WHEN** 调用引擎的 `stop()` 方法
- **THEN** 渲染循环停止，不再执行帧更新和渲染
- **WHEN** 随后调用引擎的 `start()` 方法
- **THEN** 渲染循环恢复运行

### Requirement: 帧回调注册
引擎 MUST 支持注册和注销帧回调函数。帧回调在每帧渲染前被调用，接收当前帧的 delta time（距上一帧的时间间隔，单位秒）和总运行时间作为参数。

#### Scenario: 注册帧回调
- **WHEN** 通过引擎 API 注册一个帧回调函数
- **THEN** 该回调在每帧渲染前被调用，参数包含 delta time 和 elapsed time

#### Scenario: 注销帧回调
- **WHEN** 通过引擎 API 注销一个已注册的帧回调函数
- **THEN** 该回调不再在后续帧中被调用

### Requirement: 渲染尺寸自适应
引擎 MUST 监听容器元素的尺寸变化，自动调整渲染器的输出尺寸和相机的宽高比。

#### Scenario: 容器尺寸变化时自适应
- **WHEN** 引擎所在容器元素的宽度或高度发生变化
- **THEN** 渲染器输出尺寸自动更新为新的容器尺寸，相机宽高比同步更新

### Requirement: 引擎销毁与资源释放
引擎 MUST 提供 `dispose()` 方法，调用后释放所有 GPU 资源、停止渲染循环、移除事件监听器并清理 DOM 元素。

#### Scenario: 销毁引擎
- **WHEN** 调用引擎的 `dispose()` 方法
- **THEN** 渲染循环停止，WebGPURenderer 被销毁，canvas 元素从 DOM 中移除，所有帧回调被清除
