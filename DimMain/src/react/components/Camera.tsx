import React, { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { useEngine } from '../hooks/useEngine';

/**
 * 透视相机组件属性接口
 */
export interface PerspectiveCameraProps {
  /** 视场角（度），默认 75 */
  fov?: number;
  /** 近裁剪面距离，默认 0.1 */
  near?: number;
  /** 远裁剪面距离，默认 1000 */
  far?: number;
  /** 相机位置 [x, y, z]，默认 [0, 2, 5] */
  position?: [number, number, number];
  /** 相机观察目标 [x, y, z]，默认 [0, 0, 0] */
  lookAt?: [number, number, number];
  /** 是否启用 OrbitControls 轨道控制器，默认 false */
  enableOrbitControls?: boolean;
}

/**
 * 正交相机组件属性接口
 * 用于 2D 俯视编辑模式
 */
export interface OrthographicCameraProps {
  /** 正交视口的可见高度（世界单位），默认 20 */
  viewHeight?: number;
  /** 近裁剪面距离，默认 0.1 */
  near?: number;
  /** 远裁剪面距离，默认 1000 */
  far?: number;
  /** 相机位置 [x, y, z]，默认 [0, 50, 0]（正上方俯视） */
  position?: [number, number, number];
  /** 相机观察目标 [x, y, z]，默认 [0, 0, 0] */
  lookAt?: [number, number, number];
  /** 是否启用 OrbitControls（仅平移+缩放，旋转被禁用），默认 false */
  enableOrbitControls?: boolean;
}

/**
 * 透视相机 React 组件
 * 声明式配置 Three.js PerspectiveCamera，支持位置、朝向和 OrbitControls 配置
 */
export function PerspectiveCamera(props: PerspectiveCameraProps): React.ReactElement | null {
  const engine = useEngine();

  const fov: number = props.fov ?? 75;
  const near: number = props.near ?? 0.1;
  const far: number = props.far ?? 1000;
  const position: [number, number, number] = props.position ?? [0, 2, 5];
  const lookAt: [number, number, number] = props.lookAt ?? [0, 0, 0];
  const enableOrbitControls: boolean = props.enableOrbitControls ?? false;

  /* 创建并配置透视相机 */
  useEffect((): (() => void) => {
    const camera: THREE.PerspectiveCamera = engine.cameraManager.createPerspectiveCamera({
      fov,
      near,
      far,
    });

    /* 设置相机位置 */
    camera.position.set(position[0], position[1], position[2]);
    /* 设置观察目标 */
    camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);

    /* 设为活动相机 */
    engine.cameraManager.setActiveCamera(camera);

    /* 更新宽高比（基于当前渲染器尺寸） */
    if (engine.renderer) {
      const size: THREE.Vector2 = new THREE.Vector2();
      engine.renderer.getSize(size);
      engine.cameraManager.updateAspect(size.x, size.y);
    }

    /* 启用轨道控制器 */
    if (enableOrbitControls && engine.renderer) {
      engine.cameraManager.enableOrbitControls(
        engine.renderer.domElement,
        new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2])
      );
    }

    return (): void => {
      /* 组件卸载时禁用控制器 */
      engine.cameraManager.disableOrbitControls();
    };
  }, [engine, fov, near, far]);

  /* 响应位置属性变更 */
  useEffect((): void => {
    engine.cameraManager.setPosition(position[0], position[1], position[2]);
  }, [engine, position]);

  /* 响应 lookAt 属性变更 */
  useEffect((): void => {
    engine.cameraManager.setLookAt(lookAt[0], lookAt[1], lookAt[2]);
  }, [engine, lookAt]);

  /* 响应 OrbitControls 启用/禁用变更 */
  useEffect((): void => {
    if (enableOrbitControls && engine.renderer) {
      engine.cameraManager.enableOrbitControls(
        engine.renderer.domElement,
        new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2])
      );
    } else {
      engine.cameraManager.disableOrbitControls();
    }
  }, [engine, enableOrbitControls]);

  return null;
}

/**
 * 正交相机 React 组件
 * 用于 2D 俯视编辑模式：
 * - 使用正交投影，无透视畸变
 * - 相机固定在正上方俯视（Y 轴方向）
 * - 启用 OrbitControls 时仅允许平移和缩放，禁用旋转
 */
export function OrthographicCamera(props: OrthographicCameraProps): React.ReactElement | null {
  const engine = useEngine();

  const viewHeight: number = props.viewHeight ?? 20;
  const near: number = props.near ?? 0.1;
  const far: number = props.far ?? 1000;
  const position: [number, number, number] = props.position ?? [0, 50, 0];
  const lookAt: [number, number, number] = props.lookAt ?? [0, 0, 0];
  const enableOrbitControls: boolean = props.enableOrbitControls ?? false;

  /** 记录渲染器当前宽高比，用于正交相机初始化 */
  const aspectRef = useRef<number>(1);

  /* 创建并配置正交相机 */
  useEffect((): (() => void) => {
    /* 获取当前渲染器宽高比 */
    if (engine.renderer) {
      const size: THREE.Vector2 = new THREE.Vector2();
      engine.renderer.getSize(size);
      if (size.y > 0) {
        aspectRef.current = size.x / size.y;
      }
    }

    const halfHeight: number = viewHeight / 2;
    const halfWidth: number = halfHeight * aspectRef.current;

    /* 创建正交相机 */
    const camera: THREE.OrthographicCamera = new THREE.OrthographicCamera(
      -halfWidth,
      halfWidth,
      halfHeight,
      -halfHeight,
      near,
      far
    );

    /* 固定俯视位置 */
    camera.position.set(position[0], position[1], position[2]);
    /* 朝向目标点（俯视时 up 向量需设为 -Z 轴，避免相机翻转） */
    camera.up.set(0, 0, -1);
    camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);

    /* 设为活动相机 */
    engine.cameraManager.setActiveCamera(camera);

    /* 更新正交相机宽高比 */
    if (engine.renderer) {
      const size: THREE.Vector2 = new THREE.Vector2();
      engine.renderer.getSize(size);
      engine.cameraManager.updateAspect(size.x, size.y);
    }

    /* 启用轨道控制器（仅平移+缩放） */
    if (enableOrbitControls && engine.renderer) {
      engine.cameraManager.enableOrbitControls(
        engine.renderer.domElement,
        new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2])
      );
      /* 禁用旋转，锁定为俯视视角 */
      const orbitControls = engine.cameraManager.getOrbitControls();
      if (orbitControls !== null) {
        orbitControls.setRotateEnabled(false);
      }
    }

    return (): void => {
      /* 组件卸载时禁用控制器 */
      engine.cameraManager.disableOrbitControls();
    };
  }, [engine, viewHeight, near, far]);

  /* 响应 OrbitControls 启用/禁用变更 */
  useEffect((): void => {
    if (enableOrbitControls && engine.renderer) {
      engine.cameraManager.enableOrbitControls(
        engine.renderer.domElement,
        new THREE.Vector3(lookAt[0], lookAt[1], lookAt[2])
      );
      /* 禁用旋转，锁定为俯视视角 */
      const orbitControls = engine.cameraManager.getOrbitControls();
      if (orbitControls !== null) {
        orbitControls.setRotateEnabled(false);
      }
    } else {
      engine.cameraManager.disableOrbitControls();
    }
  }, [engine, enableOrbitControls]);

  return null;
}
