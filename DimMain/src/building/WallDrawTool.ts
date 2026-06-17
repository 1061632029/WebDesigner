/**
 * 墙体绘制工具
 * 状态机模式管理墙体的交互式绘制流程
 * 支持直墙、弧形墙、矩形墙三种绘制模式
 */

import * as THREE from 'three/webgpu';
import type { BeamData, BuildingObject, Point2D, DrawToolMode, DrawToolState, StraightWallData, RectWallData, ArcWallData } from './BuildingTypes';
import { WALL_DEFAULTS, BEAM_DEFAULTS, SNAP_THRESHOLD } from './BuildingTypes';
import { WallGeometryBuilder } from './WallGeometryBuilder';
import { BeamGeometryBuilder } from './BeamGeometryBuilder';
import { BuildingObjectManager } from './BuildingObjectManager';
import { RaycastHelper } from '../interaction/RaycastHelper';
import { RectDimensionRenderer, type RectPreviewEditAxis } from './RectDimensionRenderer';
import { StraightWallDimensionRenderer } from './StraightWallDimensionRenderer';
import { LinearPlacementAngleRenderer } from './LinearPlacementAngleRenderer';
import { ArcWallRadiusDimensionRenderer, type ArcWallPreviewEditTarget, type ArcWallDimensionPickResult } from './ArcWallRadiusDimensionRenderer';
import { PlanarPlacementSnapService } from './PlanarPlacementSnapService';
import { PlanarPlacementGuideRenderer } from './PlanarPlacementGuideRenderer';
import { WallPlacementLineConverter } from './WallPlacementLineConverter';
import type { ClockwiseRectInnerEdges, WallCenterLine } from './WallPlacementLineConverter';
import type { PlanarPlacementSnapResult } from './PlanarPlacementSnapTypes';
import type { SceneManager } from '../scene/SceneManager';
import type { CommandHistoryManager } from '../history/CommandHistoryManager';
import { StraightWallCreateCommand } from '../history/commands/StraightWallCreateCommand';
import { ConnectedStraightWallCreateCommand } from '../history/commands/ConnectedStraightWallCreateCommand';
import type { PreviousStraightWallEndpointUpdate } from '../history/commands/ConnectedStraightWallCreateCommand';
import { ClosedStraightWallLoopCreateCommand } from '../history/commands/ClosedStraightWallLoopCreateCommand';
import type { ClosedLoopStraightWallUpdate } from '../history/commands/ClosedStraightWallLoopCreateCommand';
import { RectWallCreateCommand } from '../history/commands/RectWallCreateCommand';
import { BeamCreateCommand } from '../history/commands/BeamCreateCommand';
import { ArcWallCreateCommand } from '../history/commands/ArcWallCreateCommand';

/**
 * 绘制工具状态变更回调
 */
export type DrawToolChangeCallback = () => void;

/** 捕获点标记最高渲染顺序，确保绿色圆圈显示在所有辅助标注和 2D 符号之上。 */
const SNAP_MARKER_RENDER_ORDER: number = 20000;

/** 线性布置预览当前键盘编辑目标，Tab 在长度与角度之间切换。 */
type LinearPreviewEditTarget = 'length' | 'angle';

/**
 * 墙体绘制工具
 * 处理鼠标事件，维护绘制状态机，创建预览几何体和最终墙体
 */
export class WallDrawTool {
  /** 当前绘制模式 */
  private _mode: DrawToolMode = 'none';
  /** 当前状态 */
  private _state: DrawToolState = 'idle';

  /** 起点（第一次点击） */
  private _startPoint: Point2D | null = null;
  /** 终点 / 当前鼠标位置 */
  private _endPoint: Point2D | null = null;
  /** 弧形墙弧度因子 */
  private _bulge: number = 0;
  /** 弧形墙第三点布置阶段的当前鼠标方向点，用于半径动态标注定位。 */
  private _arcPreviewControlPoint: Point2D | null = null;

  /** 建筑对象管理器 */
  private _objectManager: BuildingObjectManager;
  /** 场景管理器 */
  private _sceneManager: SceneManager;
  /** 射线投射辅助器 */
  private _raycastHelper: RaycastHelper = new RaycastHelper();
  /** 弧形墙常驻标注拾取射线，用于点击半径/角度标注进入编辑态。 */
  private _arcDimensionLabelRaycaster: THREE.Raycaster = new THREE.Raycaster();
  /** 墙体几何构建器（用于预览） */
  private _wallBuilder: WallGeometryBuilder = new WallGeometryBuilder();

  /** 梁几何构建器（用于预览） */
  private _beamBuilder: BeamGeometryBuilder = new BeamGeometryBuilder();

  /** 预览 Mesh */
  private _previewMesh: THREE.Mesh | null = null;
  /** 预览材质（半透明） */
  private _previewMaterial: THREE.MeshStandardMaterial;

  /** 起点标记 Mesh */
  private _startMarker: THREE.Mesh | null = null;

  /** 吸附高亮标记 Mesh（绿色环形，表示鼠标靠近已有端点） */
  private _snapMarker: THREE.Mesh | null = null;
  /** 当前是否处于吸附状态 */
  private _isSnapped: boolean = false;

  /**
   * 当前鼠标是否处于端点吸附状态（供外部状态显示使用）
   */
  public get isSnapped(): boolean {
    return this._isSnapped;
  }

  /**
   * 相机获取函数（由外部注入）
   * 每次事件处理时调用，确保视图切换后始终使用最新相机实例
   */
  private _getCameraFn: (() => THREE.Camera) | null = null;
  /** Canvas DOM 元素引用 */
  private _domElement: HTMLElement | null = null;

  /** 状态变更监听器 */
  private _listeners: Set<DrawToolChangeCallback> = new Set();

  /** 墙体参数 */
  private _thickness: number = WALL_DEFAULTS.thickness;
  private _height: number = WALL_DEFAULTS.height;

  /** 连续绘制模式（直墙模式下终点变为下一段起点） */
  private _continuous: boolean = true;

  /** 连续直墙上一段内侧起点，用于在下一段创建时计算中心线交点。 */
  private _previousStraightInnerStart: Point2D | null = null;

  /** 连续直墙上一段创建出的墙体 ID，用于在下一段创建时回写衔接端点。 */
  private _previousStraightWallId: string | null = null;

  /** 连续直墙本轮绘制的内侧节点序列，用于闭合时按完整内侧轮廓统一反算中心线。 */
  private _straightInnerPathPoints: Point2D[] = [];

  /** 连续直墙本轮绘制已创建的墙体 ID 序列，与内侧节点边一一对应。 */
  private _straightPathWallIds: string[] = [];

  /** 矩形墙尺寸标注渲染器（仅保留绘制过程中的预览标注） */
  private _rectDimRenderer: RectDimensionRenderer;

  /** 直墙动态尺寸标注渲染器，用于直墙布置过程中的长度标注。 */
  private _straightDimRenderer: StraightWallDimensionRenderer;

  /** 线性布置角度标注渲染器，用于直墙、梁预览时显示与水平线的夹角。 */
  private _linearAngleRenderer: LinearPlacementAngleRenderer;

  /** 弧形墙半径动态标注渲染器，用于弧度布置阶段显示毫米半径。 */
  private _arcRadiusDimRenderer: ArcWallRadiusDimensionRenderer;

  /** 矩形墙预览当前可编辑尺寸轴，默认编辑水平尺寸。 */
  private _rectPreviewEditAxis: RectPreviewEditAxis = 'horizontal';

  /** 矩形墙预览尺寸键盘输入缓冲，单位为毫米。 */
  private _rectPreviewDimensionInput: string = '';

  /** 矩形墙预览是否刚由键盘尺寸驱动，用于鼠标移动时恢复鼠标驱动。 */
  private _rectPreviewKeyboardSized: boolean = false;

  /** 线性布置预览当前键盘编辑目标，默认编辑长度标注。 */
  private _linearPreviewEditTarget: LinearPreviewEditTarget = 'length';

  /** 线性布置预览长度输入缓冲，单位为毫米。 */
  private _straightPreviewDimensionInput: string = '';

  /** 线性布置预览角度输入缓冲，单位为度。 */
  private _linearPreviewAngleInput: string = '';

  /** 线性布置预览是否已由键盘尺寸/角度输入驱动。 */
  private _straightPreviewKeyboardSized: boolean = false;

  /** 弧形墙预览当前键盘编辑目标，Tab 在半径与角度之间切换。 */
  private _arcPreviewEditTarget: ArcWallPreviewEditTarget = 'radius';

  /** 弧形墙预览半径输入缓存，单位为毫米。 */
  private _arcPreviewRadiusInput: string = '';

  /** 弧形墙预览角度输入缓存，单位为度。 */
  private _arcPreviewAngleInput: string = '';

  /** 弧形墙预览是否已由键盘尺寸控制，点击确认时避免被鼠标点覆盖。 */
  private _arcPreviewKeyboardSized: boolean = false;

  /** 当前正在通过常驻标注编辑的弧形墙 ID；为空表示新建弧形墙流程。 */
  private _editingArcWallId: string | null = null;

  /** 平面线式布置统一捕获服务 */
  private _planarSnapService: PlanarPlacementSnapService;

  /** 平面线式布置捕获辅助虚线渲染器 */
  private _planarGuideRenderer: PlanarPlacementGuideRenderer;

  /** 命令历史管理器；存在时墙体创建进入撤销/重做栈 */
  private _historyManager: CommandHistoryManager | null;

