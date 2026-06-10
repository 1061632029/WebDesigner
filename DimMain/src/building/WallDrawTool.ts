/**
 * 墙体绘制工具
 * 状态机模式管理墙体的交互式绘制流程
 * 支持直墙、弧形墙、矩形墙三种绘制模式
 */

import * as THREE from 'three/webgpu';
import type { BeamData, BuildingObject, Point2D, DrawToolMode, DrawToolState, StraightWallData, RectWallData } from './BuildingTypes';
import { WALL_DEFAULTS, BEAM_DEFAULTS, SNAP_THRESHOLD } from './BuildingTypes';
import { WallGeometryBuilder } from './WallGeometryBuilder';
import { BeamGeometryBuilder } from './BeamGeometryBuilder';
import { BuildingObjectManager } from './BuildingObjectManager';
import { RaycastHelper } from '../interaction/RaycastHelper';
import { RectDimensionRenderer } from './RectDimensionRenderer';
import { PlanarPlacementSnapService } from './PlanarPlacementSnapService';
import { PlanarPlacementGuideRenderer } from './PlanarPlacementGuideRenderer';
import { WallPlacementLineConverter } from './WallPlacementLineConverter';
import type { ClockwiseRectInnerEdges, WallCenterLine } from './WallPlacementLineConverter';
import type { PlanarPlacementSnapResult } from './PlanarPlacementSnapTypes';
import type { SceneManager } from '../scene/SceneManager';
import type { CommandHistoryManager } from '../history/CommandHistoryManager';
import { StraightWallCreateCommand } from '../history/commands/StraightWallCreateCommand';
import { RectWallCreateCommand } from '../history/commands/RectWallCreateCommand';
import { BeamCreateCommand } from '../history/commands/BeamCreateCommand';

/**
 * 绘制工具状态变更回调
 */
