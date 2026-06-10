/**
 * 墙体布置线转换工具
 * 负责把交互绘制时的墙内侧线转换为现有墙体数据模型使用的中心线。
 */

import type { Point2D } from './BuildingTypes';

/** 墙体布置线转换结果。 */
export interface WallCenterLine {
  /** 墙体中心线起点。 */
  start: Point2D;
  /** 墙体中心线终点。 */
  end: Point2D;
}

/** 矩形墙顺时针内侧边集合。 */
export interface ClockwiseRectInnerEdges {
  /** 第一条顺时针内侧边起点。 */
  c1: Point2D;
  /** 第二个顺时针节点。 */
  c2: Point2D;
  /** 第三个顺时针节点。 */
  c3: Point2D;
  /** 第四个顺时针节点。 */
  c4: Point2D;
}

/** 闭合轮廓偏移线段。 */
interface OffsetLineSegment {
  /** 偏移线起点 X 坐标。 */
  p0x: number;
  /** 偏移线起点 Z 坐标。 */
  p0z: number;
  /** 偏移线终点 X 坐标。 */
  p1x: number;
  /** 偏移线终点 Z 坐标。 */
  p1z: number;
  /** 原始边方向单位向量 X 分量。 */
  dirX: number;
  /** 原始边方向单位向量 Z 分量。 */
  dirZ: number;
}

/**
 * 墙体布置线转换工具类。
 * 关键约定：用户绘制线为墙内侧面所在的线，内部 StraightWallData 仍保存中心线。
 */
export class WallPlacementLineConverter {
  /** 坐标计算容差。 */
  private static readonly EPSILON: number = 0.000001;

  /**
   * 将墙内侧布置线转换为墙中心线。
   * 关键流程：沿现有几何的 +norm 方向偏移半个墙厚，使原始绘制线落在 -norm 内侧面上。
   * @param innerStart - 墙内侧线起点
   * @param innerEnd - 墙内侧线终点
   * @param thickness - 墙体厚度
   * @returns 转换后的墙中心线；当线段长度无效时返回原始线段副本
   */
  public static convertInnerLineToCenterLine(
    innerStart: Point2D,
    innerEnd: Point2D,
    thickness: number
  ): WallCenterLine {
    const dx: number = innerEnd.x - innerStart.x;
    const dz: number = innerEnd.z - innerStart.z;
    const length: number = Math.sqrt(dx * dx + dz * dz);

    if (length <= WallPlacementLineConverter.EPSILON) {
      /* 线段过短时无法稳定计算法线，保留原始坐标以交给上层既有校验处理。 */
      return {
        start: { x: innerStart.x, z: innerStart.z },
        end: { x: innerEnd.x, z: innerEnd.z },
      };
    }

    const dirX: number = dx / length;
    const dirZ: number = dz / length;
    const normX: number = -dirZ;
    const normZ: number = dirX;
    const halfThickness: number = thickness / 2;

    return {
      start: {
        x: innerStart.x + normX * halfThickness,
        z: innerStart.z + normZ * halfThickness,
      },
      end: {
        x: innerEnd.x + normX * halfThickness,
        z: innerEnd.z + normZ * halfThickness,
      },
    };
  }

  /**
   * 根据矩形对角点生成顺时针室内净轮廓节点。
   * 关键流程：无论用户从哪个方向拖拽，都按 XZ 平面顺时针输出节点，确保墙厚向房间外侧扩展。
   * @param corner1 - 用户拖拽矩形对角点 1
   * @param corner2 - 用户拖拽矩形对角点 2
   * @returns 顺时针矩形内侧轮廓四节点
   */
  public static createClockwiseRectInnerEdges(corner1: Point2D, corner2: Point2D): ClockwiseRectInnerEdges {
    const minX: number = Math.min(corner1.x, corner2.x);
    const maxX: number = Math.max(corner1.x, corner2.x);
    const minZ: number = Math.min(corner1.z, corner2.z);
    const maxZ: number = Math.max(corner1.z, corner2.z);

    /* XZ 平面顺时针节点：左上 → 右上 → 右下 → 左下。 */
    return {
      c1: { x: minX, z: maxZ },
      c2: { x: maxX, z: maxZ },
      c3: { x: maxX, z: minZ },
      c4: { x: minX, z: minZ },
    };
  }

