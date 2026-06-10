/**
 * 平面线式布置捕获类型定义
 * 统一描述墙、梁等 XZ 平面构件布置时的点捕获、线捕获和正交约束结果。
 */

import type { Point2D } from './BuildingTypes';

/** 平面布置捕获类型 */
export type PlanarPlacementSnapType =
  | 'none'
  | 'endpoint'
  | 'midpoint'
  | 'arc-center'
  | 'circle-center'
  | 'extension-line'
  | 'endpoint-normal-line'
  | 'orthogonal';

/** 平面布置点捕获目标 */
export interface PlanarPlacementPointTarget {
  /** 捕获目标类型 */
  type: 'endpoint' | 'midpoint' | 'arc-center' | 'circle-center';
  /** 目标点坐标 */
  position: Point2D;
  /** 来源对象 ID */
  objectId: string;
}

/** 平面布置线捕获目标 */
export interface PlanarPlacementLineTarget {
  /** 捕获目标类型 */
  type: 'extension-line' | 'endpoint-normal-line';
  /** 来源对象 ID */
  objectId: string;
  /** 线目标起点 */
  start: Point2D;
  /** 线目标终点 */
  end: Point2D;
}

/** 捕获辅助虚线线段 */
export interface PlanarPlacementGuideLine {
  /** 虚线起点 */
  start: Point2D;
  /** 虚线终点 */
  end: Point2D;
}

/** 平面布置捕获结果 */
export interface PlanarPlacementSnapResult {
  /** 是否发生捕获 */
  snapped: boolean;
  /** 捕获类型 */
  type: PlanarPlacementSnapType;
  /** 捕获后的点；未捕获时为原始点 */
  position: Point2D;
  /** 来源对象 ID；正交或无捕获时为 null */
  objectId: string | null;
  /** 辅助虚线；点捕获或无捕获时为 null */
  guideLine: PlanarPlacementGuideLine | null;
  /** 多条辅助虚线；第一条为当前捕获点对应的主预览线，其余为附加参考线 */
  guideLines: PlanarPlacementGuideLine[];
}