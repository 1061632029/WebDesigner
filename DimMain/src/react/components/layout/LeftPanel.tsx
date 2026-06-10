/**
 * 左侧功能面板组件
 * 显示当前激活导航对应的分组卡片列表
 */

import React from 'react';
import { usePanelData } from '../../hooks/usePanel';
import type { LeftPanelConfig, PanelGroup, PanelCardItem } from '../../../panel/PanelTypes';
import {
  leftPanelStyle,
  leftPanelTitleStyle,
  leftPanelGroupTitleStyle,
  leftPanelGridStyle,
  panelCardStyle,
} from './LayoutStyles';
import { MaterialPanel } from './MaterialPanel';
import { StlModelPanel } from './StlModelPanel';

/**
 * 左侧功能面板
 * 当激活材质面板（panel-material）时使用 MaterialPanel 渲染纹理列表
 * 当激活模型面板（panel-model）时，CAD 模型分组使用 StlModelPanel 渲染
 * 其他面板使用通用卡片网格布局
 */
export function LeftPanel(): React.ReactElement | null {
  const activePanel: LeftPanelConfig | null = usePanelData((m) => m.getActiveLeftPanel());

  /* 无激活面板时不渲染 */
  if (activePanel === null) {
    return null;
  }

  /* 材质面板使用专用的 MaterialPanel 组件渲染 */
  if (activePanel.id === 'panel-material') {
    return (
      <div style={leftPanelStyle}>
        {/* 面板标题 */}
        <div style={leftPanelTitleStyle}>{activePanel.title}</div>

        {/* 纹理预设列表（支持拖拽） */}
        <MaterialPanel />
      </div>
    );
  }

  /* 模型面板：基础几何体使用通用卡片 + CAD 模型使用 StlModelPanel */
  if (activePanel.id === 'panel-model') {
    return (
      <div style={leftPanelStyle}>
        {/* 面板标题 */}
        <div style={leftPanelTitleStyle}>{activePanel.title}</div>

        {/* 基础几何体分组（通用卡片） */}
        {activePanel.groups.map((group: PanelGroup, groupIndex: number) => (
          <div key={groupIndex}>
            {/* 分组标题 */}
            <div style={leftPanelGroupTitleStyle}>{group.title}</div>

            {/* 卡片网格 */}
            <div style={leftPanelGridStyle}>
              {group.items.map((item: PanelCardItem) => (
                <button
                  key={item.id}
                  style={panelCardStyle}
                  onClick={item.action}
                  title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
                >
                  <span style={{ fontSize: 28 }}>{item.icon}</span>
                  <span style={{ fontSize: 12 }}>{item.label}</span>
                  {item.shortcut !== undefined && (
                    <span style={{ fontSize: 10, color: '#999' }}>{item.shortcut}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* CAD 模型分组（STL 模型预览卡片） */}
        <StlModelPanel />
      </div>
    );
  }

  /* 其他面板使用通用卡片网格布局 */
  return (
    <div style={leftPanelStyle}>
      {/* 面板标题 */}
      <div style={leftPanelTitleStyle}>{activePanel.title}</div>

      {/* 分组列表 */}
      {activePanel.groups.map((group: PanelGroup, groupIndex: number) => (
        <div key={groupIndex}>
          {/* 分组标题 */}
          <div style={leftPanelGroupTitleStyle}>{group.title}</div>

          {/* 卡片网格 */}
          <div style={leftPanelGridStyle}>
            {group.items.map((item: PanelCardItem) => (
              <button
                key={item.id}
                style={panelCardStyle}
                onClick={item.action}
                title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
              >
                <span style={{ fontSize: 28 }}>{item.icon}</span>
                <span style={{ fontSize: 12 }}>{item.label}</span>
                {item.shortcut !== undefined && (
                  <span style={{ fontSize: 10, color: '#999' }}>{item.shortcut}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
