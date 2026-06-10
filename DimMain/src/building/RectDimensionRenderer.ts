/**
 * 矩形墙尺寸标注渲染器（CAD 引线风格）
 * 负责在 2D 模式下为矩形墙绘制过程和完成后渲染尺寸标注
 *
 * 标注样式：
 * - 预览阶段：蓝色输入框样式，数值以毫米显示，贴近户型绘制过程中的尺寸输入提示
 * - 永久阶段：工程制图风格，纯文字 + 尺寸线
 *
 * 标注分两类：
 * 1. 预览标注（preview）：拖拽绘制过程中实时显示，包含面积 + 长宽
 * 2. 永久标注（persistent）：矩形墙确认创建后保留，包含楼板外边界总宽/总深 + 总面积
 *
 * 永久标注布局（楼板边界标注）：
 *   上边外侧一行：[←────楼板总宽────→]
 *   右边外侧一列：[↑────楼板总深────↓]
 *   矩形中心：楼板总面积
 */

import * as THREE from 'three/webgpu';
import type { Point2D } from './BuildingTypes';
import type { SceneManager } from '../scene/SceneManager';

/* ========== 样式常量 ========== */

/** 尺寸线颜色（深灰，CAD 风格） */
const DIM_LINE_COLOR: number = 0x555555;

/** 标注界线（端部竖线）高度（米） */
const TICK_HEIGHT: number = 0.12;

/** 标注偏移量（米）：尺寸线距离墙体外边缘的距离 */
const DIM_OFFSET: number = 0.5;

/** 文字 Sprite Canvas 尺寸 */
const TEXT_CANVAS_W: number = 160;
const TEXT_CANVAS_H: number = 48;

/** 文字 Sprite 世界尺寸（米） */
const TEXT_SPRITE_W: number = 1.6;
const TEXT_SPRITE_H: number = 0.48;

/** 面积文字 Sprite 世界尺寸（米） */
const AREA_SPRITE_W: number = 2.0;
const AREA_SPRITE_H: number = 0.6;

/** 预览输入框 Canvas 尺寸 */
const PREVIEW_INPUT_CANVAS_W: number = 300;
const PREVIEW_INPUT_CANVAS_H: number = 96;

/** 预览输入框 Sprite 世界尺寸（米） */
const PREVIEW_INPUT_SPRITE_W: number = 1.55;
const PREVIEW_INPUT_SPRITE_H: number = 0.5;

/** 预览面积 Canvas 尺寸 */
const PREVIEW_AREA_CANVAS_W: number = 260;
const PREVIEW_AREA_CANVAS_H: number = 82;

/** 预览面积 Sprite 世界尺寸（米） */
const PREVIEW_AREA_SPRITE_W: number = 1.9;
const PREVIEW_AREA_SPRITE_H: number = 0.6;

/** 预览标注距离矩形内边缘的偏移量，单位：米 */
const PREVIEW_INNER_LABEL_OFFSET: number = 0.34;

/** 预览标注颜色：蓝色边框与选中背景 */
const PREVIEW_BLUE: string = '#2f8df6';

/** 预览标注颜色：输入框背景 */
const PREVIEW_PANEL_BG: string = 'rgba(255, 255, 255, 0.96)';

/** 预览标注颜色：单位文字 */
const PREVIEW_UNIT_COLOR: string = '#9aa0a6';

/* ========== 辅助函数 ========== */

/**
 * 绘制圆角矩形路径
 * 关键流程：使用二次贝塞尔曲线连接四条边，兼容未声明 CanvasRenderingContext2D.roundRect 的环境。
 * @param ctx - Canvas 2D 绘图上下文
 * @param x - 矩形左上角 X
 * @param y - 矩形左上角 Y
 * @param width - 矩形宽度
 * @param height - 矩形高度
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
 * 创建矩形墙布置预览输入框 Sprite
 * 关键流程：绘制白色输入框、蓝色边框和被选中的数值区域，单位使用灰色文字显示。
 * @param valueText - 数值文本，单位为毫米
 * @param x - 世界坐标 X
 * @param z - 世界坐标 Z
 * @param rotation - SpriteMaterial 屏幕旋转角度，垂直标注传入 90 度
 * @returns THREE.Sprite
 */
