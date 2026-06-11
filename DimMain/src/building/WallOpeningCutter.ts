/**
 * 墙体扣洞执行器
 * 根据门窗模型的包围盒在墙面法向方向的投影，计算洞口参数
 * 提供纯计算方法（computeOpening）和直接执行方法（cut）
 * 纯计算方法供命令模式使用，直接执行方法供非命令场景使用
 */

import * as THREE from 'three/webgpu';
import type { StraightWallData, WallOpening } from './BuildingTypes';
import type { BuildingObjectManager } from './BuildingObjectManager';
import type { WallSnapResult } from './WallSnapHelper';

/**
 * 墙体扣洞执行器
 * 无状态工具类，所有方法均为静态方法
 */
export class WallOpeningCutter {
  /**
   * 根据门窗 Mesh 和吸附结果计算洞口参数（纯计算，不修改任何状态）
   *
   * 流程：
   * 1. 计算门窗 Mesh 包围盒在墙方向（wallDir）上的投影宽度
   * 2. 计算包围盒 Y 方向高度
   * 3. 计算洞口底部标高（包围盒 min.y 相对于墙体底部）
   *
   * @param snapResult - 墙中线吸附结果（含墙体 ID、吸附点参数 t、墙方向）
   * @param placedMesh - 已放置的门窗 Mesh（已完成旋转对齐，updateMatrixWorld 已调用）
   * @param wallData - 目标墙体数据（用于计算底部标高）
   * @returns 计算出的洞口参数
   */
  public static computeOpening(
    snapResult: WallSnapResult,
    placedMesh: THREE.Mesh,
    wallData: StraightWallData
  ): WallOpening {
    /* 洞口尺寸计算流程：使用 Mesh 自身局部包围盒角点转换到世界坐标，避免非正交墙体上世界 AABB 膨胀导致宽度错误。 */
    placedMesh.updateMatrixWorld(true);
    placedMesh.geometry.computeBoundingBox();
    const localBox: THREE.Box3 | null = placedMesh.geometry.boundingBox;
    if (localBox === null) {
      return {
        centerT: snapResult.t,
        width: 0,
        height: 0,
        bottomElevation: 0,
      };
    }

    const corners: THREE.Vector3[] = WallOpeningCutter._createWorldBoxCorners(localBox, placedMesh.matrixWorld);

    let minProj: number = Infinity;
    let maxProj: number = -Infinity;
    let minY: number = Infinity;
    let maxY: number = -Infinity;

    /* 将真实 OBB 角点投影到墙方向，取跨度作为洞口宽度；同时统计世界 Y 范围作为洞口高度。 */
    for (let index: number = 0; index < corners.length; index++) {
      const corner: THREE.Vector3 = corners[index]!;
      const proj: number = corner.dot(snapResult.wallDir);
      if (proj < minProj) minProj = proj;
      if (proj > maxProj) maxProj = proj;
      if (corner.y < minY) minY = corner.y;
      if (corner.y > maxY) maxY = corner.y;
    }
    const openingWidth: number = maxProj - minProj;

    /* 洞口高度 = Mesh 本体真实世界 Y 范围，避免子级辅助符号影响开洞高度。 */
    const openingHeight: number = maxY - minY;

    /* 洞口底部标高（相对于墙体底部，最小为 0） */
    const bottomElevation: number = Math.max(0, minY - wallData.elevation);

    return {
      centerT: snapResult.t,
      width: openingWidth,
      height: openingHeight,
      bottomElevation: bottomElevation,
    };
  }

  /**
   * 将局部包围盒 8 个角点转换为世界坐标角点。
   *
   * @param localBox - Mesh 几何体局部坐标包围盒
   * @param matrixWorld - Mesh 当前世界矩阵
   * @returns 世界坐标下的 OBB 角点数组
   */
  private static _createWorldBoxCorners(localBox: THREE.Box3, matrixWorld: THREE.Matrix4): THREE.Vector3[] {
    const corners: THREE.Vector3[] = [
      new THREE.Vector3(localBox.min.x, localBox.min.y, localBox.min.z),
      new THREE.Vector3(localBox.min.x, localBox.min.y, localBox.max.z),
      new THREE.Vector3(localBox.min.x, localBox.max.y, localBox.min.z),
      new THREE.Vector3(localBox.min.x, localBox.max.y, localBox.max.z),
      new THREE.Vector3(localBox.max.x, localBox.min.y, localBox.min.z),
      new THREE.Vector3(localBox.max.x, localBox.min.y, localBox.max.z),
      new THREE.Vector3(localBox.max.x, localBox.max.y, localBox.min.z),
      new THREE.Vector3(localBox.max.x, localBox.max.y, localBox.max.z),
    ];

    /* 角点坐标转换流程：仅转换 Mesh 本体局部包围盒，不纳入 2D 图标等子对象，确保洞口尺寸稳定。 */
    for (let index: number = 0; index < corners.length; index++) {
      const corner: THREE.Vector3 = corners[index]!;
      corner.applyMatrix4(matrixWorld);
    }

    return corners;
  }

  /**
   * 对指定墙体执行扣洞操作（直接修改状态，不进命令栈）
   * 仅供非命令场景使用，门窗布置场景请使用 StlPlaceWithOpeningCommand
   *
   * @param snapResult - 墙中线吸附结果
   * @param placedMesh - 已放置的门窗 Mesh
   * @param wallData - 目标墙体数据
   * @param manager - 建筑对象管理器
   */
  public static cut(
    snapResult: WallSnapResult,
    placedMesh: THREE.Mesh,
    wallData: StraightWallData,
    manager: BuildingObjectManager
  ): void {
    /* 计算洞口参数 */
    const opening: WallOpening = WallOpeningCutter.computeOpening(snapResult, placedMesh, wallData);

    /* 追加到墙体的 openings 数组（不覆盖已有洞口） */
    const existingOpenings: WallOpening[] = wallData.openings !== undefined ? [...wallData.openings] : [];
    existingOpenings.push(opening);

    /* 通过 manager 更新墙体数据，触发几何重建 */
    manager.updateObject(wallData.id, { openings: existingOpenings } as Partial<StraightWallData>);

    console.log(
      `[WallOpeningCutter] 扣洞完成: 墙体=${wallData.id}, t=${snapResult.t.toFixed(3)}, ` +
      `宽=${opening.width.toFixed(3)}m, 高=${opening.height.toFixed(3)}m, 底标高=${opening.bottomElevation.toFixed(3)}m`
    );
  }
}
