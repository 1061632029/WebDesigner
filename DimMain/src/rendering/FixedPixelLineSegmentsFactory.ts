/**
 * 固定像素宽度线段工厂。
 * 对外保留统一创建、标记与释放入口，内部优先使用屏幕空间 Mesh 实现真实固定像素线宽。
 */

import * as THREE from 'three/webgpu';
import {
  ScreenSpaceLineSegmentsMesh,
  ScreenSpaceLineSegmentsMeshFactory,
} from './ScreenSpaceLineSegmentsMeshFactory';

/**
 * 固定像素线段创建配置。
 */
export interface FixedPixelLineSegmentsOptions {
  /** 线段颜色。 */
  color: THREE.ColorRepresentation;
  /** 屏幕空间线宽，单位为 CSS 像素；原生 LineSegments 在部分平台可能只能显示 1px。 */
  lineWidthPixels: number;
  /** 是否启用深度测试。 */
  depthTest: boolean;
  /** 是否写入深度缓冲。 */
  depthWrite: boolean;
  /** 透明度，范围 0-1。 */
  opacity: number;
  /** NDC 深度偏移量，正数表示向相机方向轻微前移，用于缓解线段与实体共面时的 z-buffer 遮挡。 */
  depthOffsetNdc?: number;
}

/**
 * WebGPU 固定像素宽度线段对象。
 */
export type FixedPixelLineSegments = ScreenSpaceLineSegmentsMesh | THREE.LineSegments;

/**
 * 固定像素宽度线段工厂。
 */
export class FixedPixelLineSegmentsFactory {
  /** 默认强化线宽，单位为 CSS 像素。 */
  public static readonly DEFAULT_LINE_WIDTH_PIXELS: number = 2.5;

  /**
   * 基于线段顶点数组创建固定像素线段对象。
   * 关键流程：优先创建屏幕空间矩形 Mesh，使线宽不随相机远近变化；同时禁用 raycast，避免视觉辅助线进入拾取流程。
   * @param vertices - 线段端点数组，格式为 x/y/z/x/y/z 循环排列
   * @param options - 固定像素线段创建配置
   * @returns WebGPU 稳定固定像素线段对象
   */
  public static create(vertices: Float32Array, options: FixedPixelLineSegmentsOptions): FixedPixelLineSegments {
    const fixedPixelLines: ScreenSpaceLineSegmentsMesh = ScreenSpaceLineSegmentsMeshFactory.create(vertices, {
      color: options.color,
      opacity: options.opacity,
      depthTest: options.depthTest,
      depthWrite: options.depthWrite,
      lineWidthPixels: options.lineWidthPixels,
      depthOffsetNdc: options.depthOffsetNdc,
    });
    return fixedPixelLines;
  }

  /**
   * 判断对象是否为固定像素宽度线段。
   * @param object3D - 需要判断的三维对象
   * @returns 是固定像素宽度线段时返回 true
   */
  public static isFixedPixelLineSegments(object3D: THREE.Object3D): boolean {
    return object3D.userData['isFixedPixelLineSegments'] === true;
  }

  /**
   * 将固定像素线段按兼容旧调用方的 LineSegments 类型返回。
   * @param lineSegments - 固定像素宽度线段对象
   * @returns 兼容旧接口的 LineSegments 对象
   */
  public static asLineSegments(lineSegments: FixedPixelLineSegments): THREE.LineSegments {
    return lineSegments as unknown as THREE.LineSegments;
  }

  /**
   * 将固定像素线段按新的通用 Object3D 类型返回。
   * @param lineSegments - 固定像素宽度线段对象
   * @returns 视觉线段对象
   */
  public static asObject3D(lineSegments: FixedPixelLineSegments): THREE.Object3D {
    return lineSegments;
  }

  /**
   * 释放固定像素宽度线段对象占用的 GPU 资源。
   * @param object3D - 需要释放的固定像素宽度线段对象
   */
  public static dispose(object3D: THREE.Object3D): void {
    if (ScreenSpaceLineSegmentsMeshFactory.isScreenSpaceLineSegmentsMesh(object3D)) {
      ScreenSpaceLineSegmentsMeshFactory.dispose(object3D);
      return;
    }

    if (!(object3D instanceof THREE.LineSegments)) {
      return;
    }

    const lineSegments: THREE.LineSegments = object3D as THREE.LineSegments;
    lineSegments.geometry.dispose();
    if (Array.isArray(lineSegments.material)) {
      for (let materialIndex: number = 0; materialIndex < lineSegments.material.length; materialIndex++) {
        const material: THREE.Material = lineSegments.material[materialIndex]!;
        material.dispose();
      }
      return;
    }

    lineSegments.material.dispose();
  }
}