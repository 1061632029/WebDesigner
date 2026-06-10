/**
 * 建筑衔接线检测器
 * 从楼板/天花板轮廓与墙体连接点中提取需要显示的轮廓衔接线段
 */

import type { BuildingObject, CeilingData, Point2D, SlabData, StraightWallData } from './BuildingTypes';
import type { BuildingConnectionLineSegment, BuildingConnectionLineSourceType } from './BuildingConnectionLineTypes';

/**
 * 建筑衔接线检测器
 * 负责将建筑对象数据转换为可渲染的衔接线段数据，不直接依赖 Three.js
 */
export class BuildingConnectionLineDetector {
  /** 默认衔接线逻辑宽度：渲染层使用 LineSegments 时保持 1px 轮廓线视觉，此值仅保留给兼容数据结构 */
  private static readonly DEFAULT_LINE_WIDTH: number = 0.001;

  /** 退化线段长度阈值，低于该长度的轮廓边会被忽略 */
  private static readonly MIN_SEGMENT_LENGTH: number = 0.001;

  /** 楼板衔接线微抬高度，避免与楼板顶面发生 Z-fighting */
  private static readonly SLAB_Y_OFFSET: number = 0.012;

  /** 天花板衔接线微降高度，避免与天花板底面发生 Z-fighting */
  private static readonly CEILING_Y_OFFSET: number = -0.012;

  /** 墙面竖向衔接线外偏距离，避免与墙面发生 Z-fighting */
  private static readonly WALL_FACE_OFFSET: number = 0.006;

  /** 轮廓边与墙面匹配的距离容差，允许墙体斜接/浮点误差 */
  private static readonly WALL_FACE_MATCH_TOLERANCE: number = 0.08;

  /** 墙端点覆盖判断容差，允许轮廓边和墙中心线端点存在微小偏差 */
  private static readonly WALL_SPAN_MATCH_TOLERANCE: number = 0.12;

  /** 墙体端点视为同一连接点的距离容差 */
  private static readonly WALL_JOINT_MATCH_TOLERANCE: number = 0.08;

  /** 室内角点是否落在楼板/天花板轮廓范围内的容差 */
  private static readonly OUTLINE_CONTAINS_TOLERANCE: number = 0.02;

  /**
   * 从建筑对象集合中检测全部衔接线段
   * @param objects - 建筑对象数组快照
   * @returns 可交给渲染器创建 Mesh 的衔接线段数组
   */
  public detect(objects: BuildingObject[]): BuildingConnectionLineSegment[] {
    const segments: BuildingConnectionLineSegment[] = [];
    const straightWalls: StraightWallData[] = this._collectStraightWalls(objects);

    /* 遍历所有对象：楼板/天花板提取水平轮廓线，同时补充贴墙面竖向缝线。 */
    for (let index: number = 0; index < objects.length; index++) {
      const object: BuildingObject = objects[index]!;
      if (object.category === 'slab') {
        const slabData: SlabData = object as SlabData;
        const slabLineY: number = slabData.topOffset + BuildingConnectionLineDetector.SLAB_Y_OFFSET;
        this._appendOutlineSegments(
          segments,
          slabData.id,
          'slab',
          slabData.outline,
          slabLineY
        );
        this._appendWallFaceSegments(
          segments,
          slabData.id,
          'slab',
          slabData.outline,
          0,
          slabLineY,
          straightWalls
        );
        this._appendWallJointVerticalSegments(
          segments,
          slabData.id,
          'slab',
          slabData.outline,
          0,
          slabLineY,
          straightWalls
        );
      } else if (object.category === 'ceiling') {
        const ceilingData: CeilingData = object as CeilingData;
        const ceilingLineY: number = ceilingData.bottomOffset + BuildingConnectionLineDetector.CEILING_Y_OFFSET;
        this._appendOutlineSegments(
          segments,
          ceilingData.id,
          'ceiling',
          ceilingData.outline,
          ceilingLineY
        );
        this._appendWallFaceSegments(
          segments,
          ceilingData.id,
          'ceiling',
          ceilingData.outline,
          0,
          ceilingLineY,
          straightWalls
        );
        this._appendWallJointVerticalSegments(
          segments,
          ceilingData.id,
          'ceiling',
          ceilingData.outline,
          0,
          ceilingLineY,
          straightWalls
        );
      }
    }

    return segments;
  }

