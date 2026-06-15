/**
 * 面板管理器
 * 统一管理侧边导航、左侧面板、顶部工具栏、右侧属性面板的注册/注销/状态
 */

import type {
  NavItem,
  LeftPanelConfig,
  ToolbarItem,
  PropertyGroup,
  PropertyItem,
  PropertyPanelValue,
  PhotoStorageItem,
  LayoutState,
} from './PanelTypes';

/**
 * 面板变更监听器类型
 */
type PanelChangeListener = () => void;

/**
 * 面板管理器类
 * 采用发布-订阅模式，当数据变更时通知所有订阅者（React 组件）重新渲染
 */
export class PanelManager {
  /** 侧边导航项列表 */
  private _navItems: Map<string, NavItem> = new Map();

  /** 左侧面板配置列表 */
  private _leftPanels: Map<string, LeftPanelConfig> = new Map();

  /** 顶部工具栏项列表 */
  private _toolbarItems: Map<string, ToolbarItem> = new Map();

  /** 右侧属性分组列表 */
  private _propertyGroups: Array<PropertyGroup> = [];

  /** 照片存储栏图片列表 */
  private _photoStorageItems: Array<PhotoStorageItem> = [];

  /**
   * 当前激活的工具栏按钮 ID（null 表示无激活）
   * 由 useDemoSetup 在 Gizmo 模式切换时同步更新，驱动 TopToolbar 高亮态
   */
  private _activeToolbarId: string | null = null;

  /** 布局状态 */
  private _layoutState: LayoutState = {
    leftPanelOpen: true,
    rightPanelOpen: true,
    activeNavId: null,
    activeLeftPanelId: null,
  };

  /** 变更监听器集合 */
  private _listeners: Set<PanelChangeListener> = new Set();

  /* ========== 订阅机制 ========== */

  /**
   * 订阅面板变更
   * @param listener - 变更回调函数
   * @returns 取消订阅函数
   */
  public subscribe(listener: PanelChangeListener): () => void {
    this._listeners.add(listener);
    return (): void => {
      this._listeners.delete(listener);
    };
  }

  /**
   * 通知所有订阅者数据已变更
   */
  private _notify(): void {
    this._listeners.forEach((listener: PanelChangeListener) => listener());
  }

  /* ========== 侧边导航 ========== */

  /**
   * 注册侧边导航项
   * @param item - 导航项配置
   */
  public addNav(item: NavItem): void {
    this._navItems.set(item.id, item);
    /* 如果没有激活项，且该导航项关联面板，则自动激活 */
    if (this._layoutState.activeNavId === null && (item.panelId !== null && item.panelId !== undefined)) {
      this._layoutState.activeNavId = item.id;
      this._layoutState.activeLeftPanelId = item.panelId ?? null;
    }
    this._notify();
  }

  /**
   * 注销侧边导航项
   * @param id - 导航项 ID
   */
  public removeNav(id: string): void {
    this._navItems.delete(id);
    this._notify();
  }

  /**
   * 获取所有导航项（按 order 排序）
   */
  public getNavItems(): Array<NavItem> {
    return Array.from(this._navItems.values()).sort(
      (a: NavItem, b: NavItem) => a.order - b.order
    );
  }

  /**
   * 设置激活的导航项
   * - 若导航项有 panelId：切换左侧面板并高亮导航项
   * - 若导航项无 panelId 但有 action：直接执行 action（即时操作，不切换面板）
   * @param navId - 导航项 ID
   */
  public setActiveNav(navId: string): void {
    const navItem: NavItem | undefined = this._navItems.get(navId);
    if (navItem === undefined) {
      return;
    }

    /* 即时操作按钮：直接执行 action，不切换面板 */
    if ((navItem.panelId === null || navItem.panelId === undefined) && navItem.action !== undefined) {
      navItem.action();
      return;
    }

    /* 面板切换按钮：更新激活状态并展开左侧面板 */
    this._layoutState.activeNavId = navId;
    this._layoutState.activeLeftPanelId = navItem.panelId ?? null;
    this._layoutState.leftPanelOpen = true;
    this._notify();
  }

  /* ========== 左侧面板 ========== */

  /**
   * 注册左侧面板
   * @param config - 面板配置
   */
  public addLeftPanel(config: LeftPanelConfig): void {
    this._leftPanels.set(config.id, config);
    this._notify();
  }

  /**
   * 注销左侧面板
   * @param id - 面板 ID
   */
  public removeLeftPanel(id: string): void {
    this._leftPanels.delete(id);
    this._notify();
  }

  /**
   * 获取当前激活的左侧面板配置
   */
  public getActiveLeftPanel(): LeftPanelConfig | null {
    const panelId: string | null = this._layoutState.activeLeftPanelId;
    if (panelId === null) return null;
    return this._leftPanels.get(panelId) ?? null;
  }

  /* ========== 顶部工具栏 ========== */

  /**
   * 获取当前激活的工具栏按钮 ID
   * @returns 激活按钮 ID，无激活时返回 null
   */
  public getActiveToolbarId(): string | null {
    return this._activeToolbarId;
  }

