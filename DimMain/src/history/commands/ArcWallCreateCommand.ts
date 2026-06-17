/**
 * 弧形墙创建命令
 * execute：添加指定弧形墙数据；undo：移除该弧形墙。
 * 用于将交互式弧形墙绘制纳入统一撤销/重做命令栈。
 */

import * as THREE from 'three/webgpu';
import type { ICommand } from '../ICommand';
import type { ArcWallData } from '../../building/BuildingTypes';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';
import { WallCascadeDeleteCommand } from './WallCascadeDeleteCommand';

/** 弧形墙创建命令生命周期回调集合。 */
export interface ArcWallCreateCommandCallbacks {
  /**
   * 创建或重做后触发，用于恢复与弧形墙绑定的外部可视状态。
   * @param wallData - 已创建或已恢复的弧形墙数据快照
   */
  onCreated?: (wallData: ArcWallData) => void;

  /**
   * 撤销创建后触发，用于清理与弧形墙绑定的外部可视状态。
   * @param wallId - 被撤销的弧形墙 ID
   */
  onRemoved?: (wallId: string) => void;
}

/**
 * 弧形墙创建命令
 * 持有弧形墙数据快照，确保撤销后重做仍恢复同一 ID 与同一几何参数。
 */
export class ArcWallCreateCommand implements ICommand {
  /** 命令标签，用于历史 UI 展示 */
  public readonly label: string = '创建弧形墙';

  /** 建筑对象管理器引用 */
  private readonly _manager: BuildingObjectManager;

  /** Three.js 场景引用，用于撤销创建时检测并移除墙体依赖的门窗 STL。 */
  private readonly _scene: THREE.Scene;

  /** 弧形墙数据快照 */
  private readonly _wallData: ArcWallData;

  /** 命令生命周期回调集合，用于同步半径标注等外部状态。 */
  private readonly _callbacks: ArcWallCreateCommandCallbacks | null;

  /** 最近一次撤销创建时生成的墙体级联删除命令。 */
  private _cascadeDeleteCommand: WallCascadeDeleteCommand | null = null;

  /**
   * @param manager - 建筑对象管理器
   * @param scene - Three.js 场景
   * @param wallData - 待创建的弧形墙数据
   * @param callbacks - 创建/移除后的外部状态同步回调
   */
  public constructor(
    manager: BuildingObjectManager,
    scene: THREE.Scene,
    wallData: ArcWallData,
    callbacks: ArcWallCreateCommandCallbacks | null = null
  ) {
    this._manager = manager;
    this._scene = scene;
    this._wallData = ArcWallCreateCommand._cloneWallData(wallData);
    this._callbacks = callbacks;
  }

  /**
   * 执行创建流程
   * 关键逻辑：向 BuildingObjectManager 添加弧形墙数据副本，由管理器负责创建 Mesh、连接端点与通知监听器。
   */
  public execute(): void {
    if (this._cascadeDeleteCommand !== null) {
      /* 重做创建时优先恢复撤销阶段级联删除的完整依赖快照，避免门窗等依赖对象丢失。 */
      this._cascadeDeleteCommand.undo();
      this._cascadeDeleteCommand = null;
      this._notifyCreated();
      return;
    }

    this._manager.addObject(ArcWallCreateCommand._cloneWallData(this._wallData));
    this._notifyCreated();
  }

  /**
   * 撤销创建流程
   * 关键逻辑：通过墙体级联删除命令移除弧形墙，确保楼板、天花板、门窗等依赖对象同步处理。
   */
  public undo(): void {
    /* 撤销墙体布置时必须检测依赖，避免直接删除墙体导致依赖构件残留。 */
    const cascadeDeleteCommand: WallCascadeDeleteCommand = new WallCascadeDeleteCommand(
      this._manager,
      this._scene,
      [this._wallData.id]
    );
    cascadeDeleteCommand.execute();
    this._cascadeDeleteCommand = cascadeDeleteCommand;
    this._notifyRemoved();
  }

  /**
   * 释放撤销创建时被级联删除的门窗 STL 资源。
   */
  public dispose(): void {
    if (this._cascadeDeleteCommand !== null) {
      this._cascadeDeleteCommand.dispose();
      this._cascadeDeleteCommand = null;
    }
  }

  /**
   * 通知外部弧形墙已经创建或恢复。
   */
  private _notifyCreated(): void {
    if (this._callbacks !== null && this._callbacks.onCreated !== undefined) {
      this._callbacks.onCreated(ArcWallCreateCommand._cloneWallData(this._wallData));
    }
  }

  /**
   * 通知外部弧形墙已经被撤销移除。
   */
  private _notifyRemoved(): void {
    if (this._callbacks !== null && this._callbacks.onRemoved !== undefined) {
      this._callbacks.onRemoved(this._wallData.id);
    }
  }

  /**
   * 深拷贝弧形墙数据
   * @param wallData - 原始弧形墙数据
   * @returns 克隆后的弧形墙数据
   */
  private static _cloneWallData(wallData: ArcWallData): ArcWallData {
    return JSON.parse(JSON.stringify(wallData)) as ArcWallData;
  }
}