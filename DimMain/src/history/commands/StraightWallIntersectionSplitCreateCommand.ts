/**
 * 直墙相交打断创建命令。
 * 将“创建新直墙、打断相交已有直墙、新墙自身分段”作为单个历史命令支持撤销和重做。
 */

import * as THREE from 'three/webgpu';
import type { ICommand } from '../ICommand';
import type { BuildingObject, CeilingData, Point2D, SlabData, StraightWallData } from '../../building/BuildingTypes';
import type { BuildingObjectManager, GeneratedSurfaceSignatureSnapshot } from '../../building/BuildingObjectManager';
import { Geometry2DUtils } from '../../building/manager/Geometry2DUtils';
import {
  WallIntersectionSplitPlanner,
  type WallIntersectionSplitPlan,
} from '../../building/wall-split/WallIntersectionSplitPlanner';
import type { PreviousStraightWallEndpointUpdate } from './ConnectedStraightWallCreateCommand';
import { WallCascadeDeleteCommand } from './WallCascadeDeleteCommand';

/** 缓存后的直墙相交打断执行计划。 */
interface CachedWallIntersectionSplitCommandPlan {
  /** 被打断并删除的已有直墙快照。 */
  removedExistingWalls: StraightWallData[];
  /** 命令执行期间创建的全部直墙段。 */
  createdWalls: StraightWallData[];
}

/** 直墙相交打断创建命令。 */
export class StraightWallIntersectionSplitCreateCommand implements ICommand {
  /** 命令标签，用于历史 UI 展示。 */
  public readonly label: string = '创建并打断相交直墙';

  /** 建筑对象管理器引用。 */
  private readonly _manager: BuildingObjectManager;

  /** Three.js 场景引用，用于撤销时级联移除本命令创建墙段依赖。 */
  private readonly _scene: THREE.Scene;

  /** 原始新直墙数据快照。 */
  private readonly _newWallData: StraightWallData;

  /** 连续绘制时上一段直墙端点修正参数。 */
  private readonly _previousWallUpdate: PreviousStraightWallEndpointUpdate | null;

  /** 首次执行后缓存的拆分执行计划，重做时复用以保证结果稳定。 */
  private _cachedPlan: CachedWallIntersectionSplitCommandPlan | null = null;

  /** 最近一次撤销创建墙段时生成的级联删除命令。 */
  private _cascadeDeleteCommand: WallCascadeDeleteCommand | null = null;

  /** 连续绘制应继续衔接的最后一段墙体 ID。 */
  private _continuationWallId: string;

  /** 首次执行前的楼板/天花板自动生成签名缓存快照。 */
  private _beforeSignatureSnapshot: GeneratedSurfaceSignatureSnapshot | null = null;

  /** 首次执行后的楼板/天花板自动生成签名缓存快照。 */
  private _afterSignatureSnapshot: GeneratedSurfaceSignatureSnapshot | null = null;

  /** 首次执行前的楼板完整数据快照，用于撤销封闭空间拆分。 */
  private _beforeSlabSnapshot: SlabData[] | null = null;

  /** 首次执行后的楼板完整数据快照，用于重做封闭空间拆分。 */
  private _afterSlabSnapshot: SlabData[] | null = null;

  /** 首次执行前的天花板完整数据快照，用于撤销封闭空间拆分。 */
  private _beforeCeilingSnapshot: CeilingData[] | null = null;

  /** 首次执行后的天花板完整数据快照，用于重做封闭空间拆分。 */
  private _afterCeilingSnapshot: CeilingData[] | null = null;

  /**
   * @param manager - 建筑对象管理器。
   * @param scene - Three.js 场景。
   * @param wallData - 待创建的新直墙数据。
   * @param previousWallUpdate - 连续绘制上一段端点修正参数；普通创建传入 null。
   */
  public constructor(
    manager: BuildingObjectManager,
    scene: THREE.Scene,
    wallData: StraightWallData,
    previousWallUpdate: PreviousStraightWallEndpointUpdate | null = null
  ) {
    this._manager = manager;
    this._scene = scene;
    this._newWallData = WallIntersectionSplitPlanner.cloneStraightWallData(wallData);
    this._previousWallUpdate = StraightWallIntersectionSplitCreateCommand._clonePreviousUpdate(previousWallUpdate);
    this._continuationWallId = wallData.id;
  }

  /**
   * 获取连续绘制应记录的末段墙体 ID。
   * @returns 如果新墙被拆分，返回靠近原始终点的最后一段 ID；否则返回原新墙 ID。
   */
  public getContinuationWallId(): string {
    return this._continuationWallId;
  }

