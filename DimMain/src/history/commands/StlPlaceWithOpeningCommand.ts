/**
 * 门窗放置+墙体扣洞复合命令
 * 将"放置门窗 Mesh 到场景"和"在目标墙体上开洞"合并为一个原子操作
 * execute：放置 Mesh + 追加洞口；undo：移除 Mesh + 恢复旧洞口列表
 * 保证撤销/重做时两者状态始终同步
 */

import * as THREE from 'three/webgpu';
import type { ICommand } from '../ICommand';
import type { WallOpening } from '../../building/BuildingTypes';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';
import type { StraightWallData } from '../../building/BuildingTypes';

/**
 * 门窗放置+墙体扣洞复合命令
 */
export class StlPlaceWithOpeningCommand implements ICommand {
  /** 命令标签 */
  public readonly label: string;

  /** 目标场景引用 */
  private readonly _scene: THREE.Scene;

  /** 被放置的门窗 Mesh（持有引用，不 dispose，供 undo/redo 复用） */
  private readonly _mesh: THREE.Mesh;

  /** 建筑对象管理器（用于更新墙体洞口数据） */
  private readonly _buildingManager: BuildingObjectManager;

  /** 目标墙体 ID */
  private readonly _wallId: string;

  /** 新增的洞口参数 */
  private readonly _newOpening: WallOpening;

  /**
   * 扣洞前的洞口列表快照（用于 undo 恢复）
   * 在构造时从墙体数据中读取，保证 undo 能精确还原
   */
  private readonly _oldOpenings: WallOpening[];

  /**
   * @param scene - Three.js 场景
   * @param mesh - 已创建好的门窗 Mesh（放置前已设置好位置、旋转、缩放）
   * @param buildingManager - 建筑对象管理器
   * @param wallId - 目标墙体 ID
   * @param newOpening - 新增的洞口参数（由 WallOpeningCutter.computeOpening 计算）
   * @param oldOpenings - 扣洞前的洞口列表快照
   * @param label - 命令标签
   */
  public constructor(
    scene: THREE.Scene,
    mesh: THREE.Mesh,
    buildingManager: BuildingObjectManager,
    wallId: string,
    newOpening: WallOpening,
    oldOpenings: WallOpening[],
    label?: string
  ) {
    this._scene = scene;
    this._mesh = mesh;
    this._buildingManager = buildingManager;
    this._wallId = wallId;
    this._newOpening = newOpening;
    /* 深拷贝旧洞口列表，防止外部修改影响 undo 结果 */
    this._oldOpenings = oldOpenings.map((op: WallOpening): WallOpening => ({ ...op }));
    this.label = label !== undefined ? label : `放置门窗 "${mesh.name}"`;
  }

  /**
   * 执行：放置 Mesh 到场景 + 在墙体上追加洞口
   */
  public execute(): void {
    /* 放置 Mesh */
    this._scene.add(this._mesh);

    /* 追加洞口到墙体（在旧洞口列表基础上追加新洞口） */
    const newOpenings: WallOpening[] = [...this._oldOpenings, this._newOpening];
    this._buildingManager.updateObject(
      this._wallId,
      { openings: newOpenings } as Partial<StraightWallData>
    );

    console.log(
      `[StlPlaceWithOpeningCommand] 执行: 放置 ${this._mesh.name}, ` +
      `墙体=${this._wallId}, 洞口 t=${this._newOpening.centerT.toFixed(3)}`
    );
  }

  /**
   * 撤销：从场景移除 Mesh + 恢复墙体旧洞口列表
   * Mesh 不 dispose，保留 GPU 资源供 redo 恢复
   */
  public undo(): void {
    /* 移除 Mesh */
    this._scene.remove(this._mesh);

    /* 恢复墙体旧洞口列表（深拷贝，防止后续操作污染） */
    const restoredOpenings: WallOpening[] = this._oldOpenings.map(
      (op: WallOpening): WallOpening => ({ ...op })
    );
    this._buildingManager.updateObject(
      this._wallId,
      { openings: restoredOpenings } as Partial<StraightWallData>
    );

    console.log(
      `[StlPlaceWithOpeningCommand] 撤销: 移除 ${this._mesh.name}, ` +
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
    console.log(`[StlPlaceWithOpeningCommand] 释放 Mesh GPU 资源: ${this._mesh.name}`);
  }
}
