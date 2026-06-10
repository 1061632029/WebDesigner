/**
 * 删除建筑对象命令
 * 关键设计：execute（删除）时仅从管理器与场景 detach，不立即 dispose 其 GPU 资源；
 * 只有当本命令被栈丢弃（超出深度上限）或重做后再次执行时，才真正释放。
 * 这样保证撤销操作可重建完全相同的对象（含纹理 / 子组件等已无法用序列化还原的部分）。
 *
 * 注意：当前 BuildingObjectManager.removeObject 内部会调用 geometry/material.dispose，
 * 为保证 undo 能恢复对象，本命令在 execute 时仅保存对象数据快照并调用 removeObject；
 * undo 时通过 addObject 重建对象（几何与材质会被重新创建）。
 * 这是 V1 实现的折中方案：GPU 资源会重建一次，但功能正确。
 */

import type { ICommand } from '../ICommand';
import type { BuildingObject } from '../../building/BuildingTypes';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';

/**
 * 删除对象命令
 */
export class DeleteCommand implements ICommand {
  /** 命令标签 */
  public readonly label: string;

  /** 建筑对象管理器引用 */
  private readonly _manager: BuildingObjectManager;

  /** 待删除对象的数据快照（深拷贝，供 undo 重建用） */
  private readonly _snapshot: BuildingObject;

  /**
   * @param manager - 建筑对象管理器
   * @param objectId - 待删除对象 ID（构造时立即读取并深拷贝数据快照）
   * @throws 当对象 ID 不存在时抛出错误
   */
  public constructor(manager: BuildingObjectManager, objectId: string) {
    this._manager = manager;

    /* 读取当前对象数据并深拷贝保存，作为 undo 重建依据 */
    const current: BuildingObject | undefined = manager.getById(objectId);
    if (current === undefined) {
      throw new Error(`DeleteCommand: 对象 ${objectId} 不存在，无法创建删除命令`);
    }
    this._snapshot = DeleteCommand._deepClone(current);
    this.label = `删除 ${current.category} (${current.name})`;
  }

  /**
   * 执行删除：从管理器移除对象（会同步触发 Mesh / 几何 / 材质的释放）
   */
  public execute(): void {
    this._manager.removeObject(this._snapshot.id);
  }

  /**
   * 撤销删除：使用数据快照重新创建对象
   */
  public undo(): void {
    /* 用快照副本添加，避免外部 mutate 污染原始快照 */
    this._manager.addObject(DeleteCommand._deepClone(this._snapshot));
  }

  /**
   * 命令被栈丢弃时的清理：当前不持有 GPU 资源（execute 已 dispose 了），无需额外释放
   */
  public dispose(): void {
    /* 快照仅为纯数据，由 GC 回收即可 */
  }

  /**
   * 深拷贝建筑对象数据
   */
  private static _deepClone(data: BuildingObject): BuildingObject {
    return JSON.parse(JSON.stringify(data)) as BuildingObject;
  }
}
