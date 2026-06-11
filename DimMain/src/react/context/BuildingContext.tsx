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

import React, { createContext, useContext, useEffect, useState, useReducer, useCallback } from 'react';
import { BuildingObjectManager } from '../../building/BuildingObjectManager';
import { WallDrawTool } from '../../building/WallDrawTool';
import { SelectionManager } from '../../interaction/SelectionManager';
import { DoorWindowPlacementDimensionRenderer } from '../../model/DoorWindowPlacementDimensionRenderer';
import { StlPlacementDimensionRenderer } from '../../model/StlPlacementDimensionRenderer';
import { useEngine } from '../hooks/useEngine';
import { useHistoryManager } from './HistoryContext';
import type { Engine } from '../../core/Engine';
import type { CommandHistoryManager } from '../../history/CommandHistoryManager';

/**
 * 全局交互模式。
 * select 表示选择工具可工作；其他模式表示由对应工具独占鼠标交互。
 */
export type InteractionMode = 'select' | 'draw' | 'stl-place';

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
  /**
   * 门窗沿墙距离标注渲染器（全局唯一实例）
   * 选择编辑与 Gizmo 拖拽共用同一对象池，避免编辑标注时重复新增动态标注。
   */
  doorWindowDimensionRenderer: DoorWindowPlacementDimensionRenderer | null;
  /**
   * 普通 STL 四方向距离标注渲染器（全局唯一实例）
   * 选择编辑与拖拽刷新共用同一对象池，避免编辑标注时重复新增动态标注。
   */
  stlPlacementDimensionRenderer: StlPlacementDimensionRenderer | null;
  /** 对象总数（响应式） */
  objectCount: number;
  /** 工具状态版本号（每次绘制工具状态变更时递增，触发订阅者重渲染） */
  toolVersion: number;
  /** 当前全局交互模式，用于统一控制选择、绘制、模型布置等互斥交互。 */
  interactionMode: InteractionMode;
  /**
   * 设置全局交互模式。
   * @param mode - 目标交互模式
   */
  setInteractionMode: (mode: InteractionMode) => void;
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
  /** 持久化的门窗标注渲染器实例，供选择编辑与 Gizmo 拖拽共享。 */
  const [doorWindowDimensionRenderer, setDoorWindowDimensionRenderer] =
    useState<DoorWindowPlacementDimensionRenderer | null>(null);
  /** 持久化的普通 STL 标注渲染器实例，供选择编辑与拖拽刷新共享。 */
  const [stlPlacementDimensionRenderer, setStlPlacementDimensionRenderer] =
    useState<StlPlacementDimensionRenderer | null>(null);

  /** 工具状态变更版本号（用于让 useDrawTool 取到最新的 currentMode 等） */
  const [toolVersion, incrementToolVersion] = useReducer((x: number): number => x + 1, 0);
  /** 全局交互模式：选择工具仅在 select 模式启用，其他工具模式统一禁用选择预选中检测。 */
  const [interactionMode, setInteractionModeState] = useState<InteractionMode>('select');
  /** 对象变更版本号：增删改任意建筑对象时递增，用于驱动依赖对象数据的组件刷新。 */
  const [objectCount, setObjectCount] = useState<number>(0);

  /**
   * 设置全局交互模式。
   * @param mode - 目标交互模式
   */
  const setInteractionMode = useCallback((mode: InteractionMode): void => {
    setInteractionModeState(mode);
  }, []);

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

    /* 创建全局唯一门窗沿墙距离标注渲染器，保证编辑标注时更新已有标注而不是新增动态标注。 */
    const doorWindowDimRenderer: DoorWindowPlacementDimensionRenderer = new DoorWindowPlacementDimensionRenderer();
    /* 创建全局唯一普通 STL 四方向距离标注渲染器，保证编辑标注时更新已有标注而不是新增动态标注。 */
    const stlPlacementDimRenderer: StlPlacementDimensionRenderer = new StlPlacementDimensionRenderer();

    /* 订阅事件以触发 React 重渲染 */
    const unsubTool: () => void = tool.onChange((): void => {
      incrementToolVersion();
      /* 墙/梁绘制工具的内部状态变化统一同步到全局交互模式，避免选择工具与绘制工具抢占鼠标事件。 */
      setInteractionModeState((currentMode: InteractionMode): InteractionMode => {
        if (tool.mode !== 'none') {
          return 'draw';
        }
        if (currentMode === 'draw') {
          return 'select';
        }
        return currentMode;
      });
    });
    const unsubObj: () => void = objMgr.onChange((): void => {
      /* 对象更新流程不一定改变总数，例如墙体拖拽刷新楼板 outline；此处递增版本号确保楼板、天花板和标注组件同步刷新。 */
      setObjectCount((currentVersion: number): number => currentVersion + 1);
    });

    /* 暴露给子组件 */
    setObjectManager(objMgr);
    setDrawTool(tool);
    setSelectionManager(selMgr);
    setDoorWindowDimensionRenderer(doorWindowDimRenderer);
    setStlPlacementDimensionRenderer(stlPlacementDimRenderer);

    /* 暴露到 window 方便调试 */
    if (typeof window !== 'undefined') {
      (window as unknown as { __building: unknown }).__building = {
        objMgr: objMgr,
        tool: tool,
        selMgr: selMgr,
        doorWindowDimRenderer: doorWindowDimRenderer,
        stlPlacementDimRenderer: stlPlacementDimRenderer,
      };
    }

    return (): void => {
      unsubTool();
      unsubObj();
      tool.dispose();
      /* 选中管理器先释放（避免 dispose 时仍引用已释放的 mesh） */
      selMgr.dispose();
      doorWindowDimRenderer.dispose(engine.sceneManager.getScene());
      stlPlacementDimRenderer.dispose(engine.sceneManager.getScene());
      objMgr.dispose();
    };
  }, [engine, historyManager]);

  /** Context 值 */
  const value: BuildingContextValue = {
    objectManager: objectManager,
    drawTool: drawTool,
    selectionManager: selectionManager,
    doorWindowDimensionRenderer: doorWindowDimensionRenderer,
    stlPlacementDimensionRenderer: stlPlacementDimensionRenderer,
    objectCount: objectCount,
    toolVersion: toolVersion,
    interactionMode: interactionMode,
    setInteractionMode: setInteractionMode,
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
