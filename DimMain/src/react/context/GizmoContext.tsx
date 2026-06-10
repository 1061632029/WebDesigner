/**
 * Gizmo 变换工具 React Context
 * 创建并管理 TransformGizmo 实例的生命周期
 * 暴露 { mode, setMode, gizmo } 供 TopToolbar / 快捷键 Hook 消费
 *
 * 依赖层次：
 *   BuildingProvider → SelectionProvider → GizmoProvider → 子组件
 * GizmoProvider 必须在 BuildingProvider 与 HistoryProvider 内部使用
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { TransformGizmo } from '../../interaction/TransformGizmo';
import type { GizmoMode } from '../../interaction/TransformGizmo';
import { useEngine } from '../hooks/useEngine';
import { useBuildingContext } from './BuildingContext';
import { useHistoryManager } from './HistoryContext';
import type { Engine } from '../../core/Engine';
import type { BuildingContextValue } from './BuildingContext';
import type { CommandHistoryManager } from '../../history/CommandHistoryManager';
import type { SelectionManager } from '../../interaction/SelectionManager';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';

/**
 * GizmoContext 值类型
 */
export interface GizmoContextValue {
  /** 当前 Gizmo 工具模式 */
  mode: GizmoMode;
  /**
   * 切换 Gizmo 工具模式
   * @param mode - 目标模式
   */
  setMode: (mode: GizmoMode) => void;
  /**
   * TransformGizmo 实例（初始化完成前为 null）
   * 供需要直接操作 Gizmo 的场景使用
   */
  gizmo: TransformGizmo | null;
}

/** Context 实例 */
const GizmoCtx: React.Context<GizmoContextValue | null> = createContext<GizmoContextValue | null>(null);

/**
 * GizmoBridge：供 useDemoSetup 等外部模块通过 ref 调用 setMode
 * 避免 useDemoSetup 直接依赖 GizmoContext（它在 Canvas 外部）
 */
export interface GizmoBridge {
  /** setMode 的 ref，GizmoProvider 挂载后注入 */
  setModeRef: React.MutableRefObject<((mode: GizmoMode) => void) | null>;
}

/** GizmoBridge Context */
const GizmoBridgeCtx: React.Context<GizmoBridge | null> = createContext<GizmoBridge | null>(null);

/**
 * GizmoBridgeProvider Props
 */
export interface GizmoBridgeProviderProps {
  children: ReactNode;
}

/**
 * GizmoBridgeProvider
 * 必须放在 GizmoProvider 的外层（通常与 DrawToolBridgeProvider 同层）
 * 让 useDemoSetup 能通过 ref 调用 setMode
 */
export function GizmoBridgeProvider(props: GizmoBridgeProviderProps): React.ReactElement {
  const setModeRef: React.MutableRefObject<((mode: GizmoMode) => void) | null> =
    useRef<((mode: GizmoMode) => void) | null>(null);

  const bridge: GizmoBridge = { setModeRef: setModeRef };

  return <GizmoBridgeCtx.Provider value={bridge}>{props.children}</GizmoBridgeCtx.Provider>;
}

/**
 * 获取 GizmoBridge（供 useDemoSetup 调用）
 * @throws 不在 GizmoBridgeProvider 内调用时抛出
 */
export function useGizmoBridge(): GizmoBridge {
  const bridge: GizmoBridge | null = useContext(GizmoBridgeCtx);
  if (bridge === null) {
    throw new Error('useGizmoBridge 必须在 <GizmoBridgeProvider> 内调用');
  }
  return bridge;
}

/**
 * GizmoProvider Props
 */
export interface GizmoProviderProps {
  children: ReactNode;
}

/**
 * GizmoProvider 组件
 * 创建 TransformGizmo 实例，在 renderer 就绪后调用 init()
 * 必须在 BuildingProvider / SelectionProvider / HistoryProvider 内部
 */
