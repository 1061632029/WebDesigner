/**
 * 直墙创建命令
 * execute：添加指定直墙数据；undo：移除该直墙。
 * 用于将交互式直墙绘制纳入统一撤销/重做命令栈。
 */

import * as THREE from 'three/webgpu';
import type { ICommand } from '../ICommand';
import type { StraightWallData } from '../../building/BuildingTypes';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';
import { WallCascadeDeleteCommand } from './WallCascadeDeleteCommand';

/**
 * 直墙创建命令
 * 持有直墙数据快照，确保撤销后重做仍恢复同一 ID 与同一几何参数。
 */
export class StraightWallCreateCommand implements ICommand {
  /** 命令标签，用于历史 UI 展示 */
  public readonly label: string = '创建直墙';

  /** 建筑对象管理器引用 */
  private readonly _manager: BuildingObjectManager;

  /** Three.js 场景引用，用于撤销创建时检测并移除墙体依赖的门窗 STL。 */
  private readonly _scene: THREE.Scene;

  /** 直墙数据快照 */
  private readonly _wallData: StraightWallData;

  /** 最近一次撤销创建时生成的墙体级联删除命令。 */
  private _cascadeDeleteCommand: WallCascadeDeleteCommand | null = null;

  /**
   * @param manager - 建筑对象管理器
   * @param scene - Three.js 场景
   * @param wallData - 待创建的直墙数据
   */
  public constructor(manager: BuildingObjectManager, scene: THREE.Scene, wallData: StraightWallData) {
    this._manager = manager;
    this._scene = scene;
    this._wallData = StraightWallCreateCommand._cloneWallData(wallData);
  }

  /**
   * 执行创建流程
   * 关键逻辑：向 BuildingObjectManager 添加直墙数据副本，由管理器负责创建 Mesh、连接端点与通知监听器。
   */
  public execute(): void {
    if (this._cascadeDeleteCommand !== null) {
      /* 重做创建时优先恢复撤销阶段级联删除的完整依赖快照，避免门窗等依赖对象丢失。 */
      this._cascadeDeleteCommand.undo();
      this._cascadeDeleteCommand = null;
      return;
    }

    this._manager.addObject(StraightWallCreateCommand._cloneWallData(this._wallData));
  }

  /**
   * 撤销创建流程
   * 关键逻辑：通过墙体级联删除命令移除直墙，确保楼板、天花板、门窗等依赖对象同步处理。
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
   * 深拷贝直墙数据
   * @param wallData - 原始直墙数据
   * @returns 克隆后的直墙数据
   */
  private static _cloneWallData(wallData: StraightWallData): StraightWallData {
    return JSON.parse(JSON.stringify(wallData)) as StraightWallData;
  }
}