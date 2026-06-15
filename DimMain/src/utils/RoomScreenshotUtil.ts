/**
 * 房间截图裁剪工具
 * 根据建筑对象中的楼板/天花板/墙体边界，将房间世界坐标转换为当前相机画面中的屏幕范围，
 * 将 Canvas 裁剪为尽量只包含室内空间的图片，减少房间外部场景进入照片存储栏。
 */

import * as THREE from 'three/webgpu';
import type { BuildingObjectManager } from '../building/BuildingObjectManager';
import type { BuildingObject, Point2D, SlabData, CeilingData, WallData, RectWallData, StraightWallData } from '../building/BuildingTypes';
import { WallPlacementLineConverter } from '../building/WallPlacementLineConverter';

/** 房间截图选项 */
export interface RoomScreenshotOptions {
  /** 裁剪边界外扩比例，用于保留少量房间边缘留白 */
  paddingRatio: number;
  /** 最小留白像素，单位为 CSS 像素 */
  minPaddingPx: number;
}

/** XZ 平面边界 */
interface XzBounds {
  /** 最小 X 坐标 */
  minX: number;
  /** 最大 X 坐标 */
  maxX: number;
  /** 最小 Z 坐标 */
  minZ: number;
  /** 最大 Z 坐标 */
  maxZ: number;
}

/** 房间世界空间边界 */
interface RoomWorldBounds extends XzBounds {
  /** 最小 Y 坐标 */
  minY: number;
  /** 最大 Y 坐标 */
  maxY: number;
}

/** CSS 像素裁剪区域 */
interface CssCropRect {
  /** 左上角 X 坐标 */
  x: number;
  /** 左上角 Y 坐标 */
  y: number;
  /** 裁剪宽度 */
  width: number;
  /** 裁剪高度 */
  height: number;
}

/** CSS 像素点 */
interface CssPoint {
  /** X 坐标 */
  x: number;
  /** Y 坐标 */
  y: number;
}

/** CSS 像素竖向边界线 */
interface CssVerticalBoundaryLine {
  /** 线段顶部屏幕点 */
  top: CssPoint;
  /** 线段底部屏幕点 */
  bottom: CssPoint;
}

/** 墙体世界空间竖向边界线 */
interface WorldVerticalBoundaryLine {
  /** 线段顶部世界点 */
  top: THREE.Vector3;
  /** 线段底部世界点 */
  bottom: THREE.Vector3;
}

/** CSS 像素四点遮罩区域 */
interface CssScreenQuad {
  /** 左上或起始顶部点 */
  topLeft: CssPoint;
  /** 右上或结束顶部点 */
  topRight: CssPoint;
  /** 右下或结束底部点 */
  bottomRight: CssPoint;
  /** 左下或起始底部点 */
  bottomLeft: CssPoint;
}

/** CSS 像素截图保留区域 */
interface CssCropRegion extends CssCropRect {
  /** 四点遮罩区域；为空时只执行普通矩形裁剪 */
  maskQuad: CssScreenQuad | null;
}

/** 墙体中心线环段，用于反算室内净轮廓。 */
interface WallCenterLoopSegment {
  /** 中心线起点，已叠加对象偏移。 */
  start: Point2D;
  /** 中心线终点，已叠加对象偏移。 */
  end: Point2D;
  /** 当前墙段厚度，单位：米。 */
  thickness: number;
}

/** 墙体闭合中心线环。 */
interface WallCenterLoop {
  /** 中心线闭合轮廓节点，首尾不重复。 */
  centerOutline: Point2D[];
  /** 与中心线轮廓边一一对应的墙厚。 */
  thicknesses: number[];
}

/** 默认房间截图参数 */
export const DEFAULT_ROOM_SCREENSHOT_OPTIONS: RoomScreenshotOptions = {
  paddingRatio: 0,
  minPaddingPx: 0,
};

/** 数值容差，避免零尺寸边界导致裁剪失败。 */
const MIN_BOUND_SIZE: number = 0.001;

/** 默认房间高度，未找到墙/天花板高度时使用。 */
const DEFAULT_ROOM_HEIGHT: number = 3.0;

/** 墙体端点连接容差，避免浮点误差导致闭合环识别失败。 */
const WALL_LOOP_POINT_TOLERANCE: number = 0.01;

/**
 * 拍摄当前房间画面。
 * @param canvas - WebGPU 渲染 Canvas
 * @param camera - 当前活动相机
 * @param objectManager - 建筑对象管理器
 * @param options - 截图裁剪参数
 * @returns 裁剪后的 PNG DataURL；无法裁剪时返回完整 Canvas DataURL
 */
export function captureRoomScreenshot(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  objectManager: BuildingObjectManager,
  options: RoomScreenshotOptions = DEFAULT_ROOM_SCREENSHOT_OPTIONS
): string {
  const allObjects: BuildingObject[] = objectManager.getAll();
  const roomBounds: RoomWorldBounds | null = collectRoomWorldBounds(allObjects);
  if (roomBounds === null) {
    console.warn('[房间拍摄] 未找到楼板/天花板/墙体边界，回退为当前完整画面');
    return canvas.toDataURL('image/png');
  }

  const canvasRect: DOMRect = canvas.getBoundingClientRect();
  if (canvasRect.width <= 0 || canvasRect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    console.warn('[房间拍摄] Canvas 尺寸无效，回退为当前完整画面');
    return canvas.toDataURL('image/png');
  }

  const cropRegion: CssCropRegion | null = createRoomScreenCropRegion(allObjects, roomBounds, camera, canvasRect, options);
  if (cropRegion === null) {
    console.warn('[房间拍摄] 房间边界屏幕坐标转换无效，回退为当前完整画面');
    return canvas.toDataURL('image/png');
  }

  return cropCanvasToDataUrl(canvas, canvasRect, cropRegion);
}