  /**
   * 将墙内侧闭合轮廓转换为连续闭合的墙中心线集合。
   * 关键流程：先按轮廓绕行方向把每条内侧边向墙外偏移半墙厚，再用相邻偏移线交点修正转角，避免逐段偏移造成端点不闭合。
   * @param innerOutline - 墙内侧闭合轮廓节点，首尾不重复
   * @param thickness - 墙体厚度
   * @returns 与输入边一一对应的中心线集合；轮廓无效时返回空数组
   */
  public static convertClosedInnerOutlineToCenterLines(innerOutline: Point2D[], thickness: number): WallCenterLine[] {
    const centerOutline: Point2D[] = WallPlacementLineConverter.offsetClosedOutlineByThickness(
      innerOutline,
      thickness,
      'outward'
    );
    return WallPlacementLineConverter.createCenterLinesFromOutline(centerOutline);
  }

  /**
   * 将墙中心线闭合轮廓还原为室内净轮廓。
   * 关键流程：中心线按每段墙厚向房间内侧偏移半墙厚，并通过相邻偏移线交点得到准确室内角点。
   * @param centerOutline - 墙中心线闭合轮廓节点，首尾不重复
   * @param thicknesses - 与每条边对应的墙厚数组
   * @returns 室内净轮廓；轮廓无效时返回输入副本
   */
  public static convertCenterOutlineToInnerBoundary(centerOutline: Point2D[], thicknesses: number[]): Point2D[] {
    return WallPlacementLineConverter.offsetClosedOutlineByThicknesses(centerOutline, thicknesses, 'inward');
  }

  /**
   * 将闭合节点轮廓转换为边集合。
   * @param outline - 闭合轮廓节点，首尾不重复
   * @returns 顺序中心线集合
   */
  private static createCenterLinesFromOutline(outline: Point2D[]): WallCenterLine[] {
    const centerLines: WallCenterLine[] = [];
    const count: number = outline.length;
    if (count < 2) {
      return centerLines;
    }

    for (let index: number = 0; index < count; index += 1) {
      const start: Point2D = outline[index]!;
      const end: Point2D = outline[(index + 1) % count]!;
      centerLines.push({
        start: { x: start.x, z: start.z },
        end: { x: end.x, z: end.z },
      });
    }

    return centerLines;
  }

  /**
   * 使用统一墙厚偏移闭合轮廓。
   * @param outline - 需要偏移的闭合轮廓
   * @param thickness - 每条边使用的墙厚
   * @param side - 偏移方向，outward 表示墙外侧，inward 表示室内侧
   * @returns 偏移后的闭合轮廓节点
   */
  private static offsetClosedOutlineByThickness(
    outline: Point2D[],
    thickness: number,
    side: 'outward' | 'inward'
  ): Point2D[] {
    const thicknesses: number[] = new Array<number>(outline.length);
    for (let index: number = 0; index < outline.length; index += 1) {
      thicknesses[index] = thickness;
    }
    return WallPlacementLineConverter.offsetClosedOutlineByThicknesses(outline, thicknesses, side);
  }

  /**
   * 按每段墙厚偏移闭合轮廓。
   * 关键流程：根据有符号面积识别绕行方向，计算目标侧法线，最后求相邻偏移线交点保证转角连续。
   * @param outline - 需要偏移的闭合轮廓
   * @param thicknesses - 与轮廓边一一对应的墙厚数组
   * @param side - 偏移方向，outward 表示墙外侧，inward 表示室内侧
   * @returns 偏移后的闭合轮廓节点
   */
  private static offsetClosedOutlineByThicknesses(
    outline: Point2D[],
    thicknesses: number[],
    side: 'outward' | 'inward'
  ): Point2D[] {
    const count: number = outline.length;
    if (count < 3) {
      return outline.map((point: Point2D): Point2D => ({ x: point.x, z: point.z }));
    }

    const signedArea: number = WallPlacementLineConverter.computeSignedArea(outline);
    const outwardSign: number = signedArea < 0 ? 1 : -1;
    const targetSign: number = side === 'outward' ? outwardSign : -outwardSign;
    const offsetLines: OffsetLineSegment[] = [];

    for (let index: number = 0; index < count; index += 1) {
      const start: Point2D = outline[index]!;
      const end: Point2D = outline[(index + 1) % count]!;
      const edgeLine: OffsetLineSegment = WallPlacementLineConverter.createOffsetLineSegment(
        start,
        end,
        thicknesses[index] ?? thicknesses[0] ?? 0,
        targetSign
      );
      offsetLines.push(edgeLine);
    }

    const offsetOutline: Point2D[] = [];
    for (let index: number = 0; index < count; index += 1) {
      /* 相邻偏移线求交：前一条边与当前边的交点对应当前节点，保证墙角连续闭合。 */
      const previousLine: OffsetLineSegment = offsetLines[(index + count - 1) % count]!;
      const currentLine: OffsetLineSegment = offsetLines[index]!;
      offsetOutline.push(WallPlacementLineConverter.intersectOffsetLines(previousLine, currentLine));
    }

    return offsetOutline;
  }

