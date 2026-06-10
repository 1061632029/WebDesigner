/**
 * 面积计算工具
 * 提供 XZ 平面多边形的面积计算和质心计算
 * 用于 2D 模式下封闭墙体围合区域的面积标注
 */

import type { Point2D } from './BuildingTypes';

/**
 * 使用 Shoelace 公式（鞋带公式）计算 XZ 平面多边形面积
 * 公式：Area = 0.5 * |Σ(x_i * z_{i+1} - x_{i+1} * z_i)|
 * 适用于任意简单多边形（凸多边形和凹多边形均可）
 *
 * @param outline - 多边形顶点数组（XZ 平面，至少 3 个点，无需重复首尾）
 * @returns 多边形面积（平方米），顶点数不足 3 时返回 0
 */
export function computePolygonArea(outline: Point2D[]): number {
  const n: number = outline.length;
  if (n < 3) {
    return 0;
  }

  let sum: number = 0;
  for (let i: number = 0; i < n; i++) {
    /* 使用非空断言：循环范围已确保索引有效 */
    const current: Point2D = outline[i] as Point2D;
    /* 最后一个顶点与第一个顶点形成闭合边 */
    const next: Point2D = outline[(i + 1) % n] as Point2D;
    sum += current.x * next.z - next.x * current.z;
  }

  return Math.abs(sum) / 2;
}

/**
 * 计算 XZ 平面多边形的几何质心（重心）
 * 使用多边形质心公式（基于 Shoelace 公式的扩展）
 * 质心公式：
 *   Cx = Σ((x_i + x_{i+1}) * (x_i*z_{i+1} - x_{i+1}*z_i)) / (6 * Area)
 *   Cz = Σ((z_i + z_{i+1}) * (x_i*z_{i+1} - x_{i+1}*z_i)) / (6 * Area)
 *
 * 当面积为 0（退化多边形）时，退化为顶点坐标的算术平均值
 *
 * @param outline - 多边形顶点数组（XZ 平面，至少 3 个点）
 * @returns 多边形质心坐标（XZ 平面）
 */
export function computePolygonCentroid(outline: Point2D[]): Point2D {
  const n: number = outline.length;
  if (n === 0) {
    return { x: 0, z: 0 };
  }
  if (n === 1) {
    /* 使用非空断言：已确认 n === 1，索引 0 必然存在 */
    const pt: Point2D = outline[0] as Point2D;
    return { x: pt.x, z: pt.z };
  }
  if (n === 2) {
    const pt0: Point2D = outline[0] as Point2D;
    const pt1: Point2D = outline[1] as Point2D;
    return {
      x: (pt0.x + pt1.x) / 2,
      z: (pt0.z + pt1.z) / 2,
    };
  }

  /* 先计算有符号面积（保留符号用于质心公式） */
  let signedArea: number = 0;
  for (let i: number = 0; i < n; i++) {
    const current: Point2D = outline[i] as Point2D;
    const next: Point2D = outline[(i + 1) % n] as Point2D;
    signedArea += current.x * next.z - next.x * current.z;
  }
  signedArea /= 2;

  /* 面积为 0 时退化为算术平均 */
  if (Math.abs(signedArea) < 1e-10) {
    let sumX: number = 0;
    let sumZ: number = 0;
    for (const pt of outline) {
      sumX += pt.x;
      sumZ += pt.z;
    }
    return { x: sumX / n, z: sumZ / n };
  }

  /* 计算质心 */
  let cx: number = 0;
  let cz: number = 0;
  for (let i: number = 0; i < n; i++) {
    const current: Point2D = outline[i] as Point2D;
    const next: Point2D = outline[(i + 1) % n] as Point2D;
    const cross: number = current.x * next.z - next.x * current.z;
    cx += (current.x + next.x) * cross;
    cz += (current.z + next.z) * cross;
  }

  const factor: number = 1 / (6 * signedArea);
  return {
    x: cx * factor,
    z: cz * factor,
  };
}
