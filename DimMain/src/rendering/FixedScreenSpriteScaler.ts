/**
 * 固定屏幕尺寸 Sprite 缩放工具。
 * 用于让 CanvasTexture 标注在正交相机滚轮缩放时保持屏幕像素大小不变。
 */

import * as THREE from 'three/webgpu';

/** 默认参考比例：2D 正交相机默认 viewHeight=20、常见画布高 800 时为 40 像素/米。 */
const DEFAULT_REFERENCE_PIXELS_PER_WORLD_UNIT: number = 40;

/** 固定屏幕尺寸统一放大倍率，用于整体调整所有标注的屏幕显示尺寸。 */
const FIXED_SCREEN_SPRITE_SIZE_MULTIPLIER: number = 3.0;

/** 最近一次渲染得到的每像素世界尺寸，用于新建 Sprite 首帧直接使用稳定尺寸，避免重绘闪烁。 */
let lastStableWorldUnitsPerPixel: number = 1 / DEFAULT_REFERENCE_PIXELS_PER_WORLD_UNIT;

/** 可读取渲染器尺寸的最小接口，兼容 three/webgpu 较窄类型声明。 */
interface FixedScreenRendererSizeSource {
  /** Three.js 标准渲染尺寸读取方法。 */
  getSize?: (target: THREE.Vector2) => THREE.Vector2;
  /** 渲染画布元素，用于 getSize 不可用时兜底读取 CSS 高度。 */
  domElement?: HTMLCanvasElement;
}

/**
 * 为 Sprite 应用固定屏幕尺寸缩放。
 * 关键流程：把原有世界尺寸换算为参考像素尺寸，并在每帧渲染前按当前相机缩放反算世界 scale。
 * @param sprite - 需要固定屏幕尺寸的 Sprite
 * @param referenceWorldWidth - 原始参考世界宽度，单位米
 * @param referenceWorldHeight - 原始参考世界高度，单位米
 * @param referencePixelsPerWorldUnit - 参考比例，默认 40 像素/米
 */
export function applyFixedScreenSpriteSize(
  sprite: THREE.Sprite,
  referenceWorldWidth: number,
  referenceWorldHeight: number,
  referencePixelsPerWorldUnit: number = DEFAULT_REFERENCE_PIXELS_PER_WORLD_UNIT
): void {
  const targetWidthPixels: number = referenceWorldWidth * referencePixelsPerWorldUnit * FIXED_SCREEN_SPRITE_SIZE_MULTIPLIER;
  const targetHeightPixels: number = referenceWorldHeight * referencePixelsPerWorldUnit * FIXED_SCREEN_SPRITE_SIZE_MULTIPLIER;
  const worldPosition: THREE.Vector3 = new THREE.Vector3();

  /* 初始尺寸使用最近一次稳定缩放结果，避免预览重绘时先显示临时世界尺寸再跳变。 */
  applySpriteScaleByWorldUnitsPerPixel(sprite, targetWidthPixels, targetHeightPixels, lastStableWorldUnitsPerPixel);

  sprite.onBeforeRender = (
    renderer: THREE.Renderer,
    _scene: THREE.Scene,
    camera: THREE.Camera
  ): void => {
    const rendererHeight: number = getRendererHeight(renderer);
    if (rendererHeight <= 0) {
      return;
    }

    /* 正交视图：用可见高度/画布高度得到每像素世界尺寸，抵消滚轮 zoom。 */
    if (camera instanceof THREE.OrthographicCamera) {
      const visibleHeight: number = (camera.top - camera.bottom) / camera.zoom;
      const worldUnitsPerPixel: number = visibleHeight / rendererHeight;
      lastStableWorldUnitsPerPixel = worldUnitsPerPixel;
      applySpriteScaleByWorldUnitsPerPixel(sprite, targetWidthPixels, targetHeightPixels, worldUnitsPerPixel);
      return;
    }

    /* 透视视图兜底：按 Sprite 到相机距离估算屏幕像素对应的世界尺寸。 */
    if (camera instanceof THREE.PerspectiveCamera) {
      sprite.getWorldPosition(worldPosition);
      const distanceToCamera: number = worldPosition.distanceTo(camera.position);
      const visibleHeight: number = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distanceToCamera;
      const worldUnitsPerPixel: number = visibleHeight / rendererHeight;
      lastStableWorldUnitsPerPixel = worldUnitsPerPixel;
      applySpriteScaleByWorldUnitsPerPixel(sprite, targetWidthPixels, targetHeightPixels, worldUnitsPerPixel);
    }
  };
}

/**
 * 根据每像素世界尺寸应用 Sprite 缩放。
 * 关键流程：把目标像素宽高转换成当前相机下的世界 scale，确保屏幕显示尺寸稳定。
 * @param sprite - 需要更新缩放的 Sprite
 * @param targetWidthPixels - 目标屏幕宽度，单位像素
 * @param targetHeightPixels - 目标屏幕高度，单位像素
 * @param worldUnitsPerPixel - 当前相机下每个屏幕像素对应的世界尺寸
 */
function applySpriteScaleByWorldUnitsPerPixel(
  sprite: THREE.Sprite,
  targetWidthPixels: number,
  targetHeightPixels: number,
  worldUnitsPerPixel: number
): void {
  /* 缩放计算：固定像素尺寸乘以每像素世界尺寸，得到当前帧需要的世界 scale。 */
  sprite.scale.set(
    targetWidthPixels * worldUnitsPerPixel,
    targetHeightPixels * worldUnitsPerPixel,
    1.0
  );
}

/**
 * 获取当前渲染画布高度。
 * @param renderer - 当前 Three.js 渲染器
 * @returns 渲染高度，单位像素；无法读取时返回 0
 */
function getRendererHeight(renderer: THREE.Renderer): number {
  const rendererSizeSource: FixedScreenRendererSizeSource = renderer as unknown as FixedScreenRendererSizeSource;
  const rendererSize: THREE.Vector2 = new THREE.Vector2();

  /* 优先读取 Three.js 渲染器真实绘制尺寸。 */
  if (typeof rendererSizeSource.getSize === 'function') {
    rendererSizeSource.getSize(rendererSize);
    return rendererSize.y;
  }

  /* WebGPU 类型声明缺失 getSize 时，退回读取画布 CSS 高度。 */
  if (rendererSizeSource.domElement !== undefined) {
    return rendererSizeSource.domElement.clientHeight;
  }

  return 0;
}