/**
 * 楼板面积计算工具
 * 提供基于 XZ 平面多边形轮廓的面积计算能力，供属性面板等业务读取套内面积。
 */

import type { Point2D } from './BuildingTypes';

/**
 * 楼板面积计算器
 */
export class FloorAreaCalculator {
  /**
   * 根据多边形顶点计算楼板面积。
   * @param outline - 楼板在 XZ 平面的轮廓顶点，按顺序排列，单位为米。
   * @returns 多边形面积，单位为平方米；顶点不足 3 个时返回 0。
   */
  public static calculatePolygonArea(outline: Point2D[]): number {
    if (outline.length < 3) {
      return 0;
    }

    let signedDoubleArea: number = 0;

    /* 使用鞋带公式累加有向二倍面积，最后取绝对值避免顶点顺逆时针影响结果。 */
    for (let index: number = 0; index < outline.length; index++) {
      const currentPoint: Point2D = outline[index] as Point2D;
      const nextIndex: number = (index + 1) % outline.length;
      const nextPoint: Point2D = outline[nextIndex] as Point2D;
      signedDoubleArea += currentPoint.x * nextPoint.z - nextPoint.x * currentPoint.z;
    }

    return Math.abs(signedDoubleArea) / 2;
  }
}