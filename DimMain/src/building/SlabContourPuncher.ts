/**
 * 楼板轮廓冲孔/裁剪服务
 * 负责在房间内创建子空间时，根据父楼板与子空间轮廓的空间关系生成内洞或裁剪后的剩余轮廓。
 */

import type { Point2D } from './BuildingTypes';

/** 楼板轮廓冲计算类型。 */
export type SlabPunchRelation = 'none' | 'contained' | 'partial';

/** 楼板轮廓冲计算结果。 */
export interface SlabPunchResult {
  /** 父楼板与子空间的空间关系。 */
  relation: SlabPunchRelation;
  /** 子空间完全包含时可直接追加到父楼板的内轮廓。 */
  innerOutline: Point2D[] | null;
  /** 部分相交时父楼板扣除相交区域后剩余的外轮廓集合。 */
  remainingOutlines: Point2D[][];
}

/** 半平面裁剪结果。 */
interface HalfPlaneSplitResult {
  /** 位于半平面内侧的多边形。 */
  insidePolygon: Point2D[];
  /** 位于半平面外侧的多边形。 */
  outsidePolygon: Point2D[];
}

/** 线段交点结果。 */
interface SegmentIntersectionResult {
  /** 是否存在有效交点。 */
  intersects: boolean;
  /** 交点坐标；无交点时为 null。 */
  point: Point2D | null;
}

/**
 * 楼板轮廓冲孔器。
 * 约束：部分相交裁剪按凸子空间轮廓处理；当前自动生成的矩形/常规房间满足该约束。
 */
export class SlabContourPuncher {
  private static readonly EPSILON: number = 1e-6;

  /**
   * 计算父楼板扣除子空间轮廓后的冲孔/裁剪结果。
   * @param parentOutline - 父楼板外轮廓，XZ 平面点集。
   * @param childOutline - 子空间净轮廓，XZ 平面点集。
   * @returns 完全包含时返回内洞；部分相交时返回剩余外轮廓；无相交时 relation 为 none。
   */
  public static punch(parentOutline: Point2D[], childOutline: Point2D[]): SlabPunchResult {
    if (parentOutline.length < 3 || childOutline.length < 3) {
      return SlabContourPuncher._createNoneResult();
    }

    const normalizedParentOutline: Point2D[] = SlabContourPuncher._removeDuplicateClosingPoint(parentOutline);
    const normalizedChildOutline: Point2D[] = SlabContourPuncher._removeDuplicateClosingPoint(childOutline);
    if (normalizedParentOutline.length < 3 || normalizedChildOutline.length < 3) {
      return SlabContourPuncher._createNoneResult();
    }

    const childInsideParent: boolean = SlabContourPuncher._isOutlineContained(
      normalizedChildOutline,
      normalizedParentOutline
    );
    if (childInsideParent) {
      return {
        relation: 'contained',
        innerOutline: SlabContourPuncher._cloneOutline(normalizedChildOutline),
        remainingOutlines: [SlabContourPuncher._cloneOutline(normalizedParentOutline)],
      };
    }

    const parentInsideChild: boolean = SlabContourPuncher._isOutlineContained(
      normalizedParentOutline,
      normalizedChildOutline
    );
    const hasEdgeIntersection: boolean = SlabContourPuncher._hasOutlineEdgeIntersection(
      normalizedParentOutline,
      normalizedChildOutline
    );
    if (!parentInsideChild && !hasEdgeIntersection) {
      return SlabContourPuncher._createNoneResult();
    }

    const remainingOutlines: Point2D[][] = SlabContourPuncher.subtractConvexClip(
      normalizedParentOutline,
      normalizedChildOutline
    );

    return {
      relation: 'partial',
      innerOutline: null,
      remainingOutlines: remainingOutlines,
    };
  }

