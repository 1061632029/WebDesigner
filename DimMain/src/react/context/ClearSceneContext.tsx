/**
 * 清空场景桥接上下文
 * 用于跨越 Canvas 边界触发“清空场景内所有模型”操作。
 * Canvas 内部负责注入真实清空逻辑，顶部工具栏通过该桥接引用调用。
 */

import React, { createContext, useContext, useRef } from 'react';

/**
 * 清空场景桥接接口
 */
export interface ClearSceneBridge {
  /**
   * 清空场景回调引用。
   * 返回值表示本次是否实际清除了模型；无模型时返回 false。
   */
  clearSceneRef: React.MutableRefObject<(() => boolean) | null>;
}

/** Context 实例，默认 null */
const ClearSceneCtx: React.Context<ClearSceneBridge | null> = createContext<ClearSceneBridge | null>(null);

/**
 * 清空场景 Provider
 * 必须包裹在 Canvas 外层，确保顶部工具栏和 Canvas 内部处理器共享同一桥接引用。
 * @param props - React 子节点属性
 * @returns Provider 元素
 */
export function ClearSceneProvider(props: { children: React.ReactNode }): React.ReactElement {
  /** 桥接 ref：Canvas 内部注入，Canvas 外部调用 */
  const clearSceneRef: React.MutableRefObject<(() => boolean) | null> =
    useRef<(() => boolean) | null>(null);

  const bridge: ClearSceneBridge = { clearSceneRef: clearSceneRef };

  return <ClearSceneCtx.Provider value={bridge}>{props.children}</ClearSceneCtx.Provider>;
}

/**
 * 获取清空场景桥接上下文
 * @returns 清空场景桥接对象
 * @throws 不在 ClearSceneProvider 内调用时抛出错误
 */
export function useClearSceneBridge(): ClearSceneBridge {
  const ctx: ClearSceneBridge | null = useContext(ClearSceneCtx);
  if (ctx === null) {
    throw new Error('useClearSceneBridge 必须在 ClearSceneProvider 内部使用');
  }
  return ctx;
}