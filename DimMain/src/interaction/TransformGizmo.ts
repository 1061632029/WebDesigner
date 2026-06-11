/**
 * TransformGizmo
 * 封装 Three.js TransformControls，提供 select / move / rotate / scale 四种模式
 * 与 OrbitControlsWrapper、CommandHistoryManager、SelectionManager 协同工作
 *
 * 职责：
 * - 管理 TransformControls 的生命周期（attach / detach / dispose）
 * - 拖拽开始时 pushSuspend OrbitControls + 记录 before 快照
 * - 拖拽结束时 popSuspend + 提交命令到命令栈
 * - 订阅 SelectionManager 变化，自动 attach/detach
 * - 门窗类型（category=door/window）：禁止旋转模式，移动时重算墙体洞口
 */

import * as THREE from 'three/webgpu';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { OrbitControlsWrapper } from '../camera/OrbitControlsWrapper';
import type { CommandHistoryManager } from '../history/CommandHistoryManager';
import type { SelectionManager } from './SelectionManager';
import type { BuildingObjectManager } from '../building/BuildingObjectManager';
import { TransformCommand } from '../history/commands/TransformCommand';
import type { TransformSnapshot } from '../history/commands/TransformCommand';
import { StlMoveWithOpeningCommand } from '../history/commands/StlMoveWithOpeningCommand';
import { WallSnapHelper } from '../building/WallSnapHelper';
import { WallOpeningCutter } from '../building/WallOpeningCutter';
import type { WallSnapResult } from '../building/WallSnapHelper';
import type { WallData, StraightWallData, WallOpening } from '../building/BuildingTypes';
import { DoorWindowCollisionDetector } from '../model/DoorWindowCollisionDetector';
import { DoorWindow2DSymbolHelper } from '../model/DoorWindow2DSymbolHelper';
import { DoorWindowPlacementDimensionRenderer } from '../model/DoorWindowPlacementDimensionRenderer';

/** Gizmo 工具模式 */
export type GizmoMode = 'select' | 'move' | 'rotate' | 'scale';

/** 模式变更回调 */
export type GizmoModeChangeCallback = (mode: GizmoMode) => void;

/** 门窗类别集合，用于判断是否需要特殊处理 */
// const DOOR_WINDOW_CATEGORIES: Set<string> = new Set<string>(['door', 'window']);

/**
 * TransformGizmo 类
 * 必须在 renderer 就绪后调用 init() 完成初始化
 */
export class TransformGizmo {
  /** 当前工具模式 */
  private _mode: GizmoMode = 'select';

  /** Three.js TransformControls 实例（init 后非 null） */
  private _controls: TransformControls | null = null;

  /** 拖拽开始时记录的 before 快照 */
  private _beforeSnapshot: TransformSnapshot | null = null;

  /** 当前附加的目标对象 */
  private _attachedTarget: THREE.Object3D | null = null;

  /** 模式变更监听器集合 */
  private _modeListeners: Set<GizmoModeChangeCallback> = new Set<GizmoModeChangeCallback>();

  /** 取消订阅建筑对象选中变更的函数 */
  private _unsubSelection: (() => void) | null = null;

  /** 取消订阅 STL 模型选中变更的函数 */
  private _unsubStlSelection: (() => void) | null = null;

  /** 是否已初始化 */
  private _initialized: boolean = false;

  /** 依赖引用 */
  private readonly _orbitControls: OrbitControlsWrapper;
  private readonly _historyManager: CommandHistoryManager;
  private readonly _selectionManager: SelectionManager;
  private readonly _objectManager: BuildingObjectManager;
  private readonly _scene: THREE.Scene;

  /** Gizmo 移动门窗时的沿墙距离标注渲染器（与选择编辑共用同一对象池）。 */
  private readonly _doorWindowDimensionRenderer: DoorWindowPlacementDimensionRenderer;

  /**
   * @param scene - Three.js 场景
   * @param orbitControls - 轨道控制器包装器
   * @param historyManager - 命令历史管理器
   * @param selectionManager - 选中管理器
   * @param objectManager - 建筑对象管理器
   * @param doorWindowDimensionRenderer - 共享门窗标注渲染器，用于复用已有动态标注对象
   */
  public constructor(
    scene: THREE.Scene,
    orbitControls: OrbitControlsWrapper,
    historyManager: CommandHistoryManager,
    selectionManager: SelectionManager,
    objectManager: BuildingObjectManager,
    doorWindowDimensionRenderer: DoorWindowPlacementDimensionRenderer
  ) {
    this._scene = scene;
    this._orbitControls = orbitControls;
    this._historyManager = historyManager;
    this._selectionManager = selectionManager;
    this._objectManager = objectManager;
    this._doorWindowDimensionRenderer = doorWindowDimensionRenderer;
  }

