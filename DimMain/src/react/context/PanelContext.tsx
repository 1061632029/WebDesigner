/**
 * 面板系统 React Context
 * 向组件树提供 PanelManager 实例
 */

import React from 'react';
import { PanelManager } from '../../panel/PanelManager';

/**
 * PanelContext 值类型
 */
export interface PanelContextValue {
  /** 面板管理器实例 */
  panelManager: PanelManager;
}

/**
 * PanelContext 定义
 * 默认值为 null，仅在 AppShell 内部有效
 */
export const PanelContext: React.Context<PanelContextValue | null> =
  React.createContext<PanelContextValue | null>(null);
