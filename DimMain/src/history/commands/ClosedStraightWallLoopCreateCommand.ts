/**
 * 闭合连续直墙创建命令
 * execute：批量回写已有连续墙中心线并创建最后闭合段；undo：删除闭合段并还原已有墙体中心线。
 * 用于保证“绘制线为墙内侧线”的多段墙闭合时首尾墙角由完整闭合轮廓统一计算。
 */

import * as THREE from 'three/webgpu';
import type { ICommand } from '../ICommand';
import type { Point2D, SlabData, StraightWallData } from '../../building/BuildingTypes';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';
import type { GeneratedSurfaceSignatureSnapshot } from '../../building/BuildingObjectManager';
import { WallCascadeDeleteCommand } from './WallCascadeDeleteCommand';

/** 闭合前已有直墙中心线更新参数。 */
export interface ClosedLoopStraightWallUpdate {
  /** 需要回写的直墙 ID。 */
  wallId: string;
  /** 执行闭合前的中心线起点。 */
  previousStart: Point2D;
  /** 执行闭合前的中心线终点。 */
  previousEnd: Point2D;
  /** 按闭合内侧轮廓重新计算后的中心线起点。 */
  nextStart: Point2D;
  /** 按闭合内侧轮廓重新计算后的中心线终点。 */
  nextEnd: Point2D;
}

/**
 * 闭合连续直墙创建命令。
 * 关键约束：闭合时以完整内侧多边形为唯一输入，避免某一段先被偏移后又作为下一段端点参与偏移。
 */
export class ClosedStraightWallLoopCreateCommand implements ICommand {
  /** 命令标签，用于历史 UI 展示。 */
  public readonly label: string = '闭合连续直墙';

  /** 建筑对象管理器引用。 */
  private readonly _manager: BuildingObjectManager;

  /** Three.js 场景引用，用于撤销创建时级联删除依赖对象。 */
  private readonly _scene: THREE.Scene;

  /** 最后一段闭合直墙数据快照。 */
  private readonly _closingWallData: StraightWallData;

  /** 已有直墙批量回写快照。 */
  private readonly _wallUpdates: ClosedLoopStraightWallUpdate[];

  /** 最近一次撤销闭合段时生成的级联删除命令。 */
  private _cascadeDeleteCommand: WallCascadeDeleteCommand | null = null;

  /** 首次执行前的楼板/天花板自动生成签名缓存快照。 */
  private _beforeSignatureSnapshot: GeneratedSurfaceSignatureSnapshot | null = null;

  /** 首次执行后的楼板/天花板自动生成签名缓存快照。 */
  private _afterSignatureSnapshot: GeneratedSurfaceSignatureSnapshot | null = null;

  /** 首次执行前的楼板完整数据快照，用于撤销子空间冲孔。 */
  private _beforeSlabSnapshot: SlabData[] | null = null;

  /** 首次执行后的楼板完整数据快照，用于重做子空间冲孔。 */
  private _afterSlabSnapshot: SlabData[] | null = null;

  /**
   * @param manager - 建筑对象管理器
   * @param scene - Three.js 场景
   * @param closingWallData - 最后一段闭合直墙数据
   * @param wallUpdates - 闭合前已有连续墙中心线回写列表
   */
  public constructor(
    manager: BuildingObjectManager,
    scene: THREE.Scene,
    closingWallData: StraightWallData,
    wallUpdates: ClosedLoopStraightWallUpdate[]
  ) {
    this._manager = manager;
    this._scene = scene;
    this._closingWallData = ClosedStraightWallLoopCreateCommand._cloneWallData(closingWallData);
    this._wallUpdates = wallUpdates.map((update: ClosedLoopStraightWallUpdate): ClosedLoopStraightWallUpdate =>
      ClosedStraightWallLoopCreateCommand._cloneWallUpdate(update)
    );
  }