/**
 * 汇总房间世界边界。
 * 关键流程：优先使用墙体闭合中心线反算室内净轮廓；若墙体未闭合，则退回到楼板/天花板轮廓和墙体包围盒。
 * @param objectManager - 建筑对象管理器
 * @returns 房间世界边界；没有可用建筑对象时返回 null
 */
function collectRoomWorldBounds(allObjects: BuildingObject[]): RoomWorldBounds | null {
  const wallInnerOutline: Point2D[] | null = collectWallInnerRoomOutline(allObjects);
  const xzBounds: XzBounds | null = collectOutlineXzBounds(wallInnerOutline)
    ?? collectPrimaryRoomXzBounds(allObjects)
    ?? collectFallbackStructuralXzBounds(allObjects);
  if (xzBounds === null) {
    return null;
  }

  const yBounds: { minY: number; maxY: number } = collectStructuralYBounds(allObjects);
  return {
    minX: xzBounds.minX,
    maxX: xzBounds.maxX,
    minZ: xzBounds.minZ,
    maxZ: xzBounds.maxZ,
    minY: yBounds.minY,
    maxY: yBounds.maxY,
  };
}

/**
 * 收集房间水平轮廓。
 * 关键流程：优先使用墙体内空间净轮廓，避免完整楼板/地板外扩区域进入截图；无有效墙体闭合环时再退回楼板/天花板轮廓。
 * @param allObjects - 全部建筑对象
 * @returns 房间水平轮廓点列表；没有有效轮廓时返回 null
 */
function collectPrimaryRoomOutline(allObjects: BuildingObject[]): Point2D[] | null {
  const wallInnerOutline: Point2D[] | null = collectWallInnerRoomOutline(allObjects);
  if (wallInnerOutline !== null) {
    return wallInnerOutline;
  }

  const outlinePoints: Point2D[] = [];

  for (const object of allObjects) {
    if (!object.visible) {
      continue;
    }

    if (object.category === 'slab') {
      const slab: SlabData = object as SlabData;
      appendOutlinePoints(slab.outline, outlinePoints);
      continue;
    }

    if (object.category === 'ceiling') {
      const ceiling: CeilingData = object as CeilingData;
      appendOutlinePoints(ceiling.outline, outlinePoints);
    }
  }

  return outlinePoints.length >= 3 ? outlinePoints : null;
}

/**
 * 收集墙体围合出来的室内净轮廓。
 * 关键流程：先从可见直墙收集中心线闭合环，再按每段墙厚向室内侧偏移半墙厚，最终选择面积最大的室内净轮廓。
 * @param allObjects - 全部建筑对象
 * @returns 墙体内空间轮廓；墙体未闭合或无法反算时返回 null
 */
function collectWallInnerRoomOutline(allObjects: BuildingObject[]): Point2D[] | null {
  const wallSegments: WallCenterLoopSegment[] = collectStraightWallCenterSegments(allObjects);
  if (wallSegments.length < 3) {
    return null;
  }

  const loops: WallCenterLoop[] = collectClosedWallCenterLoops(wallSegments);
  let bestOutline: Point2D[] | null = null;
  let bestArea: number = 0;

  for (const loop of loops) {
    if (loop.centerOutline.length < 3 || loop.thicknesses.length !== loop.centerOutline.length) {
      continue;
    }

    /* 墙体内轮廓反算流程：中心线闭合环按每段墙厚向室内偏移，剔除退化轮廓后取最大房间区域。 */
    const innerOutline: Point2D[] = WallPlacementLineConverter.convertCenterOutlineToInnerBoundary(
      loop.centerOutline,
      loop.thicknesses
    );
    const innerArea: number = Math.abs(computePointOutlineSignedArea(innerOutline));
    if (innerOutline.length >= 3 && innerArea > bestArea) {
      bestOutline = innerOutline;
      bestArea = innerArea;
    }
  }

  return bestOutline;
}

/**
 * 从可见直墙对象收集中心线段。
 * @param allObjects - 全部建筑对象
 * @returns 可参与闭合房间识别的直墙中心线段
 */
function collectStraightWallCenterSegments(allObjects: BuildingObject[]): WallCenterLoopSegment[] {
  const wallSegments: WallCenterLoopSegment[] = [];

  for (const object of allObjects) {
    if (!object.visible || object.category !== 'wall') {
      continue;
    }

    const wall: WallData = object as WallData;
    if (wall.subType !== 'straight') {
      continue;
    }

    const straightWall: StraightWallData = wall as StraightWallData;
    const start: Point2D = {
      x: straightWall.start.x + straightWall.offsetX,
      z: straightWall.start.z + straightWall.offsetZ,
    };
    const end: Point2D = {
      x: straightWall.end.x + straightWall.offsetX,
      z: straightWall.end.z + straightWall.offsetZ,
    };

    if (computePointDistance(start, end) <= WALL_LOOP_POINT_TOLERANCE) {
      continue;
    }

    wallSegments.push({
      start: start,
      end: end,
      thickness: straightWall.thickness,
    });
  }

  return wallSegments;
}

/**
 * 从墙体中心线段中提取闭合环。
 * @param wallSegments - 直墙中心线段集合
 * @returns 可用于室内净轮廓反算的闭合中心线环集合
 */
function collectClosedWallCenterLoops(wallSegments: WallCenterLoopSegment[]): WallCenterLoop[] {
  const loops: WallCenterLoop[] = [];
  const usedSegmentIndexes: Set<number> = new Set<number>();

  for (let segmentIndex: number = 0; segmentIndex < wallSegments.length; segmentIndex += 1) {
    if (usedSegmentIndexes.has(segmentIndex)) {
      continue;
    }

    const loop: WallCenterLoop | null = traceClosedWallCenterLoop(wallSegments, segmentIndex, usedSegmentIndexes);
    if (loop !== null) {
      loops.push(loop);
    }
  }

  return loops;
}

