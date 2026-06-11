/**
 * 直墙厚度修改命令
 * 用于属性面板修改墙厚时，记录厚度变更并触发布置方向右侧缩进、连接节点重算和相邻墙体几何刷新。
 */

import type { ICommand } from '../ICommand';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';

/** 直墙厚度修改命令。 */
export class WallThicknessChangeCommand implements ICommand {
  /** 命令标签，用于 UI 显示。 */
  public readonly label: string;

  /** 建筑对象管理器。 */
  private readonly _objectManager: BuildingObjectManager;

  /** 被修改厚度的直墙 ID。 */
  private readonly _wallId: string;

  /** 修改前墙厚（米）。 */
  private readonly _beforeThickness: number;

  /** 修改后墙厚（米）。 */
  private readonly _afterThickness: number;

  /**
   * @param objectManager - 建筑对象管理器
   * @param wallId - 被修改厚度的直墙 ID
   * @param beforeThickness - 修改前墙厚（米）
   * @param afterThickness - 修改后墙厚（米）
   * @param label - 命令显示标签
   */
  public constructor(
    objectManager: BuildingObjectManager,
    wallId: string,
    beforeThickness: number,
    afterThickness: number,
    label: string = '修改墙厚'
  ) {
    this._objectManager = objectManager;
    this._wallId = wallId;
    this._beforeThickness = beforeThickness;
    this._afterThickness = afterThickness;
    this.label = label;
  }

  /** 执行或重做墙厚修改，并刷新受影响封闭区域表面。 */
  public execute(): void {
    /* 墙厚变化会移动中心线和衔接节点，封闭环轮廓也可能变化，需要刷新楼板与天花板。 */
    const affectedWallIds: string[] = this._objectManager.updateStraightWallThicknessWithRightIndent(
      this._wallId,
      this._afterThickness
    );
    if (affectedWallIds.length > 0) {
      this._objectManager.refreshClosedSurfacesForWalls(affectedWallIds);
    }
  }

  /** 撤销墙厚修改，并按当前布置方向右侧反向缩进恢复中心线和连接几何。 */
  public undo(): void {
    /* 撤销流程同样通过对象管理器统一重算连接节点，保证墙体 Mesh、洞口和封闭表面一致。 */
    const affectedWallIds: string[] = this._objectManager.updateStraightWallThicknessWithRightIndent(
      this._wallId,
      this._beforeThickness
    );
    if (affectedWallIds.length > 0) {
      this._objectManager.refreshClosedSurfacesForWalls(affectedWallIds);
    }
  }
}