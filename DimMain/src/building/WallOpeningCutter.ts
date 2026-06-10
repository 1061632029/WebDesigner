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
    /* 计算门窗 Mesh 的世界坐标包围盒（旋转对齐后） */
    const bbox: THREE.Box3 = new THREE.Box3().setFromObject(placedMesh);

    /* 将包围盒底面 4 个角点投影到墙方向，取最大跨度作为洞口宽度
     * 对于已对齐的门窗（+Z 朝向墙面法线），包围盒 X 方向即为沿墙方向
     * 但为通用性，使用向量投影计算
     */
    const corners: THREE.Vector3[] = [
      new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.min.z),
      new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.min.z),
      new THREE.Vector3(bbox.min.x, bbox.min.y, bbox.max.z),
      new THREE.Vector3(bbox.max.x, bbox.min.y, bbox.max.z),
    ];

    let minProj: number = Infinity;
    let maxProj: number = -Infinity;
    for (const corner of corners) {
      const proj: number = corner.dot(snapResult.wallDir);
      if (proj < minProj) minProj = proj;
      if (proj > maxProj) maxProj = proj;
    }
    const openingWidth: number = maxProj - minProj;

    /* 洞口高度 = 包围盒 Y 方向高度 */
    const openingHeight: number = bbox.max.y - bbox.min.y;

    /* 洞口底部标高（相对于墙体底部，最小为 0） */
    const bottomElevation: number = Math.max(0, bbox.min.y - wallData.elevation);

    return {
      centerT: snapResult.t,
      width: openingWidth,
      height: openingHeight,
      bottomElevation: bottomElevation,
    };
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
