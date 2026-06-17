/**
 * STL 模型包围盒边界吸附辅助器
 * 在布置普通 STL 模型（category='model'）时，检测预览模型的 OBB 有向包围盒
 * 与场景中已放置的其他 STL 模型及墙体 OBB 边界距离
 * 在吸附阈值范围内自动计算偏移量，使边界重合
 */

import * as THREE from 'three/webgpu';
import { StlObbHelper } from './StlObbHelper';
import type { StlObb2D, StlObbEdge2D, StlProjectionRange } from './StlObbHelper';

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
  /** OBB 吸附虚线起点；存在时优先按有向边绘制虚线。 */
  snapGuideStartPoint?: THREE.Vector3;
  /** OBB 吸附虚线终点；存在时优先按有向边绘制虚线。 */
  snapGuideEndPoint?: THREE.Vector3;
}

/**
 * OBB 吸附候选结果。
 */
interface ObbSnapCandidate {
  /** 预览模型需要叠加的平移向量。 */
  offset: THREE.Vector3;
  /** 吸附距离绝对值。 */
  distance: number;
  /** 吸附后的预览 OBB 边起点。 */
  guideStartPoint: THREE.Vector3;
  /** 吸附后的预览 OBB 边终点。 */
  guideEndPoint: THREE.Vector3;
}

/** 平行边判断阈值，值越接近 1 越严格。 */
const PARALLEL_DOT_THRESHOLD: number = 0.985;

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
    /* OBB 吸附流程：将预览模型四条有向边与目标模型/墙体的平行有向边做法向距离匹配。 */
    previewMesh.updateMatrixWorld(true);
    const previewObb: StlObb2D = StlObbHelper.computeObb2D(previewMesh);

    /* 收集所有目标的 XZ 平面 OBB。 */
    const targetObbs: Array<StlObb2D> = [];
    for (const mesh of targetMeshes) {
      /* 跳过预览 Mesh 自身（uuid 相同） */
      if (mesh.uuid === previewMesh.uuid) {
        continue;
      }
      mesh.updateMatrixWorld(true);
      targetObbs.push(StlObbHelper.computeObb2D(mesh));
    }

    if (targetObbs.length === 0) {
      return {
        offsetX: 0, offsetZ: 0,
        snappedX: false, snappedZ: false,
        snapEdgeX: 0, snapEdgeZ: 0,
      };
    }

    const bestCandidate: ObbSnapCandidate | null = StlBBoxSnapHelper.findBestObbCandidate(previewObb, targetObbs, threshold);
    if (bestCandidate === null) {
      return {
        offsetX: 0,
        offsetZ: 0,
        snappedX: false,
        snappedZ: false,
        snapEdgeX: 0,
        snapEdgeZ: 0,
      };
    }

    const offsetX: number = bestCandidate.offset.x;
    const offsetZ: number = bestCandidate.offset.z;
    const snappedX: boolean = Math.abs(offsetX) > 0.000001;
    const snappedZ: boolean = Math.abs(offsetZ) > 0.000001;
    const guideCenter: THREE.Vector3 = bestCandidate.guideStartPoint.clone().add(bestCandidate.guideEndPoint).multiplyScalar(0.5);

    return {
      offsetX: offsetX,
      offsetZ: offsetZ,
      snappedX: snappedX,
      snappedZ: snappedZ,
      /* 兼容旧虚线字段：OBB 模式下取吸附边中心坐标，实际绘制优先使用下方有向线段。 */
      snapEdgeX: guideCenter.x,
      snapEdgeZ: guideCenter.z,
      snapGuideStartPoint: bestCandidate.guideStartPoint,
      snapGuideEndPoint: bestCandidate.guideEndPoint,
    };
  }

  /**
   * 查找最近的 OBB 平行边吸附候选。
   * @param previewObb - 预览模型 OBB
   * @param targetObbs - 目标 OBB 列表
   * @param threshold - 吸附阈值
   * @returns 最近候选；无符合条件候选时返回 null
   */
  private static findBestObbCandidate(
    previewObb: StlObb2D,
    targetObbs: Array<StlObb2D>,
    threshold: number
  ): ObbSnapCandidate | null {
    let bestCandidate: ObbSnapCandidate | null = null;
    for (let previewEdgeIndex: number = 0; previewEdgeIndex < previewObb.edges.length; previewEdgeIndex += 1) {
      const previewEdge: StlObbEdge2D | undefined = previewObb.edges[previewEdgeIndex];
      if (previewEdge === undefined) {
        continue;
      }
      for (let targetObbIndex: number = 0; targetObbIndex < targetObbs.length; targetObbIndex += 1) {
        const targetObb: StlObb2D | undefined = targetObbs[targetObbIndex];
        if (targetObb === undefined) {
          continue;
        }
        const candidate: ObbSnapCandidate | null = StlBBoxSnapHelper.findEdgeCandidate(previewEdge, targetObb.edges, threshold);
        if (candidate === null) {
          continue;
        }
        if (bestCandidate === null || candidate.distance < bestCandidate.distance) {
          bestCandidate = candidate;
        }
      }
    }
    return bestCandidate;
  }

  /**
   * 查找单条预览边与目标边集合之间的吸附候选。
   * @param previewEdge - 预览 OBB 边
   * @param targetEdges - 目标 OBB 边集合
   * @param threshold - 吸附阈值
   * @returns 最近候选；无符合条件候选时返回 null
   */
  private static findEdgeCandidate(
    previewEdge: StlObbEdge2D,
    targetEdges: StlObbEdge2D[],
    threshold: number
  ): ObbSnapCandidate | null {
    let bestCandidate: ObbSnapCandidate | null = null;
    const previewRange: StlProjectionRange = StlObbHelper.computeProjectionRange(
      StlObbHelper.createSegmentPoints(previewEdge.startPoint, previewEdge.endPoint),
      previewEdge.direction
    );

    for (let targetEdgeIndex: number = 0; targetEdgeIndex < targetEdges.length; targetEdgeIndex += 1) {
      const targetEdge: StlObbEdge2D | undefined = targetEdges[targetEdgeIndex];
      if (targetEdge === undefined) {
        continue;
      }
      const parallelDot: number = Math.abs(StlObbHelper.dotXZ(previewEdge.direction, targetEdge.direction));
      if (parallelDot < PARALLEL_DOT_THRESHOLD) {
        continue;
      }
      const targetRange: StlProjectionRange = StlObbHelper.computeProjectionRange(
        StlObbHelper.createSegmentPoints(targetEdge.startPoint, targetEdge.endPoint),
        previewEdge.direction
      );
      if (!StlObbHelper.rangesOverlap(previewRange, targetRange, threshold)) {
        continue;
      }

      /* 候选计算：沿预览边外法线平移预览模型，使预览边线与目标边线重合。 */
      const signedDistance: number = StlObbHelper.dotXZ(
        targetEdge.startPoint.clone().sub(previewEdge.startPoint),
        previewEdge.normal
      );
      const distance: number = Math.abs(signedDistance);
      if (distance >= threshold) {
        continue;
      }
      const offset: THREE.Vector3 = previewEdge.normal.clone().multiplyScalar(signedDistance);
      const candidate: ObbSnapCandidate = {
        offset: offset,
        distance: distance,
        guideStartPoint: previewEdge.startPoint.clone().add(offset),
        guideEndPoint: previewEdge.endPoint.clone().add(offset),
      };
      if (bestCandidate === null || candidate.distance < bestCandidate.distance) {
        bestCandidate = candidate;
      }
    }

    return bestCandidate;
  }
}
