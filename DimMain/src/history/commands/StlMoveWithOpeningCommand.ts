/**
 * 门窗移动+墙体洞口重算复合命令
 * 将"移动门窗 Mesh 位姿"和"重算墙体洞口"合并为一个原子操作
 * execute：应用 after 位姿 + 更新洞口为新位置计算结果
 * undo：还原 before 位姿 + 恢复旧洞口列表
 * 保证撤销/重做时 Mesh 位置与墙洞始终同步
 */

import * as THREE from 'three/webgpu';
import type { ICommand } from '../ICommand';
import type { TransformSnapshot } from './TransformCommand';
import type { WallOpening, StraightWallData } from '../../building/BuildingTypes';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';

/**
 * 门窗移动+墙体洞口重算复合命令
 */
export class StlMoveWithOpeningCommand implements ICommand {
  /** 命令标签 */
  public readonly label: string;

  /** 被移动的门窗 Mesh */
  private readonly _mesh: THREE.Mesh;

  /** 移动前的位姿快照 */
  private readonly _before: TransformSnapshot;

  /** 移动后的位姿快照（已投影到墙线上） */
  private readonly _after: TransformSnapshot;

  /** 建筑对象管理器（用于更新墙体洞口数据） */
  private readonly _buildingManager: BuildingObjectManager;

  /** 目标墙体 ID */
  private readonly _wallId: string;

  /** 移动前的洞口列表快照（用于 undo 恢复） */
  private readonly _oldOpenings: WallOpening[];

  /** 移动后重新计算的洞口参数（用于 execute 更新） */
  private readonly _newOpening: WallOpening;

  /**
   * @param mesh - 被移动的门窗 Mesh
   * @param before - 移动前位姿快照
   * @param after - 移动后位姿快照（已投影到墙线上）
   * @param buildingManager - 建筑对象管理器
   * @param wallId - 目标墙体 ID
   * @param oldOpenings - 移动前的洞口列表快照（深拷贝）
   * @param newOpening - 移动后重新计算的洞口参数
   * @param label - 命令标签
   */
  public constructor(
    mesh: THREE.Mesh,
    before: TransformSnapshot,
    after: TransformSnapshot,
    buildingManager: BuildingObjectManager,
    wallId: string,
    oldOpenings: WallOpening[],
    newOpening: WallOpening,
    label?: string
  ) {
    this._mesh = mesh;
    this._before = before;
    this._after = after;
    this._buildingManager = buildingManager;
    this._wallId = wallId;
    /* 深拷贝旧洞口列表，防止外部修改影响 undo 结果 */
    this._oldOpenings = oldOpenings.map((op: WallOpening): WallOpening => ({ ...op }));
    this._newOpening = { ...newOpening };
    this.label = label !== undefined ? label : `移动门窗 "${mesh.name}"`;
  }

  /**
   * 执行：应用 after 位姿 + 更新墙体洞口为新计算结果
   */
  public execute(): void {
    /* 应用移动后位姿 */
    StlMoveWithOpeningCommand._applySnapshot(this._mesh, this._after);

    /* 更新墙体洞口：用旧洞口列表中移除本门窗对应洞口，再追加新洞口
     * 策略：将旧洞口列表中与 _before 位置对应的洞口替换为新洞口
     * 简化实现：直接用 oldOpenings 追加 newOpening（与 StlPlaceWithOpeningCommand 一致）
     * 注意：oldOpenings 是放置时的快照，不含本次移动前的洞口
     * 因此 execute 时需要用 oldOpenings + newOpening 替换当前洞口列表
     */
    const updatedOpenings: WallOpening[] = [...this._oldOpenings, this._newOpening];
    this._buildingManager.updateObject(
      this._wallId,
      { openings: updatedOpenings } as Partial<StraightWallData>
    );

    console.log(
      `[StlMoveWithOpeningCommand] 执行: 移动 ${this._mesh.name}, ` +
      `墙体=${this._wallId}, 新洞口 t=${this._newOpening.centerT.toFixed(3)}`
    );
  }

  /**
   * 撤销：还原 before 位姿 + 恢复旧洞口列表
   */
  public undo(): void {
    /* 还原移动前位姿 */
    StlMoveWithOpeningCommand._applySnapshot(this._mesh, this._before);

    /* 恢复旧洞口列表（深拷贝，防止后续操作污染） */
    const restoredOpenings: WallOpening[] = this._oldOpenings.map(
      (op: WallOpening): WallOpening => ({ ...op })
    );
    this._buildingManager.updateObject(
      this._wallId,
      { openings: restoredOpenings } as Partial<StraightWallData>
    );

    console.log(
      `[StlMoveWithOpeningCommand] 撤销: 还原 ${this._mesh.name}, ` +
      `墙体=${this._wallId} 洞口恢复为 ${restoredOpenings.length} 个`
    );
  }

  /**
   * 将位姿快照应用到目标对象
   */
  private static _applySnapshot(target: THREE.Object3D, snapshot: TransformSnapshot): void {
    target.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
    target.rotation.set(snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z);
    target.scale.set(snapshot.scale.x, snapshot.scale.y, snapshot.scale.z);
    target.updateMatrix();
    target.updateMatrixWorld(true);
  }
}
