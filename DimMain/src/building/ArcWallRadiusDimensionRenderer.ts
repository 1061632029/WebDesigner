/**
 * 弧形墙布置半径与角度动态标注渲染器。
 * 负责在弧形墙第三点布置阶段，根据起点、终点、bulge 和鼠标方向点实时显示毫米半径与夹角标注。
 */

import * as THREE from 'three/webgpu';
import type { Point2D } from './BuildingTypes';
import type { SceneManager } from '../scene/SceneManager';
import { applyFixedScreenSpriteSize } from '../rendering/FixedScreenSpriteScaler';

/** 半径标注线颜色，保持与动态尺寸标注蓝色一致。 */
const RADIUS_LINE_COLOR: number = 0x2f8df6;

/** 半径标注所在高度，略高于墙体预览辅助线以避免闪烁。 */
const RADIUS_DIMENSION_Y: number = 0.15;

/** 最小有效弦长，单位：米。 */
const MIN_CHORD_LENGTH: number = 0.1;

/** 最小有效 bulge，接近 0 时认为半径无穷大并隐藏标注。 */
const MIN_BULGE_ABS: number = 0.001;

/** 标签画布宽度。 */
const LABEL_CANVAS_W: number = 320;

/** 标签画布高度。 */
const LABEL_CANVAS_H: number = 96;

/** 标签世界宽度。 */
const LABEL_SPRITE_W: number = 0.96;

/** 标签世界高度。 */
const LABEL_SPRITE_H: number = 0.288;

/** 半径标注标签字体大小。 */
const LABEL_FONT_SIZE: number = 40;

/** 半径线渲染层级。 */
const RADIUS_LINE_RENDER_ORDER: number = 11004;

/** 半径标签渲染层级。 */
const RADIUS_LABEL_RENDER_ORDER: number = 11005;

/** 角度线渲染层级。 */
const ANGLE_LINE_RENDER_ORDER: number = 11006;

/** 角度标签渲染层级。 */
const ANGLE_LABEL_RENDER_ORDER: number = 11007;

/** 屏幕空间拾取热区宽度，单位：像素。 */
const SCREEN_PICK_HALF_WIDTH_PIXELS: number = 96;

/** 屏幕空间拾取热区高度，单位：像素。 */
const SCREEN_PICK_HALF_HEIGHT_PIXELS: number = 36;

/** 180 度判断容差，单位：度。 */
const SEMICIRCLE_ANGLE_EPSILON_DEGREES: number = 0.5;

/** 角度吸附显示为 180 度的最小角度，单位：度。 */
const SEMICIRCLE_SNAP_MIN_DEGREES: number = 176;

/** 角度吸附显示为 180 度的最大角度，单位：度。 */
const SEMICIRCLE_SNAP_MAX_DEGREES: number = 184;

/** 圆心到弧端点虚线的单段长度，单位：米。 */
const ENDPOINT_DASH_SIZE: number = 0.18;

/** 圆心到弧端点虚线的间隔长度，单位：米。 */
const ENDPOINT_DASH_GAP_SIZE: number = 0.12;

/** 角度标注弧线相对半径的比例。 */
const ANGLE_ARC_RADIUS_RATIO: number = 0.24;

/** 角度标注弧线最小半径，单位：米。 */
const MIN_ANGLE_ARC_RADIUS: number = 0.35;

/** 角度标注弧线最大半径，单位：米。 */
const MAX_ANGLE_ARC_RADIUS: number = 1.2;

/** 180 度引线长度，单位：米。 */
const SEMICIRCLE_LEADER_LENGTH: number = 0.42;

/** 弧形墙预览当前可编辑标注类型。 */
export type ArcWallPreviewEditTarget = 'radius' | 'angle';

/** 弧形墙常驻标注拾取结果。 */
export interface ArcWallDimensionPickResult {
  /** 弧形墙对象 ID。 */
  wallId: string;
  /** 被点击的编辑目标。 */
  target: ArcWallPreviewEditTarget;
}

/** 半径动态标注句柄。 */
interface ArcRadiusPreviewAnnotation {
  /** 归属弧形墙 ID；预览标注没有归属时为 null。 */
  wallId: string | null;
  /** 半径文字 Sprite。 */
  radiusSprite: THREE.Sprite;
  /** 角度文字 Sprite。 */
  angleSprite: THREE.Sprite;
  /** 圆心到鼠标方向圆弧交点的半径指示线。 */
  radiusLine: THREE.Line;
  /** 角度弧线与 180 度引线。 */
  angleLine: THREE.LineSegments;
  /** 176 到 184 度范围内显示的圆心到弧端点蓝色虚线。 */
  endpointDashedLines: THREE.LineSegments | null;
}

