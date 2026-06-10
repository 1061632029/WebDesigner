/**
 * 平面线式布置统一捕获服务
 * 为墙、梁等构件提供端点/中点/圆心/延长线/正交约束捕获计算。
 */

import type {
  ArcWallData,
  BeamData,
  BuildingObject,
  ColumnData,
  Point2D,
  StraightWallData,
  WallData,
} from './BuildingTypes';
import type {
  PlanarPlacementGuideLine,
  PlanarPlacementLineTarget,
  PlanarPlacementPointTarget,
  PlanarPlacementSnapResult,
} from './PlanarPlacementSnapTypes';

/** 捕获辅助线候选项，携带类型优先级和距离用于有限显示排序 */
interface PlanarPlacementGuideLineCandidate {
  /** 来源线捕获目标 */
  target: PlanarPlacementLineTarget;
  /** 辅助虚线 */
  guideLine: PlanarPlacementGuideLine;
  /** 捕获线类型显示优先级，数值越大越优先 */
  priority: number;
  /** 鼠标点到候选捕获线垂足的距离，优先级相同时距离越近越优先 */
  distance: number;
}

/** 正交吸附角度阈值：1° */
const ORTHOGONAL_ANGLE_THRESHOLD_RADIAN: number = Math.PI / 90;

/** 辅助虚线半长，单位：米 */
const GUIDE_HALF_LENGTH: number = 12;

/** 正交约束辅助虚线半长，单位：米；长于普通捕获虚线便于观察方向约束 */
const ORTHOGONAL_GUIDE_HALF_LENGTH: number = 24;

/** 最大捕获辅助线显示数量 */
const MAX_GUIDE_LINE_DISPLAY_COUNT: number = 2;

/** 端点法向捕获线显示优先级 */
const ENDPOINT_NORMAL_LINE_PRIORITY: number = 300;

/** 延长线捕获线显示优先级 */
const EXTENSION_LINE_PRIORITY: number = 200;

/** 线式构件连接点判定容差，单位：米 */
const LINEAR_CONNECTION_EPSILON: number = 0.001;

/** 最小有效线段长度，避免除零 */
const MIN_LINE_LENGTH: number = 0.001;

/**
 * 平面线式布置统一捕获服务
 * 关键流程：先收集强点目标，再计算延长线目标，最后在没有强捕获时应用正交约束。
 */
export class PlanarPlacementSnapService {
  /** 捕获目标来源对象读取函数 */
  private readonly _getObjects: () => BuildingObject[];

  /**
   * @param getObjects - 返回当前建筑对象列表的函数
   */
  constructor(getObjects: () => BuildingObject[]) {
    this._getObjects = getObjects;
  }

  /**
   * 执行平面布置捕获
   * @param rawPoint - 原始鼠标投射点
   * @param threshold - 捕获距离阈值
   * @param orthogonalAnchor - 正交约束锚点；线式布置第二点阶段传入起点
   * @returns 捕获结果
   */
  public snap(
    rawPoint: Point2D,
    threshold: number,
    orthogonalAnchor: Point2D | null,
    guideHalfLength: number = GUIDE_HALF_LENGTH
  ): PlanarPlacementSnapResult {
    const pointSnapResult: PlanarPlacementSnapResult | null = this._snapToPointTargets(rawPoint, threshold);
    if (pointSnapResult !== null) {
      return pointSnapResult;
    }

    const lineSnapResult: PlanarPlacementSnapResult | null = this._snapToLineTargets(rawPoint, threshold, guideHalfLength);
    if (lineSnapResult !== null) {
      return lineSnapResult;
    }

    if (orthogonalAnchor !== null) {
      const orthogonalResult: PlanarPlacementSnapResult | null = this._snapToOrthogonal(rawPoint, orthogonalAnchor, guideHalfLength);
      if (orthogonalResult !== null) {
        return orthogonalResult;
      }
    }

    return {
      snapped: false,
      type: 'none',
      position: rawPoint,
      objectId: null,
      guideLine: null,
      guideLines: [],
    };
  }