/**
 * 从指定墙段开始追踪一个闭合中心线环。
 * @param wallSegments - 全部直墙中心线段
 * @param startIndex - 起始墙段索引
 * @param globalUsedSegmentIndexes - 已归属其它闭合环的墙段索引集合
 * @returns 闭合中心线环；无法闭合时返回 null
 */
function traceClosedWallCenterLoop(
  wallSegments: WallCenterLoopSegment[],
  startIndex: number,
  globalUsedSegmentIndexes: Set<number>
): WallCenterLoop | null {
  const localUsedSegmentIndexes: Set<number> = new Set<number>();
  const firstSegment: WallCenterLoopSegment | undefined = wallSegments[startIndex];
  if (firstSegment === undefined) {
    return null;
  }

  const centerOutline: Point2D[] = [{ x: firstSegment.start.x, z: firstSegment.start.z }];
  const thicknesses: number[] = [];
  let currentPoint: Point2D = { x: firstSegment.end.x, z: firstSegment.end.z };
  localUsedSegmentIndexes.add(startIndex);
  thicknesses.push(firstSegment.thickness);
  centerOutline.push({ x: currentPoint.x, z: currentPoint.z });

  while (localUsedSegmentIndexes.size <= wallSegments.length) {
    const firstPoint: Point2D | undefined = centerOutline[0];
    if (firstPoint !== undefined && centerOutline.length >= 4 && arePointsNearlyEqual(currentPoint, firstPoint)) {
      centerOutline.pop();
      markWallLoopSegmentsAsUsed(localUsedSegmentIndexes, globalUsedSegmentIndexes);
      return { centerOutline: centerOutline, thicknesses: thicknesses };
    }

    if (localUsedSegmentIndexes.size >= wallSegments.length) {
      return null;
    }

    const nextIndex: number = findNextConnectedWallSegmentIndex(wallSegments, currentPoint, localUsedSegmentIndexes, globalUsedSegmentIndexes);
    if (nextIndex < 0) {
      return null;
    }

    const nextSegment: WallCenterLoopSegment = wallSegments[nextIndex]!;
    localUsedSegmentIndexes.add(nextIndex);
    thicknesses.push(nextSegment.thickness);

    if (arePointsNearlyEqual(currentPoint, nextSegment.start)) {
      currentPoint = { x: nextSegment.end.x, z: nextSegment.end.z };
    } else {
      currentPoint = { x: nextSegment.start.x, z: nextSegment.start.z };
    }

    centerOutline.push({ x: currentPoint.x, z: currentPoint.z });
  }

  return null;
}

/**
 * 查找与当前端点相连的下一条墙段。
 * @param wallSegments - 全部直墙中心线段
 * @param currentPoint - 当前追踪端点
 * @param localUsedSegmentIndexes - 当前追踪已使用墙段索引
 * @param globalUsedSegmentIndexes - 已归属闭合环的墙段索引
 * @returns 下一条墙段索引；不存在时返回 -1
 */
function findNextConnectedWallSegmentIndex(
  wallSegments: WallCenterLoopSegment[],
  currentPoint: Point2D,
  localUsedSegmentIndexes: Set<number>,
  globalUsedSegmentIndexes: Set<number>
): number {
  for (let segmentIndex: number = 0; segmentIndex < wallSegments.length; segmentIndex += 1) {
    if (localUsedSegmentIndexes.has(segmentIndex) || globalUsedSegmentIndexes.has(segmentIndex)) {
      continue;
    }

    const candidateSegment: WallCenterLoopSegment | undefined = wallSegments[segmentIndex];
    if (candidateSegment === undefined) {
      continue;
    }

    if (arePointsNearlyEqual(currentPoint, candidateSegment.start) || arePointsNearlyEqual(currentPoint, candidateSegment.end)) {
      return segmentIndex;
    }
  }

  return -1;
}

/**
 * 将当前闭合环中的墙段标记为已使用。
 * @param localUsedSegmentIndexes - 当前闭合环墙段索引
 * @param globalUsedSegmentIndexes - 全局已使用墙段索引
 */
function markWallLoopSegmentsAsUsed(localUsedSegmentIndexes: Set<number>, globalUsedSegmentIndexes: Set<number>): void {
  for (const segmentIndex of localUsedSegmentIndexes) {
    globalUsedSegmentIndexes.add(segmentIndex);
  }
}

/**
 * 根据轮廓点计算 XZ 边界。
 * @param outline - 房间水平轮廓
 * @returns XZ 边界；轮廓无效时返回 null
 */
function collectOutlineXzBounds(outline: Point2D[] | null): XzBounds | null {
  if (outline === null || outline.length < 3) {
    return null;
  }

  const bounds: XzBounds = createEmptyXzBounds();
  const hasPoint: boolean = appendOutlineToBounds(outline, bounds);
  return hasPoint ? normalizeXzBounds(bounds) : null;
}

/**
 * 从楼板/天花板轮廓获取室内 XZ 边界。
 * @param allObjects - 全部建筑对象
 * @returns XZ 边界；没有有效轮廓时返回 null
 */
function collectPrimaryRoomXzBounds(allObjects: BuildingObject[]): XzBounds | null {
  const bounds: XzBounds = createEmptyXzBounds();
  let hasPoint: boolean = false;

  for (const object of allObjects) {
    if (!object.visible) {
      continue;
    }

    if (object.category === 'slab') {
      const slab: SlabData = object as SlabData;
      hasPoint = appendOutlineToBounds(slab.outline, bounds) || hasPoint;
      continue;
    }

    if (object.category === 'ceiling') {
      const ceiling: CeilingData = object as CeilingData;
      hasPoint = appendOutlineToBounds(ceiling.outline, bounds) || hasPoint;
    }
  }

  return hasPoint ? normalizeXzBounds(bounds) : null;
}