  /**
   * @param objectManager - 建筑对象管理器
   * @param sceneManager - 场景管理器
   * @param historyManager - 命令历史管理器；未传入时保留直接创建行为
   */
  constructor(
    objectManager: BuildingObjectManager,
    sceneManager: SceneManager,
    historyManager: CommandHistoryManager | null = null
  ) {
    this._objectManager = objectManager;
    this._sceneManager = sceneManager;
    this._historyManager = historyManager;

    /* 创建矩形墙尺寸标注渲染器：仅用于矩形墙绘制过程中的临时预览。 */
    this._rectDimRenderer = new RectDimensionRenderer(sceneManager);
    this._straightDimRenderer = new StraightWallDimensionRenderer(sceneManager);
    this._linearAngleRenderer = new LinearPlacementAngleRenderer(sceneManager);
    this._arcRadiusDimRenderer = new ArcWallRadiusDimensionRenderer(sceneManager);

    /* 创建墙/梁线式布置统一捕获服务和虚线渲染器 */
    this._planarSnapService = new PlanarPlacementSnapService((): BuildingObject[] => this._objectManager.getAll());
    this._planarGuideRenderer = new PlanarPlacementGuideRenderer(sceneManager);

    /* 创建预览材质 */
    this._previewMaterial = new THREE.MeshStandardMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  /* ========== 公开属性 ========== */

  public get mode(): DrawToolMode { return this._mode; }
  public get state(): DrawToolState { return this._state; }
  public get startPoint(): Point2D | null { return this._startPoint; }
  public get endPoint(): Point2D | null { return this._endPoint; }
  public get thickness(): number { return this._thickness; }
  public get height(): number { return this._height; }

  /**
   * 计算当前预览墙体的长度（米）
   */
  public get previewLength(): number {
    if (this._startPoint === null || this._endPoint === null) {
      return 0;
    }
    const dx: number = this._endPoint.x - this._startPoint.x;
    const dz: number = this._endPoint.z - this._startPoint.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /* ========== 模式切换 ========== */

  /**
   * 激活绘制工具
   * @param mode - 绘制模式
   * @param getCameraFn - 相机获取函数（每次事件处理时调用，确保视图切换后使用最新相机）
   * @param domElement - Canvas DOM 元素
   */
  public activate(mode: DrawToolMode, getCameraFn: () => THREE.Camera, domElement: HTMLElement): void {
    this.deactivate();
    this._mode = mode;
    this._state = 'picking-start';
    this._getCameraFn = getCameraFn;
    this._domElement = domElement;

    if (mode === 'rect-wall') {
      this._resetRectPreviewDimensionEdit(true);
    } else if (mode === 'straight-wall' || mode === 'beam') {
      this._resetStraightPreviewDimensionEdit();
    } else if (mode === 'arc-wall') {
      this._resetArcPreviewDimensionEdit(true);
    }

    /* 绑定事件（使用箭头函数保持 this 引用） */
    domElement.addEventListener('click', this._handleClick);
    domElement.addEventListener('mousemove', this._handleMouseMove);
    domElement.addEventListener('contextmenu', this._handleRightClick);
    window.addEventListener('keydown', this._handleKeyDown);

    /* 更改鼠标样式 */
    domElement.style.cursor = 'crosshair';

    this._notify();
    console.log(`[WallDrawTool] 激活模式: ${mode}`);
  }

  /**
   * 停用绘制工具
   */
  public deactivate(): void {
    if (this._domElement !== null) {
      this._domElement.removeEventListener('click', this._handleClick);
      this._domElement.removeEventListener('mousemove', this._handleMouseMove);
      this._domElement.removeEventListener('contextmenu', this._handleRightClick);
      window.removeEventListener('keydown', this._handleKeyDown);
      this._domElement.style.cursor = 'default';
    }

    /* 清除预览 */
    this._clearPreview();
    this._clearStartMarker();
    this._clearSnapMarker();
    this._planarGuideRenderer.hide();
    this._rectDimRenderer.clearPreview();
    this._straightDimRenderer.clearPreview();
    this._linearAngleRenderer.clearPreview();
    this._arcRadiusDimRenderer.clearPreview();
    
    this._mode = 'none';
    this._state = 'idle';
    this._startPoint = null;
    this._endPoint = null;
    this._bulge = 0;
    this._arcPreviewControlPoint = null;
    this._previousStraightInnerStart = null;
    this._previousStraightWallId = null;
    this._straightInnerPathPoints = [];
    this._straightPathWallIds = [];
    this._resetRectPreviewDimensionEdit(true);
    this._resetStraightPreviewDimensionEdit();
    this._resetArcPreviewDimensionEdit(true);
    this._getCameraFn = null;
    this._domElement = null;

    this._notify();
  }

  /* ========== 事件处理 ========== */

  /**
   * 鼠标左键点击
   * 对 picking-start / picking-end 阶段执行端点吸附检测
   */
  private _handleClick = (event: MouseEvent): void => {
    if (this._getCameraFn === null || this._domElement === null) return;

    /* 每次事件处理时实时获取当前相机（确保视图切换后使用最新相机） */
    const camera: THREE.Camera = this._getCameraFn();

    /* 弧形墙常驻标注优先拾取：点击半径/角度标注时直接进入与布置阶段一致的编辑状态。 */
    const pickedArcDimension: ArcWallDimensionPickResult | null = this._pickArcWallDimensionLabel(
      event.clientX,
      event.clientY,
      camera
    );
    if (pickedArcDimension !== null && this._enterArcWallDimensionEdit(pickedArcDimension)) {
      return;
    }

    /* 射线投射到地平面，获取世界坐标 */
    const rawPoint: Point2D | null = this._raycastHelper.screenToGround(
      event.clientX, event.clientY, camera, this._domElement
    );
    if (rawPoint === null) return;

    /* 对坐标执行吸附检测：如果靠近已有端点则使用端点坐标 */
    const snapped: PlanarPlacementSnapResult = this._applySnap(rawPoint);
    const point: Point2D = snapped.position;

    switch (this._mode) {
      case 'straight-wall':
        this._handleStraightWallClick(point);
        break;
      case 'beam':
        this._handleBeamClick(point);
        break;
      case 'arc-wall':
        this._handleArcWallClick(point);
        break;
      case 'rect-wall':
        this._handleRectWallClick(point);
        break;
    }
  };

  /**
   * 鼠标移动
   * 在 picking-start 阶段也执行吸附预览（显示绿色标记）
   */
  private _handleMouseMove = (event: MouseEvent): void => {
    if (this._getCameraFn === null || this._domElement === null) return;

    /* 每次事件处理时实时获取当前相机（确保视图切换后使用最新相机） */
    const camera: THREE.Camera = this._getCameraFn();

    const rawPoint: Point2D | null = this._raycastHelper.screenToGround(
      event.clientX, event.clientY, camera, this._domElement
    );
    if (rawPoint === null) return;

    /* 实时吸附预览：所有阶段都检测吸附并显示标记 */
    const snapResult: PlanarPlacementSnapResult = this._applySnap(rawPoint);
    const point: Point2D = snapResult.position;

    /* picking-start 阶段只做吸附预览，不更新终点 */
    if (this._state === 'picking-start') return;

    /* picking-bulge 阶段：鼠标移动更新 bulge 而非终点 */
    if (this._state === 'picking-bulge') {
      /* 弧形墙第三点阶段：记录当前鼠标方向点，半径动态标注使用圆心到该方向与弧墙的交点。 */
      if (this._mode === 'arc-wall') {
        /* 鼠标移动恢复拖拽控弧，清空半径/角度键盘输入，避免旧输入继续覆盖动态标注。 */
        this._resetArcPreviewDimensionEdit(false);
      }
      this._arcPreviewControlPoint = point;
      this._bulge = this._computeBulgeFromPoint(point);
    } else {
      /* picking-end 阶段：使用吸附后的坐标更新终点 */
      if (this._mode === 'rect-wall') {
        /* 鼠标移动恢复实时拖拽驱动：清空键盘输入缓冲，后续尺寸重新按鼠标位置计算。 */
        this._resetRectPreviewDimensionEdit(false);
      } else if (this._mode === 'straight-wall' || this._mode === 'beam') {
        /* 鼠标移动恢复实时拖拽驱动：清空墙/梁线性键盘输入缓冲，后续标注重新按鼠标位置计算。 */
        this._resetStraightPreviewDimensionEdit();
      }
      this._endPoint = point;
    }

    /* 更新预览 */
    if (this._startPoint !== null) {
      this._updatePreview();
    }

    this._notify();
  };

  /**
   * 右键点击 → 取消当前绘制
   */
  private _handleRightClick = (event: MouseEvent): void => {
    event.preventDefault();
    this._cancelCurrentDraw();
  };

  /**
   * 键盘按键
   */
  private _handleKeyDown = (event: KeyboardEvent): void => {
    if (this._handleStraightPreviewDimensionKeyDown(event)) {
      return;
    }

    if (this._handleRectPreviewDimensionKeyDown(event)) {
      return;
    }

    if (this._handleArcPreviewDimensionKeyDown(event)) {
      return;
    }

    if (event.key === 'Escape') {
      /* 未放置任何布置点时，Esc 直接退出当前墙/梁编辑环境，避免停留在空编辑状态。 */
      if (this._state === 'picking-start' && this._startPoint === null) {
        this.deactivate();
        return;
      }

      /* 已存在起点或中间步骤时，Esc 仅取消当前绘制流程并回到等待起点状态。 */
      this._cancelCurrentDraw();
    }
  };

  /* ========== 直墙绘制逻辑 ========== */

  private _handleStraightWallClick(point: Point2D): void {
    if (this._state === 'picking-start') {
      /* 第一次点击确定直墙内侧绘制线起点，并显示起点标记。 */
      this._startPoint = point;
      this._straightInnerPathPoints = [{ x: point.x, z: point.z }];
      this._straightPathWallIds = [];
      this._state = 'picking-end';
      this._showStartMarker(point);
      this._notify();
      return;
    }

    if (this._state === 'picking-end') {
      /* 允许用户输入长度/角度后直接点击确认，确认前先尝试应用当前输入。 */
      this._applyStraightPreviewDimensionInput();
      /* 确认流程：键盘尺寸驱动后保留已编辑终点；鼠标驱动时使用当前点击点。 */
      const confirmedEndPoint: Point2D = this._straightPreviewKeyboardSized && this._endPoint !== null ? this._endPoint : point;
      this._endPoint = confirmedEndPoint;
      this._confirmStraightWallPreview();
    }
  }

  /**
   * 按当前直墙预览完成墙体布置。
   * 关键流程：先应用尚未提交的长度输入，再创建直墙并按连续绘制规则重置起终点。
   */
  private _confirmStraightWallPreview(): void {
    if (this._startPoint === null || this._endPoint === null) {
      return;
    }

    this._applyStraightPreviewDimensionInput();

    /* 确定终点，创建墙体。 */
    const closedLoopEndPoint: Point2D | null = this._resolveStraightClosedLoopEndPoint(this._endPoint);
    const confirmedEndPoint: Point2D = closedLoopEndPoint !== null
      ? closedLoopEndPoint
      : { x: this._endPoint.x, z: this._endPoint.z };
    const createdWallId: string = closedLoopEndPoint !== null
      ? this._createClosedStraightWallLoopByHistory(this._startPoint, confirmedEndPoint)
      : this._createStraightWallByHistory(
        this._previousStraightInnerStart,
        this._startPoint,
        confirmedEndPoint
      );
    this._straightDimRenderer.clearPreview();
    this._resetStraightPreviewDimensionEdit();
    this._clearPreview();

    if (closedLoopEndPoint !== null) {
      /* 闭合完成后结束本轮连续路径，下一次点击重新开始，避免继续沿旧轮廓追加墙体。 */
      this._clearStartMarker();
      this._previousStraightInnerStart = null;
      this._previousStraightWallId = null;
      this._straightInnerPathPoints = [];
      this._straightPathWallIds = [];
      this._startPoint = null;
      this._endPoint = null;
      this._state = 'picking-start';
      this._notify();
      return;
    }

    /* 连续模式：终点变为下一段起点。 */
    if (this._continuous) {
      this._previousStraightInnerStart = this._startPoint;
      this._previousStraightWallId = createdWallId;
      this._straightPathWallIds.push(createdWallId);
      this._straightInnerPathPoints.push({ x: confirmedEndPoint.x, z: confirmedEndPoint.z });
      this._startPoint = confirmedEndPoint;
      this._endPoint = null;
      this._clearStartMarker();
      this._showStartMarker(confirmedEndPoint);
      /* 保持 picking-end 状态。 */
    } else {
      this._previousStraightInnerStart = null;
      this._previousStraightWallId = null;
      this._straightInnerPathPoints = [];
      this._straightPathWallIds = [];
      this._startPoint = null;
      this._endPoint = null;
      this._state = 'picking-start';
    }

    this._notify();
  }

  /**
   * 拾取弧形墙常驻半径/角度标注。
   * 关键流程：将屏幕坐标转换为 NDC 后射线检测场景对象，再交给标注渲染器解析 userData。
   * @param clientX - 鼠标屏幕 X 坐标
   * @param clientY - 鼠标屏幕 Y 坐标
   * @param camera - 当前视图相机
   * @returns 命中的弧墙标注信息；未命中时返回 null
   */
  private _pickArcWallDimensionLabel(clientX: number, clientY: number, camera: THREE.Camera): ArcWallDimensionPickResult | null {
    if (this._domElement === null) {
      return null;
    }

    /* 优先使用屏幕空间热区拾取 Sprite 标签，解决 Three.js Raycaster 对可视化文字 Sprite 命中不稳定的问题。 */
    const screenPicked: ArcWallDimensionPickResult | null = this._arcRadiusDimRenderer.pickDimensionLabelByScreenPoint(
      clientX,
      clientY,
      camera,
      this._domElement
    );
    if (screenPicked !== null) {
      return screenPicked;
    }

    const rect: DOMRect = this._domElement.getBoundingClientRect();
    const ndc: THREE.Vector2 = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this._arcDimensionLabelRaycaster.setFromCamera(ndc, camera);

    const intersections: THREE.Intersection[] = this._arcDimensionLabelRaycaster.intersectObjects(
      this._sceneManager.getScene().children,
      true
    );
    for (const intersection of intersections) {
      const picked: ArcWallDimensionPickResult | null = this._arcRadiusDimRenderer.pickDimensionLabel(intersection.object);
      if (picked !== null) {
        return picked;
      }
    }

    return null;
  }

  /**
   * 进入已有弧形墙标注编辑状态。
   * @param picked - 被点击的标注信息
   * @returns true 表示已成功进入编辑状态
   */
  private _enterArcWallDimensionEdit(picked: ArcWallDimensionPickResult): boolean {
    const arcWall: ArcWallData | null = this._findArcWallById(picked.wallId);
    if (arcWall === null) {
      this._arcRadiusDimRenderer.clearPersistent(picked.wallId);
      return false;
    }

    this._cancelCurrentDraw();
    this._mode = 'arc-wall';
    this._state = 'picking-bulge';
    this._editingArcWallId = arcWall.id;
    this._startPoint = { x: arcWall.start.x, z: arcWall.start.z };
    this._endPoint = { x: arcWall.end.x, z: arcWall.end.z };
    this._bulge = arcWall.bulge;
    this._arcPreviewControlPoint = null;
    this._arcPreviewEditTarget = picked.target;
    this._arcPreviewRadiusInput = '';
    this._arcPreviewAngleInput = '';
    this._arcPreviewKeyboardSized = true;
    this._showStartMarker(this._startPoint);
    this._updatePreview();
    this._notify();
    return true;
  }

  /**
   * 梁线式布置逻辑
   * 与直墙同样使用两点线式布置，但创建独立梁数据和历史命令，不参与墙体连接拓扑。
   * @param point - 当前点击点
   */
  private _handleBeamClick(point: Point2D): void {
    if (this._state === 'picking-start') {
      /* 第一次点击确定梁中心线起点。 */
      this._startPoint = point;
      this._state = 'picking-end';
      this._showStartMarker(point);
      this._notify();
      return;
    }

    if (this._state === 'picking-end') {
      /* 第二次点击确定梁中心线终点并创建梁；键盘驱动时保留已编辑终点。 */
      this._applyStraightPreviewDimensionInput();
      const confirmedEndPoint: Point2D = this._straightPreviewKeyboardSized && this._endPoint !== null ? this._endPoint : point;
      this._endPoint = confirmedEndPoint;
      this._confirmBeamPreview();
    }
  }

  /**
   * 按当前梁预览完成梁布置。
   * 关键流程：先应用尚未提交的长度/角度输入，再创建梁并按连续绘制规则重置起终点。
   */
  private _confirmBeamPreview(): void {
    if (this._startPoint === null || this._endPoint === null) {
      return;
    }

    this._applyStraightPreviewDimensionInput();
    const confirmedEndPoint: Point2D = { x: this._endPoint.x, z: this._endPoint.z };
    this._createBeamByHistory(this._startPoint, confirmedEndPoint);
    this._straightDimRenderer.clearPreview();
    this._resetStraightPreviewDimensionEdit();
    this._clearPreview();

    if (this._continuous) {
      this._startPoint = confirmedEndPoint;
      this._endPoint = null;
      this._clearStartMarker();
      this._showStartMarker(confirmedEndPoint);
    } else {
      this._startPoint = null;
      this._endPoint = null;
      this._state = 'picking-start';
      this._clearStartMarker();
    }

    this._notify();
  }

  /* ========== 弧形墙绘制逻辑 ========== */

  private _handleArcWallClick(point: Point2D): void {
    if (this._state === 'picking-start') {
      /* 第一步：确定起点 */
      this._startPoint = point;
      this._state = 'picking-end';
      this._showStartMarker(point);
      this._notify();
    } else if (this._state === 'picking-end') {
      /* 第二步：确定终点 */
      this._endPoint = point;
      this._arcPreviewControlPoint = null;
      this._resetArcPreviewDimensionEdit(true);
      this._state = 'picking-bulge';
      this._notify();
    } else if (this._state === 'picking-bulge') {
      /* 第三步：把当前点击点作为弧上一点，按三点定弧计算 bulge 后创建弧形墙。 */
      this._applyArcPreviewDimensionInput();
      if (!this._arcPreviewKeyboardSized) {
        this._arcPreviewControlPoint = point;
        this._bulge = this._computeBulgeFromPoint(point);
      }
      this._confirmArcWallPreview();
    }
  }

  /* ========== 矩形墙绘制逻辑 ========== */

  private _handleRectWallClick(point: Point2D): void {
    if (this._state === 'picking-start') {
      this._startPoint = point;
      this._state = 'picking-end';
      this._showStartMarker(point);
      this._notify();
    } else if (this._state === 'picking-end') {
      /* 允许用户输入尺寸后不按 Enter/Tab 直接点击确认，确认前先尝试应用当前输入。 */
      this._applyRectPreviewDimensionInput();
      /* 确认流程：键盘尺寸驱动后直接点击时保留已编辑预览端点；鼠标移动后则使用最新鼠标点。 */
      const confirmedEndPoint: Point2D = this._rectPreviewKeyboardSized && this._endPoint !== null ? this._endPoint : point;
      this._endPoint = confirmedEndPoint;
      this._confirmRectWallPreview();
    }
  }

  /**
   * 按当前矩形墙预览完成墙体布置。
   * 关键流程：先应用尚未提交的尺寸输入，再使用当前预览端点创建矩形墙，最后清理预览和编辑状态。
   */
  private _confirmRectWallPreview(): void {
    if (this._startPoint === null || this._endPoint === null) {
      return;
    }

    this._applyRectPreviewDimensionInput();

    /* 创建矩形墙（四面直墙）并纳入历史栈，确保 Enter 与鼠标点击确认使用同一套收尾流程。 */
    this._rectDimRenderer.clearPreview();
    this._createRectWallByHistory(this._startPoint, this._endPoint);
    this._resetRectPreviewDimensionEdit(true);

    this._clearPreview();
    this._clearStartMarker();
    this._startPoint = null;
    this._endPoint = null;
    this.deactivate();
  }

  /* ========== 预览管理 ========== */

  /**
   * 更新预览几何体
   * 根据当前模式和状态选择对应的预览构建方法
   */
  private _updatePreview(): void {
    this._clearPreview();

    if (this._startPoint === null || this._endPoint === null) return;

    let geometry: THREE.BufferGeometry;

    if (this._mode === 'rect-wall') {
      /* 矩形墙预览：4 面墙体 */
      geometry = this._buildRectPreview(this._startPoint, this._endPoint);
    } else if (this._mode === 'arc-wall' && this._state === 'picking-bulge') {
      /* 弧形墙预览：使用当前 bulge 值生成弧形几何体 */
      geometry = this._wallBuilder.buildArcPreview(
        this._startPoint, this._endPoint, this._bulge, this._thickness, this._height
      );
    } else if (this._mode === 'beam') {
      /* 梁预览：线式矩形梁，长度跟随两点距离，截面使用梁默认宽高。 */
      geometry = this._beamBuilder.buildPreview(
        this._startPoint,
        this._endPoint,
        BEAM_DEFAULTS.width,
        BEAM_DEFAULTS.height,
        BEAM_DEFAULTS.distanceFromFloor
      );
    } else {
      /* 直墙预览（也用于弧形墙的 picking-end 阶段） */
      const centerLine: WallCenterLine = WallPlacementLineConverter.convertInnerLineToCenterLine(
        this._startPoint,
        this._endPoint,
        this._thickness
      );
      geometry = this._wallBuilder.buildPreview(
        centerLine.start, centerLine.end, this._thickness, this._height
      );
    }

    this._previewMesh = new THREE.Mesh(geometry, this._previewMaterial);
    this._previewMesh.name = '__wall_preview__';
    this._sceneManager.add(this._previewMesh);

    /* 矩形墙模式：同步更新预览标注（面积 + 长宽） */
    if (this._mode === 'rect-wall') {
      this._rectDimRenderer.updatePreview(
        this._startPoint,
        this._endPoint,
        this._rectPreviewEditAxis,
        this._getRectPreviewDimensionInputText()
      );
    } else if (this._mode === 'straight-wall') {
      /* 直墙模式同步更新长度与水平夹角动态标注，便于斜向布置时确认方向。 */
      this._straightDimRenderer.updatePreview(
        this._startPoint,
        this._endPoint,
        this._getStraightPreviewDimensionInputText(),
        this._linearPreviewEditTarget === 'length'
      );
      this._linearAngleRenderer.updatePreview(
        this._startPoint,
        this._endPoint,
        this._getLinearPreviewAngleInputText(),
        this._linearPreviewEditTarget === 'angle'
      );
    } else if (this._mode === 'beam') {
      /* 梁模式为线性布置，同步显示长度与水平夹角动态标注，规则与直墙保持一致。 */
      this._straightDimRenderer.updatePreview(
        this._startPoint,
        this._endPoint,
        this._getStraightPreviewDimensionInputText(),
        this._linearPreviewEditTarget === 'length'
      );
      this._linearAngleRenderer.updatePreview(
        this._startPoint,
        this._endPoint,
        this._getLinearPreviewAngleInputText(),
        this._linearPreviewEditTarget === 'angle'
      );
    } else if (this._mode === 'arc-wall' && this._state === 'picking-bulge') {
      /* 弧形墙模式：新建时显示临时预览标注；编辑已有墙时复用常驻标注并高亮当前编辑项，避免重复显示。 */
      if (this._editingArcWallId !== null) {
        this._arcRadiusDimRenderer.clearPreview();
        this._arcRadiusDimRenderer.updatePersistent(
          this._editingArcWallId,
          this._startPoint,
          this._endPoint,
          this._bulge,
          this._arcPreviewEditTarget,
          this._getArcPreviewRadiusInputText(),
          this._getArcPreviewAngleInputText()
        );
      } else {
        this._arcRadiusDimRenderer.updatePreview(
          this._startPoint,
          this._endPoint,
          this._bulge,
          this._arcPreviewControlPoint,
          this._arcPreviewEditTarget,
          this._getArcPreviewRadiusInputText(),
          this._getArcPreviewAngleInputText()
        );
      }
    } else {
      this._arcRadiusDimRenderer.clearPreview();
      this._linearAngleRenderer.clearPreview();
    }
  }

  /**
   * 处理墙/梁线性布置预览长度与角度键盘编辑。
   * 关键流程：Tab 在长度与角度标注之间切换，数字键写入当前标注，Enter 应用输入并确认创建。
   * @param event - 键盘事件
   * @returns true 表示事件已被线性布置标注编辑消费
   */
  private _handleStraightPreviewDimensionKeyDown(event: KeyboardEvent): boolean {
    if (!this._canEditStraightPreviewDimension()) {
      return false;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      this._applyStraightPreviewDimensionInput();
      this._toggleLinearPreviewEditTarget();
      this._updatePreview();
      this._notify();
      return true;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this._applyStraightPreviewDimensionInput();
      if (this._mode === 'beam') {
        this._confirmBeamPreview();
      } else {
        this._confirmStraightWallPreview();
      }
      return true;
    }

    if (event.key === 'Backspace') {
      event.preventDefault();
      this._removeLinearPreviewInputLastChar();
      return true;
    }

    if (event.key === 'Delete') {
      event.preventDefault();
      this._clearLinearPreviewActiveInput();
      return true;
    }

    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      if (this._linearPreviewEditTarget === 'length') {
        this._straightPreviewDimensionInput = `${this._straightPreviewDimensionInput}${event.key}`;
      } else {
        this._linearPreviewAngleInput = `${this._linearPreviewAngleInput}${event.key}`;
      }
      this._straightPreviewKeyboardSized = true;
      this._updatePreview();
      this._notify();
      return true;
    }

    return false;
  }

  /**
   * 判断当前是否允许编辑墙/梁线性布置预览标注。
   * @returns true 表示当前处于墙/梁第二点布置阶段，且预览端点有效
   */
  private _canEditStraightPreviewDimension(): boolean {
    return (this._mode === 'straight-wall' || this._mode === 'beam')
      && this._state === 'picking-end'
      && this._startPoint !== null
      && this._endPoint !== null;
  }

  /**
   * 应用当前输入缓冲到直墙预览终点。
   * 关键流程：输入值按毫米解析，并沿当前预览方向重算终点，保持墙体朝向不变。
   * @returns true 表示已成功应用输入尺寸
   */
  private _applyStraightPreviewDimensionInput(): boolean {
    if (this._linearPreviewEditTarget === 'angle') {
      return this._applyLinearPreviewAngleInput();
    }

    return this._applyLinearPreviewLengthInput();
  }

  /**
   * 应用当前长度输入缓冲到墙/梁线性预览终点。
   * 关键流程：输入值按毫米解析，并沿当前预览方向重算终点，保持构件朝向不变。
   * @returns true 表示已成功应用输入长度
   */
  private _applyLinearPreviewLengthInput(): boolean {
    if (this._startPoint === null || this._endPoint === null || this._straightPreviewDimensionInput.length === 0) {
      return false;
    }

    const dimensionMillimeters: number = Number.parseFloat(this._straightPreviewDimensionInput);
    if (!Number.isFinite(dimensionMillimeters)) {
      return false;
    }

    const dimensionMeters: number = dimensionMillimeters / 1000;
    if (dimensionMeters < 0.1) {
      return false;
    }

    const dx: number = this._endPoint.x - this._startPoint.x;
    const dz: number = this._endPoint.z - this._startPoint.z;
    const currentLength: number = Math.sqrt(dx * dx + dz * dz);
    if (currentLength < 0.001) {
      return false;
    }

    const directionX: number = dx / currentLength;
    const directionZ: number = dz / currentLength;
    this._endPoint = {
      x: this._startPoint.x + directionX * dimensionMeters,
      z: this._startPoint.z + directionZ * dimensionMeters,
    };
    this._straightPreviewDimensionInput = '';
    this._straightPreviewKeyboardSized = true;
    return true;
  }

  /**
   * 应用当前角度输入缓冲到墙/梁线性预览终点。
   * 关键流程：输入角度按度解析，保持当前长度不变，并以起点为中心旋转终点到相对水平方向。
   * @returns true 表示已成功应用输入角度
   */
  private _applyLinearPreviewAngleInput(): boolean {
    if (this._startPoint === null || this._endPoint === null || this._linearPreviewAngleInput.length === 0) {
      return false;
    }

    const angleDegrees: number = Number.parseFloat(this._linearPreviewAngleInput);
    if (!Number.isFinite(angleDegrees)) {
      return false;
    }

    const dx: number = this._endPoint.x - this._startPoint.x;
    const dz: number = this._endPoint.z - this._startPoint.z;
    const currentLength: number = Math.sqrt(dx * dx + dz * dz);
    if (currentLength < 0.001) {
      return false;
    }

    const useNegativeXAxisReference: boolean = dx < 0;
    const referenceAngle: number = useNegativeXAxisReference ? Math.PI : 0;
    const verticalDirectionSign: number = useNegativeXAxisReference
      ? (dz < 0 ? 1 : -1)
      : (dz < 0 ? -1 : 1);
    const angleRadians: number = angleDegrees * Math.PI / 180;
    const targetAngle: number = referenceAngle + angleRadians * verticalDirectionSign;

    /* 角度输入应用流程：1/4 象限以 +X 为基准，2/3 象限以 -X 为基准，并保留当前末端节点位于参考水平轴上方或下方的方向。 */
    this._endPoint = {
      x: this._startPoint.x + Math.cos(targetAngle) * currentLength,
      z: this._startPoint.z + Math.sin(targetAngle) * currentLength,
    };
    this._linearPreviewAngleInput = '';
    this._straightPreviewKeyboardSized = true;
    return true;
  }

  /** 切换墙/梁线性布置当前编辑标注。 */
  private _toggleLinearPreviewEditTarget(): void {
    this._linearPreviewEditTarget = this._linearPreviewEditTarget === 'length' ? 'angle' : 'length';
  }

  /** 删除墙/梁线性布置当前输入缓冲的最后一位。 */
  private _removeLinearPreviewInputLastChar(): void {
    if (this._linearPreviewEditTarget === 'length' && this._straightPreviewDimensionInput.length > 0) {
      this._straightPreviewDimensionInput = this._straightPreviewDimensionInput.slice(0, -1);
    } else if (this._linearPreviewEditTarget === 'angle' && this._linearPreviewAngleInput.length > 0) {
      this._linearPreviewAngleInput = this._linearPreviewAngleInput.slice(0, -1);
    }
    this._updatePreview();
    this._notify();
  }

  /** 清空墙/梁线性布置当前编辑标注的输入缓冲。 */
  private _clearLinearPreviewActiveInput(): void {
    if (this._linearPreviewEditTarget === 'length') {
      this._straightPreviewDimensionInput = '';
    } else {
      this._linearPreviewAngleInput = '';
    }
    this._updatePreview();
    this._notify();
  }

  /**
   * 重置直墙预览尺寸编辑状态。
   */
  private _resetStraightPreviewDimensionEdit(): void {
    this._linearPreviewEditTarget = 'length';
    this._straightPreviewDimensionInput = '';
    this._linearPreviewAngleInput = '';
    this._straightPreviewKeyboardSized = false;
  }

  /**
   * 获取直墙当前输入显示文本。
   * @returns 有输入时返回毫米文本；无输入时返回 null 以显示真实尺寸
   */
  private _getStraightPreviewDimensionInputText(): string | null {
    if (this._straightPreviewDimensionInput.length === 0) {
      return null;
    }

    return this._straightPreviewDimensionInput;
  }

  /** @returns 墙/梁线性布置角度输入显示文本。 */
  private _getLinearPreviewAngleInputText(): string | null {
    return this._linearPreviewAngleInput.length > 0 ? this._linearPreviewAngleInput : null;
  }

  /**
   * 处理矩形墙预览尺寸键盘编辑。
   * 关键流程：数字键只更新当前轴输入文本；Enter/Tab 应用输入尺寸并重绘预览，Tab 额外切换编辑轴。
   * @param event - 键盘事件
   * @returns true 表示事件已被矩形墙尺寸编辑消费
   */
  private _handleRectPreviewDimensionKeyDown(event: KeyboardEvent): boolean {
    if (!this._canEditRectPreviewDimension()) {
      return false;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      this._applyRectPreviewDimensionInput();
      this._toggleRectPreviewEditAxis();
      this._updatePreview();
      this._notify();
      return true;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this._confirmRectWallPreview();
      return true;
    }

    if (event.key === 'Backspace') {
      event.preventDefault();
      if (this._rectPreviewDimensionInput.length > 0) {
        this._rectPreviewDimensionInput = this._rectPreviewDimensionInput.slice(0, -1);
        this._updatePreview();
        this._notify();
      }
      return true;
    }

    if (event.key === 'Delete') {
      event.preventDefault();
      if (this._rectPreviewDimensionInput.length > 0) {
        this._rectPreviewDimensionInput = '';
        this._updatePreview();
        this._notify();
      }
      return true;
    }

    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      this._rectPreviewDimensionInput = `${this._rectPreviewDimensionInput}${event.key}`;
      this._rectPreviewKeyboardSized = true;
      this._updatePreview();
      this._notify();
      return true;
    }

    return false;
  }

