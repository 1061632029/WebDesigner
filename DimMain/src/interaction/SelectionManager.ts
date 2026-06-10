/**
 * 选择管理器
 * 维护建筑对象的选中状态，提供选择/取消选择/批量删除等操作
 * 通过修改 Mesh 子对象（线框）的颜色实现选中高亮
 */

import * as THREE from 'three/webgpu';
import type { BuildingObjectManager } from '../building/BuildingObjectManager';
import type { CommandHistoryManager } from '../history/CommandHistoryManager';
import { DeleteCommand } from '../history/commands/DeleteCommand';
import { StlDeleteCommand } from '../history/commands/StlDeleteCommand';
import { StlDeleteWithOpeningCommand } from '../history/commands/StlDeleteWithOpeningCommand';
import { BoundingBoxHelper } from './BoundingBoxHelper';
import type { ViewMode } from '../react/context/ViewModeContext';
import type { WallData, StraightWallData, WallOpening } from '../building/BuildingTypes';

/** 选中状态变更回调 */
export type SelectionChangeCallback = (selectedIds: ReadonlySet<string>) => void;

/** 选中高亮线框颜色（亮蓝） */
const HIGHLIGHT_COLOR: number = 0x44aaff;

/** 默认线框颜色（深灰） */
const DEFAULT_WIREFRAME_COLOR: number = 0x333333;

/** 选中高亮自发光颜色（蓝色） */
const HIGHLIGHT_EMISSIVE_COLOR: number = 0x2255cc;

/** 选中高亮自发光强度 */
const HIGHLIGHT_EMISSIVE_INTENSITY: number = 0.9;

/** 默认自发光颜色（无发光） */
const DEFAULT_EMISSIVE_COLOR: number = 0x00;

/** 默认自发光强度 */
const DEFAULT_EMISSIVE_INTENSITY: number = 0.2;

/**
 * 选择管理器
 */
export class SelectionManager {
  /** 建筑对象管理器引用 */
  private _objectManager: BuildingObjectManager;

  /** Three.js 场景引用（包围盒 Group 挂载到场景根节点） */
  private _scene: THREE.Scene | null = null;

  /** 当前选中的对象 ID 集合 */
  private _selectedIds: Set<string> = new Set<string>();

  /** 状态变更监听器集合 */
  private _listeners: Set<SelectionChangeCallback> = new Set<SelectionChangeCallback>();

  /** 当前选中的 STL 模型 Mesh（与建筑对象选中互斥） */
  private _selectedStlMesh: THREE.Mesh | null = null;

  /** STL 选中状态变更监听器集合 */
  private _stlListeners: Set<(mesh: THREE.Mesh | null) => void> = new Set<(mesh: THREE.Mesh | null) => void>();

  /**
   * @param objectManager - 建筑对象管理器
   */
  constructor(objectManager: BuildingObjectManager) {
    this._objectManager = objectManager;
  }

  /**
   * 注入 Three.js 场景引用
   * 包围盒 Group 挂载到场景根节点，需在使用包围盒功能前调用
   * @param scene - Three.js 场景
   */
  public setScene(scene: THREE.Scene): void {
    this._scene = scene;
  }

  /* ========== 选择操作 ========== */

  /**
   * 选中单个对象（替换当前选择）
   * @param id - 对象 ID
   */
  public select(id: string): void {
    this.clearSelection();
    this._addToSelection(id);
    this._notify();
  }

  /**
   * 切换单个对象的选中状态（多选追加/取消）
   * @param id - 对象 ID
   */
  public toggleSelect(id: string): void {
    if (this._selectedIds.has(id)) {
      this._removeFromSelection(id);
    } else {
      this._addToSelection(id);
    }
    this._notify();
  }

  /**
   * 批量选中多个对象（替换当前选择）
   * @param ids - 对象 ID 数组
   */
  public selectMultiple(ids: ReadonlyArray<string>): void {
    this.clearSelection();
    for (const id of ids) {
      this._addToSelection(id);
    }
    this._notify();
  }

  /**
   * 追加多个对象到当前选择
   * @param ids - 对象 ID 数组
   */
  public addMultiple(ids: ReadonlyArray<string>): void {
    for (const id of ids) {
      this._addToSelection(id);
    }
    this._notify();
  }

  /**
   * 清空选择（同时清除建筑对象和 STL 模型的选中状态）
   */
  public clearSelection(): void {
    /* 清除 STL 模型选中 */
    this._clearStlSelection();

    if (this._selectedIds.size === 0) {
      return;
    }
    /* 恢复所有选中对象的线框颜色 */
    this._selectedIds.forEach((id: string): void => {
      this._applyHighlight(id, false);
    });
    this._selectedIds.clear();
    this._notify();
  }

