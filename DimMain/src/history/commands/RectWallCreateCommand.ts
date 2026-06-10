/**
 * 矩形墙创建命令
 * execute：添加四面子直墙、矩形墙父级数据；undo：移除矩形墙。
 */

import type { ICommand } from '../ICommand';
import type { BuildingObject, RectWallData, StraightWallData } from '../../building/BuildingTypes';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';
import type { GeneratedSurfaceSignatureSnapshot } from '../../building/BuildingObjectManager';

/** 矩形墙子墙数据元组 */
type RectWallChildren = [StraightWallData, StraightWallData, StraightWallData, StraightWallData];

/**
 * 矩形墙创建命令
 * 将矩形墙几何数据绑定为一个可撤销操作。
 */
export class RectWallCreateCommand implements ICommand {
  /** 命令标签，用于历史 UI 展示 */
  public readonly label: string = '创建矩形墙';

  /** 建筑对象管理器引用 */
  private readonly _manager: BuildingObjectManager;

  /** 矩形墙父级数据快照 */
  private readonly _rectData: RectWallData;

  /** 四面子直墙数据快照 */
  private readonly _childrenData: RectWallChildren;

  /** 首次执行前的对象 ID 集合，用于识别自动生成的楼板/天花板等副作用对象 */
  private _beforeObjectIds: Set<string> | null = null;

  /** 首次执行前的楼板/天花板自动生成签名缓存快照 */
  private _beforeSignatureSnapshot: GeneratedSurfaceSignatureSnapshot | null = null;

  /** 首次执行后的楼板/天花板自动生成签名缓存快照 */
  private _afterSignatureSnapshot: GeneratedSurfaceSignatureSnapshot | null = null;

  /** 本命令创建的完整对象快照，包含子墙、父级矩形墙以及自动楼板/天花板 */
  private _createdObjectSnapshots: BuildingObject[] | null = null;

  /**
   * @param manager - 建筑对象管理器
   * @param rectData - 矩形墙父级数据
   * @param childrenData - 四面子直墙数据
   */
  public constructor(
    manager: BuildingObjectManager,
    rectData: RectWallData,
    childrenData: RectWallChildren
  ) {
    this._manager = manager;
    this._rectData = RectWallCreateCommand._cloneRectWallData(rectData);
    this._childrenData = RectWallCreateCommand._cloneChildrenData(childrenData);
  }

  /**
   * 执行矩形墙创建流程
   * 关键逻辑：先添加四面子直墙以建立墙体拓扑，再添加父级矩形墙数据。
   */
  public execute(): void {
    if (this._createdObjectSnapshots !== null && this._afterSignatureSnapshot !== null) {
      this._restoreCreatedObjectsFromSnapshots();
      return;
    }

    this._beforeObjectIds = this._captureCurrentObjectIds();
    this._beforeSignatureSnapshot = this._manager.getGeneratedSurfaceSignatureSnapshot();

    const childrenData: RectWallChildren = RectWallCreateCommand._cloneChildrenData(this._childrenData);
    for (const childData of childrenData) {
      this._manager.addObject(childData);
    }
    this._manager.addObject(RectWallCreateCommand._cloneRectWallData(this._rectData));

    this._afterSignatureSnapshot = this._manager.getGeneratedSurfaceSignatureSnapshot();
    this._createdObjectSnapshots = this._captureCreatedObjectSnapshots(this._beforeObjectIds);
  }

  /**
   * 撤销矩形墙创建流程
   * 关键逻辑：移除父级矩形墙；管理器会级联删除四面子墙及其连接。
   */
  public undo(): void {
    if (this._createdObjectSnapshots !== null) {
      /* 撤销矩形墙时必须同时移除自动生成的楼板与天花板，避免副作用对象残留。 */
      for (let i: number = this._createdObjectSnapshots.length - 1; i >= 0; i--) {
        const snapshot: BuildingObject = this._createdObjectSnapshots[i]!;
        this._manager.removeObject(snapshot.id);
      }
    } else {
      this._manager.removeObject(this._rectData.id);
    }

    if (this._beforeSignatureSnapshot !== null) {
      this._manager.restoreGeneratedSurfaceSignatureSnapshot(this._beforeSignatureSnapshot);
    }
  }

  /**
   * 捕获当前对象 ID 集合
   * @returns 当前建筑对象 ID 集合
   */
  private _captureCurrentObjectIds(): Set<string> {
    const ids: Set<string> = new Set<string>();
    const objects: BuildingObject[] = this._manager.getAll();
    for (const objectData of objects) {
      ids.add(objectData.id);
    }
    return ids;
  }

  /**
   * 捕获本命令新增的完整对象快照
   * @param beforeObjectIds - 命令执行前已有对象 ID 集合
   * @returns 本命令新增对象的深拷贝快照列表
   */
  private _captureCreatedObjectSnapshots(beforeObjectIds: Set<string>): BuildingObject[] {
    const snapshots: BuildingObject[] = [];
    const objects: BuildingObject[] = this._manager.getAll();
    for (const objectData of objects) {
      if (!beforeObjectIds.has(objectData.id)) {
        snapshots.push(RectWallCreateCommand._cloneBuildingObject(objectData));
      }
    }
    return snapshots;
  }

  /**
   * 根据首次执行后的对象快照恢复矩形墙及其副作用对象
   * 关键逻辑：先恢复执行后的签名缓存，使子墙重建时不会再次触发自动楼板/天花板生成，再按快照恢复对象。
   */
  private _restoreCreatedObjectsFromSnapshots(): void {
    if (this._createdObjectSnapshots === null || this._afterSignatureSnapshot === null) {
      return;
    }

    this._manager.restoreGeneratedSurfaceSignatureSnapshot(this._afterSignatureSnapshot);
    for (const snapshot of this._createdObjectSnapshots) {
      this._manager.addObject(RectWallCreateCommand._cloneBuildingObject(snapshot));
    }
    this._manager.restoreGeneratedSurfaceSignatureSnapshot(this._afterSignatureSnapshot);
  }

  /**
   * 深拷贝建筑对象数据
   * @param objectData - 原始建筑对象数据
   * @returns 克隆后的建筑对象数据
   */
  private static _cloneBuildingObject(objectData: BuildingObject): BuildingObject {
    return JSON.parse(JSON.stringify(objectData)) as BuildingObject;
  }

  /**
   * 深拷贝矩形墙父级数据
   * @param rectData - 原始矩形墙数据
   * @returns 克隆后的矩形墙数据
   */
  private static _cloneRectWallData(rectData: RectWallData): RectWallData {
    return JSON.parse(JSON.stringify(rectData)) as RectWallData;
  }

  /**
   * 深拷贝矩形墙子墙数据
   * @param childrenData - 原始子墙元组
   * @returns 克隆后的子墙元组
   */
  private static _cloneChildrenData(childrenData: RectWallChildren): RectWallChildren {
    return JSON.parse(JSON.stringify(childrenData)) as RectWallChildren;
  }
}