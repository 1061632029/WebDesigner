/**
 * 属性面板调用控制器
 * 为右侧属性面板提供统一的展示、清空、刷新和按属性 ID 修改入口，避免业务代码直接散落调用 PanelManager。
 */

import { PanelManager } from './PanelManager';
import type { PropertyGroup, PropertyItem, PropertyPanelValue } from './PanelTypes';

/**
 * 属性面板分组构建函数
 * 每次刷新时重新读取当前业务对象状态并生成最新属性分组。
 */
export type PropertyPanelGroupBuilder = () => Array<PropertyGroup>;

/**
 * 属性面板调用控制器
 */
export class PropertyPanelController {
  /** 面板管理器实例 */
  private readonly _panelManager: PanelManager;

  /** 当前属性面板刷新构建器 */
  private _groupBuilder: PropertyPanelGroupBuilder | null = null;

  /**
   * @param panelManager - 面板管理器实例
   */
  public constructor(panelManager: PanelManager) {
    this._panelManager = panelManager;
  }

  /**
   * 展示指定属性分组
   * @param groups - 属性分组列表
   */
  public show(groups: Array<PropertyGroup>): void {
    this._panelManager.setPropertyGroups(groups);
  }

  /**
   * 清空右侧属性面板，并解除当前刷新构建器
   */
  public clear(): void {
    this._groupBuilder = null;
    this._panelManager.setPropertyGroups([]);
  }

  /**
   * 绑定当前属性面板刷新构建器
   * @param builder - 属性分组构建函数，传 null 表示解除绑定
   */
  public bindBuilder(builder: PropertyPanelGroupBuilder | null): void {
    this._groupBuilder = builder;
  }

  /**
   * 使用当前构建器刷新属性面板
   * @returns 是否成功执行刷新
   */
  public refresh(): boolean {
    if (this._groupBuilder === null) {
      return false;
    }

    const groups: Array<PropertyGroup> = this._groupBuilder();
    this.show(groups);
    return true;
  }

  /**
   * 按属性项 ID 触发业务值修改回调
   * @param itemId - 属性项唯一标识
   * @param value - 新属性值
   * @returns 是否成功触发修改
   */
  public changeItemValue(itemId: string, value: PropertyPanelValue): boolean {
    const item: PropertyItem | null = this._panelManager.findPropertyItem(itemId);
    if (item === null) {
      return false;
    }

    /* 根据控件类型调用对应回调，使外部调用与用户在 UI 中编辑保持一致。 */
    if ((item.type === 'number' || item.type === 'slider') && typeof value === 'number') {
      if (item.type === 'number' && item.readonly === true) {
        return false;
      }
      item.onChange(value);
      return true;
    }

    if ((item.type === 'color' || item.type === 'select') && typeof value === 'string') {
      item.onChange(value);
      return true;
    }

    if (item.type === 'toggle' && typeof value === 'boolean') {
      item.onChange(value);
      return true;
    }

    return false;
  }

  /**
   * 仅更新属性项显示值，不触发业务修改回调
   * @param itemId - 属性项唯一标识
   * @param value - 新显示值
   * @returns 是否成功更新显示值
   */
  public updateItemValue(itemId: string, value: PropertyPanelValue): boolean {
    return this._panelManager.updatePropertyItemValue(itemId, value);
  }

  /**
   * 释放控制器持有的刷新构建器引用
   */
  public dispose(): void {
    this._groupBuilder = null;
  }
}