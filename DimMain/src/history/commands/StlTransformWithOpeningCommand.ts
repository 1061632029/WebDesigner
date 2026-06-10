/**
 * 门窗变换与墙体洞口联动命令
 * 将门窗 Mesh 的位置/旋转/缩放变化、门窗高度类 userData 变化和墙体洞口更新封装为原子操作
 */

import * as THREE from 'three/webgpu';
import type { ICommand } from '../ICommand';
import type { TransformSnapshot } from './TransformCommand';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';
import type { StraightWallData, WallOpening } from '../../building/BuildingTypes';

/**
 * 门窗属性快照
 * 用于撤销/重做时同步恢复窗台高度或门底高度等与变换相关的数据
 */
export interface StlOpeningUserDataSnapshot {
  /** 窗台高度（m），仅窗户使用 */
  sillHeight?: number;
  /** 门底高度（m），仅门使用 */
  doorBottomHeight?: number;
  /** 门开启方向，仅门使用 */
  doorOpeningDirection?: string;
}

/**
 * 门窗变换与墙体洞口联动命令
 */
export class StlTransformWithOpeningCommand implements ICommand {
  /** 命令标签 */
  public readonly label: string;

  /** 被变换的门窗 Mesh */
  private readonly _mesh: THREE.Mesh;

  /** 变换前的位姿快照 */
  private readonly _beforeTransform: TransformSnapshot;

  /** 变换后的位姿快照 */
  private readonly _afterTransform: TransformSnapshot;

  /** 变换前的门窗属性快照 */
  private readonly _beforeUserData: StlOpeningUserDataSnapshot;

  /** 变换后的门窗属性快照 */
  private readonly _afterUserData: StlOpeningUserDataSnapshot;

  /** 建筑对象管理器，用于更新墙体洞口 */
  private readonly _buildingManager: BuildingObjectManager;

  /** 目标墙体 ID */
  private readonly _wallId: string;

  /** 不包含当前门窗洞口的墙体洞口列表 */
  private readonly _baseOpenings: WallOpening[];

  /** 变换前当前门窗对应的洞口 */
  private readonly _beforeOpening: WallOpening;

  /** 变换后当前门窗对应的洞口 */
  private readonly _afterOpening: WallOpening;

  /** 执行/撤销后刷新属性面板的回调 */
  private readonly _onRefresh: () => void;

  /**
   * @param mesh - 被变换的门窗 Mesh
   * @param beforeTransform - 变换前位姿快照
   * @param afterTransform - 变换后位姿快照
   * @param beforeUserData - 变换前门窗属性快照
   * @param afterUserData - 变换后门窗属性快照
   * @param buildingManager - 建筑对象管理器
   * @param wallId - 目标墙体 ID
   * @param baseOpenings - 不包含当前门窗洞口的墙体洞口列表
   * @param beforeOpening - 变换前当前门窗洞口
   * @param afterOpening - 变换后当前门窗洞口
   * @param onRefresh - 执行/撤销后刷新属性面板的回调
   * @param label - 命令标签
   */
  public constructor(
    mesh: THREE.Mesh,
    beforeTransform: TransformSnapshot,
    afterTransform: TransformSnapshot,
    beforeUserData: StlOpeningUserDataSnapshot,
    afterUserData: StlOpeningUserDataSnapshot,
    buildingManager: BuildingObjectManager,
    wallId: string,
    baseOpenings: WallOpening[],
    beforeOpening: WallOpening,
    afterOpening: WallOpening,
    onRefresh: () => void,
    label: string
  ) {
    this._mesh = mesh;
    this._beforeTransform = StlTransformWithOpeningCommand._cloneTransform(beforeTransform);
    this._afterTransform = StlTransformWithOpeningCommand._cloneTransform(afterTransform);
    this._beforeUserData = { ...beforeUserData };
    this._afterUserData = { ...afterUserData };
    this._buildingManager = buildingManager;
    this._wallId = wallId;
    this._baseOpenings = baseOpenings.map((op: WallOpening): WallOpening => ({ ...op }));
    this._beforeOpening = { ...beforeOpening };
    this._afterOpening = { ...afterOpening };
    this._onRefresh = onRefresh;
    this.label = label;
  }

  /**
   * 执行：应用变换后状态并更新墙体洞口
   */
  public execute(): void {
    StlTransformWithOpeningCommand._applyTransform(this._mesh, this._afterTransform);
    StlTransformWithOpeningCommand._applyUserData(this._mesh, this._afterUserData);
    this._applyOpenings(this._afterOpening);
    this._onRefresh();
  }

  /**
   * 撤销：恢复变换前状态并恢复墙体洞口
   */
  public undo(): void {
    StlTransformWithOpeningCommand._applyTransform(this._mesh, this._beforeTransform);
    StlTransformWithOpeningCommand._applyUserData(this._mesh, this._beforeUserData);
    this._applyOpenings(this._beforeOpening);
    this._onRefresh();
  }

  /**
   * 应用洞口列表：基础洞口 + 当前门窗洞口
   * @param opening - 当前门窗洞口
   */
  private _applyOpenings(opening: WallOpening): void {
    const updatedOpenings: WallOpening[] = this._baseOpenings.map(
      (op: WallOpening): WallOpening => ({ ...op })
    );
    updatedOpenings.push({ ...opening });
    this._buildingManager.updateObject(
      this._wallId,
      { openings: updatedOpenings } as Partial<StraightWallData>
    );
  }

  /**
   * 克隆位姿快照，避免外部对象引用污染命令状态
   * @param snapshot - 原始位姿快照
   */
  private static _cloneTransform(snapshot: TransformSnapshot): TransformSnapshot {
    return {
      position: { x: snapshot.position.x, y: snapshot.position.y, z: snapshot.position.z },
      rotation: { x: snapshot.rotation.x, y: snapshot.rotation.y, z: snapshot.rotation.z },
      scale: { x: snapshot.scale.x, y: snapshot.scale.y, z: snapshot.scale.z },
    };
  }

  /**
   * 将位姿快照应用到 Mesh
   * @param mesh - 目标 Mesh
   * @param snapshot - 位姿快照
   */
  private static _applyTransform(mesh: THREE.Mesh, snapshot: TransformSnapshot): void {
    mesh.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
    mesh.rotation.set(snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z);
    mesh.scale.set(snapshot.scale.x, snapshot.scale.y, snapshot.scale.z);
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
  }

  /**
   * 将门窗属性快照写回 Mesh.userData
   * @param mesh - 目标 Mesh
   * @param snapshot - 门窗属性快照
   */
  private static _applyUserData(mesh: THREE.Mesh, snapshot: StlOpeningUserDataSnapshot): void {
    if (snapshot.sillHeight !== undefined) {
      mesh.userData['sillHeight'] = snapshot.sillHeight;
    }
    if (snapshot.doorBottomHeight !== undefined) {
      mesh.userData['doorBottomHeight'] = snapshot.doorBottomHeight;
    }
    if (snapshot.doorOpeningDirection !== undefined) {
      mesh.userData['doorOpeningDirection'] = snapshot.doorOpeningDirection;
    }
  }
}