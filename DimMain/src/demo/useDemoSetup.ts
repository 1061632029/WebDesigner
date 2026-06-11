/**
 * Demo 面板数据注册 Hook
 * 在 AppShell 内部使用，向 PanelManager 注册示例导航、面板、工具栏和属性数据
 * V5：接入 GizmoBridge，工具栏 select/move/rotate/scale 按钮调用 setMode
 */

import { useEffect } from 'react';
import * as THREE from 'three/webgpu';
import { usePanelManager } from '../react/hooks/usePanel';
import { useDrawToolBridge } from '../react/context/DrawToolContext';
import { useGizmoBridge } from '../react/context/GizmoContext';
import { useFitSceneBridge } from '../react/context/FitSceneContext';
import { useClearSceneBridge } from '../react/context/ClearSceneContext';
import { useStlPlaceBridge } from '../react/context/StlPlaceContext';
import { useViewMode } from '../react/context/ViewModeContext';
import { useHistoryContext } from '../react/context/HistoryContext';
import type { ViewModeContextValue } from '../react/context/ViewModeContext';
import type { PanelManager } from '../panel/PanelManager';
import type { DrawToolBridge } from '../react/context/DrawToolContext';
import type { GizmoBridge } from '../react/context/GizmoContext';
import type { FitSceneBridge } from '../react/context/FitSceneContext';
import type { ClearSceneBridge } from '../react/context/ClearSceneContext';
import type { StlPlaceBridge } from '../react/context/StlPlaceContext';
import type { DrawToolMode } from '../building/BuildingTypes';
import type { GizmoMode } from '../interaction/TransformGizmo';
import type { CommandHistoryManager } from '../history/CommandHistoryManager';
import type { HistoryState } from '../history/HistoryTypes';

/**
 * Gizmo 模式到工具栏按钮 ID 的映射
 */
const GIZMO_MODE_BUTTON_MAP: Record<GizmoMode, string> = {
  select: 'tb-select',
  move: 'tb-move',
  rotate: 'tb-rotate',
  scale: 'tb-scale',
};

/**
 * 注册示例面板数据
 * 模拟三维家风格的侧边导航 + 左侧面板 + 工具栏 + 右侧属性
 */
