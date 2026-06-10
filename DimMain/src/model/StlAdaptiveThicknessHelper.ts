/**
 * STL 门窗自适应墙体厚度工具
 * 负责判断门窗是否启用自适应厚度，并根据墙体厚度同步模型局部 Z 轴尺寸。
 */

import * as THREE from 'three/webgpu';

/** 门窗模型分类集合 */
const DOOR_WINDOW_CATEGORIES: Set<string> = new Set<string>(['door', 'window']);

/**
 * STL 门窗自适应墙体厚度工具类
 */
export class StlAdaptiveThicknessHelper {
  /**
   * 判断指定模型分类是否属于门窗构件
   * @param category - STL 模型分类
   * @returns 若为门或窗则返回 true
   */
  public static isDoorWindowCategory(category: string): boolean {
    return DOOR_WINDOW_CATEGORIES.has(category);
  }

  /**
   * 解析注册表中的自适应厚度配置
   * 门窗默认启用；非门窗默认禁用。
   * @param category - STL 模型分类
   * @param configuredValue - 注册表显式配置值
   * @returns 最终是否启用自适应厚度
   */
  public static resolveEnabled(category: string, configuredValue: boolean | undefined): boolean {
    if (!StlAdaptiveThicknessHelper.isDoorWindowCategory(category)) {
      return false;
    }

    return configuredValue ?? true;
  }

  /**
   * 判断已放置 Mesh 是否启用自适应厚度
   * @param mesh - STL Mesh
   * @returns 若 userData 标记为启用则返回 true
   */
  public static isEnabledForMesh(mesh: THREE.Mesh): boolean {
    const category: string = (mesh.userData['category'] as string | undefined) ?? '';
    const configuredValue: boolean | undefined = mesh.userData['isAdaptiveThickness'] as boolean | undefined;
    return StlAdaptiveThicknessHelper.resolveEnabled(category, configuredValue);
  }

  /**
   * 判断已放置 Mesh 的厚度属性是否应置灰只读
   * 仅吸附到墙体且启用自适应厚度的门窗需要禁止手动改厚度。
   * @param mesh - STL Mesh
   * @returns 若厚度由墙体控制则返回 true
   */
  public static isThicknessReadonly(mesh: THREE.Mesh): boolean {
    const wallId: string | undefined = mesh.userData['wallId'] as string | undefined;
    return wallId !== undefined && StlAdaptiveThicknessHelper.isEnabledForMesh(mesh);
  }

  /**
   * 按墙体厚度同步 Mesh 的局部 Z 轴缩放，并刷新包围盒缓存
   * @param mesh - 需要同步厚度的门窗 Mesh
   * @param wallThickness - 墙体厚度（米）
   * @returns 若成功同步则返回 true；原始厚度无效时返回 false
   */
  public static applyWallThickness(mesh: THREE.Mesh, wallThickness: number): boolean {
    const originalSizeZ: number = (mesh.userData['originalSizeZ'] as number | undefined) ?? 0;
    if (originalSizeZ <= 0 || wallThickness <= 0) {
      return false;
    }

    /* 自适应厚度核心流程：局部 Z 轴代表门窗厚度，按墙厚 / 原始厚度换算缩放。 */
    const newScaleZ: number = wallThickness / originalSizeZ;
    mesh.scale.setZ(newScaleZ);
    mesh.userData['adaptiveThicknessValue'] = wallThickness;
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    StlAdaptiveThicknessHelper.refreshBoundingBoxCache(mesh);
    return true;
  }

  /**
   * 刷新 Mesh.userData 中的世界 AABB 包围盒缓存
   * @param mesh - STL Mesh
   */
  public static refreshBoundingBoxCache(mesh: THREE.Mesh): void {
    const bbox: THREE.Box3 = new THREE.Box3().setFromObject(mesh);
    mesh.userData['boundingBox'] = {
      min: { x: bbox.min.x, z: bbox.min.z },
      max: { x: bbox.max.x, z: bbox.max.z },
      center: { x: (bbox.min.x + bbox.max.x) / 2, z: (bbox.min.z + bbox.max.z) / 2 },
      size: {
        x: bbox.max.x - bbox.min.x,
        y: bbox.max.y - bbox.min.y,
        z: bbox.max.z - bbox.min.z,
      },
    };
  }
}