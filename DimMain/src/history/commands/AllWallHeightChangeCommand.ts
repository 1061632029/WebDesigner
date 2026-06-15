/**
 * 全局楼层高修改命令
 * 一次性同步所有墙体高度与所有天花板底面高度，并支持撤销/重做。
 */

import type { BuildingObjectManager } from '../../building/BuildingObjectManager';
import type { BuildingObject, CeilingData, WallData } from '../../building/BuildingTypes';
import type { ICommand } from '../ICommand';

/** 墙体高度快照。 */
interface WallHeightSnapshot {
  /** 墙体 ID。 */
  id: string;
  /** 墙体高度（米）。 */
  height: number;
}

/** 天花板高度快照。 */
interface CeilingHeightSnapshot {
  /** 天花板 ID。 */
  id: string;
  /** 天花板底面高度（米）。 */
  bottomOffset: number;
}

/**
 * 全局楼层高修改命令
 */
export class AllWallHeightChangeCommand implements ICommand {
  /** 命令标签。 */
  public readonly label: string;

  /** 建筑对象管理器。 */
  private readonly _objectManager: BuildingObjectManager;

  /** 修改前墙体高度快照。 */
  private readonly _beforeWalls: WallHeightSnapshot[];

  /** 修改前天花板高度快照。 */
  private readonly _beforeCeilings: CeilingHeightSnapshot[];

  /** 修改后的统一楼层高（米）。 */
  private readonly _afterHeight: number;

  /** 执行/撤销后刷新属性面板的回调。 */
  private readonly _onAfterApply: () => void;

  /**
   * @param objectManager - 建筑对象管理器。
   * @param afterHeight - 修改后的统一楼层高（米）。
   * @param onAfterApply - 执行或撤销后刷新外部界面的回调。
   * @param label - 命令标签。
   */
  public constructor(
    objectManager: BuildingObjectManager,
    afterHeight: number,
    onAfterApply: () => void,
    label: string = '修改楼层高'
  ) {
    this._objectManager = objectManager;
    this._afterHeight = afterHeight;
    this._onAfterApply = onAfterApply;
    this.label = label;
    this._beforeWalls = [];
    this._beforeCeilings = [];

    const objects: BuildingObject[] = objectManager.getAll();
    for (let objectIndex: number = 0; objectIndex < objects.length; objectIndex++) {
      const objectData: BuildingObject = objects[objectIndex] as BuildingObject;
      if (objectData.category === 'wall') {
        const wallData: WallData = objectData as WallData;
        this._beforeWalls.push({ id: wallData.id, height: wallData.height });
      }

      if (objectData.category === 'ceiling') {
        const ceilingData: CeilingData = objectData as CeilingData;
        this._beforeCeilings.push({ id: ceilingData.id, bottomOffset: ceilingData.bottomOffset });
      }
    }
  }

  /**
   * 执行命令：同步所有墙体高度和所有天花板底面高度为新的楼层高。
   */
  public execute(): void {
    this._applyUniformHeight(this._afterHeight);
    this._onAfterApply();
  }

  /**
   * 撤销命令：恢复所有墙体高度和所有天花板底面高度到修改前快照。
   */
  public undo(): void {
    this._restoreSnapshots();
    this._onAfterApply();
  }

  /**
   * 将所有墙体与天花板统一应用为指定楼层高。
   * @param height - 目标楼层高（米）。
   */
  private _applyUniformHeight(height: number): void {
    /* 先更新天花板 bottomOffset，保证与天花板绑定的墙体会通过管理器既有逻辑同步到同一高度。 */
    for (let ceilingIndex: number = 0; ceilingIndex < this._beforeCeilings.length; ceilingIndex++) {
      const ceilingSnapshot: CeilingHeightSnapshot = this._beforeCeilings[ceilingIndex] as CeilingHeightSnapshot;
      this._objectManager.updateObject(ceilingSnapshot.id, { bottomOffset: height } as Partial<CeilingData>);
    }

    /* 再显式更新所有墙体，覆盖未绑定天花板的墙体，确保全屋墙体高度一致。 */
    for (let wallIndex: number = 0; wallIndex < this._beforeWalls.length; wallIndex++) {
      const wallSnapshot: WallHeightSnapshot = this._beforeWalls[wallIndex] as WallHeightSnapshot;
      this._objectManager.updateObject(wallSnapshot.id, { height: height } as Partial<WallData>);
    }
  }

  /**
   * 按构造时捕获的快照恢复墙体和天花板高度。
   */
  private _restoreSnapshots(): void {
    /* 先恢复天花板高度，使绑定墙体按原天花板底面高度联动；随后逐墙恢复，保留无绑定墙体原高度。 */
    for (let ceilingIndex: number = 0; ceilingIndex < this._beforeCeilings.length; ceilingIndex++) {
      const ceilingSnapshot: CeilingHeightSnapshot = this._beforeCeilings[ceilingIndex] as CeilingHeightSnapshot;
      this._objectManager.updateObject(
        ceilingSnapshot.id,
        { bottomOffset: ceilingSnapshot.bottomOffset } as Partial<CeilingData>
      );
    }

    for (let wallIndex: number = 0; wallIndex < this._beforeWalls.length; wallIndex++) {
      const wallSnapshot: WallHeightSnapshot = this._beforeWalls[wallIndex] as WallHeightSnapshot;
      this._objectManager.updateObject(wallSnapshot.id, { height: wallSnapshot.height } as Partial<WallData>);
    }
  }
}