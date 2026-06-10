/**
 * DrawToolContext
 * 绘制工具桥接上下文，允许 Canvas 外部组件（如左侧面板）触发 Canvas 内部的绘制模式
 *
 * 设计原因：
 * - useDrawTool 依赖 useEngine，只能在 Canvas 内使用
 * - 面板按钮在 AppShell（Canvas 外部），需要一种跨边界通信机制
 * - 通过 MutableRefObject 存储回调，避免 Context 值变更引发不必要的重渲染
 */

import React, { createContext, useContext, useRef } from 'react';
import type { DrawToolMode } from '../../building/BuildingTypes';

/**
 * 绘制工具桥接接口
 */
export interface DrawToolBridge {
  /** 激活绘制模式的回调引用（由 Canvas 内组件设置） */
  activateModeRef: React.MutableRefObject<((mode: DrawToolMode) => void) | null>;
  /** 停用绘制工具的回调引用 */
  deactivateRef: React.MutableRefObject<(() => void) | null>;
}

/** Context 实例 */
const DrawToolCtx: React.Context<DrawToolBridge | null> = createContext<DrawToolBridge | null>(null);

/**
 * DrawToolBridgeProvider
 * 在 App 层包裹，为内外组件提供共享的回调引用
 */
export function DrawToolBridgeProvider(props: { children: React.ReactNode }): React.ReactElement {
  const activateModeRef: React.MutableRefObject<((mode: DrawToolMode) => void) | null> = useRef<((mode: DrawToolMode) => void) | null>(null);
  const deactivateRef: React.MutableRefObject<(() => void) | null> = useRef<(() => void) | null>(null);

  /** bridge 对象在组件生命周期内稳定不变 */
  const bridgeRef: React.MutableRefObject<DrawToolBridge> = useRef<DrawToolBridge>({
    activateModeRef: activateModeRef,
    deactivateRef: deactivateRef,
  });

  return (
    <DrawToolCtx.Provider value={bridgeRef.current}>
      {props.children}
    </DrawToolCtx.Provider>
  );
}

/**
 * 获取绘制工具桥接对象
 * 可在 Canvas 内外均可使用
 */
export function useDrawToolBridge(): DrawToolBridge {
  const bridge: DrawToolBridge | null = useContext(DrawToolCtx);
  if (bridge === null) {
    throw new Error('useDrawToolBridge 必须在 DrawToolBridgeProvider 内部使用');
  }
  return bridge;
}
