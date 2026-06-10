/**
 * 建筑衔接线类型定义
 * 用于描述楼板、天花板与墙体交界处需要强调显示的黑色粗线段
 */

import type { Point2D } from './BuildingTypes';

/** 衔接线来源类型 */
export type BuildingConnectionLineSourceType = 'slab' | 'ceiling';

/** 衔接线空间朝向类型 */
export type BuildingConnectionLineOrientation = 'horizontal' | 'vertical';

/**
 * 建筑衔接线段数据
 * 渲染器会将每条线段转换为薄矩形 Mesh，避免浏览器忽略 LineBasicMaterial.linewidth
 */
export interface BuildingConnectionLineSegment {
  /** 衔接线唯一标识，用于稳定命名和调试 */
  id: string;
  /** 来源建筑对象 ID（楼板或天花板 ID） */
  sourceObjectId: string;
  /** 来源对象类型 */
  sourceType: BuildingConnectionLineSourceType;
  /** XZ 平面起点 */
  start: Point2D;
  /** XZ 平面终点 */
  end: Point2D;
  /** 衔接线所在世界高度 Y */
  y: number;
  /** 竖向衔接线起始高度，仅 orientation=vertical 时使用 */
  startY?: number;
  /** 竖向衔接线结束高度，仅 orientation=vertical 时使用 */
  endY?: number;
  /** 衔接线粗细（米），对应矩形 Mesh 的宽度 */
  width: number;
  /** 衔接线空间朝向：horizontal 为 XZ 水平线，vertical 为墙面竖向线 */
  orientation: BuildingConnectionLineOrientation;
  /** 竖向线贴附墙面的法线方向，仅 orientation=vertical 时使用 */
  normal?: Point2D;
}
