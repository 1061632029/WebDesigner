/**
 * 建筑衔接线渲染器
 * 使用 LineSegments 渲染与建筑轮廓一致的屏幕像素线
 */

import * as THREE from 'three/webgpu';
import type { SceneManager } from '../scene/SceneManager';
import type { BuildingConnectionLineSegment } from './BuildingConnectionLineTypes';

/**
 * 建筑衔接线渲染器
 * 负责衔接线 Group 的创建、刷新、清理与资源释放
 */
export class BuildingConnectionLineRenderer {
  /** 场景管理器引用 */
  private readonly _sceneManager: SceneManager;

  /** 当前衔接线根节点 */
  private readonly _root: THREE.Group = new THREE.Group();

  /** 衔接线共用材质：保持与现有墙体轮廓线一致的 1px 视觉效果 */
  private readonly _material: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
    color: 0x333333,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    opacity: 1,
  });

  /**
   * @param sceneManager - 场景管理器
   */
  public constructor(sceneManager: SceneManager) {
    this._sceneManager = sceneManager;
    this._root.name = 'BuildingConnectionLines';
    this._root.renderOrder = 20;
    this._sceneManager.add(this._root);
  }

  /**
   * 使用新的线段数据刷新衔接线显示
   * @param segments - 需要显示的衔接线段数组
   */
  public render(segments: BuildingConnectionLineSegment[]): void {
    this.clear();

    /* 将每条逻辑线段转换为 LineSegments，线宽与墙体/楼板轮廓线保持一致。 */
    for (let index: number = 0; index < segments.length; index++) {
      const segment: BuildingConnectionLineSegment = segments[index]!;
      const line: THREE.LineSegments | null = this._createSegmentLine(segment);
      if (line !== null) {
        this._root.add(line);
      }
    }
  }

  /**
   * 清理当前所有衔接线 Mesh，但保留根节点与共享材质
   */
  public clear(): void {
    /* 从后往前移除，避免 children 数组下标变化导致遗漏。 */
    for (let index: number = this._root.children.length - 1; index >= 0; index--) {
      const child: THREE.Object3D = this._root.children[index]!;
      this._root.remove(child);

      /* 衔接线子对象均为 LineSegments，释放其独立几何体；材质为共享材质，不在此处释放。 */
      if (child instanceof THREE.LineSegments) {
        const line: THREE.LineSegments = child as THREE.LineSegments;
        line.geometry.dispose();
      }
    }
  }

  /**
   * 销毁渲染器并释放根节点、几何体和共享材质
   */
  public dispose(): void {
    this.clear();
    this._sceneManager.remove(this._root);
    this._material.dispose();
  }

  /**
   * 根据单条衔接线段创建 LineSegments
   * @param segment - 衔接线段数据
   * @returns 衔接线对象；退化线段返回 null
   */
  private _createSegmentLine(segment: BuildingConnectionLineSegment): THREE.LineSegments | null {
    if (segment.orientation === 'vertical') {
      return this._createVerticalSegmentLine(segment);
    }

    const dx: number = segment.end.x - segment.start.x;
    const dz: number = segment.end.z - segment.start.z;
    const length: number = Math.sqrt(dx * dx + dz * dz);
    if (length < 0.001) {
      return null;
    }

    /* 水平缝线直接使用两个世界坐标端点，避免实体粗线带来的厚度感。 */
    const vertices: Float32Array = new Float32Array([
      segment.start.x,
      segment.y,
      segment.start.z,
      segment.end.x,
      segment.y,
      segment.end.z,
    ]);
    return this._createLineObject(segment, vertices);
  }

  /**
   * 根据单条竖向衔接线段创建 LineSegments。
   * @param segment - 竖向衔接线段数据
   * @returns 衔接线对象；退化高度返回 null
   */
  private _createVerticalSegmentLine(segment: BuildingConnectionLineSegment): THREE.LineSegments | null {
    const startY: number = segment.startY ?? segment.y;
    const endY: number = segment.endY ?? segment.y;
    const height: number = Math.abs(endY - startY);
    if (height < 0.001) {
      return null;
    }

    /* 竖向缝线使用同一 XZ 坐标的上下两个端点，视觉宽度与轮廓线一致。 */
    const vertices: Float32Array = new Float32Array([
      segment.start.x,
      startY,
      segment.start.z,
      segment.start.x,
      endY,
      segment.start.z,
    ]);
    return this._createLineObject(segment, vertices);
  }

  /**
   * 创建通用衔接线对象并写入调试标记。
   * @param segment - 衔接线段数据
   * @param vertices - 两端点顶点数组，格式为 x/y/z/x/y/z
   * @returns LineSegments 对象
   */
  private _createLineObject(segment: BuildingConnectionLineSegment, vertices: Float32Array): THREE.LineSegments {
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

    const line: THREE.LineSegments = new THREE.LineSegments(geometry, this._material);
    line.name = segment.id;
    line.userData['isBuildingConnectionLine'] = true;
    line.userData['sourceObjectId'] = segment.sourceObjectId;
    line.userData['sourceType'] = segment.sourceType;
    line.renderOrder = 20;

    return line;
  }
}
