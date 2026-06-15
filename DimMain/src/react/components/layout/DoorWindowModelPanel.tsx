/**
 * 门窗 STL 小图标面板组件
 * 将门窗类型 STL 模型以小图标形式放入“模型库 → 基础几何体”分组，避免渲染 STL 缩略图。
 */

import React, { useCallback } from 'react';
import { STL_MODEL_LIST } from '../../../model/StlModelRegistry';
import { resolveStlModelIconByName } from '../../../model/StlModelIconResolver';
import { useStlPlaceBridge } from '../../context/StlPlaceContext';
import { useViewMode } from '../../context/ViewModeContext';
import type { StlModelDef } from '../../../model/StlModelRegistry';
import type { StlPlaceBridge } from '../../context/StlPlaceContext';
import type { ViewModeContextValue } from '../../context/ViewModeContext';

/** 门窗 STL 模型列表：只展示门与窗类型，普通家具模型仍保留在 CAD 模型分组。 */
const DOOR_WINDOW_STL_MODEL_LIST: StlModelDef[] = STL_MODEL_LIST.filter(
  (model: StlModelDef): boolean => model.category === 'door' || model.category === 'window'
);

/**
 * 门窗 STL 小图标卡片列表
 * @returns 可直接放入基础几何体网格中的门窗按钮集合
 */
export function DoorWindowModelPanel(): React.ReactElement {
  /** STL 布置桥接：点击门窗小图标后复用原有 STL 点式布置流程。 */
  const bridge: StlPlaceBridge = useStlPlaceBridge();
  /** 视图模式上下文：布置前强制进入 2D 俯视，保证门窗贴墙放置行为稳定。 */
  const { setViewMode }: ViewModeContextValue = useViewMode();

  /**
   * 点击门窗模型卡片后激活 STL 布置模式。
   * @param model - 当前点击的门窗 STL 模型定义
   */
  const handleDoorWindowClick: (model: StlModelDef) => void = useCallback(
    (model: StlModelDef): void => {
      /* 门窗布置流程需要在 2D 俯视图下执行，以便吸附墙体并创建洞口。 */
      setViewMode('2d');

      if (bridge.activatePlaceRef.current !== null) {
        bridge.activatePlaceRef.current(model);
      } else {
        console.warn('STL 布置工具尚未就绪');
      }
    },
    [bridge, setViewMode]
  );

  return (
    <>
      {DOOR_WINDOW_STL_MODEL_LIST.map((model: StlModelDef): React.ReactElement => {
        const displayIcon: string = resolveStlModelIconByName(model.name, model.icon);

        return (
          <button
            key={model.id}
            style={doorWindowCardStyle}
            onClick={(): void => handleDoorWindowClick(model)}
            title={`点击布置: ${model.name}`}
          >
            {/* 门窗 STL 不渲染缩略图，仅按名称显示小图标。 */}
            <span style={doorWindowIconStyle}>{displayIcon}</span>
            <span style={doorWindowLabelStyle}>{model.name}</span>
          </button>
        );
      })}
    </>
  );
}

/** 门窗卡片按钮样式：保持与基础几何体卡片一致的布局和视觉层级。 */
const doorWindowCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  padding: '12px 8px',
  borderRadius: 8,
  border: '1px solid #e8e8e8',
  cursor: 'pointer',
  background: '#fafafa',
  transition: 'all 0.15s ease',
};

/** 门窗小图标样式。 */
const doorWindowIconStyle: React.CSSProperties = {
  fontSize: 28,
};

/** 门窗名称标签样式。 */
const doorWindowLabelStyle: React.CSSProperties = {
  fontSize: 12,
  textAlign: 'center',
  lineHeight: 1.2,
};