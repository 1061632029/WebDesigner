import * as THREE from 'three/webgpu';

/**
 * 环境光配置选项接口
 */
export interface AmbientLightOptions {
  /** 光源颜色，默认 0xffffff */
  color?: number;
  /** 光源强度，默认 0.5 */
  intensity?: number;
}

/**
 * 平行光配置选项接口
 */
export interface DirectionalLightOptions {
  /** 光源颜色，默认 0xffffff */
  color?: number;
  /** 光源强度，默认 1.0 */
  intensity?: number;
  /** 光源位置 [x, y, z]，默认 [5, 5, 5] */
  position?: [number, number, number];
}

/**
 * 点光源配置选项接口
 */
export interface PointLightOptions {
  /** 光源颜色，默认 0xffffff */
  color?: number;
  /** 光源强度，默认 1.0 */
  intensity?: number;
  /** 光照距离（0 表示无限远），默认 0 */
  distance?: number;
  /** 光照衰减系数，默认 2 */
  decay?: number;
  /** 光源位置 [x, y, z]，默认 [0, 5, 0] */
  position?: [number, number, number];
}

/**
 * 光照工厂类
 * 提供常用光源类型的创建方法，封装 Three.js 内置光源类
 */
export class LightFactory {
  /**
   * 创建环境光（均匀照亮场景中所有物体）
   * @param options - 环境光配置选项
   * @returns AmbientLight 实例
   */
  public static createAmbientLight(options?: AmbientLightOptions): THREE.AmbientLight {
    const color: number = options?.color ?? 0xffffff;
    const intensity: number = options?.intensity ?? 0.5;

    const light: THREE.AmbientLight = new THREE.AmbientLight(color, intensity);
    return light;
  }

  /**
   * 创建平行光（模拟太阳光照效果）
   * @param options - 平行光配置选项
   * @returns DirectionalLight 实例
   */
  public static createDirectionalLight(options?: DirectionalLightOptions): THREE.DirectionalLight {
    const color: number = options?.color ?? 0xffffff;
    const intensity: number = options?.intensity ?? 1.0;
    const position: [number, number, number] = options?.position ?? [5, 5, 5];

    const light: THREE.DirectionalLight = new THREE.DirectionalLight(color, intensity);
    light.position.set(position[0], position[1], position[2]);

    return light;
  }

  /**
   * 创建点光源（从一个点向所有方向发射光线）
   * @param options - 点光源配置选项
   * @returns PointLight 实例
   */
  public static createPointLight(options?: PointLightOptions): THREE.PointLight {
    const color: number = options?.color ?? 0xffffff;
    const intensity: number = options?.intensity ?? 1.0;
    const distance: number = options?.distance ?? 0;
    const decay: number = options?.decay ?? 2;
    const position: [number, number, number] = options?.position ?? [0, 5, 0];

    const light: THREE.PointLight = new THREE.PointLight(color, intensity, distance, decay);
    light.position.set(position[0], position[1], position[2]);

    return light;
  }
}