  /**
   * 收集所有平面点捕获目标
   * @returns 端点、中点、圆弧圆心和整圆圆心目标列表
   */
  private _collectPointTargets(): PlanarPlacementPointTarget[] {
    const targets: PlanarPlacementPointTarget[] = [];
    const objects: BuildingObject[] = this._getObjects();

    for (const object of objects) {
      if (object.category === 'wall') {
        this._appendWallPointTargets(targets, object as WallData);
      } else if (object.category === 'beam') {
        this._appendLinearPointTargets(targets, object.id, (object as BeamData).start, (object as BeamData).end);
      } else if (object.category === 'column') {
        this._appendColumnPointTargets(targets, object as ColumnData);
      }
    }

    return targets;
  }

  /**
   * 收集所有平面线捕获目标
   * @returns 墙和梁中心线延长线、端点 XZ 法向延长线目标列表
   */
  private _collectLineTargets(): PlanarPlacementLineTarget[] {
    const targets: PlanarPlacementLineTarget[] = [];
    const objects: BuildingObject[] = this._getObjects();

    for (const object of objects) {
      if (object.category === 'wall') {
        const wallData: WallData = object as WallData;
        if (wallData.subType === 'straight') {
          const straightWall: StraightWallData = wallData as StraightWallData;
          this._appendLinearLineTargets(targets, straightWall.id, straightWall.start, straightWall.end);
        }
      } else if (object.category === 'beam') {
        const beamData: BeamData = object as BeamData;
        this._appendLinearLineTargets(targets, beamData.id, beamData.start, beamData.end);
      }
    }

    return targets;
  }

  /**
   * 追加线式对象的中心线延长线和端点法向延长线目标
   * 关键流程：先添加对象自身方向无限线，再分别以起终点为基点添加 XZ 平面法向无限线。
   * @param targets - 线捕获目标列表
   * @param objectId - 来源对象 ID
   * @param start - 线性对象起点
   * @param end - 线性对象终点
   */
  private _appendLinearLineTargets(targets: PlanarPlacementLineTarget[], objectId: string, start: Point2D, end: Point2D): void {
    const dx: number = end.x - start.x;
    const dz: number = end.z - start.z;
    const length: number = Math.sqrt(dx * dx + dz * dz);
    if (length < MIN_LINE_LENGTH) {
      return;
    }

    targets.push({
      type: 'extension-line',
      objectId: objectId,
      start: start,
      end: end,
    });

    const normalX: number = -dz / length;
    const normalZ: number = dx / length;
    const startConnected: boolean = this._isLinearEndpointConnected(objectId, start);
    if (!startConnected) {
      this._appendEndpointNormalLineTarget(targets, objectId, start, normalX, normalZ);
    }

    const endConnected: boolean = this._isLinearEndpointConnected(objectId, end);
    if (!endConnected) {
      this._appendEndpointNormalLineTarget(targets, objectId, end, normalX, normalZ);
    }
  }

  /**
   * 追加单个端点的 XZ 法向无限线目标
   * @param targets - 线捕获目标列表
   * @param objectId - 来源对象 ID
   * @param endpoint - 法向线经过的端点
   * @param normalX - XZ 平面法向 X 分量
   * @param normalZ - XZ 平面法向 Z 分量
   */
  private _appendEndpointNormalLineTarget(
    targets: PlanarPlacementLineTarget[],
    objectId: string,
    endpoint: Point2D,
    normalX: number,
    normalZ: number
  ): void {
    targets.push({
      type: 'endpoint-normal-line',
      objectId: objectId,
      start: endpoint,
      end: {
        x: endpoint.x + normalX,
        z: endpoint.z + normalZ,
      },
    });
  }

  /**
   * 追加墙体相关点目标
   * @param targets - 目标列表
   * @param wallData - 墙体数据
   */
  private _appendWallPointTargets(targets: PlanarPlacementPointTarget[], wallData: WallData): void {
    if (wallData.subType === 'straight') {
      const straightWall: StraightWallData = wallData as StraightWallData;
      this._appendLinearPointTargets(targets, straightWall.id, straightWall.start, straightWall.end);
      return;
    }

    if (wallData.subType === 'arc') {
      const arcWall: ArcWallData = wallData as ArcWallData;
      this._appendLinearPointTargets(targets, arcWall.id, arcWall.start, arcWall.end);
      const center: Point2D | null = this._computeArcCenter(arcWall.start, arcWall.end, arcWall.bulge);
      if (center !== null) {
        targets.push({ type: 'arc-center', position: center, objectId: arcWall.id });
      }
    }
  }

