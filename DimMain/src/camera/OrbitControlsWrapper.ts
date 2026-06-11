import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * 轨道控制器配置选项接口
 */
export interface OrbitControlsOptions {
  /** 是否启用阻尼（惯性），默认 true */
  enableDamping?: boolean;
  /** 阻尼系数，默认 0.05 */
  dampingFactor?: number;
  /** 最小缩放距离，默认 1 */
  minDistance?: number;
  /** 最大缩放距离，默认 100 */
  maxDistance?: number;
  /** 是否启用平移，默认 true */
  enablePan?: boolean;
}

/**
 * 相机过渡 Promise 的 resolve/reject 句柄
 */
interface TransitionDeferred {
  /** 过渡正常完成时调用 */
  resolve: () => void;
  /** 过渡被打断时调用 */
  reject: (reason: { cancelled: true; reason: string }) => void;
}

/**
 * 当前活动相机过渡的内部状态
 */
interface TransitionState {
  /** 过渡开始时的相机位置 */
  startPos: THREE.Vector3;
  /** 过渡开始时的控制器目标点 */
  startTarget: THREE.Vector3;
  /** 过渡目标相机位置 */
  endPos: THREE.Vector3;
  /** 过渡目标控制器观察点 */
  endTarget: THREE.Vector3;
  /** 过渡总时长（毫秒） */
  durationMs: number;
  /** 过渡开始时的时间戳（performance.now） */
  startTime: number;
  /** Promise 句柄 */
  deferred: TransitionDeferred;
  /** 过渡开始前 OrbitControls 的 enabled 状态（结束时还原） */
  prevEnabled: boolean;
}

/**
 * 相机交互状态。
 * idle 表示没有视角操作；其余状态表示视角控制独占输入，外部拾取工具应暂停检测。
 */
export type CameraInteractionState = 'idle' | 'rotating' | 'zooming' | 'panning' | 'transitioning';

/**
 * easeInOutCubic 缓动函数
 * 输入 t ∈ [0, 1]，输出经过 ease-in-out 曲线变换的 [0, 1]
 */
function easeInOutCubic(t: number): number {
  if (t < 0.5) {
    return 4 * t * t * t;
  }
  const f: number = 2 * t - 2;
  return 1 + (f * f * f) / 2;
}

/**
 * OrbitControls 轨道控制器封装类
 * 封装 Three.js OrbitControls，支持：
 * - 鼠标/触摸交互控制相机的旋转、缩放和平移
 * - 平滑过渡到目标位姿（供 ViewCube 使用）
 * - 嵌套式临时禁用（pushSuspend/popSuspend，供 Gizmo 和 ViewCube 共享）
 */
export class OrbitControlsWrapper {
  /** Three.js OrbitControls 实例 */
  private _controls: OrbitControls;

  /** 被控制的相机引用 */
  private _camera: THREE.Camera;

  /** OrbitControls 绑定的 DOM 元素引用，用于识别鼠标滚轮、按键对应的相机交互状态。 */
  private _domElement: HTMLElement;

  /** 当前正在进行的过渡状态，null 表示无过渡 */
  private _transition: TransitionState | null = null;

  /** 嵌套式禁用计数器：> 0 时控制器被外部工具暂时挂起 */
  private _suspendDepth: number = 0;

  /** 进入 suspend 前的 enabled 状态（用于退出时还原） */
  private _suspendOriginalEnabled: boolean = true;

  /** 用户是否正在通过 OrbitControls 操作相机。 */
  private _isUserInteracting: boolean = false;

  /** 最近一次相机发生变化的时间戳，用于覆盖阻尼惯性阶段。 */
  private _lastCameraChangeTime: number = 0;

  /** 当前相机交互状态：旋转、缩放、平移会作为独立状态阻断外部检测。 */
  private _cameraInteractionState: CameraInteractionState = 'idle';

  /** 最近一次鼠标按键推断出的相机交互状态，用于 OrbitControls start 事件确认状态。 */
  private _lastPointerCameraState: CameraInteractionState = 'idle';