  /**
   * 计算闭合轮廓有符号面积。
   * @param outline - 闭合轮廓节点，首尾不重复
   * @returns Shoelace 有符号面积的两倍
   */
  private static computeSignedArea(outline: Point2D[]): number {
    let signedArea: number = 0;
    const count: number = outline.length;
    for (let index: number = 0; index < count; index += 1) {
      const current: Point2D = outline[index]!;
      const next: Point2D = outline[(index + 1) % count]!;
      signedArea += current.x * next.z - next.x * current.z;
    }
    return signedArea;
  }

  /**
   * 创建单条偏移线。
   * @param start - 原始边起点
   * @param end - 原始边终点
   * @param thickness - 当前边墙厚
   * @param normalSign - 目标侧法线符号，1 为左法线，-1 为右法线
   * @returns 偏移线段数据
   */
  private static createOffsetLineSegment(
    start: Point2D,
    end: Point2D,
    thickness: number,
    normalSign: number
  ): OffsetLineSegment {
    const dx: number = end.x - start.x;
    const dz: number = end.z - start.z;
    const length: number = Math.sqrt(dx * dx + dz * dz);

    if (length <= WallPlacementLineConverter.EPSILON) {
      /* 退化边无法稳定求法线，保留原位置并交由上层轮廓有效性处理。 */
      return {
        p0x: start.x,
        p0z: start.z,
        p1x: end.x,
        p1z: end.z,
        dirX: 1,
        dirZ: 0,
      };
    }

    const dirX: number = dx / length;
    const dirZ: number = dz / length;
    const offsetDistance: number = thickness / 2;
    const normalX: number = -dirZ * normalSign;
    const normalZ: number = dirX * normalSign;

    return {
      p0x: start.x + normalX * offsetDistance,
      p0z: start.z + normalZ * offsetDistance,
      p1x: end.x + normalX * offsetDistance,
      p1z: end.z + normalZ * offsetDistance,
      dirX: dirX,
      dirZ: dirZ,
    };
  }

  /**
   * 计算两条偏移线的交点。
   * @param previousLine - 前一条偏移线
   * @param currentLine - 当前偏移线
   * @returns 两线交点；平行时返回当前偏移线起点作为稳定兜底
   */
  private static intersectOffsetLines(previousLine: OffsetLineSegment, currentLine: OffsetLineSegment): Point2D {
    const dAx: number = previousLine.dirX;
    const dAz: number = previousLine.dirZ;
    const dBx: number = currentLine.dirX;
    const dBz: number = currentLine.dirZ;
    const denominator: number = dAx * dBz - dAz * dBx;

    if (Math.abs(denominator) <= WallPlacementLineConverter.EPSILON) {
      /* 两线平行或近似平行时使用当前线起点，避免除零造成 NaN。 */
      return { x: currentLine.p0x, z: currentLine.p0z };
    }

    const diffX: number = currentLine.p0x - previousLine.p0x;
    const diffZ: number = currentLine.p0z - previousLine.p0z;
    const t: number = (diffX * dBz - diffZ * dBx) / denominator;

    return {
      x: previousLine.p0x + t * dAx,
      z: previousLine.p0z + t * dAz,
    };
  }
}