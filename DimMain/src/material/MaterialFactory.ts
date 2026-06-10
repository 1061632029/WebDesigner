import * as THREE from 'three/webgpu';

/**
 * STL 模型颜色常量（素描灰阶风格）
 * 家具/门窗等 STL 模型使用中灰色，与建筑构件形成层次区分
 * 对应图片中家具的中灰色调
 */
export const WHITE_MODEL_COLOR: number = 0xc8c8c8;

/**
 * 标准材质配置选项接口
 */
export interface StandardMaterialOptions {
  /** 材质颜色，默认 0xffffff */
  color?: number;
  /** 金属度（0-1），默认 0.0 */
  metalness?: number;
  /** 粗糙度（0-1），默认 0.5 */
  roughness?: number;
  /** 是否透明，默认 false */
  transparent?: boolean;
  /** 透明度（0-1），默认 1.0 */
  opacity?: number;
}

/**
 * 基础材质配置选项接口
 */
export interface BasicMaterialOptions {
  /** 材质颜色，默认 0xffffff */
  color?: number;
  /** 是否透明，默认 false */
  transparent?: boolean;
  /** 透明度（0-1），默认 1.0 */
  opacity?: number;
}

/**
 * 物理材质配置选项接口
 */
export interface PhysicalMaterialOptions {
  /** 材质颜色，默认 0xffffff */
  color?: number;
  /** 金属度（0-1），默认 0.0 */
  metalness?: number;
  /** 粗糙度（0-1），默认 0.5 */
  roughness?: number;
  /** 清漆层强度（0-1），默认 0.0 */
  clearcoat?: number;
  /** 透射率（0-1），默认 0.0 */
  transmission?: number;
  /** 是否透明，默认 false */
  transparent?: boolean;
  /** 透明度（0-1），默认 1.0 */
  opacity?: number;
}

/**
 * 材质工厂类
 * 提供 Three.js WebGPU 兼容材质的创建方法
 * 注意：Three.js r160+ 的 WebGPURenderer 可以直接使用标准材质类
 */
export class MaterialFactory {
  /**
   * 创建标准 PBR 材质（MeshStandardMaterial）
   * WebGPURenderer 会自动将其转换为节点材质
   * @param options - 材质配置选项
   * @returns MeshStandardMaterial 实例
   */
  public static createStandard(options?: StandardMaterialOptions): THREE.MeshStandardMaterial {
    const color: number = options?.color ?? 0xffffff;
    const metalness: number = options?.metalness ?? 0.0;
    const roughness: number = options?.roughness ?? 0.5;
    const transparent: boolean = options?.transparent ?? false;
    const opacity: number = options?.opacity ?? 1.0;

    const material: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
      color: color,
      metalness: metalness,
      roughness: roughness,
      transparent: transparent,
      opacity: opacity,
    });

    return material;
  }

  /**
   * 创建基础材质（MeshBasicMaterial），不受光照影响
   * @param options - 材质配置选项
   * @returns MeshBasicMaterial 实例
   */
  public static createBasic(options?: BasicMaterialOptions): THREE.MeshBasicMaterial {
    const color: number = options?.color ?? 0xffffff;
    const transparent: boolean = options?.transparent ?? false;
    const opacity: number = options?.opacity ?? 1.0;

    const material: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: transparent,
      opacity: opacity,
    });

    return material;
  }

  /**
   * 创建物理材质（MeshPhysicalMaterial），支持清漆、透射等高级 PBR 属性
   * @param options - 材质配置选项
   * @returns MeshPhysicalMaterial 实例
   */
  public static createPhysical(options?: PhysicalMaterialOptions): THREE.MeshPhysicalMaterial {
    const color: number = options?.color ?? 0xffffff;
    const metalness: number = options?.metalness ?? 0.0;
    const roughness: number = options?.roughness ?? 0.5;
    const clearcoat: number = options?.clearcoat ?? 0.0;
    const transmission: number = options?.transmission ?? 0.0;
    const transparent: boolean = options?.transparent ?? false;
    const opacity: number = options?.opacity ?? 1.0;

    const material: THREE.MeshPhysicalMaterial = new THREE.MeshPhysicalMaterial({
      color: color,
      metalness: metalness,
      roughness: roughness,
      clearcoat: clearcoat,
      transmission: transmission,
      transparent: transparent,
      opacity: opacity,
    });

    return material;
  }
}