  /** 相机交互状态回到 idle 的延迟定时器，用于覆盖滚轮与阻尼惯性尾帧。 */
  private _cameraInteractionIdleTimerId: ReturnType<typeof setTimeout> | null = null;

  /** 相机交互结束后的冷却时间，期间外部拾取工具仍不应执行检测。 */
  private static readonly CAMERA_INTERACTION_IDLE_DELAY_MS: number = 120;

  /**
   * 创建轨道控制器
   * @param camera - 要控制的相机实例
   * @param domElement - 监听鼠标/触摸事件的 DOM 元素
   * @param target - 控制器围绕的目标点，默认原点
   */
  constructor(camera: THREE.Camera, domElement: HTMLElement, target?: THREE.Vector3) {
    this._camera = camera;
    this._domElement = domElement;
    this._controls = new OrbitControls(camera, domElement);

    /* 配置默认参数 */
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.05;
    this._controls.minDistance = 1;
    this._controls.maxDistance = 100;
    this._controls.enablePan = true;
    /* 鼠标按钮配置：三维空间中按住左键旋转视角，中键不再承担视角旋转职责。 */
    this._controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE, // 左键旋转视角
      MIDDLE: null,             // 中键不绑定 OrbitControls 操作
      // RIGHT:null THREE.MOUSE.PAN,   // 右键平移视角
      RIGHT:null,   // 右键平移视角
    };
    /* 设置目标点 */
    if (target) {
      this._controls.target.copy(target);
    }