  /**
   * 将闭合轮廓拆分为衔接线段并追加到结果数组
   * @param target - 输出线段数组
   * @param sourceObjectId - 来源建筑对象 ID
   * @param sourceType - 来源类型
   * @param outline - XZ 平面闭合轮廓点（首尾不重复）
   * @param y - 衔接线所在世界高度
   */
  private _appendOutlineSegments(
    target: BuildingConnectionLineSegment[],
    sourceObjectId: string,
    sourceType: BuildingConnectionLineSourceType,
    outline: Point2D[],
    y: number
  ): void {
    if (outline.length < 2) {
      return;
    }

    /* 将相邻轮廓点连接为线段，最后一个点自动闭合到第一个点 */
    for (let index: number = 0; index < outline.length; index++) {
      const start: Point2D = outline[index]!;
      const end: Point2D = outline[(index + 1) % outline.length]!;
      const dx: number = end.x - start.x;
      const dz: number = end.z - start.z;
      const length: number = Math.sqrt(dx * dx + dz * dz);

      /* 过滤重复点或极短边，避免生成无效几何体 */
      if (length < BuildingConnectionLineDetector.MIN_SEGMENT_LENGTH) {
        continue;
      }

      target.push({
        id: `${sourceType}-${sourceObjectId}-connection-${index}`,
        sourceObjectId: sourceObjectId,
        sourceType: sourceType,
        start: { x: start.x, z: start.z },
        end: { x: end.x, z: end.z },
        y: y,
        width: BuildingConnectionLineDetector.DEFAULT_LINE_WIDTH,
        orientation: 'horizontal',
      });
    }
  }

  /**
   * 收集可参与衔接线检测的直墙数据。
   * @param objects - 建筑对象数组快照
   * @returns 直墙数据数组
   */
  private _collectStraightWalls(objects: BuildingObject[]): StraightWallData[] {
    const walls: StraightWallData[] = [];
    for (let index: number = 0; index < objects.length; index++) {
      const object: BuildingObject = objects[index]!;
      if (object.category === 'wall' && object.subType === 'straight') {
        walls.push(object as StraightWallData);
      }
    }
    return walls;
  }

  /**
   * 根据楼板/天花板轮廓边和直墙面匹配关系生成贴墙竖向缝线。
   * @param target - 输出线段数组
   * @param sourceObjectId - 来源建筑对象 ID
   * @param sourceType - 来源类型
   * @param outline - XZ 平面闭合轮廓点
   * @param startY - 竖向线起始高度
   * @param endY - 竖向线结束高度
   * @param walls - 当前场景内直墙数据
   */
  private _appendWallFaceSegments(
    target: BuildingConnectionLineSegment[],
    sourceObjectId: string,
    sourceType: BuildingConnectionLineSourceType,
    outline: Point2D[],
    startY: number,
    endY: number,
    walls: StraightWallData[]
  ): void {
    if (outline.length < 2 || Math.abs(endY - startY) < BuildingConnectionLineDetector.MIN_SEGMENT_LENGTH) {
      return;
    }

    /* 轮廓边逐条匹配附近墙面；匹配成功后在线段两端生成竖向缝线。 */
    for (let outlineIndex: number = 0; outlineIndex < outline.length; outlineIndex++) {
      const outlineStart: Point2D = outline[outlineIndex]!;
      const outlineEnd: Point2D = outline[(outlineIndex + 1) % outline.length]!;
      const matchedWallInfo: { wall: StraightWallData; normal: Point2D } | null = this._findMatchingWallFace(
        outlineStart,
        outlineEnd,
        walls
      );
      if (matchedWallInfo === null) {
        continue;
      }

      const offsetStart: Point2D = {
        x: outlineStart.x + matchedWallInfo.normal.x * BuildingConnectionLineDetector.WALL_FACE_OFFSET,
        z: outlineStart.z + matchedWallInfo.normal.z * BuildingConnectionLineDetector.WALL_FACE_OFFSET,
      };
      const offsetEnd: Point2D = {
        x: outlineEnd.x + matchedWallInfo.normal.x * BuildingConnectionLineDetector.WALL_FACE_OFFSET,
        z: outlineEnd.z + matchedWallInfo.normal.z * BuildingConnectionLineDetector.WALL_FACE_OFFSET,
      };

      this._appendVerticalSegment(target, sourceObjectId, sourceType, outlineIndex, 'start', offsetStart, startY, endY, matchedWallInfo.normal);
      this._appendVerticalSegment(target, sourceObjectId, sourceType, outlineIndex, 'end', offsetEnd, startY, endY, matchedWallInfo.normal);
    }
  }

