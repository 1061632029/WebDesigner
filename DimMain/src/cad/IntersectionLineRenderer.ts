/**
 * 实体相交交线渲染器
 * 管理 OCCT 截面交线的 Three.js LineSegments 渲染生命周期
 * 交线样式与几何体轮廓线框保持一致（颜色 0x333333，线宽 1）
 */

import * as THREE from 'three/webgpu';
import type { OpenCascadeInstance } from './OcctTypes';
import { OcctSectionLineExtractor } from './OcctSectionLineExtractor';
import type { SectionEdgePoints } from './OcctSectionLineExtractor';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 交线渲染器
 * 职责：接收两个 OCCT Shape → 计算交线 → 构建 LineSegments → 管理场景生命周期
 */
export class IntersectionLineRenderer {
  /** OCCT 截面交线提取器 */
  private _extractor: OcctSectionLineExtractor;

  /** 当前场景中所有交线 LineSegments 对象 */
  private _lineObjects: THREE.LineSegments[] = [];

  /** 交线材质（与几何体轮廓线框颜色/线宽一致） */
  private _material: THREE.LineBasicMaterial;

  /**
   * @param oc - OpenCascade WASM 实例
   */
  constructor(oc: OpenCascadeInstance) {
    this._extractor = new OcctSectionLineExtractor(oc);

    /* 交线材质：颜色和线宽与 BuildingObjectManager 中的轮廓线框保持一致 */
    this._material = new THREE.LineBasicMaterial({
      color: 0x333333,
      linewidth: 1,
      depthTest: true,
      depthWrite: false,
    });
  }

  /**
   * 计算两个 Shape 的精确交线并添加到场景
   * 若之前已有交线，先清除旧的再添加新的
   * @param shapeA - 第一个 B-Rep Shape
   * @param shapeB - 第二个 B-Rep Shape
   * @param scene - Three.js Scene 或 Object3D（交线将作为子对象添加）
   * @param deflection - 离散化精度（默认 0.05）
   * @returns 本次生成的 LineSegments 数组（可为空，表示两实体不相交）
   */
  public computeAndRender(
    shapeA: any,
    shapeB: any,
    scene: THREE.Object3D,
    deflection: number = 0.05
  ): THREE.LineSegments[] {
    /* 清除旧的交线渲染对象 */
    this.clear(scene);

    /* 提取所有交线 Edge 的离散化坐标 */
    const edgePointsList: SectionEdgePoints[] = this._extractor.extract(shapeA, shapeB, deflection);

    /* 无交线时直接返回空数组 */
    if (edgePointsList.length === 0) {
      return [];
    }

    /* 将所有 Edge 坐标合并为 LineSegments 格式的 flat 数组 */
    const positionData: Float32Array = this._extractor.mergeToLineSegments(edgePointsList);

    /* 坐标数组为空时跳过（防御性处理） */
    if (positionData.length === 0) {
      return [];
    }

    /* 构建 BufferGeometry */
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positionData, 3)
    );

    /* 创建 LineSegments 对象 */
    const lineSegments: THREE.LineSegments = new THREE.LineSegments(geometry, this._material);

    /* 渲染顺序：在实体（0）和轮廓线框（1）之上 */
    lineSegments.renderOrder = 2;

    /* 标记为交线对象，便于后续识别和清理 */
    lineSegments.userData['isIntersectionLine'] = true;

    /* 添加到场景 */
    scene.add(lineSegments);
    this._lineObjects.push(lineSegments);

    return [lineSegments];
  }

  /**
   * 清除场景中所有由本渲染器创建的交线对象
   * @param scene - Three.js Scene 或 Object3D
   */
  public clear(scene: THREE.Object3D): void {
    for (const lineObj of this._lineObjects) {
      scene.remove(lineObj);
      lineObj.geometry.dispose();
    }
    this._lineObjects = [];
  }

  /**
   * 获取当前场景中的交线对象数量
   */
  public get lineCount(): number {
    return this._lineObjects.length;
  }

  /**
   * 销毁渲染器，释放材质资源
   * 注意：调用前应先调用 clear() 从场景中移除交线对象
   */
  public dispose(): void {
    this._material.dispose();
    this._lineObjects = [];
  }
}