  /**
   * 执行闭合连续墙创建流程。
   * 关键流程：先回写已有墙段到闭合轮廓中心线，再创建最后闭合段，保证首尾墙角连续。
   */
  public execute(): void {
    const isFirstExecute: boolean = this._beforeSignatureSnapshot === null;
    if (isFirstExecute) {
      /* 关键流程：闭合前先捕获楼板与签名状态，便于撤销时恢复被子空间冲孔/裁剪改写的原楼板。 */
      this._beforeSignatureSnapshot = this._manager.getGeneratedSurfaceSignatureSnapshot();
      this._beforeSlabSnapshot = this._manager.getSlabDataSnapshot();
    }

    if (this._cascadeDeleteCommand !== null) {
      /* 重做时先恢复撤销阶段删除的闭合墙及依赖对象，再继续确保已有墙段为闭合中心线。 */
      this._cascadeDeleteCommand.undo();
      this._cascadeDeleteCommand = null;
    } else {
      this._manager.addObject(ClosedStraightWallLoopCreateCommand._cloneWallData(this._closingWallData));
    }

    for (const update of this._wallUpdates) {
      this._manager.updateObject(
        update.wallId,
        {
          start: ClosedStraightWallLoopCreateCommand._clonePoint(update.nextStart),
          end: ClosedStraightWallLoopCreateCommand._clonePoint(update.nextEnd),
        } as Partial<StraightWallData>
      );
    }

    if (isFirstExecute) {
      /* 关键流程：闭合墙创建时会先触发一次楼板检测，但此时已有墙段尚未完成中心线回写。
       * 因此必须在闭合墙与已有墙段全部进入最终状态后，显式刷新关联墙体的楼板/天花板，
       * 避免视觉上已经闭合但自动楼板检测错过最终闭合拓扑。
       */
      const affectedWallIds: string[] = [this._closingWallData.id];
      for (const update of this._wallUpdates) {
        affectedWallIds.push(update.wallId);
      }
      this._manager.refreshClosedSurfacesForWalls(affectedWallIds);
    }

    if (isFirstExecute) {
      this._afterSignatureSnapshot = this._manager.getGeneratedSurfaceSignatureSnapshot();
      this._afterSlabSnapshot = this._manager.getSlabDataSnapshot();
    } else {
      if (this._afterSignatureSnapshot !== null) {
        this._manager.restoreGeneratedSurfaceSignatureSnapshot(this._afterSignatureSnapshot);
      }
      if (this._afterSlabSnapshot !== null) {
        /* 重做闭合子空间时恢复执行后的楼板冲孔结果，保证完全包含与部分相交场景轮廓一致。 */
        this._manager.restoreSlabDataSnapshot(this._afterSlabSnapshot);
      }
    }
  }

  /**
   * 撤销闭合连续墙创建流程。
   * 关键流程：先还原已有墙段中心线，再级联删除最后闭合段及其依赖对象。
   */
  public undo(): void {
    for (const update of this._wallUpdates) {
      /* 还原闭合前已有墙段坐标，确保撤销后连续绘制历史状态与闭合前一致。 */
      this._manager.updateObject(
        update.wallId,
        {
          start: ClosedStraightWallLoopCreateCommand._clonePoint(update.previousStart),
          end: ClosedStraightWallLoopCreateCommand._clonePoint(update.previousEnd),
        } as Partial<StraightWallData>
      );
    }

    const cascadeDeleteCommand: WallCascadeDeleteCommand = new WallCascadeDeleteCommand(
      this._manager,
      this._scene,
      [this._closingWallData.id]
    );
    cascadeDeleteCommand.execute();
    this._cascadeDeleteCommand = cascadeDeleteCommand;

    if (this._beforeSignatureSnapshot !== null) {
      this._manager.restoreGeneratedSurfaceSignatureSnapshot(this._beforeSignatureSnapshot);
    }
    if (this._beforeSlabSnapshot !== null) {
      /* 撤销闭合子空间时恢复原楼板快照，覆盖冲孔、部分相交裁剪和拆分楼板的全部副作用。 */
      this._manager.restoreSlabDataSnapshot(this._beforeSlabSnapshot);
    }
  }

  /** 释放撤销闭合段时被级联删除的依赖资源。 */
  public dispose(): void {
    if (this._cascadeDeleteCommand !== null) {
      this._cascadeDeleteCommand.dispose();
      this._cascadeDeleteCommand = null;
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
   * 深拷贝墙段回写参数。
   * @param update - 原始墙段回写参数
   * @returns 克隆后的墙段回写参数
   */
  private static _cloneWallUpdate(update: ClosedLoopStraightWallUpdate): ClosedLoopStraightWallUpdate {
    return {
      wallId: update.wallId,
      previousStart: ClosedStraightWallLoopCreateCommand._clonePoint(update.previousStart),
      previousEnd: ClosedStraightWallLoopCreateCommand._clonePoint(update.previousEnd),
      nextStart: ClosedStraightWallLoopCreateCommand._clonePoint(update.nextStart),
      nextEnd: ClosedStraightWallLoopCreateCommand._clonePoint(update.nextEnd),
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