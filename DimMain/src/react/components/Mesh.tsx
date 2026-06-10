import React, { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { useEngine } from '../hooks/useEngine';
import { GeometryFactory } from '../../geometry/GeometryFactory';
import { MaterialFactory } from '../../material/MaterialFactory';

/**
 * 几何体类型枚举
 */
export type GeometryType = 'box' | 'sphere' | 'plane' | 'cylinder' | 'torus';

/**
 * 材质类型枚举
 */
export type MaterialType = 'standard' | 'basic' | 'physical';

/**
 * Mesh 组件属性接口
 */
export interface MeshProps {
  /** 几何体类型，默认 'box' */
  geometry?: GeometryType;
  /** 材质类型，默认 'standard' */
  material?: MaterialType;
  /** 位置 [x, y, z]，默认 [0, 0, 0] */
  position?: [number, number, number];
  /** 旋转 [x, y, z]（弧度），默认 [0, 0, 0] */
  rotation?: [number, number, number];
  /** 缩放 [x, y, z]，默认 [1, 1, 1] */
  scale?: [number, number, number];
  /** 材质颜色，默认 0xffffff */
  color?: number;
  /** 金属度（0-1），默认 0.0 */
  metalness?: number;
  /** 粗糙度（0-1），默认 0.5 */
  roughness?: number;
  /** 子组件 */
  children?: React.ReactNode;
  /** Mesh 创建后的回调，可用于获取 Three.js Mesh 引用 */
  onCreated?: (mesh: THREE.Mesh) => void;
}

/**
 * 根据几何体类型创建对应的 BufferGeometry
 */
function createGeometry(type: GeometryType): THREE.BufferGeometry {
  switch (type) {
    case 'box':
      return GeometryFactory.createBox();
    case 'sphere':
      return GeometryFactory.createSphere();
    case 'plane':
      return GeometryFactory.createPlane(10, 10);
    case 'cylinder':
      return GeometryFactory.createCylinder();
    case 'torus':
      return GeometryFactory.createTorus();
    default:
      return GeometryFactory.createBox();
  }
}

/**
 * 根据材质类型和配置创建对应的 Material
 */
function createMaterial(
  type: MaterialType,
  color: number,
  metalness: number,
  roughness: number
): THREE.Material {
  switch (type) {
    case 'standard':
      return MaterialFactory.createStandard({ color, metalness, roughness });
    case 'basic':
      return MaterialFactory.createBasic({ color });
    case 'physical':
      return MaterialFactory.createPhysical({ color, metalness, roughness });
    default:
      return MaterialFactory.createStandard({ color, metalness, roughness });
  }
}

/**
 * Mesh 网格组件
 * 声明式创建 Three.js Mesh 对象，支持几何体/材质/变换属性
 */
export function Mesh(props: MeshProps): React.ReactElement | null {
  const engine = useEngine();
  const meshRef: React.MutableRefObject<THREE.Mesh | null> = useRef<THREE.Mesh | null>(null);

  const geometryType: GeometryType = props.geometry ?? 'box';
  const materialType: MaterialType = props.material ?? 'standard';
  const color: number = props.color ?? 0xffffff;
  const metalness: number = props.metalness ?? 0.0;
  const roughness: number = props.roughness ?? 0.5;

  /* 创建和销毁 Mesh */
  useEffect((): (() => void) => {
    const geometry: THREE.BufferGeometry = createGeometry(geometryType);
    const material: THREE.Material = createMaterial(materialType, color, metalness, roughness);
    const mesh: THREE.Mesh = new THREE.Mesh(geometry, material);

    meshRef.current = mesh;
    engine.sceneManager.add(mesh);

    if (props.onCreated) {
      props.onCreated(mesh);
    }

    /* 组件卸载时从场景中移除并释放资源 */
    return (): void => {
      engine.sceneManager.remove(mesh);
      geometry.dispose();
      material.dispose();
      meshRef.current = null;
    };
  }, [engine, geometryType, materialType, color, metalness, roughness]);

  /* 响应位置属性变更 */
  useEffect((): void => {
    if (meshRef.current && props.position) {
      meshRef.current.position.set(
        props.position[0],
        props.position[1],
        props.position[2]
      );
    }
  }, [props.position]);

  /* 响应旋转属性变更 */
  useEffect((): void => {
    if (meshRef.current && props.rotation) {
      meshRef.current.rotation.set(
        props.rotation[0],
        props.rotation[1],
        props.rotation[2]
      );
    }
  }, [props.rotation]);

  /* 响应缩放属性变更 */
  useEffect((): void => {
    if (meshRef.current && props.scale) {
      meshRef.current.scale.set(
        props.scale[0],
        props.scale[1],
        props.scale[2]
      );
    }
  }, [props.scale]);

  /* Mesh 组件不渲染 DOM，仅管理 Three.js 对象 */
  return null;
}
