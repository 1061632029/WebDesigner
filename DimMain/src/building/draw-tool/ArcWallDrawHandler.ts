/**
 * 弧形墙绘制处理器。
 * 负责弧形墙三点布置、半径/角度编辑、常驻标注拾取和弧墙历史命令创建。
 */

import * as THREE from 'three/webgpu';
import type { ArcWallData, BuildingObject, Point2D } from '../BuildingTypes';
import type { ArcWallDimensionPickResult } from '../ArcWallRadiusDimensionRenderer';
import { ArcWallCreateCommand } from '../../history/commands/ArcWallCreateCommand';
import { RectWallDrawHandler } from './RectWallDrawHandler';

export abstract class ArcWallDrawHandler extends RectWallDrawHandler {
  protected _pickArcWallDimensionLabel(clientX: number, clientY: number, camera: THREE.Camera): ArcWallDimensionPickResult | null {
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
  protected _enterArcWallDimensionEdit(picked: ArcWallDimensionPickResult): boolean {
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

  protected _handleArcWallClick(point: Point2D): void {
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

  protected _handleArcPreviewDimensionKeyDown(event: KeyboardEvent): boolean {
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
  protected _canEditArcPreviewDimension(): boolean {
    return this._mode === 'arc-wall'
      && this._state === 'picking-bulge'
      && this._startPoint !== null
      && this._endPoint !== null;
  }

  /**
   * 应用当前弧形墙半径或角度输入。
   * @returns true 表示当前输入已成功转换为 bulge
   */
  protected _applyArcPreviewDimensionInput(): boolean {
    if (this._arcPreviewEditTarget === 'radius') {
      return this._applyArcPreviewRadiusInput();
    }

    return this._applyArcPreviewAngleInput();
  }

  /**
   * 应用半径输入并重算 bulge。
   * @returns true 表示半径输入有效并已应用
   */
  protected _applyArcPreviewRadiusInput(): boolean {
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
  protected _applyArcPreviewAngleInput(): boolean {
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
  protected _confirmArcWallPreview(): void {
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
  protected _toggleArcPreviewEditTarget(): void {
    this._arcPreviewEditTarget = this._arcPreviewEditTarget === 'radius' ? 'angle' : 'radius';
  }

  /** 删除当前弧形墙输入缓冲的最后一位。 */
  protected _removeArcPreviewInputLastChar(): void {
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
  protected _updateArcWallPersistentDimension(wallData: ArcWallData): void {
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
  protected _clearArcPreviewActiveInput(): void {
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
  protected _resetArcPreviewDimensionEdit(resetTarget: boolean): void {
    if (resetTarget) {
      this._arcPreviewEditTarget = 'radius';
    }
    this._arcPreviewRadiusInput = '';
    this._arcPreviewAngleInput = '';
    this._arcPreviewKeyboardSized = false;
  }

  /** @returns 弧形墙半径输入显示文本。 */
  protected _getArcPreviewRadiusInputText(): string | null {
    return this._arcPreviewRadiusInput.length > 0 ? this._arcPreviewRadiusInput : null;
  }

  /** @returns 弧形墙角度输入显示文本。 */
  protected _getArcPreviewAngleInputText(): string | null {
    return this._arcPreviewAngleInput.length > 0 ? this._arcPreviewAngleInput : null;
  }

  /** @returns 当前弧形墙起终点弦长，单位米。 */
  protected _calculateArcPreviewChordLength(): number {
    if (this._startPoint === null || this._endPoint === null) {
      return 0;
    }
    const dx: number = this._endPoint.x - this._startPoint.x;
    const dz: number = this._endPoint.z - this._startPoint.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** @returns 当前弧形墙方向符号，未形成有效弧时默认使用逆时针方向。 */
  protected _getCurrentArcBulgeSign(): number {
    return this._bulge < 0 ? -1 : 1;
  }

  protected _findArcWallById(wallId: string): ArcWallData | null {
    const allObjects: BuildingObject[] = this._objectManager.getAll();
    for (const object of allObjects) {
      if (object.id === wallId && object.category === 'wall' && object.subType === 'arc') {
        return object as ArcWallData;
      }
    }

    return null;
  }

  protected _computeBulgeFromPoint(point: Point2D): number {
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
  protected _normalizePositiveAngle(angle: number): number {
    const fullCircle: number = Math.PI * 2;
    let normalizedAngle: number = angle % fullCircle;
    if (normalizedAngle < 0) {
      normalizedAngle += fullCircle;
    }
    return normalizedAngle;
  }
}
