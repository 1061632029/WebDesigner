/**
 * 楼板边界长度与面积标注组件
 * 在 2D 俯视模式下，按楼板 SlabData.outline 的每一条边渲染长度文字，并在楼板中心渲染面积文字。
 *
 * 渲染方式：Three.js Sprite + CanvasTexture
 * - 文字样式采用白色填充 + 黑色描边，贴近示例图中的边界长度标注效果
 * - 标注沿楼板边界方向旋转，并向楼板内部轻微偏移，避免覆盖边界线
 * - 组件仅负责楼板边界长度与面积，不再依赖原矩形墙永久尺寸标注
 */

import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three/webgpu';
import { useEngine } from '../hooks/useEngine';
import { useBuildingContext } from '../context/BuildingContext';
import type { BuildingObject } from '../../building/BuildingTypes';
import type { Point2D } from '../../building/BuildingTypes';
import type { SlabData } from '../../building/BuildingTypes';
import { computePolygonArea, computePolygonCentroid } from '../../building/AreaCalculator';
import type { Engine } from '../../core/Engine';

/** 单条楼板边界长度标注数据 */
interface FloorBoundaryDimensionEntry {
  /** 标注唯一键，格式为 slabId:index */
  key: string;
  /** Three.js Sprite 实例 */
  sprite: THREE.Sprite;
}

/** 单个楼板面积标注数据 */
interface FloorAreaLabelEntry {
  /** 标注唯一键，格式为 area:slabId */
  key: string;
  /** Three.js Sprite 实例 */
  sprite: THREE.Sprite;
}

/** 楼板边界段信息 */
interface FloorBoundarySegmentInfo {
  /** 标注唯一键 */
  key: string;
  /** 长度文字，单位为毫米 */
  text: string;
  /** 标注世界坐标 */
  position: THREE.Vector3;
  /** 屏幕平面旋转角度 */
  rotation: number;
}

/** 楼板中心面积标注信息 */
interface FloorAreaLabelInfo {
  /** 标注唯一键 */
  key: string;
  /** 楼板名称文本 */
  nameText: string;
  /** 面积文本，单位平方米 */
  areaText: string;
  /** 标注世界坐标 */
  position: THREE.Vector3;
}

/** 楼板边界标注的最小边长，低于该值不显示，避免零长度边产生噪声 */
const MIN_SEGMENT_LENGTH_METERS: number = 0.001;

/** 标注向楼板内部偏移的距离，单位：米 */
const LABEL_INWARD_OFFSET_METERS: number = 0.35;

/** 标注抬高高度，避免与楼板材质 z-fighting */
const LABEL_HEIGHT_METERS: number = 0.08;

/** 面积标注抬高高度，略高于边长标注以避免同层透明排序冲突 */
const AREA_LABEL_HEIGHT_METERS: number = 0.1;

/** Sprite 宽度世界尺寸，单位：米 */
const LABEL_WIDTH_METERS: number = 1.25;

/** Sprite 高度世界尺寸，单位：米 */
const LABEL_HEIGHT_WORLD_METERS: number = 0.38;

/** 面积 Sprite 宽度世界尺寸，单位：米 */
const AREA_LABEL_WIDTH_METERS: number = 1.65;

/** 面积 Sprite 高度世界尺寸，单位：米 */
const AREA_LABEL_HEIGHT_WORLD_METERS: number = 0.72;

/** 面积标注的最小面积，低于该值不显示，避免退化楼板产生噪声 */
const MIN_AREA_SQUARE_METERS: number = 0.000001;

/**
 * 创建楼板边界长度文字纹理
 * 关键流程：先绘制黑色描边，再绘制白色文字，以保证浅色楼板/网格背景上可读。
 * @param text - 长度文字，单位为毫米
 * @returns CanvasTexture 纹理
 */
