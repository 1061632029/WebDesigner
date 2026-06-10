/**
 * STL 模型删除命令
 * execute：从场景移除 Mesh（不 dispose，保留 GPU 资源供 undo 恢复）；undo：将 Mesh 重新加入场景
 * 与 DeleteCommand 的区别：STL 模型不经过 BuildingObjectManager，直接操作 THREE.Scene
 */

import * as THREE from 'three/webgpu';
import type { ICommand } from '../ICommand';

/**
 * STL 模型删除命令
 * 持有 Mesh 引用和 Scene 引用，execute/undo 互为逆操作
 */
export class StlDeleteCommand implements ICommand {
  /** 命令标签 */
  public readonly label: string;

  /** 目标场景引用 */
  private readonly _scene: THREE.Scene;

  /** 被删除的 STL Mesh（持有引用，不 dispose，供 undo 恢复） */
  private readonly _mesh: THREE.Mesh;

  /**
   * @param scene - Three.js 场景
   * @param mesh - 待删除的 STL Mesh
   * @param label - 命令标签
   */
  public constructor(scene: THREE.Scene, mesh: THREE.Mesh, label?: string) {
    this._scene = scene;
    this._mesh = mesh;
    this.label = label !== undefined ? label : `删除 STL 模型 "${mesh.name}"`;
  }

  /**
   * 执行删除：从场景移除 Mesh（不 dispose，保留 GPU 资源供 undo 恢复）
   */
  public execute(): void {
    this._scene.remove(this._mesh);
    console.log(`[StlDeleteCommand] 删除 Mesh: ${this._mesh.name}`);
  }

  /**
   * 撤销删除：将 Mesh 重新加入场景
   */
  public undo(): void {
    this._scene.add(this._mesh);
    console.log(`[StlDeleteCommand] 撤销删除 Mesh: ${this._mesh.name}`);
  }

  /**
   * 命令被栈丢弃时释放 GPU 资源
   * 仅在命令超出历史栈深度上限时调用
   */
  public dispose(): void {
    this._mesh.geometry.dispose();
    const material: THREE.Material | THREE.Material[] = this._mesh.material;
    if (Array.isArray(material)) {
      material.forEach((mat: THREE.Material): void => {
        mat.dispose();
      });
    } else {
      material.dispose();
    }
    console.log(`[StlDeleteCommand] 释放 Mesh GPU 资源: ${this._mesh.name}`);
  }
}
