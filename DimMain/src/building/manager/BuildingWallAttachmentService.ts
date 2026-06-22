/**
 * 墙体附着构件领域服务。
 * 负责门窗与直墙的吸附快照、拖拽恢复、洞口重算以及自适应厚度同步。
 */

import * as THREE from 'three/webgpu';
import type { BuildingObject, StraightWallData, WallData, WallOpening } from '../BuildingTypes';
import type { WallSnapResult } from '../WallSnapHelper';
import { WallOpeningCutter } from '../WallOpeningCutter';
import { StlAdaptiveThicknessHelper } from '../../model/StlAdaptiveThicknessHelper';
import type { SceneManager } from '../../scene/SceneManager';

/** 吸附在直墙上的门窗拖拽开始快照。 */
export interface StraightWallAttachedDoorWindowSnapshot {
  /** 门窗 Mesh 的 UUID，用于在场景中重新定位目标对象。 */
  meshUuid: string;
  /** 门窗拖拽开始时吸附墙体 ID。 */
  wallId: string;
  /** 门窗拖拽开始时沿墙中线的归一化参数。 */
  snapT: number;
  /** 门窗拖拽开始时的世界 Y 标高。 */
  heightY: number;
}

/** 墙体附着构件领域服务。 */
export class BuildingWallAttachmentService {
  /** 墙体拖拽几何计算容差。 */
  private static readonly WALL_DRAG_EPSILON: number = 0.000001;

  /** 所有建筑对象的纯数据集合。 */
  private readonly _objects: Map<string, BuildingObject>;

  /** 场景管理器，用于遍历门窗 STL Mesh。 */
  private readonly _sceneManager: SceneManager;

  /**
   * @param objects - 建筑对象数据集合。
   * @param sceneManager - 场景管理器。
   */
  public constructor(objects: Map<string, BuildingObject>, sceneManager: SceneManager) {
    this._objects = objects;
    this._sceneManager = sceneManager;
  }

