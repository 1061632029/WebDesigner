/**
 * 遮挡 X-Ray 透视控制器
 * 每帧从相机向视口中的采样点发射射线，检测路径上第一个命中的墙体或天花板。
 * 若命中则将其及绑定的门窗模型直接隐藏，不再命中时恢复显示。
 * 采样线列表通过公开接口管理，方便后续扩展多点采样。
 */

import * as THREE from 'three/webgpu';
import type { BuildingObjectManager } from '../building/BuildingObjectManager';

/**
 * 采样点定义（NDC 坐标，范围 -1 ~ 1）
 * x=0, y=0 表示视口中心
 */
export interface SamplePoint {
  /** NDC X 坐标（-1 ~ 1） */
  ndcX: number;
  /** NDC Y 坐标（-1 ~ 1） */
  ndcY: number;
}

/**
 * 遮挡 X-Ray 透视控制器
 * 通过每帧射线检测，自动将遮挡视线的墙体/天花板及其绑定门窗直接隐藏，
 * 脱离检测时恢复显示
 */
export class OcclusionXRay {
  /** 射线投射器 */
  private readonly _raycaster: THREE.Raycaster;

  /**
   * 采样点列表（NDC 坐标）
   * 默认仅包含视口中心点 (0, 0)
   * 可通过 setSamplePoints / addSamplePoint 扩展
   */
  private _samplePoints: SamplePoint[];

  /**
   * 当前被隐藏的建筑对象 ID 集合（墙体/天花板）
   * 用于在下一帧判断哪些对象需要恢复显示
   */
  private _hiddenIds: Set<string>;

  /** 相机引用（每帧更新） */
  private _camera: THREE.Camera | null;

  /** 场景引用 */
  private _scene: THREE.Scene | null;

  /** 建筑对象管理器引用 */
  private _objectManager: BuildingObjectManager | null;

  /** 是否已启用 */
  private _enabled: boolean;

  constructor() {
    this._raycaster = new THREE.Raycaster();
    /* 默认采样点：视口中心 */
    this._samplePoints = [{ ndcX: 0, ndcY: 0 }];
    this._hiddenIds = new Set<string>();
    this._camera = null;
    this._scene = null;
    this._objectManager = null;
    this._enabled = false;
  }

  /* ========== 采样线管理接口 ========== */

  /**
   * 替换全部采样点列表
   * @param points - 新的采样点数组（NDC 坐标）
   */
  public setSamplePoints(points: SamplePoint[]): void {
    this._samplePoints = points.slice();
  }

  /**
   * 获取当前采样点列表的只读副本
   * @returns 采样点数组
   */
  public getSamplePoints(): SamplePoint[] {
    return this._samplePoints.slice();
  }

  /**
   * 追加一个采样点
   * @param point - 采样点（NDC 坐标）
   */
  public addSamplePoint(point: SamplePoint): void {
    this._samplePoints.push(point);
  }

  /**
   * 移除指定索引的采样点
   * @param index - 采样点索引
   */
  public removeSamplePoint(index: number): void {
    if (index >= 0 && index < this._samplePoints.length) {
      this._samplePoints.splice(index, 1);
    }
  }

  /**
   * 重置为默认采样点（仅视口中心）
   */
  public resetSamplePoints(): void {
    this._samplePoints = [{ ndcX: 0, ndcY: 0 }];
  }

  /* ========== 生命周期 ========== */

  /**
   * 启用 X-Ray 遮挡检测
   * @param camera - 当前活动相机
   * @param scene - Three.js 场景
   * @param objectManager - 建筑对象管理器
   */
  public enable(
    camera: THREE.Camera,
    scene: THREE.Scene,
    objectManager: BuildingObjectManager
  ): void {
    this._camera = camera;
    this._scene = scene;
    this._objectManager = objectManager;
    this._enabled = true;
  }

  /**
   * 禁用 X-Ray 遮挡检测，并立即恢复所有被隐藏的对象
   */
  public disable(): void {
    this._enabled = false;
    /* 恢复所有隐藏对象 */
    this._restoreAll();
    this._camera = null;
    this._scene = null;
    this._objectManager = null;
  }

  /**
   * 更新相机引用（相机切换时调用）
   * @param camera - 新的活动相机
   */
  public updateCamera(camera: THREE.Camera): void {
    this._camera = camera;
  }

  /**
   * 每帧执行遮挡检测
   * 应在渲染循环的帧回调中调用
   */
  public update(): void {
    if (
      !this._enabled ||
      this._camera === null ||
      this._scene === null ||
      this._objectManager === null ||
      this._samplePoints.length === 0
    ) {
      return;
    }

    /* 本帧所有采样点命中的建筑对象 ID 集合 */
    const hitIds: Set<string> = new Set<string>();

    /* 遍历所有采样点，收集命中的墙体/天花板 ID */
    for (const sample of this._samplePoints) {
      const hitId: string | null = this._castRay(sample.ndcX, sample.ndcY);
      if (hitId !== null) {
        hitIds.add(hitId);
      }
    }

    /* 恢复上一帧隐藏但本帧未命中的对象 */
    for (const id of this._hiddenIds) {
      if (!hitIds.has(id)) {
        this._showObject(id);
        this._hiddenIds.delete(id);
      }
    }

    /* 将本帧新命中但尚未隐藏的对象设为不可见 */
    for (const id of hitIds) {
      if (!this._hiddenIds.has(id)) {
        this._hideObject(id);
        this._hiddenIds.add(id);
      }
    }
  }