/** 弧形墙半径计算结果。 */
interface ArcRadiusInfo {
  /** 圆心。 */
  center: Point2D;
  /** 半径线终点，即圆心到鼠标方向与弧墙圆弧的交点。 */
  radiusPoint: Point2D;
  /** 半径，单位：米。 */
  radius: number;
  /** 弧段起点角度。 */
  startAngle: number;
  /** 有符号扫描角，正值表示逆时针，负值表示顺时针。 */
  sweepAngle: number;
  /** 夹角绝对值，单位：弧度。 */
  includedAngle: number;
}

/** 最小有效方向长度，鼠标点过近时回退到弧中点。 */
const MIN_RADIUS_DIRECTION_LENGTH: number = 0.000001;

/** 角度范围判断容差，避免浮点误差导致端点附近交点被错误排除。 */
const ARC_ANGLE_EPSILON: number = 0.000001;

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
 * 将角度归一化到 [0, 2π) 区间。
 * @param angle - 原始弧度角
 * @returns 归一化后的弧度角
 */
function normalizePositiveAngle(angle: number): number {
  const fullCircle: number = Math.PI * 2;
  let normalizedAngle: number = angle % fullCircle;
  if (normalizedAngle < 0) {
    normalizedAngle += fullCircle;
  }
  return normalizedAngle;
}

/**
 * 判断指定角度是否落在弧墙弧段范围内。
 * 关键流程：根据 bulge 正负选择逆时针或顺时针扫描方向，并把待测角度转换为同方向的相对角度后比较。
 * @param angle - 待检测的圆周角度
 * @param startAngle - 弧段起点角度
 * @param endAngle - 弧段终点角度
 * @param bulge - 弧度因子，正值表示逆时针弧，负值表示顺时针弧
 * @returns true 表示该角度对应点位于当前弧墙弧段上
 */
function isAngleOnArcSegment(
  angle: number,
  startAngle: number,
  endAngle: number,
  bulge: number
): boolean {
  if (bulge >= 0) {
    /* 正 bulge 使用逆时针弧段：从起点角度沿逆时针方向扫描到终点角度。 */
    const sweepAngle: number = normalizePositiveAngle(endAngle - startAngle);
    const relativeAngle: number = normalizePositiveAngle(angle - startAngle);
    return relativeAngle >= -ARC_ANGLE_EPSILON && relativeAngle <= sweepAngle + ARC_ANGLE_EPSILON;
  }

  /* 负 bulge 使用顺时针弧段：从起点角度沿顺时针方向扫描到终点角度。 */
  const sweepAngle: number = normalizePositiveAngle(startAngle - endAngle);
  const relativeAngle: number = normalizePositiveAngle(startAngle - angle);
  return relativeAngle >= -ARC_ANGLE_EPSILON && relativeAngle <= sweepAngle + ARC_ANGLE_EPSILON;
}

/**
 * 根据圆心、半径和鼠标方向点计算半径线与弧墙的交点。
 * 关键流程：先取圆心指向鼠标点的射线与圆的交点，再校验该交点是否落在当前弧墙弧段上；无有效交点时回退到弧中点。
 * @param center - 圆心
 * @param radius - 半径，单位：米
 * @param directionPoint - 鼠标方向点
 * @param fallbackPoint - 方向无效时使用的弧中点
 * @param startAngle - 弧段起点角度
 * @param endAngle - 弧段终点角度
 * @param bulge - 弧度因子，正负表示弧段扫描方向
 * @returns 半径线终点
 */
function calculateRadiusPoint(
  center: Point2D,
  radius: number,
  directionPoint: Point2D | null,
  fallbackPoint: Point2D,
  startAngle: number,
  endAngle: number,
  bulge: number
): Point2D {
  if (directionPoint === null) {
    return fallbackPoint;
  }

  const directionX: number = directionPoint.x - center.x;
  const directionZ: number = directionPoint.z - center.z;
  const directionLength: number = Math.sqrt(directionX * directionX + directionZ * directionZ);
  if (directionLength < MIN_RADIUS_DIRECTION_LENGTH) {
    return fallbackPoint;
  }

  const unitDirectionX: number = directionX / directionLength;
  const unitDirectionZ: number = directionZ / directionLength;
  const radiusPoint: Point2D = {
    x: center.x + unitDirectionX * radius,
    z: center.z + unitDirectionZ * radius,
  };

  /* 半径线只能连接到当前弧墙弧段，不允许落到同圆但不属于弧墙的圆周位置。 */
  const radiusPointAngle: number = Math.atan2(radiusPoint.z - center.z, radiusPoint.x - center.x);
  if (!isAngleOnArcSegment(radiusPointAngle, startAngle, endAngle, bulge)) {
    return fallbackPoint;
  }

  return radiusPoint;
}

/**
 * 计算弧形墙当前半径信息。
 * 关键流程：按 DXF bulge 公式反算圆心和半径，再取圆心到鼠标方向与圆弧的交点作为半径线终点。
 * @param start - 弧形墙起点
 * @param end - 弧形墙终点
 * @param bulge - 弧度因子，正负表示圆弧方向
 * @param directionPoint - 当前鼠标方向点；无效时回退到弧中点
 * @returns 半径信息；参数无效时返回 null
 */
