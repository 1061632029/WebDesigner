/**
 * 楼板级联删除命令
 * 删除楼板时同步删除房间相关墙体、墙体绑定的门窗 STL、以及关联天花板。
 * 关键流程：构造阶段收集并快照所有相关对象，execute 执行级联移除，undo 按依赖顺序恢复。
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
interface RelatedStlMeshSnapshot {
  /** 门窗 Mesh 引用，不在 execute 时释放，确保撤销可恢复原始模型。 */
  mesh: THREE.Mesh;
  /** 删除前父级对象，优先用于撤销时恢复挂载层级。 */
  parent: THREE.Object3D | null;
}

/**
 * 楼板级联删除命令
 */
export class SlabCascadeDeleteCommand implements ICommand {
  /** 命令标签 */
  public readonly label: string;

  /** 建筑对象管理器引用 */
  private readonly _manager: BuildingObjectManager;

  /** Three.js 场景引用，用于移除/恢复墙体绑定的门窗 STL。 */
  private readonly _scene: THREE.Scene;

  /** 楼板对象快照。 */
  private readonly _slabSnapshot: SlabData;

  /** 绑定该楼板的墙体快照。 */
  private readonly _wallSnapshots: StraightWallData[];

  /** 与这些墙体关联的天花板快照。 */
  private readonly _ceilingSnapshots: CeilingData[];

  /** 墙体绑定的门窗 STL Mesh 快照。 */
  private readonly _stlMeshSnapshots: RelatedStlMeshSnapshot[];

  /**
   * @param manager - 建筑对象管理器
   * @param scene - Three.js 场景
   * @param slabId - 待删除楼板 ID
   * @throws 当楼板不存在或对象类型不是楼板时抛出错误
   */
  public constructor(manager: BuildingObjectManager, scene: THREE.Scene, slabId: string) {
    this._manager = manager;
    this._scene = scene;

    const slabObject: BuildingObject | undefined = manager.getById(slabId);
    if (slabObject === undefined || slabObject.category !== 'slab') {
      throw new Error(`SlabCascadeDeleteCommand: 对象 ${slabId} 不是有效楼板，无法级联删除`);
    }

    this._slabSnapshot = SlabCascadeDeleteCommand._deepClone(slabObject) as SlabData;
    this._wallSnapshots = this._collectWallSnapshots(slabId);
    this._ceilingSnapshots = this._collectCeilingSnapshots(this._wallSnapshots);
    this._stlMeshSnapshots = this._collectRelatedStlMeshSnapshots(this._wallSnapshots);
    this.label = `删除楼板及房间构件 (${this._slabSnapshot.name})`;
  }

  /**
   * 执行级联删除：先移除门窗 STL，再删除墙体、天花板和楼板数据。
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

    /* 删除墙体前先删除天花板，避免墙体引用和天花板 wallIds 之间出现短暂脏关联。 */
    for (const ceilingSnapshot of this._ceilingSnapshots) {
      this._manager.removeObject(ceilingSnapshot.id);
    }

    for (const wallSnapshot of this._wallSnapshots) {
      this._manager.removeObject(wallSnapshot.id);
    }

    this._manager.removeObject(this._slabSnapshot.id);
    console.log(
      `[SlabCascadeDeleteCommand] 删除楼板=${this._slabSnapshot.id}, ` +
      `墙体=${this._wallSnapshots.length}, 门窗=${this._stlMeshSnapshots.length}, ` +
      `天花板=${this._ceilingSnapshots.length}`
    );
  }

  /**
   * 撤销级联删除：按楼板、墙体、天花板、门窗 STL 的依赖顺序恢复。
   */
  public undo(): void {
    /* 先恢复楼板和墙体数据，再恢复依赖墙体 ID 的天花板与门窗。 */
    this._manager.addObject(SlabCascadeDeleteCommand._deepClone(this._slabSnapshot) as BuildingObject);

    for (const wallSnapshot of this._wallSnapshots) {
      this._manager.addObject(SlabCascadeDeleteCommand._deepClone(wallSnapshot) as BuildingObject);
    }

    for (const ceilingSnapshot of this._ceilingSnapshots) {
      this._manager.addObject(SlabCascadeDeleteCommand._deepClone(ceilingSnapshot) as BuildingObject);
    }

    for (const stlSnapshot of this._stlMeshSnapshots) {
      const restoreParent: THREE.Object3D = stlSnapshot.parent !== null ? stlSnapshot.parent : this._scene;
      if (stlSnapshot.mesh.parent !== restoreParent) {
        restoreParent.add(stlSnapshot.mesh);
      }
    }

    console.log(`[SlabCascadeDeleteCommand] 撤销删除楼板=${this._slabSnapshot.id}`);
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
   * 收集绑定指定楼板的直墙快照。
   * @param slabId - 楼板 ID
   * @returns 直墙快照数组
   */
  private _collectWallSnapshots(slabId: string): StraightWallData[] {
    const snapshots: StraightWallData[] = [];
    const allObjects: BuildingObject[] = this._manager.getAll();

    for (const object of allObjects) {
      if (object.category !== 'wall') {
        continue;
      }

      const wallData: WallData = object as WallData;
      if (wallData.subType !== 'straight') {
        continue;
      }

      const straightWall: StraightWallData = wallData as StraightWallData;
      if (straightWall.slabId === slabId) {
        snapshots.push(SlabCascadeDeleteCommand._deepClone(straightWall) as StraightWallData);
      }
    }

    return snapshots;
  }

  /**
   * 收集墙体关联的天花板快照。
   * @param wallSnapshots - 关联墙体快照数组
   * @returns 天花板快照数组
   */
  private _collectCeilingSnapshots(wallSnapshots: StraightWallData[]): CeilingData[] {
    const wallIds: Set<string> = new Set<string>();
    const ceilingIds: Set<string> = new Set<string>();
    const snapshots: CeilingData[] = [];

    for (const wallSnapshot of wallSnapshots) {
      wallIds.add(wallSnapshot.id);
      if (wallSnapshot.ceilingId !== null) {
        ceilingIds.add(wallSnapshot.ceilingId);
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
        snapshots.push(SlabCascadeDeleteCommand._deepClone(ceilingData) as CeilingData);
      }
    }

    return snapshots;
  }

  /**
   * 从场景中收集绑定到相关墙体的门窗 STL Mesh。
   * @param wallSnapshots - 关联墙体快照数组
   * @returns 门窗 Mesh 快照数组
   */
  private _collectRelatedStlMeshSnapshots(wallSnapshots: StraightWallData[]): RelatedStlMeshSnapshot[] {
    const wallIds: Set<string> = new Set<string>();
    const snapshots: RelatedStlMeshSnapshot[] = [];

    for (const wallSnapshot of wallSnapshots) {
      wallIds.add(wallSnapshot.id);
    }

    /* 遍历场景查找 userData.wallId 命中墙体 ID 的门窗模型，确保楼板删除后不残留门窗。 */
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