  /**
   * 根据共享墙端点生成室内墙角竖向衔接线。
   * @param target - 输出线段数组
   * @param sourceObjectId - 来源建筑对象 ID
   * @param sourceType - 来源类型
   * @param outline - XZ 平面闭合轮廓点
   * @param startY - 竖向线起始高度
   * @param endY - 竖向线结束高度
   * @param walls - 当前场景内直墙数据
   */
  private _appendWallJointVerticalSegments(
    target: BuildingConnectionLineSegment[],
    sourceObjectId: string,
    sourceType: BuildingConnectionLineSourceType,
    outline: Point2D[],
    startY: number,
    endY: number,
    walls: StraightWallData[]
  ): void {
    if (outline.length < 3 || Math.abs(endY - startY) < BuildingConnectionLineDetector.MIN_SEGMENT_LENGTH) {
      return;
    }

    const jointGroups: Point2D[][] = this._collectWallJointGroups(walls);

    /* 每个共享墙端点代表一个墙角；取落在室内轮廓内的墙体面角点补充竖线。 */
    for (let jointIndex: number = 0; jointIndex < jointGroups.length; jointIndex++) {
      const wallCorners: Point2D[] = jointGroups[jointIndex]!;
      const candidateCorners: Point2D[] = this._filterCornersInsideOutline(wallCorners, outline);
      for (let cornerIndex: number = 0; cornerIndex < candidateCorners.length; cornerIndex++) {
        const corner: Point2D = candidateCorners[cornerIndex]!;
        this._appendVerticalSegment(
          target,
          sourceObjectId,
          sourceType,
          jointIndex,
          `joint-${cornerIndex}`,
          corner,
          startY,
          endY,
          { x: 0, z: 1 }
        );
      }
    }
  }

  /**
   * 收集所有由两面及以上直墙共享的端点面角点。
   * @param walls - 当前场景内直墙数据
   * @returns 每个连接点对应的一组墙体面角点
   */
  private _collectWallJointGroups(walls: StraightWallData[]): Point2D[][] {
    const groups: Point2D[][] = [];

    /* 先按墙中心线端点聚类，再将同一连接点处各墙左右两侧面角点合并。 */
    for (let wallIndex: number = 0; wallIndex < walls.length; wallIndex++) {
      const wall: StraightWallData = walls[wallIndex]!;
      const wallCorners: { endpoint: Point2D; corners: Point2D[] }[] = this._getWallEndpointFaceCorners(wall);
      for (let endpointIndex: number = 0; endpointIndex < wallCorners.length; endpointIndex++) {
        const endpointCorners: { endpoint: Point2D; corners: Point2D[] } = wallCorners[endpointIndex]!;
        this._mergeEndpointCorners(groups, endpointCorners.endpoint, endpointCorners.corners);
      }
    }

    return groups
      .filter((corners: Point2D[]): boolean => corners.length >= 4)
      .map((corners: Point2D[]): Point2D[] => corners.slice(1));
  }

