/**
 * 建筑对象捕获设置类型定义
 * 统一描述顶部捕获选择面板、React 上下文和建筑捕获服务之间共享的配置结构。
 */

import type { PlanarPlacementSnapType } from './PlanarPlacementSnapTypes';

/** 建筑捕获设置项键名，面向 UI 与统一配置管理。 */
export type BuildingSnapSettingKey = 'endpoint' | 'line' | 'midpoint' | 'center' | 'intersection' | 'orthogonal';

/**
 * 建筑捕获设置项定义。
 * 后续扩展捕获类型时，只需新增定义并映射到底层 PlanarPlacementSnapType。
 */
export interface BuildingSnapSettingDefinition {
  /** 设置项键名 */
  key: BuildingSnapSettingKey;
  /** 面板展示名称 */
  label: string;
  /** 帮助提示文本 */
  description: string;
  /** 当前设置项控制的底层捕获类型列表 */
  snapTypes: PlanarPlacementSnapType[];
  /** 默认是否启用 */
  defaultEnabled: boolean;
}

/** 建筑捕获设置状态。 */
export type BuildingSnapSettingState = Record<BuildingSnapSettingKey, boolean>;

/** 建筑捕获类型启用状态读取函数。 */
export type BuildingSnapTypeEnabledReader = (snapType: PlanarPlacementSnapType) => boolean;