/**
 * 从墙体与其它结构对象包围盒获取兜底 XZ 边界。
 * @param allObjects - 全部建筑对象
 * @returns XZ 边界；没有结构对象时返回 null
 */
function collectFallbackStructuralXzBounds(allObjects: BuildingObject[]): XzBounds | null {
  const bounds: XzBounds = createEmptyXzBounds();
  let hasPoint: boolean = false;

  for (const object of allObjects) {
    if (!object.visible) {
      continue;
    }

    if (object.category === 'wall') {
      hasPoint = appendWallToBounds(object as WallData, bounds) || hasPoint;
      continue;
    }

    if (object.category === 'beam') {
      appendPointToBounds(object.boundingBox.min, bounds);
      appendPointToBounds(object.boundingBox.max, bounds);
      hasPoint = true;
    }
  }

  return hasPoint ? normalizeXzBounds(bounds) : null;
}

/**
 * 收集房间结构的 Y 轴高度范围。
 * @param allObjects - 全部建筑对象
 * @returns Y 轴范围
 */
function collectStructuralYBounds(allObjects: BuildingObject[]): { minY: number; maxY: number } {
  let minY: number = Number.POSITIVE_INFINITY;
  let maxY: number = Number.NEGATIVE_INFINITY;

  for (const object of allObjects) {
    if (!object.visible) {
      continue;
    }

    if (object.category === 'slab') {
      const slab: SlabData = object as SlabData;
      minY = Math.min(minY, slab.topOffset - slab.slabThickness);
      maxY = Math.max(maxY, slab.topOffset);
      continue;
    }

    if (object.category === 'ceiling') {
      const ceiling: CeilingData = object as CeilingData;
      minY = Math.min(minY, ceiling.bottomOffset);
      maxY = Math.max(maxY, ceiling.bottomOffset + ceiling.ceilingThickness);
      continue;
    }

    if (object.category === 'wall' || object.category === 'beam') {
      const objectMinY: number = object.elevation + object.offsetY;
      const objectMaxY: number = objectMinY + object.height;
      minY = Math.min(minY, objectMinY);
      maxY = Math.max(maxY, objectMaxY);
    }
  }

  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY - minY < MIN_BOUND_SIZE) {
    return { minY: 0, maxY: DEFAULT_ROOM_HEIGHT };
  }

  return { minY: minY, maxY: maxY };
}

/**
 * 将房间室内空间转换为 Canvas CSS 像素截图保留区域。
 * 关键流程：优先把墙体最外侧边缘的世界坐标转换为屏幕坐标，并使用屏幕坐标四边形作为截图遮罩区域。
 * @param allObjects - 全部建筑对象
 * @param roomBounds - 房间世界空间边界
 * @param camera - 当前活动相机
 * @param canvasRect - Canvas DOM 尺寸
 * @param options - 裁剪参数
 * @returns CSS 像素截图保留区域；屏幕坐标转换无效时返回 null
 */
function createRoomScreenCropRegion(
  allObjects: BuildingObject[],
  roomBounds: RoomWorldBounds,
  camera: THREE.Camera,
  canvasRect: DOMRect,
  options: RoomScreenshotOptions
): CssCropRegion | null {
  const wallQuadRegion: CssCropRegion | null = createOuterWallScreenQuadCropRegion(allObjects, camera, canvasRect, options);
  if (wallQuadRegion !== null) {
    return wallQuadRegion;
  }

  /* 兜底流程：边界墙体四点无法转换为屏幕坐标时，沿用原房间柱体外接矩形，避免拍摄功能直接失败。 */
  const horizontalOutline: Point2D[] | null = collectPrimaryRoomOutline(allObjects);
  const worldPoints: THREE.Vector3[] = horizontalOutline !== null
    ? createRoomPrismWorldPoints(horizontalOutline, roomBounds.minY, roomBounds.maxY)
    : createRoomWorldCorners(roomBounds);
  let minX: number = Number.POSITIVE_INFINITY;
  let maxX: number = Number.NEGATIVE_INFINITY;
  let minY: number = Number.POSITIVE_INFINITY;
  let maxY: number = Number.NEGATIVE_INFINITY;

  for (const worldPoint of worldPoints) {
    const ndcPoint: THREE.Vector3 = worldPoint.clone().project(camera);
    if (!Number.isFinite(ndcPoint.x) || !Number.isFinite(ndcPoint.y)) {
      continue;
    }

    const screenX: number = (ndcPoint.x + 1) * 0.5 * canvasRect.width;
    const screenY: number = (-ndcPoint.y + 1) * 0.5 * canvasRect.height;
    minX = Math.min(minX, screenX);
    maxX = Math.max(maxX, screenX);
    minY = Math.min(minY, screenY);
    maxY = Math.max(maxY, screenY);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null;
  }

  const screenWidth: number = maxX - minX;
  const screenHeight: number = maxY - minY;
  const padding: number = Math.max(Math.max(screenWidth, screenHeight) * options.paddingRatio, options.minPaddingPx);
  const cropLeft: number = clampNumber(minX - padding, 0, canvasRect.width);
  const cropTop: number = clampNumber(minY - padding, 0, canvasRect.height);
  const cropRight: number = clampNumber(maxX + padding, 0, canvasRect.width);
  const cropBottom: number = clampNumber(maxY + padding, 0, canvasRect.height);
  const cropWidth: number = cropRight - cropLeft;
  const cropHeight: number = cropBottom - cropTop;

  if (cropWidth < 2 || cropHeight < 2) {
    return null;
  }

  return { x: cropLeft, y: cropTop, width: cropWidth, height: cropHeight, maskQuad: null };
}

