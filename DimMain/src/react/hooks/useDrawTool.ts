/**
 * useDrawTool Hook
 * 从 BuildingContext 获取共享的绘制工具和对象管理器实例
 * 提供响应式的当前模式、预览长度、对象数量等状态
 *
 * 注意：管理器和工具的生命周期由 BuildingProvider 统一管理
 */

import { useCallback } from 'react';
import * as THREE from 'three/webgpu';
import { useEngine } from './useEngine';
import { useBuildingContext } from '../context/BuildingContext';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';
import type { WallDrawTool } from '../../building/WallDrawTool';
import type { DrawToolMode } from '../../building/BuildingTypes';
import type { Engine } from '../../core/Engine';
import type { BuildingContextValue } from '../context/BuildingContext';

/**
 * useDrawTool 返回值接口
 */
export interface UseDrawToolResult {
  /** 绘制工具实例（用于读取状态） */
  drawTool: WallDrawTool | null;
  /** 建筑对象管理器实例 */
  objectManager: BuildingObjectManager | null;
  /** 激活绘制模式 */
  activateMode: (mode: DrawToolMode) => void;
  /** 停用绘制工具 */
  deactivate: () => void;
  /** 当前模式 */
  currentMode: DrawToolMode;
  /** 预览墙体长度（米） */
  previewLength: number;
  /** 对象总数 */
  objectCount: number;
}

/**
 * 墙体绘制工具 Hook
 * 从 BuildingContext 获取共享实例（与 SelectionTool 共用同一个 BuildingObjectManager）
 */
export function useDrawTool(): UseDrawToolResult {
  const engine: Engine = useEngine();
  const ctx: BuildingContextValue = useBuildingContext();

  const { drawTool, objectManager, objectCount }: BuildingContextValue = ctx;

  /**
   * 激活绘制模式
   * 注入当前相机和 Canvas DOM 元素
   */
  const activateMode = useCallback((mode: DrawToolMode): void => {
    if (drawTool === null || engine.renderer === null) {
      return;
    }
    /* 传入相机获取函数（而非固定相机实例），确保视图切换后始终使用最新相机 */
    const getCameraFn: () => THREE.Camera = (): THREE.Camera => engine.cameraManager.getActiveCamera();
    const domElement: HTMLCanvasElement = engine.renderer.domElement;
    drawTool.activate(mode, getCameraFn, domElement);
  }, [drawTool, engine]);

  /**
   * 停用绘制工具
   */
  const deactivate = useCallback((): void => {
    if (drawTool !== null) {
      drawTool.deactivate();
    }
  }, [drawTool]);

  return {
    drawTool: drawTool,
    objectManager: objectManager,
    activateMode: activateMode,
    deactivate: deactivate,
    currentMode: drawTool !== null ? drawTool.mode : 'none',
    previewLength: drawTool !== null ? drawTool.previewLength : 0,
    objectCount: objectCount,
  };
}