function createPreviewInputSprite(
  valueText: string,
  x: number,
  z: number,
  rotation: number = 0
): THREE.Sprite {
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = PREVIEW_INPUT_CANVAS_W;
  canvas.height = PREVIEW_INPUT_CANVAS_H;

  const ctx: CanvasRenderingContext2D = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, PREVIEW_INPUT_CANVAS_W, PREVIEW_INPUT_CANVAS_H);

  const panelX: number = 18;
  const panelY: number = 12;
  const panelW: number = PREVIEW_INPUT_CANVAS_W - panelX * 2;
  const panelH: number = PREVIEW_INPUT_CANVAS_H - panelY * 2;

  /* 绘制输入框外观：白底、蓝色边框、轻微阴影，匹配截图中的尺寸输入提示。 */
  ctx.shadowColor = 'rgba(36, 120, 220, 0.28)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;
  drawRoundRectPath(ctx, panelX, panelY, panelW, panelH, 6);
  ctx.fillStyle = PREVIEW_PANEL_BG;
  ctx.fill();
  ctx.shadowColor = 'rgba(0, 0, 0, 0)';
  ctx.lineWidth = 4;
  ctx.strokeStyle = PREVIEW_BLUE;
  ctx.stroke();

  ctx.font = 'bold 38px Arial, sans-serif';
  const valueMetrics: TextMetrics = ctx.measureText(valueText);
  const valueW: number = Math.ceil(valueMetrics.width) + 20;
  const valueH: number = 48;
  const unitText: string = 'mm';
  ctx.font = '30px Arial, sans-serif';
  const unitMetrics: TextMetrics = ctx.measureText(unitText);
  const unitW: number = Math.ceil(unitMetrics.width);
  const gapW: number = 16;
  const contentW: number = valueW + gapW + unitW;
  const startX: number = (PREVIEW_INPUT_CANVAS_W - contentW) / 2;
  const valueY: number = (PREVIEW_INPUT_CANVAS_H - valueH) / 2;

  /* 绘制蓝色选中区域：表示当前尺寸可输入调整。 */
  drawRoundRectPath(ctx, startX, valueY, valueW, valueH, 3);
  ctx.fillStyle = PREVIEW_BLUE;
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 38px Arial, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(valueText, startX + valueW / 2, PREVIEW_INPUT_CANVAS_H / 2 + 1);

  ctx.textAlign = 'left';
  ctx.font = '30px Arial, sans-serif';
  ctx.fillStyle = PREVIEW_UNIT_COLOR;
  ctx.fillText(unitText, startX + valueW + gapW, PREVIEW_INPUT_CANVAS_H / 2 + 2);

  const texture: THREE.CanvasTexture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material: THREE.SpriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  material.rotation = rotation;

  const sprite: THREE.Sprite = new THREE.Sprite(material);
  sprite.scale.set(PREVIEW_INPUT_SPRITE_W, PREVIEW_INPUT_SPRITE_H, 1.0);
  sprite.position.set(x, 0.09, z);
  sprite.renderOrder = 1003;

  return sprite;
}

/**
 * 创建矩形墙布置面积预览 Sprite
 * 关键流程：在矩形中心绘制轻量面积提示，随拖拽实时更新，不参与永久标注。
 * @param areaText - 面积文字，单位平方米
 * @param x - 世界坐标 X
 * @param z - 世界坐标 Z
 * @returns THREE.Sprite
 */
function createPreviewAreaSprite(areaText: string, x: number, z: number): THREE.Sprite {
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = PREVIEW_AREA_CANVAS_W;
  canvas.height = PREVIEW_AREA_CANVAS_H;

  const ctx: CanvasRenderingContext2D = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, PREVIEW_AREA_CANVAS_W, PREVIEW_AREA_CANVAS_H);

  const panelX: number = 18;
  const panelY: number = 12;
  const panelW: number = PREVIEW_AREA_CANVAS_W - panelX * 2;
  const panelH: number = PREVIEW_AREA_CANVAS_H - panelY * 2;

  /* 绘制面积预览底板：弱化背景但保持网格上可读。 */
  drawRoundRectPath(ctx, panelX, panelY, panelW, panelH, 8);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(47, 141, 246, 0.75)';
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 28px Arial, sans-serif';
  ctx.fillStyle = PREVIEW_BLUE;
  ctx.fillText(areaText, PREVIEW_AREA_CANVAS_W / 2, PREVIEW_AREA_CANVAS_H / 2 + 1);

  const texture: THREE.CanvasTexture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material: THREE.SpriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const sprite: THREE.Sprite = new THREE.Sprite(material);
  sprite.scale.set(PREVIEW_AREA_SPRITE_W, PREVIEW_AREA_SPRITE_H, 1.0);
  sprite.position.set(x, 0.08, z);
  sprite.renderOrder = 1002;

  return sprite;
}

