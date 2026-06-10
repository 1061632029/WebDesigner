import * as THREE from 'three/webgpu';
import { WebGPURenderer } from 'three/webgpu';
import { RenderLoop } from './RenderLoop';
import { SceneManager } from '../scene/SceneManager';
import { CameraManager } from '../camera/CameraManager';
import { takeScreenshot } from '../utils/ScreenshotUtil';
import type { ScreenshotOptions } from '../utils/ScreenshotUtil';

/**
 * 帧回调函数类型定义
 * @param deltaTime - 距上一帧的时间间隔（秒）
 * @param elapsedTime - 引擎启动以来的总运行时间（秒）
 */
export type FrameCallback = (deltaTime: number, elapsedTime: number) => void;

/**
 * 引擎配置选项接口
 */
export interface EngineOptions {
  /** 渲染器挂载的容器元素 */
  container: HTMLElement;
  /** 是否启用抗锯齿，默认 true */
  antialias?: boolean;
}

/**
 * 三维引擎核心类
 * 负责 WebGPURenderer 的初始化、渲染循环管理、尺寸自适应和资源释放
 */
export class Engine {
  /** WebGPU 渲染器实例 */
  private _renderer: WebGPURenderer | null = null;
  /** 渲染循环管理器 */
  private _renderLoop: RenderLoop;
  /** 场景管理器 */
  private _sceneManager: SceneManager;
  /** 相机管理器 */
  private _cameraManager: CameraManager;
  /** 渲染器挂载的容器元素 */
  private _container: HTMLElement;
  /** ResizeObserver 实例，用于监听容器尺寸变化 */
  private _resizeObserver: ResizeObserver | null = null;
  /** 渲染器是否已就绪 */
  private _isReady: boolean = false;
  /** Three.js 时钟，用于计算 delta time */
  private _clock: THREE.Clock;

  /**
   * 创建引擎实例
   * @param options - 引擎配置选项
   */
  constructor(options: EngineOptions) {
    this._container = options.container;
    this._clock = new THREE.Clock(false);
    this._sceneManager = new SceneManager();
    this._cameraManager = new CameraManager();
    this._renderLoop = new RenderLoop(this._onFrame.bind(this));
  }

  /** 获取 WebGPU 渲染器实例 */
  public get renderer(): WebGPURenderer | null {
    return this._renderer;
  }

  /** 获取场景管理器 */
  public get sceneManager(): SceneManager {
    return this._sceneManager;
  }

  /** 获取相机管理器 */
  public get cameraManager(): CameraManager {
    return this._cameraManager;
  }

  /** 获取渲染器是否已就绪 */
  public get isReady(): boolean {
    return this._isReady;
  }

  /**
   * 检测当前浏览器是否支持 WebGPU
   * @returns 是否支持 WebGPU
   */
  public static checkWebGPUSupport(): boolean {
    return 'gpu' in navigator;
  }

  /**
   * 异步初始化引擎
   * 创建 WebGPURenderer、配置渲染器参数、设置尺寸监听
   * @throws 当浏览器不支持 WebGPU 时抛出错误
   */
  public async init(): Promise<void> {
    /* 检测 WebGPU 可用性 */
    if (!Engine.checkWebGPUSupport()) {
      throw new Error(
        '当前浏览器不支持 WebGPU。请使用 Chrome 113+、Edge 113+ 或其他支持 WebGPU 的浏览器。'
      );
    }

    /* 创建 WebGPURenderer 实例 */
    this._renderer = new WebGPURenderer({
      antialias: true,
    });

    /* 等待渲染器初始化完成 */
    await this._renderer.init();

    /* 配置设备像素比 */
    this._renderer.setPixelRatio(window.devicePixelRatio);

    /* 设置初始渲染尺寸 */
    const width: number = this._container.clientWidth;
    const height: number = this._container.clientHeight;
    this._renderer.setSize(width, height);

    /* 将 canvas 挂载到容器元素 */
    this._container.appendChild(this._renderer.domElement);

    /* 更新相机宽高比 */
    this._cameraManager.updateAspect(width, height);

    /* 设置尺寸自适应监听 */
    this._setupResizeObserver();

    this._isReady = true;
  }

