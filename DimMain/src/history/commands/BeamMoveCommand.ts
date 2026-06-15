/**
 * 梁方向拖拽移动命令
 * 用于 2D 平面视图中记录梁沿截面宽度方向的拖拽位移，支持撤销/重做。
 */

import type { ICommand } from '../ICommand';
import type { BeamDragSnapshot, BuildingObjectManager } from '../../building/BuildingObjectManager';
import type { Point2D } from '../../building/BuildingTypes';

/** 梁方向拖拽移动命令。 */
export class BeamMoveCommand implements ICommand {
  /** 命令标签，用于 UI 显示。 */
  public readonly label: string;

  /** 建筑对象管理器。 */
  private readonly _objectManager: BuildingObjectManager;

  /** 拖拽开始时的梁及相邻梁端点快照。 */
  private readonly _snapshot: BeamDragSnapshot;

  /** 本次拖拽的方向偏移。 */
  private readonly _offset: Point2D;

  /**
   * @param objectManager - 建筑对象管理器
   * @param snapshot - 拖拽开始时的梁及相邻梁端点快照
   * @param offset - 本次拖拽的 XZ 平面方向偏移
   * @param label - 命令显示标签
   */
  public constructor(
    objectManager: BuildingObjectManager,
    snapshot: BeamDragSnapshot,
    offset: Point2D,
    label: string = '拖拽移动梁'
  ) {
    this._objectManager = objectManager;
    this._snapshot = snapshot;
    this._offset = { x: offset.x, z: offset.z };
    this.label = label;
  }

  /** 执行或重做梁移动，并通过对象管理器同步梁长度与相邻梁斜接。 */
  public execute(): void {
    /* 执行流程使用拖拽开始快照 + 目标位移恢复绝对态，避免重复执行时继续累加偏移。 */
    this._objectManager.moveBeamFromSnapshot(this._snapshot, this._offset);
  }

  /** 撤销梁移动，恢复拖拽开始快照中的梁位置与相邻梁斜接。 */
  public undo(): void {
    /* 撤销流程恢复到快照原点，而不是基于当前状态叠加反向偏移，防止重复撤销造成梁变形。 */
    this._objectManager.moveBeamFromSnapshot(this._snapshot, { x: 0, z: 0 });
  }
}