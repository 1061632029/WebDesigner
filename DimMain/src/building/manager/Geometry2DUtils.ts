/**
 * XZ 平面二维几何通用工具。
 * 仅包含无业务状态的数学方法，供墙、梁、面等对象复用。
 */

import type { Point2D } from '../BuildingTypes';

/** XZ 平面二维几何通用工具。 */
export class Geometry2DUtils {
  /** 墙体拖拽、直线相交等二维运算使用的默认容差。 */
  public static readonly DEFAULT_EPSILON: number = 0.000001;

  /**
   * 计算 XZ 平面二维向量的单位向量。
   * @param vector - 原始二维向量。
   * @param epsilon - 长度容差，长度过小时视为无效向量。
   * @returns 单位向量；长度过小时返回 null。
   */
  public static normalizePoint2D(vector: Point2D, epsilon: number = Geometry2DUtils.DEFAULT_EPSILON): Point2D | null {
    const length: number = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
    if (length < epsilon) {
      return null;
    }

    return {
      x: vector.x / length,
      z: vector.z / length,
    };
  }

  /**
   * 计算两条 XZ 平面无限直线的交点。
   * @param pointA - 第一条直线上的点。
   * @param directionA - 第一条直线方向。
   * @param pointB - 第二条直线上的点。
   * @param directionB - 第二条直线方向。
   * @param epsilon - 平行判定容差。
   * @returns 交点；平行或近似平行时返回 null。
   */
  public static intersectInfiniteLines(
    pointA: Point2D,
    directionA: Point2D,
    pointB: Point2D,
    directionB: Point2D,
    epsilon: number = Geometry2DUtils.DEFAULT_EPSILON
  ): Point2D | null {
    const denominator: number = directionA.x * directionB.z - directionA.z * directionB.x;
    if (Math.abs(denominator) < epsilon) {
      return null;
    }

    const diffX: number = pointB.x - pointA.x;
    const diffZ: number = pointB.z - pointA.z;
    const t: number = (diffX * directionB.z - diffZ * directionB.x) / denominator;
    return {
      x: pointA.x + t * directionA.x,
      z: pointA.z + t * directionA.z,
    };
  }

  /**
   * 判断点是否落在指定 XZ 平面无限直线上。
   * @param point - 待检测点。
   * @param linePoint - 直线上的已知点。
   * @param lineDirection - 直线方向单位向量。
   * @param epsilon - 点到直线距离容差。
   * @returns 点到直线距离在容差内返回 true。
   */
  public static isPointOnLine(
    point: Point2D,
    linePoint: Point2D,
    lineDirection: Point2D,
    epsilon: number = Geometry2DUtils.DEFAULT_EPSILON
  ): boolean {
    const diffX: number = point.x - linePoint.x;
    const diffZ: number = point.z - linePoint.z;
    const crossDistance: number = Math.abs(diffX * lineDirection.z - diffZ * lineDirection.x);
    return crossDistance < epsilon;
  }
}