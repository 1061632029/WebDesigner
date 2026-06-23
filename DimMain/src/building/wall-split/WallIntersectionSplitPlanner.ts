/**
 * 直墙相交打断规划服务。
 * 只负责根据墙体中心线计算拆分计划，不直接修改建筑对象管理器或场景状态。
 */

import type { BuildingObject, StraightWallData } from '../BuildingTypes';
import { Geometry2DUtils, type SegmentIntersectionResult } from '../manager/Geometry2DUtils';

/** 单面直墙需要按参数拆分的规划数据。 */
export interface WallSplitTargetPlan {
  /** 被拆分墙体快照。 */
  originalWall: StraightWallData;
  /** 拆分参数，按从起点到终点升序排列，不包含 0 和 1。 */
  splitParameters: number[];
}

/** 新直墙与已有直墙的相交打断规划结果。 */
export interface WallIntersectionSplitPlan {
  /** 新直墙自身需要拆分的参数，按从起点到终点升序排列，不包含 0 和 1。 */
  newWallSplitParameters: number[];
  /** 需要被删除并替换为分段墙的已有墙体。 */
  existingWallPlans: WallSplitTargetPlan[];
}

/** 直墙相交打断规划选项。 */
export interface WallIntersectionSplitPlannerOptions {
  /** 线段相交计算容差。 */
  epsilon: number;
  /** 交点距离墙体端点小于该参数时，不对对应墙体打断。 */
  endpointTolerance: number;
  /** 拆分后任一墙段长度小于该值时，放弃本次拆分。 */
  minimumSegmentLength: number;
}

/** 直墙相交打断规划服务。 */
export class WallIntersectionSplitPlanner {
  /** 默认规划参数，单位为米。 */
  public static readonly DEFAULT_OPTIONS: WallIntersectionSplitPlannerOptions = {
    epsilon: 0.000001,
    endpointTolerance: 0.01,
    minimumSegmentLength: 0.05,
  };

  /** 去重拆分参数时使用的默认容差。 */
  private static readonly PARAMETER_DEDUPLICATE_EPSILON: number = 0.000001;

  /**
   * 为新直墙创建与已有直墙相交的打断计划。
   * 关键流程：遍历可安全拆分的已有直墙，计算中心线线段交点，并分别收集新墙和旧墙的有效拆分参数。
   * @param newWall - 待创建的新直墙。
   * @param existingObjects - 当前场景中的建筑对象快照。
   * @param options - 相交和拆分判定参数。
   * @returns 打断计划；无有效交点时返回空计划。
   */
  public static createPlan(
    newWall: StraightWallData,
    existingObjects: BuildingObject[],
    options: WallIntersectionSplitPlannerOptions = WallIntersectionSplitPlanner.DEFAULT_OPTIONS
  ): WallIntersectionSplitPlan {
    const newWallParameters: number[] = [];
    const existingWallPlanMap: Map<string, WallSplitTargetPlan> = new Map<string, WallSplitTargetPlan>();
    const newWallLength: number = Geometry2DUtils.distancePoint2D(newWall.start, newWall.end);
    if (newWallLength <= options.minimumSegmentLength) {
      return {
        newWallSplitParameters: [],
        existingWallPlans: [],
      };
    }

    for (const object of existingObjects) {
      if (!WallIntersectionSplitPlanner._canSplitExistingStraightWall(object, newWall.id)) {
        continue;
      }

      const existingWall: StraightWallData = object as StraightWallData;
      const intersection: SegmentIntersectionResult | null = Geometry2DUtils.intersectSegments(
        newWall.start,
        newWall.end,
        existingWall.start,
        existingWall.end,
        options.epsilon
      );
      if (intersection === null) {
        continue;
      }

      const existingWallLength: number = Geometry2DUtils.distancePoint2D(existingWall.start, existingWall.end);
      const shouldSplitNewWall: boolean = WallIntersectionSplitPlanner._canUseSplitParameter(
        intersection.tA,
        newWallLength,
        options
      );
      const shouldSplitExistingWall: boolean = WallIntersectionSplitPlanner._canUseSplitParameter(
        intersection.tB,
        existingWallLength,
        options
      );

      if (shouldSplitNewWall) {
        WallIntersectionSplitPlanner._pushUniqueParameter(newWallParameters, intersection.tA);
      }

      if (shouldSplitExistingWall) {
        let existingPlan: WallSplitTargetPlan | undefined = existingWallPlanMap.get(existingWall.id);
        if (existingPlan === undefined) {
          existingPlan = {
            originalWall: WallIntersectionSplitPlanner.cloneStraightWallData(existingWall),
            splitParameters: [],
          };
          existingWallPlanMap.set(existingWall.id, existingPlan);
        }
        WallIntersectionSplitPlanner._pushUniqueParameter(existingPlan.splitParameters, intersection.tB);
      }
    }

    WallIntersectionSplitPlanner._sortParameters(newWallParameters);
    const existingWallPlans: WallSplitTargetPlan[] = Array.from(existingWallPlanMap.values());
    for (const existingWallPlan of existingWallPlans) {
      WallIntersectionSplitPlanner._sortParameters(existingWallPlan.splitParameters);
    }

    return {
      newWallSplitParameters: newWallParameters,
      existingWallPlans: existingWallPlans,
    };
  }

