/**
 * 布局样式常量
 * 参照三维家风格的深色/浅色配色方案
 */

import type React from 'react';

/* ========== 尺寸常量 ========== */

/** 侧边导航栏宽度 */
export const SIDE_NAV_WIDTH: number = 56;
/** 左侧面板宽度 */
export const LEFT_PANEL_WIDTH: number = 240;
/** 顶部工具栏高度 */
export const TOP_TOOLBAR_HEIGHT: number = 48;
/** 右侧属性面板宽度 */
export const RIGHT_PANEL_WIDTH: number = 280;
/** 底部状态栏高度 */
export const STATUS_BAR_HEIGHT: number = 28;

/* ========== 样式对象 ========== */

/** 应用根容器 */
export const appShellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  width: '100vw',
  height: '100vh',
  overflow: 'hidden',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: 13,
  color: '#333',
  backgroundColor: '#f0f0f0',
};

/** 侧边导航栏 */
export const sideNavStyle: React.CSSProperties = {
  width: SIDE_NAV_WIDTH,
  minWidth: SIDE_NAV_WIDTH,
  height: '100%',
  backgroundColor: '#2d2d3a',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  paddingTop: 8,
  gap: 2,
  overflowY: 'auto',
  overflowX: 'hidden',
};

/** 侧边导航项（普通） */
export const sideNavItemStyle: React.CSSProperties = {
  width: 48,
  height: 52,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
  cursor: 'pointer',
  borderRadius: 6,
  border: 'none',
  background: 'none',
  backgroundColor: '#2d2d3a',
  appearance: 'none',
  WebkitAppearance: 'none',
  WebkitTapHighlightColor: 'transparent',
  boxSizing: 'border-box',
  boxShadow: 'none',
  fontFamily: 'inherit',
  lineHeight: 'normal',
  margin: 0,
  outline: 'none',
  padding: 0,
  textAlign: 'center',
  textDecoration: 'none',
  touchAction: 'manipulation',
  color: '#aaa',
  fontSize: 11,
  transition: 'background-color 0.12s ease, color 0.12s ease, box-shadow 0.12s ease, transform 0.08s ease',
  userSelect: 'none',
  WebkitUserSelect: 'none',
};

/** 侧边导航项（悬停，保持深色体系，避免出现浏览器默认白底） */
export const sideNavItemHoverStyle: React.CSSProperties = {
  ...sideNavItemStyle,
  backgroundColor: '#3a3a4a',
  color: '#f0f0f6',
  boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
};

/** 侧边导航项（按下，使用深色反馈，避免点击瞬间出现白底） */
export const sideNavItemPressedStyle: React.CSSProperties = {
  ...sideNavItemStyle,
  backgroundColor: '#232331',
  color: '#fff',
  transform: 'scale(0.98)',
};

/** 侧边导航项（激活） */
export const sideNavItemActiveStyle: React.CSSProperties = {
  ...sideNavItemStyle,
  backgroundColor: '#4a6cf7',
  color: '#fff',
  boxShadow: 'inset 3px 0 0 rgba(255, 255, 255, 0.9), 0 4px 10px rgba(74, 108, 247, 0.28)',
};

/** 侧边导航图标 */
export const sideNavIconStyle: React.CSSProperties = {
  fontSize: 20,
  lineHeight: 1,
};

/** 左侧面板容器 */
export const leftPanelStyle: React.CSSProperties = {
  width: LEFT_PANEL_WIDTH,
  minWidth: LEFT_PANEL_WIDTH,
  height: '100%',
  backgroundColor: '#fff',
  borderRight: '1px solid #e0e0e0',
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  overflowX: 'hidden',
};

/** 左侧面板标题 */
export const leftPanelTitleStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: 16,
  fontWeight: 600,
  borderBottom: '1px solid #e8e8e8',
};

/** 左侧面板分组标题 */
export const leftPanelGroupTitleStyle: React.CSSProperties = {
  padding: '10px 16px 6px',
  fontSize: 12,
  fontWeight: 600,
  color: '#666',
};

/** 左侧面板卡片网格 */
export const leftPanelGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
  padding: '0 12px 12px',
};

/** 左侧面板卡片项 */
export const panelCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  padding: '12px 8px',
  borderRadius: 8,
  border: '1px solid #e8e8e8',
  cursor: 'pointer',
  background: '#fafafa',
  transition: 'all 0.15s ease',
};

/** 中间区域容器（工具栏 + 视口 + 状态栏） */
export const centerAreaStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
};

/** 顶部工具栏 */
export const topToolbarStyle: React.CSSProperties = {
  height: TOP_TOOLBAR_HEIGHT,
  minHeight: TOP_TOOLBAR_HEIGHT,
  backgroundColor: '#fff',
  borderBottom: '1px solid #e0e0e0',
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  paddingLeft: 16,
  paddingRight: 16,
  gap: 4,
};

/** 工具栏按钮 */
export const toolbarButtonStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 1,
  padding: '4px 12px',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  background: 'transparent',
  color: '#555',
  fontSize: 10,
  transition: 'background 0.15s ease',
};

/** 3D 视口容器 */
export const viewportStyle: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  overflow: 'hidden',
  backgroundColor: '#1a1a2e',
};

/** 右侧属性面板 */
export const rightPanelStyle: React.CSSProperties = {
  width: RIGHT_PANEL_WIDTH,
  minWidth: RIGHT_PANEL_WIDTH,
  height: '100%',
  backgroundColor: '#fff',
  borderLeft: '1px solid #e0e0e0',
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  overflowX: 'hidden',
};

