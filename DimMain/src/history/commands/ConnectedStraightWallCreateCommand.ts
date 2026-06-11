/**
 * 连续直墙创建命令
 * execute：可选修正上一段直墙端点并添加当前直墙；undo：移除当前直墙并还原上一段直墙。
 * 用于把“绘制线为墙内侧线”时的连续墙角衔接纳入统一撤销/重做流程。
 */

import type { ICommand } from '../ICommand';
import type { Point2D, StraightWallData } from '../../building/BuildingTypes';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';

/** 上一段直墙端点修正参数。 */
export interface PreviousStraightWallEndpointUpdate {
  /** 上一段直墙 ID。 */
  wallId: string;
  /** 上一段直墙执行创建前的中心线终点。 */
  previousEnd: Point2D;
  /** 上一段直墙与当前段衔接后的中心线终点。 */
  nextEnd: Point2D;
}

/**
 * 连续直墙创建命令。
 * 关键约束：只负责连续绘制时相邻两段的中心线端点衔接，不改变墙体数据模型仍存中心线的约定。
 */
export class ConnectedStraightWallCreateCommand implements ICommand {
  /** 命令标签，用于历史 UI 展示。 */
  public readonly label: string = '创建连续直墙';

  /** 建筑对象管理器引用。 */
  private readonly _manager: BuildingObjectManager;

  /** 当前待创建直墙数据快照。 */
  private readonly _wallData: StraightWallData;

  /** 上一段直墙端点修正参数；首段连续直墙为 null。 */
  private readonly _previousWallUpdate: PreviousStraightWallEndpointUpdate | null;

  /**
   * @param manager - 建筑对象管理器
   * @param wallData - 当前待创建直墙数据
   * @param previousWallUpdate - 上一段直墙端点修正参数；没有上一段时传入 null
   */
  public constructor(
    manager: BuildingObjectManager,
    wallData: StraightWallData,
    previousWallUpdate: PreviousStraightWallEndpointUpdate | null
  ) {
    this._manager = manager;
    this._wallData = ConnectedStraightWallCreateCommand._cloneWallData(wallData);
    this._previousWallUpdate = ConnectedStraightWallCreateCommand._clonePreviousUpdate(previousWallUpdate);
  }

  /**
   * 执行连续直墙创建流程。
   * 关键流程：先修正上一段墙体衔接端点，再添加当前墙体，确保墙角中心线在同一交点闭合。
   */
  public execute(): void {
    if (this._previousWallUpdate !== null) {
      this._manager.updateObject(
        this._previousWallUpdate.wallId,
        { end: ConnectedStraightWallCreateCommand._clonePoint(this._previousWallUpdate.nextEnd) } as Partial<StraightWallData>
      );
    }

    this._manager.addObject(ConnectedStraightWallCreateCommand._cloneWallData(this._wallData));
  }

  /**
   * 撤销连续直墙创建流程。
   * 关键流程：先移除当前墙体，再把上一段墙体端点恢复到创建前状态。
   */
  public undo(): void {
    this._manager.removeObject(this._wallData.id);

    if (this._previousWallUpdate !== null) {
      this._manager.updateObject(
        this._previousWallUpdate.wallId,
        { end: ConnectedStraightWallCreateCommand._clonePoint(this._previousWallUpdate.previousEnd) } as Partial<StraightWallData>
      );
    }
  }

  /**
   * 深拷贝直墙数据。
   * @param wallData - 原始直墙数据
   * @returns 克隆后的直墙数据
   */
  private static _cloneWallData(wallData: StraightWallData): StraightWallData {
    return JSON.parse(JSON.stringify(wallData)) as StraightWallData;
  }

  /**
   * 深拷贝上一段直墙端点修正参数。
   * @param update - 原始修正参数
   * @returns 克隆后的修正参数；输入为 null 时返回 null
   */
  private static _clonePreviousUpdate(update: PreviousStraightWallEndpointUpdate | null): PreviousStraightWallEndpointUpdate | null {
    if (update === null) {
      return null;
    }

    return {
      wallId: update.wallId,
      previousEnd: ConnectedStraightWallCreateCommand._clonePoint(update.previousEnd),
      nextEnd: ConnectedStraightWallCreateCommand._clonePoint(update.nextEnd),
    };
  }

  /**
   * 克隆二维点，避免命令外部继续修改引用。
   * @param point - 原始二维点
   * @returns 克隆后的二维点
   */
  private static _clonePoint(point: Point2D): Point2D {
    return { x: point.x, z: point.z };
  }
}