/**
 * XZ 平面二维几何通用工具。
 * 仅包含无业务状态的数学方法，供墙、梁、面等对象复用。
 */

import type { Point2D } from '../BuildingTypes';

/** 两条 XZ 平面线段的相交结果。 */
export interface SegmentIntersectionResult {
  /** 交点坐标。 */
  point: Point2D;
  /** 交点在第一条线段上的归一化参数，0 表示起点，1 表示终点。 */
  tA: number;
  /** 交点在第二条线段上的归一化参数，0 表示起点，1 表示终点。 */
  tB: number;
}

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
   * 计算两条 XZ 平面线段的唯一交点。
   * 关键流程：使用参数方程求解两条非平行线段交点，并校验交点参数是否位于两条线段范围内。
   * @param segmentAStart - 第一条线段起点。
   * @param segmentAEnd - 第一条线段终点。
   * @param segmentBStart - 第二条线段起点。
   * @param segmentBEnd - 第二条线段终点。
   * @param epsilon - 平行与边界判定容差。
   * @returns 存在唯一线段交点时返回交点和参数；平行、重合或不相交时返回 null。
   */
  public static intersectSegments(
    segmentAStart: Point2D,
    segmentAEnd: Point2D,
    segmentBStart: Point2D,
    segmentBEnd: Point2D,
    epsilon: number = Geometry2DUtils.DEFAULT_EPSILON
  ): SegmentIntersectionResult | null {
    const directionA: Point2D = {
      x: segmentAEnd.x - segmentAStart.x,
      z: segmentAEnd.z - segmentAStart.z,
    };
    const directionB: Point2D = {
      x: segmentBEnd.x - segmentBStart.x,
      z: segmentBEnd.z - segmentBStart.z,
    };
    const denominator: number = directionA.x * directionB.z - directionA.z * directionB.x;
    if (Math.abs(denominator) < epsilon) {
      /* 平行或重合线段没有唯一交点，调用方不应基于该结果拆墙。 */
      return null;
    }

    const diffX: number = segmentBStart.x - segmentAStart.x;
    const diffZ: number = segmentBStart.z - segmentAStart.z;
    const tA: number = (diffX * directionB.z - diffZ * directionB.x) / denominator;
    const tB: number = (diffX * directionA.z - diffZ * directionA.x) / denominator;
    if (tA < -epsilon || tA > 1 + epsilon || tB < -epsilon || tB > 1 + epsilon) {
      /* 参数超出任一线段范围时，两条有限线段没有发生相交。 */
      return null;
    }

    const clampedTA: number = Geometry2DUtils.clamp(tA, 0, 1);
    const clampedTB: number = Geometry2DUtils.clamp(tB, 0, 1);
    return {
      point: Geometry2DUtils.lerpPoint2D(segmentAStart, segmentAEnd, clampedTA),
      tA: clampedTA,
      tB: clampedTB,
    };
  }

  /**
   * 按归一化参数在线段上插值二维点。
   * @param start - 线段起点。
   * @param end - 线段终点。
   * @param t - 归一化参数，0 表示起点，1 表示终点。
   * @returns 插值后的二维点。
   */
  public static lerpPoint2D(start: Point2D, end: Point2D, t: number): Point2D {
    return {
      x: start.x + (end.x - start.x) * t,
      z: start.z + (end.z - start.z) * t,
    };
  }

  /**
   * 计算两个 XZ 平面二维点之间的距离。
   * @param pointA - 第一个点。
   * @param pointB - 第二个点。
   * @returns 两点间欧氏距离。
   */
  public static distancePoint2D(pointA: Point2D, pointB: Point2D): number {
    const dx: number = pointA.x - pointB.x;
    const dz: number = pointA.z - pointB.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /**
   * 将数值限制在指定闭区间内。
   * @param value - 待限制数值。
   * @param min - 最小值。
   * @param max - 最大值。
   * @returns 限制后的数值。
   */
  public static clamp(value: number, min: number, max: number): number {
    if (value < min) {
      return min;
    }
    if (value > max) {
      return max;
    }
    return value;
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