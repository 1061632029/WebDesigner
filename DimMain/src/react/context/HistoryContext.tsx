/**
 * 命令栈 React Context
 * 将 CommandHistoryManager 单例注入 React 组件树，并通过 useSyncExternalStore 模式
 * 让订阅组件在栈状态变化时自动重新渲染
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { CommandHistoryManager } from '../../history/CommandHistoryManager';
import type { HistoryState } from '../../history/HistoryTypes';

/**
 * Context 值类型
 */
interface HistoryContextValue {
  /** 命令栈管理器实例 */
  manager: CommandHistoryManager;
  /** 当前栈状态快照（每次状态变化触发组件重渲） */
  state: HistoryState;
}

/** Context 实例（默认 null，用于检测调用时是否在 Provider 内） */
const HistoryContext: React.Context<HistoryContextValue | null> = createContext<HistoryContextValue | null>(null);

/**
 * HistoryProvider Props
 */
export interface HistoryProviderProps {
  /** 可选的外部 manager 实例；若未提供则 Provider 自行创建 */
  manager?: CommandHistoryManager;
  /** 子组件 */
  children: ReactNode;
}

/**
 * HistoryProvider 组件
 * 通常包裹在最外层（与 EngineProvider 同层或更外）
 */
export function HistoryProvider(props: HistoryProviderProps): React.ReactElement {
  /* 若外部未传入 manager，则本 Provider 持有自创建实例，并在卸载时 dispose */
  const ownedManager: CommandHistoryManager = useMemo(
    (): CommandHistoryManager => {
      return props.manager !== undefined ? props.manager : new CommandHistoryManager();
    },
    [props.manager]
  );

  /* 订阅 manager 状态变更，触发组件重渲 */
  const [state, setState] = useState<HistoryState>((): HistoryState => ownedManager.getState());

  useEffect((): (() => void) => {
    const unsubscribe: () => void = ownedManager.subscribe((next: HistoryState): void => {
      setState(next);
    });

    /* 仅在 Provider 自创建 manager 时负责销毁 */
    const shouldDispose: boolean = props.manager === undefined;
    return (): void => {
      unsubscribe();
      if (shouldDispose) {
        ownedManager.dispose();
      }
    };
  }, [ownedManager, props.manager]);

  /* Context 值，state 变化时引用更新触发消费组件重渲 */
  const value: HistoryContextValue = useMemo(
    (): HistoryContextValue => ({ manager: ownedManager, state: state }),
    [ownedManager, state]
  );

  return <HistoryContext.Provider value={value}>{props.children}</HistoryContext.Provider>;
}

/**
 * 在 Provider 子组件中获取命令栈管理器与当前状态
 * @throws 不在 HistoryProvider 内调用时抛出错误
 */
export function useHistoryContext(): HistoryContextValue {
  const value: HistoryContextValue | null = useContext(HistoryContext);
  if (value === null) {
    throw new Error('useHistoryContext 必须在 <HistoryProvider> 组件树内调用');
  }
  return value;
}

/**
 * 便捷 Hook：仅获取 manager 实例（不触发 state 变更重渲）
 * 适合需要调用 execute/undo/redo 但不依赖按钮启用态的场景
 */
export function useHistoryManager(): CommandHistoryManager {
  return useHistoryContext().manager;
}
