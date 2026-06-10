/**
 * STL 模型面板组件
 * 显示 public/models/ 目录下的 STL 模型列表
 * 每个卡片显示预览缩略图 + 模型名称
 * 点击卡片激活点式布置模式
 */

import React, { useState, useEffect, useCallback } from 'react';
import { STL_MODEL_LIST } from '../../../model/StlModelRegistry';
import { generateStlThumbnail } from '../../../model/StlPreviewRenderer';
import { useStlPlaceBridge } from '../../context/StlPlaceContext';
import { useViewMode } from '../../context/ViewModeContext';
import type { StlModelDef } from '../../../model/StlModelRegistry';
import type { StlPlaceBridge } from '../../context/StlPlaceContext';
import type { ViewModeContextValue } from '../../context/ViewModeContext';

/**
 * STL 模型面板
 * 渲染 CAD 模型分组下的 STL 模型卡片网格
 */
export function StlModelPanel(): React.ReactElement {
  /** 缩略图状态：modelId → base64 DataURL */
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());

  /** 加载状态 */
  const [loading, setLoading] = useState<boolean>(true);

  /** 布置桥接 */
  const bridge: StlPlaceBridge = useStlPlaceBridge();
  /** 视图模式上下文：布置前强制切换到 2D */
  const { setViewMode }: ViewModeContextValue = useViewMode();

  /* 组件挂载时异步生成所有模型的缩略图 */
  useEffect((): (() => void) => {
    let cancelled: boolean = false;

    const loadThumbnails = async (): Promise<void> => {
      const newMap: Map<string, string> = new Map();

      for (const model of STL_MODEL_LIST) {
        if (cancelled) {
          return;
        }
        try {
          const dataUrl: string = await generateStlThumbnail(model.url);
          newMap.set(model.id, dataUrl);
        } catch (error: unknown) {
          console.warn(`缩略图生成失败: ${model.name}`, error);
        }
      }

      if (!cancelled) {
        setThumbnails(newMap);
        setLoading(false);
      }
    };

    loadThumbnails();

    /* 组件卸载时标记取消 */
    return (): void => {
      cancelled = true;
    };
  }, []);

  /**
   * 点击模型卡片：通过桥接激活点式布置
   * 布置前强制切换到 2D 俯视模式，确保模型在平面图环境下放置
   */
  const handleModelClick: (model: StlModelDef) => void = useCallback(
    (model: StlModelDef): void => {
      /* 强制切换到 2D 俯视模式 */
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
    <div>
      {/* 分组标题 */}
      <div style={groupTitleStyle}>CAD 模型</div>

      {/* 加载提示 */}
      {loading && (
        <div style={loadingStyle}>⏳ 正在生成预览...</div>
      )}

      {/* 模型卡片网格 */}
      <div style={gridStyle}>
        {STL_MODEL_LIST.map((model: StlModelDef): React.ReactElement => {
          const thumbUrl: string | undefined = thumbnails.get(model.id);

          return (
            <button
              key={model.id}
              style={cardStyle}
              onClick={(): void => handleModelClick(model)}
              title={`点击布置: ${model.name}`}
            >
              {/* 预览图区域 */}
              <div style={thumbContainerStyle}>
                {thumbUrl !== undefined ? (
                  <img
                    src={thumbUrl}
                    alt={model.name}
                    style={thumbImageStyle}
                    draggable={false}
                  />
                ) : (
                  /* 加载中使用 emoji 占位 */
                  <span style={emojiStyle}>{model.icon}</span>
                )}
              </div>

              {/* 模型名称 */}
              <span style={labelStyle}>{model.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ========== 样式定义 ========== */

/** 分组标题 */
const groupTitleStyle: React.CSSProperties = {
  color: '#8899aa',
  fontSize: 12,
  padding: '8px 0 4px',
  fontWeight: 'bold',
  letterSpacing: 1,
};

/** 加载提示 */
const loadingStyle: React.CSSProperties = {
  color: '#666',
  fontSize: 11,
  padding: '4px 0',
  textAlign: 'center',
};

/** 卡片网格 */
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 8,
  padding: '4px 0',
};

/** 卡片按钮 */
const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  padding: 6,
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 6,
  cursor: 'pointer',
  transition: 'background 0.15s, border-color 0.15s',
  color: '#ccc',
};

/** 缩略图容器 */
const thumbContainerStyle: React.CSSProperties = {
  width: 80,
  height: 80,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 4,
  overflow: 'hidden',
  background: 'rgba(0, 0, 0, 0.2)',
};

/** 缩略图图片 */
const thumbImageStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'contain',
};

/** Emoji 占位 */
const emojiStyle: React.CSSProperties = {
  fontSize: 36,
};

/** 模型名称标签 */
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#aaa',
  textAlign: 'center',
  lineHeight: 1.2,
};
