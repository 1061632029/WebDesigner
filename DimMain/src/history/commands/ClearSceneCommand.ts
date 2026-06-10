/**
 * 清空场景命令
 * execute：清空建筑对象与已放置 STL 模型；undo：恢复清空前快照。
 * 该命令用于顶部工具栏“清空”功能，保证操作可撤销/重做。
 */

import * as THREE from 'three/webgpu';
import type { ICommand } from '../ICommand';
import type { BuildingObject } from '../../building/BuildingTypes';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';

/** STL Mesh 快照项 */
interface ClearSceneStlSnapshot {
  /** 已放置 STL Mesh 引用 */
  mesh: THREE.Mesh;
  /** 清空前父节点；恢复时优先添加回该父节点 */
  parent: THREE.Object3D | null;
}

/**
 * 清空场景命令
 */
export class ClearSceneCommand implements ICommand {
  /** 命令标签 */
  public readonly label: string = '清空场景';

  /** 建筑对象管理器引用 */
  private readonly _buildingManager: BuildingObjectManager;

  /** Three.js 场景引用 */
  private readonly _scene: THREE.Scene;

  /** 建筑对象数据快照 */
  private readonly _buildingSnapshot: BuildingObject[];

  /** STL Mesh 快照 */
  private readonly _stlSnapshots: ClearSceneStlSnapshot[];

  /**
   * @param buildingManager - 建筑对象管理器
   * @param scene - Three.js 场景
   */
  public constructor(buildingManager: BuildingObjectManager, scene: THREE.Scene) {
    this._buildingManager = buildingManager;
    this._scene = scene;
    this._buildingSnapshot = ClearSceneCommand._cloneBuildingObjects(buildingManager.serialize());
    this._stlSnapshots = ClearSceneCommand._collectPlacedStlMeshes(scene);
  }

  /**
   * 当前命令是否包含可清空内容
   * @returns 有建筑对象或 STL 模型时返回 true
   */
  public hasContent(): boolean {
    return this._buildingSnapshot.length > 0 || this._stlSnapshots.length > 0;
  }

  /**
   * 执行清空：清理建筑对象并从场景移除 STL Mesh。
   */
  public execute(): void {
    /* 先清空建筑对象管理器，确保墙/梁/柱等数据和渲染对象同步移除。 */
    this._buildingManager.clear();

    /* 再移除直接放置在场景中的 STL Mesh；不 dispose，保留撤销恢复所需资源。 */
    for (const snapshot of this._stlSnapshots) {
      const currentParent: THREE.Object3D | null = snapshot.mesh.parent;
      if (currentParent !== null) {
        currentParent.remove(snapshot.mesh);
      }
    }

    console.log(
      `[ClearSceneCommand] 已清空场景：建筑对象 ${this._buildingSnapshot.length} 个，` +
      `STL 模型 ${this._stlSnapshots.length} 个`
    );
  }

  /**
   * 撤销清空：恢复建筑对象快照并重新加入 STL Mesh。
   */
  public undo(): void {
    /* 使用深拷贝快照恢复建筑对象，避免历史快照被后续编辑污染。 */
    this._buildingManager.deserialize(ClearSceneCommand._cloneBuildingObjects(this._buildingSnapshot));

    /* 将 STL Mesh 恢复到清空前父节点；若父节点已不可用则回退到场景根节点。 */
    for (const snapshot of this._stlSnapshots) {
      if (snapshot.mesh.parent !== null) {
        continue;
      }

      const targetParent: THREE.Object3D = snapshot.parent !== null ? snapshot.parent : this._scene;
      targetParent.add(snapshot.mesh);
    }

    console.log('[ClearSceneCommand] 已撤销清空场景');
  }

  /**
   * 命令被历史栈丢弃时释放已移除 STL Mesh 的 GPU 资源。
   * 若 Mesh 已通过 undo 恢复在场景中，则不能释放，避免破坏当前可见对象。
   */
  public dispose(): void {
    for (const snapshot of this._stlSnapshots) {
      if (snapshot.mesh.parent !== null) {
        continue;
      }

      ClearSceneCommand._disposeMesh(snapshot.mesh);
    }
  }

  /**
   * 收集已放置 STL Mesh
   * @param scene - Three.js 场景
   * @returns STL Mesh 快照数组
   */
  private static _collectPlacedStlMeshes(scene: THREE.Scene): ClearSceneStlSnapshot[] {
    const snapshots: ClearSceneStlSnapshot[] = [];

    /* 遍历场景，收集带 stlModelId 标记的顶层模型；跳过边线等子辅助对象。 */
    scene.traverse((object: THREE.Object3D): void => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }

      if (object.userData['stlModelId'] === undefined) {
        return;
      }

      snapshots.push({ mesh: object, parent: object.parent });
    });

    return snapshots;
  }

  /**
   * 深拷贝建筑对象数组
   * @param data - 建筑对象数组
   * @returns 深拷贝后的建筑对象数组
   */
  private static _cloneBuildingObjects(data: BuildingObject[]): BuildingObject[] {
    return JSON.parse(JSON.stringify(data)) as BuildingObject[];
  }

  /**
   * 释放 Mesh 及其子对象资源
   * @param mesh - 待释放 Mesh
   */
  private static _disposeMesh(mesh: THREE.Mesh): void {
    mesh.traverse((child: THREE.Object3D): void => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        const renderObject: THREE.Mesh | THREE.LineSegments = child as THREE.Mesh | THREE.LineSegments;
        renderObject.geometry.dispose();

        if (Array.isArray(renderObject.material)) {
          for (const material of renderObject.material as THREE.Material[]) {
            material.dispose();
          }
        } else if (renderObject.material instanceof THREE.Material) {
          renderObject.material.dispose();
        }
      }
    });
  }
}