    /* 监听 OrbitControls 状态变化：用于外部交互工具在相机变化期间暂停高成本 hover 拾取。 */
    this._controls.addEventListener('start', this._onControlsStart);
    this._controls.addEventListener('change', this._onControlsChange);
    this._controls.addEventListener('end', this._onControlsEnd);
    this._domElement.addEventListener('pointerdown', this._onPointerDown, { passive: true });
    this._domElement.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('pointerup', this._onPointerUpOrCancel);
    window.addEventListener('pointercancel', this._onPointerUpOrCancel);
  }

  /**
   * 获取原始 OrbitControls 实例
   * @returns Three.js OrbitControls 实例
   */
  public getControls(): OrbitControls {
    return this._controls;
  }

  /**
   * 设置是否允许旋转（用于 2D 模式下锁定视角）
   * 禁用旋转时同时锁定极角为 0（纯俯视），防止通过键盘等方式旋转
   * @param enabled - true 允许旋转，false 禁止旋转
   */
  public setRotateEnabled(enabled: boolean): void {
    this._controls.enableRotate = enabled;
    if (!enabled) {
      /* 锁定极角为 π/2（正俯视方向），防止任何旋转偏移 */
      this._controls.minPolarAngle = Math.PI / 2;
      this._controls.maxPolarAngle = Math.PI / 2;
      /* 锁定方位角为当前值，防止水平旋转 */
      this._controls.minAzimuthAngle = this._controls.getAzimuthalAngle();
      this._controls.maxAzimuthAngle = this._controls.getAzimuthalAngle();
    } else {
      /* 恢复默认极角范围 */
      this._controls.minPolarAngle = 0;
      this._controls.maxPolarAngle = Math.PI;
      /* 恢复默认方位角范围（无限制） */
      this._controls.minAzimuthAngle = -Infinity;
      this._controls.maxAzimuthAngle = Infinity;
    }
  }

  /**
   * 配置控制器参数
   * @param options - 控制器配置选项
   */
  public configure(options: OrbitControlsOptions): void {
    if (options.enableDamping !== undefined) {
      this._controls.enableDamping = options.enableDamping;
    }
    if (options.dampingFactor !== undefined) {
      this._controls.dampingFactor = options.dampingFactor;
    }
    if (options.minDistance !== undefined) {
      this._controls.minDistance = options.minDistance;
    }
    if (options.maxDistance !== undefined) {
      this._controls.maxDistance = options.maxDistance;
    }
    if (options.enablePan !== undefined) {
      this._controls.enablePan = options.enablePan;
    }
  }

  /**
   * 启用控制器
   */
  public enable(): void {
    this._controls.enabled = true;
  }

  /**
   * 禁用控制器
   */
  public disable(): void {
    this._controls.enabled = false;
  }

  /**
   * 临时挂起控制器（嵌套安全）
   * 第一次调用时记录当前 enabled 状态并禁用；后续调用仅累加计数
   * 适用于 Gizmo 拖拽期间 / ViewCube 过渡期间互斥控制
   */
  public pushSuspend(): void {
    if (this._suspendDepth === 0) {
      this._suspendOriginalEnabled = this._controls.enabled;
      this._controls.enabled = false;
    }
    this._suspendDepth += 1;
  }

  /**
   * 取消一次挂起（嵌套安全）
   * 当计数减到 0 时恢复到挂起前的 enabled 状态
   */
  public popSuspend(): void {
    if (this._suspendDepth === 0) {
      /* 不平衡调用，静默忽略避免破坏外部状态 */
      return;
    }
    this._suspendDepth -= 1;
    if (this._suspendDepth === 0) {
      this._controls.enabled = this._suspendOriginalEnabled;
    }
  }

  /**
   * 平滑过渡相机到目标位姿
   * 关键流程：
   * 1. 若存在进行中的过渡，先 reject 旧的（携带 cancelled 标志）
   * 2. 捕获当前位置与 target 作为起点（保证中断后从当前实际位姿继续）
   * 3. 挂起 OrbitControls 阻止用户输入
   * 4. 由每帧 update() 推进插值
   * 5. 完成或被中断时 resolve / reject 并恢复控制器
   * @param targetPosition - 目标相机位置（世界坐标）
   * @param targetLookAt - 目标观察点（世界坐标），过渡结束后作为新的 OrbitControls target
   * @param durationMs - 过渡时长，默认 400ms
   * @returns 过渡完成 Promise；中断时 reject 携带 { cancelled: true }
   */
  public transitionTo(
    targetPosition: THREE.Vector3,
    targetLookAt: THREE.Vector3,
    durationMs: number = 400
  ): Promise<void> {
    /* 步骤 1：中断已有过渡 */
    if (this._transition !== null) {
      const prev: TransitionState = this._transition;
      this._transition = null;
      /* 还原 prev 的 enabled，避免 push 失衡 */
      this._controls.enabled = prev.prevEnabled;
      prev.deferred.reject({ cancelled: true, reason: 'superseded' });
    }

    /* 步骤 2：捕获起点 */
    const startPos: THREE.Vector3 = this._camera.position.clone();
    const startTarget: THREE.Vector3 = this._controls.target.clone();

    /* 步骤 3：禁用 OrbitControls 并记录原 enabled */
    const prevEnabled: boolean = this._controls.enabled;
    this._controls.enabled = false;

    /* 步骤 4：构造 deferred Promise 并保存状态 */
    return new Promise<void>((resolve: () => void, reject: (reason: { cancelled: true; reason: string }) => void): void => {
      this._transition = {
        startPos: startPos,
        startTarget: startTarget,
        endPos: targetPosition.clone(),
        endTarget: targetLookAt.clone(),
        durationMs: Math.max(1, durationMs),
        startTime: performance.now(),
        deferred: { resolve: resolve, reject: reject },
        prevEnabled: prevEnabled,
      };
    });
  }

  /**
   * 当前是否正在进行相机过渡
   */
  public get isTransitioning(): boolean {
    return this._transition !== null;
  }

  /**
   * 用户是否正在主动操作 OrbitControls。
   * @returns 正在鼠标/触摸旋转、缩放或平移时返回 true
   */
  public get isUserInteracting(): boolean {
    return this._isUserInteracting;
  }

  /**
   * 获取当前相机交互状态。
   * @returns 当前相机交互状态；过渡动画优先返回 transitioning
   */
  public getCameraInteractionState(): CameraInteractionState {
    if (this._transition !== null) {
      return 'transitioning';
    }

    return this._cameraInteractionState;
  }

  /**
   * 判断相机控制是否处于独立交互状态。
   * 关键流程：旋转、缩放、平移、ViewCube 过渡和阻尼冷却期间均返回 true，外部工具应停止所有拾取检测。
   * @param cooldownMs - 最近一次相机变化后的检测禁用时间，单位毫秒
   * @returns 相机交互独占期间返回 true
   */
  public isCameraInteractionActive(cooldownMs: number = OrbitControlsWrapper.CAMERA_INTERACTION_IDLE_DELAY_MS): boolean {
    if (this._transition !== null || this._cameraInteractionState !== 'idle' || this._isUserInteracting) {
      return true;
    }

    const elapsedMs: number = performance.now() - this._lastCameraChangeTime;
    return elapsedMs >= 0 && elapsedMs < cooldownMs;
  }

  /**
   * 判断相机是否仍处于变化阶段。
   * 关键流程：同时覆盖用户交互、ViewCube 平滑过渡，以及 OrbitControls 阻尼导致的短暂惯性变化。
   * @param cooldownMs - 最近一次 change 事件后的冷却时间，单位毫秒
   * @returns 相机正在变化或刚刚变化完成时返回 true
   */
  public isCameraChanging(cooldownMs: number = 120): boolean {
    return this.isCameraInteractionActive(cooldownMs);
  }

  /**
   * 更新控制器状态（每帧调用，当启用阻尼时必须调用）
   * 同时推进相机过渡动画（若有）
   */
  public update(): void {
    /* 优先处理过渡动画 */
    if (this._transition !== null) {
      this._advanceTransition();
    }

    /* OrbitControls 阻尼更新 */
    this._controls.update();
  }

  /**
   * 销毁控制器，释放事件监听器
   */
  public dispose(): void {
    /* 取消进行中的过渡 */
    if (this._transition !== null) {
      const t: TransitionState = this._transition;
      this._transition = null;
      t.deferred.reject({ cancelled: true, reason: 'disposed' });
    }
    this._controls.removeEventListener('start', this._onControlsStart);
    this._controls.removeEventListener('change', this._onControlsChange);
    this._controls.removeEventListener('end', this._onControlsEnd);
    this._domElement.removeEventListener('pointerdown', this._onPointerDown);
    this._domElement.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('pointerup', this._onPointerUpOrCancel);
    window.removeEventListener('pointercancel', this._onPointerUpOrCancel);
    this._cancelCameraInteractionIdleTimer();
    this._controls.dispose();
  }

  /* ========== 内部方法 ========== */

  /**
   * 推进一帧过渡动画
   * 计算进度 t、应用 easeInOutCubic、插值 position 与 target
   * t >= 1 时完成过渡并 resolve
   */
  private _advanceTransition(): void {
    const state: TransitionState = this._transition as TransitionState;
    const elapsed: number = performance.now() - state.startTime;
    const rawT: number = Math.min(1, elapsed / state.durationMs);
    const easedT: number = easeInOutCubic(rawT);

    /* 线性插值位置 */
    this._camera.position.lerpVectors(state.startPos, state.endPos, easedT);

    /* 线性插值 target，并令 OrbitControls 内部状态保持一致 */
    this._controls.target.lerpVectors(state.startTarget, state.endTarget, easedT);

    if (rawT >= 1) {
      /* 过渡完成：确保精确落到终点 */
      this._camera.position.copy(state.endPos);
      this._controls.target.copy(state.endTarget);

      /* 恢复用户输入响应 */
      this._controls.enabled = state.prevEnabled;

      /* 通知 Promise 完成 */
      const deferred: TransitionDeferred = state.deferred;
      this._transition = null;
      this._lastCameraChangeTime = performance.now();
      this._scheduleCameraInteractionIdle();
      deferred.resolve();
    }
  }

  /** 根据鼠标按键配置推断当前相机交互类型。 */
  private _resolveMouseButtonInteractionState(button: number): CameraInteractionState {
    const mouseButtons: { LEFT?: unknown; MIDDLE?: unknown; RIGHT?: unknown } = this._controls.mouseButtons;
    let action: unknown = null;

    if (button === 0) {
      action = mouseButtons.LEFT;
    } else if (button === 1) {
      action = mouseButtons.MIDDLE;
    } else if (button === 2) {
      action = mouseButtons.RIGHT;
    }

    if (action === THREE.MOUSE.ROTATE) {
      return 'rotating';
    }
    if (action === THREE.MOUSE.DOLLY) {
      return 'zooming';
    }
    if (action === THREE.MOUSE.PAN) {
      return 'panning';
    }

    return 'idle';
  }

  /** 设置相机交互状态，并取消等待回到 idle 的旧定时器。 */
  private _setCameraInteractionState(state: CameraInteractionState): void {
    this._cancelCameraInteractionIdleTimer();
    this._cameraInteractionState = state;
    this._lastCameraChangeTime = performance.now();
  }

  /** 安排相机交互状态延迟回到 idle，避免阻尼或滚轮尾帧期间恢复拾取检测。 */
  private _scheduleCameraInteractionIdle(): void {
    this._cancelCameraInteractionIdleTimer();
    this._cameraInteractionIdleTimerId = setTimeout((): void => {
      this._cameraInteractionIdleTimerId = null;
      if (!this._isUserInteracting && this._transition === null) {
        this._cameraInteractionState = 'idle';
        this._lastPointerCameraState = 'idle';
      }
    }, OrbitControlsWrapper.CAMERA_INTERACTION_IDLE_DELAY_MS);
  }

  /** 取消等待相机交互状态恢复 idle 的定时器。 */
  private _cancelCameraInteractionIdleTimer(): void {
    if (this._cameraInteractionIdleTimerId !== null) {
      clearTimeout(this._cameraInteractionIdleTimerId);
      this._cameraInteractionIdleTimerId = null;
    }
  }

  /** 鼠标按下时根据 OrbitControls 按键配置记录旋转/平移/缩放状态。 */
  private _onPointerDown = (event: PointerEvent): void => {
    if (!this._controls.enabled) {
      return;
    }

    const state: CameraInteractionState = this._resolveMouseButtonInteractionState(event.button);
    this._lastPointerCameraState = state;
    if (state !== 'idle') {
      this._setCameraInteractionState(state);
    }
  };

  /** 鼠标滚轮触发缩放时立即进入独立的相机缩放状态。 */
  private _onWheel = (): void => {
    if (!this._controls.enabled || !this._controls.enableZoom) {
      return;
    }

    this._setCameraInteractionState('zooming');
    this._scheduleCameraInteractionIdle();
  };

  /** 指针抬起或取消时结束主动鼠标状态，等待 OrbitControls end/change 冷却后回到 idle。 */
  private _onPointerUpOrCancel = (): void => {
    this._lastPointerCameraState = 'idle';
    if (!this._isUserInteracting) {
      this._scheduleCameraInteractionIdle();
    }
  };

  /** OrbitControls 开始用户交互时记录状态。 */
  private _onControlsStart = (): void => {
    this._isUserInteracting = true;
    this._lastCameraChangeTime = performance.now();
    if (this._cameraInteractionState === 'idle') {
      const state: CameraInteractionState = this._lastPointerCameraState !== 'idle'
        ? this._lastPointerCameraState
        : 'rotating';
      this._setCameraInteractionState(state);
    }
  };

  /** OrbitControls 相机发生变化时刷新时间戳，覆盖滚轮缩放和阻尼惯性。 */
  private _onControlsChange = (): void => {
    this._lastCameraChangeTime = performance.now();
  };

  /** OrbitControls 用户交互结束时保留最近变化时间，等待短冷却后再恢复高成本拾取。 */
  private _onControlsEnd = (): void => {
    this._isUserInteracting = false;
    this._lastCameraChangeTime = performance.now();
    this._scheduleCameraInteractionIdle();
  };
}
