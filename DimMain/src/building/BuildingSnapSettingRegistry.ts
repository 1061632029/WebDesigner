/**
 * 建筑对象捕获设置注册表
 * 统一维护当前项目已支持的建筑捕获内容，并提供默认状态与底层捕获类型映射能力。
 */

import type { PlanarPlacementSnapType } from './PlanarPlacementSnapTypes';
import type {
  BuildingSnapSettingDefinition,
  BuildingSnapSettingKey,
  BuildingSnapSettingState,
} from './BuildingSnapSettingTypes';

/** 当前项目支持的建筑对象捕获设置项。 */
export const BUILDING_SNAP_SETTING_DEFINITIONS: BuildingSnapSettingDefinition[] = [
  {
    key: 'endpoint',
    label: '端点',
    description: '捕获墙、梁等线式建筑对象的起点与终点。',
    snapTypes: ['endpoint'],
    defaultEnabled: true,
  },
  {
    key: 'line',
    label: '线',
    description: '捕获墙、梁中心延长线以及端点法向线。',
    snapTypes: ['extension-line', 'endpoint-normal-line'],
    defaultEnabled: true,
  },
  {
    key: 'midpoint',
    label: '中点',
    description: '捕获墙、梁等线式建筑对象的中点。',
    snapTypes: ['midpoint'],
    defaultEnabled: true,
  },
  {
    key: 'center',
    label: '中心点',
    description: '捕获弧形墙圆心与圆形柱中心点。',
    snapTypes: ['arc-center', 'circle-center'],
    defaultEnabled: true,
  },
  {
    key: 'intersection',
    label: '交点',
    description: '捕获两条建筑辅助捕获线形成的交点。',
    snapTypes: ['line-intersection'],
    defaultEnabled: true,
  },
  {
    key: 'orthogonal',
    label: '正交',
    description: '绘制第二点时捕获水平或垂直正交方向。',
    snapTypes: ['orthogonal'],
    defaultEnabled: true,
  },
];

/** 建筑捕获设置项顺序。 */
export const BUILDING_SNAP_SETTING_KEYS: BuildingSnapSettingKey[] = BUILDING_SNAP_SETTING_DEFINITIONS.map(
  (definition: BuildingSnapSettingDefinition): BuildingSnapSettingKey => definition.key
);

/**
 * 创建默认建筑捕获设置状态。
 * @returns 所有已注册捕获项的默认启用状态
 */
export function createDefaultBuildingSnapSettingState(): BuildingSnapSettingState {
  const state: Partial<BuildingSnapSettingState> = {};

  for (const definition of BUILDING_SNAP_SETTING_DEFINITIONS) {
    state[definition.key] = definition.defaultEnabled;
  }

  return state as BuildingSnapSettingState;
}

/**
 * 判断底层捕获类型是否启用。
 * @param state - 当前建筑捕获设置状态
 * @param snapType - 底层捕获类型
 * @returns 捕获类型启用时返回 true
 */
export function isBuildingSnapTypeEnabled(state: BuildingSnapSettingState, snapType: PlanarPlacementSnapType): boolean {
  if (snapType === 'none') {
    return false;
  }

  for (const definition of BUILDING_SNAP_SETTING_DEFINITIONS) {
    if (!definition.snapTypes.includes(snapType)) {
      continue;
    }
    return state[definition.key];
  }

  return true;
}