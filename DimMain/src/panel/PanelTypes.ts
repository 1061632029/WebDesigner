/**
 * 面板系统类型定义
 * 定义侧边导航、左侧面板、顶部工具栏、右侧属性面板的数据结构
 */

/* ========== 侧边导航栏 ========== */

/**
 * 侧边导航项
 * - 若 panelId 有值：点击时切换左侧面板
 * - 若 panelId 为 null/undefined 且 action 有值：点击时直接执行 action（即时操作，不展开面板）
 */
export interface NavItem {
  /** 唯一标识 */
  id: string;
  /** 图标（emoji 或图标类名） */
  icon: string;
  /** 显示文字 */
  label: string;
  /** 排序权重（越小越靠前） */
  order: number;
  /** 关联的左侧面板 ID（可选，为 null/undefined 时表示即时操作按钮） */
  panelId?: string | null;
  /** 即时操作回调（panelId 为空时使用，点击直接执行） */
  action?: () => void;
}

/* ========== 左侧功能面板 ========== */

/**
 * 左侧面板卡片项
 */
export interface PanelCardItem {
  /** 唯一标识 */
  id: string;
  /** 图标 */
  icon: string;
  /** 显示文字 */
  label: string;
  /** 快捷键（如 'Alt+1'） */
  shortcut?: string;
  /** 点击回调 */
  action: () => void;
}

/**
 * 左侧面板分组
 */
export interface PanelGroup {
  /** 分组标题 */
  title: string;
  /** 分组内的卡片项 */
  items: Array<PanelCardItem>;
}

/**
 * 左侧面板配置
 */
export interface LeftPanelConfig {
  /** 面板 ID（与 NavItem.panelId 对应） */
  id: string;
  /** 面板标题 */
  title: string;
  /** 分组列表 */
  groups: Array<PanelGroup>;
}

/* ========== 顶部工具栏 ========== */

/**
 * 工具栏项
 */
export interface ToolbarItem {
  /** 唯一标识 */
  id: string;
  /** 图标 */
  icon: string;
  /** 显示文字 */
  label: string;
  /** 快捷键 */
  shortcut?: string;
  /** 排序权重 */
  order: number;
  /** 是否禁用 */
  disabled: boolean;
  /** 点击回调 */
  action: () => void;
}

/* ========== 右侧属性面板 ========== */

/**
 * 属性控件类型
 */
export type PropertyControlType = 'number' | 'slider' | 'toggle' | 'color' | 'select' | 'button' | 'text';

/**
 * 属性控件基础接口
 */
export interface PropertyItemBase {
  /** 唯一标识 */
  id: string;
  /** 控件类型 */
  type: PropertyControlType;
  /** 标签文字 */
  label: string;
}

/**
 * 数值输入控件
 */
export interface NumberPropertyItem extends PropertyItemBase {
  type: 'number';
  /** 单位（如 'mm'、'°'） */
  unit?: string;
  /** 最小值 */
  min?: number;
  /** 最大值 */
  max?: number;
  /** 步长 */
  step?: number;
  /** 当前值 */
  value: number;
  /** 值变化回调 */
  onChange: (value: number) => void;
  /**
   * 是否只读
   * 只读时输入框置灰禁用，不可编辑
   * 通常用于由其他对象（如天花板）控制的派生属性
   */
  readonly?: boolean;
  /**
   * 只读时的提示文字（鼠标悬停显示）
   * 如"由天花板房间高控制"
   */
  readonlyHint?: string;
}

/**
 * 滑块控件
 */
export interface SliderPropertyItem extends PropertyItemBase {
  type: 'slider';
  /** 最小值 */
  min: number;
  /** 最大值 */
  max: number;
  /** 步长 */
  step?: number;
  /** 当前值 */
  value: number;
  /** 值变化回调 */
  onChange: (value: number) => void;
}

/**
 * 开关控件
 */
export interface TogglePropertyItem extends PropertyItemBase {
  type: 'toggle';
  /** 当前值 */
  value: boolean;
  /** 值变化回调 */
  onChange: (value: boolean) => void;
}

/**
 * 颜色选择控件
 */
export interface ColorPropertyItem extends PropertyItemBase {
  type: 'color';
  /** 当前颜色值（hex 字符串） */
  value: string;
  /** 值变化回调 */
  onChange: (value: string) => void;
}

/**
 * 下拉选择控件
 */
export interface SelectPropertyItem extends PropertyItemBase {
  type: 'select';
  /** 选项列表 */
  options: Array<{ label: string; value: string }>;
  /** 当前值 */
  value: string;
  /** 值变化回调 */
  onChange: (value: string) => void;
}

/**
 * 按钮控件
 */
export interface ButtonPropertyItem extends PropertyItemBase {
  type: 'button';
  /** 点击回调 */
  action: () => void;
}

/**
 * 属性控件联合类型
 */
export type PropertyItem =
  | NumberPropertyItem
  | SliderPropertyItem
  | TogglePropertyItem
  | ColorPropertyItem
  | SelectPropertyItem
  | ButtonPropertyItem;

/**
 * 属性分组
 */
export interface PropertyGroup {
  /** 分组标题 */
  title: string;
  /** 是否默认展开 */
  expanded: boolean;
  /** 属性控件列表 */
  items: Array<PropertyItem>;
}

/* ========== 布局状态 ========== */

/**
 * 布局状态
 */
export interface LayoutState {
  /** 左侧面板是否展开 */
  leftPanelOpen: boolean;
  /** 右侧面板是否展开 */
  rightPanelOpen: boolean;
  /** 当前激活的导航项 ID */
  activeNavId: string | null;
  /** 当前激活的左侧面板 ID */
  activeLeftPanelId: string | null;
}
