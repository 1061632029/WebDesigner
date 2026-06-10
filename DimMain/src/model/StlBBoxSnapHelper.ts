/**
 * STL 模型包围盒边界吸附辅助器
 * 在布置普通 STL 模型（category='model'）时，检测预览模型的 AABB 包围盒
 * 与场景中已放置的其他 STL 模型及墙体包围盒的边界距离
 * 在吸附阈值范围内自动计算偏移量，使边界重合
 */

import * as THREE from 'three/webgpu';

/**
 * 吸附结果
 */
export interface BBoxSnapResult {
  /** X 轴方向需要叠加的偏移量（米），0 表示无吸附 */
  offsetX: number;
  /** Z 轴方向需要叠加的偏移量（米），0 表示无吸附 */
  offsetZ: number;
  /** 是否发生了 X 轴吸附 */
  snappedX: boolean;
  /** 是否发生了 Z 轴吸附 */
  snappedZ: boolean;
  /**
   * X 轴吸附时，发生吸附的预览模型边界 X 坐标（吸附后的世界坐标）
   * 即虚线应绘制的 X 位置，snappedX=false 时此值无意义
   */
  snapEdgeX: number;
  /**
   * Z 轴吸附时，发生吸附的预览模型边界 Z 坐标（吸附后的世界坐标）
   * 即虚线应绘制的 Z 位置，snappedZ=false 时此值无意义
   */
  snapEdgeZ: number;
}

/**
 * XZ 平面包围盒（忽略 Y 轴）
 */
interface FlatBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * STL 模型包围盒边界吸附辅助器
 * 纯计算类，无副作用
 */
export class StlBBoxSnapHelper {
  /**
   * 默认吸附阈值（米）
   * 预览模型边界与目标边界距离小于此值时触发吸附
   */
  public static readonly DEFAULT_THRESHOLD: number = 0.3;

