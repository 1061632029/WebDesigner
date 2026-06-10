/**
 * 变换命令：记录单个 Three.js Object3D 的位姿 before/after 快照
 * 主要由 TransformGizmo 在拖拽结束时提交，撤销/重做时还原位姿
 * 仅作用于场景中的 Object3D（Mesh / Group / Light 等），不涉及数据模型层
 */

import * as THREE from 'three/webgpu';
import type { ICommand } from '../ICommand';

/**
 * 位姿快照（位置 / 旋转欧拉 / 缩放）
 */
export interface TransformSnapshot {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}

/**
 * 变换命令
 */
export class TransformCommand implements ICommand {
  /** 命令标签 */
  public readonly label: string;

  /** 目标对象引用（命令生命周期内对象必须存在） */
  private readonly _target: THREE.Object3D;

  /** 变换前的位姿快照 */
  private readonly _before: TransformSnapshot;

  /** 变换后的位姿快照 */
  private readonly _after: TransformSnapshot;

  /**
   * @param target - 目标 Object3D
   * @param before - 变换前位姿
   * @param after - 变换后位姿
   * @param label - 命令标签（如 "移动"、"旋转"、"缩放"）
   */
  public constructor(
    target: THREE.Object3D,
    before: TransformSnapshot,
    after: TransformSnapshot,
    label: string = '变换'
  ) {
    this._target = target;
    this._before = before;
    this._after = after;
    this.label = label;
  }

  /**
   * 执行：将目标对象设为 after 位姿
   */
  public execute(): void {
    TransformCommand._applySnapshot(this._target, this._after);
  }

  /**
   * 撤销：将目标对象还原为 before 位姿
   */
  public undo(): void {
    TransformCommand._applySnapshot(this._target, this._before);
  }

  /**
   * 从 Object3D 当前状态读取位姿快照
   * @param target - 目标对象
   */
  public static capture(target: THREE.Object3D): TransformSnapshot {
    return {
      position: { x: target.position.x, y: target.position.y, z: target.position.z },
      rotation: { x: target.rotation.x, y: target.rotation.y, z: target.rotation.z },
      scale: { x: target.scale.x, y: target.scale.y, z: target.scale.z },
    };
  }

  /**
   * 将快照应用到目标对象（同时更新 matrix）
   */
  private static _applySnapshot(target: THREE.Object3D, snapshot: TransformSnapshot): void {
    target.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
    target.rotation.set(snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z);
    target.scale.set(snapshot.scale.x, snapshot.scale.y, snapshot.scale.z);
    target.updateMatrix();
    target.updateMatrixWorld(true);
  }
}
