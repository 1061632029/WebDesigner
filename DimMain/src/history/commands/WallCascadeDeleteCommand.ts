/**
 * 墙体级联删除命令
 * 删除墙体时同步删除依赖该墙体的楼板、天花板和门窗 STL，并作为单个历史命令支持整体撤销/重做。
 * 关键流程：构造阶段收集墙体及依赖对象快照，execute 统一移除，undo 按依赖顺序恢复。
 */

import * as THREE from 'three/webgpu';
import type { ICommand } from '../ICommand';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';
import type {
  BuildingObject,
  CeilingData,
  SlabData,
  StraightWallData,
  WallData,
} from '../../building/BuildingTypes';

/** 门窗 STL 删除快照，保存 Mesh 及原始父级用于撤销恢复。 */
interface RelatedWallStlMeshSnapshot {
  /** 门窗 Mesh 引用，不在 execute 时释放，确保撤销可恢复原始模型。 */
  mesh: THREE.Mesh;
  /** 删除前父级对象，优先用于撤销时恢复挂载层级。 */
  parent: THREE.Object3D | null;
}

/**
 * 墙体级联删除命令
 */
export class WallCascadeDeleteCommand implements ICommand {
  /** 命令标签 */
  public readonly label: string;

  /** 建筑对象管理器引用 */
  private readonly _manager: BuildingObjectManager;

  /** Three.js 场景引用，用于移除/恢复墙体绑定的门窗 STL。 */
  private readonly _scene: THREE.Scene;

  /** 待删除墙体快照。 */
  private readonly _wallSnapshots: WallData[];

  /** 依赖墙体的楼板快照。 */
  private readonly _slabSnapshots: SlabData[];

  /** 依赖墙体的天花板快照。 */
  private readonly _ceilingSnapshots: CeilingData[];

  /** 墙体绑定的门窗 STL Mesh 快照。 */
  private readonly _stlMeshSnapshots: RelatedWallStlMeshSnapshot[];

  /**
   * @param manager - 建筑对象管理器
   * @param scene - Three.js 场景
   * @param wallIds - 待删除墙体 ID 数组
   * @throws 当没有有效墙体时抛出错误
   */
  public constructor(manager: BuildingObjectManager, scene: THREE.Scene, wallIds: ReadonlyArray<string>) {
    this._manager = manager;
    this._scene = scene;
    this._wallSnapshots = this._collectWallSnapshots(wallIds);

    if (this._wallSnapshots.length === 0) {
      throw new Error('WallCascadeDeleteCommand: 未找到有效墙体，无法级联删除');
    }

    this._slabSnapshots = this._collectSlabSnapshots(this._wallSnapshots);
    this._ceilingSnapshots = this._collectCeilingSnapshots(this._wallSnapshots);
    this._stlMeshSnapshots = this._collectRelatedStlMeshSnapshots(this._wallSnapshots);
    const firstWallSnapshot: WallData = this._wallSnapshots[0] as WallData;
    this.label = this._wallSnapshots.length === 1
      ? `删除墙体及依赖构件 (${firstWallSnapshot.name})`
      : `批量删除墙体及依赖构件 (${this._wallSnapshots.length})`;
  }

  /**
   * 执行级联删除：先移除门窗 STL，再删除依赖墙体的楼板、天花板和墙体数据。
   */
  public execute(): void {
    /* 先移除墙体绑定门窗，避免墙体删除后场景中残留门窗模型。 */
    for (const stlSnapshot of this._stlMeshSnapshots) {
      const currentParent: THREE.Object3D | null = stlSnapshot.mesh.parent;
      if (currentParent !== null) {
        currentParent.remove(stlSnapshot.mesh);
      } else {
        this._scene.remove(stlSnapshot.mesh);
      }
    }

    /* 删除墙体前先删除依赖表面，避免楼板/天花板继续引用即将删除的墙体。 */
    for (const ceilingSnapshot of this._ceilingSnapshots) {
      this._manager.removeObject(ceilingSnapshot.id);
    }

    for (const slabSnapshot of this._slabSnapshots) {
      this._manager.removeObject(slabSnapshot.id);
    }

    for (const wallSnapshot of this._wallSnapshots) {
      this._manager.removeObject(wallSnapshot.id);
    }

    console.log(
      `[WallCascadeDeleteCommand] 删除墙体=${this._wallSnapshots.length}, ` +
      `楼板=${this._slabSnapshots.length}, 天花板=${this._ceilingSnapshots.length}, ` +
      `门窗=${this._stlMeshSnapshots.length}`
    );
  }

  /**
   * 撤销级联删除：按墙体、楼板、天花板、门窗 STL 的依赖顺序恢复。
   */
  public undo(): void {
    /* 先恢复墙体数据，再恢复依赖墙体 ID 的楼板、天花板与门窗。 */
    for (const wallSnapshot of this._wallSnapshots) {
      this._manager.addObject(WallCascadeDeleteCommand._deepClone(wallSnapshot) as BuildingObject);
    }

    for (const slabSnapshot of this._slabSnapshots) {
      this._manager.addObject(WallCascadeDeleteCommand._deepClone(slabSnapshot) as BuildingObject);
    }

    for (const ceilingSnapshot of this._ceilingSnapshots) {
      this._manager.addObject(WallCascadeDeleteCommand._deepClone(ceilingSnapshot) as BuildingObject);
    }

    for (const stlSnapshot of this._stlMeshSnapshots) {
      const restoreParent: THREE.Object3D = stlSnapshot.parent !== null ? stlSnapshot.parent : this._scene;
      if (stlSnapshot.mesh.parent !== restoreParent) {
        restoreParent.add(stlSnapshot.mesh);
      }
    }

    console.log(`[WallCascadeDeleteCommand] 撤销删除墙体=${this._wallSnapshots.length}`);
  }

