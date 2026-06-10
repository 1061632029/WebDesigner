import * as THREE from 'three/webgpu';

/**
 * 几何体工厂类
 * 提供常用基础几何体的创建方法，封装 Three.js 内置几何体类
 */
export class GeometryFactory {
  /**
   * 创建立方体几何体
   * @param width - 宽度，默认 1
   * @param height - 高度，默认 1
   * @param depth - 深度，默认 1
   * @returns BoxGeometry 实例
   */
  public static createBox(
    width: number = 1,
    height: number = 1,
    depth: number = 1
  ): THREE.BoxGeometry {
    return new THREE.BoxGeometry(width, height, depth);
  }

  /**
   * 创建球体几何体
   * @param radius - 半径，默认 1
   * @param widthSegments - 水平分段数，默认 32
   * @param heightSegments - 垂直分段数，默认 16
   * @returns SphereGeometry 实例
   */
  public static createSphere(
    radius: number = 1,
    widthSegments: number = 32,
    heightSegments: number = 16
  ): THREE.SphereGeometry {
    return new THREE.SphereGeometry(radius, widthSegments, heightSegments);
  }

  /**
   * 创建平面几何体
   * @param width - 宽度，默认 1
   * @param height - 高度，默认 1
   * @returns PlaneGeometry 实例
   */
  public static createPlane(
    width: number = 1,
    height: number = 1
  ): THREE.PlaneGeometry {
    return new THREE.PlaneGeometry(width, height);
  }

  /**
   * 创建圆柱体几何体
   * @param radiusTop - 顶部半径，默认 1
   * @param radiusBottom - 底部半径，默认 1
   * @param height - 高度，默认 1
   * @param radialSegments - 径向分段数，默认 32
   * @returns CylinderGeometry 实例
   */
  public static createCylinder(
    radiusTop: number = 1,
    radiusBottom: number = 1,
    height: number = 1,
    radialSegments: number = 32
  ): THREE.CylinderGeometry {
    return new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments);
  }

  /**
   * 创建圆环几何体
   * @param radius - 主半径，默认 1
   * @param tube - 管半径，默认 0.4
   * @param radialSegments - 径向分段数，默认 16
   * @param tubularSegments - 管分段数，默认 48
   * @returns TorusGeometry 实例
   */
  public static createTorus(
    radius: number = 1,
    tube: number = 0.4,
    radialSegments: number = 16,
    tubularSegments: number = 48
  ): THREE.TorusGeometry {
    return new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments);
  }
}