function calculateArcRadiusInfo(
  start: Point2D,
  end: Point2D,
  bulge: number,
  directionPoint: Point2D | null
): ArcRadiusInfo | null {
  const chordDx: number = end.x - start.x;
  const chordDz: number = end.z - start.z;
  const chordLength: number = Math.sqrt(chordDx * chordDx + chordDz * chordDz);
  const bulgeAbs: number = Math.abs(bulge);
  if (chordLength < MIN_CHORD_LENGTH || bulgeAbs < MIN_BULGE_ABS) {
    return null;
  }

  const includedAngle: number = 4 * Math.atan(bulgeAbs);
  const sinHalfAngle: number = Math.sin(includedAngle / 2);
  if (Math.abs(sinHalfAngle) < 0.000001) {
    return null;
  }

  const radius: number = chordLength / (2 * sinHalfAngle);
  if (!Number.isFinite(radius) || radius <= 0) {
    return null;
  }

  const midpointX: number = (start.x + end.x) / 2;
  const midpointZ: number = (start.z + end.z) / 2;
  const directionX: number = chordDx / chordLength;
  const directionZ: number = chordDz / chordLength;
  const leftNormalX: number = -directionZ;
  const leftNormalZ: number = directionX;
  const centerOffset: number = chordLength / (2 * Math.tan(includedAngle / 2));
  const bulgeSign: number = bulge >= 0 ? 1 : -1;
  const center: Point2D = {
    x: midpointX + leftNormalX * centerOffset * bulgeSign,
    z: midpointZ + leftNormalZ * centerOffset * bulgeSign,
  };

  const startAngle: number = Math.atan2(start.z - center.z, start.x - center.x);
  const endAngle: number = Math.atan2(end.z - center.z, end.x - center.x);
  const counterClockwiseAngle: number = normalizePositiveAngle(endAngle - startAngle);
  const sweepAngle: number = bulge >= 0 ? counterClockwiseAngle : counterClockwiseAngle - Math.PI * 2;
  const midAngle: number = startAngle + sweepAngle / 2;
  const arcMidPoint: Point2D = {
    x: center.x + Math.cos(midAngle) * radius,
    z: center.z + Math.sin(midAngle) * radius,
  };
  const radiusPoint: Point2D = calculateRadiusPoint(
    center,
    radius,
    directionPoint,
    arcMidPoint,
    startAngle,
    endAngle,
    bulge
  );

  return {
    center: center,
    radiusPoint: radiusPoint,
    radius: radius,
    startAngle: startAngle,
    sweepAngle: sweepAngle,
    includedAngle: includedAngle,
  };
}

/**
 * 创建弧形墙预览文字标签 Sprite。
 * 关键流程：当前可编辑项使用蓝底白字，非当前项使用白底蓝字，便于配合 Tab 键提示编辑目标。
 * @param labelText - 标签文本
 * @param x - 标签世界 X 坐标
 * @param z - 标签世界 Z 坐标
 * @param renderOrder - 标签渲染层级
 * @param active - true 表示当前标签处于键盘编辑态
 * @returns 标签 Sprite
 */
