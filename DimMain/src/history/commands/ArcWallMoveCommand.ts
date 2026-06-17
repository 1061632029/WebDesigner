/**
 * 弧形墙拖拽移动命令。
 * 用于记录弧形墙沿“圆心到弦中心点”所在直线的拖拽位移，支持撤销与重做。
 */

import type { ICommand } from '../ICommand';
import type { ArcWallDragSnapshot, BuildingObjectManager } from '../../building/BuildingObjectManager';
import type { Point2D } from '../../building/BuildingTypes';

/** 弧形墙拖拽移动命令。 */
export class ArcWallMoveCommand implements ICommand {
  /** 命令标签，用于 UI 显示。 */
  public readonly label: string;

  /** 建筑对象管理器。 */
  private readonly _objectManager: BuildingObjectManager;

  /** 拖拽开始时的弧形墙快照。 */
  private readonly _snapshot: ArcWallDragSnapshot;

  /** 本次拖拽沿圆心到弦中心线方向产生的位移。 */
  private readonly _offset: Point2D;

  /**
   * @param objectManager - 建筑对象管理器
   * @param snapshot - 拖拽开始时的弧形墙快照
   * @param offset - 本次拖拽的 XZ 平面位移
   * @param label - 命令显示标签
   */
  public constructor(
    objectManager: BuildingObjectManager,
    snapshot: ArcWallDragSnapshot,
    offset: Point2D,
    label: string = '拖拽移动弧形墙'
  ) {
    this._objectManager = objectManager;
    this._snapshot = snapshot;
    this._offset = { x: offset.x, z: offset.z };
    this.label = label;
  }

  /** 执行或重做弧形墙移动，并刷新受影响的封闭区域表面。 */
  public execute(): void {
    /* 执行流程始终使用拖拽开始快照 + 目标位移恢复绝对态，避免重复执行时累加偏移。 */
    const affectedWallIds: string[] = this._objectManager.moveArcWallFromSnapshot(this._snapshot, this._offset);
    if (affectedWallIds.length > 0) {
      this._objectManager.refreshClosedSurfacesForWalls(affectedWallIds);
    }
  }

  /** 撤销弧形墙移动，恢复拖拽开始时的位置。 */
  public undo(): void {
    /* 撤销流程恢复到快照原点，确保撤销/重做不会因当前预览状态产生漂移。 */
    const affectedWallIds: string[] = this._objectManager.moveArcWallFromSnapshot(this._snapshot, { x: 0, z: 0 });
    if (affectedWallIds.length > 0) {
      this._objectManager.refreshClosedSurfacesForWalls(affectedWallIds);
    }
  }
}