  /**
   * 捕获指定墙体上附着门窗的拖拽定位快照。
   * @param wallIds - 需要采集门窗快照的墙体 ID 集合。
   * @returns 按墙体 ID 分组的门窗定位快照。
   */
  public captureAttachedDoorWindowSnapshotsForWalls(
    wallIds: Set<string>
  ): Map<string, StraightWallAttachedDoorWindowSnapshot[]> {
    const snapshotMap: Map<string, StraightWallAttachedDoorWindowSnapshot[]> =
      new Map<string, StraightWallAttachedDoorWindowSnapshot[]>();
    const scene: THREE.Scene = this._sceneManager.getScene();
    scene.traverse((child: THREE.Object3D): void => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }

      const mesh: THREE.Mesh = child;
      const attachedWallId: string | undefined = mesh.userData['wallId'] as string | undefined;
      if (attachedWallId === undefined || !wallIds.has(attachedWallId)) {
        return;
      }

      const category: string = (mesh.userData['category'] as string | undefined) ?? '';
      if (!StlAdaptiveThicknessHelper.isDoorWindowCategory(category)) {
        return;
      }

      const wallObject: BuildingObject | undefined = this._objects.get(attachedWallId);
      if (wallObject === undefined || wallObject.category !== 'wall' || (wallObject as WallData).subType !== 'straight') {
        return;
      }

      const wallData: StraightWallData = wallObject as StraightWallData;
      const snapT: number | null = this.resolveDoorWindowSnapT(mesh, wallData);
      if (snapT === null) {
        return;
      }

      let wallSnapshots: StraightWallAttachedDoorWindowSnapshot[] | undefined = snapshotMap.get(attachedWallId);
      if (wallSnapshots === undefined) {
        wallSnapshots = [];
        snapshotMap.set(attachedWallId, wallSnapshots);
      }
      wallSnapshots.push({
        meshUuid: mesh.uuid,
        wallId: attachedWallId,
        snapT: snapT,
        heightY: mesh.position.y,
      });
    });

    return snapshotMap;
  }

  /**
   * 解析门窗在指定直墙中心线上的归一化定位参数。
   * @param mesh - 需要解析的门窗 Mesh。
   * @param wallData - 门窗吸附的直墙数据。
   * @returns 归一化定位参数；墙体过短时返回 null。
   */
  public resolveDoorWindowSnapT(mesh: THREE.Mesh, wallData: StraightWallData): number | null {
    const storedSnapT: number | undefined = mesh.userData['snapT'] as number | undefined;
    if (storedSnapT !== undefined && Number.isFinite(storedSnapT)) {
      return Math.max(0, Math.min(1, storedSnapT));
    }

    const dirRawX: number = wallData.end.x - wallData.start.x;
    const dirRawZ: number = wallData.end.z - wallData.start.z;
    const wallLength: number = Math.sqrt(dirRawX * dirRawX + dirRawZ * dirRawZ);
    if (wallLength < BuildingWallAttachmentService.WALL_DRAG_EPSILON) {
      return null;
    }

    /* 兜底分支：历史门窗缺少 snapT 时，使用当前世界位置投影到墙中线得到定位参数。 */
    mesh.updateMatrixWorld(true);
    const meshWorldPosition: THREE.Vector3 = new THREE.Vector3();
    mesh.getWorldPosition(meshWorldPosition);
    const dirX: number = dirRawX / wallLength;
    const dirZ: number = dirRawZ / wallLength;
    const offsetX: number = meshWorldPosition.x - wallData.start.x;
    const offsetZ: number = meshWorldPosition.z - wallData.start.z;
    const rawT: number = (offsetX * dirX + offsetZ * dirZ) / wallLength;
    return Math.max(0, Math.min(1, rawT));
  }

  /**
   * 同步门窗 Mesh 的墙体方向元数据与朝向。
   * @param mesh - 需要同步朝向的门窗 Mesh。
   * @param wallDir - 当前墙体中心线方向。
   * @param wallNormal - 当前墙体法线方向。
   */
  public syncDoorWindowWallDirection(mesh: THREE.Mesh, wallDir: THREE.Vector3, wallNormal: THREE.Vector3): void {
    /* 方向同步流程：衔接点拖拽会改变墙体方向，门窗必须先旋转到新墙法线，再用最新世界矩阵计算洞口宽高。 */
    const wallNormalAngle: number = Math.atan2(wallNormal.x, wallNormal.z);
    mesh.rotation.set(0, wallNormalAngle, 0);
    mesh.userData['wallNormalX'] = wallNormal.x;
    mesh.userData['wallNormalZ'] = wallNormal.z;
    mesh.userData['wallDirX'] = wallDir.x;
    mesh.userData['wallDirZ'] = wallDir.z;
    mesh.updateMatrixWorld(true);
  }

  /**
   * 按拖拽开始快照重新定位指定直墙上的门窗。
   * @param wallData - 已同步最新端点的直墙数据。
   * @param snapshots - 拖拽开始时门窗定位快照列表。
   */
  public restoreAttachedDoorWindowsOnWall(
    wallData: StraightWallData,
    snapshots: StraightWallAttachedDoorWindowSnapshot[]
  ): void {
    const dirRawX: number = wallData.end.x - wallData.start.x;
    const dirRawZ: number = wallData.end.z - wallData.start.z;
    const wallLength: number = Math.sqrt(dirRawX * dirRawX + dirRawZ * dirRawZ);
    if (wallLength < BuildingWallAttachmentService.WALL_DRAG_EPSILON) {
      return;
    }

    const dirX: number = dirRawX / wallLength;
    const dirZ: number = dirRawZ / wallLength;
    const wallDir: THREE.Vector3 = new THREE.Vector3(dirX, 0, dirZ);
    const wallNormal: THREE.Vector3 = new THREE.Vector3(-dirZ, 0, dirX);
    const scene: THREE.Scene = this._sceneManager.getScene();

    for (const snapshot of snapshots) {
      const meshObject: THREE.Object3D | undefined = scene.getObjectByProperty('uuid', snapshot.meshUuid);
      if (!(meshObject instanceof THREE.Mesh)) {
        continue;
      }

      const mesh: THREE.Mesh = meshObject;
      const clampedT: number = Math.max(0, Math.min(1, snapshot.snapT));
      const nextX: number = wallData.start.x + dirX * clampedT * wallLength;
      const nextZ: number = wallData.start.z + dirZ * clampedT * wallLength;

      /* 绝对定位分支：每帧都由快照 snapT 和当前墙线计算门窗坐标，不依赖上一帧预览位置。 */
      mesh.position.set(nextX, snapshot.heightY, nextZ);
      mesh.userData['wallId'] = wallData.id;
      mesh.userData['snapT'] = clampedT;
      this.syncDoorWindowWallDirection(mesh, wallDir, wallNormal);
    }
  }

  /**
   * 根据当前吸附门窗的世界位置重算指定直墙洞口列表。
   * @param wallData - 已同步起终点但尚未重建 Mesh 的直墙数据。
   */
  public recomputeOpeningsFromAttachedDoorWindows(wallData: StraightWallData): void {
    const dirRawX: number = wallData.end.x - wallData.start.x;
    const dirRawZ: number = wallData.end.z - wallData.start.z;
    const wallLength: number = Math.sqrt(dirRawX * dirRawX + dirRawZ * dirRawZ);

    /* 墙体过短时无法建立稳定投影坐标系，保留原洞口数据避免异常清空。 */
    if (wallLength < 0.001) {
      return;
    }

    const dirX: number = dirRawX / wallLength;
    const dirZ: number = dirRawZ / wallLength;
    const wallDir: THREE.Vector3 = new THREE.Vector3(dirX, 0, dirZ);
    const wallNormal: THREE.Vector3 = new THREE.Vector3(-dirZ, 0, dirX);
    const recomputedOpenings: WallOpening[] = [];
    const scene: THREE.Scene = this._sceneManager.getScene();

    scene.traverse((child: THREE.Object3D): void => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }

      const mesh: THREE.Mesh = child;
      const attachedWallId: string | undefined = mesh.userData['wallId'] as string | undefined;
      if (attachedWallId !== wallData.id) {
        return;
      }

      const category: string = (mesh.userData['category'] as string | undefined) ?? '';
      if (!StlAdaptiveThicknessHelper.isDoorWindowCategory(category)) {
        return;
      }

      /* 门窗洞口重算流程：以门窗世界位置投影到新墙段，保持模型不移动，仅刷新洞口参数。 */
      mesh.updateMatrixWorld(true);
      const meshWorldPosition: THREE.Vector3 = new THREE.Vector3();
      mesh.getWorldPosition(meshWorldPosition);

      const offsetX: number = meshWorldPosition.x - wallData.start.x;
      const offsetZ: number = meshWorldPosition.z - wallData.start.z;
      const rawT: number = (offsetX * dirX + offsetZ * dirZ) / wallLength;
      const clampedT: number = Math.max(0, Math.min(1, rawT));
      const snapX: number = wallData.start.x + dirX * clampedT * wallLength;
      const snapZ: number = wallData.start.z + dirZ * clampedT * wallLength;
      const distanceX: number = meshWorldPosition.x - snapX;
      const distanceZ: number = meshWorldPosition.z - snapZ;
      const snapResult: WallSnapResult = {
        wallId: wallData.id,
        snapPoint: new THREE.Vector3(snapX, 0, snapZ),
        wallNormal: wallNormal.clone(),
        wallDir: wallDir.clone(),
        t: clampedT,
        distance: Math.sqrt(distanceX * distanceX + distanceZ * distanceZ),
      };

      mesh.userData['snapT'] = clampedT;
      this.syncDoorWindowWallDirection(mesh, wallDir, wallNormal);

      const opening: WallOpening = WallOpeningCutter.computeOpening(snapResult, mesh, wallData);
      recomputedOpenings.push(opening);
    });

    wallData.openings = recomputedOpenings;
  }

  /**
   * 同步吸附到指定直墙的门窗厚度。
   * @param wallData - 已更新的直墙数据。
   */
  public syncAdaptiveDoorWindowThickness(wallData: StraightWallData): void {
    const scene: THREE.Scene = this._sceneManager.getScene();
    scene.traverse((child: THREE.Object3D): void => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }

      const mesh: THREE.Mesh = child;
      const wallId: string | undefined = mesh.userData['wallId'] as string | undefined;
      if (wallId !== wallData.id) {
        return;
      }

      /* 仅处理启用自适应厚度的门窗，其他 STL 或显式关闭的构件保持用户手动厚度。 */
      if (!StlAdaptiveThicknessHelper.isEnabledForMesh(mesh)) {
        return;
      }

      StlAdaptiveThicknessHelper.applyWallThickness(mesh, wallData.thickness);
    });
  }
}