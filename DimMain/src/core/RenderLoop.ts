import { FrameCallback } from './Engine';

/**
 * 渲染循环管理类
 * 基于 requestAnimationFrame 驱动每帧更新，支持启动、暂停和帧回调管理
 */
export class RenderLoop {
  /** 帧回调函数集合 */
  private _callbacks: Set<FrameCallback> = new Set<FrameCallback>();
  /** requestAnimationFrame 返回的 ID，用于取消动画帧 */
  private _animationFrameId: number | null = null;
  /** 渲染循环是否正在运行 */
  private _isRunning: boolean = false;
  /** 每帧执行的主渲染函数 */
  private _renderFunction: () => void;

  /**
   * 创建渲染循环实例
   * @param renderFunction - 每帧执行的主渲染函数（由 Engine 提供）
   */
  constructor(renderFunction: () => void) {
    this._renderFunction = renderFunction;
  }

  /** 获取渲染循环是否正在运行 */
  public get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * 启动渲染循环
   * 使用 requestAnimationFrame 驱动每帧更新
   */
  public start(): void {
    if (this._isRunning) {
      return;
    }
    this._isRunning = true;
    this._tick();
  }

  /**
   * 停止渲染循环
   */
  public stop(): void {
    this._isRunning = false;
    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
  }

  /**
   * 注册帧回调函数
   * @param callback - 帧回调函数
   * @returns 取消注册的函数
   */
  public addFrameCallback(callback: FrameCallback): () => void {
    this._callbacks.add(callback);
    /* 返回取消注册的函数 */
    return (): void => {
      this._callbacks.delete(callback);
    };
  }

  /**
   * 执行所有已注册的帧回调
   * @param deltaTime - 距上一帧的时间间隔（秒）
   * @param elapsedTime - 引擎启动以来的总运行时间（秒）
   */
  public executeCallbacks(deltaTime: number, elapsedTime: number): void {
    for (const callback of this._callbacks) {
      callback(deltaTime, elapsedTime);
    }
  }

  /**
   * 清除所有帧回调
   */
  public clearCallbacks(): void {
    this._callbacks.clear();
  }

  /**
   * 渲染循环的每帧 tick 函数
   * 执行主渲染函数并请求下一帧
   */
  private _tick(): void {
    if (!this._isRunning) {
      return;
    }

    /* 执行主渲染函数 */
    this._renderFunction();

    /* 请求下一帧 */
    this._animationFrameId = requestAnimationFrame((): void => {
      this._tick();
    });
  }
}
