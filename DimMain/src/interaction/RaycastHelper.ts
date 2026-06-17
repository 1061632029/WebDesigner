/**
 * 射线投射辅助工具
 * 将屏幕坐标转换为地平面（XZ 平面）上的世界坐标
 */

import * as THREE from 'three/webgpu';
import type { Point2D } from '../building/BuildingTypes';

/**
 * 面级射线拾取结果
 * 包含命中的 Mesh、面索引和材质索引
 */
export interface MeshFaceHitResult {
  /** 命中的 Mesh 对象 */
  mesh: THREE.Mesh;
  /** 命中的面索引（三角形索引） */
  faceIndex: number;
  /** 命中面所属的材质组索引（对应 geometry.groups 中的 materialIndex） */
  materialIndex: number;
  /** 命中点的世界坐标 */
  point: THREE.Vector3;
  /** 建筑对象 ID（从 mesh.userData 获取，可能为 undefined） */
  buildingObjectId: string | undefined;
}

/**
 * 射线投射辅助器
 * 提供屏幕坐标 → 世界坐标的转换能力
 */
export class RaycastHelper {
  /** 射线投射器 */
  private _raycaster: THREE.Raycaster;
  /** 地平面（Y=0 的水平面） */
  private _groundPlane: THREE.Plane;
  /** 临时向量（避免每帧创建新对象） */
  private _tempVec3: THREE.Vector3;

  constructor() {
    this._raycaster = new THREE.Raycaster();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._tempVec3 = new THREE.Vector3();
  }

  /**
   * 将屏幕坐标转换为地平面上的 2D 点
   * @param screenX - 屏幕 X 坐标（像素）
   * @param screenY - 屏幕 Y 坐标（像素）
   * @param camera - 当前相机
   * @param domElement - Canvas DOM 元素
   * @returns 地平面上的 Point2D，如果射线未命中地面返回 null
   */
  public screenToGround(
    screenX: number,
    screenY: number,
    camera: THREE.Camera,
    domElement: HTMLElement
  ): Point2D | null {
    /* 将屏幕坐标转换为 NDC（-1 到 1） */
    const rect: DOMRect = domElement.getBoundingClientRect();
    const ndcX: number = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ndcY: number = -((screenY - rect.top) / rect.height) * 2 + 1;

    /* 设置射线 */
    this._raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

    /* 求射线与地平面的交点 */
    const intersectPoint: THREE.Vector3 | null = this._raycaster.ray.intersectPlane(
      this._groundPlane,
      this._tempVec3
    );

    if (intersectPoint === null) {
      return null;
    }

    /* 返回 XZ 平面上的 2D 坐标 */
    const point: Point2D = {
      x: intersectPoint.x,
      z: intersectPoint.z,
    };
    return point;
  }

  /**
   * 射线投射到场景中的 Mesh 对象，返回面级拾取结果
   * @param screenX - 屏幕 X 坐标（像素）
   * @param screenY - 屏幕 Y 坐标（像素）
   * @param camera - 当前相机
   * @param domElement - Canvas DOM 元素
   * @param sceneObjects - 需要检测的场景对象数组
   * @returns 面级拾取结果，未命中返回 null
   */
  public screenToMeshFace(
    screenX: number,
    screenY: number,
    camera: THREE.Camera,
    domElement: HTMLElement,
    sceneObjects: Array<THREE.Object3D>
  ): MeshFaceHitResult | null {
    /* 将屏幕坐标转换为 NDC */
    const rect: DOMRect = domElement.getBoundingClientRect();
    const ndcX: number = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ndcY: number = -((screenY - rect.top) / rect.height) * 2 + 1;

    /* 设置射线 */
    this._raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

    /* 业务拾取流程：先剔除固定像素边界线、增强线框等视觉辅助对象，避免辅助显示层抢占实体 Mesh 命中。 */
    const pickableObjects: Array<THREE.Object3D> = this._collectPickableRaycastObjects(sceneObjects);

    /* 执行射线投射 */
    const intersections: Array<THREE.Intersection> = this._raycaster.intersectObjects(
      pickableObjects,
      false
    );

    /* 查找第一个有效的 Mesh 命中 */
    for (const intersection of intersections) {
      if (!(intersection.object instanceof THREE.Mesh)) {
        continue;
      }

      const hitMesh: THREE.Mesh = intersection.object;
      const faceIndex: number = intersection.faceIndex ?? -1;

      /* 无效的面索引，跳过 */
      if (faceIndex < 0) {
        continue;
      }

      /* 从 geometry.groups 中查找该面对应的 materialIndex */
      let materialIndex: number = 0;
      const geometry: THREE.BufferGeometry = hitMesh.geometry;
      const groups: Array<{ start: number; count: number; materialIndex?: number }> = geometry.groups;

      if (groups.length > 0) {
        /* 计算该面三角形在 index 中的起始位置 */
        const triangleStartIndex: number = faceIndex * 3;

        for (const group of groups) {
          const groupEnd: number = group.start + group.count;
          if (triangleStartIndex >= group.start && triangleStartIndex < groupEnd) {
            materialIndex = group.materialIndex ?? 0;
            break;
          }
        }
      }

      /* 获取建筑对象 ID */
      const buildingObjectId: string | undefined = hitMesh.userData['buildingObjectId'] as string | undefined;

      const result: MeshFaceHitResult = {
        mesh: hitMesh,
        faceIndex: faceIndex,
        materialIndex: materialIndex,
        point: intersection.point.clone(),
        buildingObjectId: buildingObjectId,
      };
      return result;
    }

    return null;
  }

  /**
   * 收集允许参与业务射线拾取的对象。
   * 关键逻辑：显示辅助对象只负责渲染，不参与墙体、门窗、STL 等业务对象筛选。
   * @param sceneObjects - 原始场景对象数组
   * @returns 可参与 Raycaster 检测的对象数组
   */
  private _collectPickableRaycastObjects(sceneObjects: Array<THREE.Object3D>): Array<THREE.Object3D> {
    const pickableObjects: Array<THREE.Object3D> = [];

    for (const sceneObject of sceneObjects) {
      this._appendPickableRaycastObject(sceneObject, pickableObjects);
    }

    return pickableObjects;
  }

  /**
   * 递归追加可拾取对象。
   * @param object3D - 当前检测对象
   * @param pickableObjects - 可拾取对象输出数组
   */
  private _appendPickableRaycastObject(object3D: THREE.Object3D, pickableObjects: Array<THREE.Object3D>): void {
    if (!this._isPickableRaycastObject(object3D)) {
      return;
    }

    pickableObjects.push(object3D);

    for (const child of object3D.children) {
      this._appendPickableRaycastObject(child, pickableObjects);
    }
  }

  /**
   * 判断对象是否允许进入业务射线拾取。
   * @param object3D - 待判断的三维对象
   * @returns 允许拾取时返回 true
   */
  private _isPickableRaycastObject(object3D: THREE.Object3D): boolean {
    if (object3D.userData['isPickable'] === false) {
      return false;
    }

    if (object3D.userData['isVisualHelper'] === true) {
      return false;
    }

    if (object3D.userData['isFixedPixelLineSegments'] === true) {
      return false;
    }

    if (object3D.userData['isEnhancedWireframe'] === true) {
      return false;
    }

    return true;
  }

  /**
   * 设置地平面高度
   * @param y - 地平面 Y 坐标
   */
  public setGroundHeight(y: number): void {
    this._groundPlane.constant = -y;
  }
}