function createFloorBoundaryDimensionTexture(text: string): THREE.CanvasTexture {
  const canvasWidth: number = 256;
  const canvasHeight: number = 96;
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const ctx: CanvasRenderingContext2D = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  /* 绘制文字描边与填充，形成示例图中白字黑边的标注样式。 */
  ctx.font = 'bold 36px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(20, 24, 32, 0.95)';
  ctx.lineWidth = 7;
  ctx.strokeText(text, canvasWidth / 2, canvasHeight / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);

  const texture: THREE.CanvasTexture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * 创建楼板中心面积文字纹理
 * 关键流程：绘制两行文本，第一行为楼板名称，第二行为面积；每行都使用黑色描边增强可读性。
 * @param nameText - 楼板名称
 * @param areaText - 面积文字，单位平方米
 * @returns CanvasTexture 纹理
 */
function createFloorAreaLabelTexture(nameText: string, areaText: string): THREE.CanvasTexture {
  const canvasWidth: number = 320;
  const canvasHeight: number = 150;
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const ctx: CanvasRenderingContext2D = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  /* 绘制中心面积标注：两行白字黑边，保持与边长标注一致的视觉风格。 */
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(20, 24, 32, 0.95)';
  ctx.fillStyle = '#ffffff';

  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.lineWidth = 6;
  ctx.strokeText(nameText, canvasWidth / 2, 55);
  ctx.fillText(nameText, canvasWidth / 2, 55);

  ctx.font = 'bold 32px Arial, sans-serif';
  ctx.lineWidth = 6;
  ctx.strokeText(areaText, canvasWidth / 2, 96);
  ctx.fillText(areaText, canvasWidth / 2, 96);

  const texture: THREE.CanvasTexture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * 创建单个楼板边界长度 Sprite
 * @param segment - 楼板边界段标注信息
 * @returns Sprite 实例
 */
function createFloorBoundaryDimensionSprite(segment: FloorBoundarySegmentInfo): THREE.Sprite {
  const texture: THREE.CanvasTexture = createFloorBoundaryDimensionTexture(segment.text);
  const material: THREE.SpriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  material.rotation = segment.rotation;

  const sprite: THREE.Sprite = new THREE.Sprite(material);
  sprite.position.copy(segment.position);
  sprite.scale.set(LABEL_WIDTH_METERS, LABEL_HEIGHT_WORLD_METERS, 1.0);
  sprite.renderOrder = 1001;
  return sprite;
}

/**
 * 创建单个楼板中心面积 Sprite
 * @param labelInfo - 楼板面积标注信息
 * @returns Sprite 实例
 */
function createFloorAreaLabelSprite(labelInfo: FloorAreaLabelInfo): THREE.Sprite {
  const texture: THREE.CanvasTexture = createFloorAreaLabelTexture(labelInfo.nameText, labelInfo.areaText);
  const material: THREE.SpriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const sprite: THREE.Sprite = new THREE.Sprite(material);
  sprite.position.copy(labelInfo.position);
  sprite.scale.set(AREA_LABEL_WIDTH_METERS, AREA_LABEL_HEIGHT_WORLD_METERS, 1.0);
  sprite.renderOrder = 1002;
  return sprite;
}

/**
 * 释放楼板边界长度 Sprite 资源
 * @param scene - Three.js 场景
 * @param entry - 待释放的标注项
 */
function disposeFloorBoundaryDimensionEntry(scene: THREE.Scene, entry: FloorBoundaryDimensionEntry): void {
  scene.remove(entry.sprite);
  entry.sprite.material.map?.dispose();
  entry.sprite.material.dispose();
}

/**
 * 释放楼板中心面积 Sprite 资源
 * @param scene - Three.js 场景
 * @param entry - 待释放的面积标注项
 */
function disposeFloorAreaLabelEntry(scene: THREE.Scene, entry: FloorAreaLabelEntry): void {
  scene.remove(entry.sprite);
  entry.sprite.material.map?.dispose();
  entry.sprite.material.dispose();
}

/**
 * 计算楼板每条边界的长度标注信息
 * @param slab - 楼板数据
 * @returns 边界长度标注信息列表
 */
function computeFloorBoundarySegments(slab: SlabData): FloorBoundarySegmentInfo[] {
  const outline: Point2D[] = slab.outline;
  const segments: FloorBoundarySegmentInfo[] = [];
  if (outline.length < 3) {
    return segments;
  }

  const centroid: Point2D = computePolygonCentroid(outline);
  for (let index: number = 0; index < outline.length; index++) {
    const start: Point2D = outline[index]!;
    const endIndex: number = (index + 1) % outline.length;
    const end: Point2D = outline[endIndex]!;
    const deltaX: number = end.x - start.x;
    const deltaZ: number = end.z - start.z;
    const lengthMeters: number = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
    if (lengthMeters <= MIN_SEGMENT_LENGTH_METERS) {
      continue;
    }

    const midpointX: number = (start.x + end.x) * 0.5;
    const midpointZ: number = (start.z + end.z) * 0.5;
    const inwardX: number = centroid.x - midpointX;
    const inwardZ: number = centroid.z - midpointZ;
    const inwardLength: number = Math.sqrt(inwardX * inwardX + inwardZ * inwardZ);
    const offsetScale: number = inwardLength > MIN_SEGMENT_LENGTH_METERS
      ? LABEL_INWARD_OFFSET_METERS / inwardLength
      : 0;
    const positionX: number = midpointX + inwardX * offsetScale;
    const positionZ: number = midpointZ + inwardZ * offsetScale;

    /* 2D 正交俯视下，SpriteMaterial.rotation 控制屏幕平面角度，使文字沿边界方向摆放。 */
    const rotation: number = -Math.atan2(deltaZ, deltaX);
    const lengthMillimeters: number = Math.round(lengthMeters * 1000);
    const text: string = `${lengthMillimeters}`;

    segments.push({
      key: `${slab.id}:${index}`,
      text: text,
      position: new THREE.Vector3(positionX, LABEL_HEIGHT_METERS, positionZ),
      rotation: rotation,
    });
  }

  return segments;
}

/**
 * 计算楼板中心面积标注信息
 * @param slab - 楼板数据
 * @returns 面积标注信息；退化楼板返回 null
 */
function computeFloorAreaLabel(slab: SlabData): FloorAreaLabelInfo | null {
  const outline: Point2D[] = slab.outline;
  if (outline.length < 3) {
    return null;
  }

  const areaSquareMeters: number = computePolygonArea(outline);
  if (areaSquareMeters <= MIN_AREA_SQUARE_METERS) {
    return null;
  }

  const centroid: Point2D = computePolygonCentroid(outline);
  const rawNameText: string = slab.name.trim();
  const nameText: string = rawNameText.length > 0 ? rawNameText : '未命名';
  const areaText: string = `${areaSquareMeters.toFixed(2)}m²`;

  return {
    key: `area:${slab.id}`,
    nameText: nameText,
    areaText: areaText,
    position: new THREE.Vector3(centroid.x, AREA_LABEL_HEIGHT_METERS, centroid.z),
  };
}

/**
 * 楼板边界长度与面积标注组件
 * 关键流程：监听建筑对象数量变化，遍历所有 SlabData，按 outline 边界生成/更新/移除长度和面积标注。
 */
export function FloorBoundaryDimensionLabel(): null {
  const engine: Engine = useEngine();
  const { objectManager, objectCount } = useBuildingContext();
  const labelsRef: MutableRefObject<Map<string, FloorBoundaryDimensionEntry>> = useRef<Map<string, FloorBoundaryDimensionEntry>>(
    new Map<string, FloorBoundaryDimensionEntry>()
  );
  const areaLabelsRef: MutableRefObject<Map<string, FloorAreaLabelEntry>> = useRef<Map<string, FloorAreaLabelEntry>>(
    new Map<string, FloorAreaLabelEntry>()
  );

  useEffect((): (() => void) => {
    if (objectManager === null) {
      return (): void => { /* 建筑对象管理器未就绪，无需清理。 */ };
    }

    const scene: THREE.Scene = engine.sceneManager.getScene();
    const currentLabels: Map<string, FloorBoundaryDimensionEntry> = labelsRef.current;
    const currentAreaLabels: Map<string, FloorAreaLabelEntry> = areaLabelsRef.current;
    const allObjects: BuildingObject[] = objectManager.getAll();
    const slabs: SlabData[] = allObjects.filter(
      (objectData: BuildingObject): objectData is SlabData => objectData.category === 'slab'
    );
    const nextSegments: FloorBoundarySegmentInfo[] = [];
    const nextAreaLabels: FloorAreaLabelInfo[] = [];
    for (const slab of slabs) {
      nextSegments.push(...computeFloorBoundarySegments(slab));
      const areaLabelInfo: FloorAreaLabelInfo | null = computeFloorAreaLabel(slab);
      if (areaLabelInfo !== null) {
        nextAreaLabels.push(areaLabelInfo);
      }
    }

    const nextKeys: Set<string> = new Set<string>(nextSegments.map((segment: FloorBoundarySegmentInfo): string => segment.key));
    for (const [key, entry] of currentLabels) {
      if (!nextKeys.has(key)) {
        disposeFloorBoundaryDimensionEntry(scene, entry);
        currentLabels.delete(key);
      }
    }

    /* 对新增或已存在的边界标注进行同步，保证楼板重建后文字、位置和角度一致。 */
    for (const segment of nextSegments) {
      const existing: FloorBoundaryDimensionEntry | undefined = currentLabels.get(segment.key);
      if (existing !== undefined) {
        const nextTexture: THREE.CanvasTexture = createFloorBoundaryDimensionTexture(segment.text);
        existing.sprite.material.map?.dispose();
        existing.sprite.material.map = nextTexture;
        existing.sprite.material.rotation = segment.rotation;
        existing.sprite.material.needsUpdate = true;
        existing.sprite.position.copy(segment.position);
        continue;
      }

      const sprite: THREE.Sprite = createFloorBoundaryDimensionSprite(segment);
      scene.add(sprite);
      currentLabels.set(segment.key, { key: segment.key, sprite: sprite });
    }

    const nextAreaKeys: Set<string> = new Set<string>(nextAreaLabels.map((labelInfo: FloorAreaLabelInfo): string => labelInfo.key));
    for (const [key, entry] of currentAreaLabels) {
      if (!nextAreaKeys.has(key)) {
        disposeFloorAreaLabelEntry(scene, entry);
        currentAreaLabels.delete(key);
      }
    }

    /* 对楼板中心面积标注进行同步，保证名称、面积和中心位置随楼板数据变化刷新。 */
    for (const labelInfo of nextAreaLabels) {
      const existing: FloorAreaLabelEntry | undefined = currentAreaLabels.get(labelInfo.key);
      if (existing !== undefined) {
        const nextTexture: THREE.CanvasTexture = createFloorAreaLabelTexture(labelInfo.nameText, labelInfo.areaText);
        existing.sprite.material.map?.dispose();
        existing.sprite.material.map = nextTexture;
        existing.sprite.material.needsUpdate = true;
        existing.sprite.position.copy(labelInfo.position);
        continue;
      }

      const sprite: THREE.Sprite = createFloorAreaLabelSprite(labelInfo);
      scene.add(sprite);
      currentAreaLabels.set(labelInfo.key, { key: labelInfo.key, sprite: sprite });
    }

    return (): void => { /* 组件更新时保留现有 Sprite，卸载阶段统一释放资源。 */ };
  }, [engine, objectManager, objectCount]);

  useEffect((): (() => void) => {
    return (): void => {
      const scene: THREE.Scene = engine.sceneManager.getScene();
      const currentLabels: Map<string, FloorBoundaryDimensionEntry> = labelsRef.current;
      for (const entry of currentLabels.values()) {
        disposeFloorBoundaryDimensionEntry(scene, entry);
      }
      currentLabels.clear();
      const currentAreaLabels: Map<string, FloorAreaLabelEntry> = areaLabelsRef.current;
      for (const entry of currentAreaLabels.values()) {
        disposeFloorAreaLabelEntry(scene, entry);
      }
      currentAreaLabels.clear();
    };
  }, [engine]);

  return null;
}