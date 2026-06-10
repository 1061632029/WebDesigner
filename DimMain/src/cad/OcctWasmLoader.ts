/**
 * OpenCascade.js WASM 加载器
 * 单例模式管理 WASM 模块的异步加载和生命周期
 */

import type { OpenCascadeInstance, OcctInitStatus } from './OcctTypes';

/**
 * OCCT WASM 加载器
 * 确保整个应用只加载一次 WASM 模块
 */
export class OcctWasmLoader {
  /** 单例实例 */
  private static _instance: OcctWasmLoader | null = null;

  /** WASM 模块实例 */
  private _oc: OpenCascadeInstance | null = null;

  /** 加载状态 */
  private _status: OcctInitStatus = 'idle';

  /** 加载错误 */
  private _error: Error | null = null;

  /** 加载 Promise（用于避免重复加载） */
  private _loadPromise: Promise<OpenCascadeInstance> | null = null;

  /** 状态变更监听器 */
  private _listeners: Set<() => void> = new Set();

  /**
   * 获取单例实例
   */
  public static getInstance(): OcctWasmLoader {
    if (OcctWasmLoader._instance === null) {
      OcctWasmLoader._instance = new OcctWasmLoader();
    }
    return OcctWasmLoader._instance;
  }

  /**
   * 获取当前加载状态
   */
  public getStatus(): OcctInitStatus {
    return this._status;
  }

  /**
   * 获取加载错误
   */
  public getError(): Error | null {
    return this._error;
  }

  /**
   * 获取 OCCT 实例（加载完成后可用）
   */
  public getOc(): OpenCascadeInstance | null {
    return this._oc;
  }

  /**
   * 订阅状态变更
   * @param listener - 变更回调
   * @returns 取消订阅函数
   */
  public subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return (): void => {
      this._listeners.delete(listener);
    };
  }

  /**
   * 通知监听器状态变更
   */
  private _notify(): void {
    this._listeners.forEach((listener: () => void) => listener());
  }

  /**
   * 异步加载 WASM 模块
   * 多次调用只会触发一次加载，返回同一个 Promise
   * @returns OpenCascade 实例
   */
  public async load(): Promise<OpenCascadeInstance> {
    /* 已加载完成，直接返回 */
    if (this._oc !== null) {
      return this._oc;
    }

    /* 正在加载中，返回同一个 Promise */
    if (this._loadPromise !== null) {
      return this._loadPromise;
    }

    /* 开始加载 */
    this._status = 'loading';
    this._notify();

    this._loadPromise = this._doLoad();
    return this._loadPromise;
  }

  /**
   * 实际执行 WASM 加载
   */
  private async _doLoad(): Promise<OpenCascadeInstance> {
    try {
      /* 动态导入 opencascade.js（避免阻塞首屏加载） */
      const initOpenCascade = (await import('opencascade.js')).default;

      /* 初始化 WASM 模块 */
      const oc: OpenCascadeInstance = await initOpenCascade();

      this._oc = oc;
      this._status = 'ready';
      this._notify();

      console.log('[OcctWasmLoader] OpenCascade WASM 加载成功');
      return oc;
    } catch (err: unknown) {
      const error: Error = err instanceof Error ? err : new Error(String(err));
      this._error = error;
      this._status = 'error';
      this._loadPromise = null;
      this._notify();

      console.error('[OcctWasmLoader] WASM 加载失败:', error);
      throw error;
    }
  }
}
