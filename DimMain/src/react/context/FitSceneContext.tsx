/**
 * 自适应场景桥接上下文
 * 在 Canvas 外部（useDemoSetup）注册回调，在 Canvas 内部（WallDrawScene）注入实际的 engine 引用
 *
 * 设计模式与 DrawToolContext / StlPlaceContext 一致：
 * - Provider 持有 MutableRefObject，不触发 React 重渲染
 * - Canvas 内部组件将实际函数写入 ref
 * - Canvas 外部组件通过 ref 调用函数
 */

import React, { createContext, useContext, useRef } from 'react';
import * as THREE from 'three/webgpu';

/**
 * 自适应场景桥接接口
 * fitToViewRef.current 由 Canvas 内部的 FitSceneHandler 注入
 */
export interface FitSceneBridge {
  /**
   * 自适应场景回调引用
   * 参数 directionVector：相机相对于场景中心的方向向量
   * 例：new THREE.Vector3(0, 0, 1) 表示从前方看
   */
  fitToViewRef: React.MutableRefObject<((directionVector: THREE.Vector3) => void) | null>;
}

/** Context 实例，默认 null */
const FitSceneCtx: React.Context<FitSceneBridge | null> = createContext<FitSceneBridge | null>(null);

/**
 * 自适应场景 Provider
 * 必须包裹在 Canvas 组件的外层（与 DrawToolProvider 同级）
 */
export function FitSceneProvider(props: { children: React.ReactNode }): React.ReactElement {
  /** 桥接 ref：Canvas 内部注入，Canvas 外部调用 */
  const fitToViewRef: React.MutableRefObject<((directionVector: THREE.Vector3) => void) | null> =
    useRef<((directionVector: THREE.Vector3) => void) | null>(null);

  const bridge: FitSceneBridge = { fitToViewRef: fitToViewRef };

  return <FitSceneCtx.Provider value={bridge}>{props.children}</FitSceneCtx.Provider>;
}

/**
 * 获取自适应场景桥接上下文
 * 必须在 FitSceneProvider 内部使用
 */
export function useFitSceneBridge(): FitSceneBridge {
  const ctx: FitSceneBridge | null = useContext(FitSceneCtx);
  if (ctx === null) {
    throw new Error('useFitSceneBridge 必须在 FitSceneProvider 内部使用');
  }
  return ctx;
}
