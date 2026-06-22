/**
 * 矩形墙绘制处理器。
 * 负责矩形墙两点布置、长宽键盘输入、预览几何和矩形墙历史命令创建。
 */

import * as THREE from 'three/webgpu';
import type { Point2D, RectWallData, StraightWallData } from '../BuildingTypes';
import { WallPlacementLineConverter } from '../WallPlacementLineConverter';
import type { ClockwiseRectInnerEdges, WallCenterLine } from '../WallPlacementLineConverter';
import { RectWallCreateCommand } from '../../history/commands/RectWallCreateCommand';
import { BeamDrawHandler } from './BeamDrawHandler';

export abstract class RectWallDrawHandler extends BeamDrawHandler {
  protected _handleRectWallClick(point: Point2D): void {
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
  protected _confirmRectWallPreview(): void {
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

  protected _handleRectPreviewDimensionKeyDown(event: KeyboardEvent): boolean {
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
  protected _canEditRectPreviewDimension(): boolean {
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
  protected _applyRectPreviewDimensionInput(): boolean {
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
  protected _toggleRectPreviewEditAxis(): void {
    this._rectPreviewEditAxis = this._rectPreviewEditAxis === 'horizontal' ? 'vertical' : 'horizontal';
    this._rectPreviewDimensionInput = '';
  }

  /**
   * 重置矩形墙预览尺寸编辑状态。
   * @param resetAxis - true 时一并恢复默认水平编辑轴；false 时仅清空输入和键盘驱动标记
   */
  protected _resetRectPreviewDimensionEdit(resetAxis: boolean): void {
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
  protected _getRectPreviewDimensionInputText(): string | null {
    if (this._rectPreviewDimensionInput.length === 0) {
      return null;
    }

    return this._rectPreviewDimensionInput;
  }

  protected _buildRectPreview(corner1: Point2D, corner2: Point2D): THREE.BufferGeometry {
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

  protected _createRectWallByHistory(corner1: Point2D, corner2: Point2D): void {
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
}
