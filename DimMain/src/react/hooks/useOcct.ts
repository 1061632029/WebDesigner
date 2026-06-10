/**
 * useOcct Hook
 * 管理 OpenCascade WASM 模块的加载和访问
 */

import { useEffect, useReducer } from 'react';
import { OcctWasmLoader } from '../../cad/OcctWasmLoader';
import type { OpenCascadeInstance, OcctInitStatus } from '../../cad/OcctTypes';

/**
 * useOcct 返回值接口
 */
export interface UseOcctResult {
  /** OCCT 实例（加载完成后可用） */
  oc: OpenCascadeInstance | null;
  /** 当前加载状态 */
  status: OcctInitStatus;
  /** 加载错误（如果有） */
  error: Error | null;
}

/**
 * 获取 OCCT WASM 实例的 Hook
 * 自动触发加载，并订阅状态变更
 * @returns OCCT 实例、加载状态、错误信息
 */
export function useOcct(): UseOcctResult {
  const loader: OcctWasmLoader = OcctWasmLoader.getInstance();
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  /**
   * 组件挂载时触发 WASM 加载，并订阅状态变更
   */
  useEffect((): (() => void) => {
    /* 订阅加载器状态变更 */
    const unsubscribe: () => void = loader.subscribe(forceUpdate);

    /* 触发加载（如果尚未开始） */
    loader.load().catch((): void => {
      /* 错误已在 loader 内部处理并存储，这里忽略 */
    });

    return unsubscribe;
  }, [loader]);

  return {
    oc: loader.getOc(),
    status: loader.getStatus(),
    error: loader.getError(),
  };
}
