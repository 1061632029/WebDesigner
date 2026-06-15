/**
 * 线式构件拖拽几何辅助器
 * 统一处理直墙、梁等由二维中心线和宽度定义的构件命中与法向拖拽计算。
 */

import type { Point2D } from '../building/BuildingTypes';

/** 线式构件拖拽几何参数。 */
export interface LineElementDragGeometry {
  /** 中心线长度。 */
  length: number;
  /** 中心线单位方向。 */
  unit: Point2D;
  /** 中心线左法向单位方向。 */
  normal: Point2D;
}

/** 线式构件端点方向约束。 */
export interface LineElementDirectionConstraint {
  /** 约束线上的固定点。 */
  fixedPoint: Point2D;
  /** 从固定点指向被约束端点的单位方向。 */
  direction: Point2D;
}

/** 线式构件拖拽几何辅助器。 */
export class LineElementDragGeometryHelper {
  /** 线式拖拽几何计算容差。 */
  private static readonly EPSILON: number = 0.000001;

  /**
   * 根据线段起终点构建拖拽几何参数。
   * @param start - 中心线起点
   * @param end - 中心线终点
   * @param minLength - 最小有效长度
   * @returns 有效几何参数；线段过短时返回 null
   */
  public static createGeometry(start: Point2D, end: Point2D, minLength: number = 0.001): LineElementDragGeometry | null {
    const dirX: number = end.x - start.x;
    const dirZ: number = end.z - start.z;
    const length: number = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (length < minLength) {
      return null;
    }

    const unit: Point2D = { x: dirX / length, z: dirZ / length };
    const normal: Point2D = { x: -unit.z, z: unit.x };
    return {
      length: length,
      unit: unit,
      normal: normal,
    };
  }

  /**
   * 判断地面投影点是否位于线式构件二维实体范围内。
   * @param point - 待检测点
   * @param start - 中心线起点
   * @param geometry - 线式构件拖拽几何参数
   * @param width - 构件二维宽度
   * @param tolerance - 命中容差
   * @returns 位于实体范围内时返回 true
   */
  public static isPointInsideBody(
    point: Point2D,
    start: Point2D,
    geometry: LineElementDragGeometry,
    width: number,
    tolerance: number
  ): boolean {
    const relativeX: number = point.x - start.x;
    const relativeZ: number = point.z - start.z;
    const alongDistance: number = relativeX * geometry.unit.x + relativeZ * geometry.unit.z;
    const normalDistance: number = Math.abs(relativeX * geometry.normal.x + relativeZ * geometry.normal.z);

    /* 命中条件：投影落在线段长度范围内，且法向距离不超过构件半宽。 */
    return alongDistance >= -tolerance &&
      alongDistance <= geometry.length + tolerance &&
      normalDistance <= width * 0.5 + tolerance;
  }

  /**
   * 根据当前鼠标地面点计算相对拖拽起点中心线的法向偏移。
   * @param groundPoint - 当前鼠标地面投影点
   * @param linePoint - 拖拽起点中心线参考点
   * @param normal - 拖拽法向单位方向
   * @param hitToLineNormalDistance - 初始命中点到中心线的法向距离
   * @returns 仅保留法向分量的二维偏移
   */
  public static computeNormalOffset(
    groundPoint: Point2D,
    linePoint: Point2D,
    normal: Point2D,
    hitToLineNormalDistance: number
  ): Point2D {
    const currentMouseNormalDistance: number =
      (groundPoint.x - linePoint.x) * normal.x +
      (groundPoint.z - linePoint.z) * normal.z;
    const normalDistance: number = currentMouseNormalDistance - hitToLineNormalDistance;
    return {
      x: normal.x * normalDistance,
      z: normal.z * normalDistance,
    };
  }

  /**
   * 解析线式构件被拖拽端点在方向约束下的目标坐标。
   * 关键流程：无相邻约束时直接按偏移平移端点；存在约束时，求拖拽目标中心线与相邻构件原方向线的交点。
   * @param originalEndpointPoint - 拖拽开始时的端点坐标
   * @param offset - 当前拖拽总偏移
   * @param draggedLinePoint - 拖拽线段的原始参考点
   * @param draggedLineDirection - 拖拽线段的单位方向
   * @param constraints - 与该端点相连的方向约束列表
   * @returns 解析成功时返回目标点；约束冲突或平行无唯一交点时返回 null
   */
  public static resolveEndpointPosition(
    originalEndpointPoint: Point2D,
    offset: Point2D,
    draggedLinePoint: Point2D,
    draggedLineDirection: Point2D,
    constraints: LineElementDirectionConstraint[]
  ): Point2D | null {
    const fallbackPoint: Point2D = {
      x: originalEndpointPoint.x + offset.x,
      z: originalEndpointPoint.z + offset.z,
    };
    if (constraints.length === 0) {
      return fallbackPoint;
    }

    const targetLinePoint: Point2D = {
      x: draggedLinePoint.x + offset.x,
      z: draggedLinePoint.z + offset.z,
    };
    const primaryConstraint: LineElementDirectionConstraint = constraints[0]!;
    const intersection: Point2D | null = LineElementDragGeometryHelper.intersectInfiniteLines(
      targetLinePoint,
      draggedLineDirection,
      primaryConstraint.fixedPoint,
      primaryConstraint.direction
    );
    if (intersection === null) {
      return null;
    }

    /* 多约束分支：交点必须同时落在全部相邻方向线上，否则说明节点约束冲突，调用方应取消本次移动。 */
    for (let constraintIndex: number = 1; constraintIndex < constraints.length; constraintIndex++) {
      const constraint: LineElementDirectionConstraint = constraints[constraintIndex]!;
      if (!LineElementDragGeometryHelper.isPointOnLine(intersection, constraint.fixedPoint, constraint.direction)) {
        return null;
      }
    }

    return intersection;
  }

  /**
   * 计算 XZ 平面两条无限直线的交点。
   * @param pointA - 第一条直线上的已知点
   * @param directionA - 第一条直线单位方向
   * @param pointB - 第二条直线上的已知点
   * @param directionB - 第二条直线单位方向
   * @returns 存在唯一交点时返回交点；平行或近似平行时返回 null
   */
  public static intersectInfiniteLines(
    pointA: Point2D,
    directionA: Point2D,
    pointB: Point2D,
    directionB: Point2D
  ): Point2D | null {
    const denominator: number = directionA.x * directionB.z - directionA.z * directionB.x;
    if (Math.abs(denominator) < LineElementDragGeometryHelper.EPSILON) {
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
   * 判断点是否位于指定 XZ 平面无限直线上。
   * @param point - 待判断点
   * @param linePoint - 直线上的已知点
   * @param lineDirection - 直线单位方向
   * @returns 点到直线距离在容差内时返回 true
   */
  public static isPointOnLine(point: Point2D, linePoint: Point2D, lineDirection: Point2D): boolean {
    const diffX: number = point.x - linePoint.x;
    const diffZ: number = point.z - linePoint.z;
    const cross: number = diffX * lineDirection.z - diffZ * lineDirection.x;
    return Math.abs(cross) < LineElementDragGeometryHelper.EPSILON;
  }
}