  /* ========== 公开属性 ========== */

  /** 当前 Gizmo 模式 */
  public get mode(): GizmoMode {
    return this._mode;
  }

  /** 是否已初始化 */
  public get initialized(): boolean {
    return this._initialized;
  }

  /**
   * 获取 TransformControls 的 Helper 辅助对象（移动轴/旋转轮盘等）
   * 供 SelectionTool 在 mousedown 时检测是否点击了 Gizmo，避免误清空选择
   * @returns Helper 对象，未初始化时返回 null
   */
  public getHelper(): THREE.Object3D | null {
    if (this._controls === null) {
      return null;
    }
    return this._controls.getHelper();
  }

  /* ========== 初始化 ========== */

  /**
   * 初始化 TransformControls（需要 renderer 就绪后调用）
   * @param camera - 主相机
   * @param domElement - Canvas DOM 元素
   */
  public init(camera: THREE.Camera, domElement: HTMLCanvasElement): void {
    if (this._initialized) {
      return;
    }

    /* 创建 TransformControls */
    const controls: TransformControls = new TransformControls(camera, domElement);
    controls.setSize(0.8);
    this._controls = controls;

    /* 将 Gizmo 辅助对象加入场景 */
    this._scene.add(controls.getHelper());

    /* 监听拖拽开始/结束事件 */
    controls.addEventListener('mouseDown', this._onDragStart);
    controls.addEventListener('mouseUp', this._onDragEnd);
    controls.addEventListener('objectChange', this._onObjectChange);

    /* 订阅建筑对象选中状态变化 */
    this._unsubSelection = this._selectionManager.onChange(
      (ids: ReadonlySet<string>): void => {
        this._onSelectionChange(ids);
      }
    );

    /* 订阅 STL 模型选中状态变化 */
    this._unsubStlSelection = this._selectionManager.onStlChange(
      (mesh: THREE.Mesh | null): void => {
        this._onStlSelectionChange(mesh);
      }
    );

    /* 初始同步当前选中状态 */
    this._onSelectionChange(this._selectionManager.selectedIds);

    this._initialized = true;
    console.log('[TransformGizmo] 初始化完成');
  }

  /* ========== 模式切换 ========== */

  /**
   * 设置 Gizmo 工具模式
   * 门窗类型（category=door/window）禁止旋转模式，自动降级为移动模式
   * @param mode - 目标模式
   */
  public setMode(mode: GizmoMode): void {
    /* 门窗类型禁止旋转：若当前选中对象是门窗，rotate 模式自动降级为 move */
    const effectiveMode: GizmoMode = this._isDoorWindowAttached() && mode === 'rotate'
      ? 'move'
      : mode;

    if (this._mode === effectiveMode) {
      return;
    }
    this._mode = effectiveMode;

    if (this._controls !== null) {
      if (effectiveMode === 'select') {
        /* 选择模式：detach 并隐藏 Gizmo */
        this._detach();
      } else {
        /* 变换模式：更新 TransformControls 的 mode */
        const tcMode: 'translate' | 'rotate' | 'scale' =
          effectiveMode === 'move' ? 'translate' : effectiveMode === 'rotate' ? 'rotate' : 'scale';
        this._controls.setMode(tcMode);

        /* 若当前有单选建筑对象，立即 attach */
        const ids: ReadonlySet<string> = this._selectionManager.selectedIds;
        if (ids.size === 1) {
          const id: string = Array.from(ids)[0] as string;
          const mesh: THREE.Mesh | undefined = this._objectManager.getMeshById(id);
          if (mesh !== undefined) {
            this._attach(mesh);
            return;
          }
        }

        /* 若当前有选中的 STL 模型，立即 attach */
        const stlMesh: THREE.Mesh | null = this._selectionManager.selectedStlMesh;
        if (stlMesh !== null) {
          this._attach(stlMesh);
        }
      }
    }

    /* 通知监听器 */
    this._notifyModeChange();
  }

