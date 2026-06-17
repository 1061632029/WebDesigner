/**
 * STL 模型 XZ 平面 OBB（有向包围盒）计算工具。
 * 该工具只负责几何计算，不持有场景状态，供 STL 布置吸附与距离标注复用。
 */

import * as THREE from 'three/webgpu';
import type { StlPlacementDimensionSide } from './StlPlacementDimensionRenderer';

/** XZ 平面 OBB 边界数据。 */
export interface StlObbEdge2D {
  /** 边所属方向，兼容旧版四方向标注命名。 */
  side: StlPlacementDimensionSide;
  /** 边起点世界坐标。 */
  startPoint: THREE.Vector3;
  /** 边终点世界坐标。 */
  endPoint: THREE.Vector3;
  /** 边方向单位向量，仅包含 XZ 分量。 */
  direction: THREE.Vector3;
  /** 边外法线单位向量，仅包含 XZ 分量。 */
  normal: THREE.Vector3;
}

/** XZ 平面 OBB 数据。 */
export interface StlObb2D {
  /** OBB 中心点世界坐标。 */
  center: THREE.Vector3;
  /** OBB 本地 U 轴世界方向，来自模型局部 X 轴在 XZ 平面的投影。 */
  axisU: THREE.Vector3;
  /** OBB 本地 V 轴世界方向，来自模型局部 Z 轴在 XZ 平面的投影。 */
  axisV: THREE.Vector3;
  /** U 轴半尺寸，单位米。 */
  halfU: number;
  /** V 轴半尺寸，单位米。 */
  halfV: number;
  /** OBB 四个角点，顺序为 minU/minV、maxU/minV、maxU/maxV、minU/maxV。 */
  corners: THREE.Vector3[];
  /** OBB 四条边，顺序兼容 minZ、maxX、maxZ、minX。 */
  edges: StlObbEdge2D[];
}

/** 可序列化的 XZ 平面 OBB 缓存数据，用于写入 Mesh.userData。 */
export interface StlObb2DCache {
  /** OBB 中心点 XZ 坐标。 */
  center: { x: number; z: number };
  /** OBB 本地 U 轴世界方向。 */
  axisU: { x: number; z: number };
  /** OBB 本地 V 轴世界方向。 */
  axisV: { x: number; z: number };
  /** U 轴半尺寸，单位米。 */
  halfU: number;
  /** V 轴半尺寸，单位米。 */
  halfV: number;
  /** OBB 四个角点 XZ 坐标。 */
  corners: Array<{ x: number; z: number }>;
  /** OBB 尺寸信息，兼容旧 boundingBox.size 读取。 */
  size: { x: number; y: number; z: number };
}

/** 一维投影区间。 */
export interface StlProjectionRange {
  /** 投影最小值。 */
  min: number;
  /** 投影最大值。 */
  max: number;
}

/** 数值容差。 */
const EPSILON: number = 0.000001;

/** 默认 X 轴方向。 */
const DEFAULT_AXIS_U: THREE.Vector3 = new THREE.Vector3(1, 0, 0);

/** 默认 Z 轴方向。 */
const DEFAULT_AXIS_V: THREE.Vector3 = new THREE.Vector3(0, 0, 1);

