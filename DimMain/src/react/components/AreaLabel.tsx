/**
 * 面积标注组件
 * 在 2D 俯视模式下，对每个封闭墙体围合区域（楼板 SlabData）
 * 在其质心位置渲染面积文字标注（单位：平方米）
 *
 * 渲染方式：Three.js Sprite + CanvasTexture
 * - 不依赖 CSS2DRenderer，直接在 Three.js 场景中渲染
 * - Sprite 始终朝向相机（正交相机下即朝向 +Y 方向）
 * - 每次 objectCount 变化时重新计算并更新所有标注
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { useEngine } from '../hooks/useEngine';
import { useBuildingContext } from '../context/BuildingContext';
import type { BuildingObject } from '../../building/BuildingTypes';
import type { SlabData } from '../../building/BuildingTypes';
import type { Point2D } from '../../building/BuildingTypes';
import { computePolygonArea } from '../../building/AreaCalculator';
import { computePolygonCentroid } from '../../building/AreaCalculator';
import type { Engine } from '../../core/Engine';

/**
 * 单个面积标注的内部数据结构
 */
interface AreaLabelEntry {
  /** 对应的楼板 ID */
  slabId: string;
  /** Three.js Sprite 实例 */
  sprite: THREE.Sprite;
}

/**
 * 创建面积文字纹理
 * 使用 Canvas 2D API 绘制带背景的面积文字
 *
 * @param text - 要显示的文字（如 "12.5 m²"）
 * @returns 生成的 CanvasTexture
 */
function createAreaTexture(text: string): THREE.CanvasTexture {
  /* Canvas 尺寸（像素），越大越清晰 */
  const canvasWidth: number = 256;
  const canvasHeight: number = 80;

  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const ctx: CanvasRenderingContext2D = canvas.getContext('2d') as CanvasRenderingContext2D;

  /* 清空背景（透明） */
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  /* 绘制半透明圆角矩形背景 */
  const padding: number = 8;
  const radius: number = 10;
  ctx.fillStyle = 'rgba(20, 30, 50, 0.75)';
  ctx.beginPath();
  ctx.moveTo(padding + radius, padding);
  ctx.lineTo(canvasWidth - padding - radius, padding);
  ctx.arcTo(canvasWidth - padding, padding, canvasWidth - padding, padding + radius, radius);
  ctx.lineTo(canvasWidth - padding, canvasHeight - padding - radius);
  ctx.arcTo(canvasWidth - padding, canvasHeight - padding, canvasWidth - padding - radius, canvasHeight - padding, radius);
  ctx.lineTo(padding + radius, canvasHeight - padding);
  ctx.arcTo(padding, canvasHeight - padding, padding, canvasHeight - padding - radius, radius);
  ctx.lineTo(padding, padding + radius);
  ctx.arcTo(padding, padding, padding + radius, padding, radius);
  ctx.closePath();
  ctx.fill();

  /* 绘制边框 */
  ctx.strokeStyle = 'rgba(100, 200, 255, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  /* 绘制面积文字 */
  ctx.fillStyle = '#e8f4ff';
  ctx.font = 'bold 28px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);

  const texture: THREE.CanvasTexture = new THREE.CanvasTexture(canvas);
  return texture;
}

/**
 * 创建面积标注 Sprite
 * Sprite 尺寸根据面积大小自适应（较大区域显示较大标注）
 *
 * @param text - 面积文字
 * @param centroid - 质心坐标（XZ 平面）
 * @returns Three.js Sprite 实例
 */
function createAreaSprite(text: string, centroid: Point2D): THREE.Sprite {
  const texture: THREE.CanvasTexture = createAreaTexture(text);

  const material: THREE.SpriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });

  const sprite: THREE.Sprite = new THREE.Sprite(material);

  /* Sprite 世界尺寸（单位：米），宽高比与 Canvas 一致 256:80 = 3.2:1 */
  sprite.scale.set(3.2, 1.0, 1.0);

  /* 放置在质心位置，Y 轴略高于地面（0.05m）避免 z-fighting */
  sprite.position.set(centroid.x, 0.05, centroid.z);

  /* 确保标注始终渲染在最上层 */
  sprite.renderOrder = 999;

  return sprite;
}

