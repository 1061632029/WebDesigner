/**
 * useSelection Hook（V5 重构版）
 * - 不再自创建 SelectionManager；从 BuildingContext 读取唯一实例
 * - 仍负责创建 SelectionTool（绑定 Canvas DOM 与相机的拾取交互）
 * - 选中状态变化由 SelectionContext 暴露；本 Hook 仅提供 SelectionTool 生命周期 +
 *   兼容旧调用方的便捷封装（selectedIds / deleteSelected / clearSelection）
 * 注意：框选功能已移除，仅保留点选和键盘操作
 * V6 修复：视图模式切换（2D/3D）时相机实例会变更，需重新绑定 SelectionTool 的相机引用
 */

import { useEffect, useRef, useCallback } from 'react';
import { useEngine } from './useEngine';
import { useBuildingContext } from '../context/BuildingContext';
import { useSelectionContext } from '../context/SelectionContext';
import { useHistoryManager } from '../context/HistoryContext';
import { useViewMode } from '../context/ViewModeContext';
import { useGizmoContext } from '../context/GizmoContext';
import { SelectionTool } from '../../interaction/SelectionTool';
import type { SelectionManager } from '../../interaction/SelectionManager';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';
import type { Engine } from '../../core/Engine';
import type { BuildingContextValue } from '../context/BuildingContext';
import type { WallDrawTool } from '../../building/WallDrawTool';
import type { SelectionContextValue } from '../context/SelectionContext';
import type { CommandHistoryManager } from '../../history/CommandHistoryManager';
import type { ViewMode } from '../context/ViewModeContext';
import type { GizmoContextValue } from '../context/GizmoContext';
import type { TransformGizmo } from '../../interaction/TransformGizmo';
import type { Object3D } from 'three';

/**
 * useSelection 返回值
 */
export interface UseSelectionResult {
  /** 当前选中的对象 ID 数组 */
  selectedIds: ReadonlyArray<string>;
  /** 当前选中对象数量 */
  selectedCount: number;
  /** 删除所有选中对象 */
  deleteSelected: () => void;
  /** 清空选择 */
  clearSelection: () => void;
}

/**
 * 选择工具 Hook
 * 与绘制工具共享同一个 BuildingObjectManager 与 SelectionManager
 */
