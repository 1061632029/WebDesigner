/**
 * STL 模型缩放命令
 * 将"修改 STL 模型 scale"封装为可撤销/重做的命令
 * execute：应用 after 缩放到 mesh.scale，并刷新属性面板
 * undo：恢复 before 缩放到 mesh.scale，并刷新属性面板
 */

import * as THREE from 'three/webgpu';
import type { ICommand } from '../ICommand';

/**
 * 缩放快照（三轴缩放值）
 */
export interface ScaleSnapshot {
  /** X 轴缩放 */
  scaleX: number;
  /** Y 轴缩放 */
  scaleY: number;
  /** Z 轴缩放 */
  scaleZ: number;
}

/**
 * STL 模型缩放命令
 * 仅修改 mesh.scale，不重建几何体，性能好
 */
export class StlResizeCommand implements ICommand {
  /** 命令标签 */
  public readonly label: string;

  /** 被缩放的 STL Mesh */
  private readonly _mesh: THREE.Mesh;

  /** 缩放前的快照 */
  private readonly _before: ScaleSnapshot;

  /** 缩放后的快照 */
  private readonly _after: ScaleSnapshot;

  /** 执行/撤销后刷新属性面板的回调 */
  private readonly _onRefresh: () => void;

  /**
   * @param mesh - 被缩放的 STL Mesh
   * @param before - 缩放前的快照
   * @param after - 缩放后的快照
   * @param onRefresh - 执行/撤销后刷新属性面板的回调
   * @param label - 命令标签
   */
  public constructor(
    mesh: THREE.Mesh,
    before: ScaleSnapshot,
    after: ScaleSnapshot,
    onRefresh: () => void,
    label: string
  ) {
    this._mesh = mesh;
    this._before = { ...before };
    this._after = { ...after };
    this._onRefresh = onRefresh;
    this.label = label;
  }

  /**
   * 执行：应用 after 缩放
   */
  public execute(): void {
    this._mesh.scale.set(this._after.scaleX, this._after.scaleY, this._after.scaleZ);
    this._onRefresh();
  }

  /**
   * 撤销：恢复 before 缩放
   */
  public undo(): void {
    this._mesh.scale.set(this._before.scaleX, this._before.scaleY, this._before.scaleZ);
    this._onRefresh();
  }
}