  /**
   * 判断当前是否允许编辑矩形墙预览尺寸。
   * @returns true 表示当前处于矩形墙第二点布置阶段，且预览端点有效
   */
  private _canEditRectPreviewDimension(): boolean {
    return this._mode === 'rect-wall'
      && this._state === 'picking-end'
      && this._startPoint !== null
      && this._endPoint !== null;
  }

  /**
   * 应用当前输入缓冲到矩形墙预览端点。
   * 关键流程：输入值按毫米解析，并保持当前拖拽方向的正负号，只替换当前编辑轴长度。
   * @returns true 表示已成功应用输入尺寸
   */
  private _applyRectPreviewDimensionInput(): boolean {
    if (this._startPoint === null || this._endPoint === null || this._rectPreviewDimensionInput.length === 0) {
      return false;
    }

    const dimensionMillimeters: number = Number.parseFloat(this._rectPreviewDimensionInput);
    if (!Number.isFinite(dimensionMillimeters)) {
      return false;
    }

    const dimensionMeters: number = dimensionMillimeters / 1000;
    if (dimensionMeters < 0.1) {
      return false;
    }

    const horizontalDirection: number = this._endPoint.x >= this._startPoint.x ? 1 : -1;
    const verticalDirection: number = this._endPoint.z >= this._startPoint.z ? 1 : -1;
    const nextEndPoint: Point2D = { x: this._endPoint.x, z: this._endPoint.z };

    if (this._rectPreviewEditAxis === 'horizontal') {
      nextEndPoint.x = this._startPoint.x + horizontalDirection * dimensionMeters;
    } else {
      nextEndPoint.z = this._startPoint.z + verticalDirection * dimensionMeters;
    }

    this._endPoint = nextEndPoint;
    this._rectPreviewDimensionInput = '';
    this._rectPreviewKeyboardSized = true;
    return true;
  }