export function GizmoProvider(props: GizmoProviderProps): React.ReactElement {
  const engine: Engine = useEngine();
  const buildingCtx: BuildingContextValue = useBuildingContext();
  const historyManager: CommandHistoryManager = useHistoryManager();

  const selectionManager: SelectionManager | null = buildingCtx.selectionManager;
  const objectManager: BuildingObjectManager | null = buildingCtx.objectManager;

  /** 响应式 Gizmo 模式（驱动 TopToolbar 高亮） */
  const [mode, setModeState] = useState<GizmoMode>('select');

  /**
   * 响应式 Gizmo 实例（驱动 useSelection 等消费者感知 gizmo 就绪）
   * 使用 state 而非 ref，确保 gizmo 创建后 Context 重渲染，消费者能获取到最新实例
   */
  const [gizmoState, setGizmoState] = useState<TransformGizmo | null>(null);

  /** TransformGizmo 实例引用（用于 setMode 等同步操作，避免闭包过期） */
  const gizmoRef = useRef<TransformGizmo | null>(null);

  /** 桥接 ref（可选，若 GizmoBridgeProvider 存在则注入） */
  const bridge: GizmoBridge | null = useContext(GizmoBridgeCtx);

  /**
   * 切换模式的稳定回调
   * 同时更新 React 状态（触发 TopToolbar 重渲）和 Gizmo 实例
   */
  const setMode = useCallback((newMode: GizmoMode): void => {
    setModeState(newMode);
    if (gizmoRef.current !== null) {
      gizmoRef.current.setMode(newMode);
    }
  }, []);

  /**
   * 当 selectionManager 与 objectManager 就绪时创建 TransformGizmo
   */
  useEffect((): (() => void) => {
    if (selectionManager === null || objectManager === null) {
      return (): void => {};
    }

    const scene = engine.sceneManager.getScene();
    const orbitControls = engine.cameraManager.getOrbitControls();

    if (orbitControls === null) {
      console.warn('[GizmoProvider] OrbitControlsWrapper 尚未就绪，跳过 Gizmo 创建');
      return (): void => {};
    }

    /* 创建 TransformGizmo 实例 */
    const gizmo: TransformGizmo = new TransformGizmo(
      scene,
      orbitControls,
      historyManager,
      selectionManager,
      objectManager
    );
    gizmoRef.current = gizmo;
    /* 更新响应式 state，触发 Context 重渲染，让消费者（如 useSelection）感知 gizmo 就绪 */
    setGizmoState(gizmo);

    /* 订阅 Gizmo 模式变更，同步到 React 状态 */
    const unsubMode: () => void = gizmo.onModeChange((m: GizmoMode): void => {
      setModeState(m);
    });

    /* 暴露到 window 方便调试 */
    if (typeof window !== 'undefined') {
      (window as unknown as { __gizmo: unknown }).__gizmo = gizmo;
    }

    console.log('[GizmoProvider] TransformGizmo 实例已创建，等待 renderer 就绪后 init');

    return (): void => {
      unsubMode();
      gizmo.dispose();
      gizmoRef.current = null;
      setGizmoState(null);
    };
  }, [selectionManager, objectManager, engine, historyManager]);

  /**
   * renderer 就绪后调用 init()（WebGPU 异步初始化，需轮询）
   */
  useEffect((): (() => void) => {
    const tryInit = (): boolean => {
      const gizmo: TransformGizmo | null = gizmoRef.current;
      if (gizmo === null || gizmo.initialized) {
        return true;
      }
      if (engine.renderer === null) {
        return false;
      }
      const camera = engine.cameraManager.getActiveCamera();
      const domElement: HTMLCanvasElement = engine.renderer.domElement;
      gizmo.init(camera, domElement);
      return true;
    };

    /* 立即尝试 */
    if (tryInit()) {
      return (): void => {};
    }

    /* 轮询直到 renderer 就绪 */
    const intervalId: ReturnType<typeof setInterval> = setInterval((): void => {
      if (tryInit()) {
        clearInterval(intervalId);
      }
    }, 100);

    return (): void => {
      clearInterval(intervalId);
    };
  }, [engine, selectionManager, objectManager]);

  /**
   * 将 setMode 注入桥接 ref（供 useDemoSetup 调用）
   */
  useEffect((): (() => void) => {
    if (bridge === null) {
      return (): void => {};
    }
    bridge.setModeRef.current = setMode;
    return (): void => {
      bridge.setModeRef.current = null;
    };
  }, [bridge, setMode]);

  /** Context 值：gizmo 使用响应式 state，确保 gizmo 创建后 Context 重渲染通知消费者 */
  const value: GizmoContextValue = {
    mode: mode,
    setMode: setMode,
    gizmo: gizmoState,
  };

  return <GizmoCtx.Provider value={value}>{props.children}</GizmoCtx.Provider>;
}

/**
 * 获取 Gizmo 上下文
 * @throws 不在 GizmoProvider 内调用时抛出
 */
export function useGizmoContext(): GizmoContextValue {
  const ctx: GizmoContextValue | null = useContext(GizmoCtx);
  if (ctx === null) {
    throw new Error('useGizmoContext 必须在 <GizmoProvider> 组件树内调用');
  }
  return ctx;
}
