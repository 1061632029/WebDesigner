/**
 * 门窗墙体边界校验器。
 * 用于判断门窗沿墙方向的完整投影是否完全落在目标直墙范围内。
 */

import * as THREE from 'three/webgpu';
import type { StraightWallData } from '../building/BuildingTypes';
import type { WallSnapResult } from '../building/WallSnapHelper';
import { StlObbHelper } from './StlObbHelper';
import type { StlProjectionRange } from './StlObbHelper';

/** 门窗墙体边界校验结果。 */
export interface DoorWindowWallBoundsValidationResult {
  /** 门窗完整投影是否在墙体范围内。 */
  isWithinBounds: boolean;
  /** 门窗沿墙方向的投影区间，单位米。 */
  range: StlProjectionRange;
  /** 目标墙体长度，单位米。 */
  wallLength: number;
  /** 左侧超出墙体起点的距离，未超出时为 0。 */
  leftOverflow: number;
  /** 右侧超出墙体终点的距离，未超出时为 0。 */
  rightOverflow: number;
}

/** 数值容差，允许浮点误差造成的极小越界。 */
const WALL_BOUNDS_TOLERANCE: number = 0.001;

/** 墙方向退化阈值。 */
const MIN_WALL_LENGTH: number = 0.001;

/** 门窗墙体边界校验器。 */
export class DoorWindowWallBoundsValidator {
  /**
   * 校验门窗 Mesh 是否完整落在目标直墙范围内。
   * @param mesh - 待校验门窗 Mesh
   * @param wallData - 目标直墙数据
   * @param snapResult - 当前墙体吸附结果
   * @returns 墙体边界校验结果
   */
  public static validate(
    mesh: THREE.Mesh,
    wallData: StraightWallData,
    snapResult: WallSnapResult
  ): DoorWindowWallBoundsValidationResult {
    const wallLength: number = DoorWindowWallBoundsValidator.computeStraightWallLength(wallData);
    const wallOrigin: THREE.Vector3 = new THREE.Vector3(wallData.start.x, 0, wallData.start.z);
    const wallDir: THREE.Vector3 = DoorWindowWallBoundsValidator.resolveWallDirection(wallData, snapResult);

    if (wallLength <= MIN_WALL_LENGTH || wallDir.lengthSq() <= 0.000001) {
      return DoorWindowWallBoundsValidator.createInvalidResult(wallLength);
    }

    /* 边界校验流程：使用门窗 OBB 沿墙方向的真实投影，确保模型左右边界都没有超出墙体起止点。 */
    mesh.updateMatrixWorld(true);
    const range: StlProjectionRange = StlObbHelper.computeObbProjectionRange(mesh, wallOrigin, wallDir);
    const leftOverflow: number = Math.max(0, -range.min);
    const rightOverflow: number = Math.max(0, range.max - wallLength);
    const isWithinBounds: boolean = (
      range.min >= -WALL_BOUNDS_TOLERANCE &&
      range.max <= wallLength + WALL_BOUNDS_TOLERANCE
    );

    return {
      isWithinBounds: isWithinBounds,
      range: range,
      wallLength: wallLength,
      leftOverflow: leftOverflow,
      rightOverflow: rightOverflow,
    };
  }

  /**
   * 计算直墙长度。
   * @param wallData - 目标直墙数据
   * @returns 墙体中心线长度，单位米
   */
  private static computeStraightWallLength(wallData: StraightWallData): number {
    const deltaX: number = wallData.end.x - wallData.start.x;
    const deltaZ: number = wallData.end.z - wallData.start.z;
    return Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
  }

  /**
   * 解析墙体方向单位向量。
   * @param wallData - 目标直墙数据
   * @param snapResult - 当前墙体吸附结果
   * @returns XZ 平面墙方向单位向量
   */
  private static resolveWallDirection(wallData: StraightWallData, snapResult: WallSnapResult): THREE.Vector3 {
    const snapWallDir: THREE.Vector3 = snapResult.wallDir.clone().setY(0);
    if (snapWallDir.lengthSq() > 0.000001) {
      return snapWallDir.normalize();
    }

    const wallDir: THREE.Vector3 = new THREE.Vector3(
      wallData.end.x - wallData.start.x,
      0,
      wallData.end.z - wallData.start.z
    );
    if (wallDir.lengthSq() > 0.000001) {
      wallDir.normalize();
    }
    return wallDir;
  }

  /**
   * 创建无效墙体方向时的校验结果。
   * @param wallLength - 当前墙体长度
   * @returns 无效校验结果
   */
  private static createInvalidResult(wallLength: number): DoorWindowWallBoundsValidationResult {
    return {
      isWithinBounds: false,
      range: { min: 0, max: 0 },
      wallLength: wallLength,
      leftOverflow: 0,
      rightOverflow: 0,
    };
  }
}