  /**
   * 追加线式对象的端点和中点目标
   * @param targets - 目标列表
   * @param objectId - 来源对象 ID
   * @param start - 线段起点
   * @param end - 线段终点
   */
  private _appendLinearPointTargets(targets: PlanarPlacementPointTarget[], objectId: string, start: Point2D, end: Point2D): void {
    targets.push({ type: 'endpoint', position: start, objectId: objectId });
    targets.push({ type: 'endpoint', position: end, objectId: objectId });
    targets.push({
      type: 'midpoint',
      position: {
        x: (start.x + end.x) / 2,
        z: (start.z + end.z) / 2,
      },
      objectId: objectId,
    });
  }

  /**
   * 追加圆形柱等整圆中心点目标
   * @param targets - 目标列表
   * @param columnData - 柱数据
   */
  private _appendColumnPointTargets(targets: PlanarPlacementPointTarget[], columnData: ColumnData): void {
    if (columnData.shape !== 'round') {
      return;
    }
    targets.push({
      type: 'circle-center',
      position: columnData.center,
      objectId: columnData.id,
    });
  }

  /**
   * 对点目标执行最近距离捕获
   * @param rawPoint - 原始点
   * @param threshold - 捕获阈值
   * @returns 点捕获结果或 null
   */
  private _snapToPointTargets(rawPoint: Point2D, threshold: number): PlanarPlacementSnapResult | null {
    const targets: PlanarPlacementPointTarget[] = this._collectPointTargets();
    let nearestTarget: PlanarPlacementPointTarget | null = null;
    let nearestDistance: number = Number.POSITIVE_INFINITY;

    for (const target of targets) {
      const distance: number = this._distance(rawPoint, target.position);
      if (distance <= threshold && distance < nearestDistance) {
        nearestDistance = distance;
        nearestTarget = target;
      }
    }

    if (nearestTarget === null) {
      return null;
    }

    return {
      snapped: true,
      type: nearestTarget.type,
      position: nearestTarget.position,
      objectId: nearestTarget.objectId,
      guideLine: null,
      guideLines: [],
    };
  }

  /**
   * 对线目标执行无限延长线垂足捕获
   * @param rawPoint - 原始点
   * @param threshold - 捕获阈值
   * @param guideHalfLength - 辅助虚线半长
   * @returns 线捕获结果或 null
   */
  private _snapToLineTargets(rawPoint: Point2D, threshold: number, guideHalfLength: number): PlanarPlacementSnapResult | null {
    const targets: PlanarPlacementLineTarget[] = this._collectLineTargets();
    let nearestTarget: PlanarPlacementLineTarget | null = null;
    let nearestPoint: Point2D | null = null;
    let nearestDistance: number = Number.POSITIVE_INFINITY;

    for (const target of targets) {
      const projectedPoint: Point2D | null = this._projectToInfiniteLine(rawPoint, target.start, target.end);
      if (projectedPoint === null) {
        continue;
      }
      if (this._shouldIgnoreLineTargetAtConnection(target, projectedPoint, threshold)) {
        continue;
      }
      const distance: number = this._distance(rawPoint, projectedPoint);
      if (distance <= threshold && distance < nearestDistance) {
        nearestDistance = distance;
        nearestTarget = target;
        nearestPoint = projectedPoint;
      }
    }

    if (nearestTarget === null || nearestPoint === null) {
      return null;
    }

    const primaryGuideLine: PlanarPlacementGuideLine | null = this._buildPrimaryLineGuideLine(
      nearestTarget,
      nearestPoint,
      guideHalfLength
    );
    const guideLines: PlanarPlacementGuideLine[] = this._buildPrioritizedLineGuideLines(
      targets,
      nearestTarget,
      primaryGuideLine,
      rawPoint,
      threshold,
      guideHalfLength
    );

    return {
      snapped: true,
      type: nearestTarget.type,
      position: nearestPoint,
      objectId: nearestTarget.objectId,
      guideLine: primaryGuideLine,
      guideLines: guideLines,
    };
  }

