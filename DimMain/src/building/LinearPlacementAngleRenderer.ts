/**
 * 线性布置角度标注渲染器。
 * 负责在直墙、梁等线性构件布置过程中，显示当前布置方向与水平方向的夹角标注。
 */

import * as THREE from 'three/webgpu';
import type { Point2D } from './BuildingTypes';
import type { SceneManager } from '../scene/SceneManager';
import { applyFixedScreenSpriteSize } from '../rendering/FixedScreenSpriteScaler';

/** 角度标注线颜色，沿用当前动态标注蓝色。 */
const ACTIVE_DIM_LINE_COLOR: number = 0x2f8df6;

/** 非当前编辑角度线颜色，匹配门窗距离动态标注灰色。 */
const INACTIVE_DIM_LINE_COLOR: number = 0x8f8f8f;

/** 动态角度标注所在高度，避免与地面和预览构件闪烁。 */
const PREVIEW_ANGLE_Y: number = 0.16;

/** 水平参考线长度，单位：米。 */
const HORIZONTAL_REFERENCE_LENGTH: number = 1.05;

/** 角度圆弧半径，单位：米。 */
const ANGLE_ARC_RADIUS: number = 0.56;

/** 角度圆弧分段数。 */
const ANGLE_ARC_SEGMENTS: number = 36;

/** 水平虚线短线长度，单位：米。 */
const DASH_LENGTH: number = 0.08;

/** 水平虚线间隔长度，单位：米。 */
const DASH_GAP: number = 0.05;

/** 圆弧末端刻度长度，单位：米。 */
const END_TICK_LENGTH: number = 0.12;

/** 标签相对圆弧半径的外扩距离，单位：米。 */
const LABEL_RADIUS_OFFSET: number = 0.3;

/** 标签画布尺寸，沿用项目动态标注比例。 */
const LABEL_CANVAS_W: number = 240;
const LABEL_CANVAS_H: number = 96;

/** 标签世界尺寸，沿用项目动态标注比例。 */
const LABEL_SPRITE_W: number = 0.72;
const LABEL_SPRITE_H: number = 0.288;

/** 动态标注标签样式。 */
const PREVIEW_BLUE: string = '#2f8df6';
const PREVIEW_ACTIVE_PANEL_BG: string = PREVIEW_BLUE;
const PREVIEW_PANEL_BG: string = 'rgba(255,255,255,0.94)';
const PREVIEW_LABEL_BORDER_COLOR: string = '#b8b8b8';
const PREVIEW_LABEL_TEXT_COLOR: string = '#333333';
const PREVIEW_ACTIVE_LABEL_TEXT_COLOR: string = '#ffffff';
const PREVIEW_LABEL_FONT_SIZE: number = 44;

/** 动态标注渲染层级。 */
const PREVIEW_LINE_RENDER_ORDER: number = 11004;
const PREVIEW_LABEL_RENDER_ORDER: number = 11005;

/** 最小有效布置长度，低于该值不显示角度标注。 */
const MIN_VALID_LENGTH: number = 0.1;

/** 弧度转角度系数。 */
const RAD_TO_DEG: number = 180 / Math.PI;

/** 线性布置角度标注句柄。 */
interface LinearPlacementAngleAnnotation {
  /** 角度文字 Sprite。 */
  sprite: THREE.Sprite;
  /** 水平虚线、角度弧线与端部刻度线。 */
  lines: THREE.LineSegments;
}

/** 线性布置相对水平轴的象限角度信息。 */
interface LinearPlacementAngleInfo {
  /** 参考水平轴角度：0 表示 +X，Math.PI 表示 -X。 */
  referenceAngle: number;
  /** 当前方向相对参考水平轴的有向夹角。 */
  signedDeltaAngle: number;
  /** 当前方向相对参考水平轴的绝对角度，单位为度。 */
  absoluteAngleDegrees: number;
}

/**
 * 绘制圆角矩形路径。
 * @param ctx - Canvas 2D 绘图上下文
 * @param x - 左上角 X
 * @param y - 左上角 Y
 * @param width - 宽度
 * @param height - 高度
 * @param radius - 圆角半径
 */
function drawRoundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const clampedRadius: number = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + clampedRadius, y);
  ctx.lineTo(x + width - clampedRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
  ctx.lineTo(x + width, y + height - clampedRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - clampedRadius, y + height);
  ctx.lineTo(x + clampedRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
  ctx.lineTo(x, y + clampedRadius);
  ctx.quadraticCurveTo(x, y, x + clampedRadius, y);
  ctx.closePath();
}

/**
 * 将角度归一化到 [-π, π]。
 * 关键流程：循环修正超过一圈的角度，确保象限角度差可稳定用于弧线插值。
 * @param angle - 待归一化弧度角
 * @returns 归一化后的弧度角
 */
function normalizeSignedAngle(angle: number): number {
  let normalizedAngle: number = angle;
  while (normalizedAngle > Math.PI) {
    normalizedAngle -= Math.PI * 2;
  }
  while (normalizedAngle <= -Math.PI) {
    normalizedAngle += Math.PI * 2;
  }
  return normalizedAngle;
}

/**
 * 计算线性布置相对所在半平面水平轴的角度信息。
 * 关键流程：1/4 象限以 +X 为基准，2/3 象限以 -X 为基准，保证角度弧线从墙梁末端所在侧的水平轴开始绘制。
 * @param dx - 布置方向 X 分量
 * @param dz - 布置方向 Z 分量
 * @returns 象限角度信息
 */
function computeLinearPlacementAngleInfo(dx: number, dz: number): LinearPlacementAngleInfo {
  const directionAngle: number = Math.atan2(dz, dx);
  const referenceAngle: number = dx < 0 ? Math.PI : 0;
  const signedDeltaAngle: number = normalizeSignedAngle(directionAngle - referenceAngle);
  const absoluteAngleDegrees: number = Math.abs(signedDeltaAngle) * RAD_TO_DEG;

  return {
    referenceAngle: referenceAngle,
    signedDeltaAngle: signedDeltaAngle,
    absoluteAngleDegrees: absoluteAngleDegrees,
  };
}

/**
 * 创建角度标签 Sprite。
 * @param valueText - 显示的角度文本
 * @param x - 世界坐标 X
 * @param z - 世界坐标 Z
 * @param active - 是否为当前 Tab 选中的编辑标注
 * @returns 标签 Sprite
 */
function createAngleLabelSprite(valueText: string, x: number, z: number, active: boolean = false): THREE.Sprite {
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = LABEL_CANVAS_W;
  canvas.height = LABEL_CANVAS_H;

  const ctx: CanvasRenderingContext2D = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, LABEL_CANVAS_W, LABEL_CANVAS_H);

  const panelX: number = 12;
  const panelY: number = 14;
  const panelW: number = LABEL_CANVAS_W - panelX * 2;
  const panelH: number = LABEL_CANVAS_H - panelY * 2;

  /* 标签绘制流程：当前编辑标签使用蓝底白字，非编辑标签使用白底灰框，遵循 Tab 切换标记规则。 */
  drawRoundRectPath(ctx, panelX, panelY, panelW, panelH, 10);
  ctx.fillStyle = active ? PREVIEW_ACTIVE_PANEL_BG : PREVIEW_PANEL_BG;
  ctx.fill();
  ctx.lineWidth = active ? 4 : 2;
  ctx.strokeStyle = active ? PREVIEW_BLUE : PREVIEW_LABEL_BORDER_COLOR;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${PREVIEW_LABEL_FONT_SIZE}px Arial, Microsoft YaHei, sans-serif`;
  ctx.fillStyle = active ? PREVIEW_ACTIVE_LABEL_TEXT_COLOR : PREVIEW_LABEL_TEXT_COLOR;
  ctx.fillText(valueText, LABEL_CANVAS_W / 2, LABEL_CANVAS_H / 2);

  const texture: THREE.CanvasTexture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material: THREE.SpriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite: THREE.Sprite = new THREE.Sprite(material);
  applyFixedScreenSpriteSize(sprite, LABEL_SPRITE_W, LABEL_SPRITE_H);
  sprite.position.set(x, PREVIEW_ANGLE_Y, z);
  sprite.renderOrder = PREVIEW_LABEL_RENDER_ORDER;

  return sprite;
}

/**
 * 向顶点数组追加一条 XZ 平面线段。
 * @param positions - 顶点数组
 * @param startX - 起点 X
 * @param startZ - 起点 Z
 * @param endX - 终点 X
 * @param endZ - 终点 Z
 */
function appendLineSegment(
  positions: number[],
  startX: number,
  startZ: number,
  endX: number,
  endZ: number
): void {
  positions.push(startX, PREVIEW_ANGLE_Y, startZ, endX, PREVIEW_ANGLE_Y, endZ);
}

/**
 * 创建水平虚线、角度圆弧与端部刻度线。
 * @param start - 标注圆心，即线性布置起点
 * @param angleInfo - 相对所在半平面水平轴的角度信息
 * @param active - 是否为当前 Tab 选中的编辑标注
 * @returns LineSegments
 */
function createAngleLines(start: Point2D, angleInfo: LinearPlacementAngleInfo, active: boolean = false): THREE.LineSegments {
  const positions: number[] = [];
  let cursor: number = 0;
  const referenceDirectionX: number = Math.cos(angleInfo.referenceAngle);
  const referenceDirectionZ: number = Math.sin(angleInfo.referenceAngle);

  /* 水平参考线绘制流程：根据末端所在半平面选择 +X 或 -X 方向，作为墙/梁方向夹角的基准。 */
  while (cursor < HORIZONTAL_REFERENCE_LENGTH) {
    const segmentEnd: number = Math.min(cursor + DASH_LENGTH, HORIZONTAL_REFERENCE_LENGTH);
    appendLineSegment(
      positions,
      start.x + referenceDirectionX * cursor,
      start.z + referenceDirectionZ * cursor,
      start.x + referenceDirectionX * segmentEnd,
      start.z + referenceDirectionZ * segmentEnd
    );
    cursor += DASH_LENGTH + DASH_GAP;
  }

  const absoluteAngle: number = Math.abs(angleInfo.signedDeltaAngle);
  const safeArcAngle: number = Math.max(absoluteAngle, Math.PI / 180);
  const segmentCount: number = Math.max(2, Math.ceil((safeArcAngle / (Math.PI / 2)) * ANGLE_ARC_SEGMENTS));
  const signedSafeDeltaAngle: number = angleInfo.signedDeltaAngle >= 0 ? safeArcAngle : -safeArcAngle;

  /* 圆弧绘制流程：从当前象限的水平参考线开始，沿墙/梁末端节点所在侧生成夹角圆弧。 */
  for (let index: number = 0; index < segmentCount; index += 1) {
    const angleA: number = angleInfo.referenceAngle + signedSafeDeltaAngle * (index / segmentCount);
    const angleB: number = angleInfo.referenceAngle + signedSafeDeltaAngle * ((index + 1) / segmentCount);
    appendLineSegment(
      positions,
      start.x + Math.cos(angleA) * ANGLE_ARC_RADIUS,
      start.z + Math.sin(angleA) * ANGLE_ARC_RADIUS,
      start.x + Math.cos(angleB) * ANGLE_ARC_RADIUS,
      start.z + Math.sin(angleB) * ANGLE_ARC_RADIUS
    );
  }

  const endAngle: number = angleInfo.referenceAngle + signedSafeDeltaAngle;
  const endX: number = start.x + Math.cos(endAngle) * ANGLE_ARC_RADIUS;
  const endZ: number = start.z + Math.sin(endAngle) * ANGLE_ARC_RADIUS;
  const tangentX: number = -Math.sin(endAngle);
  const tangentZ: number = Math.cos(endAngle);
  const halfTickLength: number = END_TICK_LENGTH / 2;

  /* 端部刻度绘制流程：在圆弧末端添加短刻度，贴近示意图中的 CAD 角度标注形式。 */
  appendLineSegment(
    positions,
    endX - tangentX * halfTickLength,
    endZ - tangentZ * halfTickLength,
    endX + tangentX * halfTickLength,
    endZ + tangentZ * halfTickLength
  );

  const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const material: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
    color: active ? ACTIVE_DIM_LINE_COLOR : INACTIVE_DIM_LINE_COLOR,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.95,
  });

  const lines: THREE.LineSegments = new THREE.LineSegments(geometry, material);
  lines.renderOrder = PREVIEW_LINE_RENDER_ORDER;

  return lines;
}

/**
 * 释放 Sprite 占用的 GPU 资源。
 * @param sprite - 要释放的 Sprite
 */
function disposeSprite(sprite: THREE.Sprite): void {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}

/**
 * 释放 LineSegments 占用的 GPU 资源。
 * @param lines - 要释放的 LineSegments
 */
function disposeLines(lines: THREE.LineSegments): void {
  lines.geometry.dispose();
  (lines.material as THREE.Material).dispose();
}

/**
 * 线性布置角度标注渲染器。
 */
export class LinearPlacementAngleRenderer {
  /** 场景管理器。 */
  private _sceneManager: SceneManager;

  /** 当前预览角度标注。 */
  private _previewAnnotation: LinearPlacementAngleAnnotation | null = null;

  /** 当前可见性。 */
  private _visible: boolean = true;

  /**
   * @param sceneManager - 场景管理器
   */
  constructor(sceneManager: SceneManager) {
    this._sceneManager = sceneManager;
  }

  /**
   * 更新线性布置角度标注。
   * 关键流程：以布置起点为圆心绘制水平虚线基准、夹角圆弧和角度文本。
   * @param start - 线性布置起点
   * @param end - 线性布置当前终点
   * @param inputText - 角度键盘输入文本；为空时显示真实角度
   * @param active - 是否为当前 Tab 选中的编辑标注
   */
  public updatePreview(start: Point2D, end: Point2D, inputText: string | null = null, active: boolean = false): void {
    this.clearPreview();

    const dx: number = end.x - start.x;
    const dz: number = end.z - start.z;
    const length: number = Math.sqrt(dx * dx + dz * dz);
    if (length < MIN_VALID_LENGTH) {
      return;
    }

    const angleInfo: LinearPlacementAngleInfo = computeLinearPlacementAngleInfo(dx, dz);
    const angleDegrees: number = angleInfo.absoluteAngleDegrees;
    const labelText: string = inputText !== null ? `${inputText}°` : `${angleDegrees.toFixed(1)}°`;
    const labelAngle: number = angleInfo.referenceAngle + angleInfo.signedDeltaAngle / 2;
    const labelRadius: number = ANGLE_ARC_RADIUS + LABEL_RADIUS_OFFSET;
    const labelX: number = start.x + Math.cos(labelAngle) * labelRadius;
    const labelZ: number = start.z + Math.sin(labelAngle) * labelRadius;

    /* 标注创建流程：先创建水平虚线/圆弧，再创建角度标签，二者作为同一预览句柄管理。 */
    const lines: THREE.LineSegments = createAngleLines(start, angleInfo, active);
    const sprite: THREE.Sprite = createAngleLabelSprite(labelText, labelX, labelZ, active);
    lines.visible = this._visible;
    sprite.visible = this._visible;
    this._sceneManager.add(lines);
    this._sceneManager.add(sprite);
    this._previewAnnotation = { sprite: sprite, lines: lines };
  }

  /**
   * 清除当前动态角度标注。
   */
  public clearPreview(): void {
    if (this._previewAnnotation === null) {
      return;
    }

    const scene: THREE.Scene = this._sceneManager.getScene();
    scene.remove(this._previewAnnotation.sprite);
    scene.remove(this._previewAnnotation.lines);
    disposeSprite(this._previewAnnotation.sprite);
    disposeLines(this._previewAnnotation.lines);
    this._previewAnnotation = null;
  }

  /**
   * 设置动态角度标注可见性。
   * @param visible - true 显示，false 隐藏
   */
  public setVisible(visible: boolean): void {
    this._visible = visible;
    if (this._previewAnnotation !== null) {
      this._previewAnnotation.sprite.visible = visible;
      this._previewAnnotation.lines.visible = visible;
    }
  }

  /**
   * 释放渲染资源。
   */
  public dispose(): void {
    this.clearPreview();
  }
}