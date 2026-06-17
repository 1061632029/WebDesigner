/**
 * 直墙布置动态尺寸标注渲染器。
 * 负责在线式直墙绘制过程中显示长度尺寸线与可编辑尺寸标签，样式保持与项目动态标注一致。
 */

import * as THREE from 'three/webgpu';
import type { Point2D } from './BuildingTypes';
import type { SceneManager } from '../scene/SceneManager';
import { applyFixedScreenSpriteSize } from '../rendering/FixedScreenSpriteScaler';

/** 当前可编辑尺寸颜色，匹配矩形墙动态标注蓝色。 */
const ACTIVE_DIM_LINE_COLOR: number = 0x2f8df6;

/** 动态标注所在高度，避免与地面和墙体预览闪烁。 */
const PREVIEW_DIMENSION_Y: number = 0.13;

/** 标注线相对墙绘制内侧线的法向偏移，单位：米。 */
const DIMENSION_OFFSET: number = 0.42;

/** 端部界线高度，单位：米。 */
const TICK_HEIGHT: number = 0.16;

/** 标签画布尺寸，沿用矩形墙/门窗动态标注比例。 */
const LABEL_CANVAS_W: number = 240;
const LABEL_CANVAS_H: number = 96;

/** 标签世界尺寸，沿用矩形墙/门窗动态标注比例。 */
const LABEL_SPRITE_W: number = 0.72;
const LABEL_SPRITE_H: number = 0.288;

/** 动态标注标签样式。 */
const PREVIEW_BLUE: string = '#2f8df6';
const PREVIEW_PANEL_BG: string = PREVIEW_BLUE;
const PREVIEW_LABEL_TEXT_COLOR: string = '#ffffff';
const PREVIEW_LABEL_FONT_SIZE: number = 44;

/** 动态标注渲染层级。 */
const PREVIEW_LINE_RENDER_ORDER: number = 11002;
const PREVIEW_LABEL_RENDER_ORDER: number = 11003;

/** 直墙动态尺寸标注句柄。 */
interface StraightWallPreviewAnnotation {
  /** 尺寸文字 Sprite。 */
  sprite: THREE.Sprite;
  /** 尺寸线与端部界线。 */
  lines: THREE.LineSegments;
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
 * 创建直墙布置距离标签 Sprite。
 * @param valueText - 显示的毫米尺寸文本
 * @param x - 世界坐标 X
 * @param z - 世界坐标 Z
 * @returns 标签 Sprite
 */
function createDistanceLabelSprite(valueText: string, x: number, z: number): THREE.Sprite {
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = LABEL_CANVAS_W;
  canvas.height = LABEL_CANVAS_H;

  const ctx: CanvasRenderingContext2D = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, LABEL_CANVAS_W, LABEL_CANVAS_H);

  const panelX: number = 12;
  const panelY: number = 14;
  const panelW: number = LABEL_CANVAS_W - panelX * 2;
  const panelH: number = LABEL_CANVAS_H - panelY * 2;