  /**
   * 删除所有选中的建筑对象（通过命令栈，支持撤销/重做）
   * @param historyManager - 命令历史管理器
   * @returns 被删除的对象 ID 数组
   */
  public deleteSelected(historyManager: CommandHistoryManager): Array<string> {
    const idsToDelete: Array<string> = Array.from(this._selectedIds);
    if (idsToDelete.length === 0) {
      return [];
    }

    /* 先清空选择集合（避免高亮逻辑访问已删除对象） */
    this._selectedIds.clear();
    this._notify();

    /* 通过命令栈删除每个建筑对象（支持撤销/重做） */
    for (const id of idsToDelete) {
      try {
        const cmd: DeleteCommand = new DeleteCommand(this._objectManager, id);
        historyManager.execute(cmd);
      } catch (err: unknown) {
        console.warn(`[SelectionManager] 删除对象 ${id} 失败:`, err);
      }
    }

    return idsToDelete;
  }

  /**
   * 删除当前选中的 STL 模型（通过命令栈，支持撤销/重做）
   * 若模型为门窗类型（userData 含 wallId），同时还原墙体洞口，使用复合命令保证原子性
   * @param scene - Three.js 场景（用于从场景移除 Mesh）
   * @param historyManager - 命令历史管理器
   * @param buildingManager - 建筑对象管理器（可选，门窗删除时用于还原洞口）
   * @returns 是否成功删除
   */
  public deleteSelectedStl(
    scene: THREE.Scene,
    historyManager: CommandHistoryManager,
    buildingManager?: BuildingObjectManager | null
  ): boolean {
    if (this._selectedStlMesh === null) {
      return false;
    }

    const meshToDelete: THREE.Mesh = this._selectedStlMesh;

    /* 先清除选中状态（取消高亮） */
    this._clearStlSelection();

    /* 判断是否为门窗类型（含 wallId 和 snapT） */
    const wallId: string | undefined = meshToDelete.userData['wallId'] as string | undefined;
    const snapT: number | undefined = meshToDelete.userData['snapT'] as number | undefined;

    if (
      wallId !== undefined &&
      snapT !== undefined &&
      buildingManager !== undefined &&
      buildingManager !== null
    ) {
      /* 门窗类型：读取当前墙体洞口列表快照，使用复合命令（删除 Mesh + 还原洞口） */
      const wallObj: unknown = buildingManager.getById(wallId);
      const oldOpenings: WallOpening[] =
        wallObj !== undefined &&
        (wallObj as WallData).category === 'wall' &&
        (wallObj as WallData).subType === 'straight'
          ? ((wallObj as StraightWallData).openings ?? []).map(
              (op: WallOpening): WallOpening => ({ ...op })
            )
          : [];

      const cmd: StlDeleteWithOpeningCommand = new StlDeleteWithOpeningCommand(
        scene,
        meshToDelete,
        buildingManager,
        wallId,
        snapT,
        oldOpenings,
        `删除门窗 "${meshToDelete.name}"`
      );
      historyManager.execute(cmd);
      console.log(`🗑️ 门窗已删除并还原洞口: "${meshToDelete.name}" 墙体=${wallId}`);
      return true;
    }

    /* 普通 STL 模型：使用原有 StlDeleteCommand */
    const cmd: StlDeleteCommand = new StlDeleteCommand(
      scene,
      meshToDelete,
      `删除 STL 模型 "${meshToDelete.name}"`
    );
    historyManager.execute(cmd);

    console.log(`🗑️ STL 模型已删除: "${meshToDelete.name}"`);
    return true;
  }

  /* ========== 查询 ========== */

  /**
   * 获取当前选中的对象 ID 集合（只读快照）
   */
  public get selectedIds(): ReadonlySet<string> {
    return this._selectedIds;
  }

  /**
   * 是否有对象被选中
   */
  public get hasSelection(): boolean {
    return this._selectedIds.size > 0;
  }

  /* ========== STL 模型选中操作 ========== */