  /**
   * 计算单面直墙两个端点处的左右面角点。
   * @param wall - 直墙数据
   * @returns 两端点及其面角点
   */
  private _getWallEndpointFaceCorners(wall: StraightWallData): { endpoint: Point2D; corners: Point2D[] }[] {
    const dx: number = wall.end.x - wall.start.x;
    const dz: number = wall.end.z - wall.start.z;
    const length: number = Math.sqrt(dx * dx + dz * dz);
    if (length < BuildingConnectionLineDetector.MIN_SEGMENT_LENGTH) {
      return [];
    }

    const normal: Point2D = { x: -dz / length, z: dx / length };
    const halfThickness: number = wall.thickness / 2;
    const startCorners: Point2D[] = [
      { x: wall.start.x + normal.x * halfThickness, z: wall.start.z + normal.z * halfThickness },
      { x: wall.start.x - normal.x * halfThickness, z: wall.start.z - normal.z * halfThickness },
    ];
    const endCorners: Point2D[] = [
      { x: wall.end.x + normal.x * halfThickness, z: wall.end.z + normal.z * halfThickness },
      { x: wall.end.x - normal.x * halfThickness, z: wall.end.z - normal.z * halfThickness },
    ];

    return [
      { endpoint: wall.start, corners: startCorners },
      { endpoint: wall.end, corners: endCorners },
    ];
  }

  /**
   * 将端点面角点合并到已有连接点分组。
   * @param groups - 连接点分组
   * @param endpoint - 墙中心线端点
   * @param corners - 该端点对应的左右面角点
   */
  private _mergeEndpointCorners(groups: Point2D[][], endpoint: Point2D, corners: Point2D[]): void {
    for (let groupIndex: number = 0; groupIndex < groups.length; groupIndex++) {
      const group: Point2D[] = groups[groupIndex]!;
      const representative: Point2D = group[0]!;
      const dx: number = representative.x - endpoint.x;
      const dz: number = representative.z - endpoint.z;
      const distance: number = Math.sqrt(dx * dx + dz * dz);
      if (distance <= BuildingConnectionLineDetector.WALL_JOINT_MATCH_TOLERANCE) {
        this._appendUniquePoints(group, corners);
        return;
      }
    }

    const newGroup: Point2D[] = [{ x: endpoint.x, z: endpoint.z }];
    this._appendUniquePoints(newGroup, corners);
    groups.push(newGroup);
  }

  /**
   * 向目标数组追加不重复点。
   * @param target - 目标点数组
   * @param points - 待追加点数组
   */
  private _appendUniquePoints(target: Point2D[], points: Point2D[]): void {
    for (let pointIndex: number = 0; pointIndex < points.length; pointIndex++) {
      const point: Point2D = points[pointIndex]!;
      const exists: boolean = target.some((current: Point2D): boolean => {
        const dx: number = current.x - point.x;
        const dz: number = current.z - point.z;
        const distance: number = Math.sqrt(dx * dx + dz * dz);
        return distance <= BuildingConnectionLineDetector.MIN_SEGMENT_LENGTH;
      });
      if (!exists) {
        target.push({ x: point.x, z: point.z });
      }
    }
  }

  /**
   * 从墙角候选点中筛选落在室内轮廓范围内的点。
   * @param corners - 墙体连接点附近的候选面角点
   * @param outline - XZ 平面闭合轮廓点
   * @returns 位于轮廓内或贴近轮廓边的候选点
   */
  private _filterCornersInsideOutline(corners: Point2D[], outline: Point2D[]): Point2D[] {
    const result: Point2D[] = [];
    for (let cornerIndex: number = 0; cornerIndex < corners.length; cornerIndex++) {
      const corner: Point2D = corners[cornerIndex]!;
      if (this._isPointInsideOutline(corner, outline) || this._isPointNearOutline(corner, outline)) {
        result.push(corner);
      }
    }
    return result;
  }

  /**
   * 判断点是否位于闭合轮廓内部。
   * @param point - 待判断点
   * @param outline - XZ 平面闭合轮廓点
   * @returns 位于内部返回 true
   */
  private _isPointInsideOutline(point: Point2D, outline: Point2D[]): boolean {
    let inside: boolean = false;
    for (let index: number = 0, previousIndex: number = outline.length - 1; index < outline.length; previousIndex = index++) {
      const current: Point2D = outline[index]!;
      const previous: Point2D = outline[previousIndex]!;
      const intersects: boolean = (current.z > point.z) !== (previous.z > point.z) &&
        point.x < ((previous.x - current.x) * (point.z - current.z)) / (previous.z - current.z) + current.x;
      if (intersects) {
        inside = !inside;
      }
    }
    return inside;
  }

