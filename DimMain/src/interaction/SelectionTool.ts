/**
 * 选择交互工具
 * 监听 Canvas 的鼠标和键盘事件，实现点选 / Ctrl 多选 / Delete 删除
 * 与绘制工具互斥，由外部通过 enable/disable 控制启用状态
 * 注意：框选功能已移除，仅保留点选和键盘操作
 */

import * as THREE from 'three/webgpu';
import type { SelectionManager } from './SelectionManager';
import type { BuildingObjectManager } from '../building/BuildingObjectManager';
import { RaycastHelper } from './RaycastHelper';
import type { MeshFaceHitResult } from './RaycastHelper';
import type { SceneManager } from '../scene/SceneManager';
import type { CommandHistoryManager } from '../history/CommandHistoryManager';
import type { ViewMode } from '../react/context/ViewModeContext';
import { StlBBoxSnapHelper } from '../model/StlBBoxSnapHelper';
import type { BBoxSnapResult } from '../model/StlBBoxSnapHelper';
import { StlSnapGuideLines } from '../model/StlSnapGuideLines';
import { StlMoveCommand } from '../history/commands/StlMoveCommand';
import { WallMoveCommand } from '../history/commands/WallMoveCommand';
import { BoundingBoxHelper } from './BoundingBoxHelper';
import { DoorWindow2DSymbolHelper } from '../model/DoorWindow2DSymbolHelper';
import { DoorWindowPlacementDimensionRenderer } from '../model/DoorWindowPlacementDimensionRenderer';
import { WallOpeningCutter } from '../building/WallOpeningCutter';
import { StlMoveWithOpeningCommand } from '../history/commands/StlMoveWithOpeningCommand';
import { TransformCommand } from '../history/commands/TransformCommand';
import type { TransformSnapshot } from '../history/commands/TransformCommand';
import type { BuildingObject, Point2D, StraightWallData, WallOpening } from '../building/BuildingTypes';
import type { WallSnapResult } from '../building/WallSnapHelper';
import { DoorOpeningDirectionHelper } from '../model/DoorOpeningDirectionHelper';

/**
 * 选择交互工具
 * 支持：左键点选、Ctrl+点选多选、Delete/Backspace 删除、Esc 清空选择
 */
export class SelectionTool {
  /** 选择管理器引用 */
  private _selectionManager: SelectionManager;

  /** 建筑对象管理器引用 */
  private _objectManager: BuildingObjectManager;

  /** 场景管理器引用（用于拾取 STL 模型和执行 STL 删除） */
  private _sceneManager: SceneManager | null = null;

  /** 命令历史管理器引用（删除操作通过命令栈执行，支持撤销/重做） */
  private _historyManager: CommandHistoryManager | null = null;

  /** 相机引用（支持透视/正交相机） */
  private _camera: THREE.Camera | null = null;

  /** Canvas DOM 元素引用 */
  private _domElement: HTMLCanvasElement | null = null;

  /** 是否已启用 */
  private _enabled: boolean = false;

  /** 射线投射辅助器 */
  private _raycastHelper: RaycastHelper = new RaycastHelper();

  /** 鼠标按下时的屏幕坐标（用于判断是否发生了拖拽，拖拽时不触发点选） */
  private _mouseDownPos: { x: number; y: number } | null = null;

  /** 鼠标按下时是否按住 Ctrl 键 */
  private _ctrlDownAtMouseDown: boolean = false;

  /**
   * TransformControls 的 Helper 辅助对象（移动轴/旋转轮盘等）
   * mousedown 时若射线命中此对象，则跳过本次点选，避免拖拽 Gizmo 时误清空选择
   */
  private _gizmoHelper: THREE.Object3D | null = null;

  /**
   * 是否跳过下一次 mouseup 的点选处理
   * 当 mousedown 命中 Gizmo Helper 时设为 true，mouseup 时跳过点选并重置
   */
  private _skipNextClick: boolean = false;

  /** 射线投射器（用于 mousedown 时检测 Gizmo） */
  private _gizmoRaycaster: THREE.Raycaster = new THREE.Raycaster();

  /** 点选判定阈值（像素），移动超过此距离视为拖拽，不触发点选 */
  private static readonly CLICK_THRESHOLD: number = 5;

  /** 当前视图模式（2D 模式下 STL 选中时显示包围盒） */
  private _viewMode: ViewMode = '3d';

  /* ========== 2D 模式 STL 拖拽字段 ========== */

  /**
   * 建筑对象管理器引用（用于收集包围盒吸附目标：墙体 Mesh）
   * 通过 setBuildingManager() 注入
   */
  private _buildingManagerForDrag: BuildingObjectManager | null = null;

  /** 是否正在拖拽 STL 模型（2D 模式下） */
  private _isDraggingStl: boolean = false;

  /** 是否正在拖拽 2D 直墙实体。 */
  private _isDraggingWall: boolean = false;

  /** 当前拖拽的直墙 ID。 */
  private _dragWallId: string | null = null;

  /** 墙体拖拽起始鼠标地面投影点。 */
  private _dragWallStartGroundPoint: THREE.Vector3 = new THREE.Vector3();

  /** 墙体拖拽起始命中的墙体锚点。 */
  private _dragWallStartHitPoint: THREE.Vector3 = new THREE.Vector3();

  /** 墙体拖拽起始中心线参考点。 */
  private _dragWallStartLinePoint: Point2D = { x: 0, z: 0 };

  /** 墙体拖拽命中点到墙体中心线的法向距离。 */
  private _dragWallHitToLineNormalDistance: number = 0;

  /** 墙体允许拖拽的墙面法向方向。 */
  private _dragWallNormal: THREE.Vector3 = new THREE.Vector3();

  /** 墙体拖拽过程中已实时应用的累计偏移。 */
  private _dragWallAppliedOffset: Point2D = { x: 0, z: 0 };

