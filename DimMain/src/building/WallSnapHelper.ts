/**
 * 墙中线拾取辅助器
 * 在门窗布置模式下，检测鼠标射线在地面（Y=0）的投影点 P
 * 是否靠近某面直墙的中心线段 L（两端点连线）
 * 若 P 到 L 的最短距离小于吸附阈值，返回吸附结果（吸附点、墙面法线、墙方向、参数 t）
 */

import * as THREE from 'three/webgpu';
import type { StraightWallData, WallData } from './BuildingTypes';

/* ========== 类型定义 ========== */

/**
 * 墙中线吸附结果
 * 当地面投影点 P 距离某面直墙中心线 L 小于阈值时返回此结构
 */
export interface WallSnapResult {
  /** 吸附到的墙体 ID */
  wallId: string;
  /** 吸附点在世界坐标中的位置（P 在 L 上的投影点，Y=0） */
  snapPoint: THREE.Vector3;
  /** 墙面前侧法线方向（XZ 平面内单位向量，Y=0） */
  wallNormal: THREE.Vector3;
  /** 墙体方向单位向量（从起点指向终点，XZ 平面内，Y=0） */
  wallDir: THREE.Vector3;
  /** 吸附点在墙中线上的参数 t（0=起点，1=终点） */
  t: number;
  /** 地面投影点 P 到吸附点的距离（米） */
  distance: number;
}

/* ========== 常量 ========== */

/** 墙中线吸附阈值（米），地面投影点在此距离内自动吸附 */
const WALL_SNAP_THRESHOLD: number = 0.5;

/** 地面平面（Y=0，法线朝上） */
const GROUND_PLANE: THREE.Plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/* ========== 主类 ========== */

/**
 * 墙中线拾取辅助器
 * 无状态工具类，所有方法均为静态方法
 */
export class WallSnapHelper {
  /**
   * 检测鼠标射线是否靠近任意直墙中心线
   *
   * 算法：
   * 1. 将鼠标射线与 Y=0 地面平面求交，得到地面投影点 P
   * 2. 对每面直墙，计算 P 到墙中线线段 L 的最短距离
   * 3. 若距离 < 阈值，记录为候选吸附结果
   * 4. 返回距离最小的候选结果
   *
   * @param ray - 鼠标射线（世界坐标）
   * @param walls - 所有直墙数据列表
   * @returns 最近的吸附结果，若无则返回 null
   */
  public static findNearestWall(
    ray: THREE.Ray,
    walls: StraightWallData[]
  ): WallSnapResult | null {
    /* 将射线与 Y=0 地面平面求交，得到地面投影点 P */
    const groundPoint: THREE.Vector3 = new THREE.Vector3();
    const hit: THREE.Vector3 | null = ray.intersectPlane(GROUND_PLANE, groundPoint);

    /* 射线与地面平行或背向地面，无法求交 */
    if (hit === null) {
      return null;
    }

    let bestResult: WallSnapResult | null = null;
    let bestDistance: number = WALL_SNAP_THRESHOLD;

    for (const wall of walls) {
      const result: WallSnapResult | null = WallSnapHelper._checkWall(groundPoint, wall);
      if (result !== null && result.distance < bestDistance) {
        bestDistance = result.distance;
        bestResult = result;
      }
    }

    return bestResult;
  }

  /**
   * 检测地面投影点 P 是否靠近指定直墙的中心线段 L
   *
   * 算法：
   * 1. 计算 P 在线段 L 上的投影参数 t = clamp(dot(P-start, dir) / wallLength, 0, 1)
   * 2. 投影点 snapPoint = start + t * dir * wallLength
   * 3. distance = |P - snapPoint|（XZ 平面内）
   * 4. 若 distance < 阈值，返回吸附结果
   *
   * @param groundPoint - 鼠标射线在地面（Y=0）的投影点
   * @param wall - 直墙数据
   * @returns 吸附结果，若距离超过阈值则返回 null
   */
  private static _checkWall(
    groundPoint: THREE.Vector3,
    wall: StraightWallData
  ): WallSnapResult | null {
    /* 墙中线起点和终点（Y=0，XZ 平面） */
    const startX: number = wall.start.x;
    const startZ: number = wall.start.z;
    const endX: number = wall.end.x;
    const endZ: number = wall.end.z;

    /* 墙中线方向向量（XZ 平面） */
    const dirRawX: number = endX - startX;
    const dirRawZ: number = endZ - startZ;
    const wallLength: number = Math.sqrt(dirRawX * dirRawX + dirRawZ * dirRawZ);

    /* 墙长度过短，跳过 */
    if (wallLength < 0.001) {
      return null;
    }

    /* 单位方向向量 */
    const dirX: number = dirRawX / wallLength;
    const dirZ: number = dirRawZ / wallLength;

    /* 计算地面点 P 到线段起点的向量 */
    const px: number = groundPoint.x - startX;
    const pz: number = groundPoint.z - startZ;

    /* 计算投影参数 t = dot(P-start, dir) / wallLength，限制在 [0, 1] */
    const tRaw: number = (px * dirX + pz * dirZ) / wallLength;
    const t: number = Math.max(0, Math.min(1, tRaw));

    /* 计算投影点（吸附点） */
    const snapX: number = startX + dirX * t * wallLength;
    const snapZ: number = startZ + dirZ * t * wallLength;

    /* 计算 P 到投影点的距离（XZ 平面内） */
    const dx: number = groundPoint.x - snapX;
    const dz: number = groundPoint.z - snapZ;
    const distance: number = Math.sqrt(dx * dx + dz * dz);

    if (distance > WALL_SNAP_THRESHOLD) {
      return null;
    }

    /* 墙体方向单位向量 */
    const wallDir: THREE.Vector3 = new THREE.Vector3(dirX, 0, dirZ);

    /* 墙面前侧法线（XZ 平面内逆时针旋转 90°：(-dirZ, 0, dirX)） */
    const wallNormal: THREE.Vector3 = new THREE.Vector3(-dirZ, 0, dirX);

    /* 吸附点（Y=0） */
    const snapPoint: THREE.Vector3 = new THREE.Vector3(snapX, 0, snapZ);

    return {
      wallId: wall.id,
      snapPoint: snapPoint,
      wallNormal: wallNormal,
      wallDir: wallDir,
      t: t,
      distance: distance,
    };
  }

  /**
   * 从墙体数据列表中过滤出直墙
   * @param walls - 墙体数据列表（可能包含弧形墙和矩形墙）
   * @returns 直墙数据列表
   */
  public static filterStraightWalls(walls: WallData[]): StraightWallData[] {
    const result: StraightWallData[] = [];
    for (const wall of walls) {
      if (wall.subType === 'straight') {
        result.push(wall as StraightWallData);
      }
    }
    return result;
  }
}