/**
 * 收集可见墙体外边缘三维竖向边界线。
 * 关键流程：为每段墙体读取 AABB 的 XZ 外侧范围和 Y 高度范围，生成四条从墙底到墙顶的世界竖向线段。
 * @param allObjects - 全部建筑对象
 * @returns 墙体外边缘世界竖向边界线集合；没有有效墙体时返回空数组
 */
function collectOuterWallWorldVerticalBoundaryLines(allObjects: BuildingObject[]): WorldVerticalBoundaryLine[] {
  const worldLines: WorldVerticalBoundaryLine[] = [];

  for (const object of allObjects) {
    if (!object.visible || object.category !== 'wall') {
      continue;
    }

    const wallMinY: number = object.elevation + object.offsetY;
    const wallMaxY: number = wallMinY + object.height;
    if (!Number.isFinite(wallMinY) || !Number.isFinite(wallMaxY)) {
      continue;
    }

    /* 墙体外边缘线生成流程：保留四个 XZ 角点对应的竖向线，后续按当前相机投影选取最外侧线段。 */
    worldLines.push(...createWallBoundingBoxWorldVerticalBoundaryLines(object, wallMinY, wallMaxY));
  }

  return worldLines;
}

/**
 * 根据墙体 AABB 和高度生成外边缘竖向边界线。
 * @param object - 墙体建筑对象
 * @param minY - 墙体底部世界高度
 * @param maxY - 墙体顶部世界高度
 * @returns 四条世界空间竖向边界线
 */
function createWallBoundingBoxWorldVerticalBoundaryLines(
  object: BuildingObject,
  minY: number,
  maxY: number
): WorldVerticalBoundaryLine[] {
  const minX: number = object.boundingBox.min.x;
  const maxX: number = object.boundingBox.max.x;
  const minZ: number = object.boundingBox.min.z;
  const maxZ: number = object.boundingBox.max.z;
  const lines: WorldVerticalBoundaryLine[] = [
    { top: new THREE.Vector3(minX, maxY, minZ), bottom: new THREE.Vector3(minX, minY, minZ) },
    { top: new THREE.Vector3(maxX, maxY, minZ), bottom: new THREE.Vector3(maxX, minY, minZ) },
    { top: new THREE.Vector3(maxX, maxY, maxZ), bottom: new THREE.Vector3(maxX, minY, maxZ) },
    { top: new THREE.Vector3(minX, maxY, maxZ), bottom: new THREE.Vector3(minX, minY, maxZ) },
  ];

  return lines;
}

/**
 * 将墙体最外侧边缘世界坐标转换为截图保留四边形。
 * 关键流程：把所有可见墙体外边缘竖向线转换到 Canvas 屏幕坐标，再取当前视图内左右最外侧竖向线构造四点遮罩。
 * @param allObjects - 全部建筑对象
 * @param camera - 当前活动相机
 * @param canvasRect - Canvas DOM 尺寸
 * @param options - 截图裁剪参数
 * @returns 带四点遮罩的 CSS 裁剪区域；屏幕坐标转换失败时返回 null
 */
function createOuterWallScreenQuadCropRegion(
  allObjects: BuildingObject[],
  camera: THREE.Camera,
  canvasRect: DOMRect,
  options: RoomScreenshotOptions
): CssCropRegion | null {
  const wallWorldLines: WorldVerticalBoundaryLine[] = collectOuterWallWorldVerticalBoundaryLines(allObjects);
  if (wallWorldLines.length <= 0) {
    return null;
  }

  const screenLines: CssVerticalBoundaryLine[] = [];
  for (const worldLine of wallWorldLines) {
    const screenLine: CssVerticalBoundaryLine | null = convertWorldVerticalBoundaryLineToScreenLine(worldLine, camera, canvasRect);
    if (screenLine !== null && isScreenVerticalBoundaryLineVisible(screenLine, canvasRect)) {
      screenLines.push(screenLine);
    }
  }

  const maskQuad: CssScreenQuad | null = createOuterVerticalBoundaryScreenQuad(screenLines);
  if (maskQuad === null) {
    return null;
  }

  const cropRegion: CssCropRegion | null = createCropRegionFromMaskQuad(maskQuad, canvasRect, options);
  if (cropRegion === null) {
    console.warn('[房间拍摄] 墙体外边缘屏幕坐标四点区域过小，回退为房间外接裁剪');
  }

  return cropRegion;
}

/**
 * 将世界空间竖向边界线转换为 Canvas CSS 屏幕线段。
 * @param worldLine - 世界空间竖向边界线
 * @param camera - 当前活动相机
 * @param canvasRect - Canvas DOM 尺寸
 * @returns 屏幕空间竖向边界线；任一端点转换失败时返回 null
 */
function convertWorldVerticalBoundaryLineToScreenLine(
  worldLine: WorldVerticalBoundaryLine,
  camera: THREE.Camera,
  canvasRect: DOMRect
): CssVerticalBoundaryLine | null {
  const topPoint: CssPoint | null = convertWorldPointToScreenPoint(worldLine.top, camera, canvasRect);
  const bottomPoint: CssPoint | null = convertWorldPointToScreenPoint(worldLine.bottom, camera, canvasRect);
  if (topPoint === null || bottomPoint === null) {
    return null;
  }

  return createOrderedScreenVerticalBoundaryLine(topPoint, bottomPoint);
}