/**
 * 面积标注组件
 * 仅在 2D 模式下使用，在 WallDrawScene 中条件渲染
 *
 * 关键流程：
 * 1. 从 BuildingContext 获取 objectManager 和 objectCount
 * 2. objectCount 变化时重新遍历所有 SlabData
 * 3. 对每个楼板计算面积和质心，创建/更新 Sprite
 * 4. 组件卸载时清理所有 Sprite
 */
export function AreaLabel(): null {
  const engine: Engine = useEngine();
  const { objectManager, objectCount } = useBuildingContext();

  /** 当前所有面积标注的 Sprite 列表（按 slabId 索引） */
  const labelsRef = useRef<Map<string, AreaLabelEntry>>(new Map<string, AreaLabelEntry>());

  /**
   * 当 objectCount 变化时，重新计算并更新所有面积标注
   * 关键流程：
   * 1. 获取所有 SlabData 对象
   * 2. 对比现有标注，新增/更新/删除
   * 3. 将 Sprite 添加到场景
   */
  useEffect((): (() => void) => {
    if (objectManager === null) {
      return (): void => {};
    }

    const scene: THREE.Scene = engine.sceneManager.getScene();
    const currentLabels: Map<string, AreaLabelEntry> = labelsRef.current;

    /* 获取当前所有楼板对象 */
    const allObjects: BuildingObject[] = objectManager.getAll();
    const slabs: SlabData[] = allObjects.filter(
      (obj: BuildingObject): obj is SlabData => obj.category === 'slab'
    );

    /* 收集当前楼板 ID 集合，用于检测已删除的楼板 */
    const currentSlabIds: Set<string> = new Set<string>(slabs.map((s: SlabData): string => s.id));

    /* 删除已不存在的楼板对应的标注 */
    for (const [slabId, entry] of currentLabels) {
      if (!currentSlabIds.has(slabId)) {
        scene.remove(entry.sprite);
        entry.sprite.material.map?.dispose();
        entry.sprite.material.dispose();
        currentLabels.delete(slabId);
      }
    }

    /* 新增或更新楼板标注 */
    for (const slab of slabs) {
      const outline: Point2D[] = slab.outline;
      if (outline.length < 3) {
        continue;
      }

      /* 计算面积（平方米） */
      const area: number = computePolygonArea(outline);
      /* 计算质心 */
      const centroid: Point2D = computePolygonCentroid(outline);

      /* 格式化面积文字：保留 2 位小数 */
      const areaText: string = `${area.toFixed(2)} m²`;

      const existing: AreaLabelEntry | undefined = currentLabels.get(slab.id);

      if (existing !== undefined) {
        /* 更新已有标注：重新生成纹理并更新位置 */
        const newTexture: THREE.CanvasTexture = createAreaTexture(areaText);
        existing.sprite.material.map?.dispose();
        existing.sprite.material.map = newTexture;
        existing.sprite.material.needsUpdate = true;
        existing.sprite.position.set(centroid.x, 0.05, centroid.z);
      } else {
        /* 新建标注 Sprite */
        const sprite: THREE.Sprite = createAreaSprite(areaText, centroid);
        scene.add(sprite);
        currentLabels.set(slab.id, { slabId: slab.id, sprite: sprite });
      }
    }

    /* 返回清理函数（仅在组件卸载时执行，不在每次 effect 重跑时清理） */
    return (): void => {};
  }, [engine, objectManager, objectCount]);

  /* 组件卸载时清理所有 Sprite */
  useEffect((): (() => void) => {
    return (): void => {
      const scene: THREE.Scene = engine.sceneManager.getScene();
      const currentLabels: Map<string, AreaLabelEntry> = labelsRef.current;

      for (const entry of currentLabels.values()) {
        scene.remove(entry.sprite);
        entry.sprite.material.map?.dispose();
        entry.sprite.material.dispose();
      }
      currentLabels.clear();
    };
  }, [engine]);

  return null;
}
