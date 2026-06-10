/**
 * 门窗碰撞检测器
 * 负责检测墙体门窗构件之间是否发生空间重叠，供布置、移动和尺寸修改流程使用。
 */

import * as THREE from 'three/webgpu';

/** 门窗碰撞检测结果 */
export interface DoorWindowCollisionResult {
  /** 是否发生碰撞 */
  collided: boolean;
  /** 与目标发生碰撞的门窗 Mesh，未碰撞时为 null */
  collidedMesh: THREE.Mesh | null;
}

/** 门窗投影区间 */
interface DoorWindowProjectionRange {
  /** 沿墙方向的最小投影值 */
  minAlongWall: number;
  /** 沿墙方向的最大投影值 */
  maxAlongWall: number;
  /** 高度方向最小值 */
  minY: number;
  /** 高度方向最大值 */
  maxY: number;
}

/** 门窗类别集合，用于过滤普通 STL 模型 */
const DOOR_WINDOW_CATEGORIES: Set<string> = new Set<string>(['door', 'window']);

/** 区间重叠容差，避免仅边界贴合被误判为碰撞 */
const OVERLAP_EPSILON: number = 0.001;

/**
 * 门窗碰撞检测器
 * 只检测门/窗 STL Mesh 之间的重叠关系，不修改场景状态。
 */
export class DoorWindowCollisionDetector {
  /**
   * 检测目标门窗是否与场景中已有门窗碰撞。
   *
   * 核心逻辑：
   * 1. 遍历 root 下所有可见门窗 Mesh。
   * 2. 排除目标 Mesh 自身。
   * 3. 若目标绑定 wallId，则只检测同墙门窗，避免不同墙体交叉处误判。
   * 4. 优先使用墙方向投影 + 高度区间判断；缺少墙方向时退化为 AABB 检测。
   *
   * @param targetMesh - 待检测的目标门窗 Mesh
   * @param root - 用于遍历已有门窗的根对象，通常为 Three.js Scene
   * @returns 碰撞检测结果
   */
  public static detect(targetMesh: THREE.Mesh, root: THREE.Object3D): DoorWindowCollisionResult {
    targetMesh.updateMatrixWorld(true);

    const candidateMeshes: Array<THREE.Mesh> = DoorWindowCollisionDetector.collectDoorWindowMeshes(root);
    for (const candidateMesh of candidateMeshes) {
      if (candidateMesh.uuid === targetMesh.uuid) {
        continue;
      }

      if (!DoorWindowCollisionDetector.shouldCompare(targetMesh, candidateMesh)) {
        continue;
      }

      if (DoorWindowCollisionDetector.intersects(targetMesh, candidateMesh)) {
        return {
          collided: true,
          collidedMesh: candidateMesh,
        };
      }
    }

    return {
      collided: false,
      collidedMesh: null,
    };
  }

  /**
   * 判断 Mesh 是否属于门窗类别。
   * @param mesh - 待判断 Mesh
   * @returns true 表示 Mesh 是门或窗
   */
  public static isDoorWindowMesh(mesh: THREE.Mesh): boolean {
    const category: string | undefined = mesh.userData['category'] as string | undefined;
    return category !== undefined && DOOR_WINDOW_CATEGORIES.has(category);
  }

