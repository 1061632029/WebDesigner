/**
 * 普通 STL 模型移动命令
 * 记录移动前后的 XZ 平面位置，支持撤销/重做
 * 仅处理 category='model' 的普通模型（门窗移动使用 StlMoveWithOpeningCommand）
 */

import * as THREE from 'three/webgpu';
import type { ICommand } from '../ICommand';

/**
 * XZ 平面位置快照（Y 轴不变）
 */
interface PositionSnapshot {
  /** X 轴坐标 */
  x: number;
  /** Y 轴坐标（保留，确保撤销时高度不变） */
  y: number;
  /** Z 轴坐标 */
  z: number;
}

/**
 * 普通 STL 模型移动命令
 * execute：将 Mesh 移动到 after 位置
 * undo：将 Mesh 还原到 before 位置
 */
export class StlMoveCommand implements ICommand {
  /** 命令标签 */
  public readonly label: string;

  /** 被移动的 STL Mesh */
  private readonly _mesh: THREE.Mesh;

  /** 移动前的位置快照 */
  private readonly _before: PositionSnapshot;

  /** 移动后的位置快照 */
  private readonly _after: PositionSnapshot;

  /**
   * @param mesh - 被移动的 STL Mesh
   * @param before - 移动前的位置
   * @param after - 移动后的位置
   * @param label - 命令标签（可选）
   */
  public constructor(
    mesh: THREE.Mesh,
    before: THREE.Vector3,
    after: THREE.Vector3,
    label?: string
  ) {
    this._mesh = mesh;
    this._before = { x: before.x, y: before.y, z: before.z };
    this._after = { x: after.x, y: after.y, z: after.z };
    this.label = label !== undefined ? label : `移动 STL 模型 "${mesh.name}"`;
  }

  /**
   * 执行：将 Mesh 移动到 after 位置
   */
  public execute(): void {
    this._mesh.position.set(this._after.x, this._after.y, this._after.z);
    this._mesh.updateMatrixWorld(true);
    console.log(
      `[StlMoveCommand] 执行: 移动 ${this._mesh.name} → ` +
      `(${this._after.x.toFixed(2)}, ${this._after.y.toFixed(2)}, ${this._after.z.toFixed(2)})`
    );
  }

  /**
   * 撤销：将 Mesh 还原到 before 位置
   */
  public undo(): void {
    this._mesh.position.set(this._before.x, this._before.y, this._before.z);
    this._mesh.updateMatrixWorld(true);
    console.log(
      `[StlMoveCommand] 撤销: 还原 ${this._mesh.name} → ` +
      `(${this._before.x.toFixed(2)}, ${this._before.y.toFixed(2)}, ${this._before.z.toFixed(2)})`
    );
  }
}