  /**
   * 启动渲染循环
   */
  public start(): void {
    this._clock.start();
    this._renderLoop.start();
  }

  /**
   * 停止渲染循环
   */
  public stop(): void {
    this._clock.stop();
    this._renderLoop.stop();
  }

  /**
   * 注册帧回调函数
   * @param callback - 帧回调函数，每帧渲染前调用
   * @returns 取消注册的函数
   */
  public onFrame(callback: FrameCallback): () => void {
    return this._renderLoop.addFrameCallback(callback);
  }

  /**
   * 对当前视图进行高清截图并触发浏览器下载
   * 在下一个渲染帧完成后立即截图，确保帧缓冲中有最新画面内容
   * 截图前临时提升像素比（超采样），截图后恢复，不影响正常渲染性能
   * @param options - 截图配置选项（格式、文件名、超采样倍率等）
   */
  public screenshot(options?: ScreenshotOptions): void {
    if (this._renderer === null || !this._isReady) {
      console.warn('[Engine] 渲染器尚未就绪，无法截图');
      return;
    }

    const renderer: WebGPURenderer = this._renderer;
    const scene: THREE.Scene = this._sceneManager.getScene();
    const camera: THREE.Camera = this._cameraManager.getActiveCamera();

    /*
     * 在下一帧 requestAnimationFrame 回调中执行截图
     * 此时渲染循环已完成当前帧渲染，帧缓冲中有最新画面
     * 截图完成后立即调用 toDataURL 读取像素数据
     */
    requestAnimationFrame((): void => {
      /* 提升像素比进行超采样渲染 */
      const supersample: number = options?.supersample ?? 2;
      const originalPixelRatio: number = window.devicePixelRatio;
      renderer.setPixelRatio(originalPixelRatio * supersample);

      /* 手动渲染一帧（高清尺寸） */
      renderer.render(scene, camera);

      /* 截图并下载 */
      takeScreenshot(renderer, { ...options, supersample: 1 });

      /* 恢复原始像素比 */
      renderer.setPixelRatio(originalPixelRatio);
    });
  }

  /**
   * 销毁引擎，释放所有资源
   */
  public dispose(): void {
    /* 停止渲染循环 */
    this.stop();

    /* 移除尺寸监听 */
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }

    /* 销毁场景 */
    this._sceneManager.dispose();

    /* 销毁相机管理器中的控制器 */
    this._cameraManager.dispose();

    /* 销毁渲染器并移除 canvas */
    if (this._renderer) {
      this._renderer.dispose();
      if (this._renderer.domElement.parentElement) {
        this._renderer.domElement.parentElement.removeChild(this._renderer.domElement);
      }
      this._renderer = null;
    }

    /* 清除所有帧回调 */
    this._renderLoop.clearCallbacks();

    this._isReady = false;
  }

  /**
   * 每帧回调处理函数
   * 按顺序执行：帧回调函数列表 → 更新控制器 → 渲染场景
   */
  private _onFrame(): void {
    if (!this._renderer || !this._isReady) {
      return;
    }

    const deltaTime: number = this._clock.getDelta();
    const elapsedTime: number = this._clock.getElapsedTime();

    /* 执行所有已注册的帧回调 */
    this._renderLoop.executeCallbacks(deltaTime, elapsedTime);

    /* 更新轨道控制器 */
    this._cameraManager.updateControls();

    /* 执行渲染 */
    const scene: THREE.Scene = this._sceneManager.getScene();
    const camera: THREE.Camera = this._cameraManager.getActiveCamera();
    this._renderer.render(scene, camera);
  }

  /**
   * 设置 ResizeObserver 监听容器尺寸变化
   */
  private _setupResizeObserver(): void {
    this._resizeObserver = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && this._renderer) {
          /* 更新渲染器尺寸 */
          this._renderer.setSize(width, height);
          /* 更新相机宽高比 */
          this._cameraManager.updateAspect(width, height);
        }
      }
    });
    this._resizeObserver.observe(this._container);
  }
}