/**
 * 按屏幕 Y 坐标整理竖向边界线端点。
 * @param firstPoint - 第一个端点
 * @param secondPoint - 第二个端点
 * @returns 顶部点在前、底部点在后的屏幕竖向边界线
 */
function createOrderedScreenVerticalBoundaryLine(firstPoint: CssPoint, secondPoint: CssPoint): CssVerticalBoundaryLine {
  if (firstPoint.y <= secondPoint.y) {
    return { top: firstPoint, bottom: secondPoint };
  }

  return { top: secondPoint, bottom: firstPoint };
}

/**
 * 判断竖向边界线是否与当前 Canvas 视图有交集。
 * @param screenLine - 屏幕竖向边界线
 * @param canvasRect - Canvas DOM 尺寸
 * @returns 线段至少部分落在当前视图范围内时返回 true
 */
function isScreenVerticalBoundaryLineVisible(screenLine: CssVerticalBoundaryLine, canvasRect: DOMRect): boolean {
  const lineMinX: number = Math.min(screenLine.top.x, screenLine.bottom.x);
  const lineMaxX: number = Math.max(screenLine.top.x, screenLine.bottom.x);
  const lineMinY: number = Math.min(screenLine.top.y, screenLine.bottom.y);
  const lineMaxY: number = Math.max(screenLine.top.y, screenLine.bottom.y);

  if (lineMaxX < 0 || lineMinX > canvasRect.width) {
    return false;
  }

  if (lineMaxY < 0 || lineMinY > canvasRect.height) {
    return false;
  }

  return computeScreenVerticalBoundaryLineLength(screenLine) >= 2;
}

/**
 * 根据 Canvas 屏幕竖向边界线创建最外侧四边形遮罩。
 * @param screenLines - 墙体外边缘转换到 Canvas 后的 CSS 像素竖向线段
 * @returns 由当前视图内左右最外侧竖向边界线围成的四边形；线段不足或尺寸过小时返回 null
 */
function createOuterVerticalBoundaryScreenQuad(screenLines: CssVerticalBoundaryLine[]): CssScreenQuad | null {
  if (screenLines.length < 2) {
    return null;
  }

  let leftLine: CssVerticalBoundaryLine | null = null;
  let rightLine: CssVerticalBoundaryLine | null = null;
  let minCenterX: number = Number.POSITIVE_INFINITY;
  let maxCenterX: number = Number.NEGATIVE_INFINITY;

  /* 最外侧边界识别流程：以每条竖向线段的屏幕横向中心为基准，选出当前视图内最左和最右的墙体边界线。 */
  for (const screenLine of screenLines) {
    const centerX: number = computeScreenVerticalBoundaryLineCenterX(screenLine);
    if (centerX < minCenterX) {
      minCenterX = centerX;
      leftLine = screenLine;
    }

    if (centerX > maxCenterX) {
      maxCenterX = centerX;
      rightLine = screenLine;
    }
  }

  if (leftLine === null || rightLine === null || leftLine === rightLine) {
    return null;
  }

  const maskWidth: number = Math.abs(computeScreenVerticalBoundaryLineCenterX(rightLine) - computeScreenVerticalBoundaryLineCenterX(leftLine));
  const maskHeight: number = Math.max(computeScreenVerticalBoundaryLineLength(leftLine), computeScreenVerticalBoundaryLineLength(rightLine));
  if (maskWidth < 2 || maskHeight < 2) {
    return null;
  }

  return {
    topLeft: leftLine.top,
    topRight: rightLine.top,
    bottomRight: rightLine.bottom,
    bottomLeft: leftLine.bottom,
  };
}

/**
 * 计算屏幕竖向边界线的横向中心。
 * @param screenLine - 屏幕竖向边界线
 * @returns 线段两个端点 X 坐标的平均值
 */
function computeScreenVerticalBoundaryLineCenterX(screenLine: CssVerticalBoundaryLine): number {
  return (screenLine.top.x + screenLine.bottom.x) * 0.5;
}

/**
 * 计算屏幕竖向边界线长度。
 * @param screenLine - 屏幕竖向边界线
 * @returns 屏幕线段长度，单位为 CSS 像素
 */
function computeScreenVerticalBoundaryLineLength(screenLine: CssVerticalBoundaryLine): number {
  const deltaX: number = screenLine.top.x - screenLine.bottom.x;
  const deltaY: number = screenLine.top.y - screenLine.bottom.y;
  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}

/**
 * 将世界坐标点转换到 Canvas CSS 屏幕坐标。
 * @param worldPoint - 世界空间点
 * @param camera - 当前活动相机
 * @param canvasRect - Canvas DOM 尺寸
 * @returns CSS 屏幕坐标点；转换数值无效时返回 null
 */
function convertWorldPointToScreenPoint(worldPoint: THREE.Vector3, camera: THREE.Camera, canvasRect: DOMRect): CssPoint | null {
  const ndcPoint: THREE.Vector3 = worldPoint.clone().project(camera);
  if (!Number.isFinite(ndcPoint.x) || !Number.isFinite(ndcPoint.y)) {
    return null;
  }

  /* 坐标转换流程：Three.js 先将世界坐标转换为 NDC，再按 Canvas CSS 尺寸换算为屏幕坐标。 */
  const screenX: number = (ndcPoint.x + 1) * 0.5 * canvasRect.width;
  const screenY: number = (-ndcPoint.y + 1) * 0.5 * canvasRect.height;
  return { x: screenX, y: screenY };
}

/**
 * 根据四点遮罩计算 Canvas 裁剪区域。
 * @param maskQuad - CSS 像素四点遮罩区域
 * @param canvasRect - Canvas DOM 尺寸
 * @param options - 截图裁剪参数
 * @returns 带遮罩的裁剪区域；区域过小时返回 null
 */