  /* 标签绘制流程：直墙布置尺寸始终可编辑，使用蓝底白字提示可直接输入长度。 */
  drawRoundRectPath(ctx, panelX, panelY, panelW, panelH, 10);
  ctx.fillStyle = PREVIEW_PANEL_BG;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = PREVIEW_BLUE;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${PREVIEW_LABEL_FONT_SIZE}px Arial, Microsoft YaHei, sans-serif`;
  ctx.fillStyle = PREVIEW_LABEL_TEXT_COLOR;
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
  sprite.position.set(x, PREVIEW_DIMENSION_Y, z);
  sprite.renderOrder = PREVIEW_LABEL_RENDER_ORDER;

  return sprite;
}

/**
 * 创建任意方向直墙尺寸线。
 * @param start - 尺寸线起点
 * @param end - 尺寸线终点
 * @param normalX - 端部界线方向 X
 * @param normalZ - 端部界线方向 Z
 * @returns LineSegments
 */
function createStraightDimLine(
  start: Point2D,
  end: Point2D,
  normalX: number,
  normalZ: number
): THREE.LineSegments {
  const halfTick: number = TICK_HEIGHT / 2;
  const startTickA: Point2D = { x: start.x - normalX * halfTick, z: start.z - normalZ * halfTick };
  const startTickB: Point2D = { x: start.x + normalX * halfTick, z: start.z + normalZ * halfTick };
  const endTickA: Point2D = { x: end.x - normalX * halfTick, z: end.z - normalZ * halfTick };
  const endTickB: Point2D = { x: end.x + normalX * halfTick, z: end.z + normalZ * halfTick };

  /* 尺寸线顶点流程：起点端部界线、主尺寸线、终点端部界线。 */
  const positions: Float32Array = new Float32Array([
    startTickA.x, PREVIEW_DIMENSION_Y, startTickA.z, startTickB.x, PREVIEW_DIMENSION_Y, startTickB.z,
    start.x, PREVIEW_DIMENSION_Y, start.z, end.x, PREVIEW_DIMENSION_Y, end.z,
    endTickA.x, PREVIEW_DIMENSION_Y, endTickA.z, endTickB.x, PREVIEW_DIMENSION_Y, endTickB.z,
  ]);

  const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const material: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
    color: ACTIVE_DIM_LINE_COLOR,
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
 * 直墙布置动态尺寸标注渲染器。
 */
export class StraightWallDimensionRenderer {
  /** 场景管理器。 */
  private _sceneManager: SceneManager;

  /** 当前预览标注。 */
  private _previewAnnotation: StraightWallPreviewAnnotation | null = null;

  /** 当前可见性。 */
  private _visible: boolean = true;

  /**
   * @param sceneManager - 场景管理器
   */
  constructor(sceneManager: SceneManager) {
    this._sceneManager = sceneManager;
  }

  /**
   * 更新直墙动态尺寸标注。
   * 关键流程：按直墙方向计算偏移后的尺寸线，并在中点显示当前毫米尺寸或键盘输入文本。
   * @param start - 直墙绘制起点（内侧线起点）
   * @param end - 直墙当前终点（内侧线终点）
   * @param inputText - 键盘输入文本；为空时显示真实长度毫米值
   */
  public updatePreview(start: Point2D, end: Point2D, inputText: string | null = null): void {
    this.clearPreview();

    const dx: number = end.x - start.x;
    const dz: number = end.z - start.z;
    const length: number = Math.sqrt(dx * dx + dz * dz);
    if (length < 0.1) {
      return;
    }

    const dirX: number = dx / length;
    const dirZ: number = dz / length;
    const normalX: number = -dirZ;
    const normalZ: number = dirX;

    const lineStart: Point2D = { x: start.x + normalX * DIMENSION_OFFSET, z: start.z + normalZ * DIMENSION_OFFSET };
    const lineEnd: Point2D = { x: end.x + normalX * DIMENSION_OFFSET, z: end.z + normalZ * DIMENSION_OFFSET };
    const labelX: number = (lineStart.x + lineEnd.x) / 2;
    const labelZ: number = (lineStart.z + lineEnd.z) / 2;

    const lengthMillimeters: number = Math.round(length * 1000);
    const labelText: string = inputText !== null ? inputText : `${lengthMillimeters}`;

    /* 标注创建流程：先创建尺寸线，再创建蓝底可编辑标签，二者作为同一预览句柄管理。 */
    const lines: THREE.LineSegments = createStraightDimLine(lineStart, lineEnd, normalX, normalZ);
    const sprite: THREE.Sprite = createDistanceLabelSprite(labelText, labelX, labelZ);
    lines.visible = this._visible;
    sprite.visible = this._visible;
    this._sceneManager.add(lines);
    this._sceneManager.add(sprite);
    this._previewAnnotation = { sprite: sprite, lines: lines };
  }

  /**
   * 清除当前动态尺寸标注。
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
   * 设置动态标注可见性。
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