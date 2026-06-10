/**
 * 创建建筑对象命令
 * execute：将对象加入 BuildingObjectManager；undo：移除该对象
 * 命令在栈内持有数据快照（深拷贝），保证 redo 可重建相同对象
 */

import type { ICommand } from '../ICommand';
import type { BuildingObject } from '../../building/BuildingTypes';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';

/**
 * 创建对象命令
 */
export class CreateCommand implements ICommand {
  /** 命令标签 */
  public readonly label: string;

  /** 建筑对象管理器引用 */
  private readonly _manager: BuildingObjectManager;

  /** 待创建对象的数据快照（深拷贝，保证 redo 恢复时不受外部 mutate 影响） */
  private readonly _data: BuildingObject;

  /**
   * @param manager - 建筑对象管理器
   * @param data - 待创建对象的数据（构造时立即深拷贝）
   * @param label - 命令标签，默认按对象类别生成
   */
  public constructor(manager: BuildingObjectManager, data: BuildingObject, label?: string) {
    this._manager = manager;
    /* 深拷贝避免外部修改影响 redo 时的恢复数据 */
    this._data = CreateCommand._deepClone(data);
    this.label = label !== undefined ? label : `创建 ${data.category}`;
  }

  /**
   * 执行创建：将对象加入管理器
   */
  public execute(): void {
    /* 用快照副本添加，避免管理器内部 mutate 反作用到本命令的数据 */
    this._manager.addObject(CreateCommand._deepClone(this._data));
  }

  /**
   * 撤销创建：从管理器移除对象
   */
  public undo(): void {
    this._manager.removeObject(this._data.id);
  }

  /**
   * 深拷贝建筑对象数据
   * 因 BuildingObject 仅由 JSON 安全类型组成（无函数、循环引用、Date 等），
   * 这里使用结构化克隆的简化实现
   */
  private static _deepClone(data: BuildingObject): BuildingObject {
    return JSON.parse(JSON.stringify(data)) as BuildingObject;
  }
}