  /**
   * 切换矩形墙预览尺寸编辑轴。
   */
  private _toggleRectPreviewEditAxis(): void {
    this._rectPreviewEditAxis = this._rectPreviewEditAxis === 'horizontal' ? 'vertical' : 'horizontal';
    this._rectPreviewDimensionInput = '';
  }

  /**
   * 重置矩形墙预览尺寸编辑状态。
   * @param resetAxis - true 时一并恢复默认水平编辑轴；false 时仅清空输入和键盘驱动标记
   */
  private _resetRectPreviewDimensionEdit(resetAxis: boolean): void {
    if (resetAxis) {
      this._rectPreviewEditAxis = 'horizontal';
    }
    this._rectPreviewDimensionInput = '';
    this._rectPreviewKeyboardSized = false;
  }

  /**
   * 获取当前编辑轴输入显示文本。
   * @returns 有输入时返回毫米文本；无输入时返回 null 以显示真实尺寸
   */
  private _getRectPreviewDimensionInputText(): string | null {
    if (this._rectPreviewDimensionInput.length === 0) {
      return null;
    }

    return this._rectPreviewDimensionInput;
  }

  /**
   * 处理弧形墙预览半径/角度键盘编辑。
   * 关键流程：Tab 在半径与角度标注之间切换，数字键写入当前标注，Enter 应用输入并确认创建弧形墙。
   * @param event - 键盘事件
   * @returns true 表示事件已被弧形墙标注编辑消费
   */
  private _handleArcPreviewDimensionKeyDown(event: KeyboardEvent): boolean {
    if (!this._canEditArcPreviewDimension()) {
      return false;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      this._applyArcPreviewDimensionInput();
      this._toggleArcPreviewEditTarget();
      this._updatePreview();
      this._notify();
      return true;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this._applyArcPreviewDimensionInput();
      this._confirmArcWallPreview();
      return true;
    }

    if (event.key === 'Backspace') {
      event.preventDefault();
      this._removeArcPreviewInputLastChar();
      return true;
    }

    if (event.key === 'Delete') {
      event.preventDefault();
      this._clearArcPreviewActiveInput();
      return true;
    }

    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      if (this._arcPreviewEditTarget === 'radius') {
        this._arcPreviewRadiusInput = `${this._arcPreviewRadiusInput}${event.key}`;
      } else {
        this._arcPreviewAngleInput = `${this._arcPreviewAngleInput}${event.key}`;
      }
      this._arcPreviewKeyboardSized = true;
      this._updatePreview();
      this._notify();
      return true;
    }

