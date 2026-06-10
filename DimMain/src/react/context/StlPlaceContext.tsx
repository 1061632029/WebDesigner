/**
 * STL 模型布置桥接上下文
 * 跨 Canvas 边界传递"激活 STL 点式布置"的回调
 * 左侧面板（DOM 侧）通过此上下文调用 Canvas 内部的布置工具
 */

import React, { createContext, useContext, useRef } from 'react';
import type { StlModelDef } from '../../model/StlModelRegistry';

/**
 * STL 布置桥接接口
 * 左侧面板写入 activatePlaceRef，Canvas 内部注册回调
 */
export interface StlPlaceBridge {
  /** 激活布置模式的回调引用（Canvas 内部注册） */
  activatePlaceRef: React.MutableRefObject<((model: StlModelDef) => void) | null>;
  /** 取消布置模式的回调引用 */
  deactivatePlaceRef: React.MutableRefObject<(() => void) | null>;
}

/** 桥接上下文 */
const StlPlaceContextObj: React.Context<StlPlaceBridge | null> = createContext<StlPlaceBridge | null>(null);

/**
 * STL 布置桥接 Provider
 * 在 AppShell 层级提供，确保左侧面板和 Canvas 都能访问
 */
export function StlPlaceProvider(props: { children: React.ReactNode }): React.ReactElement {
  const activatePlaceRef: React.MutableRefObject<((model: StlModelDef) => void) | null> =
    useRef<((model: StlModelDef) => void) | null>(null);
  const deactivatePlaceRef: React.MutableRefObject<(() => void) | null> =
    useRef<(() => void) | null>(null);

  const bridge: StlPlaceBridge = {
    activatePlaceRef: activatePlaceRef,
    deactivatePlaceRef: deactivatePlaceRef,
  };

  return (
    <StlPlaceContextObj.Provider value={bridge}>
      {props.children}
    </StlPlaceContextObj.Provider>
  );
}

/**
 * 获取 STL 布置桥接
 * @returns StlPlaceBridge 实例
 * @throws 若不在 StlPlaceProvider 内调用则抛出异常
 */
export function useStlPlaceBridge(): StlPlaceBridge {
  const ctx: StlPlaceBridge | null = useContext(StlPlaceContextObj);
  if (ctx === null) {
    throw new Error('useStlPlaceBridge 必须在 StlPlaceProvider 内部调用');
  }
  return ctx;
}
