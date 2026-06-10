/**
 * 梁创建命令
 * execute：添加指定梁数据；undo：移除该梁。
 */

import type { ICommand } from '../ICommand';
import type { BeamData } from '../../building/BuildingTypes';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';

/** 梁创建命令 */
export class BeamCreateCommand implements ICommand {
  /** 命令标签，用于历史 UI 展示 */
  public readonly label: string = '创建梁';

  /** 建筑对象管理器引用 */
  private readonly _manager: BuildingObjectManager;

  /** 梁数据快照 */
  private readonly _beamData: BeamData;

  /**
   * @param manager - 建筑对象管理器
   * @param beamData - 待创建的梁数据
   */
  public constructor(manager: BuildingObjectManager, beamData: BeamData) {
    this._manager = manager;
    this._beamData = BeamCreateCommand._cloneBeamData(beamData);
  }

  /** 执行创建流程，将梁数据副本交由对象管理器创建 Mesh。 */
  public execute(): void {
    this._manager.addObject(BeamCreateCommand._cloneBeamData(this._beamData));
  }

  /** 撤销创建流程，按固定 ID 移除梁构件。 */
  public undo(): void {
    this._manager.removeObject(this._beamData.id);
  }

  /**
   * 深拷贝梁数据
   * @param beamData - 原始梁数据
   * @returns 克隆后的梁数据
   */
  private static _cloneBeamData(beamData: BeamData): BeamData {
    return JSON.parse(JSON.stringify(beamData)) as BeamData;
  }
}