  /* ========== 事件订阅 ========== */

  /**
   * 订阅模式变更事件
   * @param callback - 回调函数
   * @returns 取消订阅函数
   */
  public onModeChange(callback: GizmoModeChangeCallback): () => void {
    this._modeListeners.add(callback);
    return (): void => {
      this._modeListeners.delete(callback);
    };
  }

  /* ========== 内部方法 ========== */

  /**
   * 判断当前附加的目标对象是否为吸附到墙上的门窗构件
   * 判断依据：userData 中存在 wallId 字符串（放置时由 StlPlaceTool 写入）
   * 只有吸附到墙上的门窗才禁止旋转并在移动时重算墙洞
   * @returns true 表示是吸附到墙上的门窗
   */
  private _isDoorWindowAttached(): boolean {
    if (this._attachedTarget === null) {
      return false;
    }
    return typeof this._attachedTarget.userData['wallId'] === 'string';
  }

  /**
   * 拖拽开始处理
   * 记录 before 快照 + 挂起 OrbitControls
   */
  private readonly _onDragStart = (): void => {
    if (this._attachedTarget === null) {
      return;
    }
    /* 记录变换前位姿快照 */
    this._beforeSnapshot = TransformCommand.capture(this._attachedTarget);
    this._updateDoorWindowDimension(this._attachedTarget);
    /* 挂起轨道控制器，避免视角同时旋转 */
    this._orbitControls.pushSuspend();
    console.log('[TransformGizmo] 拖拽开始，已挂起 OrbitControls');
  };

  /**
   * Gizmo 目标对象变换过程处理。
   * 移动吸附墙体的门窗时，实时刷新门窗包围盒到最近边界的距离标注。
   */
  private readonly _onObjectChange = (): void => {
    if (this._attachedTarget === null) {
      this._clearDoorWindowDimension();
      return;
    }

    /*
     * 标注编辑会通过代码直接更新 Mesh 位姿，并可能触发 TransformControls 的 objectChange。
     * 此时不属于 Gizmo 拖拽流程，必须隐藏 Gizmo 自己的动态标注，避免额外创建一套门窗标注。
     */
    if (this._beforeSnapshot === null) {
      this._clearDoorWindowDimension();
      return;
    }

    /* 仅移动门窗时显示距离标注，旋转/缩放过程不显示，避免误导墙向距离判断。 */
    if (this._mode !== 'move') {
      this._clearDoorWindowDimension();
      return;
    }

    this._updateDoorWindowDimension(this._attachedTarget);
  };

  /**
   * 拖拽结束处理
   * - 普通对象：提交 TransformCommand
   * - 门窗对象（移动模式）：将位置投影到墙线上，重算洞口，提交 StlMoveWithOpeningCommand
   */
  private readonly _onDragEnd = (): void => {
    if (this._attachedTarget === null || this._beforeSnapshot === null) {
      return;
    }

    /* 记录变换后位姿快照 */
    const afterSnapshot: TransformSnapshot = TransformCommand.capture(this._attachedTarget);

    /* 仅当位姿实际发生变化时才提交命令（避免单击产生空命令） */
    if (!TransformGizmo._snapshotsEqual(this._beforeSnapshot, afterSnapshot)) {
      /* 门窗类型且处于移动模式：投影位置到墙线并重算洞口 */
      if (this._isDoorWindowAttached() && this._mode === 'move') {
        this._handleDoorWindowMove(this._attachedTarget as THREE.Mesh, this._beforeSnapshot, afterSnapshot);
        this._updateDoorWindowDimension(this._attachedTarget);
      } else {
        /* 普通对象或非移动模式：提交普通变换命令 */
        const modeLabel: string =
          this._mode === 'move' ? '移动' : this._mode === 'rotate' ? '旋转' : '缩放';
        const cmd: TransformCommand = new TransformCommand(
          this._attachedTarget,
          this._beforeSnapshot,
          afterSnapshot,
          modeLabel
        );
        this._historyManager.execute(cmd);
        console.log(`[TransformGizmo] 提交 ${modeLabel} 命令到历史栈`);
      }
    }

    this._beforeSnapshot = null;
    if (!this._isDoorWindowAttached() || this._mode !== 'move') {
      this._clearDoorWindowDimension();
    }
    /* 恢复轨道控制器 */
    this._orbitControls.popSuspend();
    console.log('[TransformGizmo] 拖拽结束，已恢复 OrbitControls');
  };