  /**
   * 判断点是否贴近闭合轮廓边。
   * @param point - 待判断点
   * @param outline - XZ 平面闭合轮廓点
   * @returns 点到任一轮廓边距离小于容差时返回 true
   */
  private _isPointNearOutline(point: Point2D, outline: Point2D[]): boolean {
    for (let index: number = 0; index < outline.length; index++) {
      const start: Point2D = outline[index]!;
      const end: Point2D = outline[(index + 1) % outline.length]!;
      const distance: number = this._distancePointToSegment(point, start, end);
      if (distance <= BuildingConnectionLineDetector.OUTLINE_CONTAINS_TOLERANCE) {
        return true;
      }
    }
    return false;
  }

  /**
   * 查找与轮廓边重合或近似贴合的墙面。
   * @param outlineStart - 轮廓边起点
   * @param outlineEnd - 轮廓边终点
   * @param walls - 候选直墙数组
   * @returns 匹配墙体与墙面外法线；未匹配返回 null
   */
  private _findMatchingWallFace(
    outlineStart: Point2D,
    outlineEnd: Point2D,
    walls: StraightWallData[]
  ): { wall: StraightWallData; normal: Point2D } | null {
    const edgeDx: number = outlineEnd.x - outlineStart.x;
    const edgeDz: number = outlineEnd.z - outlineStart.z;
    const edgeLength: number = Math.sqrt(edgeDx * edgeDx + edgeDz * edgeDz);
    if (edgeLength < BuildingConnectionLineDetector.MIN_SEGMENT_LENGTH) {
      return null;
    }

    for (let wallIndex: number = 0; wallIndex < walls.length; wallIndex++) {
      const wall: StraightWallData = walls[wallIndex]!;
      const wallDx: number = wall.end.x - wall.start.x;
      const wallDz: number = wall.end.z - wall.start.z;
      const wallLength: number = Math.sqrt(wallDx * wallDx + wallDz * wallDz);
      if (wallLength < BuildingConnectionLineDetector.MIN_SEGMENT_LENGTH) {
        continue;
      }

      const cross: number = Math.abs(edgeDx * wallDz - edgeDz * wallDx) / (edgeLength * wallLength);
      if (cross > 0.03) {
        continue;
      }

      const startProjection: number = this._projectPointToWallParameter(outlineStart, wall);
      const endProjection: number = this._projectPointToWallParameter(outlineEnd, wall);
      const minProjection: number = Math.min(startProjection, endProjection);
      const maxProjection: number = Math.max(startProjection, endProjection);
      if (
        minProjection < -BuildingConnectionLineDetector.WALL_SPAN_MATCH_TOLERANCE ||
        maxProjection > wallLength + BuildingConnectionLineDetector.WALL_SPAN_MATCH_TOLERANCE
      ) {
        continue;
      }

      const distanceToWallCenter: number = this._distancePointToLine(outlineStart, wall.start, wall.end);
      const expectedFaceDistance: number = wall.thickness / 2;
      if (Math.abs(distanceToWallCenter - expectedFaceDistance) > BuildingConnectionLineDetector.WALL_FACE_MATCH_TOLERANCE) {
        continue;
      }

      const wallNormalA: Point2D = { x: -wallDz / wallLength, z: wallDx / wallLength };
      const sideSign: number = this._signedDistanceToLine(outlineStart, wall.start, wall.end) >= 0 ? 1 : -1;
      const faceNormal: Point2D = { x: wallNormalA.x * sideSign, z: wallNormalA.z * sideSign };
      return { wall: wall, normal: faceNormal };
    }

    return null;
  }