  /* ========== 内部方法 ========== */

  /**
   * 从相机向指定 NDC 坐标发射射线，返回第一个命中的墙体或天花板的建筑对象 ID
   * @param ndcX - NDC X 坐标（-1 ~ 1）
   * @param ndcY - NDC Y 坐标（-1 ~ 1）
   * @returns 命中的建筑对象 ID，未命中返回 null
   */
  private _castRay(ndcX: number, ndcY: number): string | null {
    if (this._camera === null || this._scene === null || this._objectManager === null) {
      return null;
    }

    /* 设置射线方向（从相机向 NDC 坐标点） */
    this._raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this._camera);

    /* 获取场景中所有对象（递归） */
    const sceneObjects: THREE.Object3D[] = this._scene.children;
    const intersections: THREE.Intersection[] = this._raycaster.intersectObjects(
      sceneObjects,
      true
    );

    /* 遍历命中列表，找到第一个属于 wall 或 ceiling 的建筑对象 */
    for (const intersection of intersections) {
      if (!(intersection.object instanceof THREE.Mesh)) {
        continue;
      }

      const mesh: THREE.Mesh = intersection.object;

      /* 从 userData 获取建筑对象 ID */
      const buildingObjectId: string | undefined =
        mesh.userData['buildingObjectId'] as string | undefined;
      if (buildingObjectId === undefined) {
        continue;
      }

      /* 查询建筑对象类别 */
      const obj = this._objectManager.getById(buildingObjectId);
      if (obj === undefined) {
        continue;
      }

      /* 只处理墙体和天花板 */
      if (obj.category === 'wall' || obj.category === 'ceiling') {
        return buildingObjectId;
      }
    }

    return null;
  }

  /**
   * 隐藏指定建筑对象的 Mesh 及其绑定的门窗模型
   * @param id - 建筑对象 ID（墙体或天花板）
   */
  private _hideObject(id: string): void {
    if (this._objectManager === null || this._scene === null) {
      return;
    }

    /* 隐藏墙体/天花板 Mesh 本体 */
    const mesh: THREE.Mesh | undefined = this._objectManager.getMeshById(id);
    if (mesh !== undefined) {
      mesh.visible = false;
    }

    /* 隐藏绑定到该墙体的门窗模型（userData['wallId'] === id） */
    const attachedMeshes: THREE.Object3D[] = this._findAttachedMeshes(id);
    for (const attachedMesh of attachedMeshes) {
      attachedMesh.visible = false;
    }
  }

  /**
   * 恢复指定建筑对象的 Mesh 及其绑定的门窗模型为可见
   * @param id - 建筑对象 ID（墙体或天花板）
   */
  private _showObject(id: string): void {
    if (this._objectManager === null || this._scene === null) {
      return;
    }

    /* 恢复墙体/天花板 Mesh 本体 */
    const mesh: THREE.Mesh | undefined = this._objectManager.getMeshById(id);
    if (mesh !== undefined) {
      mesh.visible = true;
    }

    /* 恢复绑定到该墙体的门窗模型 */
    const attachedMeshes: THREE.Object3D[] = this._findAttachedMeshes(id);
    for (const attachedMesh of attachedMeshes) {
      attachedMesh.visible = true;
    }
  }

  /**
   * 在场景中查找所有绑定到指定墙体的门窗模型
   * 判断依据：Object3D.userData['wallId'] === wallId
   * 门窗模型由 StlPlaceTool 放置时写入 userData['wallId']
   * @param wallId - 目标墙体 ID
   * @returns 绑定到该墙体的所有 Object3D 列表
   */
  private _findAttachedMeshes(wallId: string): THREE.Object3D[] {
    if (this._scene === null) {
      return [];
    }

    const result: THREE.Object3D[] = [];

    /* 递归遍历场景，收集 userData['wallId'] === wallId 的对象 */
    this._scene.traverse((obj: THREE.Object3D): void => {
      const attachedWallId: string | undefined = obj.userData['wallId'] as string | undefined;
      if (attachedWallId === wallId) {
        result.push(obj);
      }
    });

    return result;
  }

  /**
   * 恢复所有当前被隐藏的对象
   */
  private _restoreAll(): void {
    for (const id of this._hiddenIds) {
      this._showObject(id);
    }
    this._hiddenIds.clear();
  }

  /**
   * 销毁控制器，恢复所有隐藏对象并释放引用
   */
  public dispose(): void {
    this.disable();
  }
}
