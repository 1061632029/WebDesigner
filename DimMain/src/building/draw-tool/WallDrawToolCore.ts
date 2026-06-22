/**
 * 墙体绘制工具核心基类。
 * 负责共享状态、生命周期入口和 DOM 事件分发，具体模型绘制逻辑由子类按对象类型实现。
 */

import * as THREE from 'three/webgpu';
import type { BuildingObject, Point2D, DrawToolMode, DrawToolState } from '../BuildingTypes';
import { WALL_DEFAULTS } from '../BuildingTypes';
import { WallGeometryBuilder } from '../WallGeometryBuilder';
import { BeamGeometryBuilder } from '../BeamGeometryBuilder';
import { BuildingObjectManager } from '../BuildingObjectManager';
import { RaycastHelper } from '../../interaction/RaycastHelper';
import { RectDimensionRenderer, type RectPreviewEditAxis } from '../RectDimensionRenderer';
import { StraightWallDimensionRenderer } from '../StraightWallDimensionRenderer';
import { LinearPlacementAngleRenderer } from '../LinearPlacementAngleRenderer';
import { ArcWallRadiusDimensionRenderer, type ArcWallPreviewEditTarget, type ArcWallDimensionPickResult } from '../ArcWallRadiusDimensionRenderer';
import { PlanarPlacementSnapService } from '../PlanarPlacementSnapService';
import { PlanarPlacementGuideRenderer } from '../PlanarPlacementGuideRenderer';
import type { PlanarPlacementSnapResult } from '../PlanarPlacementSnapTypes';
import type { BuildingSnapTypeEnabledReader } from '../BuildingSnapSettingTypes';
import type { SceneManager } from '../../scene/SceneManager';
import type { CommandHistoryManager } from '../../history/CommandHistoryManager';
import type { DrawToolChangeCallback, LinearPreviewEditTarget } from './WallDrawToolTypes';

/**
 * 墙体绘制工具
 * 处理鼠标事件，维护绘制状态机，创建预览几何体和最终墙体
 */
export abstract class WallDrawToolCore {
  /** 当前绘制模式 */
  protected _mode: DrawToolMode = 'none';
  /** 当前状态 */
  protected _state: DrawToolState = 'idle';

  /** 起点（第一次点击） */
  protected _startPoint: Point2D | null = null;
  /** 终点 / 当前鼠标位置 */
  protected _endPoint: Point2D | null = null;
  /** 弧形墙弧度因子 */
  protected _bulge: number = 0;
  /** 弧形墙第三点布置阶段的当前鼠标方向点，用于半径动态标注定位。 */
  protected _arcPreviewControlPoint: Point2D | null = null;

  /** 建筑对象管理器 */
  protected _objectManager: BuildingObjectManager;
  /** 场景管理器 */
  protected _sceneManager: SceneManager;
  /** 射线投射辅助器 */
  protected _raycastHelper: RaycastHelper = new RaycastHelper();
  /** 弧形墙常驻标注拾取射线，用于点击半径/角度标注进入编辑态。 */
  protected _arcDimensionLabelRaycaster: THREE.Raycaster = new THREE.Raycaster();
  /** 墙体几何构建器（用于预览） */
  protected _wallBuilder: WallGeometryBuilder = new WallGeometryBuilder();

  /** 梁几何构建器（用于预览） */
  protected _beamBuilder: BeamGeometryBuilder = new BeamGeometryBuilder();

  /** 预览 Mesh */
  protected _previewMesh: THREE.Mesh | null = null;
  /** 预览材质（半透明） */
  protected _previewMaterial: THREE.MeshStandardMaterial;

  /** 起点标记 Mesh */
  protected _startMarker: THREE.Mesh | null = null;

  /** 吸附高亮标记 Mesh（绿色环形，表示鼠标靠近已有端点） */
  protected _snapMarker: THREE.Mesh | null = null;
  /** 当前是否处于吸附状态 */
  protected _isSnapped: boolean = false;

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
  protected _getCameraFn: (() => THREE.Camera) | null = null;
  /** Canvas DOM 元素引用 */
  protected _domElement: HTMLElement | null = null;