  /**
   * 选中 STL 模型 Mesh（替换当前所有选择）
   * 在 2D 模式下同时附加平面投影包围盒
   * @param mesh - STL 模型的 Three.js Mesh
   * @param viewMode - 当前视图模式（2D 模式下显示包围盒）
   */
  public selectStl(mesh: THREE.Mesh, viewMode: ViewMode = '3d'): void {
    /* 先清空建筑对象选择 */
    if (this._selectedIds.size > 0) {
      this._selectedIds.forEach((id: string): void => {
        this._applyHighlight(id, false);
      });
      this._selectedIds.clear();
      this._notify();
    }

    /* 清除旧 STL 选中 */
    this._clearStlSelection();

    /* 应用新 STL 选中 */
    this._selectedStlMesh = mesh;
    this._applyStlHighlight(mesh, true, viewMode);
    this._notifyStlListeners();
  }

  /**
   * 切换 STL 模型的选中状态
   * 在 2D 模式下同时附加/移除平面投影包围盒
   * @param mesh - STL 模型的 Three.js Mesh
   * @param viewMode - 当前视图模式（2D 模式下显示包围盒）
   */
  public toggleSelectStl(mesh: THREE.Mesh, viewMode: ViewMode = '3d'): void {
    if (this._selectedStlMesh !== null && this._selectedStlMesh.uuid === mesh.uuid) {
      /* 已选中 → 取消 */
      this._clearStlSelection();
    } else {
      /* 未选中 → 选中 */
      this._clearStlSelection();
      this._selectedStlMesh = mesh;
      this._applyStlHighlight(mesh, true, viewMode);
      this._notifyStlListeners();
    }
  }

  /**
   * 获取当前选中的 STL Mesh（null 表示未选中 STL）
   */
  public get selectedStlMesh(): THREE.Mesh | null {
    return this._selectedStlMesh;
  }

  /**
   * 主动刷新当前 STL 选中监听器。
   * 用于选中对象的 userData 属性在不切换选择对象的情况下变化时，同步刷新属性面板。
   */
  public refreshSelectedStl(): void {
    this._notifyStlListeners();
  }

  /**
   * 订阅 STL 选中状态变更
   * @param callback - 回调（参数为选中的 Mesh 或 null）
   * @returns 取消订阅函数
   */
  public onStlChange(callback: (mesh: THREE.Mesh | null) => void): () => void {
    this._stlListeners.add(callback);
    return (): void => {
      this._stlListeners.delete(callback);
    };
  }

  /**
   * 清除 STL 模型选中状态
   */
  private _clearStlSelection(): void {
    if (this._selectedStlMesh !== null) {
      this._applyStlHighlight(this._selectedStlMesh, false);
      this._selectedStlMesh = null;
      this._notifyStlListeners();
    }
  }

  /**
   * 应用/取消 STL Mesh 的高亮效果
   * 在 2D 模式下同时附加/移除平面投影包围盒
   * @param mesh - STL 模型 Mesh
   * @param highlighted - 是否高亮
   * @param viewMode - 当前视图模式（2D 模式下显示包围盒），默认 3D
   */
  private _applyStlHighlight(mesh: THREE.Mesh, highlighted: boolean, viewMode: ViewMode = '3d'): void {
    const emissiveColor: number = highlighted ? HIGHLIGHT_EMISSIVE_COLOR : DEFAULT_EMISSIVE_COLOR;
    const emissiveIntensity: number = highlighted ? HIGHLIGHT_EMISSIVE_INTENSITY : DEFAULT_EMISSIVE_INTENSITY;
    this._applyEmissiveToMaterial(mesh.material, emissiveColor, emissiveIntensity);

    /* 2D 模式下附加/移除平面投影包围盒（挂载到场景根节点，需 scene 引用） */
    if (this._scene === null) {
      return;
    }
    const scene: THREE.Scene = this._scene;

    if (viewMode === '2d') {
      if (highlighted) {
        /* 选中时附加完整包围盒（边线 + 控制点，需等 Mesh 矩阵更新后计算 AABB） */
        mesh.updateMatrixWorld(true);
        BoundingBoxHelper.attachFull(mesh, scene);
      } else {
        /* 取消选中时移除包围盒 */
        BoundingBoxHelper.detach(mesh, scene);
      }
    } else {
      /* 切换到 3D 模式时确保移除包围盒 */
      BoundingBoxHelper.detach(mesh, scene);
    }
  }

  /**
   * 通知 STL 选中监听器
   */
  private _notifyStlListeners(): void {
    const mesh: THREE.Mesh | null = this._selectedStlMesh;
    this._stlListeners.forEach((cb: (m: THREE.Mesh | null) => void): void => {
      cb(mesh);
    });
  }

  /**
   * 销毁管理器，清空状态和监听器
   */
  public dispose(): void {
    this.clearSelection();
    this._listeners.clear();
    this._stlListeners.clear();
  }