  /**
   * 收集根对象下所有可见门窗 Mesh。
   * @param root - 遍历根对象
   * @returns 门窗 Mesh 数组
   */
  private static collectDoorWindowMeshes(root: THREE.Object3D): Array<THREE.Mesh> {
    const meshes: Array<THREE.Mesh> = [];

    root.traverse((child: THREE.Object3D): void => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }

      if (!child.visible) {
        return;
      }

      /* 布置预览 Mesh 只用于鼠标跟随显示，不属于已放置门窗；碰撞检测必须跳过，避免点击放置时与自身预览重叠而误判。 */
      if (child.userData['isPlacementPreview'] === true) {
        return;
      }

      if (!DoorWindowCollisionDetector.isDoorWindowMesh(child)) {
        return;
      }

      meshes.push(child);
    });

    return meshes;
  }

  /**
   * 判断两个门窗是否需要互相检测。
   * @param targetMesh - 当前操作的目标门窗
   * @param candidateMesh - 场景中的候选门窗
   * @returns true 表示需要检测碰撞
   */
  private static shouldCompare(targetMesh: THREE.Mesh, candidateMesh: THREE.Mesh): boolean {
    const targetWallId: string | undefined = targetMesh.userData['wallId'] as string | undefined;
    const candidateWallId: string | undefined = candidateMesh.userData['wallId'] as string | undefined;

    /* 绑定到墙体的门窗只与同一墙体上的门窗比较，避免相邻墙体转角处误判。 */
    if (targetWallId !== undefined && candidateWallId !== undefined) {
      return targetWallId === candidateWallId;
    }

    return true;
  }

  /**
   * 判断两个门窗 Mesh 是否碰撞。
   * @param targetMesh - 当前操作的目标门窗
   * @param candidateMesh - 场景中的候选门窗
   * @returns true 表示发生碰撞
   */
  private static intersects(targetMesh: THREE.Mesh, candidateMesh: THREE.Mesh): boolean {
    const wallDir: THREE.Vector3 | null = DoorWindowCollisionDetector.resolveWallDirection(targetMesh);

    if (wallDir !== null) {
      const targetRange: DoorWindowProjectionRange = DoorWindowCollisionDetector.computeProjectionRange(targetMesh, wallDir);
      const candidateRange: DoorWindowProjectionRange = DoorWindowCollisionDetector.computeProjectionRange(candidateMesh, wallDir);
      const horizontalOverlap: boolean = DoorWindowCollisionDetector.hasPositiveOverlap(
        targetRange.minAlongWall,
        targetRange.maxAlongWall,
        candidateRange.minAlongWall,
        candidateRange.maxAlongWall
      );
      const verticalOverlap: boolean = DoorWindowCollisionDetector.hasPositiveOverlap(
        targetRange.minY,
        targetRange.maxY,
        candidateRange.minY,
        candidateRange.maxY
      );

      return horizontalOverlap && verticalOverlap;
    }

    const targetBox: THREE.Box3 = new THREE.Box3().setFromObject(targetMesh);
    const candidateBox: THREE.Box3 = new THREE.Box3().setFromObject(candidateMesh);
    return targetBox.intersectsBox(candidateBox);
  }

  /**
   * 从 Mesh.userData 中读取墙体方向。
   * @param mesh - 门窗 Mesh
   * @returns 单位化墙方向，缺失时返回 null
   */
  private static resolveWallDirection(mesh: THREE.Mesh): THREE.Vector3 | null {
    const wallDirX: number | undefined = mesh.userData['wallDirX'] as number | undefined;
    const wallDirZ: number | undefined = mesh.userData['wallDirZ'] as number | undefined;

    if (wallDirX === undefined || wallDirZ === undefined) {
      return null;
    }

    const direction: THREE.Vector3 = new THREE.Vector3(wallDirX, 0, wallDirZ);
    if (direction.lengthSq() < 0.000001) {
      return null;
    }

    direction.normalize();
    return direction;
  }

  /**
   * 计算门窗世界包围盒在墙方向和高度方向上的区间。
   * @param mesh - 门窗 Mesh
   * @param wallDir - 单位化墙方向
   * @returns 投影区间
   */
  private static computeProjectionRange(mesh: THREE.Mesh, wallDir: THREE.Vector3): DoorWindowProjectionRange {
    const box: THREE.Box3 = new THREE.Box3().setFromObject(mesh);
    const corners: Array<THREE.Vector3> = [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
    ];

    let minAlongWall: number = Infinity;
    let maxAlongWall: number = -Infinity;

    for (const corner of corners) {
      const projectedValue: number = corner.dot(wallDir);
      if (projectedValue < minAlongWall) {
        minAlongWall = projectedValue;
      }
      if (projectedValue > maxAlongWall) {
        maxAlongWall = projectedValue;
      }
    }

    return {
      minAlongWall: minAlongWall,
      maxAlongWall: maxAlongWall,
      minY: box.min.y,
      maxY: box.max.y,
    };
  }

  /**
   * 判断两个一维区间是否存在正面积重叠。
   * @param minA - 区间 A 最小值
   * @param maxA - 区间 A 最大值
   * @param minB - 区间 B 最小值
   * @param maxB - 区间 B 最大值
   * @returns true 表示区间有超过容差的重叠
   */
  private static hasPositiveOverlap(minA: number, maxA: number, minB: number, maxB: number): boolean {
    const overlapSize: number = Math.min(maxA, maxB) - Math.max(minA, minB);
    return overlapSize > OVERLAP_EPSILON;
  }
}