/** STL OBB 计算工具类。 */
export class StlObbHelper {
  /**
   * 计算 Mesh 在 XZ 平面的 OBB。
   * @param mesh - 待计算 Mesh
   * @returns XZ 平面有向包围盒
   */
  public static computeObb2D(mesh: THREE.Mesh): StlObb2D {
    /* OBB 计算流程：先获取模型世界旋转轴，再把局部包围盒角点投影到该轴上得到有向范围。 */
    mesh.updateMatrixWorld(true);
    const geometry: THREE.BufferGeometry = mesh.geometry;
    if (geometry.boundingBox === null) {
      geometry.computeBoundingBox();
    }

    const localBox: THREE.Box3 | null = geometry.boundingBox;
    if (localBox === null || localBox.isEmpty()) {
      return StlObbHelper.createEmptyObb(mesh);
    }

    const axisU: THREE.Vector3 = StlObbHelper.resolveWorldAxis(mesh, DEFAULT_AXIS_U, DEFAULT_AXIS_U);
    const axisV: THREE.Vector3 = StlObbHelper.resolveWorldAxis(mesh, DEFAULT_AXIS_V, DEFAULT_AXIS_V);
    const worldCorners: THREE.Vector3[] = StlObbHelper.computeWorldBoxCorners(localBox, mesh.matrixWorld);

    const rangeU: StlProjectionRange = StlObbHelper.computeProjectionRange(worldCorners, axisU);
    const rangeV: StlProjectionRange = StlObbHelper.computeProjectionRange(worldCorners, axisV);
    const centerU: number = (rangeU.min + rangeU.max) * 0.5;
    const centerV: number = (rangeV.min + rangeV.max) * 0.5;
    const halfU: number = Math.max((rangeU.max - rangeU.min) * 0.5, 0);
    const halfV: number = Math.max((rangeV.max - rangeV.min) * 0.5, 0);
    const center: THREE.Vector3 = axisU.clone().multiplyScalar(centerU).add(axisV.clone().multiplyScalar(centerV));
    center.y = StlObbHelper.computeAverageY(worldCorners);

    const cornerMinUMinV: THREE.Vector3 = StlObbHelper.createCorner(center, axisU, axisV, -halfU, -halfV);
    const cornerMaxUMinV: THREE.Vector3 = StlObbHelper.createCorner(center, axisU, axisV, halfU, -halfV);
    const cornerMaxUMaxV: THREE.Vector3 = StlObbHelper.createCorner(center, axisU, axisV, halfU, halfV);
    const cornerMinUMaxV: THREE.Vector3 = StlObbHelper.createCorner(center, axisU, axisV, -halfU, halfV);
    const corners: THREE.Vector3[] = [cornerMinUMinV, cornerMaxUMinV, cornerMaxUMaxV, cornerMinUMaxV];

    return {
      center: center,
      axisU: axisU,
      axisV: axisV,
      halfU: halfU,
      halfV: halfV,
      corners: corners,
      edges: StlObbHelper.createEdges(corners, axisU, axisV),
    };
  }

  /**
   * 计算并缓存 Mesh 的 XZ 平面 OBB 数据到 userData。
   * 关键流程：正式放置或厚度变化后立即刷新缓存，避免旧 AABB 字段继续参与 STL 布置逻辑。
   * @param mesh - 待刷新缓存的 Mesh
   * @returns 可序列化 OBB 缓存数据
   */
  public static refreshObbCache(mesh: THREE.Mesh): StlObb2DCache {
    mesh.updateMatrixWorld(true);
    const obb: StlObb2D = StlObbHelper.computeObb2D(mesh);
    const worldBox: THREE.Box3 = new THREE.Box3().setFromObject(mesh);
    const cache: StlObb2DCache = {
      center: { x: obb.center.x, z: obb.center.z },
      axisU: { x: obb.axisU.x, z: obb.axisU.z },
      axisV: { x: obb.axisV.x, z: obb.axisV.z },
      halfU: obb.halfU,
      halfV: obb.halfV,
      corners: obb.corners.map((corner: THREE.Vector3): { x: number; z: number } => ({
        x: corner.x,
        z: corner.z,
      })),
      size: {
        x: obb.halfU * 2,
        y: worldBox.isEmpty() ? 0 : worldBox.max.y - worldBox.min.y,
        z: obb.halfV * 2,
      },
    };

    mesh.userData['obb'] = cache;
    mesh.userData['boundingBox'] = cache;
    return cache;
  }

  /**
   * 获取 OBB 四角点在指定方向上的投影区间。
   * @param mesh - 目标 Mesh
   * @param origin - 投影原点
   * @param direction - 投影方向单位向量
   * @returns 沿指定方向的最小/最大投影值
   */
  public static computeObbProjectionRange(
    mesh: THREE.Mesh,
    origin: THREE.Vector3,
    direction: THREE.Vector3
  ): StlProjectionRange {
    const obb: StlObb2D = StlObbHelper.computeObb2D(mesh);
    let minProjection: number = Number.POSITIVE_INFINITY;
    let maxProjection: number = Number.NEGATIVE_INFINITY;

    /* 投影流程：只使用 OBB 四角点，确保旋转后的 STL 使用自身朝向边界，而不是世界轴 AABB。 */
    for (let cornerIndex: number = 0; cornerIndex < obb.corners.length; cornerIndex += 1) {
      const corner: THREE.Vector3 | undefined = obb.corners[cornerIndex];
      if (corner === undefined) {
        continue;
      }
      const projection: number = corner.clone().sub(origin).dot(direction);
      minProjection = Math.min(minProjection, projection);
      maxProjection = Math.max(maxProjection, projection);
    }

    if (!Number.isFinite(minProjection) || !Number.isFinite(maxProjection)) {
      return { min: 0, max: 0 };
    }

    return { min: minProjection, max: maxProjection };
  }

