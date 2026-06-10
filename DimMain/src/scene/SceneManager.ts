import * as THREE from 'three/webgpu';

/**
 * 场景管理器类
 * 负责创建和管理 Three.js Scene 实例，提供场景节点的增删和背景设置能力
 */
export class SceneManager {
  /** 当前活动的 Three.js 场景实例 */
  private _scene: THREE.Scene;

  /**
   * 创建场景管理器，自动创建默认场景
   */
  constructor() {
    this._scene = new THREE.Scene();
  }

  /**
   * 获取当前活动场景
   * @returns 当前 Three.js Scene 实例
   */
  public getScene(): THREE.Scene {
    return this._scene;
  }

  /**
   * 向当前场景中添加 Object3D 节点
   * @param object - 要添加的 Three.js Object3D 对象
   */
  public add(object: THREE.Object3D): void {
    this._scene.add(object);
  }

  /**
   * 从当前场景中移除 Object3D 节点
   * @param object - 要移除的 Three.js Object3D 对象
   */
  public remove(object: THREE.Object3D): void {
    this._scene.remove(object);
  }

  /**
   * 设置场景背景颜色
   * @param color - 背景颜色，支持十六进制数值或 Three.js Color 对象
   */
  public setBackground(color: number | THREE.Color): void {
    if (color instanceof THREE.Color) {
      this._scene.background = color;
    } else {
      this._scene.background = new THREE.Color(color);
    }
  }

  /**
   * 销毁场景，遍历并释放所有子节点的资源
   */
  public dispose(): void {
    /* 遍历场景中的所有子节点并尝试释放资源 */
    this._scene.traverse((object: THREE.Object3D): void => {
      /* 释放几何体资源 */
      if (object instanceof THREE.Mesh) {
        if (object.geometry) {
          object.geometry.dispose();
        }
        /* 释放材质资源 */
        if (object.material) {
          if (Array.isArray(object.material)) {
            for (const material of object.material) {
              material.dispose();
            }
          } else {
            object.material.dispose();
          }
        }
      }
    });

    /* 清空场景中的所有子节点 */
    while (this._scene.children.length > 0) {
      const child: THREE.Object3D | undefined = this._scene.children[0];
      if (child) {
        this._scene.remove(child);
      }
    }
  }
}
