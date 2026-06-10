/**
 * 纹理拖拽上下文
 * 管理纹理从面板拖拽到 3D 视口的状态和回调
 * 使 UI 层（MaterialPanel）和 3D 层（Canvas）能够通信
 */

import React, { createContext, useContext, useRef, useState, useCallback } from 'react';
import type { TexturePreset } from '../../material/TexturePresets';

/**
 * 纹理拖拽状态
 */
export interface TextureDragState {
  /** 当前是否正在拖拽 */
  isDragging: boolean;
  /** 当前拖拽的纹理预设（拖拽中为非 null） */
  draggingPreset: TexturePreset | null;
}

/**
 * 纹理拖拽上下文值
 */
export interface TextureDragContextValue {
  /** 当前拖拽状态 */
  state: TextureDragState;
  /** 开始拖拽 */
  startDrag: (preset: TexturePreset) => void;
  /** 结束拖拽（取消或完成） */
  endDrag: () => void;
  /** 3D 层注册的纹理应用回调引用（Canvas 内部设置） */
  applyTextureRef: React.MutableRefObject<
    ((screenX: number, screenY: number, preset: TexturePreset) => void) | null
  >;
}

/**
 * 纹理拖拽上下文
 */
const TextureDragCtx: React.Context<TextureDragContextValue | null> = createContext<TextureDragContextValue | null>(null);

/**
 * 纹理拖拽 Provider 组件属性
 */
interface TextureDragProviderProps {
  children: React.ReactNode;
}

/**
 * 纹理拖拽 Provider
 * 包裹在 App 层，使 MaterialPanel 和 Canvas 共享拖拽状态
 */
export function TextureDragProvider(props: TextureDragProviderProps): React.ReactElement {
  const [state, setState] = useState<TextureDragState>({
    isDragging: false,
    draggingPreset: null,
  });

  /** 3D 层注册的回调 */
  const applyTextureRef: React.MutableRefObject<
    ((screenX: number, screenY: number, preset: TexturePreset) => void) | null
  > = useRef<((screenX: number, screenY: number, preset: TexturePreset) => void) | null>(null);

  /** 开始拖拽 */
  const startDrag: (preset: TexturePreset) => void = useCallback(
    (preset: TexturePreset): void => {
      setState({ isDragging: true, draggingPreset: preset });
    },
    []
  );

  /** 结束拖拽 */
  const endDrag: () => void = useCallback((): void => {
    setState({ isDragging: false, draggingPreset: null });
  }, []);

  const contextValue: TextureDragContextValue = {
    state: state,
    startDrag: startDrag,
    endDrag: endDrag,
    applyTextureRef: applyTextureRef,
  };

  return (
    <TextureDragCtx.Provider value={contextValue}>
      {props.children}
    </TextureDragCtx.Provider>
  );
}

/**
 * 获取纹理拖拽上下文 Hook
 * @returns 纹理拖拽上下文值
 */
export function useTextureDrag(): TextureDragContextValue {
  const ctx: TextureDragContextValue | null = useContext(TextureDragCtx);
  if (ctx === null) {
    throw new Error('useTextureDrag 必须在 <TextureDragProvider> 内使用');
  }
  return ctx;
}
