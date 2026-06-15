/**
 * STL 2D 旋转拖拽几何辅助工具。
 * 负责把鼠标射线投影到 XZ 地面平面，并计算围绕 Mesh 中心的平面角度。
 */

import * as THREE from 'three/webgpu';

/**
 * STL 2D 旋转拖拽几何辅助工具。
 */
export class StlRotateDragHelper {
  /** 用于承载鼠标射线与地面平面的交点，避免频繁创建临时对象。 */
  private readonly _groundIntersection: THREE.Vector3 = new THREE.Vector3();

  /** Y=0 的地面平面，2D 俯视旋转仅在 XZ 平面内计算。 */
  private readonly _groundPlane: THREE.Plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /**
   * 计算当前鼠标射线相对 Mesh 中心的 XZ 平面角度。
   * 关键流程：先将射线投影到地面平面，再以 Mesh 中心为原点计算 atan2(deltaZ, deltaX)。
   * @param raycaster - 已按鼠标屏幕坐标设置好的射线投射器
   * @param mesh - 当前被旋转的 STL Mesh
   * @returns 可计算时返回弧度角；射线未命中地面或距离中心过近时返回 null
   */
  public computePointerAngle(raycaster: THREE.Raycaster, mesh: THREE.Object3D): number | null {
    const hitPoint: THREE.Vector3 | null = raycaster.ray.intersectPlane(
      this._groundPlane,
      this._groundIntersection
    );
    if (hitPoint === null) {
      return null;
    }

    const deltaX: number = hitPoint.x - mesh.position.x;
    const deltaZ: number = hitPoint.z - mesh.position.z;
    const distanceSquared: number = deltaX * deltaX + deltaZ * deltaZ;
    if (distanceSquared < 0.000001) {
      return null;
    }

    return Math.atan2(deltaZ, deltaX);
  }
}