  /**
   * 复制直墙数据快照。
   * @param wallData - 原始直墙数据。
   * @returns 深拷贝后的直墙数据。
   */
  public static cloneStraightWallData(wallData: StraightWallData): StraightWallData {
    return JSON.parse(JSON.stringify(wallData)) as StraightWallData;
  }

  /**
   * 判断已有对象是否允许作为打断目标。
   * @param object - 待检测建筑对象。
   * @param newWallId - 新墙 ID，用于排除自身。
   * @returns true 表示该对象是可安全打断的普通直墙。
   */
  private static _canSplitExistingStraightWall(object: BuildingObject, newWallId: string): boolean {
    if (object.id === newWallId || object.category !== 'wall' || object.subType !== 'straight') {
      return false;
    }

    const straightWall: StraightWallData = object as StraightWallData;
    const hasOpenings: boolean = Array.isArray(straightWall.openings) && straightWall.openings.length > 0;
    if (hasOpenings) {
      /* 带门窗洞口的墙体暂不参与自动打断，避免洞口定位参数在拆分后丢失或落入错误墙段。 */
      return false;
    }

    return true;
  }

  /**
   * 判断交点参数是否适合作为墙体拆分点。
   * @param parameter - 交点在线段上的归一化参数。
   * @param wallLength - 墙体中心线长度。
   * @param options - 相交和拆分判定参数。
   * @returns true 表示拆分后不会产生端点附近极短墙段。
   */
  private static _canUseSplitParameter(
    parameter: number,
    wallLength: number,
    options: WallIntersectionSplitPlannerOptions
  ): boolean {
    const distanceToStart: number = parameter * wallLength;
    const distanceToEnd: number = (1 - parameter) * wallLength;
    const minimumDistance: number = Math.max(options.endpointTolerance, options.minimumSegmentLength);
    return distanceToStart >= minimumDistance && distanceToEnd >= minimumDistance;
  }

  /**
   * 添加去重后的拆分参数。
   * @param parameters - 参数数组。
   * @param parameter - 待添加参数。
   */
  private static _pushUniqueParameter(parameters: number[], parameter: number): void {
    for (const existingParameter of parameters) {
      if (Math.abs(existingParameter - parameter) <= WallIntersectionSplitPlanner.PARAMETER_DEDUPLICATE_EPSILON) {
        return;
      }
    }

    parameters.push(parameter);
  }

  /**
   * 按从起点到终点顺序排序拆分参数。
   * @param parameters - 待排序参数数组。
   */
  private static _sortParameters(parameters: number[]): void {
    parameters.sort((left: number, right: number): number => left - right);
  }
}