  /**
   * 构建当前捕获目标对应的主辅助虚线
   * 关键流程：中心线延长捕获以垂足为中心；端点法向捕获以目标端点为中心，确保绿色捕获点和显示虚线属于同一条无限线。
   * @param target - 当前最近线捕获目标
   * @param snappedPoint - 当前捕获点
   * @param guideHalfLength - 辅助虚线半长
   * @returns 主辅助虚线；无效线返回 null
   */
  private _buildPrimaryLineGuideLine(
    target: PlanarPlacementLineTarget,
    snappedPoint: Point2D,
    guideHalfLength: number
  ): PlanarPlacementGuideLine | null {
    const guideCenter: Point2D = target.type === 'endpoint-normal-line' ? target.start : snappedPoint;
    return this._buildExtensionGuideLine(target.start, target.end, guideCenter, guideHalfLength);
  }

  /**
   * 构建按优先级排序的线捕获辅助虚线集合
   * 关键流程：第一条永远放入当前捕获点对应的主预览线；其余候选按捕获线类型优先级排序，并限制总显示数量。
   * @param targets - 所有线捕获目标
   * @param nearestTarget - 当前计算捕获点使用的最近线目标
   * @param primaryGuideLine - 当前捕获点对应的主预览线
   * @param rawPoint - 原始鼠标点
   * @param threshold - 捕获阈值
   * @param guideHalfLength - 辅助虚线半长
   * @returns 第一条为主预览线的辅助虚线集合
   */
  private _buildPrioritizedLineGuideLines(
    targets: PlanarPlacementLineTarget[],
    nearestTarget: PlanarPlacementLineTarget,
    primaryGuideLine: PlanarPlacementGuideLine | null,
    rawPoint: Point2D,
    threshold: number,
    guideHalfLength: number
  ): PlanarPlacementGuideLine[] {
    if (primaryGuideLine === null) {
      return [];
    }

    const guideLines: PlanarPlacementGuideLine[] = [primaryGuideLine];
    const remainingCount: number = MAX_GUIDE_LINE_DISPLAY_COUNT - guideLines.length;
    if (remainingCount <= 0) {
      return guideLines;
    }

    const uniqueTargets: PlanarPlacementLineTarget[] = [nearestTarget];
    const additionalCandidates: PlanarPlacementGuideLineCandidate[] = this._buildAdditionalLineGuideLineCandidates(
      targets,
      uniqueTargets,
      nearestTarget,
      rawPoint,
      threshold,
      guideHalfLength
    );
    additionalCandidates.sort((a: PlanarPlacementGuideLineCandidate, b: PlanarPlacementGuideLineCandidate): number => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.distance - b.distance;
    });