/**
 * 创建纯文字 Sprite（无背景框，CAD 风格）
 *
 * @param text - 标注文字
 * @param x - 世界坐标 X
 * @param z - 世界坐标 Z
 * @param isArea - 是否为面积标注（字号较大）
 * @returns THREE.Sprite
 */
function createTextSprite(
  text: string,
  x: number,
  z: number,
  isArea: boolean = false
): THREE.Sprite {
  const cw: number = isArea ? 256 : TEXT_CANVAS_W;
  const ch: number = isArea ? 64 : TEXT_CANVAS_H;

  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;

  const ctx: CanvasRenderingContext2D = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, cw, ch);

  /* 文字样式：无背景，深灰色 */
  const fontSize: number = isArea ? 28 : 22;

  ctx.fillStyle = '#e81313ff';
  ctx.font = `${fontSize}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cw / 2, ch / 2);

  const texture: THREE.CanvasTexture = new THREE.CanvasTexture(canvas);
  const material: THREE.SpriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });

  const sprite: THREE.Sprite = new THREE.Sprite(material);

  if (isArea) {
    sprite.scale.set(AREA_SPRITE_W, AREA_SPRITE_H, 1.0);
  } else {
    sprite.scale.set(TEXT_SPRITE_W, TEXT_SPRITE_H, 1.0);
  }

  sprite.position.set(x, 0.05, z);
  sprite.renderOrder = 999;

  return sprite;
}

/**
 * 创建水平尺寸线（含两端标注界线）
 * 尺寸线在 XZ 平面上，Y = yLevel
 *
 * 结构：
 *   左端竖线（x1, z）：从 zTickStart 延伸到 zTickEnd
 *   水平线（x1 → x2, z）
 *   右端竖线（x2, z）：从 zTickStart 延伸到 zTickEnd
 *
 * @param x1 - 左端 X
 * @param x2 - 右端 X
 * @param z - Z 坐标（尺寸线所在行）
 * @param color - 线颜色
 * @param zTickStart - 标注界线起始 Z（默认 z - halfTick）
 * @param zTickEnd - 标注界线终止 Z（默认 z + halfTick）
 * @returns THREE.LineSegments
 */
function createHorizontalDimLine(
  x1: number,
  x2: number,
  z: number,
  color: number = DIM_LINE_COLOR,
  zTickStart?: number,
  zTickEnd?: number
): THREE.LineSegments {
  const halfTick: number = TICK_HEIGHT / 2;
  /* 标注界线范围：未指定时使用默认短竖线 */
  const tickZ1: number = zTickStart ?? (z - halfTick);
  const tickZ2: number = zTickEnd ?? (z + halfTick);

  /* 顶点：左竖线起 → 左竖线终，水平线左 → 水平线右，右竖线起 → 右竖线终 */
  const positions: Float32Array = new Float32Array([
    x1, 0.02, tickZ1,  x1, 0.02, tickZ2,  /* 左端标注界线 */
    x1, 0.02, z,       x2, 0.02, z,        /* 水平尺寸线 */
    x2, 0.02, tickZ1,  x2, 0.02, tickZ2,  /* 右端标注界线 */
  ]);

  const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const material: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
    color: color,
    depthTest: false,
  });

  const lines: THREE.LineSegments = new THREE.LineSegments(geometry, material);
  lines.renderOrder = 998;

  return lines;
}

/**
 * 创建垂直尺寸线（含两端标注界线）
 * 尺寸线在 XZ 平面上，X = xLevel
 *
 * 结构：
 *   上端横线（x, z1）：从 xTickStart 延伸到 xTickEnd
 *   垂直线（z1 → z2, x）
 *   下端横线（x, z2）：从 xTickStart 延伸到 xTickEnd
 *
 * @param z1 - 上端 Z（较小值）
 * @param z2 - 下端 Z（较大值）
 * @param x - X 坐标（尺寸线所在列）
 * @param color - 线颜色
 * @param xTickStart - 标注界线起始 X（默认 x - halfTick）
 * @param xTickEnd - 标注界线终止 X（默认 x + halfTick）
 * @returns THREE.LineSegments
 */
function createVerticalDimLine(
  z1: number,
  z2: number,
  x: number,
  color: number = DIM_LINE_COLOR,
  xTickStart?: number,
  xTickEnd?: number
): THREE.LineSegments {
  const halfTick: number = TICK_HEIGHT / 2;
  /* 标注界线范围：未指定时使用默认短横线 */
  const tickX1: number = xTickStart ?? (x - halfTick);
  const tickX2: number = xTickEnd ?? (x + halfTick);

  /* 顶点：上端横线起 → 上端横线终，垂直线上 → 垂直线下，下端横线起 → 下端横线终 */
  const positions: Float32Array = new Float32Array([
    tickX1, 0.02, z1,  tickX2, 0.02, z1,  /* 上端标注界线 */
    x, 0.02, z1,       x, 0.02, z2,        /* 垂直尺寸线 */
    tickX1, 0.02, z2,  tickX2, 0.02, z2,  /* 下端标注界线 */
  ]);

  const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const material: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
    color: color,
    depthTest: false,
  });

  const lines: THREE.LineSegments = new THREE.LineSegments(geometry, material);
  lines.renderOrder = 998;

  return lines;
}

/**
 * 释放 Sprite 占用的 GPU 资源
 * @param sprite - 要释放的 Sprite
 */
function disposeSprite(sprite: THREE.Sprite): void {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}

/**
 * 释放 LineSegments 占用的 GPU 资源
 * @param lines - 要释放的 LineSegments
 */
function disposeLines(lines: THREE.LineSegments): void {
  lines.geometry.dispose();
  (lines.material as THREE.Material).dispose();
}

/* ========== 标注组类型 ========== */

/**
 * 一组尺寸标注（文字 Sprite + 尺寸线 LineSegments）
 */
interface DimAnnotation {
  /** 文字 Sprite */
  sprite: THREE.Sprite;
  /** 尺寸线 LineSegments */
  lines: THREE.LineSegments;
}

/**
 * 单个矩形墙永久标注句柄
 * 用于命令撤销时精确移除对应矩形墙的面积与尺寸标注。
 */
export interface RectDimensionHandle {
  /** 面积文字 Sprite */
  areaSprite: THREE.Sprite;
  /** 长宽尺寸标注集合 */
  annotations: DimAnnotation[];
}

/* ========== 主类 ========== */

/**
 * 矩形墙尺寸标注渲染器（CAD 引线风格）
 *
 * 使用方式：
 * - 预览阶段：每次 mousemove 调用 updatePreview(corner1, corner2)
 * - 预览清除：调用 clearPreview()
 * - 确认创建：调用 createPersistent(corner1, corner2, thickness)
 * - 销毁：调用 dispose()
 */
export class RectDimensionRenderer {
  /** 场景管理器 */
  private _sceneManager: SceneManager;

  /** 预览标注列表（面积 + 长 + 宽） */
  private _previewAnnotations: DimAnnotation[] = [];
  /** 预览输入框标注列表（无尺寸线，绘制过程中使用） */
  private _previewInputSprites: THREE.Sprite[] = [];
  /** 预览面积 Sprite（单独管理，无尺寸线） */
  private _previewAreaSprite: THREE.Sprite | null = null;

  /** 永久标注列表（所有已确认矩形墙的标注） */
  private _persistentAnnotations: DimAnnotation[] = [];
  /** 永久面积 Sprite 列表 */
  private _persistentAreaSprites: THREE.Sprite[] = [];

  constructor(sceneManager: SceneManager) {
    this._sceneManager = sceneManager;
  }

  /**
   * 更新预览标注
   * 在矩形墙拖拽绘制过程中实时调用
   * 显示：面积（中心）+ 长度（矩形内上边）+ 宽度（矩形内左边）
   *
   * @param corner1 - 矩形对角点 1（起点）
   * @param corner2 - 矩形对角点 2（当前鼠标位置）
   */
  public updatePreview(corner1: Point2D, corner2: Point2D): void {
    this.clearPreview();

    const minX: number = Math.min(corner1.x, corner2.x);
    const maxX: number = Math.max(corner1.x, corner2.x);
    const minZ: number = Math.min(corner1.z, corner2.z);
    const maxZ: number = Math.max(corner1.z, corner2.z);

    const width: number = maxX - minX;
    const depth: number = maxZ - minZ;

    if (width < 0.1 || depth < 0.1) {
      return;
    }

    const centerX: number = (minX + maxX) / 2;
    const centerZ: number = (minZ + maxZ) / 2;

    /* 面积标注：矩形中心显示当前围合面积。 */
    const area: number = width * depth;
    const areaSprite: THREE.Sprite = createPreviewAreaSprite(`${area.toFixed(2)} m²`, centerX, centerZ);
    this._sceneManager.add(areaSprite);
    this._previewAreaSprite = areaSprite;

    /* 长度输入框：沿矩形上边内侧居中显示，数值使用毫米整数。 */
    const widthMillimeters: number = Math.round(width * 1000);
    const widthLabelZ: number = minZ + Math.min(PREVIEW_INNER_LABEL_OFFSET, depth * 0.35);
    const widthSprite: THREE.Sprite = createPreviewInputSprite(`${widthMillimeters}`, centerX, widthLabelZ);
    this._sceneManager.add(widthSprite);
    this._previewInputSprites.push(widthSprite);

    /* 宽度输入框：沿矩形左边内侧居中显示，并旋转为竖向标注。 */
    const depthMillimeters: number = Math.round(depth * 1000);
    const depthLabelX: number = minX + Math.min(PREVIEW_INNER_LABEL_OFFSET, width * 0.35);
    const depthSprite: THREE.Sprite = createPreviewInputSprite(`${depthMillimeters}`, depthLabelX, centerZ, Math.PI / 2);
    this._sceneManager.add(depthSprite);
    this._previewInputSprites.push(depthSprite);
  }

  /**
   * 清除所有预览标注
   */
  public clearPreview(): void {
    const scene: THREE.Scene = this._sceneManager.getScene();

    /* 清除面积 Sprite */
    if (this._previewAreaSprite !== null) {
      scene.remove(this._previewAreaSprite);
      disposeSprite(this._previewAreaSprite);
      this._previewAreaSprite = null;
    }

    /* 清除尺寸线 + 文字 */
    for (const ann of this._previewAnnotations) {
      scene.remove(ann.sprite);
      scene.remove(ann.lines);
      disposeSprite(ann.sprite);
      disposeLines(ann.lines);
    }
    this._previewAnnotations = [];

    /* 清除预览输入框 Sprite：该类标注没有尺寸线，仅释放文字纹理与材质。 */
    for (const sprite of this._previewInputSprites) {
      scene.remove(sprite);
      disposeSprite(sprite);
    }
    this._previewInputSprites = [];
  }

  /**
   * 创建永久标注
   * 矩形墙确认创建后调用，标注永久保留在场景中
   *
   * 永久标注布局（楼板边界标注）：
   *
   * 上边外侧一行（Z = minZ - DIM_OFFSET）：
   *   [←────楼板总宽────→]  （minX → maxX）
   *
   * 右边外侧一列（X = maxX + DIM_OFFSET）：
   *   [↑────楼板总深────↓]  （minZ → maxZ）
   *
   * 中心：楼板总面积
   *
   * @param corner1 - 矩形对角点 1
   * @param corner2 - 矩形对角点 2
   * @param thickness - 墙体厚度（米，保留参数，暂不用于标注）
   */
  public createPersistent(corner1: Point2D, corner2: Point2D, _thickness: number): RectDimensionHandle | null {
    const minX: number = Math.min(corner1.x, corner2.x);
    const maxX: number = Math.max(corner1.x, corner2.x);
    const minZ: number = Math.min(corner1.z, corner2.z);
    const maxZ: number = Math.max(corner1.z, corner2.z);

    const width: number = maxX - minX;
    const depth: number = maxZ - minZ;

    if (width < 0.1 || depth < 0.1) {
      return null;
    }

    const handleAnnotations: DimAnnotation[] = [];

    const centerX: number = (minX + maxX) / 2;
    const centerZ: number = (minZ + maxZ) / 2;

    /* ── 楼板总面积标注（中心） ── */
    const totalArea: number = width * depth;
    const areaSprite: THREE.Sprite = createTextSprite(
      `${totalArea.toFixed(2)} m²`, centerX, centerZ, true
    );
    this._sceneManager.add(areaSprite);
    this._persistentAreaSprites.push(areaSprite);

    /* ── 上边外侧标注行：楼板总宽（minX → maxX） ── */
    /* 尺寸线 Z = minZ - DIM_OFFSET，界线从尺寸线位置延伸到楼板上边缘 */
    const dimZ: number = minZ - DIM_OFFSET;
    const textOffsetZ: number = dimZ - TEXT_SPRITE_H * 0.6;

    const widthLines: THREE.LineSegments = createHorizontalDimLine(
      minX+TICK_HEIGHT, maxX-TICK_HEIGHT, dimZ,
      DIM_LINE_COLOR,
      dimZ, /* zTickStart：尺寸线位置 */
      minZ  /* zTickEnd：楼板上边缘 */
    );
    const widthSprite: THREE.Sprite = createTextSprite(
      `${width.toFixed(2)} m`, centerX, textOffsetZ
    );
    this._sceneManager.add(widthLines);
    this._sceneManager.add(widthSprite);
    const widthAnnotation: DimAnnotation = { sprite: widthSprite, lines: widthLines };
    this._persistentAnnotations.push(widthAnnotation);
    handleAnnotations.push(widthAnnotation);

    /* ── 右边外侧标注列：楼板总深（minZ → maxZ） ── */
    /* 尺寸线 X = maxX + DIM_OFFSET，界线从楼板右边缘延伸到尺寸线位置 */
    const dimX: number = maxX + DIM_OFFSET;
    const textOffsetX: number = dimX + TEXT_SPRITE_W * 0.6;

    const depthLines: THREE.LineSegments = createVerticalDimLine(
      minZ+TICK_HEIGHT, maxZ-TICK_HEIGHT, dimX,
      DIM_LINE_COLOR,
      maxX, /* xTickStart：楼板右边缘 */
      dimX  /* xTickEnd：尺寸线位置 */
    );
    const depthSprite: THREE.Sprite = createTextSprite(
      `${depth.toFixed(2)} m`, textOffsetX, centerZ
    );
    this._sceneManager.add(depthLines);
    this._sceneManager.add(depthSprite);
    const depthAnnotation: DimAnnotation = { sprite: depthSprite, lines: depthLines };
    this._persistentAnnotations.push(depthAnnotation);
    handleAnnotations.push(depthAnnotation);

    return {
      areaSprite: areaSprite,
      annotations: handleAnnotations,
    };
  }

  /**
   * 移除单个矩形墙的永久标注
   * 关键流程：从场景删除面积文字与尺寸线，并从内部永久标注列表剔除句柄引用。
   * @param handle - createPersistent 返回的标注句柄；传入 null 时安全忽略
   */
  public removePersistent(handle: RectDimensionHandle | null): void {
    if (handle === null) {
      return;
    }

    const scene: THREE.Scene = this._sceneManager.getScene();

    /* 移除面积标注：仅清理当前句柄对应的 Sprite，避免影响其他矩形墙标注。 */
    scene.remove(handle.areaSprite);
    disposeSprite(handle.areaSprite);
    this._persistentAreaSprites = this._persistentAreaSprites.filter(
      (sprite: THREE.Sprite): boolean => sprite !== handle.areaSprite
    );

    /* 移除尺寸标注：逐个清理文字与线段，并同步更新内部索引。 */
    for (const annotation of handle.annotations) {
      scene.remove(annotation.sprite);
      scene.remove(annotation.lines);
      disposeSprite(annotation.sprite);
      disposeLines(annotation.lines);
    }
    this._persistentAnnotations = this._persistentAnnotations.filter(
      (annotation: DimAnnotation): boolean => !handle.annotations.includes(annotation)
    );
  }

  /**
   * 设置所有永久标注的可见性
   * 在 3D 模式下隐藏标注，在 2D 模式下显示标注
   * @param visible - true 显示，false 隐藏
   */
  public setVisible(visible: boolean): void {
    /* 控制永久面积 Sprite 可见性 */
    for (const sprite of this._persistentAreaSprites) {
      sprite.visible = visible;
    }

    /* 控制永久尺寸线 + 文字 Sprite 可见性 */
    for (const ann of this._persistentAnnotations) {
      ann.sprite.visible = visible;
      ann.lines.visible = visible;
    }
  }

  /**
   * 释放所有资源（预览标注 + 永久标注）
   * 在 WallDrawTool.dispose() 时调用
   */
  public dispose(): void {
    this.clearPreview();

    const scene: THREE.Scene = this._sceneManager.getScene();

    /* 释放永久面积 Sprite */
    for (const sprite of this._persistentAreaSprites) {
      scene.remove(sprite);
      disposeSprite(sprite);
    }
    this._persistentAreaSprites = [];

    /* 释放永久尺寸线 + 文字 */
    for (const ann of this._persistentAnnotations) {
      scene.remove(ann.sprite);
      scene.remove(ann.lines);
      disposeSprite(ann.sprite);
      disposeLines(ann.lines);
    }
    this._persistentAnnotations = [];
  }
}
