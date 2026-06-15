/**
 * 墙体闭合环边界构建器
 * 负责把包含直墙与弧墙的墙体中心线闭合环转换为楼板/天花板可用的室内净边界。
 */

import type { ArcWallData, BuildingObject, Point2D, WallData } from './BuildingTypes';
import { WALL_DEFAULTS } from './BuildingTypes';
import { WallPlacementLineConverter } from './WallPlacementLineConverter';

/** 墙体数据查询回调。 */
export type WallLoopWallResolver = (wallId: string) => BuildingObject | undefined;

/** 闭合环密集中心线结果。 */
interface DensifiedCenterLoop {
  /** 含弧墙采样点的中心线闭合轮廓，首尾不重复。 */
  outline: Point2D[];
  /** 与 outline 每条边一一对应的墙厚数组。 */
  thicknesses: number[];
}

/**
 * 墙体闭合环边界构建器。
 * 关键约定：楼板边界仍保存为 Point2D[]，弧形边界通过对弧墙路径线采样为多段点实现。
 */
export class WallLoopBoundaryBuilder {
  /** 坐标匹配容差。 */
  private static readonly POINT_EPSILON: number = 0.001;

  /** bulge 退化容差。 */
  private static readonly BULGE_EPSILON: number = 0.000001;

  /** 弧墙最少采样段数，避免小段弧线表现为折线过粗。 */
  private static readonly MIN_ARC_SEGMENTS: number = 8;

  /** 弧墙最多采样段数，避免极端数据生成过多楼板顶点。 */
  private static readonly MAX_ARC_SEGMENTS: number = 96;

  /**
   * 将墙中心线闭合环转换为室内净边界。
   * 关键流程：先把弧墙中心路径线按 loop 方向采样并展开为密集中心线，再按墙厚统一偏移为室内净边界。
   * @param centerOutline - 连接拓扑返回的墙中心线闭合节点，首尾不重复
   * @param wallIds - 与中心线边一一对应的墙体 ID
   * @param resolveWall - 根据墙体 ID 查询墙体数据的回调
   * @returns 支持弧形边界的室内净轮廓点数组
   */
  public static buildInnerBoundary(
    centerOutline: Point2D[],
    wallIds: string[],
    resolveWall: WallLoopWallResolver
  ): Point2D[] {
    const densifiedLoop: DensifiedCenterLoop = WallLoopBoundaryBuilder.buildDensifiedCenterLoop(
      centerOutline,
      wallIds,
      resolveWall
    );

    if (densifiedLoop.outline.length < 3 || densifiedLoop.thicknesses.length < 3) {
      /* 退化闭合环无法稳定偏移时，回退到原有直线轮廓转换逻辑。 */
      const fallbackThicknesses: number[] = WallLoopBoundaryBuilder.collectFallbackThicknesses(wallIds, resolveWall);
      return WallPlacementLineConverter.convertCenterOutlineToInnerBoundary(centerOutline, fallbackThicknesses);
    }

    return WallPlacementLineConverter.convertCenterOutlineToInnerBoundary(
      densifiedLoop.outline,
      densifiedLoop.thicknesses
    );
  }

  /**
   * 构建包含弧墙采样点的密集中心线闭合环。
   * @param centerOutline - 原始中心线闭合节点
   * @param wallIds - 与原始中心线边一一对应的墙体 ID
   * @param resolveWall - 墙体查询回调
   * @returns 密集中心线轮廓与逐边墙厚
   */
  private static buildDensifiedCenterLoop(
    centerOutline: Point2D[],
    wallIds: string[],
    resolveWall: WallLoopWallResolver
  ): DensifiedCenterLoop {
    const denseOutline: Point2D[] = [];
    const denseThicknesses: number[] = [];
    const edgeCount: number = Math.min(centerOutline.length, wallIds.length);

    for (let edgeIndex: number = 0; edgeIndex < edgeCount; edgeIndex += 1) {
      const loopStart: Point2D = centerOutline[edgeIndex]!;
      const loopEnd: Point2D = centerOutline[(edgeIndex + 1) % centerOutline.length]!;
      const wallObject: BuildingObject | undefined = resolveWall(wallIds[edgeIndex]!);
      const wallData: WallData | null = WallLoopBoundaryBuilder.getWallData(wallObject);
      const thickness: number = wallData !== null ? wallData.thickness : WALL_DEFAULTS.thickness;

      if (wallData !== null && wallData.subType === 'arc') {
        /* 弧墙边：按闭合环方向采样中心弧线，楼板边界将随采样点形成弧形。 */
        const arcPoints: Point2D[] = WallLoopBoundaryBuilder.createLoopOrderedArcPoints(
          wallData,
          loopStart,
          loopEnd
        );
        WallLoopBoundaryBuilder.appendPolylineEdges(denseOutline, denseThicknesses, arcPoints, thickness);
        continue;
      }

      /* 非弧墙边：按原始中心线边追加，保持直墙楼板行为不变。 */
      const straightPoints: Point2D[] = [loopStart, loopEnd];
      WallLoopBoundaryBuilder.appendPolylineEdges(denseOutline, denseThicknesses, straightPoints, thickness);
    }

    WallLoopBoundaryBuilder.removeClosingDuplicatePoint(denseOutline);
    return {
      outline: denseOutline,
      thicknesses: denseThicknesses,
    };
  }