  /**
   * 执行直墙创建与相交打断流程。
   * 关键流程：首次执行时生成并缓存拆分计划；重做时复用缓存计划，确保墙体 ID 和分段结果完全一致。
   */
  public execute(): void {
    const isFirstExecute: boolean = this._beforeSignatureSnapshot === null;
    if (isFirstExecute) {
      /* 关键流程：打断墙体前捕获自动表面状态，便于撤销时恢复原始楼板与天花板轮廓。 */
      this._beforeSignatureSnapshot = this._manager.getGeneratedSurfaceSignatureSnapshot();
      this._beforeSlabSnapshot = this._manager.getSlabDataSnapshot();
      this._beforeCeilingSnapshot = this._manager.getCeilingDataSnapshot();
    }

    if (this._cascadeDeleteCommand !== null) {
      /* 重做前先释放撤销阶段的级联删除快照引用，随后按缓存计划重新应用打断结果。 */
      this._cascadeDeleteCommand.dispose();
      this._cascadeDeleteCommand = null;
    }

    this._applyPreviousWallUpdateNext();

    if (this._cachedPlan === null) {
      this._cachedPlan = this._createCachedPlan();
    }

    const removedExistingWallIds: string[] = this._cachedPlan.removedExistingWalls.map((wall: StraightWallData): string => wall.id);
    const surfacesBoundToRemovedWalls: { slabIds: string[]; ceilingIds: string[] } = isFirstExecute
      ? this._manager.collectSurfaceObjectIdsBoundToWalls(removedExistingWallIds)
      : { slabIds: [], ceilingIds: [] };

    if (isFirstExecute) {
      /* 关键流程：打断旧墙前先解除保留墙的旧表面绑定并删除旧表面；即将删除的旧墙不做无意义解绑。 */
      this._manager.removeSurfaceObjectsByIds(
        surfacesBoundToRemovedWalls.slabIds,
        surfacesBoundToRemovedWalls.ceilingIds,
        removedExistingWallIds
      );
    }

    this._removeExistingWalls(this._cachedPlan.removedExistingWalls);
    this._addCreatedWalls(this._cachedPlan.createdWalls);

    if (isFirstExecute) {
      /* 关键流程：墙体拓扑更新后重新检测最小封闭区域，让打断墙段与分割墙重新生成楼板和天花板绑定关系。 */
      const affectedWallIds: string[] = this._collectAffectedWallIds(this._cachedPlan);
      this._manager.refreshClosedSurfacesForWalls(affectedWallIds);
      this._afterSignatureSnapshot = this._manager.getGeneratedSurfaceSignatureSnapshot();
      this._afterSlabSnapshot = this._manager.getSlabDataSnapshot();
      this._afterCeilingSnapshot = this._manager.getCeilingDataSnapshot();
    } else {
      /* 重做流程：墙体拓扑恢复后直接恢复首次执行后的表面快照，保证楼板和天花板拆分结果稳定一致。 */
      this._restoreAfterSurfaceSnapshots();
    }
  }

  /**
   * 撤销直墙创建与相交打断流程。
   * 关键流程：先删除本命令创建的全部墙段，再恢复被打断旧墙快照，最后还原连续绘制上一段端点。
   */
  public undo(): void {
    if (this._cachedPlan === null) {
      return;
    }

    this._removeCreatedWallsByCascade(this._cachedPlan.createdWalls);
    this._restoreExistingWalls(this._cachedPlan.removedExistingWalls);
    this._applyPreviousWallUpdatePrevious();
    this._restoreBeforeSurfaceSnapshots();
  }

  /** 释放撤销阶段级联删除命令持有的门窗资源。 */
  public dispose(): void {
    if (this._cascadeDeleteCommand !== null) {
      this._cascadeDeleteCommand.dispose();
      this._cascadeDeleteCommand = null;
    }
  }