  /**
   * 从主体多边形中扣除凸裁剪多边形，返回剩余轮廓集合。
   * @param subjectOutline - 被裁剪的主体轮廓。
   * @param clipOutline - 需要扣除的凸多边形轮廓。
   * @returns 扣除后保留下来的轮廓集合。
   */
  public static subtractConvexClip(subjectOutline: Point2D[], clipOutline: Point2D[]): Point2D[][] {
    const normalizedSubjectOutline: Point2D[] = SlabContourPuncher._removeDuplicateClosingPoint(subjectOutline);
    const normalizedClipOutline: Point2D[] = SlabContourPuncher._removeDuplicateClosingPoint(clipOutline);
    if (normalizedSubjectOutline.length < 3 || normalizedClipOutline.length < 3) {
      return [];
    }

    const clipArea: number = SlabContourPuncher._signedArea(normalizedClipOutline);
    if (Math.abs(clipArea) < SlabContourPuncher.EPSILON) {
      return [SlabContourPuncher._cloneOutline(normalizedSubjectOutline)];
    }

    let candidatePolygons: Point2D[][] = [SlabContourPuncher._cloneOutline(normalizedSubjectOutline)];
    const outsidePolygons: Point2D[][] = [];
    const clipIsCounterClockwise: boolean = clipArea > 0;

    /* 关键流程：逐条使用裁剪多边形边界半平面切分主体，外侧片段立即保留，内侧片段继续与下一条边求交。 */
    for (let clipIndex: number = 0; clipIndex < normalizedClipOutline.length; clipIndex += 1) {
      const edgeStart: Point2D = normalizedClipOutline[clipIndex]!;
      const edgeEnd: Point2D = normalizedClipOutline[(clipIndex + 1) % normalizedClipOutline.length]!;
      const nextCandidatePolygons: Point2D[][] = [];

      for (const candidatePolygon of candidatePolygons) {
        const splitResult: HalfPlaneSplitResult = SlabContourPuncher._splitByHalfPlane(
          candidatePolygon,
          edgeStart,
          edgeEnd,
          clipIsCounterClockwise
        );
        const outsidePolygon: Point2D[] = SlabContourPuncher._cleanOutline(splitResult.outsidePolygon);
        if (outsidePolygon.length >= 3) {
          outsidePolygons.push(outsidePolygon);
        }

        const insidePolygon: Point2D[] = SlabContourPuncher._cleanOutline(splitResult.insidePolygon);
        if (insidePolygon.length >= 3) {
          nextCandidatePolygons.push(insidePolygon);
        }
      }

      candidatePolygons = nextCandidatePolygons;
      if (candidatePolygons.length === 0) {
        break;
      }
    }

    return SlabContourPuncher._filterUsableOutlines(outsidePolygons);
  }

  /**
   * 判断轮廓是否完全包含在容器轮廓内。
   * @param outline - 待检查轮廓。
   * @param containerOutline - 容器轮廓。
   * @returns 全部顶点位于容器内且边界无穿越时返回 true。
   */
  public static isOutlineContained(outline: Point2D[], containerOutline: Point2D[]): boolean {
    return SlabContourPuncher._isOutlineContained(outline, containerOutline);
  }

  private static _createNoneResult(): SlabPunchResult {
    return {
      relation: 'none',
      innerOutline: null,
      remainingOutlines: [],
    };
  }

  private static _isOutlineContained(outline: Point2D[], containerOutline: Point2D[]): boolean {
    for (const point of outline) {
      if (!SlabContourPuncher._isPointInPolygonOrOnEdge(point, containerOutline)) {
        return false;
      }
    }

    return !SlabContourPuncher._hasOutlineEdgeIntersection(outline, containerOutline);
  }

  private static _splitByHalfPlane(
    polygon: Point2D[],
    edgeStart: Point2D,
    edgeEnd: Point2D,
    insideIsLeft: boolean
  ): HalfPlaneSplitResult {
    const insidePolygon: Point2D[] = [];
    const outsidePolygon: Point2D[] = [];
    if (polygon.length === 0) {
      return { insidePolygon: insidePolygon, outsidePolygon: outsidePolygon };
    }

    for (let index: number = 0; index < polygon.length; index += 1) {
      const currentPoint: Point2D = polygon[index]!;
      const nextPoint: Point2D = polygon[(index + 1) % polygon.length]!;
      const currentInside: boolean = SlabContourPuncher._isInsideHalfPlane(
        currentPoint,
        edgeStart,
        edgeEnd,
        insideIsLeft
      );
      const nextInside: boolean = SlabContourPuncher._isInsideHalfPlane(
        nextPoint,
        edgeStart,
        edgeEnd,
        insideIsLeft
      );

      if (currentInside) {
        insidePolygon.push({ x: currentPoint.x, z: currentPoint.z });
      } else {
        outsidePolygon.push({ x: currentPoint.x, z: currentPoint.z });
      }

      /* 条件分支：边跨越半平面边界时，同一个交点同时加入内外两侧，保证切分后的轮廓闭合。 */
      if (currentInside !== nextInside) {
        const intersectionPoint: Point2D | null = SlabContourPuncher._lineIntersection(
          currentPoint,
          nextPoint,
          edgeStart,
          edgeEnd
        );
        if (intersectionPoint !== null) {
          insidePolygon.push(intersectionPoint);
          outsidePolygon.push({ x: intersectionPoint.x, z: intersectionPoint.z });
        }
      }
    }

    return {
      insidePolygon: insidePolygon,
      outsidePolygon: outsidePolygon,
    };
  }