export function useDemoSetup(): void {
  const panelManager: PanelManager = usePanelManager();
  const bridge: DrawToolBridge = useDrawToolBridge();
  const gizmoBridge: GizmoBridge = useGizmoBridge();
  const fitSceneBridge: FitSceneBridge = useFitSceneBridge();
  const clearSceneBridge: ClearSceneBridge = useClearSceneBridge();
  const stlPlaceBridge: StlPlaceBridge = useStlPlaceBridge();
  const historyContext: { manager: CommandHistoryManager; state: HistoryState } = useHistoryContext();
  const historyManager: CommandHistoryManager = historyContext.manager;
  const historyState: HistoryState = historyContext.state;
  /** 视图模式上下文：布置行为触发时强制切换到 2D */
  const { setViewMode }: ViewModeContextValue = useViewMode();

  useEffect(() => {
    /**
     * 通过桥接上下文激活绘制模式
     * 布置前强制切换到 2D 视图，确保所有绘制行为在俯视平面图环境下进行
     * 桥接回调在 Canvas 内部的 DrawToolStatusBar 组件中注册
     */
    const triggerDrawMode = (mode: DrawToolMode): void => {
      /* 激活墙/梁/矩形墙布置前，先取消 STL 点式布置，保证同一时刻只有一种布置行为。 */
      if (stlPlaceBridge.deactivatePlaceRef.current !== null) {
        stlPlaceBridge.deactivatePlaceRef.current();
      }

      /* 强制切换到 2D 俯视模式 */
      setViewMode('2d');
      if (bridge.activateModeRef.current !== null) {
        bridge.activateModeRef.current(mode);
      } else {
        console.warn(`绘制工具尚未就绪，无法激活模式: ${mode}`);
      }
    };

    /**
     * 通过 FitSceneBridge 触发自适应场景
     * @param directionVector - 相机相对于场景中心的方向向量
     */
    const triggerFitScene = (directionVector: THREE.Vector3): void => {
      if (fitSceneBridge.fitToViewRef.current !== null) {
        fitSceneBridge.fitToViewRef.current(directionVector);
      } else {
        console.warn('[useDemoSetup] 自适应场景工具尚未就绪');
      }
    };

    /**
     * 通过 ClearSceneBridge 触发清空场景
     * Canvas 内部的 ClearSceneHandler 会将真实命令注册到桥接引用。
     */
    const triggerClearScene = (): void => {
      if (clearSceneBridge.clearSceneRef.current !== null) {
        const cleared: boolean = clearSceneBridge.clearSceneRef.current();
        if (!cleared) {
          console.warn('[useDemoSetup] 当前没有可清空的场景模型');
        }
      } else {
        console.warn('[useDemoSetup] 清空场景工具尚未就绪');
      }
    };

    /**
     * 通过 GizmoBridge 切换 Gizmo 模式，并同步更新工具栏高亮态
     * @param mode - 目标 Gizmo 模式
     */
    const triggerGizmoMode = (mode: GizmoMode): void => {
      /* 调用 GizmoProvider 注入的 setMode */
      if (gizmoBridge.setModeRef.current !== null) {
        gizmoBridge.setModeRef.current(mode);
      } else {
        console.warn(`Gizmo 工具尚未就绪，无法切换模式: ${mode}`);
      }
      /* 同步更新 PanelManager 的激活工具栏 ID，驱动 TopToolbar 高亮 */
      panelManager.setActiveToolbarId(GIZMO_MODE_BUTTON_MAP[mode]);
    };

    /* ========== 侧边导航项 ========== */
    panelManager.addNav({ id: 'model', icon: '📦', label: '模型', order: 1, panelId: 'panel-model' });
    panelManager.addNav({ id: 'scene', icon: '🌍', label: '场景', order: 2, panelId: 'panel-scene' });
    /* 隐藏左侧菜单中的材质、灯光和工具入口；对应面板数据保留，避免影响后续功能恢复。 */
    /* 截图按钮：即时操作，无关联面板，点击直接从 DOM canvas 截图并下载 */
    panelManager.addNav({
      id: 'screenshot',
      icon: '📸',
      label: '截图',
      order: 99,
      panelId: null,
      action: (): void => {
        /* 截图前向用户确认是否保存当前场景图片，取消时中断后续下载流程。 */
        const shouldSaveScreenshot: boolean = window.confirm('是否保存当前场景图片');
        if (!shouldSaveScreenshot) {
          return;
        }

        /* 直接从 DOM 获取 canvas 元素，无需 EngineContext */
        const canvas: HTMLCanvasElement | null = document.querySelector('canvas');
        if (canvas === null) {
          console.warn('[截图] 找不到 canvas 元素');
          return;
        }
        const filename: string = `dim-screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        const dataUrl: string = canvas.toDataURL('image/png');
        const link: HTMLAnchorElement = document.createElement('a');
        link.href = dataUrl;
        link.download = `${filename}.png`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log(`📸 截图已下载：${filename}.png`);
      },
    });

    /* ========== 左侧功能面板 ========== */
    const noop = (): void => { console.log('操作触发'); };

    panelManager.addLeftPanel({
      id: 'panel-model',
      title: '模型库',
      groups: [
        {
          title: '基础几何体',
          items: [
            // { id: 'box', icon: '⬜', label: '立方体', shortcut: 'Alt+1', action: noop },
            // { id: 'sphere', icon: '⚪', label: '球体', shortcut: 'Alt+2', action: noop },
            // { id: 'cylinder', icon: '🔵', label: '圆柱体', action: noop },
            // { id: 'torus', icon: '🟡', label: '圆环', action: noop },
            // { id: 'cone', icon: '🔺', label: '圆锥', action: noop },
            // { id: 'plane', icon: '▬', label: '平面', action: noop },
            { id: 'straight-wall', icon: '📏', label: '直墙', shortcut: 'W', action: (): void => triggerDrawMode('straight-wall') },
            { id: 'beam', icon: '▬', label: '梁', shortcut: 'B', action: (): void => triggerDrawMode('beam') },
            { id: 'arc-wall', icon: '🌙', label: '弧形墙', action: (): void => triggerDrawMode('arc-wall') },
            { id: 'rect-wall', icon: '🔲', label: '矩形墙', action: (): void => triggerDrawMode('rect-wall') },
          ],
        },
      ],
    });

    panelManager.addLeftPanel({
      id: 'panel-scene',
      title: '场景树',
      groups: [
        {
          title: '当前场景',
          items: [
            // { id: 'scene-root', icon: '🌐', label: '根节点', action: noop },
            { id: 'scene-camera', icon: '📷', label: '主相机', action: noop },
            { id: 'scene-light', icon: '💡', label: '灯光组', action: noop },
            { id: 'scene-mesh', icon: '📦', label: '几何组', action: noop },
          ],
        },
        {
          title: '自适应场景',
          items: [
            /* 前景：从 Z+ 方向看向原点 */
            { id: 'fit-front',      icon: '🔄', label: '前景',       action: (): void => triggerFitScene(new THREE.Vector3(0, 0, 1)) },
            /* 后景：从 Z- 方向看向原点 */
            { id: 'fit-back',       icon: '🔄', label: '后景',       action: (): void => triggerFitScene(new THREE.Vector3(0, 0, -1)) },
            /* 左景：从 X+ 方向看向原点 */
            { id: 'fit-left',       icon: '🔄', label: '左景',       action: (): void => triggerFitScene(new THREE.Vector3(1, 0, 0)) },
            /* 右景：从 X- 方向看向原点 */
            { id: 'fit-right',      icon: '🔄', label: '右景',       action: (): void => triggerFitScene(new THREE.Vector3(-1, 0, 0)) },
            /* 前景左斜 45°：从 X- Z+ 方向看向原点 */
            { id: 'fit-front-left', icon: '🔄', label: '前景左斜45°', action: (): void => triggerFitScene(new THREE.Vector3(-1, 0, 1)) },
            /* 前景右斜 45°：从 X+ Z+ 方向看向原点 */
            { id: 'fit-front-right',icon: '🔄', label: '前景右斜45°', action: (): void => triggerFitScene(new THREE.Vector3(1, 0, 1)) },
            /* 前景俯视 45°：从 Y+ Z+ 方向看向原点 */
            { id: 'fit-front-top',  icon: '🔄', label: '前景俯视45°', action: (): void => triggerFitScene(new THREE.Vector3(0, 1, 1)) },
            /* 前景仰视 45°：从 Y- Z+ 方向看向原点 */
            { id: 'fit-front-bot',  icon: '🔄', label: '前景仰视45°', action: (): void => triggerFitScene(new THREE.Vector3(0, -1, 1)) },
          ],
        },
      ],
    });

    panelManager.addLeftPanel({
      id: 'panel-material',
      title: '材质库',
      groups: [
        {
          title: '预设材质',
          items: [
            { id: 'mat-metal', icon: '🔩', label: '金属', action: noop },
            { id: 'mat-wood', icon: '🪵', label: '木纹', action: noop },
            { id: 'mat-glass', icon: '💎', label: '玻璃', action: noop },
            { id: 'mat-plastic', icon: '🧊', label: '塑料', action: noop },
          ],
        },
      ],
    });

    panelManager.addLeftPanel({
      id: 'panel-light',
      title: '灯光管理',
      groups: [
        {
          title: '添加灯光',
          items: [
            { id: 'add-ambient', icon: '☀️', label: '环境光', action: noop },
            { id: 'add-directional', icon: '🌤️', label: '平行光', action: noop },
            { id: 'add-point', icon: '💡', label: '点光源', action: noop },
            { id: 'add-spot', icon: '🔦', label: '聚光灯', action: noop },
          ],
        },
      ],
    });

    panelManager.addLeftPanel({
      id: 'panel-tool',
      title: '工具箱',
      groups: [
        {
          title: '测量',
          items: [
            { id: 'measure-dist', icon: '📏', label: '距离', action: noop },
            { id: 'measure-angle', icon: '📐', label: '角度', action: noop },
          ],
        },
        {
          title: '布尔运算',
          items: [
            { id: 'bool-union', icon: '➕', label: '并集', action: noop },
            { id: 'bool-subtract', icon: '➖', label: '差集', action: noop },
            { id: 'bool-intersect', icon: '✖️', label: '交集', action: noop },
          ],
        },
      ],
    });

    /* ========== 顶部工具栏（V5：select/move/rotate/scale 接入 GizmoBridge） ========== */
    panelManager.addToolbarItem({
      id: 'tb-select',
      icon: '🖱️',
      label: '选择',
      shortcut: 'Q',
      order: 1,
      disabled: false,
      action: (): void => triggerGizmoMode('select'),
    });

    panelManager.addToolbarItem({
      id: 'tb-clear-scene',
      icon: '🧹',
      label: '清空',
      shortcut: '清空场景内所有模型',
      order: 9,
      disabled: false,
      action: (): void => {
        /* 清空场景属于不可忽略的批量操作，执行前先确认；取消时中断后续清空流程。 */
        const shouldClearScene: boolean = window.confirm('是否清空当前场景内所有模型？');
        if (!shouldClearScene) {
          return;
        }

        /* 用户确认后，委托 Canvas 内部命令处理器创建可撤销清空命令。 */
        triggerClearScene();
      },
    });
    // panelManager.addToolbarItem({
    //   id: 'tb-move',
    //   icon: '↔️',
    //   label: '移动',
    //   shortcut: 'G',
    //   order: 2,
    //   disabled: false,
    //   action: (): void => triggerGizmoMode('move'),
    // });
    // panelManager.addToolbarItem({
    //   id: 'tb-rotate',
    //   icon: '🔄',
    //   label: '旋转',
    //   shortcut: 'R',
    //   order: 3,
    //   disabled: false,
    //   action: (): void => triggerGizmoMode('rotate'),
    // });
    // panelManager.addToolbarItem({
    //   id: 'tb-scale',
    //   icon: '📐',
    //   label: '缩放',
    //   shortcut: 'S',
    //   order: 4,
    //   disabled: false,
    //   action: (): void => triggerGizmoMode('scale'),
    // });
    /* 初始激活"选择"模式按钮 */
    panelManager.setActiveToolbarId('tb-select');

    /* ========== 右侧属性面板 ========== */
    panelManager.setPropertyGroups([
      {
        title: '变换',
        expanded: true,
        items: [
          { id: 'pos-x', type: 'number', label: 'X 位置', value: 0, unit: 'mm', step: 0.1, onChange: (v: number) => console.log('posX:', v) },
          { id: 'pos-y', type: 'number', label: 'Y 位置', value: 0.5, unit: 'mm', step: 0.1, onChange: (v: number) => console.log('posY:', v) },
          { id: 'pos-z', type: 'number', label: 'Z 位置', value: 0, unit: 'mm', step: 0.1, onChange: (v: number) => console.log('posZ:', v) },
        ],
      },
      {
        title: '材质',
        expanded: true,
        items: [
          { id: 'color', type: 'color', label: '颜色', value: '#4488ff', onChange: (v: string) => console.log('color:', v) },
          { id: 'metalness', type: 'slider', label: '金属度', min: 0, max: 1, step: 0.01, value: 0.8, onChange: (v: number) => console.log('metalness:', v) },
          { id: 'roughness', type: 'slider', label: '粗糙度', min: 0, max: 1, step: 0.01, value: 0.2, onChange: (v: number) => console.log('roughness:', v) },
          { id: 'wireframe', type: 'toggle', label: '线框模式', value: false, onChange: (v: boolean) => console.log('wireframe:', v) },
        ],
      },
      {
        title: '渲染',
        expanded: false,
        items: [
          { id: 'shadows', type: 'toggle', label: '阴影', value: true, onChange: (v: boolean) => console.log('shadows:', v) },
          { id: 'tone-mapping', type: 'select', label: '色调映射', value: 'aces', options: [
            { label: 'ACES', value: 'aces' },
            { label: 'Reinhard', value: 'reinhard' },
            { label: 'Linear', value: 'linear' },
          ], onChange: (v: string) => console.log('toneMapping:', v) },
        ],
      },
    ]);
  }, [panelManager, bridge, stlPlaceBridge, setViewMode]);

  useEffect((): void => {
    /**
     * 根据命令历史栈刷新撤销/重做按钮状态。
     * 关键逻辑：撤销栈为空时撤销按钮置灰，重做栈为空时重做按钮置灰；点击时调用真实历史命令。
     */
    const undoShortcut: string = historyState.undoLabel !== null
      ? `Ctrl+Z：${historyState.undoLabel}`
      : 'Ctrl+Z';
    const redoShortcut: string = historyState.redoLabel !== null
      ? `Ctrl+Y：${historyState.redoLabel}`
      : 'Ctrl+Y';

    panelManager.addToolbarItem({
      id: 'tb-undo',
      icon: '↩️',
      label: '撤销',
      shortcut: undoShortcut,
      order: 10,
      disabled: !historyState.canUndo,
      action: (): void => {
        /* 撤销栈非空时执行撤销，空栈由按钮禁用态拦截，管理器内部也会安全忽略 */
        historyManager.undo();
      },
    });

    panelManager.addToolbarItem({
      id: 'tb-redo',
      icon: '↪️',
      label: '重做',
      shortcut: redoShortcut,
      order: 11,
      disabled: !historyState.canRedo,
      action: (): void => {
        /* 重做栈非空时执行重做，空栈由按钮禁用态拦截，管理器内部也会安全忽略 */
        historyManager.redo();
      },
    });
  }, [
    panelManager,
    historyManager,
    historyState.canUndo,
    historyState.canRedo,
    historyState.undoLabel,
    historyState.redoLabel,
  ]);
}
