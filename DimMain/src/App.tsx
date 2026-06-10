/**
 * 应用根组件
 * AppShell 布局骨架 + Three.js WebGPU 3D 场景
 * V5：集成 GizmoBridgeProvider / HistoryProvider / useGizmoShortcuts
 * V6：集成 ViewModeProvider，支持 2D/3D 视图模式切换
 */

import React from 'react';
import { AppShell } from './react/components/layout/AppShell';
import { Canvas } from './react/components/Canvas';
import { DrawToolBridgeProvider } from './react/context/DrawToolContext';
import { GizmoBridgeProvider } from './react/context/GizmoContext';
import { HistoryProvider } from './react/context/HistoryContext';
import { TextureDragProvider } from './react/context/TextureDragContext';
import { StlPlaceProvider } from './react/context/StlPlaceContext';
import { ViewModeProvider } from './react/context/ViewModeContext';
import { FitSceneProvider } from './react/context/FitSceneContext';
import { ClearSceneProvider } from './react/context/ClearSceneContext';
import { WallDrawScene } from './demo/WallDrawScene';
import { useDemoSetup } from './demo/useDemoSetup';
import { useGizmoShortcuts } from './react/hooks/useGizmoShortcuts';
import { useHistoryShortcuts } from './react/hooks/useHistoryShortcuts';

/**
 * Demo 面板初始化组件
 * 必须在 AppShell 内部使用（需要 PanelContext）
 * 同时注册 Gizmo 快捷键和历史快捷键
 */
function DemoSetup(): null {
  useDemoSetup();
  useGizmoShortcuts();
  useHistoryShortcuts();
  return null;
}

/**
 * 应用根组件
 * Provider 层次（由外到内）：
 *   HistoryProvider          → 命令历史栈（全局）
 *   GizmoBridgeProvider      → Gizmo 模式桥接（跨 Canvas 边界）
 *   DrawToolBridgeProvider   → 绘制工具桥接
 *   TextureDragProvider      → 纹理拖拽
 *   FitSceneProvider         → 自适应场景桥接（跨 Canvas 边界）
 *   ClearSceneProvider       → 清空场景桥接（跨 Canvas 边界）
 *   AppShell                 → 五区域布局（含 PanelProvider）
 *     DemoSetup              → 注册面板数据 + 快捷键
 *     Canvas                 → WebGPU 渲染视口
 *       WallDrawScene        → 场景内容（含 BuildingProvider / SelectionProvider / GizmoProvider）
 */
export function App(): React.ReactElement {
  /**
   * 引擎错误回调
   */
  const handleError = (error: Error): void => {
    console.error('引擎初始化失败:', error.message);
  };

  return (
    <HistoryProvider>
      <GizmoBridgeProvider>
        <DrawToolBridgeProvider>
          <TextureDragProvider>
            <StlPlaceProvider>
              {/* FitSceneProvider：自适应场景桥接，需在 AppShell 外层以便 useDemoSetup 访问 */}
              <FitSceneProvider>
                {/* ClearSceneProvider：清空场景桥接，需在 AppShell 外层以便顶部工具栏访问 */}
                <ClearSceneProvider>
                  {/* ViewModeProvider：管理 2D/3D 视图模式，需在 AppShell 外层以便 TopToolbar 访问 */}
                  <ViewModeProvider>
                    <AppShell>
                      {/* 注册 demo 面板数据 + Gizmo/历史快捷键 */}
                      <DemoSetup />

                      {/* 3D 视口 */}
                      <Canvas
                        style={{ width: '100%', height: '100%' }}
                        onError={handleError}
                      >
                        <WallDrawScene />
                      </Canvas>
                    </AppShell>
                  </ViewModeProvider>
                </ClearSceneProvider>
              </FitSceneProvider>
            </StlPlaceProvider>
          </TextureDragProvider>
        </DrawToolBridgeProvider>
      </GizmoBridgeProvider>
    </HistoryProvider>
  );
}