  /**
   * 追加单条墙面竖向缝线。
   * @param target - 输出线段数组
   * @param sourceObjectId - 来源建筑对象 ID
   * @param sourceType - 来源类型
   * @param outlineIndex - 轮廓边索引
   * @param endpointName - 端点名称
   * @param point - 竖线所在 XZ 坐标
   * @param startY - 起始高度
   * @param endY - 结束高度
   * @param normal - 贴附墙面法线
   */
  private _appendVerticalSegment(
    target: BuildingConnectionLineSegment[],
    sourceObjectId: string,
    sourceType: BuildingConnectionLineSourceType,
    outlineIndex: number,
    endpointName: string,
    point: Point2D,
    startY: number,
    endY: number,
    normal: Point2D
  ): void {
    target.push({
      id: `${sourceType}-${sourceObjectId}-wall-face-${outlineIndex}-${endpointName}`,
      sourceObjectId: sourceObjectId,
      sourceType: sourceType,
      start: { x: point.x, z: point.z },
      end: { x: point.x, z: point.z },
      y: (startY + endY) / 2,
      startY: startY,
      endY: endY,
      width: BuildingConnectionLineDetector.DEFAULT_LINE_WIDTH,
      orientation: 'vertical',
      normal: { x: normal.x, z: normal.z },
    });
  }

  /**
   * 计算点在墙中心线上的投影距离。
   * @param point - 待投影点
   * @param wall - 直墙数据
   * @returns 从墙起点开始的投影距离
   */
  private _projectPointToWallParameter(point: Point2D, wall: StraightWallData): number {
    const wallDx: number = wall.end.x - wall.start.x;
    const wallDz: number = wall.end.z - wall.start.z;
    const wallLength: number = Math.sqrt(wallDx * wallDx + wallDz * wallDz);
    if (wallLength < BuildingConnectionLineDetector.MIN_SEGMENT_LENGTH) {
      return 0;
    }
    return ((point.x - wall.start.x) * wallDx + (point.z - wall.start.z) * wallDz) / wallLength;
  }

  /**
   * 计算点到直线的无符号距离。
   * @param point - 待计算点
   * @param lineStart - 直线起点
   * @param lineEnd - 直线终点
   * @returns 点到直线距离
   */
  private _distancePointToLine(point: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
    return Math.abs(this._signedDistanceToLine(point, lineStart, lineEnd));
  }

  /**
   * 计算点到线段的最短距离。
   * @param point - 待计算点
   * @param segmentStart - 线段起点
   * @param segmentEnd - 线段终点
   * @returns 点到线段距离
   */
  private _distancePointToSegment(point: Point2D, segmentStart: Point2D, segmentEnd: Point2D): number {
    const dx: number = segmentEnd.x - segmentStart.x;
    const dz: number = segmentEnd.z - segmentStart.z;
    const lengthSquared: number = dx * dx + dz * dz;
    if (lengthSquared < BuildingConnectionLineDetector.MIN_SEGMENT_LENGTH * BuildingConnectionLineDetector.MIN_SEGMENT_LENGTH) {
      const startDx: number = point.x - segmentStart.x;
      const startDz: number = point.z - segmentStart.z;
      return Math.sqrt(startDx * startDx + startDz * startDz);
    }

    /* 将点投影到线段参数范围 [0, 1] 内，确保返回的是到有限线段的距离。 */
    const rawT: number = ((point.x - segmentStart.x) * dx + (point.z - segmentStart.z) * dz) / lengthSquared;
    const clampedT: number = Math.max(0, Math.min(1, rawT));
    const closestX: number = segmentStart.x + dx * clampedT;
    const closestZ: number = segmentStart.z + dz * clampedT;
    const closestDx: number = point.x - closestX;
    const closestDz: number = point.z - closestZ;
    return Math.sqrt(closestDx * closestDx + closestDz * closestDz);
  }

  /**
   * 计算点到有向直线的带符号距离。
   * @param point - 待计算点
   * @param lineStart - 有向直线起点
   * @param lineEnd - 有向直线终点
   * @returns 左侧为正、右侧为负的距离
   */
  private _signedDistanceToLine(point: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
    const dx: number = lineEnd.x - lineStart.x;
    const dz: number = lineEnd.z - lineStart.z;
    const length: number = Math.sqrt(dx * dx + dz * dz);
    if (length < BuildingConnectionLineDetector.MIN_SEGMENT_LENGTH) {
      return 0;
    }
    return ((point.x - lineStart.x) * dz - (point.z - lineStart.z) * dx) / length;
  }
}