  /**
   * 更新当前 Gizmo 门窗到相邻门窗或墙内侧边界的沿墙距离标注。
   * @param target - 当前 Gizmo 附加对象
   */
  private _updateDoorWindowDimension(target: THREE.Object3D): void {
    if (!(target instanceof THREE.Mesh)) {
      this._clearDoorWindowDimension();
      return;
    }

    const category: unknown = target.userData['category'];
    const wallId: unknown = target.userData['wallId'];
    if (!DoorWindow2DSymbolHelper.isDoorWindowCategory(category) || typeof wallId !== 'string') {
      this._clearDoorWindowDimension();
      return;
    }

    const wallObject: WallData | undefined = this._objectManager.getById(wallId) as WallData | undefined;
    if (wallObject === undefined || wallObject.category !== 'wall' || wallObject.subType !== 'straight') {
      this._clearDoorWindowDimension();
      return;
    }

    /* 标注刷新流程：Gizmo 改变 Mesh 位姿后，立即用当前包围盒投影区间计算左右最近边界距离。 */
    const wallData: StraightWallData = wallObject as StraightWallData;
    this._doorWindowDimensionRenderer.updateForPlacedDoorWindow(target, wallData, this._scene);
  }

  /** 隐藏 Gizmo 门窗距离标注。 */
  private _clearDoorWindowDimension(): void {
    this._doorWindowDimensionRenderer.clear(this._scene);
  }

  /**
   * 处理门窗移动：将移动后位置投影到最近墙中线上，重算洞口，提交复合命令
   *
   * 流程：
   * 1. 用移动后位置构造射线，查找最近墙体（距离阈值 0.5m）
   * 2. 若找到吸附墙体，将 Mesh 位置投影到墙中线上（保持 Y 不变）
   * 3. 读取该墙体移动前的洞口列表快照（排除本门窗对应的旧洞口）
   * 4. 重算新洞口参数，提交 StlMoveWithOpeningCommand
   * 5. 若未找到吸附墙体，退化为普通 TransformCommand
   *
   * @param mesh - 被移动的门窗 Mesh
   * @param before - 移动前位姿快照
   * @param after - 移动后位姿快照（未投影）
   */
  private _handleDoorWindowMove(
    mesh: THREE.Mesh,
    before: TransformSnapshot,
    after: TransformSnapshot
  ): void {
    /* 获取所有直墙 */
    const allWalls: WallData[] = this._objectManager.getByCategory('wall') as WallData[];
    const straightWalls: StraightWallData[] = WallSnapHelper.filterStraightWalls(allWalls);

    if (straightWalls.length === 0) {
      /* 无墙体，退化为普通移动命令 */
      const cmd: TransformCommand = new TransformCommand(mesh, before, after, '移动');
      this._historyManager.execute(cmd);
      return;
    }

    /* 用移动后位置向下发射射线，查找最近墙体 */
    const movedPos: THREE.Vector3 = new THREE.Vector3(
      after.position.x,
      after.position.y + 10,
      after.position.z
    );
    const downDir: THREE.Vector3 = new THREE.Vector3(0, -1, 0);
    const ray: THREE.Ray = new THREE.Ray(movedPos, downDir);
    const snapResult: WallSnapResult | null = WallSnapHelper.findNearestWall(ray, straightWalls);

    if (snapResult === null) {
      /* 未吸附到任何墙体，退化为普通移动命令 */
      const cmd: TransformCommand = new TransformCommand(mesh, before, after, '移动');
      this._historyManager.execute(cmd);
      console.log('[TransformGizmo] 门窗移动未找到吸附墙体，使用普通移动命令');
      return;
    }

    /* 将 Mesh 位置投影到墙中线上（保持 Y 不变） */
    mesh.position.set(snapResult.snapPoint.x, mesh.position.y, snapResult.snapPoint.z);
    /* 对齐旋转到墙面法线方向 */
    const angle: number = Math.atan2(snapResult.wallNormal.x, snapResult.wallNormal.z);
    mesh.rotation.set(0, angle, 0);
    mesh.updateMatrixWorld(true);

    /* 记录投影后的 after 快照 */
    const projectedAfter: TransformSnapshot = TransformCommand.capture(mesh);

    /* 门窗移动后执行碰撞检测：若与同墙已有门窗重叠，则恢复旧位置并取消本次移动。 */
    const collisionResult = DoorWindowCollisionDetector.detect(mesh, this._scene);
    if (collisionResult.collided) {
      const collidedName: string = collisionResult.collidedMesh?.name ?? '未知门窗';
      mesh.position.set(before.position.x, before.position.y, before.position.z);
      mesh.rotation.set(before.rotation.x, before.rotation.y, before.rotation.z);
      mesh.scale.set(before.scale.x, before.scale.y, before.scale.z);
      mesh.updateMatrixWorld(true);
      console.warn(`❌ 门窗碰撞，已取消移动: "${mesh.name}" 与 "${collidedName}" 重叠`);
      return;
    }

    /* 获取目标墙体数据 */
    const wallData: StraightWallData = straightWalls.find(
      (w: StraightWallData): boolean => w.id === snapResult.wallId
    ) as StraightWallData;

    /* 读取墙体当前洞口列表，排除本门窗对应的旧洞口（通过 before 位置匹配） */
    const currentOpenings: WallOpening[] = wallData.openings !== undefined
      ? [...wallData.openings]
      : [];

    /* 计算 before 位置对应的旧洞口 t 值（用于识别并排除） */
    const beforePos: THREE.Vector3 = new THREE.Vector3(
      before.position.x,
      before.position.y,
      before.position.z
    );
    const oldT: number = this._computeTFromPosition(beforePos, wallData);

    /* 从当前洞口列表中移除与旧位置最接近的洞口（即本门窗的旧洞口） */
    const oldOpenings: WallOpening[] = this._removeClosestOpening(currentOpenings, oldT);

    /* 重算新洞口参数 */
    const newOpening: WallOpening = WallOpeningCutter.computeOpening(snapResult, mesh, wallData);

    /* 提交复合命令 */
    const cmd: StlMoveWithOpeningCommand = new StlMoveWithOpeningCommand(
      mesh,
      before,
      projectedAfter,
      this._objectManager,
      snapResult.wallId,
      oldOpenings,
      newOpening,
      `移动门窗 "${mesh.name}"`
    );
    this._historyManager.execute(cmd);

    console.log(
      `[TransformGizmo] 门窗移动: 吸附到墙体=${snapResult.wallId}, ` +
      `新洞口 t=${newOpening.centerT.toFixed(3)}`
    );
  }

