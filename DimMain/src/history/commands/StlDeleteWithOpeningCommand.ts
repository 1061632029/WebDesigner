/**
 * 门窗删除+墙体洞口还原复合命令
 * 将"从场景移除门窗 Mesh"和"还原目标墙体洞口列表"合并为一个原子操作
 * execute：移除 Mesh + 从洞口列表中删除对应洞口；undo：重新放置 Mesh + 恢复旧洞口列表
 * 保证撤销/重做时两者状态始终同步
 */

import * as THREE from 'three/webgpu';
import type { ICommand } from '../ICommand';
import type { WallOpening } from '../../building/BuildingTypes';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';
import type { StraightWallData } from '../../building/BuildingTypes';

/**
 * 门窗删除+墙体洞口还原复合命令
 */
export class StlDeleteWithOpeningCommand implements ICommand {
  /** 命令标签 */
  public readonly label: string;

  /** 目标场景引用 */
  private readonly _scene: THREE.Scene;

  /** 被删除的门窗 Mesh（持有引用，不 dispose，供 undo 恢复） */
  private readonly _mesh: THREE.Mesh;

  /** 建筑对象管理器（用于更新墙体洞口数据） */
  private readonly _buildingManager: BuildingObjectManager;

  /** 目标墙体 ID */
  private readonly _wallId: string;

  /**
   * 删除前的洞口列表快照（用于 undo 恢复）
   * 在构造时从墙体数据中读取，保证 undo 能精确还原
   */
  private readonly _oldOpenings: WallOpening[];

  /**
   * 删除后的洞口列表（移除对应洞口后的结果）
   * 在构造时计算，保证 execute/redo 时能精确应用
   */
  private readonly _newOpenings: WallOpening[];

  /**
   * @param scene - Three.js 场景
   * @param mesh - 待删除的门窗 Mesh
   * @param buildingManager - 建筑对象管理器
   * @param wallId - 目标墙体 ID
   * @param openingCenterT - 要移除的洞口 centerT 值（用于定位洞口）
   * @param oldOpenings - 删除前的洞口列表快照
   * @param label - 命令标签
   */
  public constructor(
    scene: THREE.Scene,
    mesh: THREE.Mesh,
    buildingManager: BuildingObjectManager,
    wallId: string,
    openingCenterT: number,
    oldOpenings: WallOpening[],
    label?: string
  ) {
    this._scene = scene;
    this._mesh = mesh;
    this._buildingManager = buildingManager;
    this._wallId = wallId;
    /* 深拷贝旧洞口列表，防止外部修改影响 undo 结果 */
    this._oldOpenings = oldOpenings.map((op: WallOpening): WallOpening => ({ ...op }));
    /* 计算删除后的洞口列表：移除 centerT 匹配的洞口（允许 0.01 误差） */
    this._newOpenings = this._oldOpenings.filter(
      (op: WallOpening): boolean => Math.abs(op.centerT - openingCenterT) >= 0.01
    );
    this.label = label !== undefined ? label : `删除门窗 "${mesh.name}"`;
  }

  /**
   * 执行：从场景移除 Mesh + 从墙体洞口列表中移除对应洞口
   * Mesh 不 dispose，保留 GPU 资源供 undo 恢复
   */
  public execute(): void {
    /* 从场景移除 Mesh */
    this._scene.remove(this._mesh);

    /* 更新墙体洞口列表（移除对应洞口） */
    this._buildingManager.updateObject(
      this._wallId,
      { openings: this._newOpenings.map((op: WallOpening): WallOpening => ({ ...op })) } as Partial<StraightWallData>
    );

    console.log(
      `[StlDeleteWithOpeningCommand] 执行: 删除 ${this._mesh.name}, ` +
      `墙体=${this._wallId}, 剩余洞口 ${this._newOpenings.length} 个`
    );
  }

  /**
   * 撤销：将 Mesh 重新加入场景 + 恢复墙体旧洞口列表
   */
  public undo(): void {
    /* 重新放置 Mesh */
    this._scene.add(this._mesh);

    /* 恢复墙体旧洞口列表（深拷贝，防止后续操作污染） */
    const restoredOpenings: WallOpening[] = this._oldOpenings.map(
      (op: WallOpening): WallOpening => ({ ...op })
    );
    this._buildingManager.updateObject(
      this._wallId,
      { openings: restoredOpenings } as Partial<StraightWallData>
    );

    console.log(
      `[StlDeleteWithOpeningCommand] 撤销: 恢复 ${this._mesh.name}, ` +
      `墙体=${this._wallId} 洞口恢复为 ${restoredOpenings.length} 个`
    );
  }

  /**
   * 命令被栈丢弃时释放 Mesh 的 GPU 资源
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
    console.log(`[StlDeleteWithOpeningCommand] 释放 Mesh GPU 资源: ${this._mesh.name}`);
  }
}