/** 照片存储栏容器：复用右侧栏宽度，确保场景/模型菜单切换时视口宽度稳定。 */
export const photoStoragePanelStyle: React.CSSProperties = {
  width: RIGHT_PANEL_WIDTH,
  minWidth: RIGHT_PANEL_WIDTH,
  height: '100%',
  backgroundColor: '#fff',
  borderLeft: '1px solid #e0e0e0',
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  overflowX: 'hidden',
};

/** 照片存储栏标题区域。 */
export const photoStorageTitleStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: 16,
  fontWeight: 600,
  borderBottom: '1px solid #e8e8e8',
};

/** 照片存储栏内容区域。 */
export const photoStorageContentStyle: React.CSSProperties = {
  flex: 1,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

/** 照片存储栏空状态提示。 */
export const photoStorageEmptyStyle: React.CSSProperties = {
  padding: 20,
  border: '1px dashed #d8d8d8',
  borderRadius: 8,
  color: '#999',
  fontSize: 12,
  lineHeight: 1.6,
  textAlign: 'center',
  backgroundColor: '#fafafa',
};

/** 照片存储列表容器。 */
export const photoStorageListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

/** 照片卡片容器。 */
export const photoStorageCardStyle: React.CSSProperties = {
  border: '1px solid #e8e8e8',
  borderRadius: 10,
  backgroundColor: '#fff',
  overflow: 'hidden',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
};

/** 照片缩略图按钮。 */
export const photoStorageImageStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  height: 132,
  padding: 0,
  border: 'none',
  backgroundColor: '#f4f4f6',
  cursor: 'pointer',
  overflow: 'hidden',
};

/** 照片元信息区域。 */
export const photoStorageMetaStyle: React.CSSProperties = {
  padding: '10px 12px 8px',
};

/** 照片名称。 */
export const photoStorageNameStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#333',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** 照片拍摄时间。 */
export const photoStorageTimeStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 11,
  color: '#888',
};

/** 照片操作按钮区域。 */
export const photoStorageActionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '0 12px 12px',
};

/** 照片普通操作按钮。 */
export const photoStorageActionButtonStyle: React.CSSProperties = {
  flex: 1,
  height: 28,
  border: '1px solid #d8d8d8',
  borderRadius: 6,
  backgroundColor: '#fafafa',
  color: '#555',
  cursor: 'pointer',
  fontSize: 12,
};

/** 照片删除按钮。 */
export const photoStorageDeleteButtonStyle: React.CSSProperties = {
  ...photoStorageActionButtonStyle,
  border: '1px solid #ffd2d2',
  backgroundColor: '#fff7f7',
  color: '#d9363e',
};

/** 照片预览遮罩层。 */
export const photoPreviewOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 32,
  backgroundColor: 'rgba(0, 0, 0, 0.58)',
};

/** 照片预览弹窗容器。 */
export const photoPreviewDialogStyle: React.CSSProperties = {
  width: 'min(960px, 92vw)',
  maxHeight: '88vh',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  overflow: 'hidden',
  backgroundColor: '#fff',
  boxShadow: '0 16px 48px rgba(0, 0, 0, 0.32)',
};

/** 照片预览标题栏。 */
export const photoPreviewHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '12px 16px',
  borderBottom: '1px solid #eeeeee',
};

/** 照片预览标题文字。 */
export const photoPreviewTitleStyle: React.CSSProperties = {
  minWidth: 0,
  color: '#222',
  fontSize: 14,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/** 照片预览关闭按钮。 */
export const photoPreviewCloseButtonStyle: React.CSSProperties = {
  height: 30,
  padding: '0 12px',
  border: '1px solid #d8d8d8',
  borderRadius: 6,
  backgroundColor: '#fafafa',
  color: '#444',
  cursor: 'pointer',
  fontSize: 12,
};

/** 照片预览图片承载区域。 */
export const photoPreviewImageWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 240,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  backgroundColor: '#202028',
  overflow: 'auto',
};

/** 照片预览大图。 */
export const photoPreviewImageStyle: React.CSSProperties = {
  maxWidth: '100%',
  maxHeight: '62vh',
  objectFit: 'contain',
  borderRadius: 6,
};

/** 照片预览底部信息栏。 */
export const photoPreviewFooterStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '12px 16px',
  borderTop: '1px solid #eeeeee',
};

/** 照片预览信息文本。 */
export const photoPreviewInfoStyle: React.CSSProperties = {
  color: '#666',
  fontSize: 12,
};

/** 照片预览主操作按钮。 */
export const photoPreviewPrimaryButtonStyle: React.CSSProperties = {
  height: 32,
  padding: '0 14px',
  border: '1px solid #4a6cf7',
  borderRadius: 6,
  backgroundColor: '#4a6cf7',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 12,
};

/** 属性分组标题行 */
export const propertyGroupHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '10px 16px',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
  borderBottom: '1px solid #f0f0f0',
  userSelect: 'none',
};

/** 属性分组内容区域 */
export const propertyGroupContentStyle: React.CSSProperties = {
  padding: '8px 16px 12px',
};

/** 属性行（标签 + 控件） */
export const propertyRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 0',
  minHeight: 32,
};

/** 属性标签 */
export const propertyLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#555',
  flexShrink: 0,
  marginRight: 12,
};

/** 底部状态栏 */
export const statusBarStyle: React.CSSProperties = {
  height: STATUS_BAR_HEIGHT,
  minHeight: STATUS_BAR_HEIGHT,
  backgroundColor: '#f5f5f5',
  borderTop: '1px solid #e0e0e0',
  display: 'flex',
  alignItems: 'center',
  paddingLeft: 12,
  paddingRight: 12,
  fontSize: 11,
  color: '#888',
};
