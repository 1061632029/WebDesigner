/**
 * 建筑材质工厂。
 * 负责把建筑领域材质配置转换为 Three.js 独立材质实例，避免对象之间共享材质导致视觉状态互相污染。
 */

import * as THREE from 'three/webgpu';
import type { MaterialProperties } from '../BuildingTypes';

/** 建筑材质工厂。 */
export class BuildingMaterialFactory {
  /**
   * 根据材质属性创建独立 Three.js 材质实例。
   * @param props - 建筑对象材质属性。
   * @returns 可直接挂载到 Mesh 的材质实例。
   */
  public static createMaterialFromProperties(props: MaterialProperties): THREE.Material {
    const isTransparent: boolean = props.opacity < 1.0;

    if (props.materialType === 'basic') {
      return new THREE.MeshBasicMaterial({
        color: props.color,
        opacity: props.opacity,
        transparent: isTransparent,
        side: THREE.DoubleSide,
      });
    }

    /* standard 和 physical 当前统一使用 MeshStandardMaterial，保留领域材质属性到渲染材质的单向转换。 */
    return new THREE.MeshStandardMaterial({
      color: props.color,
      metalness: props.metalness,
      roughness: props.roughness,
      opacity: props.opacity,
      transparent: isTransparent,
      side: THREE.DoubleSide,
    });
  }
}