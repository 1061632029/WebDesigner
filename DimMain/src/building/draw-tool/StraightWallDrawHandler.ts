/**
 * 直墙绘制处理器。
 * 负责连续直墙、闭合直墙轮廓和直墙历史命令创建逻辑。
 */

import type { ArcWallData, BuildingObject, Point2D, StraightWallData } from '../BuildingTypes';
import { SNAP_THRESHOLD } from '../BuildingTypes';
import { WallPlacementLineConverter } from '../WallPlacementLineConverter';
import type { WallCenterLine } from '../WallPlacementLineConverter';
import { StraightWallCreateCommand } from '../../history/commands/StraightWallCreateCommand';
import { ConnectedStraightWallCreateCommand } from '../../history/commands/ConnectedStraightWallCreateCommand';
import type { PreviousStraightWallEndpointUpdate } from '../../history/commands/ConnectedStraightWallCreateCommand';
import { ClosedStraightWallLoopCreateCommand } from '../../history/commands/ClosedStraightWallLoopCreateCommand';
import type { ClosedLoopStraightWallUpdate } from '../../history/commands/ClosedStraightWallLoopCreateCommand';
import { WallDrawToolCore } from './WallDrawToolCore';

export abstract class StraightWallDrawHandler extends WallDrawToolCore {
  protected _handleStraightWallClick(point: Point2D): void {
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
  protected _confirmStraightWallPreview(): void {
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

  protected _handleStraightPreviewDimensionKeyDown(event: KeyboardEvent): boolean {
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
  protected _canEditStraightPreviewDimension(): boolean {
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
  protected _applyStraightPreviewDimensionInput(): boolean {
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
  protected _applyLinearPreviewLengthInput(): boolean {
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
  protected _applyLinearPreviewAngleInput(): boolean {
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
  protected _toggleLinearPreviewEditTarget(): void {
    this._linearPreviewEditTarget = this._linearPreviewEditTarget === 'length' ? 'angle' : 'length';
  }

  /** 删除墙/梁线性布置当前输入缓冲的最后一位。 */
  protected _removeLinearPreviewInputLastChar(): void {
    if (this._linearPreviewEditTarget === 'length' && this._straightPreviewDimensionInput.length > 0) {
      this._straightPreviewDimensionInput = this._straightPreviewDimensionInput.slice(0, -1);
    } else if (this._linearPreviewEditTarget === 'angle' && this._linearPreviewAngleInput.length > 0) {
      this._linearPreviewAngleInput = this._linearPreviewAngleInput.slice(0, -1);
    }
    this._updatePreview();
    this._notify();
  }

  /** 清空墙/梁线性布置当前编辑标注的输入缓冲。 */
  protected _clearLinearPreviewActiveInput(): void {
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
  protected _resetStraightPreviewDimensionEdit(): void {
    this._linearPreviewEditTarget = 'length';
    this._straightPreviewDimensionInput = '';
    this._linearPreviewAngleInput = '';
    this._straightPreviewKeyboardSized = false;
  }

  /**
   * 获取直墙当前输入显示文本。
   * @returns 有输入时返回毫米文本；无输入时返回 null 以显示真实尺寸
   */
  protected _getStraightPreviewDimensionInputText(): string | null {
    if (this._straightPreviewDimensionInput.length === 0) {
      return null;
    }

    return this._straightPreviewDimensionInput;
  }

  /** @returns 墙/梁线性布置角度输入显示文本。 */
  protected _getLinearPreviewAngleInputText(): string | null {
    return this._linearPreviewAngleInput.length > 0 ? this._linearPreviewAngleInput : null;
  }

  protected _createStraightWallByHistory(previousStart: Point2D | null, start: Point2D, end: Point2D): string {
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
  protected _resolveStraightClosedLoopEndPoint(end: Point2D): Point2D | null {
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
  protected _createClosedStraightWallLoopByHistory(start: Point2D, end: Point2D): string {
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
  protected _arePointsNearlyEqual(pointA: Point2D, pointB: Point2D): boolean {
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
  protected _createPreviousStraightWallEndpointUpdate(
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
  protected _findStraightWallById(wallId: string): StraightWallData | null {
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
  protected _findArcWallById(wallId: string): ArcWallData | null {
    const allObjects: BuildingObject[] = this._objectManager.getAll();
    for (const object of allObjects) {
      if (object.id === wallId && object.category === 'wall' && object.subType === 'arc') {
        return object as ArcWallData;
      }
    }

    return null;
  }
}
