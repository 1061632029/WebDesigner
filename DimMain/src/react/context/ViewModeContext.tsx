/**
 * 视图模式上下文
 * 管理 2D（正交俯视）和 3D（透视自由视角）两种视图模式的全局状态
 * 提供 ViewModeProvider 和 useViewMode hook
 */

import React, { createContext, useContext, useState, useCallback } from 'react';

/** 视图模式类型：2D 正交俯视 / 3D 透视自由视角 */
export type ViewMode = '2d' | '3d';

/**
 * 视图模式上下文值接口
 */
export interface ViewModeContextValue {
  /** 当前视图模式 */
  viewMode: ViewMode;
  /** 切换到指定视图模式 */
  setViewMode: (mode: ViewMode) => void;
  /** 在 2D 和 3D 之间切换 */
  toggleViewMode: () => void;
}

/** 视图模式 React Context */
const ViewModeContext = createContext<ViewModeContextValue | null>(null);

/**
 * 视图模式 Provider 组件
 * 包裹需要访问视图模式的组件树
 * @param children - 子组件
 */
export function ViewModeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  /** 当前视图模式，默认 3D */
  const [viewMode, setViewModeState] = useState<ViewMode>('3d');

  /**
   * 切换到指定视图模式
   * @param mode - 目标视图模式
   */
  const setViewMode = useCallback((mode: ViewMode): void => {
    setViewModeState(mode);
  }, []);

  /**
   * 在 2D 和 3D 之间切换
   */
  const toggleViewMode = useCallback((): void => {
    setViewModeState((prev: ViewMode): ViewMode => (prev === '3d' ? '2d' : '3d'));
  }, []);

  const contextValue: ViewModeContextValue = {
    viewMode,
    setViewMode,
    toggleViewMode,
  };

  return (
    <ViewModeContext.Provider value={contextValue}>
      {children}
    </ViewModeContext.Provider>
  );
}

/**
 * 获取视图模式上下文
 * 必须在 ViewModeProvider 内部使用
 * @returns ViewModeContextValue
 */
export function useViewMode(): ViewModeContextValue {
  const ctx: ViewModeContextValue | null = useContext(ViewModeContext);
  if (ctx === null) {
    throw new Error('useViewMode 必须在 ViewModeProvider 内部使用');
  }
  return ctx;
}
