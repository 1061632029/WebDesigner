/**
 * 建筑捕获选择按钮与弹窗
 * 在顶部工具栏提供当前项目已支持捕获内容的统一开关入口。
 */

import React, { useEffect, useRef, useState } from 'react';
import { BUILDING_SNAP_SETTING_DEFINITIONS } from '../../../building/BuildingSnapSettingRegistry';
import type { BuildingSnapSettingDefinition } from '../../../building/BuildingSnapSettingTypes';
import { useBuildingSnapSettings } from '../../context/BuildingSnapSettingsContext';
import type { BuildingSnapSettingsContextValue } from '../../context/BuildingSnapSettingsContext';
import { toolbarButtonStyle } from './LayoutStyles';

/** 捕获选择外层容器样式。 */
const snapSelectorWrapStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
};

/** 捕获弹窗样式，模拟参考图中的白底纵向勾选列表。 */
const snapPopoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: 44,
  right: 0,
  width: 184,
  borderRadius: 8,
  backgroundColor: '#ffffff',
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.18)',
  overflow: 'hidden',
  zIndex: 3000,
  color: '#222222',
};

/** 捕获弹窗标题样式。 */
const snapPopoverTitleStyle: React.CSSProperties = {
  padding: '12px 18px 10px',
  color: '#9a9a9a',
  fontSize: 14,
  borderBottom: '1px solid #f2f2f2',
};

/** 捕获项行样式。 */
const snapItemStyle: React.CSSProperties = {
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 18px',
  border: 'none',
  backgroundColor: '#ffffff',
  color: '#333333',
  cursor: 'pointer',
  fontSize: 14,
  width: '100%',
  textAlign: 'left',
};

/** 捕获说明图标样式。 */
const snapInfoIconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#d6d8dc',
  color: '#ffffff',
  fontSize: 11,
  fontWeight: 700,
};

/** 捕获弹窗底部设置行样式。 */
const snapFooterStyle: React.CSSProperties = {
  height: 48,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 18px',
  borderTop: '1px solid #eeeeee',
  backgroundColor: '#ffffff',
  fontSize: 14,
  color: '#333333',
};

/** 蓝色总开关样式。 */
const snapSwitchStyle: React.CSSProperties = {
  width: 52,
  height: 28,
  borderRadius: 14,
  border: 'none',
  backgroundColor: '#2088ff',
  position: 'relative',
  cursor: 'default',
};

/** 总开关圆点样式。 */
const snapSwitchThumbStyle: React.CSSProperties = {
  position: 'absolute',
  right: 3,
  top: 3,
  width: 22,
  height: 22,
  borderRadius: '50%',
  backgroundColor: '#ffffff',
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.22)',
};

/**
 * 顶部工具栏捕获选择组件。
 * @returns 捕获按钮和弹窗
 */
export function BuildingSnapSelector(): React.ReactElement {
  const snapSettings: BuildingSnapSettingsContextValue = useBuildingSnapSettings();
  const [open, setOpen] = useState<boolean>(false);
  const wrapRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);

  /** 点击外部关闭弹窗，避免面板长时间遮挡视口操作。 */
  useEffect((): (() => void) => {
    const handlePointerDown = (event: MouseEvent): void => {
      const currentElement: HTMLDivElement | null = wrapRef.current;
      if (currentElement === null || currentElement.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    return (): void => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  /** 是否至少启用一个捕获项，用于按钮高亮提示。 */
  const hasEnabledSetting: boolean = BUILDING_SNAP_SETTING_DEFINITIONS.some(
    (definition: BuildingSnapSettingDefinition): boolean => snapSettings.settings[definition.key]
  );

  /** 捕获按钮激活态样式。 */
  const buttonActiveStyle: React.CSSProperties = hasEnabledSetting
    ? {
        background: 'rgba(32, 136, 255, 0.14)',
        borderBottom: '2px solid #2088ff',
        color: '#2088ff',
      }
    : {};

  return (
    <div ref={wrapRef} style={snapSelectorWrapStyle}>
      <button
        style={{ ...toolbarButtonStyle, ...buttonActiveStyle }}
        onClick={(): void => setOpen((currentOpen: boolean): boolean => !currentOpen)}
        title="捕获选择"
        type="button"
      >
        <span style={{ fontSize: 16 }}>🎯</span>
        <span>捕获</span>
      </button>

      {open ? (
        <div style={snapPopoverStyle} role="dialog" aria-label="允许光标捕捉">
          <div style={snapPopoverTitleStyle}>允许光标捕捉</div>
          {BUILDING_SNAP_SETTING_DEFINITIONS.map((definition: BuildingSnapSettingDefinition): React.ReactElement => {
            const checked: boolean = snapSettings.settings[definition.key];

            /** 捕获项勾选流程：点击行即可切换对应类型是否参与捕获服务。 */
            return (
              <button
                key={definition.key}
                style={snapItemStyle}
                onClick={(): void => snapSettings.setSettingEnabled(definition.key, !checked)}
                title={definition.description}
                type="button"
              >
                <input
                  checked={checked}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>): void =>
                    snapSettings.setSettingEnabled(definition.key, event.target.checked)
                  }
                  style={{ width: 22, height: 22, accentColor: '#2088ff', pointerEvents: 'none' }}
                  type="checkbox"
                />
                <span style={{ flex: 1 }}>{definition.label}</span>
                <span style={snapInfoIconStyle}>?</span>
              </button>
            );
          })}
          <div style={snapFooterStyle}>
            <span>设置</span>
            <button style={snapSwitchStyle} title="捕获设置总开关（当前保持开启）" type="button">
              <span style={snapSwitchThumbStyle} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}