  /**
   * 命令被历史栈丢弃时释放已删除门窗 Mesh 的 GPU 资源。
   */
  public dispose(): void {
    for (const stlSnapshot of this._stlMeshSnapshots) {
      stlSnapshot.mesh.geometry.dispose();
      const material: THREE.Material | THREE.Material[] = stlSnapshot.mesh.material;
      if (Array.isArray(material)) {
        material.forEach((mat: THREE.Material): void => {
          mat.dispose();
        });
      } else {
        material.dispose();
      }
    }
  }

  /**
   * 收集待删除墙体快照。
   * @param wallIds - 待删除墙体 ID 数组
   * @returns 墙体快照数组
   */
  private _collectWallSnapshots(wallIds: ReadonlyArray<string>): WallData[] {
    const snapshots: WallData[] = [];
    const visitedWallIds: Set<string> = new Set<string>();

    for (const wallId of wallIds) {
      if (visitedWallIds.has(wallId)) {
        continue;
      }

      const object: BuildingObject | undefined = this._manager.getById(wallId);
      if (object === undefined || object.category !== 'wall') {
        continue;
      }

      visitedWallIds.add(wallId);
      snapshots.push(WallCascadeDeleteCommand._deepClone(object) as WallData);
    }

    return snapshots;
  }

  /**
   * 收集依赖墙体的楼板快照。
   * @param wallSnapshots - 墙体快照数组
   * @returns 楼板快照数组
   */
  private _collectSlabSnapshots(wallSnapshots: WallData[]): SlabData[] {
    const slabIds: Set<string> = new Set<string>();
    const snapshots: SlabData[] = [];

    for (const wallSnapshot of wallSnapshots) {
      if (wallSnapshot.subType !== 'straight') {
        continue;
      }

      const straightWall: StraightWallData = wallSnapshot as StraightWallData;
      if (straightWall.slabId !== null) {
        slabIds.add(straightWall.slabId);
      }
    }

    for (const slabId of slabIds) {
      const slabObject: BuildingObject | undefined = this._manager.getById(slabId);
      if (slabObject !== undefined && slabObject.category === 'slab') {
        snapshots.push(WallCascadeDeleteCommand._deepClone(slabObject) as SlabData);
      }
    }

    return snapshots;
  }

  /**
   * 收集依赖墙体的天花板快照。
   * @param wallSnapshots - 墙体快照数组
   * @returns 天花板快照数组
   */
  private _collectCeilingSnapshots(wallSnapshots: WallData[]): CeilingData[] {
    const wallIds: Set<string> = new Set<string>();
    const ceilingIds: Set<string> = new Set<string>();
    const snapshots: CeilingData[] = [];

    for (const wallSnapshot of wallSnapshots) {
      wallIds.add(wallSnapshot.id);
      if (wallSnapshot.subType === 'straight') {
        const straightWall: StraightWallData = wallSnapshot as StraightWallData;
        if (straightWall.ceilingId !== null) {
          ceilingIds.add(straightWall.ceilingId);
        }
      }
    }

    const allObjects: BuildingObject[] = this._manager.getAll();
    for (const object of allObjects) {
      if (object.category !== 'ceiling') {
        continue;
      }

      const ceilingData: CeilingData = object as CeilingData;
      const referencedById: boolean = ceilingIds.has(ceilingData.id);
      const referencedByWall: boolean = ceilingData.wallIds.some((wallId: string): boolean => wallIds.has(wallId));
      if (referencedById || referencedByWall) {
        snapshots.push(WallCascadeDeleteCommand._deepClone(ceilingData) as CeilingData);
      }
    }

    return snapshots;
  }

  /**
   * 从场景中收集绑定到相关墙体的门窗 STL Mesh。
   * @param wallSnapshots - 墙体快照数组
   * @returns 门窗 Mesh 快照数组
   */
  private _collectRelatedStlMeshSnapshots(wallSnapshots: WallData[]): RelatedWallStlMeshSnapshot[] {
    const wallIds: Set<string> = new Set<string>();
    const snapshots: RelatedWallStlMeshSnapshot[] = [];

    for (const wallSnapshot of wallSnapshots) {
      wallIds.add(wallSnapshot.id);
    }

    /* 遍历场景查找 userData.wallId 命中墙体 ID 的门窗模型，确保墙体删除后不残留门窗。 */
    this._scene.traverse((object: THREE.Object3D): void => {
      const mesh: THREE.Mesh | null = object instanceof THREE.Mesh ? object : null;
      if (mesh === null) {
        return;
      }

      const wallId: string | undefined = mesh.userData['wallId'] as string | undefined;
      if (wallId !== undefined && wallIds.has(wallId)) {
        snapshots.push({ mesh: mesh, parent: mesh.parent });
      }
    });

    return snapshots;
  }

  /**
   * 深拷贝建筑对象数据，避免撤销快照受外部变更污染。
   * @param data - 建筑对象数据
   * @returns 深拷贝后的建筑对象数据
   */
  private static _deepClone(data: BuildingObject): BuildingObject {
    return JSON.parse(JSON.stringify(data)) as BuildingObject;
  }
}