function createCropRegionFromMaskQuad(maskQuad: CssScreenQuad, canvasRect: DOMRect, options: RoomScreenshotOptions): CssCropRegion | null {
  const points: CssPoint[] = [maskQuad.topLeft, maskQuad.topRight, maskQuad.bottomRight, maskQuad.bottomLeft];
  let minX: number = Number.POSITIVE_INFINITY;
  let maxX: number = Number.NEGATIVE_INFINITY;
  let minY: number = Number.POSITIVE_INFINITY;
  let maxY: number = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const screenWidth: number = maxX - minX;
  const screenHeight: number = maxY - minY;
  const padding: number = Math.max(Math.max(screenWidth, screenHeight) * options.paddingRatio, options.minPaddingPx);
  const cropLeft: number = clampNumber(minX - padding, 0, canvasRect.width);
  const cropTop: number = clampNumber(minY - padding, 0, canvasRect.height);
  const cropRight: number = clampNumber(maxX + padding, 0, canvasRect.width);
  const cropBottom: number = clampNumber(maxY + padding, 0, canvasRect.height);
  const cropWidth: number = cropRight - cropLeft;
  const cropHeight: number = cropBottom - cropTop;

  if (cropWidth < 2 || cropHeight < 2) {
    return null;
  }

  return { x: cropLeft, y: cropTop, width: cropWidth, height: cropHeight, maskQuad: maskQuad };
}

/**
 * 裁剪 Canvas 并导出 PNG DataURL。
 * @param sourceCanvas - 源 Canvas
 * @param sourceRect - 源 Canvas 的 CSS 尺寸
 * @param cropRegion - CSS 像素截图保留区域
 * @returns PNG DataURL
 */
function cropCanvasToDataUrl(
  sourceCanvas: HTMLCanvasElement,
  sourceRect: DOMRect,
  cropRegion: CssCropRegion
): string {
  const scaleX: number = sourceCanvas.width / sourceRect.width;
  const scaleY: number = sourceCanvas.height / sourceRect.height;
  const sourceX: number = Math.floor(cropRegion.x * scaleX);
  const sourceY: number = Math.floor(cropRegion.y * scaleY);
  const sourceWidth: number = Math.max(1, Math.floor(cropRegion.width * scaleX));
  const sourceHeight: number = Math.max(1, Math.floor(cropRegion.height * scaleY));
  const targetCanvas: HTMLCanvasElement = document.createElement('canvas');
  targetCanvas.width = sourceWidth;
  targetCanvas.height = sourceHeight;

  const context: CanvasRenderingContext2D | null = targetCanvas.getContext('2d');
  if (context === null) {
    console.warn('[房间拍摄] 无法创建 2D 裁剪画布，回退为当前完整画面');
    return sourceCanvas.toDataURL('image/png');
  }

  /* 裁剪流程：若存在边界墙体四点遮罩，则只绘制顶部到底部四点连接区域，区域外保持透明。 */
  context.clearRect(0, 0, sourceWidth, sourceHeight);
  if (cropRegion.maskQuad !== null) {
    clipContextToMaskQuad(context, cropRegion.maskQuad, cropRegion, scaleX, scaleY);
  }

  context.drawImage(sourceCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);

  return targetCanvas.toDataURL('image/png');
}

/**
 * 将 2D 绘图上下文裁剪到四点遮罩区域。
 * @param context - 目标 Canvas 2D 上下文
 * @param maskQuad - CSS 像素四点遮罩区域
 * @param cropRegion - 当前裁剪区域
 * @param scaleX - CSS 像素到真实 Canvas 像素的 X 缩放比例
 * @param scaleY - CSS 像素到真实 Canvas 像素的 Y 缩放比例
 */
function clipContextToMaskQuad(
  context: CanvasRenderingContext2D,
  maskQuad: CssScreenQuad,
  cropRegion: CssCropRegion,
  scaleX: number,
  scaleY: number
): void {
  const topLeft: CssPoint = convertCssPointToLocalCanvasPoint(maskQuad.topLeft, cropRegion, scaleX, scaleY);
  const topRight: CssPoint = convertCssPointToLocalCanvasPoint(maskQuad.topRight, cropRegion, scaleX, scaleY);
  const bottomRight: CssPoint = convertCssPointToLocalCanvasPoint(maskQuad.bottomRight, cropRegion, scaleX, scaleY);
  const bottomLeft: CssPoint = convertCssPointToLocalCanvasPoint(maskQuad.bottomLeft, cropRegion, scaleX, scaleY);

  context.beginPath();
  context.moveTo(topLeft.x, topLeft.y);
  context.lineTo(topRight.x, topRight.y);
  context.lineTo(bottomRight.x, bottomRight.y);
  context.lineTo(bottomLeft.x, bottomLeft.y);
  context.closePath();
  context.clip();
}

/**
 * 将全局 CSS 像素点转换为裁剪 Canvas 内部像素点。
 * @param point - 全局 CSS 像素点
 * @param cropRegion - 当前裁剪区域
 * @param scaleX - CSS 像素到真实 Canvas 像素的 X 缩放比例
 * @param scaleY - CSS 像素到真实 Canvas 像素的 Y 缩放比例
 * @returns 裁剪 Canvas 内部像素点
 */
function convertCssPointToLocalCanvasPoint(point: CssPoint, cropRegion: CssCropRegion, scaleX: number, scaleY: number): CssPoint {
  return {
    x: (point.x - cropRegion.x) * scaleX,
    y: (point.y - cropRegion.y) * scaleY,
  };
}

/**
 * 由水平轮廓和上下高度生成房间三维柱体世界点。
 * @param outline - 房间水平轮廓
 * @param minY - 房间底部高度
 * @param maxY - 房间顶部高度
 * @returns 上下两层世界空间点
 */
