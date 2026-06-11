/**
 * 墙衔接节点渲染器
 * 在 2D 平面模式下将多墙共享的拓扑节点渲染为浅灰色圆片，自由端不显示。
 */

import * as THREE from 'three/webgpu';
import type { WallJoint } from './BuildingTypes';

/** 墙衔接节点拾取用户数据标记。 */
export const WALL_JOINT_NODE_USER_DATA_KEY: string = 'isWallJointNode';

/** 墙衔接节点圆片所在分组名称。 */
const WALL_JOINT_NODE_GROUP_NAME: string = 'wall-joint-node-renderer-group';

/** 墙衔接节点圆片半径（米）。 */
const WALL_JOINT_NODE_RADIUS: number = 0.075;

/** 墙衔接节点圆片分段数。 */
const WALL_JOINT_NODE_SEGMENTS: number = 32;

/** 墙衔接节点圆片高度，放置在常规墙体顶面之上，确保平面视图显示层级高于墙体。 */
const WALL_JOINT_NODE_Y: number = 3.05;

/** 墙衔接节点浅灰色样式。 */
const WALL_JOINT_NODE_COLOR: number = 0xb8b8b8;

/**
 * 墙衔接节点渲染器。
 * 负责根据墙体连接拓扑刷新圆片 Mesh，并提供统一的拾取目标收集能力。
 */
export class WallJointNodeRenderer {
  /** 保存所有节点圆片的场景分组。 */
  private readonly _group: THREE.Group = new THREE.Group();

  /** 圆片共享材质。 */
  private readonly _material: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({
    color: WALL_JOINT_NODE_COLOR,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  /** 圆片是否在 2D 视图中可见。 */
  private _visible: boolean = false;

  /**
   * 构造墙衔接节点渲染器。
   * @param scene - 需要承载节点圆片的 Three.js 场景
   */
  public constructor(scene: THREE.Scene) {
    this._group.name = WALL_JOINT_NODE_GROUP_NAME;
    this._group.visible = false;
    this._group.renderOrder = 140;
    this._group.userData[WALL_JOINT_NODE_USER_DATA_KEY] = true;
    scene.add(this._group);
  }

  /**
   * 根据墙体连接拓扑刷新节点圆片。
   * 仅渲染连接数大于等于 2 的衔接节点，自由端不会创建圆片。
   * @param joints - 当前墙体连接拓扑节点列表
   */
  public refresh(joints: WallJoint[]): void {
    this._clearMeshes();

    /* 节点刷新流程：直接使用拓扑节点坐标，避免根据线段交点二次推导导致显示位置偏移。 */
    for (const joint of joints) {
      if (joint.connections.length < 2) {
        continue;
      }

      const geometry: THREE.CircleGeometry = new THREE.CircleGeometry(
        WALL_JOINT_NODE_RADIUS,
        WALL_JOINT_NODE_SEGMENTS
      );
      geometry.rotateX(-Math.PI / 2);

      const mesh: THREE.Mesh = new THREE.Mesh(geometry, this._material);
      mesh.position.set(joint.position.x, WALL_JOINT_NODE_Y, joint.position.z);
      mesh.renderOrder = 141;
      mesh.userData[WALL_JOINT_NODE_USER_DATA_KEY] = true;
      mesh.userData['wallJointId'] = joint.id;
      this._group.add(mesh);
    }
  }

  /**
   * 设置节点圆片显隐状态。
   * @param visible - true 表示在 2D 平面显示，false 表示隐藏
   */
  public setVisible(visible: boolean): void {
    this._visible = visible;
    this._group.visible = visible;
  }

  /**
   * 收集当前可拾取的节点圆片 Mesh。
   * @returns 当前可见节点圆片列表
   */
  public collectPickTargets(): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    if (!this._visible || !this._group.visible) {
      return targets;
    }

    this._group.traverse((child: THREE.Object3D): void => {
      if (child instanceof THREE.Mesh && child.visible) {
        targets.push(child);
      }
    });

    return targets;
  }

  /**
   * 判断对象是否为墙衔接节点圆片。
   * @param object - 待判断的 Three.js 对象
   * @returns 是墙衔接节点圆片时返回 true
   */
  public static isWallJointNodeObject(object: THREE.Object3D): boolean {
    return object.userData[WALL_JOINT_NODE_USER_DATA_KEY] === true;
  }

  /**
   * 从场景中收集全部可见墙衔接节点圆片。
   * @param scene - Three.js 场景
   * @returns 墙衔接节点圆片拾取目标列表
   */
  public static collectVisibleNodeMeshes(scene: THREE.Scene): THREE.Object3D[] {
    const targets: THREE.Object3D[] = [];
    scene.traverse((child: THREE.Object3D): void => {
      if (
        child instanceof THREE.Mesh &&
        child.visible &&
        WallJointNodeRenderer.isWallJointNodeObject(child)
      ) {
        targets.push(child);
      }
    });
    return targets;
  }

  /**
   * 释放节点圆片几何体、材质并从父节点移除分组。
   */
  public dispose(): void {
    this._clearMeshes();
    if (this._group.parent !== null) {
      this._group.parent.remove(this._group);
    }
    this._material.dispose();
  }

  /** 清理当前所有节点圆片 Mesh。 */
  private _clearMeshes(): void {
    const children: THREE.Object3D[] = [...this._group.children];
    for (const child of children) {
      this._group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    }
  }
}