  /**
   * 计算预览模型相对于目标包围盒列表的吸附偏移量
   * 分别在 X 轴和 Z 轴方向寻找最近的边界对，若距离在阈值内则计算偏移
   * 同时记录实际发生吸附的预览模型边界坐标（吸附后），供虚线提示精确定位
   *
   * @param previewMesh - 预览 Mesh（已设置好当前位置/旋转/缩放，但尚未应用吸附偏移）
   * @param targetMeshes - 目标 Mesh 列表（已放置的 STL 模型 + 墙体 Mesh）
   * @param threshold - 吸附阈值（米），默认 0.3m
   * @returns 吸附偏移量及吸附边坐标
   */
  public static findSnap(
    previewMesh: THREE.Mesh,
    targetMeshes: Array<THREE.Mesh>,
    threshold: number = StlBBoxSnapHelper.DEFAULT_THRESHOLD
  ): BBoxSnapResult {
    /* 计算预览 Mesh 的世界空间 AABB（含旋转/缩放） */
    previewMesh.updateMatrixWorld(true);
    const previewBox3: THREE.Box3 = new THREE.Box3().setFromObject(previewMesh);
    const previewFlat: FlatBox = {
      minX: previewBox3.min.x,
      maxX: previewBox3.max.x,
      minZ: previewBox3.min.z,
      maxZ: previewBox3.max.z,
    };

    /* 收集所有目标的 XZ 平面包围盒 */
    const targetBoxes: Array<FlatBox> = [];
    for (const mesh of targetMeshes) {
      /* 跳过预览 Mesh 自身（uuid 相同） */
      if (mesh.uuid === previewMesh.uuid) {
        continue;
      }
      mesh.updateMatrixWorld(true);
      const box3: THREE.Box3 = new THREE.Box3().setFromObject(mesh);
      targetBoxes.push({
        minX: box3.min.x,
        maxX: box3.max.x,
        minZ: box3.min.z,
        maxZ: box3.max.z,
      });
    }

    if (targetBoxes.length === 0) {
      return {
        offsetX: 0, offsetZ: 0,
        snappedX: false, snappedZ: false,
        snapEdgeX: 0, snapEdgeZ: 0,
      };
    }

    /* ===== X 轴方向吸附 ===== */
    let bestOffsetX: number = 0;
    let bestDistX: number = threshold;
    let snappedX: boolean = false;
    /**
     * 记录发生吸附的预览模型边界 X 坐标（吸附前的原始值）
     * 吸附后的坐标 = snapEdgeXRaw + bestOffsetX
     */
    let snapEdgeXRaw: number = 0;

    for (const target of targetBoxes) {
      /* 预览 minX 对齐目标 minX */
      const d1: number = Math.abs(previewFlat.minX - target.minX);
      if (d1 < bestDistX) {
        bestDistX = d1;
        bestOffsetX = target.minX - previewFlat.minX;
        snapEdgeXRaw = previewFlat.minX;
        snappedX = true;
      }
      /* 预览 minX 对齐目标 maxX */
      const d2: number = Math.abs(previewFlat.minX - target.maxX);
      if (d2 < bestDistX) {
        bestDistX = d2;
        bestOffsetX = target.maxX - previewFlat.minX;
        snapEdgeXRaw = previewFlat.minX;
        snappedX = true;
      }
      /* 预览 maxX 对齐目标 minX */
      const d3: number = Math.abs(previewFlat.maxX - target.minX);
      if (d3 < bestDistX) {
        bestDistX = d3;
        bestOffsetX = target.minX - previewFlat.maxX;
        snapEdgeXRaw = previewFlat.maxX;
        snappedX = true;
      }
      /* 预览 maxX 对齐目标 maxX */
      const d4: number = Math.abs(previewFlat.maxX - target.maxX);
      if (d4 < bestDistX) {
        bestDistX = d4;
        bestOffsetX = target.maxX - previewFlat.maxX;
        snapEdgeXRaw = previewFlat.maxX;
        snappedX = true;
      }
    }

    /* ===== Z 轴方向吸附 ===== */
    let bestOffsetZ: number = 0;
    let bestDistZ: number = threshold;
    let snappedZ: boolean = false;
    /**
     * 记录发生吸附的预览模型边界 Z 坐标（吸附前的原始值）
     * 吸附后的坐标 = snapEdgeZRaw + bestOffsetZ
     */
    let snapEdgeZRaw: number = 0;

    for (const target of targetBoxes) {
      /* 预览 minZ 对齐目标 minZ */
      const d1: number = Math.abs(previewFlat.minZ - target.minZ);
      if (d1 < bestDistZ) {
        bestDistZ = d1;
        bestOffsetZ = target.minZ - previewFlat.minZ;
        snapEdgeZRaw = previewFlat.minZ;
        snappedZ = true;
      }
      /* 预览 minZ 对齐目标 maxZ */
      const d2: number = Math.abs(previewFlat.minZ - target.maxZ);
      if (d2 < bestDistZ) {
        bestDistZ = d2;
        bestOffsetZ = target.maxZ - previewFlat.minZ;
        snapEdgeZRaw = previewFlat.minZ;
        snappedZ = true;
      }
      /* 预览 maxZ 对齐目标 minZ */
      const d3: number = Math.abs(previewFlat.maxZ - target.minZ);
      if (d3 < bestDistZ) {
        bestDistZ = d3;
        bestOffsetZ = target.minZ - previewFlat.maxZ;
        snapEdgeZRaw = previewFlat.maxZ;
        snappedZ = true;
      }
      /* 预览 maxZ 对齐目标 maxZ */
      const d4: number = Math.abs(previewFlat.maxZ - target.maxZ);
      if (d4 < bestDistZ) {
        bestDistZ = d4;
        bestOffsetZ = target.maxZ - previewFlat.maxZ;
        snapEdgeZRaw = previewFlat.maxZ;
        snappedZ = true;
      }
    }

    return {
      offsetX: bestOffsetX,
      offsetZ: bestOffsetZ,
      snappedX: snappedX,
      snappedZ: snappedZ,
      /* 吸附后的边界坐标 = 吸附前的边界坐标 + 偏移量 */
      snapEdgeX: snapEdgeXRaw + bestOffsetX,
      snapEdgeZ: snapEdgeZRaw + bestOffsetZ,
    };
  }
}