  /**
   * 获取有效墙体数据。
   * @param wallObject - 建筑对象
   * @returns 墙体数据；对象不存在或不是墙体时返回 null
   */
  private static getWallData(wallObject: BuildingObject | undefined): WallData | null {
    if (wallObject === undefined || wallObject.category !== 'wall') {
      return null;
    }
    return wallObject as WallData;
  }

  /**
   * 创建与闭合环边方向一致的弧墙中心线采样点。
   * @param arcData - 弧形墙数据
   * @param loopStart - 当前闭合环边起点
   * @param loopEnd - 当前闭合环边终点
   * @returns 与 loopStart 到 loopEnd 方向一致的弧线点；端点不匹配时返回直连兜底点
   */
  private static createLoopOrderedArcPoints(arcData: ArcWallData, loopStart: Point2D, loopEnd: Point2D): Point2D[] {
    const segmentCount: number = WallLoopBoundaryBuilder.getArcSegmentCount(arcData);
    const arcPoints: Point2D[] = WallLoopBoundaryBuilder.computeArcCenterPoints(
      arcData.start,
      arcData.end,
      arcData.bulge,
      segmentCount
    );

    if (arcPoints.length < 2) {
      return [loopStart, loopEnd];
    }

    const matchesForward: boolean =
      WallLoopBoundaryBuilder.arePointsClose(arcData.start, loopStart) &&
      WallLoopBoundaryBuilder.arePointsClose(arcData.end, loopEnd);
    const matchesBackward: boolean =
      WallLoopBoundaryBuilder.arePointsClose(arcData.end, loopStart) &&
      WallLoopBoundaryBuilder.arePointsClose(arcData.start, loopEnd);

    if (matchesForward) {
      return arcPoints;
    }

    if (matchesBackward) {
      const reversedPoints: Point2D[] = [...arcPoints].reverse();
      return reversedPoints;
    }

    /* 连接拓扑端点与墙数据存在微小不一致时，使用拓扑边兜底，避免生成跨越错误方向的楼板边。 */
    return [loopStart, loopEnd];
  }

  /**
   * 获取弧墙采样段数。
   * @param arcData - 弧形墙数据
   * @returns 受上下限保护的采样段数
   */
  private static getArcSegmentCount(arcData: ArcWallData): number {
    const requestedSegments: number = Math.max(arcData.segments, WallLoopBoundaryBuilder.MIN_ARC_SEGMENTS);
    return Math.min(requestedSegments, WallLoopBoundaryBuilder.MAX_ARC_SEGMENTS);
  }

