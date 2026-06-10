/**
 * 建筑工具上下文
 * 在 Canvas 内部创建 BuildingObjectManager 和 WallDrawTool 的"单例"实例
 * 并通过 Context 共享给所有子组件（绘制工具、选择工具等）
 *
 * 解决问题：
 * - 之前 useDrawTool 在每个调用处都 new 一个 BuildingObjectManager
 *   导致绘制工具和选择工具操作的是不同的实例，选择工具看不到墙体
 * - 现在通过 Provider 创建唯一实例，所有 Hook 从 Context 获取同一引用
 */

import React, { createContext, useContext, useEffect, useState, useReducer } from 'react';
import { BuildingObjectManager } from '../../building/BuildingObjectManager';
import { WallDrawTool } from '../../building/WallDrawTool';
import { SelectionManager } from '../../interaction/SelectionManager';
import { useEngine } from '../hooks/useEngine';
import { useHistoryManager } from './HistoryContext';
import type { Engine } from '../../core/Engine';
import type { CommandHistoryManager } from '../../history/CommandHistoryManager';

/**
 * 建筑工具上下文值
 */
export interface BuildingContextValue {
  /** 建筑对象管理器（全局唯一实例） */
  objectManager: BuildingObjectManager | null;
  /** 墙体绘制工具（全局唯一实例） */
  drawTool: WallDrawTool | null;
  /**
   * 选中管理器（全局唯一实例）
   * V5 起上提到 BuildingProvider 层，让 PropertyBinding / Gizmo / StatusBar 等模块订阅同一份选中状态
   */
  selectionManager: SelectionManager | null;
  /** 对象总数（响应式） */
  objectCount: number;
  /** 工具状态版本号（每次绘制工具状态变更时递增，触发订阅者重渲染） */
  toolVersion: number;
}

/** Context 实例，默认 null */
const BuildingCtx: React.Context<BuildingContextValue | null> = createContext<BuildingContextValue | null>(null);

/**
 * 建筑工具 Provider
 * 必须放在 Canvas 内部（依赖 useEngine）
 */
export function BuildingProvider(props: { children: React.ReactNode }): React.ReactElement {
  const engine: Engine = useEngine();
  const historyManager: CommandHistoryManager = useHistoryManager();

  /** 持久化的管理器和工具实例 */
  const [objectManager, setObjectManager] = useState<BuildingObjectManager | null>(null);
  const [drawTool, setDrawTool] = useState<WallDrawTool | null>(null);
  /** 持久化的选中管理器实例（V5 上提） */
  const [selectionManager, setSelectionManager] = useState<SelectionManager | null>(null);

  /** 工具状态变更版本号（用于让 useDrawTool 取到最新的 currentMode 等） */
  const [toolVersion, incrementToolVersion] = useReducer((x: number): number => x + 1, 0);
  /** 对象变更版本号：增删改任意建筑对象时递增，用于驱动依赖对象数据的组件刷新。 */
  const [objectCount, setObjectCount] = useState<number>(0);

  /**
   * 引擎就绪时创建唯一的管理器和绘制工具实例
   */
  useEffect((): (() => void) => {
    /* 创建建筑对象管理器（依赖场景管理器） */
    const objMgr: BuildingObjectManager = new BuildingObjectManager(engine.sceneManager);

    /* 创建墙体绘制工具，并注入命令历史管理器，使墙体绘制支持撤销/重做。 */
    const tool: WallDrawTool = new WallDrawTool(objMgr, engine.sceneManager, historyManager);

    /* 创建选中管理器（V5 上提，让多模块共享） */
    const selMgr: SelectionManager = new SelectionManager(objMgr);
    /* 注入场景引用，供包围盒 Group 挂载到场景根节点 */
    selMgr.setScene(engine.sceneManager.getScene());

    /* 订阅事件以触发 React 重渲染 */
    const unsubTool: () => void = tool.onChange((): void => {
      incrementToolVersion();
    });
    const unsubObj: () => void = objMgr.onChange((): void => {
      /* 对象更新流程不一定改变总数，例如墙体拖拽刷新楼板 outline；此处递增版本号确保楼板、天花板和标注组件同步刷新。 */
      setObjectCount((currentVersion: number): number => currentVersion + 1);
    });

    /* 暴露给子组件 */
    setObjectManager(objMgr);
    setDrawTool(tool);
    setSelectionManager(selMgr);

    /* 暴露到 window 方便调试 */
    if (typeof window !== 'undefined') {
      (window as unknown as { __building: unknown }).__building = { objMgr: objMgr, tool: tool, selMgr: selMgr };
    }

    return (): void => {
      unsubTool();
      unsubObj();
      tool.dispose();
      /* 选中管理器先释放（避免 dispose 时仍引用已释放的 mesh） */
      selMgr.dispose();
      objMgr.dispose();
    };
  }, [engine, historyManager]);

  /** Context 值 */
  const value: BuildingContextValue = {
    objectManager: objectManager,
    drawTool: drawTool,
    selectionManager: selectionManager,
    objectCount: objectCount,
    toolVersion: toolVersion,
  };

  return <BuildingCtx.Provider value={value}>{props.children}</BuildingCtx.Provider>;
}

/**
 * 获取建筑工具上下文值
 * 必须在 BuildingProvider 内部使用
 */
export function useBuildingContext(): BuildingContextValue {
  const ctx: BuildingContextValue | null = useContext(BuildingCtx);
  if (ctx === null) {
    throw new Error('useBuildingContext 必须在 BuildingProvider 内部使用');
  }
  return ctx;
}
