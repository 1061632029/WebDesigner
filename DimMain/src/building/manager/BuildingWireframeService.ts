/**
 * 建筑线框服务。
 * 管理所有建筑 Mesh 的线框隐藏、恢复与按模型类型选择线框生成策略。
 */

import * as THREE from 'three/webgpu';
import type { BuildingObject, StraightWallData, WallData } from '../BuildingTypes';
import { BuildingWireframeFactory } from './BuildingWireframeFactory';
import type { BuildingWireframeFactoryOptions } from './BuildingWireframeFactory';

/** 建筑线框服务。 */
export class BuildingWireframeService {
  /** 所有建筑对象数据索引。 */
  private readonly _objects: Map<string, BuildingObject>;

  /** 所有建筑对象 Mesh 索引。 */
  private readonly _meshes: Map<string, THREE.Mesh>;

  /** 获取线框工厂配置的回调。 */
  private readonly _getOptions: () => BuildingWireframeFactoryOptions;

  /**
   * @param objects - 建筑对象数据索引。
   * @param meshes - 建筑对象 Mesh 索引。
   * @param getOptions - 获取线框工厂配置的回调。
   */
  public constructor(
    objects: Map<string, BuildingObject>,
    meshes: Map<string, THREE.Mesh>,
    getOptions: () => BuildingWireframeFactoryOptions
  ) {
    this._objects = objects;
    this._meshes = meshes;
    this._getOptions = getOptions;
  }

  /**
   * 隐藏所有 Mesh 的线框子对象。
   */
  public hideAllWireframes(): void {
    this._meshes.forEach((mesh: THREE.Mesh): void => {
      const wireframesToRemove: THREE.Object3D[] = [];
      mesh.children.forEach((child: THREE.Object3D): void => {
        if (child.userData['isWireframe'] === true) {
          wireframesToRemove.push(child);
        }
      });
      /* 隐藏流程：完全移除并释放线框，避免洞口预览替换几何体时旧 EdgesGeometry 引用失效。 */
      for (const wireframeObject of wireframesToRemove) {
        BuildingWireframeFactory.disposeWireframeObject(wireframeObject);
        mesh.remove(wireframeObject);
      }
    });
  }

  /**
   * 恢复所有 Mesh 的线框子对象。
   */
  public restoreAllWireframes(): void {
    this._meshes.forEach((mesh: THREE.Mesh): void => {
      const hasWireframe: boolean = mesh.children.some(
        (child: THREE.Object3D): boolean => child.userData['isWireframe'] === true
      );
      if (hasWireframe) {
        return;
      }

      /* 恢复流程：按对象类型选择楼板/天花板边线或墙梁折角线，避免特定对象逻辑散落在管理器内。 */
      const wireframe: THREE.Object3D | null = this.createWireframeForMesh(mesh);
      if (wireframe === null) {
        return;
      }
      wireframe.position.set(0, 0.001, 0);
      wireframe.renderOrder = 1;
      mesh.add(wireframe);
    });
  }

  /**
   * 根据 Mesh 关联对象创建线框对象。
   * @param mesh - 目标 Mesh。
   * @returns 线框对象；无法生成时返回 null。
   */
  private createWireframeForMesh(mesh: THREE.Mesh): THREE.Object3D | null {
    const meshId: string | undefined = mesh.userData['buildingObjectId'] as string | undefined;
    const objectData: BuildingObject | undefined = meshId === undefined ? undefined : this._objects.get(meshId);
    if (objectData !== undefined && objectData.category === 'slab') {
      return BuildingWireframeFactory.createSurfaceEdgeWireframe(mesh.geometry, 0x555555, this._getOptions());
    }
    if (objectData !== undefined && objectData.category === 'ceiling') {
      return BuildingWireframeFactory.createSurfaceEdgeWireframe(mesh.geometry, 0x888888, this._getOptions());
    }

    const excludeGroupIndices: number[] = BuildingWireframeService.resolveExcludedGroups(objectData);
    const shouldHideArcSegmentVerticalEdges: boolean = BuildingWireframeService.shouldHideArcSegmentVerticalEdges(objectData);
    return BuildingWireframeFactory.createFilteredEdges(
      mesh.geometry,
      this._getOptions(),
      excludeGroupIndices,
      shouldHideArcSegmentVerticalEdges
    );
  }

  /**
   * 解析需要排除的几何分组。
   * @param objectData - 建筑对象数据。
   * @returns materialIndex 列表。
   */
  private static resolveExcludedGroups(objectData: BuildingObject | undefined): number[] {
    if (objectData === undefined || objectData.category !== 'wall') {
      return [];
    }
    const wallData: WallData = objectData as WallData;
    if (wallData.subType !== 'straight') {
      return [];
    }
    const straightWallData: StraightWallData = wallData as StraightWallData;
    const hasOpenings: boolean = (straightWallData.openings?.length ?? 0) > 0;
    return hasOpenings ? [2] : [];
  }

  /**
   * 判断是否隐藏弧墙采样段竖向分割边。
   * @param objectData - 建筑对象数据。
   * @returns true 表示隐藏。
   */
  private static shouldHideArcSegmentVerticalEdges(objectData: BuildingObject | undefined): boolean {
    if (objectData === undefined || objectData.category !== 'wall') {
      return false;
    }
    const wallData: WallData = objectData as WallData;
    return wallData.subType === 'arc';
  }
}