  /**
   * 依据 bulge 参数采样弧形墙中心路径线。
   * @param start - 弧线起点
   * @param end - 弧线终点
   * @param bulge - 弧度因子，tan(圆心角 / 4)
   * @param segments - 采样段数
   * @returns 中心路径线采样点
   */
  private static computeArcCenterPoints(start: Point2D, end: Point2D, bulge: number, segments: number): Point2D[] {
    const points: Point2D[] = [];

    if (Math.abs(bulge) < WallLoopBoundaryBuilder.BULGE_EPSILON) {
      /* bulge 接近 0 时按直线均分，避免圆心计算数值不稳定。 */
      for (let pointIndex: number = 0; pointIndex <= segments; pointIndex += 1) {
        const t: number = pointIndex / segments;
        points.push({
          x: start.x + (end.x - start.x) * t,
          z: start.z + (end.z - start.z) * t,
        });
      }
      return points;
    }

    const chordX: number = end.x - start.x;
    const chordZ: number = end.z - start.z;
    const chordLength: number = Math.sqrt(chordX * chordX + chordZ * chordZ);
    if (chordLength < WallLoopBoundaryBuilder.POINT_EPSILON) {
      return [start];
    }

    const sagitta: number = (bulge * chordLength) / 2;
    const radius: number = (chordLength * chordLength / 4 + sagitta * sagitta) / (2 * Math.abs(sagitta));
    const midX: number = (start.x + end.x) / 2;
    const midZ: number = (start.z + end.z) / 2;
    const perpX: number = -chordZ / chordLength;
    const perpZ: number = chordX / chordLength;
    const centerOffset: number = radius - Math.abs(sagitta);
    const centerSign: number = bulge > 0 ? 1 : -1;
    const centerX: number = midX + perpX * centerOffset * centerSign;
    const centerZ: number = midZ + perpZ * centerOffset * centerSign;
    const startAngle: number = Math.atan2(start.z - centerZ, start.x - centerX);
    const endAngle: number = Math.atan2(end.z - centerZ, end.x - centerX);

    let deltaAngle: number = endAngle - startAngle;
    if (bulge > 0 && deltaAngle < 0) {
      deltaAngle += Math.PI * 2;
    } else if (bulge < 0 && deltaAngle > 0) {
      deltaAngle -= Math.PI * 2;
    }

    for (let pointIndex: number = 0; pointIndex <= segments; pointIndex += 1) {
      const t: number = pointIndex / segments;
      const angle: number = startAngle + deltaAngle * t;
      points.push({
        x: centerX + Math.cos(angle) * radius,
        z: centerZ + Math.sin(angle) * radius,
      });
    }

    return points;
  }

  /**
   * 把折线转换为密集闭合轮廓边。
   * @param denseOutline - 待写入的密集轮廓点
   * @param denseThicknesses - 待写入的逐边墙厚
   * @param points - 当前墙段折线点
   * @param thickness - 当前墙段墙厚
   */
  private static appendPolylineEdges(
    denseOutline: Point2D[],
    denseThicknesses: number[],
    points: Point2D[],
    thickness: number
  ): void {
    for (let pointIndex: number = 0; pointIndex < points.length - 1; pointIndex += 1) {
      const start: Point2D = points[pointIndex]!;
      const end: Point2D = points[pointIndex + 1]!;
      if (WallLoopBoundaryBuilder.arePointsClose(start, end)) {
        /* 零长度采样边会导致偏移线不稳定，直接跳过。 */
        continue;
      }

      if (denseOutline.length === 0) {
        denseOutline.push({ x: start.x, z: start.z });
      } else {
        const lastPoint: Point2D = denseOutline[denseOutline.length - 1]!;
        if (!WallLoopBoundaryBuilder.arePointsClose(lastPoint, start)) {
          denseOutline.push({ x: start.x, z: start.z });
        }
      }

      denseThicknesses.push(thickness);
      denseOutline.push({ x: end.x, z: end.z });
    }
  }

  /**
   * 移除闭合轮廓末尾与首点重复的节点。
   * @param denseOutline - 密集轮廓点数组
   */
  private static removeClosingDuplicatePoint(denseOutline: Point2D[]): void {
    if (denseOutline.length < 2) {
      return;
    }

    const firstPoint: Point2D = denseOutline[0]!;
    const lastPoint: Point2D = denseOutline[denseOutline.length - 1]!;
    if (WallLoopBoundaryBuilder.arePointsClose(firstPoint, lastPoint)) {
      denseOutline.pop();
    }
  }

  /**
   * 收集原始闭合环墙厚，用于退化情况下复用旧转换逻辑。
   * @param wallIds - 墙体 ID 列表
   * @param resolveWall - 墙体查询回调
   * @returns 与墙体 ID 顺序一致的墙厚数组
   */
  private static collectFallbackThicknesses(wallIds: string[], resolveWall: WallLoopWallResolver): number[] {
    const thicknesses: number[] = [];
    for (const wallId of wallIds) {
      const wallObject: BuildingObject | undefined = resolveWall(wallId);
      const wallData: WallData | null = WallLoopBoundaryBuilder.getWallData(wallObject);
      const thickness: number = wallData !== null ? wallData.thickness : WALL_DEFAULTS.thickness;
      thicknesses.push(thickness);
    }
    return thicknesses;
  }

  /**
   * 判断两个 XZ 平面点是否近似相同。
   * @param a - 第一个点
   * @param b - 第二个点
   * @returns 点间距离小于容差时返回 true
   */
  private static arePointsClose(a: Point2D, b: Point2D): boolean {
    const dx: number = a.x - b.x;
    const dz: number = a.z - b.z;
    return dx * dx + dz * dz <= WallLoopBoundaryBuilder.POINT_EPSILON * WallLoopBoundaryBuilder.POINT_EPSILON;
  }
}