export function useSelection(): UseSelectionResult {
  const engine: Engine = useEngine();
  const ctx: BuildingContextValue = useBuildingContext();
  const selectionCtx: SelectionContextValue = useSelectionContext();
  const historyManager: CommandHistoryManager = useHistoryManager();

  const objectManager: BuildingObjectManager | null = ctx.objectManager;
  const drawTool: WallDrawTool | null = ctx.drawTool;
  /** V5：SelectionManager 从 BuildingContext 读取，不再 Hook 内创建 */
  const selectionManager: SelectionManager | null = ctx.selectionManager;
  /** 通过 toolVersion 让 useEffect 感知 drawTool.mode 的变更 */
  const toolVersion: number = ctx.toolVersion;

  /** V6：监听视图模式，视图切换时相机实例会变更，需重新绑定 SelectionTool */
  const { viewMode }: { viewMode: ViewMode } = useViewMode();

  /** SelectionTool 的引用（Hook 内创建，与 Canvas/相机生命周期挂钩） */
  const selectionToolRef = useRef<SelectionTool | null>(null);

  /**
   * 获取 GizmoContext（GizmoProvider 在 SelectionHandler 的外层，此处可安全调用）
   * 用于在 Gizmo 初始化完成后将 Helper 注入 SelectionTool，避免拖拽 Gizmo 时误清空选择
   */
  const gizmoCtx: GizmoContextValue = useGizmoContext();
  const gizmo: TransformGizmo | null = gizmoCtx.gizmo;

  /**
   * 三个管理器都就绪时创建 SelectionTool
   * 创建完成后立即尝试注入 Gizmo Helper（若 gizmo 已初始化）
   * 若 gizmo 尚未初始化，启动轮询等待 init() 完成后再注入
   */
  useEffect((): (() => void) => {
    if (objectManager === null || selectionManager === null) {
      return (): void => {};
    }

    /* 创建选择交互工具（传入 sceneManager 支持 STL 拾取，传入 historyManager 支持删除撤销/重做） */
    const selTool: SelectionTool = new SelectionTool(
      selectionManager,
      objectManager,
      engine.sceneManager,
      historyManager
    );
    selectionToolRef.current = selTool;

    /* 注入建筑对象管理器（用于 2D 模式下拖拽时收集包围盒吸附目标：墙体 Mesh） */
    selTool.setBuildingManager(objectManager);

    /* 暴露到 window 方便调试 */
    if (typeof window !== 'undefined') {
      (window as unknown as { __selection: unknown }).__selection = {
        selMgr: selectionManager,
        selTool: selTool,
      };
    }

    console.log('[useSelection] SelectionTool 已创建（复用 ctx 提供的 SelectionManager）');

    /* 注入 Gizmo Helper：避免拖拽 Gizmo 轴/轮盘时误清空选择
     * gizmo 可能在 SelectionTool 创建时已初始化（立即注入）
     * 也可能尚未初始化（轮询等待 renderer 就绪后 init() 完成）
     */
    let gizmoHelperIntervalId: ReturnType<typeof setInterval> | null = null;
    if (gizmo !== null) {
      if (gizmo.initialized) {
        /* 立即注入 */
        const helper: Object3D | null = gizmo.getHelper();
        selTool.setGizmoHelper(helper);
        console.log('[useSelection] Gizmo Helper 已注入 SelectionTool');
      } else {
        /* 轮询等待 gizmo.initialized */
        gizmoHelperIntervalId = setInterval((): void => {
          if (gizmo.initialized) {
            if (gizmoHelperIntervalId !== null) {
              clearInterval(gizmoHelperIntervalId);
              gizmoHelperIntervalId = null;
            }
            const helper: Object3D | null = gizmo.getHelper();
            selTool.setGizmoHelper(helper);
            console.log('[useSelection] Gizmo Helper 已注入 SelectionTool（轮询就绪）');
          }
        }, 100);
      }
    }

    return (): void => {
      /* 清理 Gizmo Helper 轮询 */
      if (gizmoHelperIntervalId !== null) {
        clearInterval(gizmoHelperIntervalId);
      }
      selTool.setGizmoHelper(null);
      selTool.dispose();
      selectionToolRef.current = null;
    };
  }, [objectManager, selectionManager, historyManager, engine.sceneManager, gizmo]);

  /**
   * 根据绘制模式自动启用/禁用选择工具
   * - drawTool.mode === 'none' 且 renderer 就绪 → 启用选择
   * - 其他 → 禁用选择（避免与绘制冲突）
   *
   * V5 优化：依然保留 setInterval 轮询（WebGPU renderer 异步初始化）；
   * 当 ctx.objectManager 与 selectionManager 已 ready 时此 effect 才会运行
   */
  useEffect((): (() => void) => {
    const selTool: SelectionTool | null = selectionToolRef.current;

    if (selTool === null || drawTool === null || selectionManager === null) {
      return (): void => {};
    }

    const currentMode: string = drawTool.mode;

    /** 延迟刷新相机的定时器 ID（用于清理） */
    let cameraRefreshTimerId: ReturnType<typeof setTimeout> | null = null;

    /**
     * 应用启用/禁用逻辑
     * @returns true 表示 renderer 已就绪并完成处理，false 表示 renderer 尚未就绪需继续轮询
     */
    const applyState = (): boolean => {
      /* renderer 尚未就绪，先返回 false 让外层继续轮询 */
      if (engine.renderer === null) {
        return false;
      }

      if (currentMode === 'none') {
        /* 视图切换后相机实例已变更，需先 disable 再重新 enable 以绑定新相机 */
        if (selTool.enabled) {
          selTool.disable();
        }
        const camera = engine.cameraManager.getActiveCamera();
        const domElement: HTMLCanvasElement = engine.renderer.domElement;
        selTool.enable(camera, domElement);
        console.log('[useSelection] 选择工具已启用，绑定到 Canvas（相机已刷新）');

        /*
         * 延迟一帧再次刷新相机引用
         * 原因：Camera.tsx 组件的 useEffect 与本 effect 在同一渲染周期执行，
         * 顺序不确定，可能导致 enable() 时 cameraManager 尚未切换到新相机实例。
         * setTimeout(0) 确保在所有同周期 effect 执行完毕后，取到最新相机。
         */
        cameraRefreshTimerId = setTimeout((): void => {
          if (selTool.enabled && engine.renderer !== null) {
            const latestCamera = engine.cameraManager.getActiveCamera();
            selTool.updateCamera(latestCamera);
            console.log('[useSelection] 相机引用已延迟刷新（视图模式切换后）');
          }
        }, 0);
      } else {
        /* 进入绘制模式：禁用选择并清空已选 */
        if (selTool.enabled) {
          selTool.disable();
          console.log('[useSelection] 选择工具已禁用（进入绘制模式）');
        }
        selectionManager.clearSelection();
      }
      return true;
    };

    /* 立即尝试一次 */
    const success: boolean = applyState();

    /* 如果 renderer 尚未就绪，启动轮询直到就绪 */
    if (success) {
      return (): void => {
        /* 清理延迟刷新定时器 */
        if (cameraRefreshTimerId !== null) {
          clearTimeout(cameraRefreshTimerId);
        }
      };
    }

    const intervalId: ReturnType<typeof setInterval> = setInterval((): void => {
      if (applyState()) {
        clearInterval(intervalId);
      }
    }, 100);

    return (): void => {
      clearInterval(intervalId);
      /* 清理延迟刷新定时器 */
      if (cameraRefreshTimerId !== null) {
        clearTimeout(cameraRefreshTimerId);
      }
    };
  }, [drawTool, engine, toolVersion, selectionManager, viewMode]);

  /**
   * 视图模式变化时同步到 SelectionTool
   * 确保 STL 选中时包围盒显示逻辑与当前视图模式一致
   */
  useEffect((): void => {
    const selTool: SelectionTool | null = selectionToolRef.current;
    if (selTool !== null) {
      selTool.setViewMode(viewMode);
    }
  }, [viewMode]);

  /**
   * 删除所有选中对象（通过命令栈，支持撤销/重做）
   * 同时处理建筑对象和 STL 模型的删除
   */
  const deleteSelected = useCallback((): void => {
    if (selectionManager === null) {
      return;
    }

    /* 优先删除建筑对象 */
    if (selectionManager.hasSelection) {
      selectionManager.deleteSelected(historyManager);
      return;
    }

    /* 删除 STL 模型（门窗类型同时还原墙体洞口） */
    if (selectionManager.selectedStlMesh !== null) {
      const scene = engine.sceneManager.getScene();
      selectionManager.deleteSelectedStl(scene, historyManager, objectManager);
    }
  }, [selectionManager, historyManager, engine.sceneManager]);

  /**
   * 清空选择
   */
  const clearSelection = useCallback((): void => {
    if (selectionManager !== null) {
      selectionManager.clearSelection();
    }
  }, [selectionManager]);

  /** 兼容旧接口：从 SelectionContext 派生 selectedIds 数组 */
  const selectedIds: ReadonlyArray<string> = selectionCtx.selected.map((obj) => obj.id);

  return {
    selectedIds: selectedIds,
    selectedCount: selectionCtx.count,
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
  };
}