  /** 拖拽开始时 Mesh 的世界坐标快照（用于命令栈记录 before 位置） */
  private _dragStartMeshPos: THREE.Vector3 = new THREE.Vector3();

  /** 拖拽开始时 Mesh 的完整位姿快照（门窗移动重算洞口命令使用） */
  private _dragStartSnapshot: TransformSnapshot | null = null;

  /**
   * 鼠标按下时，鼠标地面投影点与 Mesh 中心的 XZ 偏移
   * 拖拽时保持此偏移，使模型跟随鼠标时不发生跳跃
   */
  private _dragOffsetX: number = 0;
  private _dragOffsetZ: number = 0;

  /** 地面平面（Y=0），用于射线与地面求交 */
  private _dragGroundPlane: THREE.Plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /** 拖拽时的射线投射器 */
  private _dragRaycaster: THREE.Raycaster = new THREE.Raycaster();

  /** 拖拽时的包围盒吸附虚线提示（拖拽开始时创建，结束时销毁） */
  private _dragSnapGuideLines: StlSnapGuideLines | null = null;

  /** 2D 门窗拖拽/选中时的沿墙距离标注渲染器。 */
  private readonly _doorWindowDimensionRenderer: DoorWindowPlacementDimensionRenderer = new DoorWindowPlacementDimensionRenderer();

  /**
   * @param selectionManager - 选择管理器
   * @param objectManager - 建筑对象管理器
   * @param sceneManager - 场景管理器（可选，支持 STL 模型拾取和删除）
   * @param historyManager - 命令历史管理器（可选，删除操作支持撤销/重做）
   */
  constructor(
    selectionManager: SelectionManager,
    objectManager: BuildingObjectManager,
    sceneManager?: SceneManager,
    historyManager?: CommandHistoryManager
  ) {
    this._selectionManager = selectionManager;
    this._objectManager = objectManager;
    this._sceneManager = sceneManager ?? null;
    this._historyManager = historyManager ?? null;
  }

  /* ========== 启用/禁用 ========== */

  /**
   * 启用选择工具，绑定鼠标和键盘事件
   * @param camera - 相机
   * @param domElement - Canvas DOM 元素
   */
  public enable(
    camera: THREE.Camera,
    domElement: HTMLCanvasElement
  ): void {
    if (this._enabled) {
      return;
    }
    this._camera = camera;
    this._domElement = domElement;
    this._enabled = true;

    domElement.addEventListener('mousedown', this._onMouseDown);
    domElement.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('keydown', this._onKeyDown);
  }

  /**
   * 禁用选择工具，解绑事件
   */
  public disable(): void {
    if (!this._enabled) {
      return;
    }
    if (this._domElement !== null) {
      this._domElement.removeEventListener('mousedown', this._onMouseDown);
      this._domElement.removeEventListener('mouseup', this._onMouseUp);
    }
    window.removeEventListener('keydown', this._onKeyDown);

    this._enabled = false;
    this._camera = null;
    this._domElement = null;
    this._mouseDownPos = null;
  }

  /**
   * 是否已启用
   */
  public get enabled(): boolean {
    return this._enabled;
  }

  /**
   * 更新相机引用（视图模式切换后调用，确保射线从正确相机发出）
   * @param camera - 新的相机实例
   */
  public updateCamera(camera: THREE.Camera): void {
    this._camera = camera;
  }

  /**
   * 注入 TransformControls 的 Helper 辅助对象
   * 在 TransformGizmo.init() 完成后调用，使 SelectionTool 能在 mousedown 时
   * 检测是否点击了 Gizmo 轴/轮盘，避免拖拽 Gizmo 时误清空选择
   * @param helper - TransformControls.getHelper() 返回的辅助对象，null 表示清除
   */
  public setGizmoHelper(helper: THREE.Object3D | null): void {
    this._gizmoHelper = helper;
  }

  /**
   * 更新当前视图模式
   * 2D 模式下 STL 模型选中时显示平面投影包围盒
   * @param mode - 视图模式
   */
  public setViewMode(mode: ViewMode): void {
    this._viewMode = mode;
  }

  /**
   * 注入建筑对象管理器（用于 2D 模式下拖拽时收集包围盒吸附目标）
   * @param manager - 建筑对象管理器
   */
  public setBuildingManager(manager: BuildingObjectManager): void {
    this._buildingManagerForDrag = manager;
  }

  /* ========== 鼠标事件处理 ========== */

  /**
   * 鼠标按下：记录起点坐标和 Ctrl 状态
   * 同时检测是否点击了 TransformControls 的 Gizmo 辅助对象（移动轴/旋转轮盘）
   * 若命中 Gizmo，则标记 _skipNextClick，mouseup 时跳过点选，避免误清空选择
   */
  private _onMouseDown = (event: MouseEvent): void => {
    /* 仅响应左键 */
    if (event.button !== 0) {
      return;
    }
    this._mouseDownPos = { x: event.clientX, y: event.clientY };
    this._ctrlDownAtMouseDown = event.ctrlKey || event.metaKey;
    this._skipNextClick = false;

    /* 检测是否点击了 Gizmo Helper（移动轴/旋转轮盘等）
     * 仅当 Helper 可见时才检测（有物体被 attach 时 visible=true，无 attach 时 visible=false）
     * 避免 Gizmo 未显示时误命中内部不可见 Mesh，导致普通物体点选失效
     */
    if (this._gizmoHelper !== null && this._gizmoHelper.visible && this._camera !== null && this._domElement !== null) {
      const rect: DOMRect = this._domElement.getBoundingClientRect();
      const ndcX: number = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY: number = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this._gizmoRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this._camera);
      /* recursive=true 检测 Helper 的所有子对象（轴箭头/旋转圆环等） */
      const hits: Array<THREE.Intersection> = this._gizmoRaycaster.intersectObject(
        this._gizmoHelper,
        true
      );
      if (hits.length > 0) {
        /* 命中了 Gizmo，标记跳过本次点选 */
        this._skipNextClick = true;
        return;
      }
    }

