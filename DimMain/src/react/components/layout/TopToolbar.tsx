/**
 * 顶部工具栏组件
 * 图标+文字的工具按钮行
 * V5：接入 GizmoContext，为当前激活的 Gizmo 模式按钮显示高亮态
 * V6：右侧新增 2D/3D 视图模式切换按钮
 */

import React from 'react';
import { usePanelData } from '../../hooks/usePanel';
import type { ToolbarItem } from '../../../panel/PanelTypes';
import { topToolbarStyle, toolbarButtonStyle } from './LayoutStyles';
import { useViewMode } from '../../context/ViewModeContext';
import type { ViewMode } from '../../context/ViewModeContext';

/**
 * 顶部工具栏
 */
export function TopToolbar(): React.ReactElement {
  const toolbarItems: Array<ToolbarItem> = usePanelData((m) => m.getToolbarItems());
  /** 当前激活的工具栏按钮 ID（由 PanelManager 维护，useDemoSetup 在 setMode 时同步更新） */
  const activeToolbarId: string | null = usePanelData((m) => m.getActiveToolbarId());

  /** 当前视图模式及切换方法 */
  const { viewMode, toggleViewMode }: { viewMode: ViewMode; toggleViewMode: () => void } = useViewMode();

  /** 2D/3D 切换按钮样式 */
  const viewModeButtonStyle: React.CSSProperties = {
    ...toolbarButtonStyle,
    marginLeft: 'auto',
    minWidth: 64,
    fontWeight: 700,
    letterSpacing: 1,
    background: viewMode === '2d'
      ? 'rgba(68, 200, 120, 0.25)'
      : 'rgba(68, 136, 255, 0.15)',
    borderBottom: viewMode === '2d'
      ? '2px solid #44c878'
      : '2px solid #4488ff',
    color: viewMode === '2d' ? '#44c878' : '#88bbff',
  };

  return (
    <div style={topToolbarStyle}>
      {toolbarItems.map((item: ToolbarItem) => {
        /** 判断当前按钮是否为激活态 */
        const isActive: boolean = activeToolbarId !== null && activeToolbarId === item.id;

        /** 激活态按钮样式（蓝色高亮背景） */
        const activeStyle: React.CSSProperties = isActive
          ? {
              background: 'rgba(68, 136, 255, 0.25)',
              borderBottom: '2px solid #4488ff',
              color: '#88bbff',
            }
          : {};

        return (
          <button
            key={item.id}
            style={{
              ...toolbarButtonStyle,
              opacity: item.disabled ? 0.4 : 1,
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              ...activeStyle,
            }}
            onClick={item.disabled ? undefined : item.action}
            title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
            disabled={item.disabled}
          >
            <span style={{ fontSize: 18 }}>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        );
      })}

      {/* 2D/3D 视图模式切换按钮，固定在工具栏最右侧 */}
      <button
        style={viewModeButtonStyle}
        onClick={toggleViewMode}
        title={viewMode === '3d' ? '切换到 2D 俯视编辑模式' : '切换到 3D 透视视图模式'}
      >
        <span style={{ fontSize: 16 }}>{viewMode === '3d' ? '🗺️' : '🧊'}</span>
        <span>{viewMode === '3d' ? '2D' : '3D'}</span>
      </button>
    </div>
  );
}
