/**
 * 建筑捕获设置上下文
 * 负责统一管理顶部“捕获选择”弹窗勾选状态，并为绘制/布置捕获服务提供启用判断。
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { PlanarPlacementSnapType } from '../../building/PlanarPlacementSnapTypes';
import {
  createDefaultBuildingSnapSettingState,
  isBuildingSnapTypeEnabled,
} from '../../building/BuildingSnapSettingRegistry';
import type { BuildingSnapSettingKey, BuildingSnapSettingState } from '../../building/BuildingSnapSettingTypes';

/** 建筑捕获设置上下文值。 */
export interface BuildingSnapSettingsContextValue {
  /** 当前捕获设置状态 */
  settings: BuildingSnapSettingState;
  /**
   * 设置指定捕获项是否启用。
   * @param key - 捕获设置项键名
   * @param enabled - 是否启用
   */
  setSettingEnabled: (key: BuildingSnapSettingKey, enabled: boolean) => void;
  /**
   * 判断底层捕获类型是否启用。
   * @param snapType - 底层捕获类型
   * @returns 启用时返回 true
   */
  isSnapTypeEnabled: (snapType: PlanarPlacementSnapType) => boolean;
}

/** 建筑捕获设置 React Context。 */
const BuildingSnapSettingsContext: React.Context<BuildingSnapSettingsContextValue | null> =
  createContext<BuildingSnapSettingsContextValue | null>(null);

/**
 * 建筑捕获设置 Provider。
 * @param props - 组件属性
 * @returns Provider 组件
 */
export function BuildingSnapSettingsProvider(props: { children: React.ReactNode }): React.ReactElement {
  /** 捕获设置状态默认来自注册表，后续新增捕获类型时由注册表统一扩展。 */
  const [settings, setSettings] = useState<BuildingSnapSettingState>((): BuildingSnapSettingState =>
    createDefaultBuildingSnapSettingState()
  );

  /**
   * 更新单个捕获设置项。
   * @param key - 捕获设置项键名
   * @param enabled - 是否启用
   */
  const setSettingEnabled = useCallback((key: BuildingSnapSettingKey, enabled: boolean): void => {
    setSettings((currentSettings: BuildingSnapSettingState): BuildingSnapSettingState => ({
      ...currentSettings,
      [key]: enabled,
    }));
  }, []);

  /**
   * 根据当前设置判断底层捕获类型是否有效。
   * @param snapType - 底层捕获类型
   * @returns 启用时返回 true
   */
  const isSnapTypeEnabledCallback = useCallback(
    (snapType: PlanarPlacementSnapType): boolean => isBuildingSnapTypeEnabled(settings, snapType),
    [settings]
  );

  /** Context 值：通过 useMemo 保持引用稳定，减少无关组件重渲染。 */
  const contextValue: BuildingSnapSettingsContextValue = useMemo(
    (): BuildingSnapSettingsContextValue => ({
      settings: settings,
      setSettingEnabled: setSettingEnabled,
      isSnapTypeEnabled: isSnapTypeEnabledCallback,
    }),
    [settings, setSettingEnabled, isSnapTypeEnabledCallback]
  );

  return (
    <BuildingSnapSettingsContext.Provider value={contextValue}>
      {props.children}
    </BuildingSnapSettingsContext.Provider>
  );
}

/**
 * 获取建筑捕获设置上下文。
 * @returns 建筑捕获设置上下文值
 */
export function useBuildingSnapSettings(): BuildingSnapSettingsContextValue {
  const contextValue: BuildingSnapSettingsContextValue | null = useContext(BuildingSnapSettingsContext);
  if (contextValue === null) {
    throw new Error('useBuildingSnapSettings 必须在 BuildingSnapSettingsProvider 内部使用');
  }
  return contextValue;
}