  /* ========== 事件订阅 ========== */

  /**
   * 订阅选中状态变更事件
   * @param callback - 回调函数
   * @returns 取消订阅函数
   */
  public onChange(callback: SelectionChangeCallback): () => void {
    this._listeners.add(callback);
    return (): void => {
      this._listeners.delete(callback);
    };
  }

  /* ========== 内部方法 ========== */

  /**
   * 将对象加入选择集合并应用高亮
   */
  private _addToSelection(id: string): void {
    if (this._selectedIds.has(id)) {
      return;
    }
    this._selectedIds.add(id);
    this._applyHighlight(id, true);
  }

  /**
   * 从选择集合移除对象并恢复线框颜色
   */
  private _removeFromSelection(id: string): void {
    if (!this._selectedIds.has(id)) {
      return;
    }
    this._selectedIds.delete(id);
    this._applyHighlight(id, false);
  }

  /**
   * 应用/取消选中高亮
   * 双层高亮：Mesh 本体材质 emissive 自发光 + 子对象 LineSegments 线框颜色
   * @param id - 对象 ID
   * @param highlighted - 是否高亮
   */
  private _applyHighlight(id: string, highlighted: boolean): void {
    const mesh: THREE.Mesh | undefined = this._objectManager.getMeshById(id);
    if (mesh === undefined) {
      return;
    }

    /* ===== 1. Mesh 本体材质 emissive 自发光 ===== */
    const emissiveColor: number = highlighted ? HIGHLIGHT_EMISSIVE_COLOR : DEFAULT_EMISSIVE_COLOR;
    const emissiveIntensity: number = highlighted ? HIGHLIGHT_EMISSIVE_INTENSITY : DEFAULT_EMISSIVE_INTENSITY;
    this._applyEmissiveToMaterial(mesh.material, emissiveColor, emissiveIntensity);

    /* ===== 2. 子对象 LineSegments 线框颜色 ===== */
    for (const child of mesh.children) {
      if (child instanceof THREE.LineSegments) {
        const lineMaterial: THREE.LineBasicMaterial = child.material as THREE.LineBasicMaterial;
        const targetColor: number = highlighted ? HIGHLIGHT_COLOR : DEFAULT_WIREFRAME_COLOR;
        lineMaterial.color.setHex(targetColor);
        lineMaterial.needsUpdate = true;
      }
    }
  }

  /**
   * 对材质设置 emissive 自发光属性
   * 支持单材质和材质数组两种情况
   * @param material - Mesh 的材质（单个或数组）
   * @param emissiveHex - 自发光颜色 Hex 值
   * @param intensity - 自发光强度
   */
  private _applyEmissiveToMaterial(
    material: THREE.Material | THREE.Material[],
    emissiveHex: number,
    intensity: number
  ): void {
    /* 材质数组：遍历每个材质逐一设置 */
    if (Array.isArray(material)) {
      for (const mat of material) {
        this._setEmissiveOnSingleMaterial(mat, emissiveHex, intensity);
      }
    } else {
      /* 单材质 */
      this._setEmissiveOnSingleMaterial(material, emissiveHex, intensity);
    }
  }

  /**
   * 对单个材质设置 emissive 属性
   * 仅对包含 emissive 属性的材质类型生效（MeshStandardMaterial / MeshPhongMaterial 等）
   * @param material - 单个材质对象
   * @param emissiveHex - 自发光颜色 Hex 值
   * @param intensity - 自发光强度
   */
  private _setEmissiveOnSingleMaterial(
    material: THREE.Material,
    emissiveHex: number,
    intensity: number
  ): void {
    /* 检测材质是否具有 emissive 属性 */
    if ('emissive' in material && 'emissiveIntensity' in material) {
      const emissiveMat = material as THREE.MeshStandardMaterial;
      emissiveMat.emissive.setHex(emissiveHex);
      emissiveMat.emissiveIntensity = intensity;
      emissiveMat.needsUpdate = true;
    }
  }

  /**
   * 检查指定对象是否被选中
   * @param id - 对象 ID
   */
  public isSelected(id: string): boolean {
    return this._selectedIds.has(id);
  }

  /**
   * 通知所有监听器
   */
  private _notify(): void {
    /* 复制只读快照传递给监听器 */
    const snapshot: ReadonlySet<string> = new Set<string>(this._selectedIds);
    this._listeners.forEach((cb: SelectionChangeCallback): void => {
      cb(snapshot);
    });
  }
}
