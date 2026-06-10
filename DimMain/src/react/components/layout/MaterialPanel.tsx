/**
 * 材质面板组件
 * 显示纹理预设的缩略图+名称列表
 * 支持长按拖拽到 3D 视口应用纹理
 */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useTextureDrag } from '../../context/TextureDragContext';
import type { TexturePreset } from '../../../material/TexturePresets';
import { DEFAULT_TEXTURE_PRESETS } from '../../../material/TexturePresets';

/* ========== 样式常量 ========== */

/** 纹理列表容器样式 */
const textureListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '0 8px 8px 8px',
};

/** 单个纹理卡片行样式 */
const textureCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid #e0e0e0',
  backgroundColor: '#fff',
  cursor: 'grab',
  userSelect: 'none',
  transition: 'background-color 0.15s',
};

/** 纹理缩略图样式 */
const thumbnailStyle: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 4,
  objectFit: 'cover',
  flexShrink: 0,
  backgroundColor: '#f0f0f0',
  border: '1px solid #ddd',
};

/** 纹理名称样式 */
const textureNameStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#333',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** 纹理分类标签样式 */
const categoryTagStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#999',
  marginTop: 2,
};

/** 拖拽浮层样式（跟随鼠标） */
const dragOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: 9999,
  width: 56,
  height: 56,
  borderRadius: 6,
  border: '2px solid #4488ff',
  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  opacity: 0.85,
  objectFit: 'cover',
};

/* ========== 长按阈值 ========== */
const LONG_PRESS_DELAY: number = 200;

/* ========== 组件 ========== */

/**
 * 单个纹理卡片组件
 */
interface TextureCardProps {
  preset: TexturePreset;
}

function TextureCard(props: TextureCardProps): React.ReactElement {
  const { preset } = props;
  const { startDrag } = useTextureDrag();
  const pressTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  /**
   * 鼠标按下 → 启动长按计时器
   */
  const handleMouseDown: (e: React.MouseEvent) => void = useCallback(
    (e: React.MouseEvent): void => {
      /* 仅左键 */
      if (e.button !== 0) return;

      /* 阻止默认行为，避免文本选择等干扰 */
      e.preventDefault();

      isDraggingRef.current = false;

      pressTimerRef.current = setTimeout((): void => {
        isDraggingRef.current = true;
        startDrag(preset);
      }, LONG_PRESS_DELAY);
    },
    [preset, startDrag]
  );

  /**
   * 鼠标抬起 → 清除计时器（仅在拖拽未开始时）
   * 如果拖拽已开始，由 DragOverlay 的 window mouseup 处理
   */
  const handleMouseUp: () => void = useCallback((): void => {
    if (!isDraggingRef.current && pressTimerRef.current !== null) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);

  /**
   * 鼠标离开 → 清除计时器（仅在拖拽未开始时）
   * 如果拖拽已开始，允许鼠标离开卡片继续拖拽
   */
  const handleMouseLeave: () => void = useCallback((): void => {
    if (!isDraggingRef.current && pressTimerRef.current !== null) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);

  return (
    <div
      style={textureCardStyle}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      title={`${preset.name} - 长按拖拽到物体表面`}
    >
      <img
        src={preset.thumbnailUrl}
        alt={preset.name}
        style={thumbnailStyle}
        draggable={false}
        onError={(e: React.SyntheticEvent<HTMLImageElement>): void => {
          /* 缩略图加载失败时显示占位色块 */
          const target: HTMLImageElement = e.currentTarget;
          target.style.display = 'none';
        }}
      />
      <div>
        <div style={textureNameStyle}>{preset.name}</div>
        <div style={categoryTagStyle}>{preset.category}</div>
      </div>
    </div>
  );
}

/**
 * 拖拽浮层组件
 * 在拖拽状态下跟随鼠标移动
 */
function DragOverlay(): React.ReactElement | null {
  const { state, endDrag, applyTextureRef } = useTextureDrag();
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  /**
   * 用 ref 保存最新的 draggingPreset，避免 mouseUp 闭包引用过时值
   */
  const draggingPresetRef: React.MutableRefObject<TexturePreset | null> = useRef<TexturePreset | null>(null);
  draggingPresetRef.current = state.draggingPreset;

  useEffect((): (() => void) | undefined => {
    if (!state.isDragging || state.draggingPreset === null) {
      return undefined;
    }

    /** 鼠标移动时更新浮层位置 */
    const handleMouseMove = (e: MouseEvent): void => {
      setPosition({ x: e.clientX + 12, y: e.clientY + 12 });
    };

    /** 鼠标松开时尝试应用纹理（通过 ref 读取最新值） */
    const handleMouseUp = (e: MouseEvent): void => {
      const preset: TexturePreset | null = draggingPresetRef.current;
      if (preset !== null && applyTextureRef.current !== null) {
        applyTextureRef.current(e.clientX, e.clientY, preset);
      }
      endDrag();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return (): void => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [state.isDragging, state.draggingPreset, endDrag, applyTextureRef]);

  if (!state.isDragging || state.draggingPreset === null) {
    return null;
  }

  return (
    <img
      src={state.draggingPreset.thumbnailUrl}
      alt={state.draggingPreset.name}
      style={{
        ...dragOverlayStyle,
        left: position.x,
        top: position.y,
      }}
      draggable={false}
    />
  );
}

/**
 * 材质面板主组件
 * 展示纹理预设列表，支持长按拖拽
 */
export function MaterialPanel(): React.ReactElement {
  return (
    <>
      <div style={textureListStyle}>
        {DEFAULT_TEXTURE_PRESETS.map((preset: TexturePreset) => (
          <TextureCard key={preset.id} preset={preset} />
        ))}
      </div>
      <DragOverlay />
    </>
  );
}
