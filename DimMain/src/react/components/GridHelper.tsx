/**
 * 布局网格辅助线组件
 * 在场景中添加 XZ 平面上的网格线，辅助空间定位
 * 支持主网格 + 细分网格双层结构
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { useEngine } from '../hooks/useEngine';
import type { Engine } from '../../core/Engine';

/**
 * GridHelper 可配置属性
 */
export interface GridHelperProps {
  /** 网格总尺寸（米，默认 20） */
  size?: number;
  /** 主网格分段数（默认 20，即 1 米间距） */
  divisions?: number;
  /** 主网格线颜色（默认深灰 0x888888） */
  color?: number;
  /** 主网格中心线颜色（默认中灰 0xaaaaaa） */
  centerColor?: number;
  /** 是否显示细分网格（默认 true） */
  showSubGrid?: boolean;
  /** 细分网格分段数（默认 200，即 0.1 米间距） */
  subDivisions?: number;
  /** 细分网格线颜色（默认浅灰 0x444444） */
  subColor?: number;
  /** Y 轴偏移位置（默认 0） */
  yOffset?: number;
}

/**
 * 布局网格辅助线
 * 在 XZ 平面上绘制双层网格（主网格 + 细分网格）
 */
export function GridHelper(props: GridHelperProps): null {
  const engine: Engine = useEngine();
  const groupRef: React.MutableRefObject<THREE.Group | null> = useRef<THREE.Group | null>(null);

  const size: number = props.size ?? 20;
  const divisions: number = props.divisions ?? 20;
  const color: number = props.color ?? 0x888888;
  const centerColor: number = props.centerColor ?? 0xaaaaaa;
  const showSubGrid: boolean = props.showSubGrid ?? true;
  const subDivisions: number = props.subDivisions ?? 200;
  const subColor: number = props.subColor ?? 0x444444;
  const yOffset: number = props.yOffset ?? 0;

  useEffect((): (() => void) => {
    const group: THREE.Group = new THREE.Group();
    group.name = '__grid_helper__';

    /* 细分网格（先添加，渲染在主网格下层） */
    if (showSubGrid) {
      const subGrid: THREE.GridHelper = new THREE.GridHelper(
        size,
        subDivisions,
        subColor,
        subColor
      );
      subGrid.position.y = yOffset - 0.001;
      /* 细分网格开启深度测试并略低于基准面，确保会被楼板等实体遮挡。 */
      const subMaterial: THREE.Material | THREE.Material[] = subGrid.material;
      if (subMaterial instanceof THREE.Material) {
        subMaterial.transparent = true;
        subMaterial.opacity = 0.3;
        subMaterial.depthTest = true;
        subMaterial.depthWrite = false;
      }
      group.add(subGrid);
    }

    /* 主网格 */
    const mainGrid: THREE.GridHelper = new THREE.GridHelper(
      size,
      divisions,
      centerColor,
      color
    );
    mainGrid.position.y = yOffset - 0.001;
    /* 主网格开启深度测试并略低于基准面，避免浮在楼板顶面之上。 */
    const mainMaterial: THREE.Material | THREE.Material[] = mainGrid.material;
    if (mainMaterial instanceof THREE.Material) {
      mainMaterial.transparent = true;
      mainMaterial.opacity = 0.6;
      mainMaterial.depthTest = true;
      mainMaterial.depthWrite = false;
    }
    group.add(mainGrid);

    /* 添加到场景 */
    engine.sceneManager.add(group);
    groupRef.current = group;

    /* 清理函数 */
    return (): void => {
      engine.sceneManager.remove(group);

      /* 释放网格资源 */
      group.traverse((child: THREE.Object3D): void => {
        if (child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });

      groupRef.current = null;
    };
  }, [engine, size, divisions, color, centerColor, showSubGrid, subDivisions, subColor, yOffset]);

  return null;
}
