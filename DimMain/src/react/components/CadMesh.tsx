/**
 * CadMesh 组件
 * 使用 OpenCascade WASM 创建 CAD 几何体并添加到 Three.js 场景
 */

import React, { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three/webgpu';
import { useEngine } from '../hooks/useEngine';
import { useOcct } from '../hooks/useOcct';
import { OcctShapeBuilder } from '../../cad/OcctShapeBuilder';
import { OcctBooleanOps } from '../../cad/OcctBooleanOps';
import { OcctMeshConverter } from '../../cad/OcctMeshConverter';
import type { OpenCascadeInstance } from '../../cad/OcctTypes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** CAD 几何体类型 */
export type CadShapeType = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'fillet-box' | 'boolean-demo';

/**
 * CadMesh 组件属性
 */
export interface CadMeshProps {
  /** 几何体类型 */
  shapeType: CadShapeType;
  /** 位置 */
  position?: [number, number, number];
  /** 材质颜色 */
  color?: number;
  /** 三角化精度 */
  deflection?: number;
}

/**
 * 根据类型创建 OCCT Shape
 * @param shapeType - 几何体类型
 * @param oc - OCCT 实例
 * @returns OCCT Shape
 */
function createShape(shapeType: CadShapeType, oc: OpenCascadeInstance): any {
  const builder: OcctShapeBuilder = new OcctShapeBuilder(oc);
  const boolOps: OcctBooleanOps = new OcctBooleanOps(oc);

  switch (shapeType) {
    case 'box':
      return builder.makeBox(1, 1, 1);

    case 'sphere':
      return builder.makeSphere(0.5);

    case 'cylinder':
      return builder.makeCylinder(0.4, 1.2);

    case 'cone':
      return builder.makeCone(0.5, 0.1, 1);

    case 'torus':
      return builder.makeTorus(0.5, 0.15);

    case 'fillet-box': {
      /* 带圆角的立方体 */
      const box: any = builder.makeBox(1, 1, 1);
      return builder.makeFillet(box, 0.1);
    }

    case 'boolean-demo': {
      /* 布尔运算演示：立方体减去球体 */
      const baseBox: any = builder.makeBox(1, 1, 1);
      const cutSphere: any = builder.makeSphere(0.65);
      return boolOps.cut(baseBox, cutSphere);
    }

    default:
      return builder.makeBox(1, 1, 1);
  }
}

/**
 * CadMesh 组件
 * 使用 OCCT 创建精确几何体并渲染为 Three.js Mesh
 */
export function CadMesh(props: CadMeshProps): React.ReactElement | null {
  const engine = useEngine();
  const { oc, status } = useOcct();
  const meshRef: React.MutableRefObject<THREE.Mesh | null> = useRef<THREE.Mesh | null>(null);

  /** 默认属性 */
  const position: [number, number, number] = props.position ?? [0, 0, 0];
  const color: number = props.color ?? 0x4488aa;
  const deflection: number = props.deflection ?? 0.05;

  /**
   * 缓存材质避免重复创建
   */
  const material: THREE.MeshStandardMaterial = useMemo((): THREE.MeshStandardMaterial => {
    return new THREE.MeshStandardMaterial({
      color: color,
      metalness: 0.3,
      roughness: 0.5,
      side: THREE.DoubleSide,
    });
  }, [color]);

  /**
   * OCCT 加载完成后创建几何体并加入场景
   */
  useEffect((): (() => void) => {
    if (oc === null || engine === null) {
      return (): void => {};
    }

    try {
      /* 创建 OCCT Shape */
      const shape: any = createShape(props.shapeType, oc);

      /* 转换为 Three.js Mesh */
      const converter: OcctMeshConverter = new OcctMeshConverter(oc);
      const mesh: THREE.Mesh = converter.shapeToMesh(shape, material, deflection);

      /* 设置位置 */
      mesh.position.set(position[0], position[1], position[2]);

      /* 添加到场景 */
      const scene: THREE.Scene = engine.sceneManager.getScene();
      scene.add(mesh);
      meshRef.current = mesh;

      const posAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined =
        mesh.geometry.getAttribute('position');
      const vertexCount: number = posAttr ? posAttr.count : 0;
      console.log(`[CadMesh] 创建 ${props.shapeType} 成功，顶点数: ${vertexCount}`);
    } catch (err: unknown) {
      console.error(`[CadMesh] 创建 ${props.shapeType} 失败:`, err);
    }

    /* 组件卸载时从场景移除 */
    return (): void => {
      if (meshRef.current !== null && engine !== null) {
        const scene: THREE.Scene = engine.sceneManager.getScene();
        scene.remove(meshRef.current);
        meshRef.current.geometry.dispose();
        meshRef.current = null;
      }
    };
  }, [oc, engine, props.shapeType, deflection]);

  /* WASM 加载中 / 出错时的提示 */
  if (status === 'loading') {
    return null; /* 加载中不渲染 */
  }

  if (status === 'error') {
    return null; /* 出错不渲染 */
  }

  /* 该组件不产生 DOM 输出 — 直接操作 Three.js 场景 */
  return null;
}