  /**
   * 首次执行时创建缓存后的拆分执行计划。
   * @returns 可重复执行的缓存计划。
   */
  private _createCachedPlan(): CachedWallIntersectionSplitCommandPlan {
    const existingObjects: BuildingObject[] = this._manager.getAll();
    const splitPlan: WallIntersectionSplitPlan = WallIntersectionSplitPlanner.createPlan(this._newWallData, existingObjects);
    const removedExistingWalls: StraightWallData[] = [];
    const createdWalls: StraightWallData[] = [];

    for (const existingWallPlan of splitPlan.existingWallPlans) {
      removedExistingWalls.push(WallIntersectionSplitPlanner.cloneStraightWallData(existingWallPlan.originalWall));
      const existingSegments: StraightWallData[] = this._createWallSegments(existingWallPlan.originalWall, existingWallPlan.splitParameters, true);
      for (const existingSegment of existingSegments) {
        createdWalls.push(existingSegment);
      }
    }

    const newWallSegments: StraightWallData[] = this._createWallSegments(this._newWallData, splitPlan.newWallSplitParameters, false);
    for (const newWallSegment of newWallSegments) {
      createdWalls.push(newWallSegment);
    }
    const lastNewWallSegment: StraightWallData | undefined = newWallSegments[newWallSegments.length - 1];
    this._continuationWallId = lastNewWallSegment !== undefined ? lastNewWallSegment.id : this._newWallData.id;

    return {
      removedExistingWalls: removedExistingWalls,
      createdWalls: createdWalls,
    };
  }

  /**
   * 按拆分参数生成墙体分段数据。
   * @param sourceWall - 原始墙体。
   * @param splitParameters - 有效拆分参数。
   * @param alwaysCreateNewIds - true 表示所有分段都创建新 ID；false 表示单段时保留原新墙 ID。
   * @returns 分段后的直墙数据数组。
   */
  private _createWallSegments(sourceWall: StraightWallData, splitParameters: number[], alwaysCreateNewIds: boolean): StraightWallData[] {
    if (splitParameters.length === 0 && !alwaysCreateNewIds) {
      return [WallIntersectionSplitPlanner.cloneStraightWallData(sourceWall)];
    }

    const parameters: number[] = [0, ...splitParameters, 1];
    const segments: StraightWallData[] = [];
    for (let index: number = 0; index < parameters.length - 1; index += 1) {
      const startParameter: number = parameters[index]!;
      const endParameter: number = parameters[index + 1]!;
      const segmentStart: Point2D = Geometry2DUtils.lerpPoint2D(sourceWall.start, sourceWall.end, startParameter);
      const segmentEnd: Point2D = Geometry2DUtils.lerpPoint2D(sourceWall.start, sourceWall.end, endParameter);
      const segmentWall: StraightWallData = this._manager.createStraightWallData(
        segmentStart,
        segmentEnd,
        sourceWall.thickness,
        sourceWall.height
      );
      segmentWall.material = JSON.parse(JSON.stringify(sourceWall.material)) as StraightWallData['material'];
      segmentWall.visible = sourceWall.visible;
      segmentWall.locked = sourceWall.locked;
      segmentWall.elevation = sourceWall.elevation;
      segmentWall.offsetX = sourceWall.offsetX;
      segmentWall.offsetY = sourceWall.offsetY;
      segmentWall.offsetZ = sourceWall.offsetZ;
      segments.push(segmentWall);
    }

    return segments;
  }

  /**
   * 删除被打断的已有墙体。
   * @param walls - 需要删除的已有墙体快照。
   */
  private _removeExistingWalls(walls: StraightWallData[]): void {
    for (const wall of walls) {
      this._manager.removeObject(wall.id);
    }
  }

  /**
   * 添加命令创建的墙体分段。
   * @param walls - 待添加墙体分段。
   */
  private _addCreatedWalls(walls: StraightWallData[]): void {
    for (const wall of walls) {
      this._manager.addObject(WallIntersectionSplitPlanner.cloneStraightWallData(wall));
    }
  }

  /**
   * 撤销时级联删除本命令创建的墙体分段。
   * @param walls - 本命令创建的墙体分段。
   */
  private _removeCreatedWallsByCascade(walls: StraightWallData[]): void {
    const wallIds: string[] = walls.map((wall: StraightWallData): string => wall.id);
    if (wallIds.length === 0) {
      return;
    }

    const cascadeDeleteCommand: WallCascadeDeleteCommand = new WallCascadeDeleteCommand(this._manager, this._scene, wallIds);
    cascadeDeleteCommand.execute();
    this._cascadeDeleteCommand = cascadeDeleteCommand;
  }

  /**
   * 恢复被打断的已有墙体。
   * @param walls - 被打断旧墙快照。
   */
  private _restoreExistingWalls(walls: StraightWallData[]): void {
    for (const wall of walls) {
      this._manager.addObject(WallIntersectionSplitPlanner.cloneStraightWallData(wall));
    }
  }