function createLabelSprite(
  labelText: string,
  x: number,
  z: number,
  renderOrder: number,
  active: boolean
): THREE.Sprite {
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = LABEL_CANVAS_W;
  canvas.height = LABEL_CANVAS_H;

  const ctx: CanvasRenderingContext2D = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, LABEL_CANVAS_W, LABEL_CANVAS_H);

  const panelX: number = 12;
  const panelY: number = 14;
  const panelW: number = LABEL_CANVAS_W - panelX * 2;
  const panelH: number = LABEL_CANVAS_H - panelY * 2;

  /* 标签绘制流程：当前编辑标签蓝底高亮，非编辑标签保持白底蓝框，避免用户不清楚键盘输入作用对象。 */
  drawRoundRectPath(ctx, panelX, panelY, panelW, panelH, 10);
  ctx.fillStyle = active ? '#2f8df6' : 'rgba(255,255,255,0.94)';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#2f8df6';
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${LABEL_FONT_SIZE}px Arial, Microsoft YaHei, sans-serif`;
  ctx.fillStyle = active ? '#ffffff' : '#2f8df6';
  ctx.fillText(labelText, LABEL_CANVAS_W / 2, LABEL_CANVAS_H / 2);

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
  sprite.position.set(x, RADIUS_DIMENSION_Y, z);
  sprite.renderOrder = renderOrder;

  return sprite;
}

/**
 * 判断角度是否处于半圆吸附显示范围内。
 * @param angleDegrees - 夹角绝对值，单位：度
 * @returns true 表示需要按 180 度显示并绘制端点虚线
 */
function isAngleInSemicircleSnapRange(angleDegrees: number): boolean {
  return angleDegrees >= SEMICIRCLE_SNAP_MIN_DEGREES && angleDegrees <= SEMICIRCLE_SNAP_MAX_DEGREES;
}

/**
 * 将夹角格式化为角度文本。
 * 关键流程：键盘输入优先显示；未输入时，176 到 184 度范围吸附为 180 度，超出范围立即恢复实际角度。
 * @param angleDegrees - 夹角绝对值，单位：度
 * @param inputText - 键盘输入文本；存在时优先显示输入值
 * @returns 角度标签文本
 */
function formatAngleLabelText(angleDegrees: number, inputText: string | null): string {
  if (inputText !== null && inputText.length > 0) {
    return `∠=${inputText}°`;
  }

  const displayedAngleDegrees: number = isAngleInSemicircleSnapRange(angleDegrees) ? 180 : Math.round(angleDegrees);
  return `∠=${displayedAngleDegrees}°`;
}

/**
 * 计算限制范围内的角度标注弧线半径。
 * @param radius - 弧形墙半径，单位：米
 * @returns 角度标注弧线半径，单位：米
 */
function calculateAngleAnnotationRadius(radius: number): number {
  return Math.max(MIN_ANGLE_ARC_RADIUS, Math.min(MAX_ANGLE_ARC_RADIUS, radius * ANGLE_ARC_RADIUS_RATIO));
}

/**
 * 创建角度弧线；当夹角为 180 度时，在角平分方向额外绘制引线。
 * @param info - 弧形墙半径和角度信息
 * @returns 角度标注线段对象
 */
function createAngleLine(info: ArcRadiusInfo): THREE.LineSegments {
  const positions: number[] = [];
  const angleRadius: number = calculateAngleAnnotationRadius(info.radius);
  const segmentCount: number = Math.max(12, Math.ceil(info.includedAngle * 24));

  /* 角度弧线绘制流程：沿有符号 sweepAngle 分段采样，确保正负 bulge 的角度标注方向与弧墙一致。 */
  for (let index: number = 0; index < segmentCount; index++) {
    const t0: number = index / segmentCount;
    const t1: number = (index + 1) / segmentCount;
    const angle0: number = info.startAngle + info.sweepAngle * t0;
    const angle1: number = info.startAngle + info.sweepAngle * t1;
    positions.push(
      info.center.x + Math.cos(angle0) * angleRadius, RADIUS_DIMENSION_Y, info.center.z + Math.sin(angle0) * angleRadius,
      info.center.x + Math.cos(angle1) * angleRadius, RADIUS_DIMENSION_Y, info.center.z + Math.sin(angle1) * angleRadius
    );
  }

  const angleDegrees: number = Math.abs(info.includedAngle * 180 / Math.PI);
  if (Math.abs(angleDegrees - 180) <= SEMICIRCLE_ANGLE_EPSILON_DEGREES) {
    /* 180 度分支：半圆弧的文字容易与弧线重叠，沿角平分方向补一段引线，把角度标签引出显示。 */
    const midAngle: number = info.startAngle + info.sweepAngle / 2;
    const leaderStartX: number = info.center.x + Math.cos(midAngle) * angleRadius;
    const leaderStartZ: number = info.center.z + Math.sin(midAngle) * angleRadius;
    const leaderEndX: number = info.center.x + Math.cos(midAngle) * (angleRadius + SEMICIRCLE_LEADER_LENGTH);
    const leaderEndZ: number = info.center.z + Math.sin(midAngle) * (angleRadius + SEMICIRCLE_LEADER_LENGTH);
    positions.push(leaderStartX, RADIUS_DIMENSION_Y, leaderStartZ, leaderEndX, RADIUS_DIMENSION_Y, leaderEndZ);
  }

  const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
  const material: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
    color: RADIUS_LINE_COLOR,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.95,
  });
  const line: THREE.LineSegments = new THREE.LineSegments(geometry, material);
  line.renderOrder = ANGLE_LINE_RENDER_ORDER;
  return line;
}

/**
 * 计算角度标签位置。
 * @param info - 弧形墙半径和角度信息
 * @returns 标签位置
 */
function calculateAngleLabelPosition(info: ArcRadiusInfo): Point2D {
  const angleRadius: number = calculateAngleAnnotationRadius(info.radius);
  const midAngle: number = info.startAngle + info.sweepAngle / 2;
  const angleDegrees: number = Math.abs(info.includedAngle * 180 / Math.PI);
  const labelRadius: number = Math.abs(angleDegrees - 180) <= SEMICIRCLE_ANGLE_EPSILON_DEGREES
    ? angleRadius + SEMICIRCLE_LEADER_LENGTH + 0.18
    : angleRadius + 0.22;

  return {
    x: info.center.x + Math.cos(midAngle) * labelRadius,
    z: info.center.z + Math.sin(midAngle) * labelRadius,
  };
}

/**
 * 创建圆心到鼠标方向圆弧交点的半径指示线。
 * @param center - 圆心
 * @param radiusPoint - 半径线终点
 * @returns 半径指示线
 */
function createRadiusLine(center: Point2D, radiusPoint: Point2D): THREE.Line {
  const positions: Float32Array = new Float32Array([
    center.x, RADIUS_DIMENSION_Y, center.z,
    radiusPoint.x, RADIUS_DIMENSION_Y, radiusPoint.z,
  ]);
  const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const material: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
    color: RADIUS_LINE_COLOR,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.95,
  });
  const line: THREE.Line = new THREE.Line(geometry, material);
  line.renderOrder = RADIUS_LINE_RENDER_ORDER;

  return line;
}

/**
 * 创建圆心到弧形墙起点、终点的蓝色虚线。
 * 关键流程：仅在角度吸附到 180 度的范围内创建，使用 LineDashedMaterial 并计算线段距离以启用虚线效果。
 * @param center - 弧形墙圆心
 * @param start - 弧形墙起点
 * @param end - 弧形墙终点
 * @returns 两条端点辅助虚线
 */
function createEndpointDashedLines(center: Point2D, start: Point2D, end: Point2D): THREE.LineSegments {
  const positions: Float32Array = new Float32Array([
    center.x, RADIUS_DIMENSION_Y, center.z,
    start.x, RADIUS_DIMENSION_Y, start.z,
    center.x, RADIUS_DIMENSION_Y, center.z,
    end.x, RADIUS_DIMENSION_Y, end.z,
  ]);
  const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  const material: THREE.LineDashedMaterial = new THREE.LineDashedMaterial({
    color: RADIUS_LINE_COLOR,
    dashSize: ENDPOINT_DASH_SIZE,
    gapSize: ENDPOINT_DASH_GAP_SIZE,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.95,
  });
  const line: THREE.LineSegments = new THREE.LineSegments(geometry, material);
  line.computeLineDistances();
  line.renderOrder = RADIUS_LINE_RENDER_ORDER;

  return line;
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
 * 释放 Line 占用的 GPU 资源。
 * @param line - 要释放的 Line
 */
function disposeLine(line: THREE.Line): void {
  line.geometry.dispose();
  (line.material as THREE.Material).dispose();
}

/**
 * 弧形墙布置半径动态标注渲染器。
 */
export class ArcWallRadiusDimensionRenderer {
  /** 场景管理器。 */
  private _sceneManager: SceneManager;

  /** 当前预览半径标注。 */
  private _previewAnnotation: ArcRadiusPreviewAnnotation | null = null;

  /** 常驻弧形墙标注集合，键为弧形墙对象 ID。 */
  private _persistentAnnotations: Map<string, ArcRadiusPreviewAnnotation> = new Map<string, ArcRadiusPreviewAnnotation>();

  /** 当前可见性。 */
  private _visible: boolean = true;

  /** 当前选中的建筑对象 ID 集合，用于控制弧墙常驻标注按选中状态显示。 */
  private _selectedWallIds: ReadonlySet<string> = new Set<string>();

  /**
   * @param sceneManager - 场景管理器
   */
  constructor(sceneManager: SceneManager) {
    this._sceneManager = sceneManager;
  }

  /**
   * 更新弧形墙半径与角度动态标注。
   * 关键流程：按起终点、bulge 和鼠标方向点计算半径线，半径统一换算为毫米显示；176 到 184 度范围内角度吸附为 180 度并显示端点虚线。
   * @param start - 弧形墙起点
   * @param end - 弧形墙终点
   * @param bulge - 当前弧度因子
   * @param directionPoint - 当前鼠标方向点，用于确定半径线与弧墙的交点
   * @param editTarget - 当前键盘编辑目标，用于高亮半径或角度标签
   * @param radiusInputText - 半径输入文本；存在时优先覆盖半径标签显示
   * @param angleInputText - 角度输入文本；存在时优先覆盖角度标签显示
   */
  public updatePreview(
    start: Point2D,
    end: Point2D,
    bulge: number,
    directionPoint: Point2D | null,
    editTarget: ArcWallPreviewEditTarget = 'radius',
    radiusInputText: string | null = null,
    angleInputText: string | null = null
  ): void {
    this.clearPreview();

    const radiusInfo: ArcRadiusInfo | null = calculateArcRadiusInfo(start, end, bulge, directionPoint);
    if (radiusInfo === null) {
      return;
    }

    const radiusMillimeters: number = Math.round(radiusInfo.radius * 1000);
    if (!Number.isFinite(radiusMillimeters) || radiusMillimeters <= 0) {
      return;
    }

    const radiusLabelText: string = radiusInputText !== null && radiusInputText.length > 0
      ? `R=${radiusInputText}mm`
      : `R=${radiusMillimeters}mm`;
    const labelX: number = (radiusInfo.center.x + radiusInfo.radiusPoint.x) / 2;
    const labelZ: number = (radiusInfo.center.z + radiusInfo.radiusPoint.z) / 2;
    const currentAngleDegrees: number = Math.abs(radiusInfo.includedAngle * 180 / Math.PI);
    const shouldShowEndpointDashedLines: boolean = isAngleInSemicircleSnapRange(currentAngleDegrees);
    const angleLabelText: string = formatAngleLabelText(currentAngleDegrees, angleInputText);
    const angleLabelPosition: Point2D = calculateAngleLabelPosition(radiusInfo);

    /* 标注创建流程：同时绘制半径线、半径标签、角度弧线和角度标签；半圆吸附范围内额外显示圆心到起终点虚线。 */
    const wallId: string | null = null;
    const radiusLine: THREE.Line = createRadiusLine(radiusInfo.center, radiusInfo.radiusPoint);
    const radiusSprite: THREE.Sprite = createLabelSprite(
      radiusLabelText,
      labelX,
      labelZ,
      RADIUS_LABEL_RENDER_ORDER,
      editTarget === 'radius'
    );
    const angleLine: THREE.LineSegments = createAngleLine(radiusInfo);
    const endpointDashedLines: THREE.LineSegments | null = shouldShowEndpointDashedLines
      ? createEndpointDashedLines(radiusInfo.center, start, end)
      : null;
    const angleSprite: THREE.Sprite = createLabelSprite(
      angleLabelText,
      angleLabelPosition.x,
      angleLabelPosition.z,
      ANGLE_LABEL_RENDER_ORDER,
      editTarget === 'angle'
    );
    radiusLine.visible = this._visible;
    radiusSprite.visible = this._visible;
    angleLine.visible = this._visible;
    angleSprite.visible = this._visible;
    if (endpointDashedLines !== null) {
      endpointDashedLines.visible = this._visible;
    }
    this._sceneManager.add(radiusLine);
    this._sceneManager.add(radiusSprite);
    this._sceneManager.add(angleLine);
    if (endpointDashedLines !== null) {
      this._sceneManager.add(endpointDashedLines);
    }
    this._sceneManager.add(angleSprite);
    this._previewAnnotation = {
      wallId: wallId,
      radiusSprite: radiusSprite,
      angleSprite: angleSprite,
      radiusLine: radiusLine,
      angleLine: angleLine,
      endpointDashedLines: endpointDashedLines,
    };
  }

  /**
   * 更新指定弧形墙的常驻半径与角度标注。
   * 关键流程：先移除同一墙体旧标注，再按当前弧墙几何重建标注，并给半径/角度 Sprite 写入拾取元数据。
   * @param wallId - 弧形墙对象 ID
   * @param start - 弧形墙起点
   * @param end - 弧形墙终点
   * @param bulge - 弧度因子
   * @param editTarget - 当前编辑目标；为 null 时不高亮
   * @param radiusInputText - 半径输入文本；存在时优先显示
   * @param angleInputText - 角度输入文本；存在时优先显示
   */
  public updatePersistent(
    wallId: string,
    start: Point2D,
    end: Point2D,
    bulge: number,
    editTarget: ArcWallPreviewEditTarget | null,
    radiusInputText: string | null,
    angleInputText: string | null
  ): void {
    this.clearPersistent(wallId);

    const radiusInfo: ArcRadiusInfo | null = calculateArcRadiusInfo(start, end, bulge, null);
    if (radiusInfo === null) {
      return;
    }

    const radiusMillimeters: number = Math.round(radiusInfo.radius * 1000);
    if (!Number.isFinite(radiusMillimeters) || radiusMillimeters <= 0) {
      return;
    }

    const radiusLabelText: string = radiusInputText !== null && radiusInputText.length > 0
      ? `R=${radiusInputText}mm`
      : `R=${radiusMillimeters}mm`;
    const labelX: number = (radiusInfo.center.x + radiusInfo.radiusPoint.x) / 2;
    const labelZ: number = (radiusInfo.center.z + radiusInfo.radiusPoint.z) / 2;
    const currentAngleDegrees: number = Math.abs(radiusInfo.includedAngle * 180 / Math.PI);
    const shouldShowEndpointDashedLines: boolean = isAngleInSemicircleSnapRange(currentAngleDegrees);
    const angleLabelText: string = formatAngleLabelText(currentAngleDegrees, angleInputText);
    const angleLabelPosition: Point2D = calculateAngleLabelPosition(radiusInfo);

    /* 常驻标注创建流程：复用预览标注样式，区别是 Sprite 持有 wallId 和 target，供点击拾取进入编辑态。 */
    const radiusLine: THREE.Line = createRadiusLine(radiusInfo.center, radiusInfo.radiusPoint);
    const radiusSprite: THREE.Sprite = createLabelSprite(
      radiusLabelText,
      labelX,
      labelZ,
      RADIUS_LABEL_RENDER_ORDER,
      editTarget === 'radius'
    );
    const angleLine: THREE.LineSegments = createAngleLine(radiusInfo);
    const endpointDashedLines: THREE.LineSegments | null = shouldShowEndpointDashedLines
      ? createEndpointDashedLines(radiusInfo.center, start, end)
      : null;
    const angleSprite: THREE.Sprite = createLabelSprite(
      angleLabelText,
      angleLabelPosition.x,
      angleLabelPosition.z,
      ANGLE_LABEL_RENDER_ORDER,
      editTarget === 'angle'
    );
    radiusSprite.userData = { kind: 'arc-wall-dimension', wallId: wallId, target: 'radius' };
    angleSprite.userData = { kind: 'arc-wall-dimension', wallId: wallId, target: 'angle' };
    const persistentVisible: boolean = this._isPersistentAnnotationVisible(wallId);
    radiusLine.visible = persistentVisible;
    radiusSprite.visible = persistentVisible;
    angleLine.visible = persistentVisible;
    angleSprite.visible = persistentVisible;
    if (endpointDashedLines !== null) {
      endpointDashedLines.visible = persistentVisible;
    }
    this._sceneManager.add(radiusLine);
    this._sceneManager.add(radiusSprite);
    this._sceneManager.add(angleLine);
    if (endpointDashedLines !== null) {
      this._sceneManager.add(endpointDashedLines);
    }
    this._sceneManager.add(angleSprite);
    this._persistentAnnotations.set(wallId, {
      wallId: wallId,
      radiusSprite: radiusSprite,
      angleSprite: angleSprite,
      radiusLine: radiusLine,
      angleLine: angleLine,
      endpointDashedLines: endpointDashedLines,
    });
  }

  /**
   * 清除指定弧形墙的常驻标注。
   * @param wallId - 弧形墙对象 ID
   */
  public clearPersistent(wallId: string): void {
    const annotation: ArcRadiusPreviewAnnotation | undefined = this._persistentAnnotations.get(wallId);
    if (annotation === undefined) {
      return;
    }
    this._removeAnnotation(annotation);
    this._persistentAnnotations.delete(wallId);
  }

  /**
   * 清除全部常驻弧形墙标注。
   */
  public clearAllPersistent(): void {
    this._persistentAnnotations.forEach((annotation: ArcRadiusPreviewAnnotation): void => {
      this._removeAnnotation(annotation);
    });
    this._persistentAnnotations.clear();
  }

  /**
   * 根据 Three.js 对象解析弧墙标注拾取结果。
   * @param object - Raycaster 命中的对象
   * @returns 弧墙标注拾取结果；不是弧墙标注时返回 null
   */
  public pickDimensionLabel(object: THREE.Object3D | null): ArcWallDimensionPickResult | null {
    if (object === null || object.userData['kind'] !== 'arc-wall-dimension') {
      return null;
    }
    const wallId: unknown = object.userData['wallId'];
    const target: unknown = object.userData['target'];
    if (typeof wallId !== 'string' || (target !== 'radius' && target !== 'angle')) {
      return null;
    }
    return { wallId: wallId, target: target };
  }

  /**
   * 通过屏幕坐标拾取弧形墙常驻半径/角度标注。
   * 关键流程：把常驻 Sprite 的世界坐标投影到当前画布屏幕坐标，再用固定像素热区判断点击是否落在标签附近，规避 Sprite Raycaster 命中不稳定问题。
   * @param clientX - 鼠标屏幕 X 坐标
   * @param clientY - 鼠标屏幕 Y 坐标
   * @param camera - 当前视图相机
   * @param domElement - 渲染画布元素
   * @returns 命中的弧墙标注信息；未命中时返回 null
   */
  public pickDimensionLabelByScreenPoint(
    clientX: number,
    clientY: number,
    camera: THREE.Camera,
    domElement: HTMLElement
  ): ArcWallDimensionPickResult | null {
    const rect: DOMRect = domElement.getBoundingClientRect();
    const localX: number = clientX - rect.left;
    const localY: number = clientY - rect.top;
    let nearestPickResult: ArcWallDimensionPickResult | null = null;
    let nearestDistanceSquared: number = Number.POSITIVE_INFINITY;

    /* 屏幕拾取流程：逐个检测常驻标注的半径与角度标签，多个热区重叠时选择离鼠标最近的标签。 */
    this._persistentAnnotations.forEach((annotation: ArcRadiusPreviewAnnotation): void => {
      const radiusPickDistanceSquared: number | null = this._calculateSpriteScreenPickDistanceSquared(
        annotation.radiusSprite,
        localX,
        localY,
        camera,
        rect
      );
      if (radiusPickDistanceSquared !== null && radiusPickDistanceSquared < nearestDistanceSquared && annotation.wallId !== null) {
        nearestDistanceSquared = radiusPickDistanceSquared;
        nearestPickResult = { wallId: annotation.wallId, target: 'radius' };
      }

      const anglePickDistanceSquared: number | null = this._calculateSpriteScreenPickDistanceSquared(
        annotation.angleSprite,
        localX,
        localY,
        camera,
        rect
      );
      if (anglePickDistanceSquared !== null && anglePickDistanceSquared < nearestDistanceSquared && annotation.wallId !== null) {
        nearestDistanceSquared = anglePickDistanceSquared;
        nearestPickResult = { wallId: annotation.wallId, target: 'angle' };
      }
    });

    return nearestPickResult;
  }

  /**
   * 计算鼠标到 Sprite 屏幕热区中心的距离平方。
   * @param sprite - 待检测的标签 Sprite
   * @param localX - 鼠标相对画布左上角的 X 坐标
   * @param localY - 鼠标相对画布左上角的 Y 坐标
   * @param camera - 当前视图相机
   * @param rect - 渲染画布屏幕矩形
   * @returns 命中时返回距离平方；未命中或不可见时返回 null
   */
  private _calculateSpriteScreenPickDistanceSquared(
    sprite: THREE.Sprite,
    localX: number,
    localY: number,
    camera: THREE.Camera,
    rect: DOMRect
  ): number | null {
    if (!sprite.visible) {
      return null;
    }

    const projectedPosition: THREE.Vector3 = sprite.getWorldPosition(new THREE.Vector3()).project(camera);
    if (projectedPosition.z < -1 || projectedPosition.z > 1) {
      return null;
    }

    const spriteScreenX: number = (projectedPosition.x * 0.5 + 0.5) * rect.width;
    const spriteScreenY: number = (-projectedPosition.y * 0.5 + 0.5) * rect.height;
    const deltaX: number = localX - spriteScreenX;
    const deltaY: number = localY - spriteScreenY;

    /* 命中分支：使用比实际标签略大的热区，确保用户点击文字边缘时也能稳定进入编辑。 */
    if (Math.abs(deltaX) > SCREEN_PICK_HALF_WIDTH_PIXELS || Math.abs(deltaY) > SCREEN_PICK_HALF_HEIGHT_PIXELS) {
      return null;
    }

    return deltaX * deltaX + deltaY * deltaY;
  }

  /**
   * 清除当前半径动态标注。
   */
  public clearPreview(): void {
    if (this._previewAnnotation === null) {
      return;
    }

    this._removeAnnotation(this._previewAnnotation);
    this._previewAnnotation = null;
  }

  /**
   * 设置动态标注可见性。
   * @param visible - true 显示，false 隐藏
   */
  public setVisible(visible: boolean): void {
    this._visible = visible;
    if (this._previewAnnotation !== null) {
      this._setAnnotationVisible(this._previewAnnotation, visible);
    }
    this._persistentAnnotations.forEach((annotation: ArcRadiusPreviewAnnotation): void => {
      this._setAnnotationVisible(annotation, this._isPersistentAnnotationVisible(annotation.wallId));
    });
  }

  /**
   * 同步当前选中的建筑对象集合，并按选中状态刷新弧墙常驻标注显隐。
   * @param selectedWallIds - 当前选中的建筑对象 ID 只读集合
   */
  public setSelectedWallIds(selectedWallIds: ReadonlySet<string>): void {
    this._selectedWallIds = new Set<string>(selectedWallIds);
    this._persistentAnnotations.forEach((annotation: ArcRadiusPreviewAnnotation): void => {
      this._setAnnotationVisible(annotation, this._isPersistentAnnotationVisible(annotation.wallId));
    });
  }

  /**
   * 判断常驻弧墙标注是否应该显示。
   * @param wallId - 弧形墙对象 ID；预览标注为 null 时不按此流程控制
   * @returns true 表示全局标注开启且对应弧墙处于选中状态
   */
  private _isPersistentAnnotationVisible(wallId: string | null): boolean {
    if (wallId === null) {
      return this._visible;
    }
    return this._visible && this._selectedWallIds.has(wallId);
  }

  /**
   * 设置单个标注对象的可见性。
   * @param annotation - 标注对象
   * @param visible - true 显示，false 隐藏
   */
  private _setAnnotationVisible(annotation: ArcRadiusPreviewAnnotation, visible: boolean): void {
    annotation.radiusSprite.visible = visible;
    annotation.angleSprite.visible = visible;
    annotation.radiusLine.visible = visible;
    annotation.angleLine.visible = visible;
    if (annotation.endpointDashedLines !== null) {
      annotation.endpointDashedLines.visible = visible;
    }
  }

  /**
   * 从场景移除标注并释放 GPU 资源。
   * @param annotation - 标注对象
   */
  private _removeAnnotation(annotation: ArcRadiusPreviewAnnotation): void {
    const scene: THREE.Scene = this._sceneManager.getScene();
    scene.remove(annotation.radiusSprite);
    scene.remove(annotation.angleSprite);
    scene.remove(annotation.radiusLine);
    scene.remove(annotation.angleLine);
    if (annotation.endpointDashedLines !== null) {
      scene.remove(annotation.endpointDashedLines);
    }
    disposeSprite(annotation.radiusSprite);
    disposeSprite(annotation.angleSprite);
    disposeLine(annotation.radiusLine);
    disposeLine(annotation.angleLine);
    if (annotation.endpointDashedLines !== null) {
      disposeLine(annotation.endpointDashedLines);
    }
  }

  /**
   * 释放渲染资源。
   */
  public dispose(): void {
    this.clearPreview();
    this.clearAllPersistent();
  }
}