    /* 2D 模式下：检测是否按下在已选中的 STL 模型上，若是则启动拖拽 */
    if (
      this._viewMode === '2d' &&
      this._camera !== null &&
      this._domElement !== null &&
      this._sceneManager !== null
    ) {
      const selectedMesh: THREE.Mesh | null = this._selectionManager.selectedStlMesh;
      if (selectedMesh !== null && this._is2DDraggableStl(selectedMesh)) {
        /* 射线检测是否命中了当前选中的 STL Mesh */
        const rect: DOMRect = this._domElement.getBoundingClientRect();
        const ndcX: number = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY: number = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this._dragRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this._camera);
        const hits: Array<THREE.Intersection> = this._dragRaycaster.intersectObject(selectedMesh, true);

        if (hits.length > 0) {
          /* 命中了选中的 STL Mesh：启动拖拽 */
          this._isDraggingStl = true;
          this._skipNextClick = true;

          /* 记录拖拽开始时 Mesh 的位置（用于命令栈 before 快照） */
          this._dragStartMeshPos.copy(selectedMesh.position);
          this._dragStartSnapshot = TransformCommand.capture(selectedMesh);

          /* 计算鼠标地面投影点与 Mesh 中心的 XZ 偏移（保持相对位置，避免跳跃） */
          const groundIntersect: THREE.Vector3 = new THREE.Vector3();
          const groundHit: THREE.Vector3 | null = this._dragRaycaster.ray.intersectPlane(
            this._dragGroundPlane,
            groundIntersect
          );
          if (groundHit !== null) {
            this._dragOffsetX = selectedMesh.position.x - groundIntersect.x;
            this._dragOffsetZ = selectedMesh.position.z - groundIntersect.z;
          } else {
            this._dragOffsetX = 0;
            this._dragOffsetZ = 0;
          }

          /* 创建吸附虚线提示 */
          const scene: THREE.Scene = this._sceneManager.getScene();
          this._dragSnapGuideLines = new StlSnapGuideLines(scene);
          this._updateDoorWindowDimension(selectedMesh);

          /* 绑定 mousemove 事件（仅拖拽期间） */
          this._domElement.addEventListener('mousemove', this._onDragMouseMove);
        }
      }