  /** 状态变更监听器 */
  protected _listeners: Set<DrawToolChangeCallback> = new Set();

  /** 墙体参数 */
  protected _thickness: number = WALL_DEFAULTS.thickness;
  protected _height: number = WALL_DEFAULTS.height;

  /** 连续绘制模式（直墙模式下终点变为下一段起点） */
  protected _continuous: boolean = true;

  /** 连续直墙上一段内侧起点，用于在下一段创建时计算中心线交点。 */
  protected _previousStraightInnerStart: Point2D | null = null;

  /** 连续直墙上一段创建出的墙体 ID，用于在下一段创建时回写衔接端点。 */
  protected _previousStraightWallId: string | null = null;

  /** 连续直墙本轮绘制的内侧节点序列，用于闭合时按完整内侧轮廓统一反算中心线。 */
  protected _straightInnerPathPoints: Point2D[] = [];

  /** 连续直墙本轮绘制已创建的墙体 ID 序列，与内侧节点边一一对应。 */
  protected _straightPathWallIds: string[] = [];

  /** 矩形墙尺寸标注渲染器（仅保留绘制过程中的预览标注） */
  protected _rectDimRenderer: RectDimensionRenderer;

  /** 直墙动态尺寸标注渲染器，用于直墙布置过程中的长度标注。 */
  protected _straightDimRenderer: StraightWallDimensionRenderer;

  /** 线性布置角度标注渲染器，用于直墙、梁预览时显示与水平线的夹角。 */
  protected _linearAngleRenderer: LinearPlacementAngleRenderer;

  /** 弧形墙半径动态标注渲染器，用于弧度布置阶段显示毫米半径。 */
  protected _arcRadiusDimRenderer: ArcWallRadiusDimensionRenderer;

  /** 矩形墙预览当前可编辑尺寸轴，默认编辑水平尺寸。 */
  protected _rectPreviewEditAxis: RectPreviewEditAxis = 'horizontal';

  /** 矩形墙预览尺寸键盘输入缓冲，单位为毫米。 */
  protected _rectPreviewDimensionInput: string = '';

  /** 矩形墙预览是否刚由键盘尺寸驱动，用于鼠标移动时恢复鼠标驱动。 */
  protected _rectPreviewKeyboardSized: boolean = false;

  /** 线性布置预览当前键盘编辑目标，默认编辑长度标注。 */
  protected _linearPreviewEditTarget: LinearPreviewEditTarget = 'length';

  /** 线性布置预览长度输入缓冲，单位为毫米。 */
  protected _straightPreviewDimensionInput: string = '';

  /** 线性布置预览角度输入缓冲，单位为度。 */
  protected _linearPreviewAngleInput: string = '';

  /** 线性布置预览是否已由键盘尺寸/角度输入驱动。 */
  protected _straightPreviewKeyboardSized: boolean = false;

  /** 弧形墙预览当前键盘编辑目标，Tab 在半径与角度之间切换。 */
  protected _arcPreviewEditTarget: ArcWallPreviewEditTarget = 'radius';

  /** 弧形墙预览半径输入缓存，单位为毫米。 */
  protected _arcPreviewRadiusInput: string = '';

  /** 弧形墙预览角度输入缓存，单位为度。 */
  protected _arcPreviewAngleInput: string = '';

  /** 弧形墙预览是否已由键盘尺寸控制，点击确认时避免被鼠标点覆盖。 */
  protected _arcPreviewKeyboardSized: boolean = false;

  /** 当前正在通过常驻标注编辑的弧形墙 ID；为空表示新建弧形墙流程。 */
  protected _editingArcWallId: string | null = null;

  /** 平面线式布置统一捕获服务 */
  protected _planarSnapService: PlanarPlacementSnapService;