  private static _isInsideHalfPlane(
    point: Point2D,
    edgeStart: Point2D,
    edgeEnd: Point2D,
    insideIsLeft: boolean
  ): boolean {
    const crossValue: number = SlabContourPuncher._cross(edgeStart, edgeEnd, point);
    return insideIsLeft
      ? crossValue >= -SlabContourPuncher.EPSILON
      : crossValue <= SlabContourPuncher.EPSILON;
  }

  private static _hasOutlineEdgeIntersection(firstOutline: Point2D[], secondOutline: Point2D[]): boolean {
    for (let firstIndex: number = 0; firstIndex < firstOutline.length; firstIndex += 1) {
      const firstStart: Point2D = firstOutline[firstIndex]!;
      const firstEnd: Point2D = firstOutline[(firstIndex + 1) % firstOutline.length]!;
      for (let secondIndex: number = 0; secondIndex < secondOutline.length; secondIndex += 1) {
        const secondStart: Point2D = secondOutline[secondIndex]!;
        const secondEnd: Point2D = secondOutline[(secondIndex + 1) % secondOutline.length]!;
        const intersectionResult: SegmentIntersectionResult = SlabContourPuncher._segmentIntersection(
          firstStart,
          firstEnd,
          secondStart,
          secondEnd
        );
        if (intersectionResult.intersects && intersectionResult.point !== null) {
          return true;
        }
      }
    }
    return false;
  }

  private static _segmentIntersection(
    firstStart: Point2D,
    firstEnd: Point2D,
    secondStart: Point2D,
    secondEnd: Point2D
  ): SegmentIntersectionResult {
    const firstDirectionX: number = firstEnd.x - firstStart.x;
    const firstDirectionZ: number = firstEnd.z - firstStart.z;
    const secondDirectionX: number = secondEnd.x - secondStart.x;
    const secondDirectionZ: number = secondEnd.z - secondStart.z;
    const denominator: number = firstDirectionX * secondDirectionZ - firstDirectionZ * secondDirectionX;

    if (Math.abs(denominator) < SlabContourPuncher.EPSILON) {
      return { intersects: false, point: null };
    }

    const deltaX: number = secondStart.x - firstStart.x;
    const deltaZ: number = secondStart.z - firstStart.z;
    const firstRatio: number = (deltaX * secondDirectionZ - deltaZ * secondDirectionX) / denominator;
    const secondRatio: number = (deltaX * firstDirectionZ - deltaZ * firstDirectionX) / denominator;
    const ratioInsideFirst: boolean = firstRatio > SlabContourPuncher.EPSILON && firstRatio < 1 - SlabContourPuncher.EPSILON;
    const ratioInsideSecond: boolean = secondRatio > SlabContourPuncher.EPSILON && secondRatio < 1 - SlabContourPuncher.EPSILON;

    if (!ratioInsideFirst || !ratioInsideSecond) {
      return { intersects: false, point: null };
    }

    return {
      intersects: true,
      point: {
        x: firstStart.x + firstRatio * firstDirectionX,
        z: firstStart.z + firstRatio * firstDirectionZ,
      },
    };
  }

  private static _lineIntersection(
    firstStart: Point2D,
    firstEnd: Point2D,
    secondStart: Point2D,
    secondEnd: Point2D
  ): Point2D | null {
    const firstDirectionX: number = firstEnd.x - firstStart.x;
    const firstDirectionZ: number = firstEnd.z - firstStart.z;
    const secondDirectionX: number = secondEnd.x - secondStart.x;
    const secondDirectionZ: number = secondEnd.z - secondStart.z;
    const denominator: number = firstDirectionX * secondDirectionZ - firstDirectionZ * secondDirectionX;
    if (Math.abs(denominator) < SlabContourPuncher.EPSILON) {
      return null;
    }

    const deltaX: number = secondStart.x - firstStart.x;
    const deltaZ: number = secondStart.z - firstStart.z;
    const ratio: number = (deltaX * secondDirectionZ - deltaZ * secondDirectionX) / denominator;
    return {
      x: firstStart.x + ratio * firstDirectionX,
      z: firstStart.z + ratio * firstDirectionZ,
    };
  }

