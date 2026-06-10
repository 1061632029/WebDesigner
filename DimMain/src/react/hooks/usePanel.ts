/**
 * usePanel Hook
 * 提供面板管理器的访问 + 自动响应面板数据变更
 */

import { useContext, useEffect, useReducer } from 'react';
import { PanelContext } from '../context/PanelContext';
import { PanelManager } from '../../panel/PanelManager';

/**
 * 获取面板管理器实例
 * 必须在 AppShell（PanelContext.Provider）内部使用
 * @returns PanelManager 实例
 */
export function usePanelManager(): PanelManager {
  const context = useContext(PanelContext);
  if (context === null) {
    throw new Error('usePanelManager 必须在 AppShell 内部使用');
  }
  return context.panelManager;
}

/**
 * 订阅面板数据变更并自动重渲染的 Hook
 * 使用 useReducer 版本号递增触发重渲染，避免 useSyncExternalStore 引用比对问题
 * @param selector - 从 PanelManager 中选取数据的函数
 * @returns selector 返回的数据
 */
export function usePanelData<T>(selector: (manager: PanelManager) => T): T {
  const panelManager: PanelManager = usePanelManager();

  /**
   * 版本号递增触发组件重渲染
   */
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  /**
   * 订阅 PanelManager 变更，变更时触发重渲染
   */
  useEffect((): (() => void) => {
    const unsubscribe: () => void = panelManager.subscribe(forceUpdate);
    return unsubscribe;
  }, [panelManager]);

  /**
   * 直接调用 selector 获取当前快照
   * 每次渲染都重新计算，确保数据最新
   */
  return selector(panelManager);
}

/**
 * 简化 Hook：仅订阅面板变更触发重渲染，不选取数据
 * 适用于需要在 PanelManager 变更后执行某些操作的场景
 */
export function usePanelUpdate(): void {
  const panelManager: PanelManager = usePanelManager();
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  useEffect((): (() => void) => {
    const unsubscribe: () => void = panelManager.subscribe(forceUpdate);
    return unsubscribe;
  }, [panelManager]);
}
