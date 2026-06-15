/**
 * 梁衔接点拖拽移动命令
 * 用于 2D 平面视图中记录梁衔接点圆片的拖拽位移，支持撤销/重做。
 */

import type { ICommand } from '../ICommand';
import type { BeamJointDragSnapshot, BuildingObjectManager } from '../../building/BuildingObjectManager';
import type { Point2D } from '../../building/BuildingTypes';

/** 梁衔接点拖拽移动命令。 */
export class BeamJointMoveCommand implements ICommand {
  /** 命令标签，用于 UI 显示。 */
  public readonly label: string;

  /** 建筑对象管理器。 */
  private readonly _objectManager: BuildingObjectManager;

  /** 拖拽开始时的衔接点及关联梁端点快照。 */
  private readonly _snapshot: BeamJointDragSnapshot;

  /** 本次拖拽的 XZ 平面位移。 */
  private readonly _offset: Point2D;

  /**
   * 构造梁衔接点拖拽移动命令。
   * @param objectManager - 建筑对象管理器
   * @param snapshot - 拖拽开始时的衔接点及关联梁端点快照
   * @param offset - 本次拖拽的 XZ 平面位移
   * @param label - 命令显示标签
   */
  public constructor(
    objectManager: BuildingObjectManager,
    snapshot: BeamJointDragSnapshot,
    offset: Point2D,
    label: string = '拖拽移动梁衔接点'
  ) {
    this._objectManager = objectManager;
    this._snapshot = snapshot;
    this._offset = { x: offset.x, z: offset.z };
    this.label = label;
  }

  /** 执行或重做梁衔接点移动，并通过对象管理器同步梁长度与斜接几何。 */
  public execute(): void {
    /* 执行流程使用拖拽开始快照 + 目标位移恢复绝对态，避免重复执行时继续累加偏移。 */
    this._objectManager.moveBeamJointFromSnapshot(this._snapshot, this._offset);
  }

  /** 撤销梁衔接点移动，恢复拖拽开始快照中的梁端点状态。 */
  public undo(): void {
    /* 撤销流程恢复到快照原点，而不是基于当前状态叠加反向偏移，防止重复撤销造成梁端点错位。 */
    this._objectManager.moveBeamJointFromSnapshot(this._snapshot, { x: 0, z: 0 });
  }
}