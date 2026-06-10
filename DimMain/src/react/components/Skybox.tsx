/**
 * 程序化渐变天空背景组件（WebGPU 兼容版）
 * 使用 Canvas 2D 生成垂直渐变纹理，直接设为 scene.background
 * 不使用球体 Mesh，避免任何材质兼容性问题
 * 顶部浅蓝 → 地平线白色 → 底部浅灰，适合建筑/室内设计场景
 */

import { useEffect } from 'react';
import * as THREE from 'three/webgpu';
import { useEngine } from '../hooks/useEngine';
import type { Engine } from '../../core/Engine';

/**
 * Skybox 可配置属性
 */
export interface SkyboxProps {
  /** 天空顶部颜色（默认浅蓝 #87CEEB） */
  topColor?: string;
  /** 地平线颜色（默认白色 #FFFFFF） */
  horizonColor?: string;
  /** 地面颜色（默认浅灰 #D0D0D0） */
  bottomColor?: string;
}

/**
 * 程序化生成垂直渐变纹理
 * 在 Canvas 上从顶部到底部绘制三色渐变（顶部色 → 地平线色 → 底部色）
 * @param topColor - 顶部颜色
 * @param horizonColor - 地平线颜色
 * @param bottomColor - 底部颜色
 * @returns Three.js CanvasTexture
 */
function createGradientTexture(
  topColor: string,
  horizonColor: string,
  bottomColor: string
): THREE.CanvasTexture {
  /** 纹理宽度（仅需极窄，因为是纯垂直渐变） */
  const canvasWidth: number = 2;
  /** 纹理高度（足够提供平滑渐变） */
  const canvasHeight: number = 512;

  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d');
  if (ctx === null) {
    /* fallback：如果无法获取 2D 上下文，返回空白纹理 */
    return new THREE.CanvasTexture(canvas);
  }

  /* 创建从顶到底的线性渐变 */
  const gradient: CanvasGradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);

  /* 顶部颜色 */
  gradient.addColorStop(0.0, topColor);
  /* 上半部分过渡到地平线 */
  gradient.addColorStop(0.4, horizonColor);
  /* 地平线区域（较宽过渡带） */
  gradient.addColorStop(0.5, horizonColor);
  /* 下半部分过渡到底部颜色 */
  gradient.addColorStop(0.6, horizonColor);
  /* 底部颜色 */
  gradient.addColorStop(1.0, bottomColor);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  const texture: THREE.CanvasTexture = new THREE.CanvasTexture(canvas);
  /* 使用线性插值获得平滑渐变 */
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  /* 钳位防止接缝 */
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  /* 标记为需要更新 */
  texture.needsUpdate = true;

  return texture;
}

/**
 * 天空背景组件
 * 将渐变纹理直接设置为 scene.background（WebGPU 完全兼容）
 * 组件卸载时恢复为 null
 */
export function Skybox(props: SkyboxProps): null {
  const engine: Engine = useEngine();

  const topColor: string = props.topColor ?? '#87CEEB';
  const horizonColor: string = props.horizonColor ?? '#FFFFFF';
  const bottomColor: string = props.bottomColor ?? '#D0D0D0';

  useEffect((): (() => void) => {
    /* 生成渐变纹理 */
    const texture: THREE.CanvasTexture = createGradientTexture(topColor, horizonColor, bottomColor);

    /* 直接设置为场景背景 */
    const scene: THREE.Scene = engine.sceneManager.getScene();
    const previousBackground: THREE.Scene['background'] = scene.background;
    scene.background = texture;

    /* 清理函数：恢复之前的背景并释放纹理 */
    return (): void => {
      scene.background = previousBackground;
      texture.dispose();
    };
  }, [engine, topColor, horizonColor, bottomColor]);

  return null;
}
