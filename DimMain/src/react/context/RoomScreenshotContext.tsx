/**
 * 房间拍摄桥接上下文
 * 在 Canvas 外部触发拍摄，在 Canvas 内部读取 Engine / BuildingObjectManager 后执行房间范围裁剪。
 */

import React, { createContext, useContext, useRef } from 'react';

/** 房间拍摄桥接接口 */
export interface RoomScreenshotBridge {
  /** 房间拍摄回调引用，返回 PNG DataURL */
  captureRoomScreenshotRef: React.MutableRefObject<(() => string) | null>;
}

/** Context 实例，默认 null */
const RoomScreenshotCtx: React.Context<RoomScreenshotBridge | null> = createContext<RoomScreenshotBridge | null>(null);

/**
 * 房间拍摄 Provider。
 * @param props - React 子节点
 * @returns Provider 元素
 */
export function RoomScreenshotProvider(props: { children: React.ReactNode }): React.ReactElement {
  const captureRoomScreenshotRef: React.MutableRefObject<(() => string) | null> = useRef<(() => string) | null>(null);
  const bridge: RoomScreenshotBridge = { captureRoomScreenshotRef: captureRoomScreenshotRef };

  return <RoomScreenshotCtx.Provider value={bridge}>{props.children}</RoomScreenshotCtx.Provider>;
}

/**
 * 获取房间拍摄桥接上下文。
 * @returns 房间拍摄桥接对象
 */
export function useRoomScreenshotBridge(): RoomScreenshotBridge {
  const ctx: RoomScreenshotBridge | null = useContext(RoomScreenshotCtx);
  if (ctx === null) {
    throw new Error('useRoomScreenshotBridge 必须在 RoomScreenshotProvider 内部使用');
  }
  return ctx;
}