      /* 2D 模式下：检测是否按下在已选中的直墙实体上，若是则启动沿墙法向拖拽。 */
      if (!this._isDraggingStl && this._tryStartWallDrag(event)) {
        return;
      }
    }
  };

  /**
   * 鼠标抬起：判断是否为点选（移动距离未超过阈值）
   * 若鼠标移动超过阈值（如旋转相机）或 mousedown 时命中了 Gizmo，则不触发点选
   */
  private _onMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0 || this._mouseDownPos === null) {
      return;
    }

    /* 若正在拖拽 STL 模型，结束拖拽并提交命令（优先于点选处理） */
    if (this._isDraggingStl) {
      const selectedMesh: THREE.Mesh | null = this._selectionManager.selectedStlMesh;
      this._endDrag(selectedMesh);
      this._mouseDownPos = null;
      this._skipNextClick = false;
      return;
    }

    /* 若正在拖拽墙体，结束拖拽并提交墙体移动命令。 */
    if (this._isDraggingWall) {
      this._endWallDrag();
      this._mouseDownPos = null;
      this._skipNextClick = false;
      return;
    }

    const dx: number = event.clientX - this._mouseDownPos.x;
    const dy: number = event.clientY - this._mouseDownPos.y;
    const distance: number = Math.sqrt(dx * dx + dy * dy);

    /* 移动距离在阈值内且未命中 Gizmo 才视为点选 */
    if (distance <= SelectionTool.CLICK_THRESHOLD && !this._skipNextClick) {
      this._handleClickSelect(event.clientX, event.clientY, this._ctrlDownAtMouseDown);
    }

    this._mouseDownPos = null;
    this._skipNextClick = false;
  };

  /**
   * 键盘按下：Delete/Backspace 删除选中对象；Esc 清空选择
   */
  private _onKeyDown = (event: KeyboardEvent): void => {
    /* 忽略输入框内的按键 */
    const target: EventTarget | null = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();

      /* 优先处理建筑对象删除 */
      if (this._selectionManager.hasSelection && this._historyManager !== null) {
        const deleted: Array<string> = this._selectionManager.deleteSelected(this._historyManager);
        console.log(`🗑️ 已删除 ${deleted.length} 个建筑对象`);
        return;
      }

      /* 处理 STL 模型删除（门窗类型同时还原墙体洞口） */
      if (
        this._selectionManager.selectedStlMesh !== null &&
        this._sceneManager !== null &&
        this._historyManager !== null
      ) {
        const scene: THREE.Scene = this._sceneManager.getScene();
        this._selectionManager.deleteSelectedStl(
          scene,
          this._historyManager,
          this._buildingManagerForDrag
        );
        return;
      }
    } else if (event.key === ' ') {
      /* 空格键切换选中门的开启方向：仅对门 STL 生效，切换后同步刷新 2D 图标和属性面板。 */
      const selectedStlMesh: THREE.Mesh | null = this._selectionManager.selectedStlMesh;
      if (selectedStlMesh !== null && DoorOpeningDirectionHelper.isDoorMesh(selectedStlMesh)) {
        event.preventDefault();
        DoorOpeningDirectionHelper.toggleDirectionAndRefreshSymbol(selectedStlMesh, this._viewMode === '2d');
        this._selectionManager.refreshSelectedStl();
        return;
      }
    } else if (event.key === 'Escape') {
      this._clearDoorWindowDimension();
      this._selectionManager.clearSelection();
    }
  };

  /* ========== 选择逻辑 ========== */

  /**
   * 处理点选：将建筑对象 Mesh 与 STL Mesh 合并为统一目标列表，
   * 一次射线拾取取距离最近的命中结果，保证深度正确
   * @param screenX - 屏幕坐标 X
   * @param screenY - 屏幕坐标 Y
   * @param isCtrl - 是否按住 Ctrl（多选模式）
   */
  private _handleClickSelect(screenX: number, screenY: number, isCtrl: boolean): void {
    if (this._camera === null || this._domElement === null) {
      return;
    }

    /* 2D 模式下门窗平面符号与墙体重叠，必须优先拾取门窗，避免选中墙体。 */
    if (this._viewMode === '2d' && this._trySelectDoorWindow2DSymbol(screenX, screenY, isCtrl)) {
      return;
    }

    /* ===== 收集建筑对象 Mesh ===== */
    const meshList: Array<{ id: string; mesh: THREE.Mesh }> = this._objectManager.getAllMeshes();
    /* 过滤隐藏的 Mesh（visible=false 的对象不应参与射线拾取） */
    const buildingTargets: Array<THREE.Object3D> = meshList
      .filter((item: { id: string; mesh: THREE.Mesh }): boolean => item.mesh.visible)
      .map((item: { id: string; mesh: THREE.Mesh }): THREE.Object3D => item.mesh);
    /* ===== 收集 STL 模型 Mesh ===== */
    const stlTargets: Array<THREE.Object3D> = this._collectStlMeshes();

    /* ===== 合并为统一目标列表，一次射线拾取 ===== */
    const allTargets: Array<THREE.Object3D> = [...buildingTargets, ...stlTargets];

    const hit: MeshFaceHitResult | null = this._raycastHelper.screenToMeshFace(
      screenX,
      screenY,
      this._camera,
      this._domElement,
      allTargets
    );

    if (hit === null) {
      /* 什么都未命中：非多选模式时清空选择 */
      if (!isCtrl) {
        this._clearDoorWindowDimension();
        this._selectionManager.clearSelection();
      }
      return;
    }

    /* ===== 根据命中 Mesh 的 userData 判断对象类型 ===== */

    /* 优先判断建筑对象 */
    const buildingObjectId: unknown = hit.mesh.userData['buildingObjectId'];
    if (typeof buildingObjectId === 'string') {
      /* 选中墙体、梁等非门窗建筑对象时，隐藏上一门窗残留的动态距离标注。 */
      this._clearDoorWindowDimension();
      /* Ctrl 多选 → 切换选中；普通点选 → 替换选中 */
      if (isCtrl) {
        this._selectionManager.toggleSelect(buildingObjectId);
      } else {
        this._selectionManager.select(buildingObjectId);
      }
      return;
    }

    /* 判断 STL 模型 */
    const stlModelId: unknown = hit.mesh.userData['stlModelId'];
    if (typeof stlModelId === 'string') {
      /* 传入当前视图模式，2D 模式下选中时显示平面投影包围盒 */
      this._selectStlMesh(hit.mesh, isCtrl);
      return;
    }

    /* 命中了未知类型的 Mesh（如网格辅助线子对象等），非多选时清空选择 */
    if (!isCtrl) {
      this._clearDoorWindowDimension();
      this._selectionManager.clearSelection();
    }
  }

  /**
   * 2D 模式下优先拾取门窗平面符号。
   * 命中符号后回溯到所属 STL Mesh 并选中，防止墙体抢占点选。
   * @param screenX - 屏幕坐标 X
   * @param screenY - 屏幕坐标 Y
   * @param isCtrl - 是否按住 Ctrl（多选模式）
   * @returns 成功命中并处理选择时返回 true
   */
  private _trySelectDoorWindow2DSymbol(screenX: number, screenY: number, isCtrl: boolean): boolean {
    if (this._sceneManager === null || this._camera === null || this._domElement === null) {
      return false;
    }

    const scene: THREE.Scene = this._sceneManager.getScene();
    const symbolTargets: Array<THREE.Object3D> = DoorWindow2DSymbolHelper.collectVisibleSymbolMeshes(scene);
    if (symbolTargets.length === 0) {
      return false;
    }

    const hit: MeshFaceHitResult | null = this._raycastHelper.screenToMeshFace(
      screenX,
      screenY,
      this._camera,
      this._domElement,
      symbolTargets
    );
    if (hit === null) {
      return false;
    }

    const ownerMesh: THREE.Mesh | null = DoorWindow2DSymbolHelper.resolveOwnerStlMesh(hit.mesh);
    if (ownerMesh === null) {
      return false;
    }

    this._selectStlMesh(ownerMesh, isCtrl);
    return true;
  }

  /**
   * 统一处理 STL Mesh 选择逻辑。
   * @param mesh - 要选中的 STL Mesh
   * @param isCtrl - 是否按住 Ctrl（多选模式）
   */
  private _selectStlMesh(mesh: THREE.Mesh, isCtrl: boolean): void {
    if (isCtrl) {
      this._selectionManager.toggleSelectStl(mesh, this._viewMode);
    } else {
      this._selectionManager.selectStl(mesh, this._viewMode);
    }
    this._updateDoorWindowDimension(mesh);
  }

  /**
   * 判断 STL Mesh 是否允许在 2D 模式下通过选中对象拖拽移动。
   * @param mesh - 待检测的 STL Mesh
   * @returns 普通模型或门窗模型返回 true
   */
  private _is2DDraggableStl(mesh: THREE.Mesh): boolean {
    const category: unknown = mesh.userData['category'];
    return category === 'model' || DoorWindow2DSymbolHelper.isDoorWindowCategory(category);
  }

  /**
   * 收集场景中所有带 stlModelId 标记的 Mesh
   * 用于与建筑对象 Mesh 合并后进行统一深度排序的射线拾取
   * @returns STL Mesh 数组（场景中无 STL 时返回空数组）
   */
  private _collectStlMeshes(): Array<THREE.Object3D> {
    if (this._sceneManager === null) {
      return [];
    }

    const stlTargets: Array<THREE.Object3D> = [];
    const scene: THREE.Scene = this._sceneManager.getScene();
    scene.traverse((child: THREE.Object3D): void => {
      /* 跳过隐藏的 Mesh（visible=false 的模型不应参与射线拾取） */
      if (
        child instanceof THREE.Mesh &&
        child.userData['stlModelId'] !== undefined &&
        child.visible
      ) {
        stlTargets.push(child);
      }
    });

    return stlTargets;
  }

  /* ========== 2D 模式 STL 拖拽逻辑 ========== */

  /**
   * 尝试启动 2D 直墙实体拖拽。
   * 仅允许单选直墙，并把拖拽方向锁定到墙体中心线的法向方向。
   * @param event - 鼠标按下事件
   * @returns 成功启动墙体拖拽时返回 true
   */
  private _tryStartWallDrag(event: MouseEvent): boolean {
    if (this._camera === null || this._domElement === null) {
      return false;
    }

    const selectedIds: string[] = Array.from(this._selectionManager.selectedIds);
    if (selectedIds.length !== 1) {
      return false;
    }

    const wallId: string = selectedIds[0]!;
    const wallObject: BuildingObject | undefined = this._objectManager.getById(wallId);
    if (wallObject === undefined || wallObject.category !== 'wall' || wallObject.subType !== 'straight') {
      return false;
    }

    const wallMesh: THREE.Mesh | undefined = this._objectManager.getMeshById(wallId);
    if (wallMesh === undefined || !wallMesh.visible) {
      return false;
    }

    const rect: DOMRect = this._domElement.getBoundingClientRect();
    const ndcX: number = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY: number = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._dragRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this._camera);

    const hits: Array<THREE.Intersection> = this._dragRaycaster.intersectObject(wallMesh, true);
    if (hits.length === 0) {
      return false;
    }

    const firstHit: THREE.Intersection = hits[0]!;
    this._dragWallStartHitPoint.set(firstHit.point.x, 0, firstHit.point.z);

    const groundHit: THREE.Vector3 | null = this._dragRaycaster.ray.intersectPlane(
      this._dragGroundPlane,
      this._dragWallStartGroundPoint
    );
    if (groundHit === null) {
      return false;
    }

    const wallData: StraightWallData = wallObject as StraightWallData;
    const dirX: number = wallData.end.x - wallData.start.x;
    const dirZ: number = wallData.end.z - wallData.start.z;
    const len: number = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (len < 0.001) {
      return false;
    }

    this._dragWallNormal.set(-dirZ / len, 0, dirX / len);
    this._dragWallStartLinePoint = { x: wallData.start.x, z: wallData.start.z };
    /* 记录命中点相对墙体中心线的法向距离。
     * 拖拽过程中用当前鼠标位置直接反推目标中心线，使被鼠标按住的墙体位置与鼠标保持一致。
     */
    this._dragWallHitToLineNormalDistance =
      (this._dragWallStartHitPoint.x - this._dragWallStartLinePoint.x) * this._dragWallNormal.x +
      (this._dragWallStartHitPoint.z - this._dragWallStartLinePoint.z) * this._dragWallNormal.z;
    this._dragWallAppliedOffset = { x: 0, z: 0 };
    this._dragWallId = wallId;
    this._isDraggingWall = true;
    this._skipNextClick = true;

    this._domElement.addEventListener('mousemove', this._onWallDragMouseMove);
    return true;
  }

  /**
   * 墙体拖拽过程中的鼠标移动处理。
   * 计算鼠标地面投影相对起点的位移，并只保留墙面法向方向分量。
   * @param event - 鼠标移动事件
   */
  private _onWallDragMouseMove = (event: MouseEvent): void => {
    if (!this._isDraggingWall || this._dragWallId === null || this._camera === null || this._domElement === null) {
      return;
    }

    const rect: DOMRect = this._domElement.getBoundingClientRect();
    const ndcX: number = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY: number = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._dragRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this._camera);

    const groundPoint: THREE.Vector3 = new THREE.Vector3();
    const groundHit: THREE.Vector3 | null = this._dragRaycaster.ray.intersectPlane(this._dragGroundPlane, groundPoint);
    if (groundHit === null) {
      return;
    }

    /* 墙体移动跟随流程：当前鼠标地面点表示用户希望拖拽锚点到达的位置；
     * 先扣除拖拽开始时锚点到中心线的法向距离，得到目标中心线位置，再换算为相对初始中心线的法向位移。
     */
    const currentMouseNormalDistance: number =
      (groundPoint.x - this._dragWallStartLinePoint.x) * this._dragWallNormal.x +
      (groundPoint.z - this._dragWallStartLinePoint.z) * this._dragWallNormal.z;
    const normalDistance: number = currentMouseNormalDistance - this._dragWallHitToLineNormalDistance;
    const targetOffset: Point2D = {
      x: this._dragWallNormal.x * normalDistance,
      z: this._dragWallNormal.z * normalDistance,
    };
    const incrementalOffset: Point2D = {
      x: targetOffset.x - this._dragWallAppliedOffset.x,
      z: targetOffset.z - this._dragWallAppliedOffset.z,
    };

    if (Math.abs(incrementalOffset.x) < 0.000001 && Math.abs(incrementalOffset.z) < 0.000001) {
      return;
    }

    this._objectManager.moveStraightWallWithConnections(this._dragWallId, incrementalOffset);
    this._dragWallAppliedOffset = targetOffset;
  };

  /** 结束墙体拖拽并把最终法向位移写入历史命令。 */
  private _endWallDrag(): void {
    if (!this._isDraggingWall || this._dragWallId === null) {
      return;
    }

    if (this._domElement !== null) {
      this._domElement.removeEventListener('mousemove', this._onWallDragMouseMove);
    }

    const wallId: string = this._dragWallId;
    const appliedOffset: Point2D = { x: this._dragWallAppliedOffset.x, z: this._dragWallAppliedOffset.z };
    if (
      this._historyManager !== null &&
      (Math.abs(appliedOffset.x) > 0.000001 || Math.abs(appliedOffset.z) > 0.000001)
    ) {
      /* 先回滚实时预览位移，再由命令栈执行同一位移，保证撤销/重做状态一致。 */
      this._objectManager.moveStraightWallWithConnections(wallId, { x: -appliedOffset.x, z: -appliedOffset.z });
      const command: WallMoveCommand = new WallMoveCommand(
        this._objectManager,
        wallId,
        appliedOffset,
        `2D 法向拖拽移动墙体 "${wallId}"`
      );
      this._historyManager.execute(command);
    }

    this._isDraggingWall = false;
    this._dragWallId = null;
    this._dragWallAppliedOffset = { x: 0, z: 0 };
    this._dragWallStartGroundPoint.set(0, 0, 0);
    this._dragWallStartHitPoint.set(0, 0, 0);
    this._dragWallStartLinePoint = { x: 0, z: 0 };
    this._dragWallHitToLineNormalDistance = 0;
    this._objectManager
  }

  /**
   * 拖拽过程中的鼠标移动处理
   * 将 Mesh 移动到鼠标地面投影点（加偏移），并应用包围盒吸附
   */
  private _onDragMouseMove = (event: MouseEvent): void => {
    if (!this._isDraggingStl || this._camera === null || this._domElement === null) {
      return;
    }

    const selectedMesh: THREE.Mesh | null = this._selectionManager.selectedStlMesh;
    if (selectedMesh === null) {
      this._endDrag(null);
      return;
    }

    /* 计算鼠标 NDC 坐标 */
    const rect: DOMRect = this._domElement.getBoundingClientRect();
    const ndcX: number = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY: number = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._dragRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this._camera);

    /* 射线与地面求交 */
    const groundIntersect: THREE.Vector3 = new THREE.Vector3();
    const groundHit: THREE.Vector3 | null = this._dragRaycaster.ray.intersectPlane(
      this._dragGroundPlane,
      groundIntersect
    );
    if (groundHit === null) {
      return;
    }

    /* 计算新位置（保持鼠标按下时的相对偏移） */
    const newX: number = groundIntersect.x + this._dragOffsetX;
    const newZ: number = groundIntersect.z + this._dragOffsetZ;

    /* 门窗已绑定墙体时，2D 拖拽必须投影到原墙体中心线，只允许沿墙布置线方向移动，高度保持不变。 */
    const wallSnapResult: WallSnapResult | null = this._projectDoorWindowDragToWall(
      selectedMesh,
      newX,
      newZ
    );
    if (wallSnapResult !== null) {
      selectedMesh.position.set(
        wallSnapResult.snapPoint.x,
        selectedMesh.position.y,
        wallSnapResult.snapPoint.z
      );
      selectedMesh.userData['snapT'] = wallSnapResult.t;
      selectedMesh.userData['wallDirX'] = wallSnapResult.wallDir.x;
      selectedMesh.userData['wallDirZ'] = wallSnapResult.wallDir.z;
      selectedMesh.userData['wallNormalX'] = wallSnapResult.wallNormal.x;
      selectedMesh.userData['wallNormalZ'] = wallSnapResult.wallNormal.z;
      selectedMesh.updateMatrixWorld(true);

      if (this._dragSnapGuideLines !== null) {
        this._dragSnapGuideLines.hide();
      }
      this._updateDraggingOutline(selectedMesh);
      this._updateDoorWindowDimension(selectedMesh);
      return;
    }

    selectedMesh.position.set(newX, selectedMesh.position.y, newZ);
    selectedMesh.updateMatrixWorld(true);

    /* 收集包围盒吸附目标（其他 STL 模型 + 墙体 Mesh，排除自身） */
    const targetMeshes: Array<THREE.Mesh> = this._collectBBoxSnapTargets(selectedMesh);

    if (targetMeshes.length > 0) {
      /* 计算吸附偏移 */
      const snapResult: BBoxSnapResult = StlBBoxSnapHelper.findSnap(selectedMesh, targetMeshes);

      /* 应用吸附偏移 */
      if (snapResult.snappedX || snapResult.snappedZ) {
        selectedMesh.position.x += snapResult.offsetX;
        selectedMesh.position.z += snapResult.offsetZ;
        selectedMesh.updateMatrixWorld(true);
      }

      /* 更新虚线提示 */
      if (this._dragSnapGuideLines !== null) {
        this._dragSnapGuideLines.update(snapResult, selectedMesh);
      }
    } else {
      /* 无吸附目标：隐藏虚线 */
      if (this._dragSnapGuideLines !== null) {
        this._dragSnapGuideLines.hide();
      }
    }

    this._updateDraggingOutline(selectedMesh);
    this._clearDoorWindowDimension();
  };

  /**
   * 更新当前门窗到相邻门窗或墙内侧边界的沿墙距离标注。
   * @param mesh - 当前选中或拖拽的门窗 Mesh
   */
  private _updateDoorWindowDimension(mesh: THREE.Mesh): void {
    if (this._sceneManager === null || this._viewMode !== '2d') {
      this._clearDoorWindowDimension();
      return;
    }

    const category: unknown = mesh.userData['category'];
    const wallId: unknown = mesh.userData['wallId'];
    if (!DoorWindow2DSymbolHelper.isDoorWindowCategory(category) || typeof wallId !== 'string') {
      this._clearDoorWindowDimension();
      return;
    }

    const wallObject: BuildingObject | undefined = this._objectManager.getById(wallId);
    if (wallObject === undefined || wallObject.category !== 'wall' || wallObject.subType !== 'straight') {
      this._clearDoorWindowDimension();
      return;
    }

    /* 标注刷新流程：根据当前门窗世界包围盒计算其沿墙区间，并显示到最近同墙门窗或墙端内侧边界的距离。 */
    const scene: THREE.Scene = this._sceneManager.getScene();
    const wallData: StraightWallData = wallObject as StraightWallData;
    this._doorWindowDimensionRenderer.updateForPlacedDoorWindow(mesh, wallData, scene);
  }

  /** 隐藏当前门窗距离标注。 */
  private _clearDoorWindowDimension(): void {
    if (this._sceneManager === null) {
      return;
    }
    const scene: THREE.Scene = this._sceneManager.getScene();
    this._doorWindowDimensionRenderer.clear(scene);
  }

  /**
   * 将 2D 门窗拖拽位置投影到其绑定墙体中心线上。
   * @param mesh - 正在拖拽的 STL Mesh
   * @param targetX - 鼠标换算出的目标 X 坐标
   * @param targetZ - 鼠标换算出的目标 Z 坐标
   * @returns 可用于墙洞重算的吸附结果；非绑定门窗或墙体无效时返回 null
   */
  private _projectDoorWindowDragToWall(mesh: THREE.Mesh, targetX: number, targetZ: number): WallSnapResult | null {
    const category: unknown = mesh.userData['category'];
    const wallId: unknown = mesh.userData['wallId'];
    if (!DoorWindow2DSymbolHelper.isDoorWindowCategory(category) || typeof wallId !== 'string') {
      return null;
    }

    const wallObject: BuildingObject | undefined = this._objectManager.getById(wallId);
    if (wallObject === undefined || wallObject.category !== 'wall' || wallObject.subType !== 'straight') {
      return null;
    }

    const wallData: StraightWallData = wallObject as StraightWallData;
    const startX: number = wallData.start.x;
    const startZ: number = wallData.start.z;
    const dirRawX: number = wallData.end.x - startX;
    const dirRawZ: number = wallData.end.z - startZ;
    const wallLength: number = Math.sqrt(dirRawX * dirRawX + dirRawZ * dirRawZ);
    if (wallLength < 0.001) {
      return null;
    }

    /* 将鼠标目标点投影到墙体中心线段，并将 t 限制在墙段范围内，避免门窗脱离墙体。 */
    const dirX: number = dirRawX / wallLength;
    const dirZ: number = dirRawZ / wallLength;
    const px: number = targetX - startX;
    const pz: number = targetZ - startZ;
    const tRaw: number = (px * dirX + pz * dirZ) / wallLength;
    const t: number = Math.max(0, Math.min(1, tRaw));
    const snapX: number = startX + dirX * t * wallLength;
    const snapZ: number = startZ + dirZ * t * wallLength;
    const wallDir: THREE.Vector3 = new THREE.Vector3(dirX, 0, dirZ);
    const wallNormal: THREE.Vector3 = new THREE.Vector3(-dirZ, 0, dirX);
    const snapPoint: THREE.Vector3 = new THREE.Vector3(snapX, 0, snapZ);
    const dx: number = targetX - snapX;
    const dz: number = targetZ - snapZ;
    const distance: number = Math.sqrt(dx * dx + dz * dz);

    return {
      wallId: wallId,
      snapPoint: snapPoint,
      wallNormal: wallNormal,
      wallDir: wallDir,
      t: t,
      distance: distance,
    };
  }

  /**
   * 更新 2D 拖拽中的选中包围盒轮廓。
   * @param selectedMesh - 正在拖拽的 Mesh
   */
  private _updateDraggingOutline(selectedMesh: THREE.Mesh): void {
    if (this._sceneManager === null) {
      return;
    }

    const scene: THREE.Scene = this._sceneManager.getScene();
    selectedMesh.updateMatrixWorld(true);
    BoundingBoxHelper.attachOutline(selectedMesh, scene);
  }

  /**
   * 扩展 _onMouseUp：拖拽结束时提交移动命令
   * 注意：此方法替换原有 _onMouseUp，在原有点选逻辑基础上增加拖拽结束处理
   */
  private _endDrag(mesh: THREE.Mesh | null): void {
    if (!this._isDraggingStl) {
      return;
    }

    /* 解绑 mousemove 事件 */
    if (this._domElement !== null) {
      this._domElement.removeEventListener('mousemove', this._onDragMouseMove);
    }

    /* 销毁虚线提示 */
    if (this._dragSnapGuideLines !== null) {
      this._dragSnapGuideLines.dispose();
      this._dragSnapGuideLines = null;
    }

    /* 若 Mesh 有效且位置发生了变化，通过命令栈记录移动操作 */
    if (
      mesh !== null &&
      this._historyManager !== null &&
      !mesh.position.equals(this._dragStartMeshPos)
    ) {
      const handledAsDoorWindow: boolean = this._executeDoorWindowDragMoveCommand(mesh);
      if (!handledAsDoorWindow) {
        const afterPos: THREE.Vector3 = mesh.position.clone();
        /* 先将 Mesh 还原到拖拽前位置，再通过命令栈 execute 移动到目标位置
         * 这样 CommandHistoryManager.execute() 调用 cmd.execute() 时能正确移动
         * 同时保证撤销时能还原到正确的 before 位置
         */
        mesh.position.copy(this._dragStartMeshPos);
        mesh.updateMatrixWorld(true);

        const cmd: StlMoveCommand = new StlMoveCommand(
          mesh,
          this._dragStartMeshPos.clone(),
          afterPos,
          `拖拽移动 STL 模型 "${mesh.name}"`
        );
        this._historyManager.execute(cmd);
        console.log(`[SelectionTool] STL 拖拽移动已记录: ${mesh.name}`);
      }
    }

    this._isDraggingStl = false;
    this._dragStartSnapshot = null;
    this._clearDoorWindowDimension();
  }

  /**
   * 为绑定墙体的门窗提交“移动 + 墙洞重算”复合命令。
   * @param mesh - 拖拽结束的门窗 Mesh
   * @returns 成功提交门窗复合命令时返回 true；不适用时返回 false
   */
  private _executeDoorWindowDragMoveCommand(mesh: THREE.Mesh): boolean {
    if (this._historyManager === null || this._dragStartSnapshot === null) {
      return false;
    }

    const snapResult: WallSnapResult | null = this._projectDoorWindowDragToWall(
      mesh,
      mesh.position.x,
      mesh.position.z
    );
    if (snapResult === null) {
      return false;
    }

    const wallObject: BuildingObject | undefined = this._objectManager.getById(snapResult.wallId);
    if (wallObject === undefined || wallObject.category !== 'wall' || wallObject.subType !== 'straight') {
      return false;
    }

    const wallData: StraightWallData = wallObject as StraightWallData;
    const currentOpenings: WallOpening[] = (wallData.openings ?? []).map(
      (opening: WallOpening): WallOpening => ({ ...opening })
    );
    const oldSnapT: number = this._computeTFromPosition(this._dragStartMeshPos, wallData);
    const baseOpenings: WallOpening[] = this._removeClosestOpening(currentOpenings, oldSnapT);

    /* 按最终投影点更新 Mesh 和 userData，确保命令 after 快照、墙洞参数与当前 2D 图标位置完全一致。 */
    mesh.position.set(snapResult.snapPoint.x, mesh.position.y, snapResult.snapPoint.z);
    mesh.userData['snapT'] = snapResult.t;
    mesh.userData['wallDirX'] = snapResult.wallDir.x;
    mesh.userData['wallDirZ'] = snapResult.wallDir.z;
    mesh.userData['wallNormalX'] = snapResult.wallNormal.x;
    mesh.userData['wallNormalZ'] = snapResult.wallNormal.z;
    mesh.updateMatrixWorld(true);

    const afterSnapshot: TransformSnapshot = TransformCommand.capture(mesh);
    const newOpening: WallOpening = WallOpeningCutter.computeOpening(snapResult, mesh, wallData);

    /* 先还原到拖拽前位姿，再通过命令栈执行复合命令，保证撤销/重做时位置与墙洞同步。 */
    mesh.position.copy(this._dragStartMeshPos);
    mesh.updateMatrixWorld(true);

    const cmd: StlMoveWithOpeningCommand = new StlMoveWithOpeningCommand(
      mesh,
      this._dragStartSnapshot,
      afterSnapshot,
      this._objectManager,
      snapResult.wallId,
      baseOpenings,
      newOpening,
      `2D 拖拽移动门窗 "${mesh.name}"`
    );
    this._historyManager.execute(cmd);

    console.log(
      `[SelectionTool] 2D 门窗拖拽移动已记录: ${mesh.name}, ` +
      `墙体=${snapResult.wallId}, t=${snapResult.t.toFixed(3)}`
    );
    return true;
  }

  /**
   * 计算世界坐标位置在指定直墙中线上的参数 t。
   * @param pos - 世界坐标位置
   * @param wall - 直墙数据
   * @returns 限制在 [0, 1] 范围内的墙线参数
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
   * 从洞口列表中移除与指定 t 值最接近的洞口。
   * @param openings - 当前洞口列表
   * @param targetT - 要匹配移除的旧洞口中心参数
   * @returns 移除旧洞口后的洞口列表
   */
  private _removeClosestOpening(openings: WallOpening[], targetT: number): WallOpening[] {
    if (openings.length === 0) {
      return [];
    }

    let closestIndex: number = 0;
    let closestDistance: number = Math.abs(openings[0]!.centerT - targetT);
    for (let index: number = 1; index < openings.length; index += 1) {
      const distance: number = Math.abs(openings[index]!.centerT - targetT);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }

    const result: WallOpening[] = openings.map((opening: WallOpening): WallOpening => ({ ...opening }));
    result.splice(closestIndex, 1);
    return result;
  }

  /**
   * 收集包围盒吸附目标 Mesh 列表（排除自身）
   * 包含：场景中已放置的其他 STL 模型 Mesh + 建筑对象 Mesh（墙体等）
   * @param excludeMesh - 要排除的 Mesh（拖拽中的自身）
   * @returns 目标 Mesh 数组
   */
  private _collectBBoxSnapTargets(excludeMesh: THREE.Mesh): Array<THREE.Mesh> {
    const targets: Array<THREE.Mesh> = [];

    /* 收集场景中已放置的 STL 模型 Mesh（排除自身） */
    if (this._sceneManager !== null) {
      const scene: THREE.Scene = this._sceneManager.getScene();
      scene.traverse((child: THREE.Object3D): void => {
        if (
          child instanceof THREE.Mesh &&
          child.userData['stlModelId'] !== undefined &&
          child.visible &&
          child.uuid !== excludeMesh.uuid
        ) {
          targets.push(child);
        }
      });
    }

    /* 收集建筑对象 Mesh（墙体等） */
    if (this._buildingManagerForDrag !== null) {
      const buildingMeshes: Array<{ id: string; mesh: THREE.Mesh }> = this._buildingManagerForDrag.getAllMeshes();
      for (const item of buildingMeshes) {
        if (item.mesh.visible) {
          targets.push(item.mesh);
        }
      }
    }

    return targets;
  }

  /**
   * 销毁工具，解绑事件
   */
  public dispose(): void {
    /* 若正在拖拽，先结束拖拽（不提交命令） */
    if (this._isDraggingStl) {
      if (this._domElement !== null) {
        this._domElement.removeEventListener('mousemove', this._onDragMouseMove);
      }
      if (this._dragSnapGuideLines !== null) {
        this._dragSnapGuideLines.dispose();
        this._dragSnapGuideLines = null;
      }
      this._isDraggingStl = false;
      this._dragStartSnapshot = null;
    }
    if (this._isDraggingWall) {
      if (this._domElement !== null) {
        this._domElement.removeEventListener('mousemove', this._onWallDragMouseMove);
      }
      this._isDraggingWall = false;
      this._dragWallId = null;
      this._dragWallAppliedOffset = { x: 0, z: 0 };
    }
    this._clearDoorWindowDimension();
    if (this._sceneManager !== null) {
      this._doorWindowDimensionRenderer.dispose(this._sceneManager.getScene());
    }
    this.disable();
  }
}
