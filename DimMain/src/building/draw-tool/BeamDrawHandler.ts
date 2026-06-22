/**
 * 梁绘制处理器。
 * 梁复用线性布置输入能力，但创建独立梁对象且不参与墙体拓扑连接。
 */

import type { BeamData, Point2D } from '../BuildingTypes';
import { BEAM_DEFAULTS } from '../BuildingTypes';
import { BeamCreateCommand } from '../../history/commands/BeamCreateCommand';
import { StraightWallDrawHandler } from './StraightWallDrawHandler';

export abstract class BeamDrawHandler extends StraightWallDrawHandler {
  protected _handleBeamClick(point: Point2D): void {
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
  protected _confirmBeamPreview(): void {
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

  protected _createBeamByHistory(start: Point2D, end: Point2D): void {
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
}