  /** 平面线式布置捕获辅助虚线渲染器 */
  protected _planarGuideRenderer: PlanarPlacementGuideRenderer;

  /** 捕获类型启用状态读取器；由 React 捕获设置上下文注入。 */
  protected _snapTypeEnabledReader: BuildingSnapTypeEnabledReader | null = null;

  /** 命令历史管理器；存在时墙体创建进入撤销/重做栈 */
  protected _historyManager: CommandHistoryManager | null;

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
   * 设置捕获类型启用状态读取器。
   * @param reader - 捕获类型启用判断函数；传入 null 时恢复全部捕获类型启用
   */
  public setSnapTypeEnabledReader(reader: BuildingSnapTypeEnabledReader | null): void {
    this._snapTypeEnabledReader = reader;
  }

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
  protected _handleClick = (event: MouseEvent): void => {
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
  protected _handleMouseMove = (event: MouseEvent): void => {
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
  protected _handleRightClick = (event: MouseEvent): void => {
    event.preventDefault();
    this._cancelCurrentDraw();
  };

  /**
   * 键盘按键
   */
  protected _handleKeyDown = (event: KeyboardEvent): void => {
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


  /** 重置矩形墙预览尺寸编辑状态。 */
  protected abstract _resetRectPreviewDimensionEdit(resetAxis: boolean): void;
  /** 重置墙/梁线性预览尺寸编辑状态。 */
  protected abstract _resetStraightPreviewDimensionEdit(): void;
  /** 重置弧形墙预览尺寸编辑状态。 */
  protected abstract _resetArcPreviewDimensionEdit(resetTarget: boolean): void;
  /** 清除当前预览 Mesh。 */
  protected abstract _clearPreview(): void;
  /** 显示绘制起点标记。 */
  protected abstract _showStartMarker(point: Point2D): void;
  /** 清除起点标记。 */
  protected abstract _clearStartMarker(): void;
  /** 清除捕获标记。 */
  protected abstract _clearSnapMarker(): void;
  /** 拾取弧形墙半径/角度标注。 */
  protected abstract _pickArcWallDimensionLabel(clientX: number, clientY: number, camera: THREE.Camera): ArcWallDimensionPickResult | null;
  /** 进入已有弧形墙标注编辑状态。 */
  protected abstract _enterArcWallDimensionEdit(picked: ArcWallDimensionPickResult): boolean;
  /** 对鼠标投射点执行平面捕获。 */
  protected abstract _applySnap(rawPoint: Point2D): PlanarPlacementSnapResult;
  /** 处理直墙点击流程。 */
  protected abstract _handleStraightWallClick(point: Point2D): void;
  /** 处理梁点击流程。 */
  protected abstract _handleBeamClick(point: Point2D): void;
  /** 确认梁预览并创建梁对象。 */
  protected abstract _confirmBeamPreview(): void;
  /** 处理弧形墙点击流程。 */
  protected abstract _handleArcWallClick(point: Point2D): void;
  /** 处理矩形墙点击流程。 */
  protected abstract _handleRectWallClick(point: Point2D): void;
  /** 根据弧上一点计算 bulge。 */
  protected abstract _computeBulgeFromPoint(point: Point2D): number;
  /** 更新当前模式预览。 */
  protected abstract _updatePreview(): void;
  /** 处理墙/梁线性标注键盘输入。 */
  protected abstract _handleStraightPreviewDimensionKeyDown(event: KeyboardEvent): boolean;
  /** 处理矩形墙标注键盘输入。 */
  protected abstract _handleRectPreviewDimensionKeyDown(event: KeyboardEvent): boolean;
  /** 处理弧形墙标注键盘输入。 */
  protected abstract _handleArcPreviewDimensionKeyDown(event: KeyboardEvent): boolean;
  /** 取消当前绘制流程。 */
  protected abstract _cancelCurrentDraw(): void;
  /** 通知外部状态变更。 */
  protected abstract _notify(): void;
}
