/**
 * 平面线式布置辅助虚线渲染器
 * 负责显示墙/梁延长线对齐和正交约束的虚线提示。
 */

import * as THREE from 'three/webgpu';
import type { SceneManager } from '../scene/SceneManager';
import type { PlanarPlacementGuideLine } from './PlanarPlacementSnapTypes';

/** 虚线 Y 轴高度，略高于地面避免闪烁 */
const GUIDE_Y: number = 0.025;

/**
 * 平面布置辅助虚线渲染器
 */
export class PlanarPlacementGuideRenderer {
  /** 场景管理器 */
  private readonly _sceneManager: SceneManager;

  /** 虚线对象 */
  private _line: THREE.LineSegments | null = null;

  /** 虚线共享材质 */
  private _material: THREE.LineDashedMaterial | null = null;

  /**
   * @param sceneManager - 场景管理器
   */
  constructor(sceneManager: SceneManager) {
    this._sceneManager = sceneManager;
    this._material = this._createMaterial();
    this._createLine();
  }

  /**
   * 根据捕获辅助线更新虚线显示
   * @param guideLines - 捕获辅助线列表；null 或空数组时隐藏
   */
  public update(guideLines: PlanarPlacementGuideLine[] | null): void {
    if (this._line === null) {
      return;
    }

    if (guideLines === null || guideLines.length === 0) {
      this._line.visible = false;
      return;
    }

    this._rebuildLine(guideLines);
  }

  /** 隐藏辅助虚线 */
  public hide(): void {
    if (this._line !== null) {
      this._line.visible = false;
    }
  }

  /** 销毁虚线并释放资源 */
  public dispose(): void {
    if (this._line === null) {
      return;
    }
    this._sceneManager.remove(this._line);
    this._line.geometry.dispose();
    this._line = null;
    if (this._material !== null) {
      this._material.dispose();
      this._material = null;
    }
  }

  /**
   * 创建虚线材质
   * @returns 虚线共享材质
   */
  private _createMaterial(): THREE.LineDashedMaterial {
    return new THREE.LineDashedMaterial({
      color: 0x00ccff,
      dashSize: 0.12,
      gapSize: 0.06,
      linewidth: 1,
      depthTest: false,
      depthWrite: false,
    });
  }

  /** 创建初始隐藏的虚线对象 */
  private _createLine(): void {
    const geometry: THREE.BufferGeometry = this._buildLineGeometry([]);
    this._line = this._createLineObject(geometry);
    this._line.name = '__planar_placement_guide__';
    this._line.visible = false;
    this._line.renderOrder = 120;
    this._sceneManager.add(this._line);
  }

  /**
   * 重建虚线对象
   * 关键流程：每次创建新的 LineSegments 并替换场景中的旧对象，避免 WebGPU 复用旧渲染对象缓存导致预览线固定为第一次上传的数据。
   * @param guideLines - 捕获辅助线列表
   */
  private _rebuildLine(guideLines: PlanarPlacementGuideLine[]): void {
    const oldLine: THREE.LineSegments | null = this._line;
    const geometry: THREE.BufferGeometry = this._buildLineGeometry(guideLines);
    const newLine: THREE.LineSegments = this._createLineObject(geometry);
    newLine.computeLineDistances();
    newLine.visible = true;

    if (oldLine !== null) {
      this._sceneManager.remove(oldLine);
      oldLine.geometry.dispose();
    }

    this._line = newLine;
    this._sceneManager.add(newLine);
  }

  /**
   * 创建虚线 LineSegments 对象
   * @param geometry - 虚线几何体
   * @returns 已配置渲染顺序和名称的虚线对象
   */
  private _createLineObject(geometry: THREE.BufferGeometry): THREE.LineSegments {
    if (this._material === null) {
      this._material = this._createMaterial();
    }

    const line: THREE.LineSegments = new THREE.LineSegments(geometry, this._material);
    line.name = '__planar_placement_guide__';
    line.renderOrder = 120;
    return line;
  }

  /**
   * 根据辅助线集合构建虚线几何体
   * @param guideLines - 捕获辅助线列表
   * @returns 包含最新线段端点的几何体
   */
  private _buildLineGeometry(guideLines: PlanarPlacementGuideLine[]): THREE.BufferGeometry {
    const segmentCount: number = Math.max(guideLines.length, 1);
    const positions: Float32Array = new Float32Array(segmentCount * 2 * 3);
    for (let index: number = 0; index < guideLines.length; index++) {
      const guideLine: PlanarPlacementGuideLine = guideLines[index]!;
      const offset: number = index * 6;
      positions[offset] = guideLine.start.x;
      positions[offset + 1] = GUIDE_Y;
      positions[offset + 2] = guideLine.start.z;
      positions[offset + 3] = guideLine.end.x;
      positions[offset + 4] = GUIDE_Y;
      positions[offset + 5] = guideLine.end.z;
    }

    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }
}