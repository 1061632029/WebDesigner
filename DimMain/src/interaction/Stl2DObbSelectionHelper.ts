/**
 * STL 2D OBB 投影选择辅助器。
 * 将 STL 模型的局部包围盒转换到世界坐标后投影到 XZ 平面，
 * 再通过点与凸多边形包含关系判断 2D 视图下的模型命中。
 */

import * as THREE from 'three/webgpu';
import type { Point2D } from '../building/BuildingTypes';

/** STL 2D OBB 命中结果。 */
export interface Stl2DObbHitResult {
  /** 命中的 STL Mesh。 */
  mesh: THREE.Mesh;
  /** STL 世界包围盒投影到 XZ 平面的多边形面积，面积越小选择优先级越高。 */
  projectedArea: number;
  /** 点击点到投影中心的距离，面积接近时距离越小优先级越高。 */
  distanceToCenter: number;
}

/** STL 投影多边形计算结果。 */
interface StlProjectedPolygon {
  /** XZ 平面投影凸包点，按逆时针顺序排列。 */
  hull: Array<Point2D>;
  /** 投影多边形面积。 */
  area: number;
  /** 投影多边形中心。 */
  center: Point2D;
}

/**
 * STL 2D OBB 投影选择辅助器。
 * 用于 2D 平面环境下替代三维三角面射线拾取，减少俯视图中因模型高度、遮挡或面朝向导致的误选/漏选。
 */
export class Stl2DObbSelectionHelper {
  /** 面积比较容差，避免浮点误差导致排序抖动。 */
  private static readonly AREA_COMPARE_EPSILON: number = 0.000001;

  /** 点与边界判断容差，允许点击在 OBB 边线附近时仍视为命中。 */
  private static readonly POINT_IN_POLYGON_EPSILON: number = 0.000001;