  /**
   * 计算世界坐标位置在指定直墙中线上的参数 t
   * @param pos - 世界坐标位置
   * @param wall - 直墙数据
   * @returns 参数 t（0=起点，1=终点），限制在 [0, 1]
   */
  private _computeTFromPosition(pos: THREE.Vector3, wall: StraightWallData): number {
    const startX: number = wall.start.x;
    const startZ: number = wall.start.z;
    const dirRawX: number = wall.end.x - startX;
    const dirRawZ: number = wall.end.z - startZ;
    const wallLength: number = Math.sqrt(dirRawX * dirRawX + dirRawZ * dirRawZ);

    if (wallLength < 0.001) {
      return 0;
    }

    const dirX: number = dirRawX / wallLength;
    const dirZ: number = dirRawZ / wallLength;
    const px: number = pos.x - startX;
    const pz: number = pos.z - startZ;
    const tRaw: number = (px * dirX + pz * dirZ) / wallLength;
    return Math.max(0, Math.min(1, tRaw));
  }

  /**
   * 从洞口列表中移除与指定 t 值最接近的洞口（即本门窗的旧洞口）
   * @param openings - 当前洞口列表
   * @param targetT - 旧洞口的 t 值
   * @returns 移除后的洞口列表
   */
  private _removeClosestOpening(openings: WallOpening[], targetT: number): WallOpening[] {
    if (openings.length === 0) {
      return [];
    }

    let closestIdx: number = 0;
    let closestDist: number = Math.abs(openings[0]!.centerT - targetT);

    for (let i: number = 1; i < openings.length; i++) {
      const dist: number = Math.abs(openings[i]!.centerT - targetT);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }

    /* 移除最近的洞口 */
    const result: WallOpening[] = [...openings];
    result.splice(closestIdx, 1);
    return result;
  }

