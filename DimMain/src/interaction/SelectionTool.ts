/**
 * 选择交互工具
 * 监听 Canvas 的鼠标和键盘事件，实现点选 / Ctrl 多选 / Delete 删除
 * 与绘制工具互斥，由外部通过 enable/disable 控制启用状态
 * 注意：框选功能已移除，仅保留点选和键盘操作
 */

import * as THREE from 'three/webgpu';
import type { SelectionManager } from './SelectionManager';
import type { BuildingObjectManager, StraightWallDragSnapshot } from '../building/BuildingObjectManager';
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
import type { DoorWindowDimensionEditSide } from '../model/DoorWindowPlacementDimensionRenderer';
import { StlPlacementDimensionRenderer } from '../model/StlPlacementDimensionRenderer';
import type { StlPlacementDimensionSide } from '../model/StlPlacementDimensionRenderer';
import { WallOpeningCutter } from '../building/WallOpeningCutter';
import { StlMoveWithOpeningCommand } from '../history/commands/StlMoveWithOpeningCommand';
import { TransformCommand } from '../history/commands/TransformCommand';
import type { TransformSnapshot } from '../history/commands/TransformCommand';
import type { BuildingObject, Point2D, StraightWallData, WallOpening } from '../building/BuildingTypes';
import type { WallSnapResult } from '../building/WallSnapHelper';
import { DoorOpeningDirectionHelper } from '../model/DoorOpeningDirectionHelper';
import { HoverOutlineHelper } from './HoverOutlineHelper';
import type { OrbitControlsWrapper } from '../camera/OrbitControlsWrapper';

/** 米与毫米之间的换算倍率。 */
const MILLIMETER_TO_METER: number = 0.001;

