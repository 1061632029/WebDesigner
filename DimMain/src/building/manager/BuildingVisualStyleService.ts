/**
 * 建筑对象视觉样式服务。
 * 按渲染显示职责集中处理透明度、临时颜色和类别显隐，不修改建筑对象数据层。
 */

import * as THREE from 'three/webgpu';
import type { BuildingCategory, BuildingObject, MaterialProperties } from '../BuildingTypes';

/** 建筑对象视觉样式服务。 */
export class BuildingVisualStyleService {
  /** 所有建筑对象数据索引。 */
  private readonly _objects: Map<string, BuildingObject>;

  /** 所有建筑对象 Mesh 索引。 */
  private readonly _meshes: Map<string, THREE.Mesh>;

  /**
   * @param objects - 建筑对象数据索引。
   * @param meshes - 建筑对象 Mesh 索引。
   */
  public constructor(objects: Map<string, BuildingObject>, meshes: Map<string, THREE.Mesh>) {
    this._objects = objects;
    this._meshes = meshes;
  }

  /**
   * 将指定墙体 Mesh 的所有材质设为半透明。
   * @param wallId - 目标墙体 ID。
   * @param opacity - 透明度，取值范围 0 到 1。
   */
  public setWallTransparent(wallId: string, opacity: number): void {
    const mesh: THREE.Mesh | undefined = this._meshes.get(wallId);
    if (mesh === undefined) {
      return;
    }
    /* 墙体吸附高亮流程：仅调整渲染材质透明度，避免门窗布置时改动墙体数据。 */
    const materials: Array<THREE.Material> = BuildingVisualStyleService.getMeshMaterials(mesh);
    for (const material of materials) {
      material.transparent = true;
      material.opacity = opacity;
      material.needsUpdate = true;
    }
  }

  /**
   * 恢复指定墙体 Mesh 的材质为完全不透明。
   * @param wallId - 目标墙体 ID。
   */
  public restoreWallOpacity(wallId: string): void {
    const mesh: THREE.Mesh | undefined = this._meshes.get(wallId);
    if (mesh === undefined) {
      return;
    }
    /* 恢复流程：只还原透明相关属性，保留材质颜色和贴图等真实显示状态。 */
    const materials: Array<THREE.Material> = BuildingVisualStyleService.getMeshMaterials(mesh);
    for (const material of materials) {
      material.transparent = false;
      material.opacity = 1.0;
      material.needsUpdate = true;
    }
  }

  /**
   * 批量设置指定类别所有对象的材质透明度。
   * @param category - 建筑对象类别。
   * @param opacity - 透明度，1 表示完全不透明。
   */
  public setCategoryOpacity(category: BuildingCategory, opacity: number): void {
    const isTransparent: boolean = opacity < 1.0;
    this._objects.forEach((objectData: BuildingObject, objectId: string): void => {
      if (objectData.category !== category) {
        return;
      }
      const mesh: THREE.Mesh | undefined = this._meshes.get(objectId);
      if (mesh === undefined) {
        return;
      }
      /* 类别透明流程：统一遍历单材质/多材质 Mesh，保持外部 API 对材质结构无感。 */
      const materials: Array<THREE.Material> = BuildingVisualStyleService.getMeshMaterials(mesh);
      for (const material of materials) {
        material.transparent = isTransparent;
        material.opacity = opacity;
        material.needsUpdate = true;
      }
    });
  }

  /**
   * 批量设置指定类别所有对象的临时渲染颜色与透明度。
   * @param category - 建筑对象类别。
   * @param color - 临时显示颜色。
   * @param opacity - 临时透明度。
   */
  public setCategoryVisualStyle(category: BuildingCategory, color: number, opacity: number): void {
    const isTransparent: boolean = opacity < 1.0;
    this._objects.forEach((objectData: BuildingObject, objectId: string): void => {
      if (objectData.category !== category) {
        return;
      }
      const mesh: THREE.Mesh | undefined = this._meshes.get(objectId);
      if (mesh === undefined) {
        return;
      }
      /* 2D 临时样式流程：只覆盖渲染材质，真实材质仍以 BuildingObject.material 为准。 */
      const materials: Array<THREE.Material> = BuildingVisualStyleService.getMeshMaterials(mesh);
      for (const material of materials) {
        BuildingVisualStyleService.applyMaterialVisualStyle(material, color, opacity, isTransparent);
      }
    });
  }

  /**
   * 按对象真实材质数据恢复指定类别的渲染材质显示状态。
   * @param category - 建筑对象类别。
   */
  public restoreCategoryVisualStyle(category: BuildingCategory): void {
    this._objects.forEach((objectData: BuildingObject, objectId: string): void => {
      if (objectData.category !== category) {
        return;
      }
      const mesh: THREE.Mesh | undefined = this._meshes.get(objectId);
      if (mesh === undefined) {
        return;
      }
      const sourceMaterial: MaterialProperties = objectData.material;
      const isTransparent: boolean = sourceMaterial.opacity < 1.0;
      /* 恢复流程：从数据层材质恢复颜色和透明度，避免 2D 临时样式污染 3D 视图。 */
      const materials: Array<THREE.Material> = BuildingVisualStyleService.getMeshMaterials(mesh);
      for (const material of materials) {
        BuildingVisualStyleService.applyMaterialVisualStyle(material, sourceMaterial.color, sourceMaterial.opacity, isTransparent);
      }
    });
  }

  /**
   * 批量设置指定类别所有对象的 Mesh 可见性。
   * @param category - 建筑对象类别。
   * @param visible - true 表示显示，false 表示隐藏。
   */
  public setCategoryVisible(category: BuildingCategory, visible: boolean): void {
    this._objects.forEach((objectData: BuildingObject, objectId: string): void => {
      if (objectData.category !== category) {
        return;
      }
      const mesh: THREE.Mesh | undefined = this._meshes.get(objectId);
      if (mesh !== undefined) {
        mesh.visible = visible;
      }
    });
  }

  /**
   * 获取 Mesh 的材质数组视图。
   * @param mesh - 目标 Mesh。
   * @returns 材质数组。
   */
  private static getMeshMaterials(mesh: THREE.Mesh): Array<THREE.Material> {
    return Array.isArray(mesh.material)
      ? (mesh.material as Array<THREE.Material>)
      : [mesh.material as THREE.Material];
  }

  /**
   * 设置单个材质的临时视觉样式。
   * @param material - 目标材质。
   * @param color - 显示颜色。
   * @param opacity - 显示透明度。
   * @param transparent - 是否启用透明渲染。
   */
  private static applyMaterialVisualStyle(material: THREE.Material, color: number, opacity: number, transparent: boolean): void {
    if ('color' in material) {
      const colorMaterial: THREE.Material & { color: THREE.Color } = material as THREE.Material & { color: THREE.Color };
      colorMaterial.color.set(color);
    }
    material.transparent = transparent;
    material.opacity = opacity;
    material.needsUpdate = true;
  }
}