  private static _isPointInPolygonOrOnEdge(point: Point2D, polygon: Point2D[]): boolean {
    let inside: boolean = false;
    for (let index: number = 0, previousIndex: number = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
      const currentPoint: Point2D = polygon[index]!;
      const previousPoint: Point2D = polygon[previousIndex]!;
      if (SlabContourPuncher._isPointOnSegment(point, previousPoint, currentPoint)) {
        return true;
      }

      const intersectsRay: boolean = (currentPoint.z > point.z) !== (previousPoint.z > point.z)
        && point.x < (previousPoint.x - currentPoint.x) * (point.z - currentPoint.z)
          / (previousPoint.z - currentPoint.z) + currentPoint.x;
      if (intersectsRay) {
        inside = !inside;
      }
    }
    return inside;
  }

  private static _isPointOnSegment(point: Point2D, segmentStart: Point2D, segmentEnd: Point2D): boolean {
    const crossValue: number = Math.abs(SlabContourPuncher._cross(segmentStart, segmentEnd, point));
    if (crossValue > SlabContourPuncher.EPSILON) {
      return false;
    }

    const minX: number = Math.min(segmentStart.x, segmentEnd.x) - SlabContourPuncher.EPSILON;
    const maxX: number = Math.max(segmentStart.x, segmentEnd.x) + SlabContourPuncher.EPSILON;
    const minZ: number = Math.min(segmentStart.z, segmentEnd.z) - SlabContourPuncher.EPSILON;
    const maxZ: number = Math.max(segmentStart.z, segmentEnd.z) + SlabContourPuncher.EPSILON;
    return point.x >= minX && point.x <= maxX && point.z >= minZ && point.z <= maxZ;
  }

  private static _cross(origin: Point2D, target: Point2D, point: Point2D): number {
    return (target.x - origin.x) * (point.z - origin.z) - (target.z - origin.z) * (point.x - origin.x);
  }

  private static _signedArea(outline: Point2D[]): number {
    let doubleArea: number = 0;
    for (let index: number = 0; index < outline.length; index += 1) {
      const currentPoint: Point2D = outline[index]!;
      const nextPoint: Point2D = outline[(index + 1) % outline.length]!;
      doubleArea += currentPoint.x * nextPoint.z - nextPoint.x * currentPoint.z;
    }
    return doubleArea / 2;
  }

  private static _removeDuplicateClosingPoint(outline: Point2D[]): Point2D[] {
    const resultOutline: Point2D[] = SlabContourPuncher._cloneOutline(outline);
    if (resultOutline.length < 2) {
      return resultOutline;
    }

    const firstPoint: Point2D = resultOutline[0]!;
    const lastPoint: Point2D = resultOutline[resultOutline.length - 1]!;
    if (SlabContourPuncher._arePointsClose(firstPoint, lastPoint)) {
      resultOutline.pop();
    }
    return resultOutline;
  }

  private static _cleanOutline(outline: Point2D[]): Point2D[] {
    const cleanedOutline: Point2D[] = [];
    for (const point of outline) {
      const previousPoint: Point2D | undefined = cleanedOutline[cleanedOutline.length - 1];
      if (previousPoint !== undefined && SlabContourPuncher._arePointsClose(previousPoint, point)) {
        continue;
      }
      cleanedOutline.push({ x: point.x, z: point.z });
    }

    if (cleanedOutline.length > 1) {
      const firstPoint: Point2D = cleanedOutline[0]!;
      const lastPoint: Point2D = cleanedOutline[cleanedOutline.length - 1]!;
      if (SlabContourPuncher._arePointsClose(firstPoint, lastPoint)) {
        cleanedOutline.pop();
      }
    }

    return Math.abs(SlabContourPuncher._signedArea(cleanedOutline)) > SlabContourPuncher.EPSILON
      ? cleanedOutline
      : [];
  }

  private static _filterUsableOutlines(outlines: Point2D[][]): Point2D[][] {
    const usableOutlines: Point2D[][] = [];
    for (const outline of outlines) {
      const cleanedOutline: Point2D[] = SlabContourPuncher._cleanOutline(outline);
      if (cleanedOutline.length >= 3) {
        usableOutlines.push(cleanedOutline);
      }
    }
    return usableOutlines;
  }

  private static _cloneOutline(outline: Point2D[]): Point2D[] {
    return outline.map((point: Point2D): Point2D => ({ x: point.x, z: point.z }));
  }

  private static _arePointsClose(firstPoint: Point2D, secondPoint: Point2D): boolean {
    return Math.abs(firstPoint.x - secondPoint.x) <= SlabContourPuncher.EPSILON
      && Math.abs(firstPoint.z - secondPoint.z) <= SlabContourPuncher.EPSILON;
  }
}