function createRoomPrismWorldPoints(outline: Point2D[], minY: number, maxY: number): THREE.Vector3[] {
  const worldPoints: THREE.Vector3[] = [];
  for (const point of outline) {
    worldPoints.push(new THREE.Vector3(point.x, minY, point.z));
    worldPoints.push(new THREE.Vector3(point.x, maxY, point.z));
  }
  return worldPoints;
}


/**
 * 生成房间世界空间包围盒的 8 个角点。
 * @param bounds - 房间世界空间边界
 * @returns 世界空间角点列表
 */
function createRoomWorldCorners(bounds: RoomWorldBounds): THREE.Vector3[] {
  const corners: THREE.Vector3[] = [];
  const xValues: number[] = [bounds.minX, bounds.maxX];
  const yValues: number[] = [bounds.minY, bounds.maxY];
  const zValues: number[] = [bounds.minZ, bounds.maxZ];

  for (const xValue of xValues) {
    for (const yValue of yValues) {
      for (const zValue of zValues) {
        corners.push(new THREE.Vector3(xValue, yValue, zValue));
      }
    }
  }

  return corners;
}

/**
 * 将墙体几何关键点追加到边界。
 * @param wall - 墙体数据
 * @param bounds - 待更新边界
 * @returns 是否追加了有效点
 */
function appendWallToBounds(wall: WallData, bounds: XzBounds): boolean {
  if (wall.subType === 'rect') {
    const rectWall: RectWallData = wall as RectWallData;
    appendPointToBounds(rectWall.corner1, bounds);
    appendPointToBounds(rectWall.corner2, bounds);
    return true;
  }

  appendPointToBounds(wall.start, bounds);
  appendPointToBounds(wall.end, bounds);
  appendPointToBounds(wall.boundingBox.min, bounds);
  appendPointToBounds(wall.boundingBox.max, bounds);
  return true;
}

/**
 * 将多边形轮廓追加到边界。
 * @param outline - XZ 轮廓点列表
 * @param bounds - 待更新边界
 * @returns 是否追加了有效点
 */
function appendOutlineToBounds(outline: Point2D[], bounds: XzBounds): boolean {
  let hasPoint: boolean = false;
  for (const point of outline) {
    appendPointToBounds(point, bounds);
    hasPoint = true;
  }
  return hasPoint;
}

/**
 * 将轮廓点追加到目标列表。
 * @param outline - 原始轮廓
 * @param target - 目标点列表
 */
function appendOutlinePoints(outline: Point2D[], target: Point2D[]): void {
  for (const point of outline) {
    target.push(point);
  }
}

/**
 * 计算 XZ 轮廓有符号面积的二倍。
 * @param outline - 需要计算面积的闭合轮廓，首尾不重复
 * @returns 有符号面积二倍值；正负代表绕行方向
 */
function computePointOutlineSignedArea(outline: Point2D[]): number {
  let signedArea: number = 0;
  for (let pointIndex: number = 0; pointIndex < outline.length; pointIndex += 1) {
    const currentPoint: Point2D | undefined = outline[pointIndex];
    const nextPoint: Point2D | undefined = outline[(pointIndex + 1) % outline.length];
    if (currentPoint === undefined || nextPoint === undefined) {
      continue;
    }

    signedArea += currentPoint.x * nextPoint.z - nextPoint.x * currentPoint.z;
  }

  return signedArea;
}

/**
 * 计算两个 XZ 点之间的平面距离。
 * @param firstPoint - 第一个点
 * @param secondPoint - 第二个点
 * @returns 两点距离，单位：米
 */
function computePointDistance(firstPoint: Point2D, secondPoint: Point2D): number {
  const deltaX: number = firstPoint.x - secondPoint.x;
  const deltaZ: number = firstPoint.z - secondPoint.z;
  return Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
}

/**
 * 判断两个 XZ 点是否在墙体端点容差范围内重合。
 * @param firstPoint - 第一个点
 * @param secondPoint - 第二个点
 * @returns 距离小于等于端点连接容差时返回 true
 */
function arePointsNearlyEqual(firstPoint: Point2D, secondPoint: Point2D): boolean {
  return computePointDistance(firstPoint, secondPoint) <= WALL_LOOP_POINT_TOLERANCE;
}

/**
 * 将单个 XZ 点追加到边界。
 * @param point - XZ 点
 * @param bounds - 待更新边界
 */
function appendPointToBounds(point: Point2D, bounds: XzBounds): void {
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.minZ = Math.min(bounds.minZ, point.z);
  bounds.maxZ = Math.max(bounds.maxZ, point.z);
}

/**
 * 创建空 XZ 边界。
 * @returns 空边界
 */
function createEmptyXzBounds(): XzBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
}

/**
 * 规范化 XZ 边界，避免单点/单线房间导致宽高为 0。
 * @param bounds - 原始边界
 * @returns 规范化边界
 */
function normalizeXzBounds(bounds: XzBounds): XzBounds {
  const normalized: XzBounds = {
    minX: bounds.minX,
    maxX: bounds.maxX,
    minZ: bounds.minZ,
    maxZ: bounds.maxZ,
  };

  if (normalized.maxX - normalized.minX < MIN_BOUND_SIZE) {
    normalized.minX -= 0.5;
    normalized.maxX += 0.5;
  }

  if (normalized.maxZ - normalized.minZ < MIN_BOUND_SIZE) {
    normalized.minZ -= 0.5;
    normalized.maxZ += 0.5;
  }

  return normalized;
}

/**
 * 将数值限制到指定区间。
 * @param value - 原始数值
 * @param minValue - 最小值
 * @param maxValue - 最大值
 * @returns 限制后的数值
 */
function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.min(Math.max(value, minValue), maxValue);
}