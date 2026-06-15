/**
 * 墙体拖拽移动命令
 * 用于 2D 平面视图中记录直墙沿墙面法向方向的拖拽位移，支持撤销/重做。
 * 若墙体端点连接其他直墙，执行时会保持连接墙体原布置方向，仅调整连接墙体长度。
 */

import type { ICommand } from '../ICommand';
import type { BuildingObjectManager, StraightWallDragSnapshot } from '../../building/BuildingObjectManager';
import type { Point2D } from '../../building/BuildingTypes';

/** 墙体拖拽移动命令。 */
export class WallMoveCommand implements ICommand {
  /** 命令标签，用于 UI 显示。 */
  public readonly label: string;

  /** 建筑对象管理器。 */
  private readonly _objectManager: BuildingObjectManager;

  /** 拖拽开始时的墙体、连接节点和吸附门窗快照。 */
  private readonly _snapshot: StraightWallDragSnapshot;

  /** 本次拖拽的法向位移。 */
  private readonly _offset: Point2D;

  /**
   * @param objectManager - 建筑对象管理器
   * @param snapshot - 拖拽开始时的墙体、连接节点和吸附门窗快照
   * @param offset - 本次拖拽的 XZ 平面法向位移
   * @param label - 命令显示标签
   */
  public constructor(
    objectManager: BuildingObjectManager,
    snapshot: StraightWallDragSnapshot,
    offset: Point2D,
    label: string = '拖拽移动墙体'
  ) {
    this._objectManager = objectManager;
    this._snapshot = snapshot;
    this._offset = { x: offset.x, z: offset.z };
    this.label = label;
  }

  /** 执行或重做墙体移动，并通过对象管理器同步连接墙体方向约束和封闭区域表面。 */
  public execute(): void {
    /* 执行流程使用拖拽开始快照 + 目标位移恢复绝对态，避免重复执行时继续累加同向偏移。 */
    const affectedWallIds: string[] = this._objectManager.moveStraightWallWithConnectionsFromSnapshot(
      this._snapshot,
      this._offset
    );
    if (affectedWallIds.length > 0) {
      this._objectManager.refreshClosedSurfacesForWalls(affectedWallIds);
    }
  }

  /** 撤销墙体移动，恢复拖拽开始快照中的墙体、连接节点和封闭区域表面。 */
  public undo(): void {
    /* 撤销流程恢复到快照原点，而不是基于当前状态叠加反向偏移，防止重复撤销造成墙体变形。 */
    const affectedWallIds: string[] = this._objectManager.moveStraightWallWithConnectionsFromSnapshot(
      this._snapshot,
      { x: 0, z: 0 }
    );
    if (affectedWallIds.length > 0) {
      this._objectManager.refreshClosedSurfacesForWalls(affectedWallIds);
    }
  }
}