    for (let index: number = 0; index < additionalCandidates.length && index < remainingCount; index++) {
      const candidate: PlanarPlacementGuideLineCandidate | undefined = additionalCandidates[index];
      if (candidate === undefined) {
        continue;
      }
      guideLines.push(candidate.guideLine);
    }
    return guideLines;
  }

  /**
   * 构建附加捕获辅助虚线候选集合
   * 关键流程：主捕获线已提前占位，附加线按类型优先级进入候选集合；同方向端点法向线只保留生成捕获点的捕获线。
   * @param targets - 所有线捕获目标
   * @param uniqueTargets - 已占用的线目标集合，首项为主捕获目标
   * @param nearestTarget - 当前计算捕获点使用的最近线目标
   * @param rawPoint - 原始鼠标点
   * @param threshold - 捕获阈值
   * @param guideHalfLength - 辅助虚线半长
   * @returns 不包含主预览线的附加辅助虚线候选集合
   */
  private _buildAdditionalLineGuideLineCandidates(
    targets: PlanarPlacementLineTarget[],
    uniqueTargets: PlanarPlacementLineTarget[],
    nearestTarget: PlanarPlacementLineTarget,
    rawPoint: Point2D,
    threshold: number,
    guideHalfLength: number
  ): PlanarPlacementGuideLineCandidate[] {
    const candidates: PlanarPlacementGuideLineCandidate[] = [];

    for (const target of targets) {
      if (target === nearestTarget) {
        continue;
      }

      const projectedPoint: Point2D | null = this._projectToInfiniteLine(rawPoint, target.start, target.end);
      if (projectedPoint === null) {
        continue;
      }
      if (this._shouldIgnoreLineTargetAtConnection(target, projectedPoint, threshold)) {
        continue;
      }

      const distance: number = this._distance(rawPoint, projectedPoint);
      if (distance > threshold) {
        continue;
      }

      if (this._hasSimilarGuideLine(uniqueTargets, target)) {
        continue;
      }

      const guideLine: PlanarPlacementGuideLine | null = this._buildExtensionGuideLine(
        target.start,
        target.end,
        target.start,
        guideHalfLength
      );
      if (guideLine === null) {
        continue;
      }

      uniqueTargets.push(target);
      candidates.push({
        target: target,
        guideLine: guideLine,
        priority: this._getLineTargetDisplayPriority(target),
        distance: distance,
      });
    }

    return candidates;
  }

  /**
   * 获取线捕获目标显示优先级
   * @param target - 线捕获目标
   * @returns 显示优先级，数值越大越优先显示
   */
  private _getLineTargetDisplayPriority(target: PlanarPlacementLineTarget): number {
    if (target.type === 'endpoint-normal-line') {
      return ENDPOINT_NORMAL_LINE_PRIORITY;
    }
    return EXTENSION_LINE_PRIORITY;
  }

  /**
   * 判断线捕获目标是否应在连接点处忽略
   * 关键流程：连接端点的法向线不参与捕获；延长线仅在投影点靠近连接端点时忽略，不影响整根构件其他区域。
   * @param target - 待检测线捕获目标
   * @param projectedPoint - 鼠标点投影到目标无限线后的点
   * @param threshold - 当前捕获阈值
   * @returns 需要忽略该捕获目标时返回 true
   */
  private _shouldIgnoreLineTargetAtConnection(
    target: PlanarPlacementLineTarget,
    projectedPoint: Point2D,
    threshold: number
  ): boolean {
    if (target.type === 'endpoint-normal-line') {
      return this._isLinearEndpointConnected(target.objectId, target.start);
    }

    const connectionIgnoreDistance: number = Math.max(threshold, LINEAR_CONNECTION_EPSILON);
    const startConnected: boolean = this._isLinearEndpointConnected(target.objectId, target.start);
    if (startConnected && this._distance(projectedPoint, target.start) <= connectionIgnoreDistance) {
      return true;
    }

    const endConnected: boolean = this._isLinearEndpointConnected(target.objectId, target.end);
    if (endConnected && this._distance(projectedPoint, target.end) <= connectionIgnoreDistance) {
      return true;
    }

    return false;
  }

  /**
   * 判断线式构件端点是否与其他墙或梁端点连接
   * 关键流程：遍历直墙和梁端点，排除自身对象；任一其他端点在容差范围内即视为连接处。
   * @param objectId - 当前线式构件 ID
   * @param endpoint - 当前构件端点
   * @returns 是连接端点时返回 true
   */
  private _isLinearEndpointConnected(objectId: string, endpoint: Point2D): boolean {
    const objects: BuildingObject[] = this._getObjects();

    for (const object of objects) {
      if (object.id === objectId) {
        continue;
      }

      const linearEndpoints: Point2D[] | null = this._getLinearObjectEndpoints(object);
      if (linearEndpoints === null) {
        continue;
      }

      for (const otherEndpoint of linearEndpoints) {
        if (this._distance(endpoint, otherEndpoint) <= LINEAR_CONNECTION_EPSILON) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 获取直墙或梁的线式端点
   * @param object - 建筑对象
   * @returns 直墙或梁端点数组；非线式对象返回 null
   */
  private _getLinearObjectEndpoints(object: BuildingObject): Point2D[] | null {
    if (object.category === 'wall') {
      const wallData: WallData = object as WallData;
      if (wallData.subType !== 'straight') {
        return null;
      }
      const straightWall: StraightWallData = wallData as StraightWallData;
      return [straightWall.start, straightWall.end];
    }

    if (object.category === 'beam') {
      const beamData: BeamData = object as BeamData;
      return [beamData.start, beamData.end];
    }

    return null;
  }

  /**
   * 归一化线方向，并把正反方向折叠为同一方向用于去重
   * @param lineStart - 线起点
   * @param lineEnd - 线终点
   * @returns 规范化方向；无效线返回 null
   */
  private _normalizeLineDirection(lineStart: Point2D, lineEnd: Point2D): Point2D | null {
    const dx: number = lineEnd.x - lineStart.x;
    const dz: number = lineEnd.z - lineStart.z;
    const length: number = Math.sqrt(dx * dx + dz * dz);
    if (length < MIN_LINE_LENGTH) {
      return null;
    }

    let dirX: number = dx / length;
    let dirZ: number = dz / length;
    if (dirX < 0 || (Math.abs(dirX) < 0.000001 && dirZ < 0)) {
      dirX = -dirX;
      dirZ = -dirZ;
    }

    return { x: dirX, z: dirZ };
  }

  /**
   * 判断候选辅助线是否已被同方向法向线占用
   * 关键流程：端点法向捕获线只要方向近似相同就视为重复；主捕获目标提前传入，可保证只保留生成当前捕获点的捕获线。
   * @param existingTargets - 已占用的端点法向线目标
   * @param candidateTarget - 待检测端点法向线目标
   * @returns 已存在同位置辅助线时返回 true
   */
  private _hasSimilarGuideLine(
    existingTargets: PlanarPlacementLineTarget[],
    candidateTarget: PlanarPlacementLineTarget
  ): boolean {
    const directionCosineThreshold: number = Math.cos(Math.PI / 180);
    const candidateDirection: Point2D | null = this._normalizeLineDirection(candidateTarget.start, candidateTarget.end);
    if (candidateDirection === null) {
      return true;
    }

    for (const existingTarget of existingTargets) {
      const existingDirection: Point2D | null = this._normalizeLineDirection(existingTarget.start, existingTarget.end);
      if (existingDirection === null) {
        continue;
      }

      const dot: number = existingDirection.x * candidateDirection.x + existingDirection.z * candidateDirection.z;
      if (Math.abs(dot) < directionCosineThreshold) {
        continue;
      }
      return true;
    }

    return false;
  }

  /**
   * 对线式布置第二点执行水平/垂直正交约束
   * @param rawPoint - 原始点
   * @param anchor - 布置线起点
   * @param guideHalfLength - 辅助虚线半长
   * @returns 正交捕获结果或 null
   */
  private _snapToOrthogonal(rawPoint: Point2D, anchor: Point2D, guideHalfLength: number): PlanarPlacementSnapResult | null {
    const dx: number = rawPoint.x - anchor.x;
    const dz: number = rawPoint.z - anchor.z;
    const length: number = Math.sqrt(dx * dx + dz * dz);
    if (length < MIN_LINE_LENGTH) {
      return null;
    }

    const sinThreshold: number = Math.sin(ORTHOGONAL_ANGLE_THRESHOLD_RADIAN);
    const horizontalOffsetRatio: number = Math.abs(dz) / length;
    const verticalOffsetRatio: number = Math.abs(dx) / length;

    let snappedPoint: Point2D | null = null;
    let guideDirectionX: number = 0;
    let guideDirectionZ: number = 0;
    if (horizontalOffsetRatio <= sinThreshold) {
      snappedPoint = { x: rawPoint.x, z: anchor.z };
      guideDirectionX = 1;
      guideDirectionZ = 0;
    } else if (verticalOffsetRatio <= sinThreshold) {
      snappedPoint = { x: anchor.x, z: rawPoint.z };
      guideDirectionX = 0;
      guideDirectionZ = 1;
    }

    if (snappedPoint === null) {
      return null;
    }

    const guideLine: PlanarPlacementGuideLine = this._buildGuideLineByDirection(
      snappedPoint,
      guideDirectionX,
      guideDirectionZ,
      Math.max(guideHalfLength, ORTHOGONAL_GUIDE_HALF_LENGTH)
    );

    return {
      snapped: true,
      type: 'orthogonal',
      position: snappedPoint,
      objectId: null,
      guideLine: guideLine,
      guideLines: [guideLine],
    };
  }

  /**
   * 计算点到无限直线的垂足
   * @param point - 待投影点
   * @param lineStart - 直线起点
   * @param lineEnd - 直线终点
   * @returns 垂足点；无效线段返回 null
   */
  private _projectToInfiniteLine(point: Point2D, lineStart: Point2D, lineEnd: Point2D): Point2D | null {
    const dx: number = lineEnd.x - lineStart.x;
    const dz: number = lineEnd.z - lineStart.z;
    const lengthSq: number = dx * dx + dz * dz;
    if (lengthSq < MIN_LINE_LENGTH * MIN_LINE_LENGTH) {
      return null;
    }

    const t: number = ((point.x - lineStart.x) * dx + (point.z - lineStart.z) * dz) / lengthSq;
    return {
      x: lineStart.x + dx * t,
      z: lineStart.z + dz * t,
    };
  }

  /**
   * 构建延长线辅助虚线
   * @param lineStart - 来源线起点
   * @param lineEnd - 来源线终点
   * @param center - 虚线中心点
   * @returns 虚线线段
   */
  private _buildExtensionGuideLine(
    lineStart: Point2D,
    lineEnd: Point2D,
    center: Point2D,
    guideHalfLength: number
  ): PlanarPlacementGuideLine | null {
    const dx: number = lineEnd.x - lineStart.x;
    const dz: number = lineEnd.z - lineStart.z;
    const length: number = Math.sqrt(dx * dx + dz * dz);
    if (length < MIN_LINE_LENGTH) {
      return null;
    }

    const dirX: number = dx / length;
    const dirZ: number = dz / length;
    return this._buildGuideLineByDirection(center, dirX, dirZ, guideHalfLength);
  }

  /**
   * 按方向构建固定长度辅助虚线
   * @param center - 虚线中心点
   * @param dirX - 方向向量 X 分量
   * @param dirZ - 方向向量 Z 分量
   * @param halfLength - 虚线半长
   * @returns 虚线线段
   */
  private _buildGuideLineByDirection(center: Point2D, dirX: number, dirZ: number, halfLength: number): PlanarPlacementGuideLine {
    return {
      start: {
        x: center.x - dirX * halfLength,
        z: center.z - dirZ * halfLength,
      },
      end: {
        x: center.x + dirX * halfLength,
        z: center.z + dirZ * halfLength,
      },
    };
  }

  /**
   * 根据弧形墙 bulge 参数计算圆心
   * @param start - 弧线起点
   * @param end - 弧线终点
   * @param bulge - 弧度因子
   * @returns 圆心；退化直线返回 null
   */
  private _computeArcCenter(start: Point2D, end: Point2D, bulge: number): Point2D | null {
    if (Math.abs(bulge) < 0.001) {
      return null;
    }

    const chordDx: number = end.x - start.x;
    const chordDz: number = end.z - start.z;
    const chordLength: number = Math.sqrt(chordDx * chordDx + chordDz * chordDz);
    if (chordLength < MIN_LINE_LENGTH) {
      return null;
    }

    const includedAngle: number = 4 * Math.atan(Math.abs(bulge));
    const sinHalf: number = Math.sin(includedAngle / 2);
    if (Math.abs(sinHalf) < 0.0001) {
      return null;
    }

    const radius: number = chordLength / (2 * sinHalf);
    const midX: number = (start.x + end.x) / 2;
    const midZ: number = (start.z + end.z) / 2;
    const normalX: number = -chordDz / chordLength;
    const normalZ: number = chordDx / chordLength;
    const centerDistance: number = radius * Math.cos(includedAngle / 2);
    const sign: number = bulge > 0 ? 1 : -1;

    return {
      x: midX + normalX * centerDistance * sign,
      z: midZ + normalZ * centerDistance * sign,
    };
  }

  /**
   * 计算两点距离
   * @param a - 点 A
   * @param b - 点 B
   * @returns 欧氏距离
   */
  private _distance(a: Point2D, b: Point2D): number {
    const dx: number = a.x - b.x;
    const dz: number = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
}