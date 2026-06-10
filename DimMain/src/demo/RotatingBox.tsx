import React, { useRef } from 'react';
import * as THREE from 'three/webgpu';
import { Mesh, MeshProps } from '../react/components/Mesh';
import { useFrame } from '../react/hooks/useFrame';

/**
 * 旋转立方体组件属性接口
 */
export interface RotatingBoxProps extends MeshProps {
  /** Y 轴旋转速度（弧度/秒），默认 1.0 */
  rotationSpeed?: number;
}

/**
 * 旋转立方体组件
 * 展示 useFrame 帧回调能力，立方体绕 Y 轴持续旋转
 */
export function RotatingBox(props: RotatingBoxProps): React.ReactElement {
  const meshRef: React.MutableRefObject<THREE.Mesh | null> = useRef<THREE.Mesh | null>(null);
  const rotationSpeed: number = props.rotationSpeed ?? 1.0;

  /* 注册帧回调，每帧更新立方体旋转角度 */
  useFrame((deltaTime: number): void => {
    if (meshRef.current) {
      meshRef.current.rotation.y += rotationSpeed * deltaTime;
    }
  });

  /**
   * Mesh 创建后保存引用，用于帧回调中访问
   */
  const handleCreated = (mesh: THREE.Mesh): void => {
    meshRef.current = mesh;
    if (props.onCreated) {
      props.onCreated(mesh);
    }
  };

  return (
    <Mesh
      geometry={props.geometry ?? 'box'}
      material={props.material ?? 'standard'}
      position={props.position}
      rotation={props.rotation}
      scale={props.scale}
      color={props.color}
      metalness={props.metalness}
      roughness={props.roughness}
      onCreated={handleCreated}
    />
  );
}