  /** 局部包围盒角点复用缓存，避免每次命中检测重复分配大量数组。 */
  private readonly _localCorners: [
    THREE.Vector3,
    THREE.Vector3,
    THREE.Vector3,
    THREE.Vector3,
    THREE.Vector3,
    THREE.Vector3,
    THREE.Vector3,
    THREE.Vector3
  ] = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3()
  ];

  /** 世界坐标临时点，避免在角点矩阵变换时频繁创建对象。 */
  private readonly _worldCorner: THREE.Vector3 = new THREE.Vector3();

  /**
   * 根据 XZ 平面点击点从 STL 目标列表中选择最合适的 Mesh。
   * @param point - 鼠标点击投影到 XZ 平面后的世界坐标
   * @param targets - 待检测的 STL 目标对象集合
   * @returns 命中结果；没有任何 OBB 投影包含点击点时返回 null
   */
  public pickByPoint(point: Point2D, targets: Array<THREE.Object3D>): Stl2DObbHitResult | null {
    const hitResults: Array<Stl2DObbHitResult> = [];

    /* OBB 命中主流程：遍历可见 STL Mesh，计算 XZ 投影凸包并执行点在凸多边形内判断。 */
    for (const target of targets) {
      if (!(target instanceof THREE.Mesh) || !target.visible) {
        continue;
      }

      const projectedPolygon: StlProjectedPolygon | null = this._computeProjectedPolygon(target);
      if (projectedPolygon === null) {
        continue;
      }

      if (!this._isPointInsideConvexPolygon(point, projectedPolygon.hull)) {
        continue;
      }

      const dx: number = point.x - projectedPolygon.center.x;
      const dz: number = point.z - projectedPolygon.center.z;
      const distanceToCenter: number = Math.sqrt(dx * dx + dz * dz);
      const hitResult: Stl2DObbHitResult = {
        mesh: target,
        projectedArea: projectedPolygon.area,
        distanceToCenter: distanceToCenter
      };
      hitResults.push(hitResult);
    }

    if (hitResults.length === 0) {
      return null;
    }

    /* 多模型投影重叠时优先选择面积更小的模型；面积接近时选择离点击点中心更近的模型。 */
    hitResults.sort((left: Stl2DObbHitResult, right: Stl2DObbHitResult): number => {
      const areaDelta: number = left.projectedArea - right.projectedArea;
      if (Math.abs(areaDelta) > Stl2DObbSelectionHelper.AREA_COMPARE_EPSILON) {
        return areaDelta;
      }

      return left.distanceToCenter - right.distanceToCenter;
    });

    const firstHit: Stl2DObbHitResult | undefined = hitResults[0];
    return firstHit ?? null;
  }

  /**
   * 计算 STL Mesh 局部包围盒在 XZ 平面的世界投影凸包。
   * @param mesh - 待计算的 STL Mesh
   * @returns 投影凸包、面积与中心；包围盒无效时返回 null
   */
  private _computeProjectedPolygon(mesh: THREE.Mesh): StlProjectedPolygon | null {
    const geometry: THREE.BufferGeometry = mesh.geometry;
    if (geometry.boundingBox === null) {
      geometry.computeBoundingBox();
    }

    const localBox: THREE.Box3 | null = geometry.boundingBox;
    if (localBox === null || localBox.isEmpty()) {
      return null;
    }

    mesh.updateMatrixWorld(true);
    this._setLocalBoxCorners(localBox);

    const projectedPoints: Array<Point2D> = [];
    for (let cornerIndex: number = 0; cornerIndex < this._localCorners.length; cornerIndex += 1) {
      const localCorner: THREE.Vector3 | undefined = this._localCorners[cornerIndex];
      if (localCorner === undefined) {
        continue;
      }

      this._worldCorner.copy(localCorner).applyMatrix4(mesh.matrixWorld);
      const projectedPoint: Point2D = {
        x: this._worldCorner.x,
        z: this._worldCorner.z
      };
      projectedPoints.push(projectedPoint);
    }

    const hull: Array<Point2D> = this._computeConvexHull(projectedPoints);
    if (hull.length < 3) {
      return null;
    }

    const area: number = Math.abs(this._computePolygonSignedArea(hull));
    if (area <= Stl2DObbSelectionHelper.AREA_COMPARE_EPSILON) {
      return null;
    }

    const center: Point2D = this._computePolygonCenter(hull);
    const projectedPolygon: StlProjectedPolygon = {
      hull: hull,
      area: area,
      center: center
    };
    return projectedPolygon;
  }

  /**
   * 根据局部包围盒最小/最大值写入 8 个角点。
   * @param localBox - Mesh 几何体局部包围盒
   */
  private _setLocalBoxCorners(localBox: THREE.Box3): void {
    const minX: number = localBox.min.x;
    const minY: number = localBox.min.y;
    const minZ: number = localBox.min.z;
    const maxX: number = localBox.max.x;
    const maxY: number = localBox.max.y;
    const maxZ: number = localBox.max.z;

    this._localCorners[0].set(minX, minY, minZ);
    this._localCorners[1].set(maxX, minY, minZ);
    this._localCorners[2].set(maxX, minY, maxZ);
    this._localCorners[3].set(minX, minY, maxZ);
    this._localCorners[4].set(minX, maxY, minZ);
    this._localCorners[5].set(maxX, maxY, minZ);
    this._localCorners[6].set(maxX, maxY, maxZ);
    this._localCorners[7].set(minX, maxY, maxZ);
  }

  /**
   * 使用单调链算法计算 XZ 投影点的二维凸包。
   * @param points - 待处理的二维点集合
   * @returns 按逆时针顺序排列的凸包点
   */
  private _computeConvexHull(points: Array<Point2D>): Array<Point2D> {
    const sortedPoints: Array<Point2D> = [...points].sort((left: Point2D, right: Point2D): number => {
      if (left.x !== right.x) {
        return left.x - right.x;
      }

      return left.z - right.z;
    });

    const uniquePoints: Array<Point2D> = [];
    for (const sortedPoint of sortedPoints) {
      const lastPoint: Point2D | undefined = uniquePoints[uniquePoints.length - 1];
      if (
        lastPoint !== undefined &&
        Math.abs(lastPoint.x - sortedPoint.x) <= Stl2DObbSelectionHelper.POINT_IN_POLYGON_EPSILON &&
        Math.abs(lastPoint.z - sortedPoint.z) <= Stl2DObbSelectionHelper.POINT_IN_POLYGON_EPSILON
      ) {
        continue;
      }

      uniquePoints.push({ x: sortedPoint.x, z: sortedPoint.z });
    }

    if (uniquePoints.length <= 1) {
      return uniquePoints;
    }

    const lowerHull: Array<Point2D> = [];
    for (const point of uniquePoints) {
      while (lowerHull.length >= 2) {
        const secondLastPoint: Point2D | undefined = lowerHull[lowerHull.length - 2];
        const lastPoint: Point2D | undefined = lowerHull[lowerHull.length - 1];
        if (secondLastPoint === undefined || lastPoint === undefined) {
          break;
        }

        if (this._cross(secondLastPoint, lastPoint, point) > Stl2DObbSelectionHelper.POINT_IN_POLYGON_EPSILON) {
          break;
        }

        lowerHull.pop();
      }

      lowerHull.push(point);
    }

    const upperHull: Array<Point2D> = [];
    for (let pointIndex: number = uniquePoints.length - 1; pointIndex >= 0; pointIndex -= 1) {
      const point: Point2D | undefined = uniquePoints[pointIndex];
      if (point === undefined) {
        continue;
      }

      while (upperHull.length >= 2) {
        const secondLastPoint: Point2D | undefined = upperHull[upperHull.length - 2];
        const lastPoint: Point2D | undefined = upperHull[upperHull.length - 1];
        if (secondLastPoint === undefined || lastPoint === undefined) {
          break;
        }

        if (this._cross(secondLastPoint, lastPoint, point) > Stl2DObbSelectionHelper.POINT_IN_POLYGON_EPSILON) {
          break;
        }

        upperHull.pop();
      }

      upperHull.push(point);
    }

    lowerHull.pop();
    upperHull.pop();

    return [...lowerHull, ...upperHull];
  }

  /**
   * 判断点是否位于凸多边形内，边界点也视为命中。
   * @param point - 待检测点击点
   * @param polygon - 逆时针凸多边形点集合
   * @returns 位于多边形内部或边界上时返回 true
   */
  private _isPointInsideConvexPolygon(point: Point2D, polygon: Array<Point2D>): boolean {
    if (polygon.length < 3) {
      return false;
    }

    for (let pointIndex: number = 0; pointIndex < polygon.length; pointIndex += 1) {
      const currentPoint: Point2D | undefined = polygon[pointIndex];
      const nextPoint: Point2D | undefined = polygon[(pointIndex + 1) % polygon.length];
      if (currentPoint === undefined || nextPoint === undefined) {
        return false;
      }

      const crossValue: number = this._cross(currentPoint, nextPoint, point);
      if (crossValue < -Stl2DObbSelectionHelper.POINT_IN_POLYGON_EPSILON) {
        return false;
      }
    }

    return true;
  }

  /**
   * 计算二维向量叉积，用于凸包构建和点在凸多边形内判断。
   * @param origin - 向量起点
   * @param first - 第一条边终点
   * @param second - 第二条边终点
   * @returns 二维叉积值
   */
  private _cross(origin: Point2D, first: Point2D, second: Point2D): number {
    const firstX: number = first.x - origin.x;
    const firstZ: number = first.z - origin.z;
    const secondX: number = second.x - origin.x;
    const secondZ: number = second.z - origin.z;
    return firstX * secondZ - firstZ * secondX;
  }

  /**
   * 使用鞋带公式计算多边形有向面积。
   * @param polygon - 多边形点集合
   * @returns 有向面积，逆时针为正，顺时针为负
   */
  private _computePolygonSignedArea(polygon: Array<Point2D>): number {
    let doubledArea: number = 0;

    for (let pointIndex: number = 0; pointIndex < polygon.length; pointIndex += 1) {
      const currentPoint: Point2D | undefined = polygon[pointIndex];
      const nextPoint: Point2D | undefined = polygon[(pointIndex + 1) % polygon.length];
      if (currentPoint === undefined || nextPoint === undefined) {
        continue;
      }

      doubledArea += currentPoint.x * nextPoint.z - nextPoint.x * currentPoint.z;
    }

    return doubledArea * 0.5;
  }

  /**
   * 计算投影多边形中心点。面积退化时回退为顶点平均值。
   * @param polygon - 多边形点集合
   * @returns 多边形中心点
   */
  private _computePolygonCenter(polygon: Array<Point2D>): Point2D {
    const signedArea: number = this._computePolygonSignedArea(polygon);
    if (Math.abs(signedArea) <= Stl2DObbSelectionHelper.AREA_COMPARE_EPSILON) {
      return this._computeAverageCenter(polygon);
    }

    let centerXFactor: number = 0;
    let centerZFactor: number = 0;

    for (let pointIndex: number = 0; pointIndex < polygon.length; pointIndex += 1) {
      const currentPoint: Point2D | undefined = polygon[pointIndex];
      const nextPoint: Point2D | undefined = polygon[(pointIndex + 1) % polygon.length];
      if (currentPoint === undefined || nextPoint === undefined) {
        continue;
      }

      const crossValue: number = currentPoint.x * nextPoint.z - nextPoint.x * currentPoint.z;
      centerXFactor += (currentPoint.x + nextPoint.x) * crossValue;
      centerZFactor += (currentPoint.z + nextPoint.z) * crossValue;
    }

    const divisor: number = 6 * signedArea;
    const center: Point2D = {
      x: centerXFactor / divisor,
      z: centerZFactor / divisor
    };
    return center;
  }

  /**
   * 通过顶点平均值计算退化多边形中心。
   * @param polygon - 多边形点集合
   * @returns 顶点平均中心
   */
  private _computeAverageCenter(polygon: Array<Point2D>): Point2D {
    let totalX: number = 0;
    let totalZ: number = 0;

    for (const point of polygon) {
      totalX += point.x;
      totalZ += point.z;
    }

    const count: number = Math.max(1, polygon.length);
    const center: Point2D = {
      x: totalX / count,
      z: totalZ / count
    };
    return center;
  }
}