    return false;
  }

  /**
   * 判断当前是否允许编辑弧形墙预览标注。
   * @returns true 表示当前处于弧形墙第三点布置阶段且起终点有效
   */
  private _canEditArcPreviewDimension(): boolean {
    return this._mode === 'arc-wall'
      && this._state === 'picking-bulge'
      && this._startPoint !== null
      && this._endPoint !== null;
  }

  /**
   * 应用当前弧形墙半径或角度输入。
   * @returns true 表示当前输入已成功转换为 bulge
   */
  private _applyArcPreviewDimensionInput(): boolean {
    if (this._arcPreviewEditTarget === 'radius') {
      return this._applyArcPreviewRadiusInput();
    }

    return this._applyArcPreviewAngleInput();
  }

  /**
   * 应用半径输入并重算 bulge。
   * @returns true 表示半径输入有效并已应用
   */
  private _applyArcPreviewRadiusInput(): boolean {
    if (this._startPoint === null || this._endPoint === null || this._arcPreviewRadiusInput.length === 0) {
      return false;
    }

    const radiusMillimeters: number = Number.parseFloat(this._arcPreviewRadiusInput);
    if (!Number.isFinite(radiusMillimeters)) {
      return false;
    }

    const radiusMeters: number = radiusMillimeters / 1000;
    const chordLength: number = this._calculateArcPreviewChordLength();
    if (chordLength < 0.001 || radiusMeters < chordLength / 2) {
      return false;
    }

    const includedAngle: number = 2 * Math.asin(Math.min(1, chordLength / (2 * radiusMeters)));
    this._bulge = this._getCurrentArcBulgeSign() * Math.tan(includedAngle / 4);
    this._arcPreviewRadiusInput = '';
    this._arcPreviewKeyboardSized = true;
    return true;
  }

  /**
   * 应用角度输入并重算 bulge。
   * @returns true 表示角度输入有效并已应用
   */
  private _applyArcPreviewAngleInput(): boolean {
    if (this._arcPreviewAngleInput.length === 0) {
      return false;
    }

    const angleDegrees: number = Number.parseFloat(this._arcPreviewAngleInput);
    if (!Number.isFinite(angleDegrees) || angleDegrees <= 0 || angleDegrees >= 360) {
      return false;
    }

    const includedAngle: number = angleDegrees * Math.PI / 180;
    this._bulge = this._getCurrentArcBulgeSign() * Math.tan(includedAngle / 4);
    this._arcPreviewAngleInput = '';
    this._arcPreviewKeyboardSized = true;
    return true;
  }

  /**
   * 按当前弧形墙预览完成创建或编辑确认。
   * 关键流程：编辑已有弧墙时直接更新对象；新建弧墙时通过历史命令执行，确保支持撤销和重做。
   */
  private _confirmArcWallPreview(): void {
    if (this._startPoint === null || this._endPoint === null || Math.abs(this._bulge) < 0.001) {
      return;
    }

    if (this._editingArcWallId !== null) {
      /* 弧墙编辑确认：更新当前弧墙几何，并同步刷新常驻半径/角度标注。 */
      const editingWallId: string = this._editingArcWallId;
      this._objectManager.updateObject(editingWallId, {
        start: { x: this._startPoint.x, z: this._startPoint.z },
        end: { x: this._endPoint.x, z: this._endPoint.z },
        bulge: this._bulge,
      } as Partial<ArcWallData> as Partial<BuildingObject>);
      this._arcRadiusDimRenderer.updatePersistent(
        editingWallId,
        this._startPoint,
        this._endPoint,
        this._bulge,
        null,
        null,
        null
      );
    } else {
      /* 弧墙创建确认：先构造完整数据快照，再交给历史命令统一执行，确保支持撤销/重做。 */
      const createdArcWall: ArcWallData = this._objectManager.createArcWallData(
        this._startPoint,
        this._endPoint,
        this._bulge
      );

      if (this._historyManager !== null) {
        this._historyManager.execute(new ArcWallCreateCommand(
          this._objectManager,
          this._sceneManager.getScene(),
          createdArcWall,
          {
            onCreated: (wallData: ArcWallData): void => this._updateArcWallPersistentDimension(wallData),
            onRemoved: (wallId: string): void => this._arcRadiusDimRenderer.clearPersistent(wallId),
          }
        ));
      } else {
        /* 未注入历史管理器时保留直接创建路径，避免影响无历史栈的调用场景。 */
        this._objectManager.addObject(createdArcWall);
        this._updateArcWallPersistentDimension(createdArcWall);
      }
      console.log(`[WallDrawTool] 弧墙已创建, id=${createdArcWall.id}, bulge=${createdArcWall.bulge.toFixed(3)}`);
    }

    this._arcRadiusDimRenderer.clearPreview();
    this._clearPreview();
    this._clearStartMarker();
    this._startPoint = null;
    this._endPoint = null;
    this._bulge = 0;
    this._arcPreviewControlPoint = null;
    this._editingArcWallId = null;
    this._resetArcPreviewDimensionEdit(true);
    this._state = 'picking-start';
    this._notify();
  }

  /** 切换弧形墙当前编辑标注。 */
  private _toggleArcPreviewEditTarget(): void {
    this._arcPreviewEditTarget = this._arcPreviewEditTarget === 'radius' ? 'angle' : 'radius';
  }

  /** 删除当前弧形墙输入缓冲的最后一位。 */
  private _removeArcPreviewInputLastChar(): void {
    if (this._arcPreviewEditTarget === 'radius' && this._arcPreviewRadiusInput.length > 0) {
      this._arcPreviewRadiusInput = this._arcPreviewRadiusInput.slice(0, -1);
    } else if (this._arcPreviewEditTarget === 'angle' && this._arcPreviewAngleInput.length > 0) {
      this._arcPreviewAngleInput = this._arcPreviewAngleInput.slice(0, -1);
    }
    this._updatePreview();
    this._notify();
  }

  /**
   * 更新弧形墙常驻半径标注
   * @param wallData - 需要显示标注的弧形墙数据
   */
  private _updateArcWallPersistentDimension(wallData: ArcWallData): void {
    this._arcRadiusDimRenderer.updatePersistent(
      wallData.id,
      wallData.start,
      wallData.end,
      wallData.bulge,
      null,
      null,
      null
    );
  }

  /** 清空弧形墙当前编辑标注的输入缓冲。 */
  private _clearArcPreviewActiveInput(): void {
    if (this._arcPreviewEditTarget === 'radius') {
      this._arcPreviewRadiusInput = '';
    } else {
      this._arcPreviewAngleInput = '';
    }
    this._updatePreview();
    this._notify();
  }

  /**
   * 重置弧形墙半径/角度编辑状态。
   * @param resetTarget - true 时恢复默认编辑半径；false 时保留当前 Tab 选择
   */
  private _resetArcPreviewDimensionEdit(resetTarget: boolean): void {
    if (resetTarget) {
      this._arcPreviewEditTarget = 'radius';
    }
    this._arcPreviewRadiusInput = '';
    this._arcPreviewAngleInput = '';
    this._arcPreviewKeyboardSized = false;
  }

  /** @returns 弧形墙半径输入显示文本。 */
  private _getArcPreviewRadiusInputText(): string | null {
    return this._arcPreviewRadiusInput.length > 0 ? this._arcPreviewRadiusInput : null;
  }

  /** @returns 弧形墙角度输入显示文本。 */
  private _getArcPreviewAngleInputText(): string | null {
    return this._arcPreviewAngleInput.length > 0 ? this._arcPreviewAngleInput : null;
  }

  /** @returns 当前弧形墙起终点弦长，单位米。 */
  private _calculateArcPreviewChordLength(): number {
    if (this._startPoint === null || this._endPoint === null) {
      return 0;
    }
    const dx: number = this._endPoint.x - this._startPoint.x;
    const dz: number = this._endPoint.z - this._startPoint.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** @returns 当前弧形墙方向符号，未形成有效弧时默认使用逆时针方向。 */
  private _getCurrentArcBulgeSign(): number {
    return this._bulge < 0 ? -1 : 1;
  }

  /**
   * 构建矩形墙预览几何体（合并四面墙为一个 Geometry）
   */
  private _buildRectPreview(corner1: Point2D, corner2: Point2D): THREE.BufferGeometry {
    /* 矩形墙预览关键流程：先生成顺时针室内净轮廓，再把每条内侧边转换为中心线。 */
    const innerEdges: ClockwiseRectInnerEdges = WallPlacementLineConverter.createClockwiseRectInnerEdges(corner1, corner2);
    const innerOutline: Point2D[] = [innerEdges.c1, innerEdges.c2, innerEdges.c3, innerEdges.c4];
    const centerLines: WallCenterLine[] = WallPlacementLineConverter.convertClosedInnerOutlineToCenterLines(
      innerOutline,
      this._thickness
    );
    const line1: WallCenterLine = centerLines[0]!;
    const line2: WallCenterLine = centerLines[1]!;
    const line3: WallCenterLine = centerLines[2]!;
    const line4: WallCenterLine = centerLines[3]!;

    const g1: THREE.BufferGeometry = this._wallBuilder.buildPreview(line1.start, line1.end, this._thickness, this._height);
    const g2: THREE.BufferGeometry = this._wallBuilder.buildPreview(line2.start, line2.end, this._thickness, this._height);
    const g3: THREE.BufferGeometry = this._wallBuilder.buildPreview(line3.start, line3.end, this._thickness, this._height);
    const g4: THREE.BufferGeometry = this._wallBuilder.buildPreview(line4.start, line4.end, this._thickness, this._height);

    /* 合并为单个几何体 */
    const merged: THREE.BufferGeometry = new THREE.BufferGeometry();
    const geometries: THREE.BufferGeometry[] = [g1, g2, g3, g4].filter(
      (g: THREE.BufferGeometry): boolean => g.attributes['position'] !== undefined
    );

    if (geometries.length === 0) {
      return merged;
    }

    /* 手动合并顶点和索引 */
    const allPositions: number[] = [];
    const allNormals: number[] = [];
    const allIndices: number[] = [];
    let vertOffset: number = 0;

    for (const g of geometries) {
      const posAttr: THREE.BufferAttribute = g.attributes['position'] as THREE.BufferAttribute;
      const normAttr: THREE.BufferAttribute = g.attributes['normal'] as THREE.BufferAttribute;
      const idx: THREE.BufferAttribute | null = g.index;

      if (posAttr !== undefined) {
        for (let i: number = 0; i < posAttr.count * 3; i++) {
          allPositions.push(posAttr.array[i]!);
        }
      }
      if (normAttr !== undefined) {
        for (let i: number = 0; i < normAttr.count * 3; i++) {
          allNormals.push(normAttr.array[i]!);
        }
      }
      if (idx !== null) {
        for (let i: number = 0; i < idx.count; i++) {
          allIndices.push(idx.array[i]! + vertOffset);
        }
      }
      if (posAttr !== undefined) {
        vertOffset += posAttr.count;
      }

      g.dispose();
    }

    merged.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(allNormals, 3));
    merged.setIndex(allIndices);

    return merged;
  }

  /**
   * 清除预览 Mesh
   */
  private _clearPreview(): void {
    /* 清理预览流程：预览 Mesh 与线性角度标注保持同生命周期，避免切换模式后残留角度文本。 */
    this._linearAngleRenderer.clearPreview();
    if (this._previewMesh !== null) {
      this._sceneManager.remove(this._previewMesh);
      this._previewMesh.geometry.dispose();
      this._previewMesh = null;
    }
  }

  /**
   * 显示起点标记
   */
  private _showStartMarker(point: Point2D): void {
    this._clearStartMarker();

    const markerGeom: THREE.SphereGeometry = new THREE.SphereGeometry(0.05, 16, 16);
    const markerMat: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({ color: 0xff4444 });
    this._startMarker = new THREE.Mesh(markerGeom, markerMat);
    this._startMarker.position.set(point.x, 0.05, point.z);
    this._startMarker.name = '__start_marker__';
    this._sceneManager.add(this._startMarker);
  }

  /**
   * 清除起点标记
   */
  private _clearStartMarker(): void {
    if (this._startMarker !== null) {
      this._sceneManager.remove(this._startMarker);
      this._startMarker.geometry.dispose();
      (this._startMarker.material as THREE.Material).dispose();
      this._startMarker = null;
    }
  }

  /* ========== 平面布置统一吸附 ========== */

  /**
   * 对输入坐标执行统一平面捕获检测
   * 关键流程：点目标优先，其次墙/梁延长线，最后在直墙/梁第二点阶段应用正交约束。
   * @param rawPoint - 原始鼠标投射坐标
   * @returns 吸附检测结果
   */
  private _applySnap(rawPoint: Point2D): PlanarPlacementSnapResult {
    const orthogonalAnchor: Point2D | null = this._getOrthogonalAnchor();
    const guideHalfLength: number = this._computeViewGuideHalfLength();
    const result: PlanarPlacementSnapResult = this._planarSnapService.snap(
      rawPoint,
      SNAP_THRESHOLD,
      orthogonalAnchor,
      guideHalfLength
    );
    this._planarGuideRenderer.update(result.guideLines.length > 0 ? result.guideLines : (result.guideLine === null ? [] : [result.guideLine]));

    if (result.showSnapPoint) {
      /* 捕获点显示规则：点捕获和两线交点显示标记；单线捕获仅约束落点，不显示捕获点。 */
      this._showSnapMarker(result.position);
      this._isSnapped = true;
      console.log(`[WallDrawTool] 平面捕获(${result.type}): (${result.position.x.toFixed(3)}, ${result.position.z.toFixed(3)})`);
    } else if (result.snapped) {
      /* 单条捕获线：隐藏捕获点，但保留投影后的布置坐标和捕获线显示。 */
      this._clearSnapMarker();
      this._isSnapped = true;
    } else {
      /* 未捕获：清除吸附标记和辅助虚线。 */
      this._clearSnapMarker();
      this._planarGuideRenderer.hide();
      this._isSnapped = false;
    }

    return result;
  }

  /**
   * 计算横跨当前视图的辅助虚线半长
   * 关键流程：把画布四角投射到地面，使用地面包围盒对角线作为虚线半长；投射失败时使用安全兜底长度。
   * @returns 当前视图对应的辅助虚线半长，单位米
   */
  private _computeViewGuideHalfLength(): number {
    if (this._getCameraFn === null || this._domElement === null) {
      return 48;
    }

    const camera: THREE.Camera = this._getCameraFn();
    const rect: DOMRect = this._domElement.getBoundingClientRect();
    const cornerPoints: Point2D[] = [];
    const screenCorners: Array<{ x: number; y: number }> = [
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.right, y: rect.bottom },
      { x: rect.left, y: rect.bottom },
    ];

    for (const corner of screenCorners) {
      const point: Point2D | null = this._raycastHelper.screenToGround(corner.x, corner.y, camera, this._domElement);
      if (point !== null) {
        cornerPoints.push(point);
      }
    }

    if (cornerPoints.length < 2) {
      return 48;
    }

    let minX: number = Number.POSITIVE_INFINITY;
    let maxX: number = Number.NEGATIVE_INFINITY;
    let minZ: number = Number.POSITIVE_INFINITY;
    let maxZ: number = Number.NEGATIVE_INFINITY;

    for (const point of cornerPoints) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }

    const width: number = maxX - minX;
    const depth: number = maxZ - minZ;
    const diagonalLength: number = Math.sqrt(width * width + depth * depth);
    if (!Number.isFinite(diagonalLength) || diagonalLength < 1) {
      return 48;
    }

    return Math.max(48, diagonalLength);
  }

  /**
   * 获取正交约束锚点
   * @returns 直墙、梁、弧形墙第二点阶段的起点；其他阶段返回 null
   */
  private _getOrthogonalAnchor(): Point2D | null {
    if (this._state !== 'picking-end') {
      return null;
    }
    if (this._startPoint === null) {
      return null;
    }
    if (this._mode !== 'straight-wall' && this._mode !== 'beam' && this._mode !== 'arc-wall') {
      return null;
    }
    return this._startPoint;
  }

  /**
   * 显示吸附高亮标记（绿色圆环，位于吸附点上方）
   * @param point - 吸附点坐标
   */
  private _showSnapMarker(point: Point2D): void {
    this._clearSnapMarker();

    /* 使用环形几何体作为吸附指示器 */
    const ringGeom: THREE.TorusGeometry = new THREE.TorusGeometry(0.08, 0.015, 8, 24);
    const ringMat: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({
      color: 0x44ff44,
      transparent: true,
      opacity: 0.8,
      depthTest: false,
      depthWrite: false,
    });
    this._snapMarker = new THREE.Mesh(ringGeom, ringMat);
    /* 捕获点需要最高显示优先级：禁用深度遮挡并提升渲染顺序，避免被墙体、地面或 2D 标注覆盖。 */
    this._snapMarker.renderOrder = SNAP_MARKER_RENDER_ORDER;
    /* 环形平放在 XZ 平面上 */
    this._snapMarker.rotation.x = Math.PI / 2;
    this._snapMarker.position.set(point.x, 0.02, point.z);
    this._snapMarker.name = '__snap_marker__';
    this._sceneManager.add(this._snapMarker);
  }

  /**
   * 清除吸附标记
   */
  private _clearSnapMarker(): void {
    if (this._snapMarker !== null) {
      this._sceneManager.remove(this._snapMarker);
      this._snapMarker.geometry.dispose();
      (this._snapMarker.material as THREE.Material).dispose();
      this._snapMarker = null;
    }
    this._isSnapped = false;
  }

  /**
   * 创建直墙并按需写入历史栈
   * 关键流程：先构造稳定数据快照，再交给命令历史管理器执行；无历史管理器时回退为直接添加对象。
   * @param previousStart - 上一段连续直墙内侧起点；首段传入 null
   * @param start - 当前直墙内侧线起点
   * @param end - 当前直墙内侧线终点
   * @returns 创建出的直墙 ID
   */
  private _createStraightWallByHistory(previousStart: Point2D | null, start: Point2D, end: Point2D): string {
    /* 墙体布置关键流程：用户绘制线视为墙内侧线；连续绘制时用相邻内侧边的偏移线交点修正中心线墙角。 */
    const centerLine: WallCenterLine = WallPlacementLineConverter.convertConnectedInnerLineToCenterLine(
      previousStart,
      start,
      end,
      null,
      this._thickness
    );
    const wallData: StraightWallData = this._objectManager.createStraightWallData(
      centerLine.start,
      centerLine.end,
      this._thickness,
      this._height
    );
    const previousWallUpdate: PreviousStraightWallEndpointUpdate | null = this._createPreviousStraightWallEndpointUpdate(
      previousStart,
      start,
      end
    );

    if (this._historyManager !== null) {
      if (previousWallUpdate !== null) {
        this._historyManager.execute(new ConnectedStraightWallCreateCommand(
          this._objectManager,
          this._sceneManager.getScene(),
          wallData,
          previousWallUpdate
        ));
      } else {
        this._historyManager.execute(new StraightWallCreateCommand(
          this._objectManager,
          this._sceneManager.getScene(),
          wallData
        ));
      }
      return wallData.id;
    }

    if (previousWallUpdate !== null) {
      this._objectManager.updateObject(
        previousWallUpdate.wallId,
        { end: { x: previousWallUpdate.nextEnd.x, z: previousWallUpdate.nextEnd.z } } as Partial<StraightWallData>
      );
    }

    /* 未注入历史管理器的兼容路径：保持旧版直接创建行为。 */
    this._objectManager.addObject(wallData);
    return wallData.id;
  }

  /**
   * 判断当前直墙终点是否应闭合到本轮连续绘制的第一个内侧节点。
   * 关键流程：闭合捕获优先使用原始内侧首点，而不是已有墙体的中心线端点，避免首尾处再次偏移一个墙厚。
   * @param end - 当前确认的内侧终点
   * @returns 需要闭合时返回首个内侧节点副本；否则返回 null
   */
  private _resolveStraightClosedLoopEndPoint(end: Point2D): Point2D | null {
    if (!this._continuous || this._straightInnerPathPoints.length < 3 || this._straightPathWallIds.length < 2) {
      return null;
    }

    const firstPoint: Point2D = this._straightInnerPathPoints[0]!;
    const dx: number = end.x - firstPoint.x;
    const dz: number = end.z - firstPoint.z;
    const distance: number = Math.sqrt(dx * dx + dz * dz);
    const closeThreshold: number = Math.max(SNAP_THRESHOLD, this._thickness * 1.5);
    if (distance > closeThreshold) {
      return null;
    }

    return { x: firstPoint.x, z: firstPoint.z };
  }

  /**
   * 按完整内侧闭合轮廓创建最后一段直墙并回写已有墙段中心线。
   * 关键流程：把本轮连续内侧节点与闭合终点组成闭合多边形，统一偏移得到所有中心线，避免逐段偏移误差累积到首尾。
   * @param start - 当前闭合段内侧起点
   * @param end - 当前闭合段内侧终点，应等于本轮首个内侧节点
   * @returns 创建出的闭合段直墙 ID
   */
  private _createClosedStraightWallLoopByHistory(start: Point2D, end: Point2D): string {
    const innerOutline: Point2D[] = this._straightInnerPathPoints.map((point: Point2D): Point2D => ({ x: point.x, z: point.z }));
    const latestPathPoint: Point2D | undefined = innerOutline[innerOutline.length - 1];
    if (latestPathPoint === undefined || !this._arePointsNearlyEqual(latestPathPoint, start)) {
      innerOutline.push({ x: start.x, z: start.z });
    }

    const firstPoint: Point2D | undefined = innerOutline[0];
    if (firstPoint === undefined || !this._arePointsNearlyEqual(firstPoint, end) || innerOutline.length < 3) {
      return this._createStraightWallByHistory(this._previousStraightInnerStart, start, end);
    }

    const centerLines: WallCenterLine[] = WallPlacementLineConverter.convertClosedInnerOutlineToCenterLines(
      innerOutline,
      this._thickness
    );
    if (centerLines.length !== innerOutline.length || this._straightPathWallIds.length !== innerOutline.length - 1) {
      return this._createStraightWallByHistory(this._previousStraightInnerStart, start, end);
    }

    const wallUpdates: ClosedLoopStraightWallUpdate[] = [];
    for (let index: number = 0; index < this._straightPathWallIds.length; index += 1) {
      const wallId: string = this._straightPathWallIds[index]!;
      const wallData: StraightWallData | null = this._findStraightWallById(wallId);
      const nextLine: WallCenterLine = centerLines[index]!;
      if (wallData === null) {
        return this._createStraightWallByHistory(this._previousStraightInnerStart, start, end);
      }

      wallUpdates.push({
        wallId: wallData.id,
        previousStart: { x: wallData.start.x, z: wallData.start.z },
        previousEnd: { x: wallData.end.x, z: wallData.end.z },
        nextStart: { x: nextLine.start.x, z: nextLine.start.z },
        nextEnd: { x: nextLine.end.x, z: nextLine.end.z },
      });
    }

    const closingCenterLine: WallCenterLine = centerLines[centerLines.length - 1]!;
    const closingWallData: StraightWallData = this._objectManager.createStraightWallData(
      closingCenterLine.start,
      closingCenterLine.end,
      this._thickness,
      this._height
    );

    if (this._historyManager !== null) {
      this._historyManager.execute(new ClosedStraightWallLoopCreateCommand(
        this._objectManager,
        this._sceneManager.getScene(),
        closingWallData,
        wallUpdates
      ));
      return closingWallData.id;
    }

    /* 未注入历史管理器时，同步回写已有墙段后创建闭合段，保持与命令路径一致。 */
    for (const update of wallUpdates) {
      this._objectManager.updateObject(
        update.wallId,
        {
          start: { x: update.nextStart.x, z: update.nextStart.z },
          end: { x: update.nextEnd.x, z: update.nextEnd.z },
        } as Partial<StraightWallData>
      );
    }
    this._objectManager.addObject(closingWallData);
    return closingWallData.id;
  }

  /**
   * 判断两个二维点是否近似相等。
   * @param pointA - 第一个点
   * @param pointB - 第二个点
   * @returns 距离小于容差时返回 true
   */
  private _arePointsNearlyEqual(pointA: Point2D, pointB: Point2D): boolean {
    const dx: number = pointA.x - pointB.x;
    const dz: number = pointA.z - pointB.z;
    return Math.sqrt(dx * dx + dz * dz) <= 0.001;
  }

  /**
   * 创建上一段连续直墙端点修正参数。
   * 关键流程：第二段及以后确定时，根据上一条与当前条内侧布置线重新计算上一段中心线终点。
   * @param previousStart - 上一段内侧线起点；首段传入 null
   * @param start - 当前段内侧线起点，也是上一段内侧线终点
   * @param end - 当前段内侧线终点
   * @returns 上一段墙体端点修正参数；没有可修正墙体时返回 null
   */
  private _createPreviousStraightWallEndpointUpdate(
    previousStart: Point2D | null,
    start: Point2D,
    end: Point2D
  ): PreviousStraightWallEndpointUpdate | null {
    if (previousStart === null || this._previousStraightWallId === null) {
      /* 首段或历史已断开时，不修正上一段墙体。 */
      return null;
    }

    const previousWall: StraightWallData | null = this._findStraightWallById(this._previousStraightWallId);
    if (previousWall === null) {
      /* 撤销、删除等操作导致上一段不存在时，跳过衔接修正以保持绘制流程可继续。 */
      return null;
    }

    const previousConnectedLine: WallCenterLine = WallPlacementLineConverter.convertConnectedInnerLineToCenterLine(
      null,
      previousStart,
      start,
      end,
      this._thickness
    );

    return {
      wallId: previousWall.id,
      previousEnd: { x: previousWall.end.x, z: previousWall.end.z },
      nextEnd: previousConnectedLine.end,
    };
  }

  /**
   * 按 ID 查找直墙数据。
   * @param wallId - 直墙 ID
   * @returns 找到的直墙数据；不存在或类型不匹配时返回 null
   */
  private _findStraightWallById(wallId: string): StraightWallData | null {
    const allObjects: BuildingObject[] = this._objectManager.getAll();
    for (const object of allObjects) {
      if (object.id === wallId && object.category === 'wall' && object.subType === 'straight') {
        return object as StraightWallData;
      }
    }

    return null;
  }

  /**
   * 按 ID 查找弧形墙数据。
   * @param wallId - 弧形墙 ID
   * @returns 找到的弧形墙数据；不存在或类型不匹配时返回 null
   */
  private _findArcWallById(wallId: string): ArcWallData | null {
    const allObjects: BuildingObject[] = this._objectManager.getAll();
    for (const object of allObjects) {
      if (object.id === wallId && object.category === 'wall' && object.subType === 'arc') {
        return object as ArcWallData;
      }
    }

    return null;
  }

  /**
   * 创建梁并按需写入历史栈
   * 关键流程：梁长度由 start/end 计算并随布置线变化，不提供手动长度写入入口。
   * @param start - 梁中心线起点
   * @param end - 梁中心线终点
   */
  private _createBeamByHistory(start: Point2D, end: Point2D): void {
    const beamData: BeamData = this._objectManager.createBeamData(
      start,
      end,
      BEAM_DEFAULTS.width,
      BEAM_DEFAULTS.height
    );

    if (this._historyManager !== null) {
      this._historyManager.execute(new BeamCreateCommand(this._objectManager, beamData));
      return;
    }

    /* 未注入历史管理器的兼容路径：保持直接创建行为。 */
    this._objectManager.addObject(beamData);
  }

  /**
   * 创建矩形墙并按需写入历史栈
   * 关键流程：构造父级矩形墙与四面子墙数据，命令负责创建/撤销数据；2D 楼板边界长度由独立标注组件渲染。
   * @param corner1 - 矩形对角点 1
   * @param corner2 - 矩形对角点 2
   */
  private _createRectWallByHistory(corner1: Point2D, corner2: Point2D): void {
    const bundle: { rect: RectWallData; children: [StraightWallData, StraightWallData, StraightWallData, StraightWallData] } =
      this._objectManager.createRectWallDataBundle(corner1, corner2, this._thickness, this._height);

    if (this._historyManager !== null) {
      this._historyManager.execute(new RectWallCreateCommand(
        this._objectManager,
        this._sceneManager.getScene(),
        bundle.rect,
        bundle.children
      ));
      return;
    }

    /* 未注入历史管理器的兼容路径：直接添加对象，楼板边界长度由 2D 标注组件统一渲染。 */
    for (const childData of bundle.children) {
      this._objectManager.addObject(childData);
    }
    this._objectManager.addObject(bundle.rect);
  }

  /**
   * 取消当前绘制
   * 同时清除矩形墙预览标注
   */
  private _cancelCurrentDraw(): void {
    this._clearPreview();
    this._clearStartMarker();
    this._clearSnapMarker();
    this._planarGuideRenderer.hide();
    /* 取消时清除矩形墙预览标注 */
    this._rectDimRenderer.clearPreview();
    this._straightDimRenderer.clearPreview();
    this._arcRadiusDimRenderer.clearPreview();
    this._startPoint = null;
    this._endPoint = null;
    this._bulge = 0;
    this._arcPreviewControlPoint = null;
    this._editingArcWallId = null;
    this._previousStraightInnerStart = null;
    this._previousStraightWallId = null;
    this._straightInnerPathPoints = [];
    this._straightPathWallIds = [];
    this._resetRectPreviewDimensionEdit(true);
    this._resetStraightPreviewDimensionEdit();
    this._state = 'picking-start';
    this._notify();
  }

  /**
   * 根据起点、终点和弧上一点计算标准 bulge 弧度因子。
   * 关键流程：先由三点计算外接圆，再判断弧上一点位于顺时针还是逆时针圆弧，最后按 DXF bulge 公式生成弧度因子。
   * @param point - 用户第三次点击的弧上一点
   * @returns 标准 bulge 值，正值表示逆时针弧，负值表示顺时针弧
   */
  private _computeBulgeFromPoint(point: Point2D): number {
    if (this._startPoint === null || this._endPoint === null) return 0;

    const startX: number = this._startPoint.x;
    const startZ: number = this._startPoint.z;
    const endX: number = this._endPoint.x;
    const endZ: number = this._endPoint.z;
    const arcX: number = point.x;
    const arcZ: number = point.z;
    const chordDx: number = endX - startX;
    const chordDz: number = endZ - startZ;
    const chordLen: number = Math.sqrt(chordDx * chordDx + chordDz * chordDz);

    if (chordLen < 0.001) return 0;

    /* 三点近似共线时无法稳定计算外接圆，退化为直线墙预览。 */
    const determinant: number = 2 * (
      startX * (endZ - arcZ)
      + endX * (arcZ - startZ)
      + arcX * (startZ - endZ)
    );
    if (Math.abs(determinant) < 0.0001) return 0;

    const startSquare: number = startX * startX + startZ * startZ;
    const endSquare: number = endX * endX + endZ * endZ;
    const arcSquare: number = arcX * arcX + arcZ * arcZ;

    /* 外接圆圆心用于精确判断第三点所在圆弧方向。 */
    const centerX: number = (
      startSquare * (endZ - arcZ)
      + endSquare * (arcZ - startZ)
      + arcSquare * (startZ - endZ)
    ) / determinant;
    const centerZ: number = (
      startSquare * (arcX - endX)
      + endSquare * (startX - arcX)
      + arcSquare * (endX - startX)
    ) / determinant;

    const startAngle: number = Math.atan2(startZ - centerZ, startX - centerX);
    const endAngle: number = Math.atan2(endZ - centerZ, endX - centerX);
    const arcAngle: number = Math.atan2(arcZ - centerZ, arcX - centerX);
    const counterClockwiseAngle: number = this._normalizePositiveAngle(endAngle - startAngle);
    const counterClockwiseArcPointAngle: number = this._normalizePositiveAngle(arcAngle - startAngle);
    const clockwiseAngle: number = Math.PI * 2 - counterClockwiseAngle;

    /* 第三点在起点到终点的逆时针圆弧上时使用正 bulge，否则使用顺时针负 bulge。 */
    const isCounterClockwiseArc: boolean = counterClockwiseArcPointAngle <= counterClockwiseAngle;
    const includedAngle: number = isCounterClockwiseArc ? counterClockwiseAngle : clockwiseAngle;
    const signedBulge: number = Math.tan(includedAngle / 4) * (isCounterClockwiseArc ? 1 : -1);

    /* 保留大弧绘制能力，同时限制接近整圆时的极端 bulge，避免几何生成不稳定。 */
    return Math.max(-10, Math.min(10, signedBulge));
  }

  /**
   * 将任意角度归一化到 [0, 2π) 区间。
   * @param angle - 原始弧度角
   * @returns 归一化后的正向弧度角
   */
  private _normalizePositiveAngle(angle: number): number {
    const fullCircle: number = Math.PI * 2;
    let normalizedAngle: number = angle % fullCircle;
    if (normalizedAngle < 0) {
      normalizedAngle += fullCircle;
    }
    return normalizedAngle;
  }

  /* ========== 参数设置 ========== */

  public setThickness(value: number): void {
    this._thickness = value;
  }

  public setHeight(value: number): void {
    this._height = value;
  }

  public setContinuous(value: boolean): void {
    this._continuous = value;
  }

  /* ========== 事件订阅 ========== */

  public onChange(callback: DrawToolChangeCallback): () => void {
    this._listeners.add(callback);
    return (): void => {
      this._listeners.delete(callback);
    };
  }

  private _notify(): void {
    this._listeners.forEach((cb: DrawToolChangeCallback): void => cb());
  }

  /* ========== 标注显隐控制 ========== */

  /**
   * 设置矩形墙预览标注渲染器内旧标注的可见性
   * 当前确认后的楼板边界长度标注由 FloorBoundaryDimensionLabel 在 2D 模式下挂载控制。
   * @param visible - true 显示，false 隐藏
   */
  public setAnnotationsVisible(visible: boolean): void {
    this._rectDimRenderer.setVisible(visible);
    this._straightDimRenderer.setVisible(visible);
    this._linearAngleRenderer.setVisible(visible);
    this._arcRadiusDimRenderer.setVisible(visible);
  }

  /**
   * 同步当前选中的建筑对象 ID 集合，用于控制弧墙常驻半径/角度标注只在点选后显示。
   * @param selectedWallIds - 当前选中的建筑对象 ID 只读集合
   */
  public setSelectedWallIds(selectedWallIds: ReadonlySet<string>): void {
    this._arcRadiusDimRenderer.setSelectedWallIds(selectedWallIds);
  }

  /* ========== 销毁 ========== */

  public dispose(): void {
    this.deactivate();
    this._previewMaterial.dispose();
    /* 释放墙/梁线式布置辅助虚线资源，避免工具销毁后残留隐藏对象。 */
    this._planarGuideRenderer.dispose();
    /* 释放矩形墙尺寸标注渲染器资源。 */
    this._rectDimRenderer.dispose();
    this._straightDimRenderer.dispose();
    this._linearAngleRenderer.dispose();
    this._arcRadiusDimRenderer.dispose();
    this._listeners.clear();
  }
}