/** 鼠标悬停轮廓临时阻断原因。*/
type HoverOutlineBlockReason = 'leftButton' | 'wheel';

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

  /** 键盘删除流程锁：防止 Delete/Backspace 重复事件或重复监听导致确认弹窗连续触发。 */
  private _isDeletingByKeyboard: boolean = false;

  /** 射线投射辅助器 */
  private _raycastHelper: RaycastHelper = new RaycastHelper();

  /** 鼠标悬停轮廓辅助器 */
  private _hoverOutlineHelper: HoverOutlineHelper = new HoverOutlineHelper();

  /** 鼠标悬停轮廓阻断原因集合，用于避免相机交互、滚轮缩放或按键拖动期间触发黄色预选中。 */
  private _hoverOutlineBlockReasons: Set<HoverOutlineBlockReason> = new Set<HoverOutlineBlockReason>();

  /** 滚轮缩放结束后恢复悬停检测的延迟计时器。 */
  private _hoverOutlineWheelReleaseTimer: number | null = null;

  /** 轨道控制器引用：用于在相机旋转、缩放、平移期间暂停所有悬停/预选检测。 */
  private _orbitControls: OrbitControlsWrapper | null = null;

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

  /** 鼠标按下后是否进入过相机独占交互，用于在 mouseup 阶段阻断误点选。 */
  private _cameraInteractionStartedDuringMouseDown: boolean = false;

  /** 射线投射器（用于 mousedown 时检测 Gizmo） */
  private _gizmoRaycaster: THREE.Raycaster = new THREE.Raycaster();

  /** 点选判定阈值（像素），移动超过此距离视为拖拽，不触发点选 */
  private static readonly CLICK_THRESHOLD: number = 5;

  /** 滚轮缩放期间暂停黄色预选中检测的去抖恢复时间。 */
  private static readonly HOVER_OUTLINE_WHEEL_BLOCK_RELEASE_MS: number = 120;

  /** 2D 直墙精确命中容差（米）：避免点击墙体附近空白处时因 Mesh 射线误命中而无法取消选中 */
  private static readonly WALL_2D_HIT_TOLERANCE: number = 0.005;

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

  /** 墙体拖拽开始时的直墙与连接节点快照，用于按 P + L 方式实时预览。 */
  private _dragWallSnapshot: StraightWallDragSnapshot | null = null;

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

  /** 2D 门窗拖拽/选中时的沿墙距离标注渲染器（由 BuildingContext 注入的共享对象池）。 */
  private readonly _doorWindowDimensionRenderer: DoorWindowPlacementDimensionRenderer;

  private readonly _stlPlacementDimensionRenderer: StlPlacementDimensionRenderer;

  /** 是否由当前选择工具创建普通 STL 标注渲染器；共享实例由 BuildingContext 统一释放。 */
  private readonly _ownsStlPlacementDimensionRenderer: boolean;

  /** 当前正在编辑的选中距离标注类型。 */
  private _dimensionEditKind: 'doorWindow' | 'stl' | null = null;

  /** 当前正在编辑的门窗距离标注侧。 */
  private _doorWindowDimensionEditSide: DoorWindowDimensionEditSide | null = null;

  /** 当前正在编辑的普通 STL 四方向距离标注侧。 */
  private _stlDimensionEditSide: StlPlacementDimensionSide | null = null;

  /** 当前尺寸编辑输入文本，单位为毫米。 */
  private _dimensionEditInputText: string = '';

  /** 尺寸编辑开始时 Mesh 位置快照，用于取消和命令栈 before。 */
  private _dimensionEditStartMeshPos: THREE.Vector3 = new THREE.Vector3();

  /** 尺寸编辑开始时 Mesh 完整位姿快照，用于门窗洞口同步命令。 */
  private _dimensionEditStartSnapshot: TransformSnapshot | null = null;

  /**
   * @param selectionManager - 选择管理器
   * @param objectManager - 建筑对象管理器
   * @param sceneManager - 场景管理器（可选，支持 STL 模型拾取和删除）
   * @param historyManager - 命令历史管理器（可选，删除操作支持撤销/重做）
   * @param doorWindowDimensionRenderer - 共享门窗标注渲染器，用于更新已有动态标注对象
   * @param stlPlacementDimensionRenderer - 共享普通 STL 标注渲染器，用于更新已有动态标注对象
   */
  constructor(
    selectionManager: SelectionManager,
    objectManager: BuildingObjectManager,
    sceneManager?: SceneManager,
    historyManager?: CommandHistoryManager,
    doorWindowDimensionRenderer?: DoorWindowPlacementDimensionRenderer,
    stlPlacementDimensionRenderer?: StlPlacementDimensionRenderer
  ) {
    this._selectionManager = selectionManager;
    this._objectManager = objectManager;
    this._sceneManager = sceneManager ?? null;
    this._historyManager = historyManager ?? null;
    this._doorWindowDimensionRenderer = doorWindowDimensionRenderer ?? new DoorWindowPlacementDimensionRenderer();
    this._stlPlacementDimensionRenderer = stlPlacementDimensionRenderer ?? new StlPlacementDimensionRenderer();
    this._ownsStlPlacementDimensionRenderer = stlPlacementDimensionRenderer === undefined;
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
    domElement.addEventListener('mousemove', this._onMouseMove);
    domElement.addEventListener('mouseleave', this._onMouseLeave);
    domElement.addEventListener('wheel', this._onWheel, { passive: true });
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('mouseup', this._onWindowMouseUp);
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
      this._domElement.removeEventListener('mousemove', this._onMouseMove);
      this._domElement.removeEventListener('mouseleave', this._onMouseLeave);
      this._domElement.removeEventListener('wheel', this._onWheel);
    }
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('mouseup', this._onWindowMouseUp);

    this._clearHoverOutlineBlockReasons();

    this._clearHoverOutline();

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
   * 注入轨道控制器引用。
   * 选择工具会在相机旋转、缩放、平移和阻尼惯性期间暂停所有悬停/预选检测，避免选择逻辑干扰视角控制。
   * @param orbitControls - 当前场景使用的轨道控制器；传入 null 表示取消注入
   */
  public setOrbitControls(orbitControls: OrbitControlsWrapper | null): void {
    this._orbitControls = orbitControls;
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
   * 鼠标移动：实时检测可拾取模型并显示悬停轮廓。
   * @param event - 鼠标移动事件
   */
  private _onMouseMove = (event: MouseEvent): void => {
    if (this._shouldBlockHoverOutline()) {
      /* 鼠标按键或滚轮缩放期间由视角控制/拖拽流程独占输入，清理黄色预选中轮廓。 */
      this._clearHoverOutline();
      return;
    }
    this._updateHoverOutline(event.clientX, event.clientY);
  };

  /** 鼠标离开画布：清理悬停轮廓，避免视觉残留。 */
  private _onMouseLeave = (): void => {
    this._clearHoverOutline();
  };

  /**
   * 鼠标滚轮：临时阻断黄色预选中检测，不阻止事件冒泡和默认行为，确保 OrbitControls 可以正常缩放。
   * @param event - 鼠标滚轮事件
   */
  private _onWheel = (event: WheelEvent): void => {
    this._setHoverOutlineBlocked('wheel', true);
    this._clearHoverOutline();

    /* 滚轮事件可能连续触发，通过去抖计时在缩放输入停止后再恢复 hover 检测。 */
    if (this._hoverOutlineWheelReleaseTimer !== null) {
      window.clearTimeout(this._hoverOutlineWheelReleaseTimer);
      this._hoverOutlineWheelReleaseTimer = null;
    }

    this._hoverOutlineWheelReleaseTimer = window.setTimeout((): void => {
      this._hoverOutlineWheelReleaseTimer = null;
      this._setHoverOutlineBlocked('wheel', false);
      if (this._domElement !== null) {
        this._updateHoverOutline(event.clientX, event.clientY);
      }
    }, SelectionTool.HOVER_OUTLINE_WHEEL_BLOCK_RELEASE_MS);
  };

  /**
   * 全局鼠标抬起兜底：鼠标在画布外释放时也恢复悬停轮廓检测，避免黄色预选中被永久阻断。
   * @param event - 鼠标抬起事件
   */
  private _onWindowMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return;
    }

    this._setHoverOutlineBlocked('leftButton', false);
  };

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
    this._setHoverOutlineBlocked('leftButton', true);
    this._clearHoverOutline();

    this._mouseDownPos = { x: event.clientX, y: event.clientY };
    this._ctrlDownAtMouseDown = event.ctrlKey || event.metaKey;
    this._skipNextClick = false;
    this._cameraInteractionStartedDuringMouseDown = this._isBlockingCameraInteractionForClickSelect();

    if (this._cameraInteractionStartedDuringMouseDown) {
      /* 相机过渡、滚轮缩放或平移期间不允许点选，避免选择逻辑抢占真实相机交互。 */
      this._clearHoverOutline();
    }

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
          this._updateSelectedStlDimension(selectedMesh);

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
    if (event.button === 0) {
      this._setHoverOutlineBlocked('leftButton', false);
    }

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

    if (this._isBlockingCameraInteractionForClickSelect()) {
      /* 鼠标抬起时若仍处于非左键旋转类相机交互，则按相机操作处理，不触发点选。 */
      this._cameraInteractionStartedDuringMouseDown = true;
      this._clearHoverOutline();
    }

    /* 移动距离在阈值内且未命中 Gizmo 才视为点选。
     * 注意：三维视图下 OrbitControls 的左键也用于旋转，pointerdown 会先把状态标记为 rotating；
     * 因此不能仅因 rotating 状态跳过轻点选择，而应由移动距离阈值区分点击与拖拽旋转。
     */
    if (
      distance <= SelectionTool.CLICK_THRESHOLD &&
      !this._skipNextClick &&
      !this._cameraInteractionStartedDuringMouseDown
    ) {
      this._handleClickSelect(event.clientX, event.clientY, this._ctrlDownAtMouseDown);
    }

    this._mouseDownPos = null;
    this._skipNextClick = false;
    this._cameraInteractionStartedDuringMouseDown = false;
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

    if (this._handleDimensionEditKeyDown(event)) {
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopImmediatePropagation();

      /* 忽略键盘长按产生的重复 keydown，避免危险删除确认框重复弹出。 */
      if (event.repeat || this._isDeletingByKeyboard) {
        return;
      }

      this._isDeletingByKeyboard = true;
      try {
        /* 优先处理建筑对象删除 */
        if (this._selectionManager.hasSelection && this._historyManager !== null) {
          /* 删除楼板前二次确认：楼板删除会级联清理房间墙体、门窗和天花板。 */
          if (this._selectionManager.hasSelectedSlab()) {
            const confirmed: boolean = window.confirm('删除楼板会将整个房间相关模型全部删除，是否进行删除');
            if (!confirmed) {
              return;
            }

            if (this._sceneManager === null) {
              console.warn('[SelectionTool] 删除楼板失败：场景管理器未注入，无法级联删除门窗 STL');
              return;
            }

            const scene: THREE.Scene = this._sceneManager.getScene();
            const cascadeDeleted: Array<string> = this._selectionManager.deleteSelectedWithCascade(
              this._historyManager,
              scene
            );
            console.log(`🗑️ 已级联删除 ${cascadeDeleted.length} 个选中建筑对象`);
            return;
          }

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
      } finally {
        this._isDeletingByKeyboard = false;
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
      this._clearStlPlacementDimension();
      this._selectionManager.clearSelection();
    }
  };

  /* ========== 选择逻辑 ========== */

  /**
   * 更新鼠标悬停轮廓。
   * 复用点选拾取规则，在编辑拖拽期间主动隐藏轮廓，避免干扰交互反馈。
   * @param screenX - 屏幕坐标 X
   * @param screenY - 屏幕坐标 Y
   */
  private _updateHoverOutline(screenX: number, screenY: number): void {
    if (this._sceneManager === null || this._camera === null || this._domElement === null) {
      this._clearHoverOutline();
      return;
    }

    if (this._shouldBlockHoverOutline()) {
      this._clearHoverOutline();
      return;
    }

    if (this._isDraggingStl || this._isDraggingWall || this._dimensionEditKind !== null) {
      this._clearHoverOutline();
      return;
    }

    const scene: THREE.Scene = this._sceneManager.getScene();
    const target: THREE.Object3D | null = this._pickHoverTarget(screenX, screenY);
    if (target === null || this._isHoverTargetSelected(target)) {
      this._hoverOutlineHelper.clear(scene);
      return;
    }

    this._hoverOutlineHelper.show(target, scene);
  }

  /** 清理当前鼠标悬停轮廓。 */
  private _clearHoverOutline(): void {
    if (this._sceneManager === null) {
      return;
    }

    const scene: THREE.Scene = this._sceneManager.getScene();
    this._hoverOutlineHelper.clear(scene);
  }

  /**
   * 判断当前相机状态是否应阻断左键点选。
   * 左键轻点与 OrbitControls 左键旋转共用同一按键，pointerdown 阶段会短暂进入 rotating；
   * 此处只阻断缩放、平移和相机过渡，旋转由 mouseup 的移动距离阈值判断是否为拖拽。
   * @returns 处于会抢占点选的相机交互状态时返回 true
   */
  private _isBlockingCameraInteractionForClickSelect(): boolean {
    if (this._orbitControls === null) {
      return false;
    }

    const cameraInteractionState: ReturnType<OrbitControlsWrapper['getCameraInteractionState']> =
      this._orbitControls.getCameraInteractionState();

    return (
      cameraInteractionState === 'zooming' ||
      cameraInteractionState === 'panning' ||
      cameraInteractionState === 'transitioning'
    );
  }

  /**
   * 设置或取消鼠标悬停轮廓阻断原因。
   * @param reason - 阻断原因
   * @param blocked - true 表示添加阻断，false 表示解除阻断
   */
  private _setHoverOutlineBlocked(reason: HoverOutlineBlockReason, blocked: boolean): void {
    if (blocked) {
      this._hoverOutlineBlockReasons.add(reason);
      return;
    }

    this._hoverOutlineBlockReasons.delete(reason);
  }

  /** 清理所有鼠标悬停轮廓阻断状态，并释放滚轮恢复计时器。 */
  private _clearHoverOutlineBlockReasons(): void {
    if (this._hoverOutlineWheelReleaseTimer !== null) {
      window.clearTimeout(this._hoverOutlineWheelReleaseTimer);
      this._hoverOutlineWheelReleaseTimer = null;
    }

    this._hoverOutlineBlockReasons.clear();
  }

  /**
   * 判断当前是否应该暂停黄色预选中检测。
   * @returns 存在鼠标按键、滚轮缩放或编辑拖拽阻断原因时返回 true
   */
  private _shouldBlockHoverOutline(): boolean {
    return this._hoverOutlineBlockReasons.size > 0;
  }

  /**
   * 根据屏幕坐标拾取当前可显示悬停轮廓的目标对象。
   * @param screenX - 屏幕坐标 X
   * @param screenY - 屏幕坐标 Y
   * @returns 可高亮目标对象；未命中时返回 null
   */
  private _pickHoverTarget(screenX: number, screenY: number): THREE.Object3D | null {
    if (this._camera === null || this._domElement === null) {
      return null;
    }

    /* 2D 模式下门窗平面符号与墙体重叠，悬停检测也需优先回溯到门窗 STL。 */
    if (this._viewMode === '2d') {
      const doorWindowTarget: THREE.Mesh | null = this._pickDoorWindow2DSymbolOwner(screenX, screenY);
      if (doorWindowTarget !== null) {
        return doorWindowTarget;
      }
    }

    const allTargets: Array<THREE.Object3D> = this._collectHoverPickTargets();
    if (allTargets.length === 0) {
      return null;
    }

    const hit: MeshFaceHitResult | null = this._raycastHelper.screenToMeshFace(
      screenX,
      screenY,
      this._camera,
      this._domElement,
      allTargets
    );
    if (hit === null) {
      return null;
    }

    const buildingObjectId: unknown = hit.mesh.userData['buildingObjectId'];
    if (typeof buildingObjectId === 'string') {
      const buildingObject: BuildingObject | undefined = this._objectManager.getById(buildingObjectId);
      if (
        this._viewMode === '2d' &&
        buildingObject !== undefined &&
        buildingObject.category === 'wall' &&
        buildingObject.subType === 'straight' &&
        !this._isScreenPointInsideStraightWall2D(screenX, screenY, buildingObject)
      ) {
        return null;
      }

      return hit.mesh;
    }

    const stlModelId: unknown = hit.mesh.userData['stlModelId'];
    if (typeof stlModelId === 'string') {
      return hit.mesh;
    }

    return null;
  }

  /**
   * 收集鼠标悬停拾取目标。
   * @returns 建筑对象 Mesh 与 STL Mesh 合并后的目标列表
   */
  private _collectHoverPickTargets(): Array<THREE.Object3D> {
    const meshList: Array<{ id: string; mesh: THREE.Mesh }> = this._objectManager.getAllMeshes();
    const buildingTargets: Array<THREE.Object3D> = meshList
      .filter((item: { id: string; mesh: THREE.Mesh }): boolean => item.mesh.visible)
      .map((item: { id: string; mesh: THREE.Mesh }): THREE.Object3D => item.mesh);
    const stlTargets: Array<THREE.Object3D> = this._collectStlMeshes();

    return [...buildingTargets, ...stlTargets];
  }

  /**
   * 2D 模式下拾取门窗平面符号并回溯到所属 STL Mesh。
   * @param screenX - 屏幕坐标 X
   * @param screenY - 屏幕坐标 Y
   * @returns 所属 STL Mesh；未命中时返回 null
   */
  private _pickDoorWindow2DSymbolOwner(screenX: number, screenY: number): THREE.Mesh | null {
    if (this._sceneManager === null || this._camera === null || this._domElement === null) {
      return null;
    }

    const scene: THREE.Scene = this._sceneManager.getScene();
    const symbolTargets: Array<THREE.Object3D> = DoorWindow2DSymbolHelper.collectVisibleSymbolMeshes(scene);
    if (symbolTargets.length === 0) {
      return null;
    }

    const hit: MeshFaceHitResult | null = this._raycastHelper.screenToMeshFace(
      screenX,
      screenY,
      this._camera,
      this._domElement,
      symbolTargets
    );
    if (hit === null) {
      return null;
    }

    return DoorWindow2DSymbolHelper.resolveOwnerStlMesh(hit.mesh);
  }

  /**
   * 判断悬停目标是否已处于选中状态。
   * @param target - 鼠标当前命中的目标对象
   * @returns 已选中时返回 true
   */
  private _isHoverTargetSelected(target: THREE.Object3D): boolean {
    const buildingObjectId: unknown = target.userData['buildingObjectId'];
    if (typeof buildingObjectId === 'string') {
      return this._selectionManager.selectedIds.has(buildingObjectId);
    }

    const stlModelId: unknown = target.userData['stlModelId'];
    if (typeof stlModelId === 'string') {
      const selectedMesh: THREE.Mesh | null = this._selectionManager.selectedStlMesh;
      return selectedMesh !== null && selectedMesh.uuid === target.uuid;
    }

    return false;
  }

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

    /* 尺寸标注点击流程：选中 STL 后优先检测距离标签，命中后进入键盘尺寸编辑，不触发重新点选。 */
    if (this._viewMode === '2d' && this._tryBeginSelectedDimensionEdit(screenX, screenY)) {
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
      .filter((item: { id: string; mesh: THREE.Mesh }): boolean => {
        if (!item.mesh.visible) {
          return false;
        }
        /* 2D 点选流程：墙衔接节点圆片未登记到建筑对象 Mesh 列表，因此墙体仍需参与拾取以支持选择和拖拽。 */
        return true;
      })
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
        this._clearStlPlacementDimension();
        this._selectionManager.clearSelection();
      }
      return;
    }

    /* ===== 根据命中 Mesh 的 userData 判断对象类型 ===== */

    /* 优先判断建筑对象 */
    const buildingObjectId: unknown = hit.mesh.userData['buildingObjectId'];
    if (typeof buildingObjectId === 'string') {
      const buildingObject: BuildingObject | undefined = this._objectManager.getById(buildingObjectId);
      if (
        this._viewMode === '2d' &&
        buildingObject !== undefined &&
        buildingObject.category === 'wall' &&
        buildingObject.subType === 'straight' &&
        !this._isScreenPointInsideStraightWall2D(screenX, screenY, buildingObject)
      ) {
        /* 2D 视图下墙体 Mesh 可能在视觉边界外被射线误命中，此时按空白点击处理并取消选中。 */
        if (!isCtrl) {
          this._clearDoorWindowDimension();
          this._clearStlPlacementDimension();
          this._selectionManager.clearSelection();
        }
        return;
      }

      /* 选中墙体、梁等非 STL 建筑对象时，隐藏上一 STL 或门窗残留的动态距离标注。 */
      this._clearDoorWindowDimension();
      this._clearStlPlacementDimension();
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
      this._clearStlPlacementDimension();
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
    this._resetDimensionEditState(false);
    if (isCtrl) {
      this._selectionManager.toggleSelectStl(mesh, this._viewMode);
    } else {
      this._selectionManager.selectStl(mesh, this._viewMode);
    }

    const selectedMesh: THREE.Mesh | null = this._selectionManager.selectedStlMesh;
    if (selectedMesh !== null && selectedMesh.uuid === mesh.uuid) {
      this._updateSelectedStlDimension(mesh);
      return;
    }

    /* Ctrl 再次点击同一 STL 会取消选中，此时必须清理对应动态标注。 */
    this._clearDoorWindowDimension();
    this._clearStlPlacementDimension();
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

    const wallData: StraightWallData = wallObject as StraightWallData;
    const groundHit: THREE.Vector3 | null = this._dragRaycaster.ray.intersectPlane(
      this._dragGroundPlane,
      this._dragWallStartGroundPoint
    );
    if (groundHit === null) {
      return false;
    }

    /* 墙体拖拽启动精确判定：Three.js 射线可能在 2D 视图临近空白处擦到墙体侧面；
     * 必须使用鼠标在 Y=0 地面的真实投影点判断是否落入墙体矩形范围，
     * 否则会误启动拖拽并跳过 mouseup 的空白取消选中流程。
     */
    this._dragWallStartHitPoint.set(
      this._dragWallStartGroundPoint.x,
      0,
      this._dragWallStartGroundPoint.z
    );

    if (!this._isGroundPointInsideStraightWall2D(this._dragWallStartHitPoint, wallData)) {
      return false;
    }

    const dirX: number = wallData.end.x - wallData.start.x;
    const dirZ: number = wallData.end.z - wallData.start.z;
    const len: number = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (len < 0.001) {
      return false;
    }

    const dragWallSnapshot: StraightWallDragSnapshot | null = this._objectManager.createStraightWallDragSnapshot(wallId);
    if (dragWallSnapshot === null) {
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
    this._dragWallSnapshot = dragWallSnapshot;
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
    if (
      !this._isDraggingWall ||
      this._dragWallId === null ||
      this._dragWallSnapshot === null ||
      this._camera === null ||
      this._domElement === null
    ) {
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
    if (
      Math.abs(targetOffset.x - this._dragWallAppliedOffset.x) < 0.000001 &&
      Math.abs(targetOffset.z - this._dragWallAppliedOffset.z) < 0.000001
    ) {
      return;
    }

    /* 墙体与吸附门窗实时预览统一采用拖拽开始快照 P + 当前总偏移 L 计算，避免预览状态反复累加。 */
    this._objectManager.moveStraightWallWithConnectionsFromSnapshot(
      this._dragWallSnapshot,
      targetOffset
    );
    this._dragWallAppliedOffset = targetOffset;
  };

  /** 结束墙体拖拽并把最终法向位移写入历史命令。 */
  private _endWallDrag(): void {
    if (!this._isDraggingWall || this._dragWallId === null || this._dragWallSnapshot === null) {
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
      this._objectManager.moveStraightWallWithConnectionsFromSnapshot(
        this._dragWallSnapshot,
        { x: 0, z: 0 }
      );
      const command: WallMoveCommand = new WallMoveCommand(
        this._objectManager,
        wallId,
        appliedOffset,
        `2D 法向拖拽移动墙体 "${wallId}"`
      );
      this._historyManager.execute(command);
    }

    if (this._selectionManager.selectedIds.has(wallId)) {
      /* 墙体移动会重建 Mesh；拖拽完成后重新应用当前选中集合的高亮，保持选中态视觉一致。 */
      this._selectionManager.refreshSelectionHighlight();
    }

    this._isDraggingWall = false;
    this._dragWallId = null;
    this._dragWallAppliedOffset = { x: 0, z: 0 };
    this._dragWallSnapshot = null;
    this._dragWallStartGroundPoint.set(0, 0, 0);
    this._dragWallStartHitPoint.set(0, 0, 0);
    this._dragWallStartLinePoint = { x: 0, z: 0 };
    this._dragWallHitToLineNormalDistance = 0;
    this._dragWallNormal.set(0, 0, 0);
  }

  /**
   * 判断屏幕点在 2D 地面投影上是否真正落入直墙实体范围。
   * @param screenX - 屏幕坐标 X
   * @param screenY - 屏幕坐标 Y
   * @param wallData - 直墙数据
   * @returns 命中直墙实体范围时返回 true
   */
  private _isScreenPointInsideStraightWall2D(screenX: number, screenY: number, wallData: StraightWallData): boolean {
    const groundPoint: THREE.Vector3 = new THREE.Vector3();
    const groundHit: THREE.Vector3 | null = this._screenPointToGroundPoint(screenX, screenY, groundPoint);
    if (groundHit === null) {
      return false;
    }

    return this._isGroundPointInsideStraightWall2D(groundPoint, wallData);
  }

  /**
   * 将屏幕坐标转换为 Y=0 地面投影点。
   * @param screenX - 屏幕坐标 X
   * @param screenY - 屏幕坐标 Y
   * @param target - 接收投影结果的向量
   * @returns 成功投影时返回 target，否则返回 null
   */
  private _screenPointToGroundPoint(screenX: number, screenY: number, target: THREE.Vector3): THREE.Vector3 | null {
    if (this._camera === null || this._domElement === null) {
      return null;
    }

    const rect: DOMRect = this._domElement.getBoundingClientRect();
    const ndcX: number = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ndcY: number = -((screenY - rect.top) / rect.height) * 2 + 1;
    this._dragRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this._camera);

    return this._dragRaycaster.ray.intersectPlane(this._dragGroundPlane, target);
  }

  /**
   * 判断地面投影点是否位于直墙中心线长度与厚度构成的矩形范围内。
   * @param point - Y=0 地面投影点
   * @param wallData - 直墙数据
   * @returns 位于直墙实体范围内时返回 true
   */
  private _isGroundPointInsideStraightWall2D(point: THREE.Vector3, wallData: StraightWallData): boolean {
    const dirX: number = wallData.end.x - wallData.start.x;
    const dirZ: number = wallData.end.z - wallData.start.z;
    const length: number = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (length < 0.001) {
      return false;
    }

    const unitX: number = dirX / length;
    const unitZ: number = dirZ / length;
    const relativeX: number = point.x - wallData.start.x;
    const relativeZ: number = point.z - wallData.start.z;
    const alongDistance: number = relativeX * unitX + relativeZ * unitZ;
    const normalDistance: number = Math.abs(relativeX * -unitZ + relativeZ * unitX);
    const tolerance: number = SelectionTool.WALL_2D_HIT_TOLERANCE;

    /* 命中条件：点在线段投影范围内，且到墙体中心线的法向距离不超过半墙厚。 */
    return alongDistance >= -tolerance &&
      alongDistance <= length + tolerance &&
      normalDistance <= wallData.thickness * 0.5 + tolerance;
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
      this._updateSelectedStlDimension(selectedMesh);
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
    this._updateSelectedStlDimension(selectedMesh);
  };

  /**
   * 根据当前 STL 类型刷新对应动态距离标注。
   * @param mesh - 当前选中或拖拽的 STL Mesh
   */
  private _updateSelectedStlDimension(mesh: THREE.Mesh): void {
    const category: unknown = mesh.userData['category'];
    if (DoorWindow2DSymbolHelper.isDoorWindowCategory(category)) {
      /* 门窗模型沿用门窗专用标注，并清理普通 STL 标注，避免两类标注叠加。 */
      this._clearStlPlacementDimension();
      this._updateDoorWindowDimension(mesh);
      return;
    }

    /* 普通 STL 常规模型使用四方向包围盒到最近包围平面的动态标注。 */
    this._clearDoorWindowDimension();
    this._updateStlPlacementDimension(mesh);
  }

  /**
   * 检测当前选中 STL 的距离标注是否被点击，命中后进入尺寸编辑状态。
   * @param screenX - 鼠标屏幕坐标 X
   * @param screenY - 鼠标屏幕坐标 Y
   * @returns 命中可编辑标注时返回 true
   */
  private _tryBeginSelectedDimensionEdit(screenX: number, screenY: number): boolean {
    if (this._camera === null || this._domElement === null) {
      return false;
    }

    const selectedMesh: THREE.Mesh | null = this._selectionManager.selectedStlMesh;
    if (selectedMesh === null) {
      return false;
    }

    const category: unknown = selectedMesh.userData['category'];
    if (DoorWindow2DSymbolHelper.isDoorWindowCategory(category)) {
      const doorHit: { side: DoorWindowDimensionEditSide } | null = this._doorWindowDimensionRenderer.hitTestLabel(
        screenX,
        screenY,
        this._camera,
        this._domElement
      );
      if (doorHit === null) {
        return false;
      }
      this._beginDimensionEdit('doorWindow', doorHit.side, null, selectedMesh);
      return true;
    }

    if (category === 'model') {
      const stlHit: { side: StlPlacementDimensionSide } | null = this._stlPlacementDimensionRenderer.hitTestLabel(
        screenX,
        screenY,
        this._camera,
        this._domElement
      );
      if (stlHit === null) {
        return false;
      }
      this._beginDimensionEdit('stl', null, stlHit.side, selectedMesh);
      return true;
    }

    return false;
  }

  /**
   * 进入距离标注键盘编辑状态，并记录起始快照用于取消和撤销。
   * @param kind - 编辑的标注类型
   * @param doorSide - 门窗标注编辑侧
   * @param stlSide - 普通 STL 标注编辑侧
   * @param mesh - 当前选中 Mesh
   */
  private _beginDimensionEdit(
    kind: 'doorWindow' | 'stl',
    doorSide: DoorWindowDimensionEditSide | null,
    stlSide: StlPlacementDimensionSide | null,
    mesh: THREE.Mesh
  ): void {
    this._dimensionEditKind = kind;
    this._doorWindowDimensionEditSide = doorSide;
    this._stlDimensionEditSide = stlSide;
    this._dimensionEditInputText = '';
    this._dimensionEditStartMeshPos.copy(mesh.position);
    this._dimensionEditStartSnapshot = TransformCommand.capture(mesh);
    this._updateSelectedStlDimension(mesh);
  }

  /**
   * 处理尺寸编辑期间的键盘输入。
   * @param event - 键盘事件
   * @returns 事件已被尺寸编辑消费时返回 true
   */
  private _handleDimensionEditKeyDown(event: KeyboardEvent): boolean {
    if (this._dimensionEditKind === null) {
      return false;
    }

    const selectedMesh: THREE.Mesh | null = this._selectionManager.selectedStlMesh;
    if (selectedMesh === null) {
      this._resetDimensionEditState(false);
      return false;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this._commitDimensionEdit(selectedMesh);
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this._cancelDimensionEdit(selectedMesh);
      return true;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this._switchDimensionEditSide();
      this._dimensionEditInputText = '';
      this._updateSelectedStlDimension(selectedMesh);
      return true;
    }

    if (event.key === 'Backspace') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this._dimensionEditInputText.length > 0) {
        this._dimensionEditInputText = this._dimensionEditInputText.slice(0, -1);
        this._applyDimensionEditInput(selectedMesh);
        this._updateSelectedStlDimension(selectedMesh);
      }
      return true;
    }

    if (event.key === 'Delete') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this._dimensionEditInputText = '';
      this._updateSelectedStlDimension(selectedMesh);
      return true;
    }

    if (/^[0-9]$/.test(event.key) || event.key === '.') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === '.' && this._dimensionEditInputText.includes('.')) {
        return true;
      }
      this._dimensionEditInputText += event.key;
      this._applyDimensionEditInput(selectedMesh);
      this._updateSelectedStlDimension(selectedMesh);
      return true;
    }

    return true;
  }

  /** 切换当前尺寸编辑侧，方便键盘 Tab 在同类标注间快速切换。 */
  private _switchDimensionEditSide(): void {
    if (this._dimensionEditKind === 'doorWindow') {
      this._doorWindowDimensionEditSide = this._doorWindowDimensionEditSide === 'left' ? 'right' : 'left';
      return;
    }

    const sideOrder: StlPlacementDimensionSide[] = ['minX', 'maxX', 'minZ', 'maxZ'];
    const currentIndex: number = this._stlDimensionEditSide === null ? -1 : sideOrder.indexOf(this._stlDimensionEditSide);
    const nextIndex: number = (currentIndex + 1 + sideOrder.length) % sideOrder.length;
    this._stlDimensionEditSide = sideOrder[nextIndex]!;
  }

  /**
   * 根据当前输入的毫米距离实时调整选中 Mesh 位置。
   * @param mesh - 当前选中 Mesh
   */
  private _applyDimensionEditInput(mesh: THREE.Mesh): void {
    if (this._dimensionEditInputText === '' || this._dimensionEditInputText === '.') {
      return;
    }

    const inputMillimeter: number = Number(this._dimensionEditInputText);
    if (!Number.isFinite(inputMillimeter) || inputMillimeter < 0) {
      return;
    }

    const targetDistance: number = inputMillimeter * MILLIMETER_TO_METER;
    if (this._dimensionEditKind === 'doorWindow' && this._doorWindowDimensionEditSide !== null) {
      this._applyDoorWindowSelectedDistanceConstraint(mesh, this._doorWindowDimensionEditSide, targetDistance);
      return;
    }

    if (this._dimensionEditKind === 'stl' && this._stlDimensionEditSide !== null) {
      this._applyStlSelectedDistanceConstraint(mesh, this._stlDimensionEditSide, targetDistance);
    }
  }

  /**
   * 取消尺寸编辑，将模型还原到编辑开始前位置。
   * @param mesh - 当前选中 Mesh
   */
  private _cancelDimensionEdit(mesh: THREE.Mesh): void {
    mesh.position.copy(this._dimensionEditStartMeshPos);
    mesh.updateMatrixWorld(true);
    this._resetDimensionEditState(false);
    this._updateSelectedStlDimension(mesh);
    this._selectionManager.refreshSelectedStlHighlight(this._viewMode);
  }

  /**
   * 提交尺寸编辑，将实时预览位置转换为历史命令。
   * @param mesh - 当前选中 Mesh
   */
  private _commitDimensionEdit(mesh: THREE.Mesh): void {
    if (this._historyManager === null || mesh.position.equals(this._dimensionEditStartMeshPos)) {
      this._resetDimensionEditState(false);
      this._updateSelectedStlDimension(mesh);
      return;
    }

    const handledAsDoorWindow: boolean = this._executeDoorWindowDimensionEditCommand(mesh);
    if (!handledAsDoorWindow) {
      const afterPos: THREE.Vector3 = mesh.position.clone();
      mesh.position.copy(this._dimensionEditStartMeshPos);
      mesh.updateMatrixWorld(true);
      const command: StlMoveCommand = new StlMoveCommand(
        mesh,
        this._dimensionEditStartMeshPos.clone(),
        afterPos,
        `标注尺寸移动 STL 模型 "${mesh.name}"`
      );
      this._historyManager.execute(command);
    }

    this._resetDimensionEditState(false);
    this._selectionManager.refreshSelectedStlHighlight(this._viewMode);
    this._updateSelectedStlDimension(mesh);
  }

  /**
   * 清理尺寸编辑状态。
   * @param refreshDimension - 是否刷新当前标注显示
   */
  private _resetDimensionEditState(refreshDimension: boolean): void {
    const selectedMesh: THREE.Mesh | null = this._selectionManager.selectedStlMesh;
    this._dimensionEditKind = null;
    this._doorWindowDimensionEditSide = null;
    this._stlDimensionEditSide = null;
    this._dimensionEditInputText = '';
    this._dimensionEditStartSnapshot = null;
    this._dimensionEditStartMeshPos.set(0, 0, 0);
    if (refreshDimension && selectedMesh !== null) {
      this._updateSelectedStlDimension(selectedMesh);
    }
  }

  /**
   * 按门窗沿墙标注侧约束模型位置。
   * @param mesh - 当前门窗 Mesh
   * @param side - 当前编辑的门窗标注侧
   * @param targetDistance - 目标距离，单位米
   */
  private _applyDoorWindowSelectedDistanceConstraint(
    mesh: THREE.Mesh,
    side: DoorWindowDimensionEditSide,
    targetDistance: number
  ): void {
    const wallId: unknown = mesh.userData['wallId'];
    if (typeof wallId !== 'string' || this._sceneManager === null) {
      return;
    }

    const wallObject: BuildingObject | undefined = this._objectManager.getById(wallId);
    if (wallObject === undefined || wallObject.category !== 'wall' || wallObject.subType !== 'straight') {
      return;
    }

    const wallData: StraightWallData = wallObject as StraightWallData;
    const wallLength: number = this._computeWallLength(wallData);
    if (wallLength < 0.001) {
      return;
    }

    mesh.updateMatrixWorld(true);
    const wallDir: THREE.Vector3 = new THREE.Vector3(
      (wallData.end.x - wallData.start.x) / wallLength,
      0,
      (wallData.end.z - wallData.start.z) / wallLength
    );
    const wallOrigin: THREE.Vector3 = new THREE.Vector3(wallData.start.x, 0, wallData.start.z);
    const currentRange: { min: number; max: number } = this._computeMeshWallProjectionRange(mesh, wallOrigin, wallDir);
    const width: number = Math.max(0, currentRange.max - currentRange.min);
    const scene: THREE.Scene = this._sceneManager.getScene();
    const placedRanges: Array<{ min: number; max: number }> = this._collectPlacedDoorWindowRanges(mesh, wallId, wallOrigin, wallDir, scene);

    let targetMin: number = currentRange.min;
    if (side === 'left') {
      const leftBoundary: number = this._findDoorWindowLeftBoundary(currentRange.min, placedRanges);
      targetMin = leftBoundary + targetDistance;
    } else {
      const rightBoundary: number = this._findDoorWindowRightBoundary(currentRange.max, placedRanges, wallLength);
      targetMin = rightBoundary - targetDistance - width;
    }

    const clampedMin: number = Math.max(0, Math.min(wallLength - width, targetMin));
    const currentMin: number = currentRange.min;
    const deltaAlong: number = clampedMin - currentMin;
    if (Math.abs(deltaAlong) < 0.000001) {
      return;
    }

    mesh.position.x += wallDir.x * deltaAlong;
    mesh.position.z += wallDir.z * deltaAlong;
    const snapT: number = this._computeTFromPosition(mesh.position, wallData);
    mesh.userData['snapT'] = snapT;
    mesh.userData['wallDirX'] = wallDir.x;
    mesh.userData['wallDirZ'] = wallDir.z;
    mesh.updateMatrixWorld(true);
    this._updateSelectedStlDimension(mesh);
    this._selectionManager.refreshSelectedStlHighlight(this._viewMode);
  }

  /**
   * 按普通 STL 四方向距离标注约束模型位置。
   * @param mesh - 当前 STL Mesh
   * @param side - 当前编辑方向
   * @param targetDistance - 目标距离，单位米
   */
  private _applyStlSelectedDistanceConstraint(
    mesh: THREE.Mesh,
    side: StlPlacementDimensionSide,
    targetDistance: number
  ): void {
    const targets: THREE.Mesh[] = this._collectBBoxSnapTargets(mesh);
    if (targets.length === 0) {
      return;
    }

    mesh.updateMatrixWorld(true);
    const box: THREE.Box3 = new THREE.Box3().setFromObject(mesh);
    const targetBoxes: THREE.Box3[] = targets.map((target: THREE.Mesh): THREE.Box3 => new THREE.Box3().setFromObject(target));
    let delta: number = 0;
    if (side === 'minX') {
      const plane: number | null = this._findNearestLowerBoxPlane(box.min.x, targetBoxes, 'x');
      if (plane === null) { return; }
      delta = plane + targetDistance - box.min.x;
      mesh.position.x += delta;
    } else if (side === 'maxX') {
      const plane: number | null = this._findNearestUpperBoxPlane(box.max.x, targetBoxes, 'x');
      if (plane === null) { return; }
      delta = plane - targetDistance - box.max.x;
      mesh.position.x += delta;
    } else if (side === 'minZ') {
      const plane: number | null = this._findNearestLowerBoxPlane(box.min.z, targetBoxes, 'z');
      if (plane === null) { return; }
      delta = plane + targetDistance - box.min.z;
      mesh.position.z += delta;
    } else {
      const plane: number | null = this._findNearestUpperBoxPlane(box.max.z, targetBoxes, 'z');
      if (plane === null) { return; }
      delta = plane - targetDistance - box.max.z;
      mesh.position.z += delta;
    }

    if (Math.abs(delta) < 0.000001) {
      return;
    }
    mesh.updateMatrixWorld(true);
    this._updateSelectedStlDimension(mesh);
    this._selectionManager.refreshSelectedStlHighlight(this._viewMode);
  }

  /**
   * 更新普通 STL 常规模型到最近包围平面的四方向距离标注。
   * @param mesh - 当前选中或拖拽的普通 STL Mesh
   */
  private _updateStlPlacementDimension(mesh: THREE.Mesh): void {
    if (this._sceneManager === null || this._viewMode !== '2d') {
      this._clearStlPlacementDimension();
      return;
    }

    const stlModelId: unknown = mesh.userData['stlModelId'];
    const category: unknown = mesh.userData['category'];
    if (typeof stlModelId !== 'string' || category !== 'model') {
      this._clearStlPlacementDimension();
      return;
    }

    const scene: THREE.Scene = this._sceneManager.getScene();
    const targetMeshes: Array<THREE.Mesh> = this._collectBBoxSnapTargets(mesh);
    if (targetMeshes.length === 0) {
      this._clearStlPlacementDimension();
      return;
    }

    /* 标注刷新流程：编辑态只更新已有标注；非编辑态才允许准备对象池并显示动态标注。 */
    if (this._dimensionEditKind !== 'stl') {
      this._stlPlacementDimensionRenderer.prepare(scene);
    }
    const activeInputText: string | null = this._dimensionEditKind === 'stl' ? this._dimensionEditInputText : null;
    this._stlPlacementDimensionRenderer.update(mesh, targetMeshes, scene, this._stlDimensionEditSide, activeInputText);
  }

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
    const activeInputText: string | null = this._dimensionEditKind === 'doorWindow' ? this._dimensionEditInputText : null;
    if (this._dimensionEditKind === 'doorWindow') {
      this._doorWindowDimensionRenderer.updateExistingForPlacedDoorWindow(
        mesh,
        wallData,
        scene,
        this._doorWindowDimensionEditSide,
        activeInputText
      );
      return;
    }

    this._doorWindowDimensionRenderer.updateForPlacedDoorWindow(
      mesh,
      wallData,
      scene,
      this._doorWindowDimensionEditSide,
      activeInputText
    );
  }

  /** 隐藏当前门窗距离标注。 */
  private _clearDoorWindowDimension(): void {
    if (this._sceneManager === null) {
      return;
    }
    const scene: THREE.Scene = this._sceneManager.getScene();
    this._doorWindowDimensionRenderer.clear(scene);
  }

  /** 隐藏当前普通 STL 常规模型四方向距离标注。 */
  private _clearStlPlacementDimension(): void {
    if (this._sceneManager === null) {
      return;
    }
    const scene: THREE.Scene = this._sceneManager.getScene();
    this._stlPlacementDimensionRenderer.clear(scene);
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

    const shouldKeepSelectedVisualState: boolean =
      mesh !== null &&
      this._selectionManager.selectedStlMesh !== null &&
      this._selectionManager.selectedStlMesh.uuid === mesh.uuid;

    this._isDraggingStl = false;
    this._dragStartSnapshot = null;

    if (shouldKeepSelectedVisualState && mesh !== null) {
      /* 拖拽结束后保持选中态显示：将拖拽临时轮廓恢复为完整选中包围盒，并继续显示对应动态标注。 */
      this._selectionManager.refreshSelectedStlHighlight(this._viewMode);
      this._updateSelectedStlDimension(mesh);
      return;
    }

    /* 非选中对象或拖拽被中断时，清理动态标注，避免残留。 */
    this._clearDoorWindowDimension();
    this._clearStlPlacementDimension();
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
   * 为尺寸标注编辑后的门窗提交“移动 + 墙洞重算”复合命令。
   * @param mesh - 当前门窗 Mesh
   * @returns 成功提交门窗复合命令时返回 true；不适用时返回 false
   */
  private _executeDoorWindowDimensionEditCommand(mesh: THREE.Mesh): boolean {
    if (this._historyManager === null || this._dimensionEditStartSnapshot === null) {
      return false;
    }

    const snapResult: WallSnapResult | null = this._projectDoorWindowDragToWall(mesh, mesh.position.x, mesh.position.z);
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
    const oldSnapT: number = this._computeTFromPosition(this._dimensionEditStartMeshPos, wallData);
    const baseOpenings: WallOpening[] = this._removeClosestOpening(currentOpenings, oldSnapT);

    /* 提交流程：先按最终墙线投影修正 Mesh 与 userData，再记录 after 快照和新洞口。 */
    mesh.position.set(snapResult.snapPoint.x, mesh.position.y, snapResult.snapPoint.z);
    mesh.userData['snapT'] = snapResult.t;
    mesh.userData['wallDirX'] = snapResult.wallDir.x;
    mesh.userData['wallDirZ'] = snapResult.wallDir.z;
    mesh.userData['wallNormalX'] = snapResult.wallNormal.x;
    mesh.userData['wallNormalZ'] = snapResult.wallNormal.z;
    mesh.updateMatrixWorld(true);

    const afterSnapshot: TransformSnapshot = TransformCommand.capture(mesh);
    const newOpening: WallOpening = WallOpeningCutter.computeOpening(snapResult, mesh, wallData);

    mesh.position.copy(this._dimensionEditStartMeshPos);
    mesh.updateMatrixWorld(true);

    const command: StlMoveWithOpeningCommand = new StlMoveWithOpeningCommand(
      mesh,
      this._dimensionEditStartSnapshot,
      afterSnapshot,
      this._objectManager,
      snapResult.wallId,
      baseOpenings,
      newOpening,
      `标注尺寸移动门窗 "${mesh.name}"`
    );
    this._historyManager.execute(command);
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
   * 计算直墙中心线长度。
   * @param wall - 直墙数据
   * @returns 墙体长度，单位米
   */
  private _computeWallLength(wall: StraightWallData): number {
    const deltaX: number = wall.end.x - wall.start.x;
    const deltaZ: number = wall.end.z - wall.start.z;
    return Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
  }

  /**
   * 计算 Mesh 包围盒在墙方向上的投影区间。
   * @param mesh - 目标 Mesh
   * @param wallOrigin - 墙体起点
   * @param wallDir - 墙方向单位向量
   * @returns 沿墙方向投影区间
   */
  private _computeMeshWallProjectionRange(
    mesh: THREE.Mesh,
    wallOrigin: THREE.Vector3,
    wallDir: THREE.Vector3
  ): { min: number; max: number } {
    const box: THREE.Box3 = new THREE.Box3().setFromObject(mesh);
    const corners: THREE.Vector3[] = [
      new THREE.Vector3(box.min.x, 0, box.min.z),
      new THREE.Vector3(box.max.x, 0, box.min.z),
      new THREE.Vector3(box.min.x, 0, box.max.z),
      new THREE.Vector3(box.max.x, 0, box.max.z),
    ];
    let minValue: number = Infinity;
    let maxValue: number = -Infinity;
    for (let cornerIndex: number = 0; cornerIndex < corners.length; cornerIndex += 1) {
      const corner: THREE.Vector3 | undefined = corners[cornerIndex];
      if (corner === undefined) {
        continue;
      }
      const projectedValue: number = corner.clone().sub(wallOrigin).dot(wallDir);
      minValue = Math.min(minValue, projectedValue);
      maxValue = Math.max(maxValue, projectedValue);
    }
    return { min: minValue, max: maxValue };
  }

  /**
   * 收集同墙已放置门窗沿墙投影区间，排除当前 Mesh。
   * @param excludeMesh - 当前编辑 Mesh
   * @param wallId - 墙体 ID
   * @param wallOrigin - 墙体起点
   * @param wallDir - 墙方向单位向量
   * @param scene - Three.js 场景
   * @returns 同墙门窗区间数组
   */
  private _collectPlacedDoorWindowRanges(
    excludeMesh: THREE.Mesh,
    wallId: string,
    wallOrigin: THREE.Vector3,
    wallDir: THREE.Vector3,
    scene: THREE.Scene
  ): Array<{ min: number; max: number }> {
    const ranges: Array<{ min: number; max: number }> = [];
    scene.traverse((child: THREE.Object3D): void => {
      if (!(child instanceof THREE.Mesh) || child.uuid === excludeMesh.uuid || !child.visible) {
        return;
      }
      const childWallId: unknown = child.userData['wallId'];
      const childCategory: unknown = child.userData['category'];
      if (childWallId !== wallId || !DoorWindow2DSymbolHelper.isDoorWindowCategory(childCategory)) {
        return;
      }
      ranges.push(this._computeMeshWallProjectionRange(child, wallOrigin, wallDir));
    });
    return ranges;
  }

  /**
   * 查找门窗左侧最近边界，优先同墙左侧门窗右边界，否则为墙起点。
   * @param currentMin - 当前门窗左边界
   * @param ranges - 同墙门窗区间
   * @returns 左侧约束边界
   */
  private _findDoorWindowLeftBoundary(currentMin: number, ranges: Array<{ min: number; max: number }>): number {
    let boundary: number = 0;
    for (let rangeIndex: number = 0; rangeIndex < ranges.length; rangeIndex += 1) {
      const range: { min: number; max: number } | undefined = ranges[rangeIndex];
      if (range !== undefined && range.max <= currentMin + 0.001 && range.max > boundary) {
        boundary = range.max;
      }
    }
    return boundary;
  }

  /**
   * 查找门窗右侧最近边界，优先同墙右侧门窗左边界，否则为墙终点。
   * @param currentMax - 当前门窗右边界
   * @param ranges - 同墙门窗区间
   * @param wallLength - 墙体长度
   * @returns 右侧约束边界
   */
  private _findDoorWindowRightBoundary(
    currentMax: number,
    ranges: Array<{ min: number; max: number }>,
    wallLength: number
  ): number {
    let boundary: number = wallLength;
    for (let rangeIndex: number = 0; rangeIndex < ranges.length; rangeIndex += 1) {
      const range: { min: number; max: number } | undefined = ranges[rangeIndex];
      if (range !== undefined && range.min >= currentMax - 0.001 && range.min < boundary) {
        boundary = range.min;
      }
    }
    return boundary;
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
   * 查找当前边界下侧/左侧最近包围盒平面。
   * @param boundary - 当前边界坐标
   * @param boxes - 目标包围盒数组
   * @param axis - 计算轴向
   * @returns 最近平面坐标；不存在时返回 null
   */
  private _findNearestLowerBoxPlane(boundary: number, boxes: THREE.Box3[], axis: 'x' | 'z'): number | null {
    let nearestPlane: number | null = null;
    for (let boxIndex: number = 0; boxIndex < boxes.length; boxIndex += 1) {
      const box: THREE.Box3 | undefined = boxes[boxIndex];
      if (box === undefined) {
        continue;
      }
      const planeA: number = axis === 'x' ? box.min.x : box.min.z;
      const planeB: number = axis === 'x' ? box.max.x : box.max.z;
      nearestPlane = this._pickNearestLowerPlane(boundary, nearestPlane, planeA);
      nearestPlane = this._pickNearestLowerPlane(boundary, nearestPlane, planeB);
    }
    return nearestPlane;
  }

  /**
   * 查找当前边界上侧/右侧最近包围盒平面。
   * @param boundary - 当前边界坐标
   * @param boxes - 目标包围盒数组
   * @param axis - 计算轴向
   * @returns 最近平面坐标；不存在时返回 null
   */
  private _findNearestUpperBoxPlane(boundary: number, boxes: THREE.Box3[], axis: 'x' | 'z'): number | null {
    let nearestPlane: number | null = null;
    for (let boxIndex: number = 0; boxIndex < boxes.length; boxIndex += 1) {
      const box: THREE.Box3 | undefined = boxes[boxIndex];
      if (box === undefined) {
        continue;
      }
      const planeA: number = axis === 'x' ? box.min.x : box.min.z;
      const planeB: number = axis === 'x' ? box.max.x : box.max.z;
      nearestPlane = this._pickNearestUpperPlane(boundary, nearestPlane, planeA);
      nearestPlane = this._pickNearestUpperPlane(boundary, nearestPlane, planeB);
    }
    return nearestPlane;
  }

  /** 在下侧/左侧候选平面中挑选最近值。 */
  private _pickNearestLowerPlane(boundary: number, currentPlane: number | null, candidatePlane: number): number | null {
    if (candidatePlane > boundary + 0.001) {
      return currentPlane;
    }
    if (currentPlane === null || candidatePlane > currentPlane) {
      return candidatePlane;
    }
    return currentPlane;
  }

  /** 在上侧/右侧候选平面中挑选最近值。 */
  private _pickNearestUpperPlane(boundary: number, currentPlane: number | null, candidatePlane: number): number | null {
    if (candidatePlane < boundary - 0.001) {
      return currentPlane;
    }
    if (currentPlane === null || candidatePlane < currentPlane) {
      return candidatePlane;
    }
    return currentPlane;
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
      this._dragWallSnapshot = null;
    }
    this._clearDoorWindowDimension();
    this._clearStlPlacementDimension();
    if (this._sceneManager !== null && this._ownsStlPlacementDimensionRenderer) {
      this._stlPlacementDimensionRenderer.dispose(this._sceneManager.getScene());
    }
    this.disable();
  }
}
