import * as THREE from 'three/webgpu';
import { OrbitControlsWrapper } from './OrbitControlsWrapper';

/**
 * 透视相机配置选项接口
 */
export interface PerspectiveCameraOptions {
  /** 视场角（度），默认 75 */
  fov?: number;
  /** 近裁剪面距离，默认 0.1 */
  near?: number;
  /** 远裁剪面距离，默认 1000 */
  far?: number;
}

/**
 * 相机管理器类
 * 负责创建和管理相机实例（透视相机、正交相机），集成轨道控制器
 */
export class CameraManager {
  /** 当前活动相机 */
  private _activeCamera: THREE.Camera;
  /** 轨道控制器封装 */
  private _orbitControls: OrbitControlsWrapper | null = null;

  /**
   * 创建相机管理器，默认创建透视相机
   */
  constructor() {
    /* 使用默认参数创建透视相机 */
    this._activeCamera = this.createPerspectiveCamera();
  }

  /**
   * 获取当前活动相机
   * @returns 当前活动的 Three.js Camera 实例
   */
  public getActiveCamera(): THREE.Camera {
    return this._activeCamera;
  }

  /**
   * 设置当前活动相机
   * @param camera - 要设置为活动的 Three.js Camera 实例
   */
  public setActiveCamera(camera: THREE.Camera): void {
    this._activeCamera = camera;
  }

  /**
   * 创建透视相机
   * @param options - 透视相机配置选项
   * @returns PerspectiveCamera 实例
   */
  public createPerspectiveCamera(options?: PerspectiveCameraOptions): THREE.PerspectiveCamera {
    const fov: number = options?.fov ?? 75;
    const near: number = options?.near ?? 0.1;
    const far: number = options?.far ?? 1000;
    /* 默认宽高比为 1，后续由 updateAspect 方法更新 */
    const aspect: number = 1;

    const camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    return camera;
  }

  /**
   * 创建正交相机
   * @param width - 视口宽度，默认 10
   * @param height - 视口高度，默认 10
   * @param near - 近裁剪面距离，默认 0.1
   * @param far - 远裁剪面距离，默认 1000
   * @returns OrthographicCamera 实例
   */
  public createOrthographicCamera(
    width: number = 10,
    height: number = 10,
    near: number = 0.1,
    far: number = 1000
  ): THREE.OrthographicCamera {
    const halfWidth: number = width / 2;
    const halfHeight: number = height / 2;
    const camera: THREE.OrthographicCamera = new THREE.OrthographicCamera(
      -halfWidth,
      halfWidth,
      halfHeight,
      -halfHeight,
      near,
      far
    );
    return camera;
  }

  /**
   * 设置当前活动相机的位置
   * @param x - X 坐标
   * @param y - Y 坐标
   * @param z - Z 坐标
   */
  public setPosition(x: number, y: number, z: number): void {
    this._activeCamera.position.set(x, y, z);
  }

  /**
   * 设置当前活动相机的观察目标
   * @param x - 目标 X 坐标
   * @param y - 目标 Y 坐标
   * @param z - 目标 Z 坐标
   */
  public setLookAt(x: number, y: number, z: number): void {
    this._activeCamera.lookAt(x, y, z);
  }

  /**
   * 更新相机宽高比（响应渲染器尺寸变化）
   * @param width - 新的视口宽度
   * @param height - 新的视口高度
   */
  public updateAspect(width: number, height: number): void {
    if (this._activeCamera instanceof THREE.PerspectiveCamera) {
      this._activeCamera.aspect = width / height;
      this._activeCamera.updateProjectionMatrix();
    } else if (this._activeCamera instanceof THREE.OrthographicCamera) {
      const aspect: number = width / height;
      const halfHeight: number = (this._activeCamera.top - this._activeCamera.bottom) / 2;
      const halfWidth: number = halfHeight * aspect;
      this._activeCamera.left = -halfWidth;
      this._activeCamera.right = halfWidth;
      this._activeCamera.updateProjectionMatrix();
    }
  }

  /**
   * 启用轨道控制器
   * @param domElement - 用于监听鼠标/触摸事件的 DOM 元素
   * @param target - 控制器围绕的目标点，默认原点
   */
  public enableOrbitControls(domElement: HTMLElement, target?: THREE.Vector3): void {
    /* 先销毁已有的控制器 */
    if (this._orbitControls) {
      this._orbitControls.dispose();
    }
    this._orbitControls = new OrbitControlsWrapper(this._activeCamera, domElement, target);
  }

  /**
   * 禁用轨道控制器
   */
  public disableOrbitControls(): void {
    if (this._orbitControls) {
      this._orbitControls.dispose();
      this._orbitControls = null;
    }
  }

  /**
   * 获取轨道控制器封装实例
   * @returns OrbitControlsWrapper 实例或 null
   */
  public getOrbitControls(): OrbitControlsWrapper | null {
    return this._orbitControls;
  }

  /**
   * 更新控制器（每帧调用）
   */
  public updateControls(): void {
    if (this._orbitControls) {
      this._orbitControls.update();
    }
  }

  /**
   * 销毁相机管理器，释放控制器资源
   */
  public dispose(): void {
    if (this._orbitControls) {
      this._orbitControls.dispose();
      this._orbitControls = null;
    }
  }
}
