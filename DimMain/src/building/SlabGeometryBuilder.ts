/**
 * 楼板几何构建器
 * 将封闭多边形轮廓（XZ 平面）挤压为具有厚度的楼板几何体
 * 使用 THREE.Shape + ExtrudeGeometry 实现，楼板从 Y=0 向下延伸 slabThickness
 */

import * as THREE from 'three/webgpu';
import type { SlabData } from './BuildingTypes';
import type { Point2D } from './BuildingTypes';

/**
 * 楼板几何构建器
 * 职责：将 SlabData 转换为 Three.js BufferGeometry
 */
export class SlabGeometryBuilder {
  /**
   * 根据楼板数据构建几何体
   * 轮廓在 XZ 平面，挤压方向为 -Y（向下），楼板顶面与 Y=elevation 对齐
   * @param data - 楼板数据
   * @returns Three.js BufferGeometry
   */
  public build(data: SlabData): THREE.BufferGeometry {
    return this._buildFromOutline(data.outline, data.slabThickness);
  }

  /**
   * 直接从轮廓坐标和厚度构建楼板几何体
   * 供 BuildingObjectManager 在自动生成楼板时调用
   * @param outline - XZ 平面多边形顶点数组（至少 3 个点）
   * @param slabThickness - 楼板厚度（米）
   * @returns Three.js BufferGeometry；轮廓点不足时返回空几何体
   */
  public buildFromOutline(outline: Point2D[], slabThickness: number): THREE.BufferGeometry {
    return this._buildFromOutline(outline, slabThickness);
  }

  /**
   * 内部构建方法
   * 将 XZ 平面多边形轮廓转换为 ExtrudeGeometry
   * Three.js Shape 在 XY 平面定义，因此用 (x, -z) 映射到 Shape 的 (x, y)，
   * 预翻转 Z 坐标以抵消 rotateX(-90°) 对 Y 维度的翻转
   *
   * 坐标变换推导：
   *   Shape(x, y) = (世界x, -世界z)
   *   ExtrudeGeometry 挤压方向 +Z
   *   rotateX(-90°) 后：
   *     新 X = 旧 X = 世界 x       ✓
   *     新 Y = 旧 Z = 挤压方向      ✓（楼板厚度方向）
   *     新 Z = -(旧 Y) = -(-世界z) = 世界 z  ✓
   *
   * @param outline - 多边形顶点（XZ 坐标）
   * @param slabThickness - 挤压厚度（米）
   * @returns BufferGeometry
   */
  private _buildFromOutline(outline: Point2D[], slabThickness: number): THREE.BufferGeometry {
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

    /* 挤压参数：沿 Z 轴（Shape 的法线方向）挤压 slabThickness */
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: slabThickness,
      bevelEnabled: false,
    };

    const extrudeGeometry: THREE.ExtrudeGeometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    /* ExtrudeGeometry 默认在 XY 平面展开，挤压方向为 +Z
     * 绕 X 轴旋转 -90° 使楼板平铺在 XZ 平面：
     *   旧 X → 新 X（世界 x）
     *   旧 Y(-世界z) → 新 Z(-(-世界z)) = 世界 z ✓
     *   旧 Z(挤压) → 新 -Y（楼板向下延伸）
     */
    extrudeGeometry.rotateX(-Math.PI / 2);

    return extrudeGeometry;
  }
}