  /**
   * 收集本次打断后需要参与封闭表面刷新的墙体 ID。
   * @param plan - 已缓存的墙体打断计划。
   * @returns 去重后的受影响墙体 ID 列表。
   */
  private _collectAffectedWallIds(plan: CachedWallIntersectionSplitCommandPlan): string[] {
    const affectedWallIds: string[] = [];
    const visitedWallIds: Set<string> = new Set<string>();

    /* 收集流程：新旧墙段都加入刷新集合，确保被分割的原封闭空间和新增分割墙都能触发最小房间检测。 */
    for (const removedWall of plan.removedExistingWalls) {
      StraightWallIntersectionSplitCreateCommand._appendUniqueWallId(affectedWallIds, visitedWallIds, removedWall.id);
    }
    for (const createdWall of plan.createdWalls) {
      StraightWallIntersectionSplitCreateCommand._appendUniqueWallId(affectedWallIds, visitedWallIds, createdWall.id);
    }
    if (this._previousWallUpdate !== null) {
      StraightWallIntersectionSplitCreateCommand._appendUniqueWallId(affectedWallIds, visitedWallIds, this._previousWallUpdate.wallId);
    }

    return affectedWallIds;
  }

  /** 恢复首次执行前的楼板、天花板与自动生成签名快照。 */
  private _restoreBeforeSurfaceSnapshots(): void {
    if (this._beforeSignatureSnapshot !== null) {
      this._manager.restoreGeneratedSurfaceSignatureSnapshot(this._beforeSignatureSnapshot);
    }
    if (this._beforeSlabSnapshot !== null) {
      this._manager.restoreSlabDataSnapshot(this._beforeSlabSnapshot);
    }
    if (this._beforeCeilingSnapshot !== null) {
      this._manager.restoreCeilingDataSnapshot(this._beforeCeilingSnapshot);
    }
  }

  /** 恢复首次执行后的楼板、天花板与自动生成签名快照。 */
  private _restoreAfterSurfaceSnapshots(): void {
    if (this._afterSignatureSnapshot !== null) {
      this._manager.restoreGeneratedSurfaceSignatureSnapshot(this._afterSignatureSnapshot);
    }
    if (this._afterSlabSnapshot !== null) {
      this._manager.restoreSlabDataSnapshot(this._afterSlabSnapshot);
    }
    if (this._afterCeilingSnapshot !== null) {
      this._manager.restoreCeilingDataSnapshot(this._afterCeilingSnapshot);
    }
  }

  /** 应用连续绘制上一段墙体的修正后端点。 */
  private _applyPreviousWallUpdateNext(): void {
    if (this._previousWallUpdate === null) {
      return;
    }

    this._manager.updateObject(
      this._previousWallUpdate.wallId,
      { end: StraightWallIntersectionSplitCreateCommand._clonePoint(this._previousWallUpdate.nextEnd) } as Partial<StraightWallData>
    );
  }

  /** 恢复连续绘制上一段墙体的原始端点。 */
  private _applyPreviousWallUpdatePrevious(): void {
    if (this._previousWallUpdate === null) {
      return;
    }

    this._manager.updateObject(
      this._previousWallUpdate.wallId,
      { end: StraightWallIntersectionSplitCreateCommand._clonePoint(this._previousWallUpdate.previousEnd) } as Partial<StraightWallData>
    );
  }

  /**
   * 深拷贝上一段直墙端点修正参数。
   * @param update - 原始修正参数。
   * @returns 克隆后的修正参数；输入为 null 时返回 null。
   */
  private static _clonePreviousUpdate(update: PreviousStraightWallEndpointUpdate | null): PreviousStraightWallEndpointUpdate | null {
    if (update === null) {
      return null;
    }

    return {
      wallId: update.wallId,
      previousEnd: StraightWallIntersectionSplitCreateCommand._clonePoint(update.previousEnd),
      nextEnd: StraightWallIntersectionSplitCreateCommand._clonePoint(update.nextEnd),
    };
  }

  /**
   * 克隆二维点。
   * @param point - 原始二维点。
   * @returns 克隆后的二维点。
   */
  private static _clonePoint(point: Point2D): Point2D {
    return { x: point.x, z: point.z };
  }

  /**
   * 将墙体 ID 追加到去重列表。
   * @param wallIds - 目标墙体 ID 列表。
   * @param visitedWallIds - 已收集墙体 ID 集合。
   * @param wallId - 待追加墙体 ID。
   */
  private static _appendUniqueWallId(wallIds: string[], visitedWallIds: Set<string>, wallId: string): void {
    if (visitedWallIds.has(wallId)) {
      return;
    }

    visitedWallIds.add(wallId);
    wallIds.push(wallId);
  }
}