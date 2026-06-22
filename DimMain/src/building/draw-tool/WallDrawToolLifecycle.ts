/**
 * 墙体绘制工具通用预览、吸附、生命周期与外部设置。
 * 该层只处理跨模型共享能力，具体对象创建逻辑保留在对应处理器内。
 */

import * as THREE from 'three/webgpu';
import type { BuildingObject, Point2D, StraightWallData } from '../BuildingTypes';
import { BEAM_DEFAULTS, SNAP_THRESHOLD } from '../BuildingTypes';
import { WallPlacementLineConverter } from '../WallPlacementLineConverter';
import type { WallCenterLine } from '../WallPlacementLineConverter';
import type { PlanarPlacementSnapResult, PlanarPlacementSnapType } from '../PlanarPlacementSnapTypes';
import type { DrawToolChangeCallback } from './WallDrawToolTypes';
import { ArcWallDrawHandler } from './ArcWallDrawHandler';

/** 捕获点标记最高渲染顺序，确保绿色圆圈显示在所有辅助标注和 2D 符号之上。 */
const SNAP_MARKER_RENDER_ORDER: number = 20000;

export class WallDrawToolLifecycle extends ArcWallDrawHandler {
  protected _updatePreview(): void {
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

  protected _clearPreview(): void {
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
  protected _showStartMarker(point: Point2D): void {
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
  protected _clearStartMarker(): void {
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
  protected _applySnap(rawPoint: Point2D): PlanarPlacementSnapResult {
    const orthogonalAnchor: Point2D | null = this._getOrthogonalAnchor();
    const guideHalfLength: number = this._computeViewGuideHalfLength();
    const result: PlanarPlacementSnapResult = this._planarSnapService.snap(
      rawPoint,
      SNAP_THRESHOLD,
      orthogonalAnchor,
      guideHalfLength,
      null,
      (snapType: PlanarPlacementSnapType): boolean => this._isSnapTypeEnabled(snapType)
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
   * 判断指定平面捕获类型是否启用。
   * @param snapType - 平面捕获类型
   * @returns 启用时返回 true
   */
  protected _isSnapTypeEnabled(snapType: PlanarPlacementSnapType): boolean {
    if (this._snapTypeEnabledReader === null) {
      return true;
    }

    return this._snapTypeEnabledReader(snapType);
  }

  /**
   * 计算横跨当前视图的辅助虚线半长
   * 关键流程：把画布四角投射到地面，使用地面包围盒对角线作为虚线半长；投射失败时使用安全兜底长度。
   * @returns 当前视图对应的辅助虚线半长，单位米
   */
  protected _computeViewGuideHalfLength(): number {
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
  protected _getOrthogonalAnchor(): Point2D | null {
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
  protected _showSnapMarker(point: Point2D): void {
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
  protected _clearSnapMarker(): void {
    if (this._snapMarker !== null) {
      this._sceneManager.remove(this._snapMarker);
      this._snapMarker.geometry.dispose();
      (this._snapMarker.material as THREE.Material).dispose();
      this._snapMarker = null;
    }
    this._isSnapped = false;
  }

  protected _cancelCurrentDraw(): void {
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

  protected _notify(): void {
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
    const selectedStraightWalls: StraightWallData[] = [];

    /* 选中直墙标注同步流程：根据选中 ID 查找直墙数据，只对直线墙显示长度尺寸与水平夹角。 */
    selectedWallIds.forEach((selectedWallId: string): void => {
      const selectedObject: BuildingObject | undefined = this._objectManager.getById(selectedWallId);
      if (selectedObject === undefined) {
        return;
      }
      if (selectedObject.category !== 'wall' || selectedObject.subType !== 'straight') {
        return;
      }

      selectedStraightWalls.push(selectedObject);
    });

    this._straightDimRenderer.updatePersistentForWalls(selectedStraightWalls);
    this._linearAngleRenderer.updatePersistentForWalls(selectedStraightWalls);
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
