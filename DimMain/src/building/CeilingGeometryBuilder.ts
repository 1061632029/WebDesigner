/**
 * 天花板几何构建器
 * 将封闭多边形轮廓（XZ 平面）挤压为具有厚度的天花板几何体
 * 使用 THREE.Shape + ExtrudeGeometry 实现，天花板从 Y=0 向上延伸 ceilingThickness
 *
 * 坐标变换与 SlabGeometryBuilder 完全相同：
 *   Shape(x, y) = (世界x, -世界z)
 *   ExtrudeGeometry 挤压方向 +Z
 *   rotateX(-90°) 后：
 *     新 X = 旧 X = 世界 x       ✓
 *     新 Y = 旧 Z = 挤压方向      ✓（天花板厚度方向，向上）
 *     新 Z = -(旧 Y) = 世界 z    ✓
 *
 * 天花板 Mesh 的 position.y = bottomOffset，使底面贴合墙顶
 */

import * as THREE from 'three/webgpu';
import type { CeilingData } from './BuildingTypes';
import type { Point2D } from './BuildingTypes';

/**
 * 天花板几何构建器
 * 职责：将 CeilingData 转换为 Three.js BufferGeometry
 */
export class CeilingGeometryBuilder {
  /**
   * 根据天花板数据构建几何体
   * 轮廓在 XZ 平面，挤压方向为 +Y（向上），天花板底面与 Y=0 对齐
   * 调用方需将 Mesh.position.y 设为 bottomOffset 使底面贴合墙顶
   * @param data - 天花板数据
   * @returns Three.js BufferGeometry
   */
  public build(data: CeilingData): THREE.BufferGeometry {
    return this._buildFromOutline(data.outline, data.ceilingThickness);
  }

  /**
   * 直接从轮廓坐标和厚度构建天花板几何体
   * 供 BuildingObjectManager 在自动生成天花板时调用
   * @param outline - XZ 平面多边形顶点数组（至少 3 个点）
   * @param ceilingThickness - 天花板厚度（米）
   * @returns Three.js BufferGeometry；轮廓点不足时返回空几何体
   */
  public buildFromOutline(outline: Point2D[], ceilingThickness: number): THREE.BufferGeometry {
    return this._buildFromOutline(outline, ceilingThickness);
  }

  /**
   * 内部构建方法
   * 将 XZ 平面多边形轮廓转换为 ExtrudeGeometry
   *
   * 坐标变换推导（与 SlabGeometryBuilder 相同）：
   *   Shape(x, y) = (世界x, -世界z)
   *   ExtrudeGeometry 挤压方向 +Z
   *   rotateX(-90°) 后：
   *     新 X = 旧 X = 世界 x       ✓
   *     新 Y = 旧 Z = 挤压方向      ✓（天花板向上延伸）
   *     新 Z = -(旧 Y) = 世界 z    ✓
   *
   * @param outline - 多边形顶点（XZ 坐标）
   * @param ceilingThickness - 挤压厚度（米）
   * @returns BufferGeometry
   */
  private _buildFromOutline(outline: Point2D[], ceilingThickness: number): THREE.BufferGeometry {
    /* 轮廓点不足时返回空几何体 */
    if (outline.length < 3) {
      return new THREE.BufferGeometry();
    }

    /* 构建 THREE.Shape（在 XY 平面，用 x→x, -z→y 映射，预翻转 Z 坐标） */
    const shape: THREE.Shape = new THREE.Shape();
    const firstPoint: Point2D = outline[0]!;
    shape.moveTo(firstPoint.x, -firstPoint.z);

    for (let i: number = 1; i < outline.length; i++) {
      const pt: Point2D = outline[i]!;
      shape.lineTo(pt.x, -pt.z);
    }

    /* 闭合轮廓 */
    shape.closePath();

    /* 挤压参数：沿 Z 轴（Shape 的法线方向）挤压 ceilingThickness */
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: ceilingThickness,
      bevelEnabled: false,
    };

    const extrudeGeometry: THREE.ExtrudeGeometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    /* ExtrudeGeometry 默认在 XY 平面展开，挤压方向为 +Z
     * 绕 X 轴旋转 -90° 使天花板平铺在 XZ 平面：
     *   旧 X → 新 X（世界 x）
     *   旧 Y(-世界z) → 新 Z(-(-世界z)) = 世界 z ✓
     *   旧 Z(挤压) → 新 -Y（天花板向上延伸，因为 -90° 旋转后 +Z → -Y，
     *                       但 Mesh.position.y = bottomOffset 使底面在正确高度）
     *
     * 注意：旋转后挤压方向变为 -Y，因此几何体从 Y=0 向下延伸 ceilingThickness
     * 调用方设置 Mesh.position.y = bottomOffset + ceilingThickness 使底面在 bottomOffset
     */
    extrudeGeometry.rotateX(-Math.PI / 2);

    return extrudeGeometry;
  }
}