export type DrawToolChangeCallback = () => void;

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

  /** 建筑对象管理器 */
  private _objectManager: BuildingObjectManager;
  /** 场景管理器 */
  private _sceneManager: SceneManager;
  /** 射线投射辅助器 */
  private _raycastHelper: RaycastHelper = new RaycastHelper();
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

  /** 矩形墙尺寸标注渲染器（仅保留绘制过程中的预览标注） */
  private _rectDimRenderer: RectDimensionRenderer;

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
    
    this._mode = 'none';
    this._state = 'idle';
    this._startPoint = null;
    this._endPoint = null;
    this._bulge = 0;
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
      this._bulge = this._computeBulgeFromPoint(point);
    } else {
      /* picking-end 阶段：使用吸附后的坐标更新终点 */
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
      /* 确定起点 */
      this._startPoint = point;
      this._state = 'picking-end';
      this._showStartMarker(point);
      this._notify();
    } else if (this._state === 'picking-end') {
      /* 确定终点，创建墙体 */
      this._endPoint = point;
      this._createStraightWallByHistory(this._startPoint!, this._endPoint);
      this._clearPreview();

      /* 连续模式：终点变为下一段起点 */
      if (this._continuous) {
        this._startPoint = point;
        this._clearStartMarker();
        this._showStartMarker(point);
        /* 保持 picking-end 状态 */
      } else {
        this._startPoint = null;
        this._endPoint = null;
        this._state = 'picking-start';
        this._clearStartMarker();
      }

      this._notify();
    }
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
      /* 第二次点击确定梁中心线终点并创建梁。 */
      this._endPoint = point;
      this._createBeamByHistory(this._startPoint!, this._endPoint);
      this._clearPreview();

      if (this._continuous) {
        this._startPoint = point;
        this._clearStartMarker();
        this._showStartMarker(point);
      } else {
        this._startPoint = null;
        this._endPoint = null;
        this._state = 'picking-start';
        this._clearStartMarker();
      }

      this._notify();
    }
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
      this._state = 'picking-bulge';
      this._notify();
    } else if (this._state === 'picking-bulge') {
      /* 第三步：根据鼠标到弦线的距离计算 bulge，创建弧形墙 */
      this._bulge = this._computeBulgeFromPoint(point);

      /* 使用弧形墙创建方法 */
      const id: string = this._objectManager.createArcWall(
        this._startPoint!, this._endPoint!, this._bulge, this._thickness, this._height
      );
      console.log(`[WallDrawTool] 弧形墙已创建, id=${id}, bulge=${this._bulge.toFixed(3)}`);

      this._clearPreview();
      this._clearStartMarker();
      this._startPoint = null;
      this._endPoint = null;
      this._bulge = 0;
      this._state = 'picking-start';
      this._notify();
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
      this._endPoint = point;

      /* 创建矩形墙（四面直墙）并纳入历史栈 */
      this._rectDimRenderer.clearPreview();
      this._createRectWallByHistory(this._startPoint!, this._endPoint);

      this._clearPreview();
      this._clearStartMarker();
      this._startPoint = null;
      this._endPoint = null;
      // this._state = 'picking-start';
      // this._notify();
      this.deactivate();
    }
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
      this._rectDimRenderer.updatePreview(this._startPoint, this._endPoint);
    }
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

    if (result.snapped) {
      /* 捕获成功：显示绿色吸附标记，点捕获/线捕获/正交终点均使用同一视觉反馈。 */
      this._showSnapMarker(result.position);
      this._isSnapped = true;
      console.log(`[WallDrawTool] 平面捕获(${result.type}): (${result.position.x.toFixed(3)}, ${result.position.z.toFixed(3)})`);
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
   * @returns 直墙/梁第二点阶段的起点；其他阶段返回 null
   */
  private _getOrthogonalAnchor(): Point2D | null {
    if (this._state !== 'picking-end') {
      return null;
    }
    if (this._startPoint === null) {
      return null;
    }
    if (this._mode !== 'straight-wall' && this._mode !== 'beam') {
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
    });
    this._snapMarker = new THREE.Mesh(ringGeom, ringMat);
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
   * @param start - 直墙起点
   * @param end - 直墙终点
   */
  private _createStraightWallByHistory(start: Point2D, end: Point2D): void {
    /* 墙体布置关键流程：用户绘制线视为墙内侧线，创建数据前转换为系统中心线。 */
    const centerLine: WallCenterLine = WallPlacementLineConverter.convertInnerLineToCenterLine(
      start,
      end,
      this._thickness
    );
    const wallData: StraightWallData = this._objectManager.createStraightWallData(
      centerLine.start,
      centerLine.end,
      this._thickness,
      this._height
    );

    if (this._historyManager !== null) {
      this._historyManager.execute(new StraightWallCreateCommand(this._objectManager, wallData));
      return;
    }

    /* 未注入历史管理器的兼容路径：保持旧版直接创建行为。 */
    this._objectManager.addObject(wallData);
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
    this._startPoint = null;
    this._endPoint = null;
    this._bulge = 0;
    this._state = 'picking-start';
    this._notify();
  }

  /**
   * 根据第三个点计算弧度因子
   */
  private _computeBulgeFromPoint(point: Point2D): number {
    if (this._startPoint === null || this._endPoint === null) return 0;

    /* 计算点到弦线的垂直距离 */
    const dx: number = this._endPoint.x - this._startPoint.x;
    const dz: number = this._endPoint.z - this._startPoint.z;
    const chordLen: number = Math.sqrt(dx * dx + dz * dz);

    if (chordLen < 0.001) return 0;

    /* 弦的法线 */
    const nx: number = -dz / chordLen;
    const nz: number = dx / chordLen;

    /* 点到起点的向量在法线方向的投影 */
    const vx: number = point.x - this._startPoint.x;
    const vz: number = point.z - this._startPoint.z;
    const dist: number = vx * nx + vz * nz;

    /* bulge = tan(angle/4) ≈ 4 * sagitta / chordLen（近似） */
    const sagitta: number = dist;
    const bulge: number = (4 * sagitta) / chordLen;

    return Math.max(-2, Math.min(2, bulge));
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
  }

  /* ========== 销毁 ========== */

  public dispose(): void {
    this.deactivate();
    this._previewMaterial.dispose();
    /* 释放墙/梁线式布置辅助虚线资源，避免工具销毁后残留隐藏对象。 */
    this._planarGuideRenderer.dispose();
    /* 释放矩形墙尺寸标注渲染器资源。 */
    this._rectDimRenderer.dispose();
    this._listeners.clear();
  }
}
