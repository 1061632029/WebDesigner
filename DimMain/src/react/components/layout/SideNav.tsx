/**
 * 侧边导航栏组件
 * 图标+文字的一级菜单，选中高亮，深色背景
 */

import React from 'react';
import { usePanelData, usePanelManager } from '../../hooks/usePanel';
import type { NavItem, LayoutState } from '../../../panel/PanelTypes';
import {
  sideNavStyle,
  sideNavItemStyle,
  sideNavItemHoverStyle,
  sideNavItemPressedStyle,
  sideNavItemActiveStyle,
  sideNavIconStyle,
} from './LayoutStyles';

/**
 * 侧边导航栏
 * 支持两种导航项：
 * - 面板切换项（有 panelId）：点击切换左侧面板，激活时高亮
 * - 即时操作项（无 panelId，有 action）：点击直接执行操作，不高亮
 */
export function SideNav(): React.ReactElement {
  const panelManager = usePanelManager();
  const navItems: Array<NavItem> = usePanelData((m) => m.getNavItems());
  const layoutState: LayoutState = usePanelData((m) => m.getLayoutState());
  const [hoveredNavId, setHoveredNavId]: [string | null, React.Dispatch<React.SetStateAction<string | null>>] = React.useState<string | null>(null);
  const [pressedNavId, setPressedNavId]: [string | null, React.Dispatch<React.SetStateAction<string | null>>] = React.useState<string | null>(null);

  /**
   * 导航项点击处理
   * PanelManager.setActiveNav 内部已区分面板切换和即时操作。
   * 点击完成后主动移除焦点，避免鼠标移出后残留焦点态导致背景异常。
   */
  const handleClick = (navId: string, event: React.MouseEvent<HTMLDivElement>): void => {
    panelManager.setActiveNav(navId);
    setPressedNavId(null);
    event.currentTarget.blur();
  };

  /**
   * 导航项鼠标按下处理。
   * 阻止浏览器默认焦点/选择反馈，避免点击切换时出现白色焦点底色或文字选中状态。
   * @param navId - 导航项 ID
   * @param event - 鼠标事件
   */
  const handleMouseDown = (navId: string, event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setPressedNavId(navId);
  };

  /**
   * 导航项键盘操作处理。
   * 支持 Enter/Space 触发导航，保留非原生 button 后的键盘可访问性。
   */
  const handleKeyDown = (navId: string, event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    panelManager.setActiveNav(navId);
    event.currentTarget.blur();
  };

  /**
   * 根据导航项当前交互状态生成样式。
   * 优先级：激活态 > 按下态 > 悬停态 > 普通态，确保当前菜单高亮不会被临时状态覆盖。
   */
  const getNavItemStyle = (navId: string, isActive: boolean): React.CSSProperties => {
    if (isActive) {
      return sideNavItemActiveStyle;
    }

    if (pressedNavId === navId) {
      return sideNavItemPressedStyle;
    }

    if (hoveredNavId === navId) {
      return sideNavItemHoverStyle;
    }

    return sideNavItemStyle;
  };

  return (
    <nav style={sideNavStyle}>
      {navItems.map((item: NavItem) => {
        /* 即时操作项（无 panelId）不参与激活高亮 */
        const hasPanelId: boolean = item.panelId !== null && item.panelId !== undefined;
        const isActive: boolean = hasPanelId && layoutState.activeNavId === item.id;
        return (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            style={getNavItemStyle(item.id, isActive)}
            onMouseEnter={(): void => setHoveredNavId(item.id)}
            onMouseLeave={(event: React.MouseEvent<HTMLDivElement>): void => {
              setHoveredNavId(null);
              setPressedNavId(null);
              event.currentTarget.blur();
            }}
            onMouseDown={(event: React.MouseEvent<HTMLDivElement>): void => handleMouseDown(item.id, event)}
            onMouseUp={(): void => setPressedNavId(null)}
            onFocus={(): void => {
              setHoveredNavId(null);
              setPressedNavId(null);
            }}
            onBlur={(): void => {
              setHoveredNavId(null);
              setPressedNavId(null);
            }}
            onClick={(event: React.MouseEvent<HTMLDivElement>): void => handleClick(item.id, event)}
            onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>): void => handleKeyDown(item.id, event)}
            title={item.label}
          >
            <span style={sideNavIconStyle}>{item.icon}</span>
            <span>{item.label}</span>
          </div>
        );
      })}
    </nav>
  );
}
