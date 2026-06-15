/**
 * AppShell — 应用布局骨架
 * 管理 PanelManager 生命周期，组合所有布局区域
 * 布局：侧边导航 | 左侧面板 | 中间（工具栏 + 视口 + 状态栏） | 右侧属性面板
 */

import React, { useMemo, useEffect } from 'react';
import { PanelManager } from '../../../panel/PanelManager';
import { PropertyPanelController } from '../../../panel/PropertyPanelController';
import type { LayoutState } from '../../../panel/PanelTypes';
import { PanelContext } from '../../context/PanelContext';
import type { PanelContextValue } from '../../context/PanelContext';
import { usePanelData } from '../../hooks/usePanel';
import { SideNav } from './SideNav';
import { LeftPanel } from './LeftPanel';
import { TopToolbar } from './TopToolbar';
import { RightPropertyPanel } from './RightPropertyPanel';
import { PhotoStoragePanel } from './PhotoStoragePanel';
import { appShellStyle, centerAreaStyle, viewportStyle, statusBarStyle } from './LayoutStyles';

/**
 * AppShell 属性
 */
interface AppShellProps {
  /** 子组件（3D Canvas 等内容放在视口区域） */
  children: React.ReactNode;
}

/**
 * 应用布局骨架组件
 * 创建 PanelManager 并通过 Context 注入，组合所有布局区域
 */
export function AppShell({ children }: AppShellProps): React.ReactElement {
  /* 创建 PanelManager 单例（组件生命周期内复用） */
  const panelManager: PanelManager = useMemo(() => new PanelManager(), []);

  /* 创建属性面板控制器单例，统一封装右侧属性面板调用逻辑 */
  const propertyPanelController: PropertyPanelController = useMemo(
    (): PropertyPanelController => new PropertyPanelController(panelManager),
    [panelManager]
  );

  /* 组件卸载时释放 PanelManager */
  useEffect(() => {
    return (): void => {
      propertyPanelController.dispose();
      panelManager.dispose();
    };
  }, [panelManager, propertyPanelController]);

  /* Context 值 */
  const contextValue: PanelContextValue = useMemo(
    (): PanelContextValue => ({ panelManager, propertyPanelController }),
    [panelManager, propertyPanelController]
  );

  return (
    <PanelContext.Provider value={contextValue}>
      <div style={appShellStyle}>
        {/* 1. 左侧图标导航栏 */}
        <SideNav />

        {/* 2. 左侧功能面板 */}
        <LeftPanel />

        {/* 3. 中间区域 */}
        <div style={centerAreaStyle}>
          {/* 3.1 顶部工具栏 */}
          <TopToolbar />

          {/* 3.2 3D 视口 */}
          <div style={viewportStyle}>
            {children}
          </div>

          {/* 3.3 底部状态栏 */}
          <div style={statusBarStyle}>
            <span>Version 0.2.0</span>
            <span style={{ marginLeft: 'auto' }}>Dim WebGPU Engine</span>
          </div>
        </div>

        {/* 4. 右侧区域：场景菜单显示照片存储栏，其他菜单显示属性栏。 */}
        <RightPanelSwitcher />
      </div>
    </PanelContext.Provider>
  );
}

/**
 * 右侧栏切换组件。
 * @returns 根据当前侧边菜单返回照片存储栏或属性栏
 */
function RightPanelSwitcher(): React.ReactElement {
  /* 订阅 PanelManager 布局状态，确保侧边菜单切换时右侧区域同步重渲染。 */
  const layoutState: LayoutState = usePanelData((manager: PanelManager): LayoutState => manager.getLayoutState());
  const isSceneMenuActive: boolean = layoutState.activeNavId === 'scene';

  /* 场景菜单承载照片存储，模型菜单及其他菜单继续承载属性编辑。 */
  if (isSceneMenuActive) {
    return <PhotoStoragePanel />;
  }

  return <RightPropertyPanel />;
}
