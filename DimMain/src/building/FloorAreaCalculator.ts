/**
 * 楼板面积计算工具
 * 提供基于 XZ 平面多边形轮廓的面积计算能力，供属性面板等业务读取套内面积。
 */

import type { Point2D, SlabData } from './BuildingTypes';

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

  /**
   * 根据外轮廓和内轮廓洞口计算净面积。
   * 关键流程：先计算外轮廓面积，再逐个扣除有效内洞面积，最后将结果限制为非负值。
   * @param outline - 楼板外轮廓顶点，按顺序排列，单位为米。
   * @param innerOutlines - 楼板内轮廓洞口集合，单位为米；少于 3 个点的洞口会被忽略。
   * @returns 扣除内洞后的净面积，单位为平方米。
   */
  public static calculateAreaWithHoles(outline: Point2D[], innerOutlines: Point2D[][]): number {
    const outerArea: number = FloorAreaCalculator.calculatePolygonArea(outline);
    let innerAreaTotal: number = 0;

    /* 循环逻辑：逐个扣除内轮廓洞口面积，洞口方向不影响扣减结果。 */
    for (let innerOutlineIndex: number = 0; innerOutlineIndex < innerOutlines.length; innerOutlineIndex += 1) {
      const innerOutline: Point2D[] = innerOutlines[innerOutlineIndex] as Point2D[];
      if (innerOutline.length < 3) {
        continue;
      }
      innerAreaTotal += FloorAreaCalculator.calculatePolygonArea(innerOutline);
    }

    const netArea: number = outerArea - innerAreaTotal;
    return Math.max(0, netArea);
  }

  /**
   * 根据楼板数据计算扣除内轮廓洞口后的净面积。
   * @param slabData - 楼板数据，包含外轮廓和可选内轮廓洞口集合。
   * @returns 楼板净面积，单位为平方米。
   */
  public static calculateSlabArea(slabData: SlabData): number {
    const innerOutlines: Point2D[][] = Array.isArray(slabData.innerOutlines) ? slabData.innerOutlines : [];
    return FloorAreaCalculator.calculateAreaWithHoles(slabData.outline, innerOutlines);
  }
}