  /**
   * 计算点集在指定轴向上的投影区间。
   * @param points - 待投影点集
   * @param axis - 投影轴单位向量
   * @returns 投影区间
   */
  public static computeProjectionRange(points: THREE.Vector3[], axis: THREE.Vector3): StlProjectionRange {
    let min: number = Number.POSITIVE_INFINITY;
    let max: number = Number.NEGATIVE_INFINITY;
    for (let pointIndex: number = 0; pointIndex < points.length; pointIndex += 1) {
      const point: THREE.Vector3 | undefined = points[pointIndex];
      if (point === undefined) {
        continue;
      }
      const value: number = StlObbHelper.dotXZ(point, axis);
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    return { min: min, max: max };
  }

  /**
   * 计算两个 XZ 向量的点积。
   * @param a - 向量 A
   * @param b - 向量 B
   * @returns 点积
   */
  public static dotXZ(a: THREE.Vector3, b: THREE.Vector3): number {
    return a.x * b.x + a.z * b.z;
  }

  /**
   * 判断两个投影区间是否存在重叠。
   * @param first - 第一个区间
   * @param second - 第二个区间
   * @param tolerance - 容差
   * @returns 存在重叠或接触时返回 true
   */
  public static rangesOverlap(first: StlProjectionRange, second: StlProjectionRange, tolerance: number): boolean {
    return first.max + tolerance >= second.min && second.max + tolerance >= first.min;
  }

  /**
   * 根据起止点创建点数组。
   * @param startPoint - 起点
   * @param endPoint - 终点
   * @returns 点数组
   */
  public static createSegmentPoints(startPoint: THREE.Vector3, endPoint: THREE.Vector3): THREE.Vector3[] {
    return [startPoint, endPoint];
  }

  /**
   * 创建空 OBB，避免异常几何体中断布置流程。
   * @param mesh - 待计算 Mesh
   * @returns 空 OBB
   */
  private static createEmptyObb(mesh: THREE.Mesh): StlObb2D {
    const center: THREE.Vector3 = mesh.getWorldPosition(new THREE.Vector3());
    const corners: THREE.Vector3[] = [center.clone(), center.clone(), center.clone(), center.clone()];
    return {
      center: center,
      axisU: DEFAULT_AXIS_U.clone(),
      axisV: DEFAULT_AXIS_V.clone(),
      halfU: 0,
      halfV: 0,
      corners: corners,
      edges: StlObbHelper.createEdges(corners, DEFAULT_AXIS_U, DEFAULT_AXIS_V),
    };
  }

  /**
   * 获取模型局部轴在世界 XZ 平面的方向。
   * @param mesh - 目标 Mesh
   * @param localAxis - 局部轴方向
   * @param fallbackAxis - 投影退化时使用的备用轴
   * @returns XZ 平面单位方向
   */
  private static resolveWorldAxis(mesh: THREE.Mesh, localAxis: THREE.Vector3, fallbackAxis: THREE.Vector3): THREE.Vector3 {
    const quaternion: THREE.Quaternion = mesh.getWorldQuaternion(new THREE.Quaternion());
    const axis: THREE.Vector3 = localAxis.clone().applyQuaternion(quaternion);
    axis.y = 0;
    if (axis.lengthSq() < EPSILON) {
      return fallbackAxis.clone();
    }
    return axis.normalize();
  }

  /**
   * 计算局部 Box3 的 8 个世界角点。
   * @param localBox - 几何体局部包围盒
   * @param matrixWorld - Mesh 世界矩阵
   * @returns 世界角点数组
   */
  private static computeWorldBoxCorners(localBox: THREE.Box3, matrixWorld: THREE.Matrix4): THREE.Vector3[] {
    const min: THREE.Vector3 = localBox.min;
    const max: THREE.Vector3 = localBox.max;
    const corners: THREE.Vector3[] = [
      new THREE.Vector3(min.x, min.y, min.z),
      new THREE.Vector3(max.x, min.y, min.z),
      new THREE.Vector3(max.x, max.y, min.z),
      new THREE.Vector3(min.x, max.y, min.z),
      new THREE.Vector3(min.x, min.y, max.z),
      new THREE.Vector3(max.x, min.y, max.z),
      new THREE.Vector3(max.x, max.y, max.z),
      new THREE.Vector3(min.x, max.y, max.z),
    ];
    for (let cornerIndex: number = 0; cornerIndex < corners.length; cornerIndex += 1) {
      const corner: THREE.Vector3 | undefined = corners[cornerIndex];
      if (corner !== undefined) {
        corner.applyMatrix4(matrixWorld);
      }
    }
    return corners;
  }

  /**
   * 计算点集平均高度。
   * @param points - 点集
   * @returns 平均 Y 坐标
   */
  private static computeAverageY(points: THREE.Vector3[]): number {
    if (points.length === 0) {
      return 0;
    }
    let sumY: number = 0;
    for (let pointIndex: number = 0; pointIndex < points.length; pointIndex += 1) {
      const point: THREE.Vector3 | undefined = points[pointIndex];
      if (point !== undefined) {
        sumY += point.y;
      }
    }
    return sumY / points.length;
  }

  /**
   * 根据中心点、轴向和半尺寸创建角点。
   * @param center - 中心点
   * @param axisU - U 轴
   * @param axisV - V 轴
   * @param offsetU - U 轴偏移
   * @param offsetV - V 轴偏移
   * @returns OBB 角点
   */
  private static createCorner(
    center: THREE.Vector3,
    axisU: THREE.Vector3,
    axisV: THREE.Vector3,
    offsetU: number,
    offsetV: number
  ): THREE.Vector3 {
    const corner: THREE.Vector3 = center.clone()
      .add(axisU.clone().multiplyScalar(offsetU))
      .add(axisV.clone().multiplyScalar(offsetV));
    corner.y = 0;
    return corner;
  }

  /**
   * 根据四角点创建四条 OBB 边。
   * @param corners - 四角点
   * @param axisU - U 轴方向
   * @param axisV - V 轴方向
   * @returns OBB 边数组
   */
  private static createEdges(corners: THREE.Vector3[], axisU: THREE.Vector3, axisV: THREE.Vector3): StlObbEdge2D[] {
    const corner0: THREE.Vector3 = corners[0] !== undefined ? corners[0] : new THREE.Vector3();
    const corner1: THREE.Vector3 = corners[1] !== undefined ? corners[1] : new THREE.Vector3();
    const corner2: THREE.Vector3 = corners[2] !== undefined ? corners[2] : new THREE.Vector3();
    const corner3: THREE.Vector3 = corners[3] !== undefined ? corners[3] : new THREE.Vector3();
    return [
      StlObbHelper.createEdge('minZ', corner0, corner1, axisU, axisV.clone().multiplyScalar(-1)),
      StlObbHelper.createEdge('maxX', corner1, corner2, axisV, axisU),
      StlObbHelper.createEdge('maxZ', corner3, corner2, axisU, axisV),
      StlObbHelper.createEdge('minX', corner0, corner3, axisV, axisU.clone().multiplyScalar(-1)),
    ];
  }

  /**
   * 创建单条 OBB 边。
   * @param side - 边方向标识
   * @param startPoint - 起点
   * @param endPoint - 终点
   * @param direction - 边方向
   * @param normal - 外法线方向
   * @returns OBB 边数据
   */
  private static createEdge(
    side: StlPlacementDimensionSide,
    startPoint: THREE.Vector3,
    endPoint: THREE.Vector3,
    direction: THREE.Vector3,
    normal: THREE.Vector3
  ): StlObbEdge2D {
    const normalizedDirection: THREE.Vector3 = direction.clone();
    normalizedDirection.y = 0;
    if (normalizedDirection.lengthSq() >= EPSILON) {
      normalizedDirection.normalize();
    }
    const normalizedNormal: THREE.Vector3 = normal.clone();
    normalizedNormal.y = 0;
    if (normalizedNormal.lengthSq() >= EPSILON) {
      normalizedNormal.normalize();
    }
    return {
      side: side,
      startPoint: startPoint.clone(),
      endPoint: endPoint.clone(),
      direction: normalizedDirection,
      normal: normalizedNormal,
    };
  }
}