  /**
   * 设置当前激活的工具栏按钮 ID
   * @param id - 按钮 ID，传 null 清除激活态
   */
  public setActiveToolbarId(id: string | null): void {
    if (this._activeToolbarId === id) {
      return;
    }
    this._activeToolbarId = id;
    this._notify();
  }

  /**
   * 注册工具栏项
   * @param item - 工具栏项配置
   */
  public addToolbarItem(item: ToolbarItem): void {
    this._toolbarItems.set(item.id, item);
    this._notify();
  }

  /**
   * 注销工具栏项
   * @param id - 工具栏项 ID
   */
  public removeToolbarItem(id: string): void {
    this._toolbarItems.delete(id);
    this._notify();
  }

  /**
   * 获取所有工具栏项（按 order 排序）
   */
  public getToolbarItems(): Array<ToolbarItem> {
    return Array.from(this._toolbarItems.values()).sort(
      (a: ToolbarItem, b: ToolbarItem) => a.order - b.order
    );
  }

  /* ========== 右侧属性面板 ========== */

  /**
   * 设置属性分组列表（替换整个列表）
   * @param groups - 属性分组列表
   */
  public setPropertyGroups(groups: Array<PropertyGroup>): void {
    this._propertyGroups = groups;
    this._notify();
  }

  /**
   * 获取所有属性分组
   */
  public getPropertyGroups(): Array<PropertyGroup> {
    return this._propertyGroups;
  }

  /**
   * 根据属性项 ID 查找当前右侧属性面板中的属性项
   * @param itemId - 属性项唯一标识
   * @returns 匹配的属性项，未找到时返回 null
   */
  public findPropertyItem(itemId: string): PropertyItem | null {
    for (const group of this._propertyGroups) {
      for (const item of group.items) {
        if (item.id === itemId) {
          return item;
        }
      }
    }

    return null;
  }

  /**
   * 仅更新当前属性面板中指定属性项的显示值，不触发业务 onChange 回调
   * @param itemId - 属性项唯一标识
   * @param value - 新的显示值
   * @returns 是否成功找到并更新属性项
   */
  public updatePropertyItemValue(itemId: string, value: PropertyPanelValue): boolean {
    const item: PropertyItem | null = this.findPropertyItem(itemId);
    if (item === null) {
      return false;
    }

    /* 根据控件类型校验并写入显示值，避免把错误类型写入当前面板状态。 */
    if ((item.type === 'number' || item.type === 'slider') && typeof value === 'number') {
      item.value = value;
      this._notify();
      return true;
    }

    if ((item.type === 'color' || item.type === 'select') && typeof value === 'string') {
      item.value = value;
      this._notify();
      return true;
    }

    if (item.type === 'toggle' && typeof value === 'boolean') {
      item.value = value;
      this._notify();
      return true;
    }

    return false;
  }

  /**
   * 切换属性分组的展开/折叠状态
   * @param index - 分组索引
   */
  public togglePropertyGroup(index: number): void {
    const group: PropertyGroup | undefined = this._propertyGroups[index];
    if (group !== undefined) {
      group.expanded = !group.expanded;
      this._notify();
    }
  }

  /* ========== 照片存储栏 ========== */

  /**
   * 添加照片存储项
   * @param item - 新增照片数据
   */
  public addPhotoStorageItem(item: PhotoStorageItem): void {
    /* 新拍摄图片插入列表顶部，便于用户优先查看最近拍摄结果。 */
    this._photoStorageItems = [item, ...this._photoStorageItems];
    this._notify();
  }

  /**
   * 删除指定照片存储项
   * @param id - 照片唯一标识
   */
  public removePhotoStorageItem(id: string): void {
    this._photoStorageItems = this._photoStorageItems.filter((item: PhotoStorageItem): boolean => item.id !== id);
    this._notify();
  }

  /**
   * 清空照片存储栏
   */
  public clearPhotoStorageItems(): void {
    this._photoStorageItems = [];
    this._notify();
  }

  /**
   * 获取照片存储项列表
   * @returns 照片存储项快照
   */
  public getPhotoStorageItems(): Array<PhotoStorageItem> {
    return [...this._photoStorageItems];
  }

  /* ========== 布局状态 ========== */

  /**
   * 获取布局状态
   */
  public getLayoutState(): LayoutState {
    return { ...this._layoutState };
  }

  /**
   * 切换左侧面板展开/折叠
   */
  public toggleLeftPanel(): void {
    this._layoutState.leftPanelOpen = !this._layoutState.leftPanelOpen;
    this._notify();
  }

  /**
   * 切换右侧面板展开/折叠
   */
  public toggleRightPanel(): void {
    this._layoutState.rightPanelOpen = !this._layoutState.rightPanelOpen;
    this._notify();
  }

  /* ========== 资源释放 ========== */

  /**
   * 清除所有注册和监听器
   */
  public dispose(): void {
    this._navItems.clear();
    this._leftPanels.clear();
    this._toolbarItems.clear();
    this._propertyGroups = [];
    this._photoStorageItems = [];
    this._listeners.clear();
  }
}
