/**
 * 场景纯色背景组件
 * 用于需要稳定纯色背景的视图模式，避免纹理背景在特定相机/渲染后端下产生采样伪影。
 */

import { useEffect } from 'react';
import * as THREE from 'three/webgpu';
import { useEngine } from '../hooks/useEngine';
import type { Engine } from '../../core/Engine';

/**
 * 场景纯色背景组件属性
 */
export interface SceneSolidBackgroundProps {
  /** 背景颜色，支持 Three.js ColorRepresentation 格式 */
  color: THREE.ColorRepresentation;
}

/**
 * 场景纯色背景组件
 * 挂载时将 scene.background 设置为指定纯色，卸载时恢复进入组件前的背景。
 * @param props - 组件属性
 * @returns 不渲染 React DOM，仅修改 Three.js 场景背景
 */
export function SceneSolidBackground(props: SceneSolidBackgroundProps): null {
  const engine: Engine = useEngine();
  const color: THREE.ColorRepresentation = props.color;

  useEffect((): (() => void) => {
    const scene: THREE.Scene = engine.sceneManager.getScene();
    const previousBackground: THREE.Scene['background'] = scene.background;
    const backgroundColor: THREE.Color = new THREE.Color(color);

    /* 2D 视图使用纯色背景，避免天空盒渐变纹理被正交俯视相机采样成圆形亮斑。 */
    scene.background = backgroundColor;

    return (): void => {
      /* 组件卸载或视图切换时恢复旧背景，确保 3D 天空盒可以正常接管。 */
      scene.background = previousBackground;
    };
  }, [engine, color]);

  return null;
}