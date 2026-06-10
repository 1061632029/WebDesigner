/**
 * 直墙创建命令
 * execute：添加指定直墙数据；undo：移除该直墙。
 * 用于将交互式直墙绘制纳入统一撤销/重做命令栈。
 */

import type { ICommand } from '../ICommand';
import type { StraightWallData } from '../../building/BuildingTypes';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';

/**
 * 直墙创建命令
 * 持有直墙数据快照，确保撤销后重做仍恢复同一 ID 与同一几何参数。
 */
export class StraightWallCreateCommand implements ICommand {
  /** 命令标签，用于历史 UI 展示 */
  public readonly label: string = '创建直墙';

  /** 建筑对象管理器引用 */
  private readonly _manager: BuildingObjectManager;

  /** 直墙数据快照 */
  private readonly _wallData: StraightWallData;

  /**
   * @param manager - 建筑对象管理器
   * @param wallData - 待创建的直墙数据
   */
  public constructor(manager: BuildingObjectManager, wallData: StraightWallData) {
    this._manager = manager;
    this._wallData = StraightWallCreateCommand._cloneWallData(wallData);
  }

  /**
   * 执行创建流程
   * 关键逻辑：向 BuildingObjectManager 添加直墙数据副本，由管理器负责创建 Mesh、连接端点与通知监听器。
   */
  public execute(): void {
    this._manager.addObject(StraightWallCreateCommand._cloneWallData(this._wallData));
  }

  /**
   * 撤销创建流程
   * 关键逻辑：按固定 ID 移除直墙，管理器会同步清理 Mesh 与墙体连接。
   */
  public undo(): void {
    this._manager.removeObject(this._wallData.id);
  }

  /**
   * 深拷贝直墙数据
   * @param wallData - 原始直墙数据
   * @returns 克隆后的直墙数据
   */
  private static _cloneWallData(wallData: StraightWallData): StraightWallData {
    return JSON.parse(JSON.stringify(wallData)) as StraightWallData;
  }
}