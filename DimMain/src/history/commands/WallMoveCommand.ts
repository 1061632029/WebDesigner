/**
 * 墙体拖拽移动命令
 * 用于 2D 平面视图中记录直墙沿墙面法向方向的拖拽位移，支持撤销/重做。
 * 若墙体端点连接其他直墙，执行时会保持连接墙体原布置方向，仅调整连接墙体长度。
 */

import type { ICommand } from '../ICommand';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';
import type { Point2D } from '../../building/BuildingTypes';

/** 墙体拖拽移动命令。 */
export class WallMoveCommand implements ICommand {
  /** 命令标签，用于 UI 显示。 */
  public readonly label: string;

  /** 建筑对象管理器。 */
  private readonly _objectManager: BuildingObjectManager;

  /** 被拖拽的直墙 ID。 */
  private readonly _wallId: string;

  /** 本次拖拽的法向位移。 */
  private readonly _offset: Point2D;

  /**
   * @param objectManager - 建筑对象管理器
   * @param wallId - 被拖拽的直墙 ID
   * @param offset - 本次拖拽的 XZ 平面法向位移
   * @param label - 命令显示标签
   */
  public constructor(
    objectManager: BuildingObjectManager,
    wallId: string,
    offset: Point2D,
    label: string = '拖拽移动墙体'
  ) {
    this._objectManager = objectManager;
    this._wallId = wallId;
    this._offset = { x: offset.x, z: offset.z };
    this.label = label;
  }

  /** 执行或重做墙体移动，并通过对象管理器同步连接墙体方向约束和封闭区域表面。 */
  public execute(): void {
    /* 拖拽流程完成后基于受影响墙体重新检测封闭区域，封闭时刷新楼板、天花板及其驱动标注。 */
    const affectedWallIds: string[] = this._objectManager.moveStraightWallWithConnections(this._wallId, this._offset);
    if (affectedWallIds.length > 0) {
      this._objectManager.refreshClosedSurfacesForWalls(affectedWallIds);
    }
  }

  /** 撤销墙体移动，使用反向法向位移恢复墙体、连接节点和封闭区域表面。 */
  public undo(): void {
    /* 撤销同样会改变封闭环轮廓，需要再次刷新楼板、天花板和楼板标注数据。 */
    const affectedWallIds: string[] = this._objectManager.moveStraightWallWithConnections(this._wallId, {
      x: -this._offset.x,
      z: -this._offset.z,
    });
    if (affectedWallIds.length > 0) {
      this._objectManager.refreshClosedSurfacesForWalls(affectedWallIds);
    }
  }
}