  /**
   * 建筑对象选中状态变化处理
   * - count === 1 且 mode !== 'select' → attach 建筑对象 Mesh
   * - 其他 → detach
   */
  private _onSelectionChange(ids: ReadonlySet<string>): void {
    if (this._controls === null) {
      return;
    }

    if (ids.size === 1 && this._mode !== 'select') {
      const id: string = Array.from(ids)[0] as string;
      const mesh: THREE.Mesh | undefined = this._objectManager.getMeshById(id);
      if (mesh !== undefined) {
        this._attach(mesh);
        return;
      }
    }

    /* 多选、无选、或 select 模式 → detach */
    this._detach();
  }

  /**
   * STL 模型选中状态变化处理
   * - mesh !== null 且 mode !== 'select' → attach STL Mesh
   *   若为门窗类型且当前模式为 rotate，自动切换为 move 模式
   * - mesh === null → detach
   */
  private _onStlSelectionChange(mesh: THREE.Mesh | null): void {
    if (this._controls === null) {
      return;
    }

    if (mesh !== null && this._mode !== 'select') {
      /* 吸附到墙上的门窗禁止旋转：若 userData 中有 wallId 且当前模式为 rotate，自动切换为 move */
      const isWallAttached: boolean = typeof mesh.userData['wallId'] === 'string';

      if (isWallAttached && this._mode === 'rotate') {
        /* 切换为移动模式（不触发 setMode 的完整流程，直接更新内部状态） */
        this._mode = 'move';
        this._controls.setMode('translate');
        this._notifyModeChange();
        console.log('[TransformGizmo] 吸附到墙上的门窗不支持旋转，已自动切换为移动模式');
      }

      /* STL 模型被选中，直接 attach */
      this._attach(mesh);
    } else {
      /* STL 取消选中 → detach */
      this._detach();
    }
  }

  /**
   * 将 Gizmo 附加到目标对象
   */
  private _attach(target: THREE.Object3D): void {
    if (this._controls === null) {
      return;
    }
    this._attachedTarget = target;
    this._controls.attach(target);
    console.log(`[TransformGizmo] 已附加到对象: ${target.name || target.uuid}`);
  }

  /**
   * 从当前目标分离 Gizmo
   */
  private _detach(): void {
    if (this._controls === null) {
      return;
    }
    this._controls.detach();
    this._attachedTarget = null;
  }

  /**
   * 通知所有模式变更监听器
   */
  private _notifyModeChange(): void {
    this._modeListeners.forEach((cb: GizmoModeChangeCallback): void => {
      cb(this._mode);
    });
  }

  /**
   * 比较两个位姿快照是否相等（用于过滤空操作）
   */
  private static _snapshotsEqual(a: TransformSnapshot, b: TransformSnapshot): boolean {
    const EPS: number = 1e-6;
    return (
      Math.abs(a.position.x - b.position.x) < EPS &&
      Math.abs(a.position.y - b.position.y) < EPS &&
      Math.abs(a.position.z - b.position.z) < EPS &&
      Math.abs(a.rotation.x - b.rotation.x) < EPS &&
      Math.abs(a.rotation.y - b.rotation.y) < EPS &&
      Math.abs(a.rotation.z - b.rotation.z) < EPS &&
      Math.abs(a.scale.x - b.scale.x) < EPS &&
      Math.abs(a.scale.y - b.scale.y) < EPS &&
      Math.abs(a.scale.z - b.scale.z) < EPS
    );
  }

  /* ========== 销毁 ========== */

  /**
   * 销毁 Gizmo，释放所有资源
   */
  public dispose(): void {
    /* 取消建筑对象选中订阅 */
    if (this._unsubSelection !== null) {
      this._unsubSelection();
      this._unsubSelection = null;
    }

    /* 取消 STL 模型选中订阅 */
    if (this._unsubStlSelection !== null) {
      this._unsubStlSelection();
      this._unsubStlSelection = null;
    }

    if (this._controls !== null) {
      /* 移除事件监听 */
      this._controls.removeEventListener('mouseDown', this._onDragStart);
      this._controls.removeEventListener('mouseUp', this._onDragEnd);
      this._controls.removeEventListener('objectChange', this._onObjectChange);
      /* 从场景移除辅助对象 */
      this._scene.remove(this._controls.getHelper());
      this._controls.detach();
      this._controls.dispose();
      this._controls = null;
    }

    this._modeListeners.clear();
    this._clearDoorWindowDimension();
    this._attachedTarget = null;
    this._beforeSnapshot = null;
    this._initialized = false;
    console.log('[TransformGizmo] 已销毁');
  }
}
