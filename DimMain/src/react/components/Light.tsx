import React, { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { useEngine } from '../hooks/useEngine';
import { LightFactory } from '../../lighting/LightFactory';

/**
 * 环境光组件属性接口
 */
export interface AmbientLightProps {
  /** 光源颜色，默认 0xffffff */
  color?: number;
  /** 光源强度，默认 0.5 */
  intensity?: number;
}

/**
 * 平行光组件属性接口
 */
export interface DirectionalLightProps {
  /** 光源颜色，默认 0xffffff */
  color?: number;
  /** 光源强度，默认 1.0 */
  intensity?: number;
  /** 光源位置 [x, y, z]，默认 [5, 5, 5] */
  position?: [number, number, number];
}

/**
 * 点光源组件属性接口
 */
export interface PointLightProps {
  /** 光源颜色，默认 0xffffff */
  color?: number;
  /** 光源强度，默认 1.0 */
  intensity?: number;
  /** 光照距离，默认 0 */
  distance?: number;
  /** 光照衰减，默认 2 */
  decay?: number;
  /** 光源位置 [x, y, z]，默认 [0, 5, 0] */
  position?: [number, number, number];
}

/**
 * 环境光 React 组件
 * 声明式创建 Three.js AmbientLight，均匀照亮场景中所有物体
 */
export function AmbientLight(props: AmbientLightProps): React.ReactElement | null {
  const engine = useEngine();
  const lightRef: React.MutableRefObject<THREE.AmbientLight | null> =
    useRef<THREE.AmbientLight | null>(null);

  const color: number = props.color ?? 0xffffff;
  const intensity: number = props.intensity ?? 0.5;

  /* 创建和销毁环境光 */
  useEffect((): (() => void) => {
    const light: THREE.AmbientLight = LightFactory.createAmbientLight({ color, intensity });
    lightRef.current = light;
    engine.sceneManager.add(light);

    return (): void => {
      engine.sceneManager.remove(light);
      light.dispose();
      lightRef.current = null;
    };
  }, [engine]);

  /* 响应颜色和强度属性变更 */
  useEffect((): void => {
    if (lightRef.current) {
      lightRef.current.color.setHex(color);
      lightRef.current.intensity = intensity;
    }
  }, [color, intensity]);

  return null;
}

/**
 * 平行光 React 组件
 * 声明式创建 Three.js DirectionalLight，模拟太阳光照效果
 */
export function DirectionalLight(props: DirectionalLightProps): React.ReactElement | null {
  const engine = useEngine();
  const lightRef: React.MutableRefObject<THREE.DirectionalLight | null> =
    useRef<THREE.DirectionalLight | null>(null);

  const color: number = props.color ?? 0xffffff;
  const intensity: number = props.intensity ?? 1.0;
  const position: [number, number, number] = props.position ?? [5, 5, 5];

  /* 创建和销毁平行光 */
  useEffect((): (() => void) => {
    const light: THREE.DirectionalLight = LightFactory.createDirectionalLight({
      color,
      intensity,
      position,
    });
    lightRef.current = light;
    engine.sceneManager.add(light);

    /**
     * 将 DirectionalLight 的 target 显式添加到场景中
     * 避免 WebGPU 渲染器在正交相机（2D 模式）下将 target 渲染为白色伪影
     * Three.js 要求 target 必须在场景中才能正确计算光照方向
     */
    engine.sceneManager.add(light.target);

    return (): void => {
      /* 清理时同步移除 target */
      engine.sceneManager.remove(light.target);
      engine.sceneManager.remove(light);
      light.dispose();
      lightRef.current = null;
    };
  }, [engine]);

  /* 响应颜色和强度属性变更 */
  useEffect((): void => {
    if (lightRef.current) {
      lightRef.current.color.setHex(color);
      lightRef.current.intensity = intensity;
    }
  }, [color, intensity]);

  /* 响应位置属性变更 */
  useEffect((): void => {
    if (lightRef.current) {
      lightRef.current.position.set(position[0], position[1], position[2]);
    }
  }, [position]);

  return null;
}

/**
 * 点光源 React 组件
 * 声明式创建 Three.js PointLight，从一个点向所有方向发射光线
 */
export function PointLight(props: PointLightProps): React.ReactElement | null {
  const engine = useEngine();
  const lightRef: React.MutableRefObject<THREE.PointLight | null> =
    useRef<THREE.PointLight | null>(null);

  const color: number = props.color ?? 0xffffff;
  const intensity: number = props.intensity ?? 1.0;
  const distance: number = props.distance ?? 0;
  const decay: number = props.decay ?? 2;
  const position: [number, number, number] = props.position ?? [0, 5, 0];

  /* 创建和销毁点光源 */
  useEffect((): (() => void) => {
    const light: THREE.PointLight = LightFactory.createPointLight({
      color,
      intensity,
      distance,
      decay,
      position,
    });
    lightRef.current = light;
    engine.sceneManager.add(light);

    return (): void => {
      engine.sceneManager.remove(light);
      light.dispose();
      lightRef.current = null;
    };
  }, [engine]);

  /* 响应颜色和强度属性变更 */
  useEffect((): void => {
    if (lightRef.current) {
      lightRef.current.color.setHex(color);
      lightRef.current.intensity = intensity;
    }
  }, [color, intensity]);

  /* 响应位置属性变更 */
  useEffect((): void => {
    if (lightRef.current) {
      lightRef.current.position.set(position[0], position[1], position[2]);
    }
  }, [position]);

  return null;
}
