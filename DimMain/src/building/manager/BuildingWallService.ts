/**
 * 建筑墙体对象领域服务。
 * 负责墙体拖拽、墙体衔接点拖拽、墙厚右缩进、连接拓扑同步与相邻墙重建，避免 BuildingObjectManager 承载墙体专属逻辑。
 */

import type {
  ArcWallData,
  BuildingObject,
  Point2D,
  StraightWallData,
  WallConnection,
  WallData,
  WallEndpoint,
  WallJoint,
} from '../BuildingTypes';
import type { WallConnectionManager } from '../WallConnectionManager';
import { Geometry2DUtils } from './Geometry2DUtils';
import type { StraightWallAttachedDoorWindowSnapshot } from './BuildingWallAttachmentService';
import type { BuildingWallAttachmentService } from './BuildingWallAttachmentService';

/** 直墙起终点坐标快照。 */
interface StraightWallEndpointSnapshot {
  /** 直墙起点坐标。 */
  start: Point2D;
  /** 直墙终点坐标。 */
  end: Point2D;
}

/**
 * 墙体端点拖拽方向约束。
 * 用于描述连接墙体为了保持原布置方向，其可移动端点必须停留的无限直线。
 */
interface WallDragDirectionConstraint {
  /** 连接墙体 ID。 */
  wallId: string;
  /** 连接墙体保持不动的另一端坐标。 */
  fixedPoint: Point2D;
  /** 连接墙体原始布置方向。 */
  direction: Point2D;
}

/** 墙体服务渲染与通知回调集合。 */
export interface BuildingWallServiceCallbacks {
  /** 从场景移除指定对象 Mesh。 */
  removeMeshFromScene: (objectId: string) => void;
  /** 按当前墙体数据创建 Mesh。 */
  createWallMesh: (wallData: WallData) => void;
  /** 通知外部对象变更。 */
  notify: (objectId: string, action: 'add' | 'remove' | 'update') => void;
  /** 刷新/清理墙体衔接显示。 */
  refreshConnectionLines: () => void;
}

/**
 * 直墙拖拽开始快照。
 * 用于实时拖拽时始终从拖拽开始位置 P 加当前总偏移 L 计算墙体位置，避免基于当前预览状态重复累加。
 */
export interface StraightWallDragSnapshot {
  /** 被拖拽直墙 ID。 */
  wallId: string;
  /** 被拖拽直墙拖拽开始时的起点。 */
  wallStart: Point2D;
  /** 被拖拽直墙拖拽开始时的终点。 */
  wallEnd: Point2D;
  /** 被拖拽直墙拖拽开始时的方向单位向量。 */
  wallDirection: Point2D;
  /** 被拖拽直墙起终点对应的连接节点。 */
  jointMapping: { start: string | null; end: string | null };
  /** 拖拽开始时受影响直墙的起终点坐标。 */
  wallPositions: Map<string, StraightWallEndpointSnapshot>;
  /** 拖拽开始时受影响连接节点的坐标。 */
  jointPositions: Map<string, Point2D>;
  /** 拖拽开始时吸附在受影响直墙上的门窗位置快照。 */
  attachedDoorWindowPositions: Map<string, StraightWallAttachedDoorWindowSnapshot[]>;
}

/** 弧形墙自身拖拽开始快照。 */
export interface ArcWallDragSnapshot {
  /** 被拖拽弧形墙 ID。 */
  wallId: string;
  /** 弧形墙拖拽开始时的起点。 */
  start: Point2D;
  /** 弧形墙拖拽开始时的终点。 */
  end: Point2D;
  /** 弧形墙拖拽开始时的弧度因子。 */
  bulge: number;
  /** 弧形墙拖拽开始时的分段数。 */
  segments: number;
  /** 弧形墙拖拽开始时圆心到弦中心点的单位方向。 */
  dragDirection: Point2D;
  /** 拖拽开始时弧墙端点对应的连接节点，用于撤销/重做时保持快照语义清晰。 */
  jointMapping: { start: string | null; end: string | null };
  /** 拖拽开始时与弧墙共享端点节点的其他墙体 ID。 */
  connectedWallIds: string[];
}

/**
 * 墙体衔接点拖拽开始快照。
 * 用于实时拖拽时始终从拖拽开始位置 P 加当前总偏移 L 计算衔接点和关联墙体位置。
 */
export interface WallJointDragSnapshot {
  /** 被拖拽的衔接点 ID。 */
  jointId: string;
  /** 衔接点拖拽开始时的坐标。 */
  jointStart: Point2D;
  /** 拖拽开始时受影响直墙的起终点坐标。 */
  wallPositions: Map<string, StraightWallEndpointSnapshot>;
  /** 拖拽开始时受影响连接节点的坐标。 */
  jointPositions: Map<string, Point2D>;
  /** 拖拽开始时吸附在受影响直墙上的门窗位置快照。 */
  attachedDoorWindowPositions: Map<string, StraightWallAttachedDoorWindowSnapshot[]>;
}

/** 建筑墙体对象领域服务。 */
export class BuildingWallService {
  /** 墙体拖拽几何计算容差。 */
  private static readonly WALL_DRAG_EPSILON: number = 0.000001;

  /** 所有建筑对象的纯数据集合。 */
  private readonly _objects: Map<string, BuildingObject>;

  /** 墙体连接管理器。 */
  private readonly _connectionManager: WallConnectionManager;

  /** 墙体附着构件服务。 */
  private readonly _wallAttachmentService: BuildingWallAttachmentService;

  /** 渲染与通知回调集合。 */
  private readonly _callbacks: BuildingWallServiceCallbacks;

  /**
   * @param objects - 建筑对象数据集合。
   * @param connectionManager - 墙体连接拓扑管理器。
   * @param wallAttachmentService - 墙体附着构件服务。
   * @param callbacks - 渲染、通知和衔接显示回调。
   */
  public constructor(
    objects: Map<string, BuildingObject>,
    connectionManager: WallConnectionManager,
    wallAttachmentService: BuildingWallAttachmentService,
    callbacks: BuildingWallServiceCallbacks
  ) {
    this._objects = objects;
    this._connectionManager = connectionManager;
    this._wallAttachmentService = wallAttachmentService;
    this._callbacks = callbacks;
  }

  /**
   * 创建直墙拖拽开始快照。
   * @param wallId - 被拖拽的直墙 ID。
   * @returns 拖拽快照；墙体不存在或不是有效直墙时返回 null。
   */
  public createStraightWallDragSnapshot(wallId: string): StraightWallDragSnapshot | null {
    const wallObject: BuildingObject | undefined = this._objects.get(wallId);
    if (wallObject === undefined || wallObject.category !== 'wall' || (wallObject as WallData).subType !== 'straight') {
      return null;
    }

    const wallData: StraightWallData = wallObject as StraightWallData;
    const wallDirection: Point2D | null = this._normalizePoint2D({
      x: wallData.end.x - wallData.start.x,
      z: wallData.end.z - wallData.start.z,
    });
    if (wallDirection === null) {
      return null;
    }

    const jointMapping: { start: string | null; end: string | null } = this._connectionManager.getWallJoints(wallId);
    const affectedWallIds: Set<string> = new Set<string>();
    const jointPositions: Map<string, Point2D> = new Map<string, Point2D>();
    affectedWallIds.add(wallId);

    /* 快照采集流程：从拖拽墙两个端点的节点出发，记录直接连接墙体和这些墙体节点的拖拽开始坐标。 */
    const draggedJointIds: Array<string | null> = [jointMapping.start, jointMapping.end];
    for (const jointId of draggedJointIds) {
      if (jointId === null) {
        continue;
      }
      const joint: WallJoint | undefined = this._connectionManager.getJoint(jointId);
      if (joint !== undefined) {
        jointPositions.set(jointId, { x: joint.position.x, z: joint.position.z });
      }
      const connections: WallConnection[] = this._connectionManager.getJointConnections(jointId);
      for (const connection of connections) {
        affectedWallIds.add(connection.wallId);
      }
    }

    const wallPositions: Map<string, StraightWallEndpointSnapshot> = new Map<string, StraightWallEndpointSnapshot>();
    for (const affectedWallId of affectedWallIds) {
      const affectedObject: BuildingObject | undefined = this._objects.get(affectedWallId);
      if (affectedObject === undefined || affectedObject.category !== 'wall' || (affectedObject as WallData).subType !== 'straight') {
        continue;
      }

      const affectedWall: StraightWallData = affectedObject as StraightWallData;
      wallPositions.set(affectedWallId, {
        start: { x: affectedWall.start.x, z: affectedWall.start.z },
        end: { x: affectedWall.end.x, z: affectedWall.end.z },
      });

      const affectedMapping: { start: string | null; end: string | null } = this._connectionManager.getWallJoints(affectedWallId);
      const affectedJointIds: Array<string | null> = [affectedMapping.start, affectedMapping.end];
      for (const affectedJointId of affectedJointIds) {
        if (affectedJointId === null || jointPositions.has(affectedJointId)) {
          continue;
        }
        const affectedJoint: WallJoint | undefined = this._connectionManager.getJoint(affectedJointId);
        if (affectedJoint !== undefined) {
          jointPositions.set(affectedJointId, { x: affectedJoint.position.x, z: affectedJoint.position.z });
        }
      }
    }

    const attachedDoorWindowPositions: Map<string, StraightWallAttachedDoorWindowSnapshot[]> =
      this._wallAttachmentService.captureAttachedDoorWindowSnapshotsForWalls(affectedWallIds);

    return {
      wallId: wallId,
      wallStart: { x: wallData.start.x, z: wallData.start.z },
      wallEnd: { x: wallData.end.x, z: wallData.end.z },
      wallDirection: wallDirection,
      jointMapping: { start: jointMapping.start, end: jointMapping.end },
      wallPositions: wallPositions,
      jointPositions: jointPositions,
      attachedDoorWindowPositions: attachedDoorWindowPositions,
    };
  }

  /**
   * 从拖拽开始快照按 P + L 方式移动直墙并同步连接墙体。
   * @param snapshot - 拖拽开始快照。
   * @param totalOffset - 当前鼠标相对拖拽开始位置的总法向偏移 L。
   * @returns 实际被更新的墙体 ID 列表。
   */
  public moveStraightWallWithConnectionsFromSnapshot(snapshot: StraightWallDragSnapshot, totalOffset: Point2D): string[] {
    if (snapshot.wallId.length === 0) {
      return [];
    }

    this._restoreStraightWallDragSnapshotState(snapshot);
    const wallObject: BuildingObject | undefined = this._objects.get(snapshot.wallId);
    if (wallObject === undefined || wallObject.category !== 'wall' || (wallObject as WallData).subType !== 'straight') {
      return [];
    }

    const affectedWallIds: Set<string> = new Set<string>();
    affectedWallIds.add(snapshot.wallId);

    /* 关键计算流程：端点、目标中心线和连接墙方向全部使用拖拽开始快照 P，再叠加当前总偏移 L。 */
    const startPoint: Point2D | null = this._resolveDraggedWallEndpointPosition(
      snapshot.wallId,
      'start',
      snapshot.wallStart,
      totalOffset,
      snapshot.wallStart,
      snapshot.wallDirection,
      snapshot.jointMapping.start,
      affectedWallIds
    );
    const endPoint: Point2D | null = this._resolveDraggedWallEndpointPosition(
      snapshot.wallId,
      'end',
      snapshot.wallEnd,
      totalOffset,
      snapshot.wallStart,
      snapshot.wallDirection,
      snapshot.jointMapping.end,
      affectedWallIds
    );

    if (startPoint === null || endPoint === null) {
      console.warn(`[BuildingWallService] 墙体拖拽存在无法保持连接墙体方向的约束，已取消本次移动: wallId=${snapshot.wallId}`);
      return [];
    }

    const wallData: StraightWallData = wallObject as StraightWallData;
    if (snapshot.jointMapping.start !== null) {
      this._connectionManager.updateJointPosition(snapshot.jointMapping.start, startPoint);
    } else {
      wallData.start = startPoint;
    }

    if (snapshot.jointMapping.end !== null && snapshot.jointMapping.end !== snapshot.jointMapping.start) {
      this._connectionManager.updateJointPosition(snapshot.jointMapping.end, endPoint);
    } else if (snapshot.jointMapping.end === null) {
      wallData.end = endPoint;
    }

    this._syncWallEndpointsFromJoints(affectedWallIds, snapshot.wallId, snapshot.attachedDoorWindowPositions);
    return Array.from(affectedWallIds);
  }

  /**
   * 移动指定直墙并按连接墙体原方向重算共享节点。
   * @param wallId - 被拖拽的直墙 ID。
   * @param offset - 法向平移偏移量（世界 XZ 平面）。
   * @returns 实际被更新的墙体 ID 列表。
   */
  public moveStraightWallWithConnections(wallId: string, offset: Point2D): string[] {
    const snapshot: StraightWallDragSnapshot | null = this.createStraightWallDragSnapshot(wallId);
    if (snapshot === null) {
      return [];
    }
    return this.moveStraightWallWithConnectionsFromSnapshot(snapshot, offset);
  }

  /**
   * 创建弧形墙拖拽开始快照。
   * @param wallId - 被拖拽的弧形墙 ID。
   * @returns 弧形墙拖拽快照；墙体不存在或弧线退化时返回 null。
   */
  public createArcWallDragSnapshot(wallId: string): ArcWallDragSnapshot | null {
    const wallObject: BuildingObject | undefined = this._objects.get(wallId);
    if (wallObject === undefined || wallObject.category !== 'wall' || (wallObject as WallData).subType !== 'arc') {
      return null;
    }

    const wallData: ArcWallData = wallObject as ArcWallData;
    const dragDirection: Point2D | null = this._computeArcWallCenterToChordMidDirection(wallData);
    if (dragDirection === null) {
      return null;
    }

    const jointMapping: { start: string | null; end: string | null } = this._connectionManager.getWallJoints(wallId);
    const connectedWallIds: Set<string> = new Set<string>();
    const jointIds: Array<string | null> = [jointMapping.start, jointMapping.end];
    for (const jointId of jointIds) {
      if (jointId === null) {
        continue;
      }

      /* 快照采集流程：拖拽前缓存弧墙两端直接衔接的其他墙体，断开拓扑后仍可重建这些墙体端面。 */
      const connections: WallConnection[] = this._connectionManager.getJointConnections(jointId);
      for (const connection of connections) {
        if (connection.wallId === wallId) {
          continue;
        }
        const connectedObject: BuildingObject | undefined = this._objects.get(connection.wallId);
        if (connectedObject === undefined || connectedObject.category !== 'wall') {
          continue;
        }
        const connectedWall: WallData = connectedObject as WallData;
        if (connectedWall.subType === 'rect') {
          continue;
        }
        connectedWallIds.add(connection.wallId);
      }
    }

    return {
      wallId: wallId,
      start: { x: wallData.start.x, z: wallData.start.z },
      end: { x: wallData.end.x, z: wallData.end.z },
      bulge: wallData.bulge,
      segments: wallData.segments,
      dragDirection: dragDirection,
      jointMapping: { start: jointMapping.start, end: jointMapping.end },
      connectedWallIds: Array.from(connectedWallIds.values()),
    };
  }

  /**
   * 从拖拽开始快照按 P + L 方式移动弧形墙。
   * @param snapshot - 弧形墙拖拽开始快照。
   * @param totalOffset - 当前鼠标投影到弧墙径向拖拽线后的总偏移。
   * @returns 成功移动时返回被更新墙体 ID 列表。
   */
  public moveArcWallFromSnapshot(snapshot: ArcWallDragSnapshot, totalOffset: Point2D): string[] {
    const wallObject: BuildingObject | undefined = this._objects.get(snapshot.wallId);
    if (wallObject === undefined || wallObject.category !== 'wall' || (wallObject as WallData).subType !== 'arc') {
      return [];
    }

    const wallData: ArcWallData = wallObject as ArcWallData;
    const affectedWallIds: Set<string> = new Set<string>();
    affectedWallIds.add(snapshot.wallId);
    for (const connectedWallId of snapshot.connectedWallIds) {
      affectedWallIds.add(connectedWallId);
    }

    /* 弧墙拖拽流程：先断开原端点衔接，避免旧节点被移动导致相邻墙体继续被拉扯。 */
    this._connectionManager.disconnectWall(snapshot.wallId);
    wallData.start = { x: snapshot.start.x + totalOffset.x, z: snapshot.start.z + totalOffset.z };
    wallData.end = { x: snapshot.end.x + totalOffset.x, z: snapshot.end.z + totalOffset.z };
    wallData.bulge = snapshot.bulge;
    wallData.segments = snapshot.segments;

    /* 重新注册流程：按移动后的端点重新吸附/合并节点，后续拖拽结束时基于新拓扑重新做封闭检测。 */
    const registeredJoints: { startJointId: string; endJointId: string } =
      this._connectionManager.registerWall(wallData.id, wallData.start, wallData.end);
    this.syncWallEndpointsFromJointIds(wallData, registeredJoints.startJointId, registeredJoints.endJointId);

    const nextJointMapping: { start: string | null; end: string | null } = this._connectionManager.getWallJoints(snapshot.wallId);
    const nextJointIds: Array<string | null> = [nextJointMapping.start, nextJointMapping.end];
    for (const jointId of nextJointIds) {
      if (jointId === null) {
        continue;
      }
      const connections: WallConnection[] = this._connectionManager.getJointConnections(jointId);
      for (const connection of connections) {
        const connectedObject: BuildingObject | undefined = this._objects.get(connection.wallId);
        if (connectedObject === undefined || connectedObject.category !== 'wall') {
          continue;
        }
        const connectedWall: WallData = connectedObject as WallData;
        if (connectedWall.subType === 'rect') {
          continue;
        }
        affectedWallIds.add(connection.wallId);
      }
    }

    this.rebuildWallMeshesForCurrentTopology(affectedWallIds);
    this._callbacks.refreshConnectionLines();
    return Array.from(affectedWallIds.values());
  }

  /**
   * 移动指定弧形墙。
   * @param wallId - 被移动弧形墙 ID。
   * @param offset - XZ 平面偏移。
   * @returns 成功移动时返回被更新墙体 ID 列表。
   */
  public moveArcWall(wallId: string, offset: Point2D): string[] {
    const snapshot: ArcWallDragSnapshot | null = this.createArcWallDragSnapshot(wallId);
    if (snapshot === null) {
      return [];
    }
    return this.moveArcWallFromSnapshot(snapshot, offset);
  }

  /**
   * 创建墙体衔接点拖拽开始快照。
   * @param jointId - 被拖拽的墙体衔接点 ID。
   * @returns 拖拽快照；衔接点不存在或未连接任何有效直墙时返回 null。
   */
  public createWallJointDragSnapshot(jointId: string): WallJointDragSnapshot | null {
    const joint: WallJoint | undefined = this._connectionManager.getJoint(jointId);
    if (joint === undefined) {
      return null;
    }

    const connections: WallConnection[] = this._connectionManager.getJointConnections(jointId);
    const affectedWallIds: Set<string> = new Set<string>();
    const jointPositions: Map<string, Point2D> = new Map<string, Point2D>();
    jointPositions.set(jointId, { x: joint.position.x, z: joint.position.z });

    /* 快照采集流程：从被拖拽节点出发，记录直连墙体与这些墙体两端节点的原始坐标。 */
    for (const connection of connections) {
      const wallObject: BuildingObject | undefined = this._objects.get(connection.wallId);
      if (wallObject === undefined || wallObject.category !== 'wall' || (wallObject as WallData).subType !== 'straight') {
        continue;
      }

      affectedWallIds.add(connection.wallId);
      const mapping: { start: string | null; end: string | null } = this._connectionManager.getWallJoints(connection.wallId);
      const relatedJointIds: Array<string | null> = [mapping.start, mapping.end];
      for (const relatedJointId of relatedJointIds) {
        if (relatedJointId === null || jointPositions.has(relatedJointId)) {
          continue;
        }
        const relatedJoint: WallJoint | undefined = this._connectionManager.getJoint(relatedJointId);
        if (relatedJoint !== undefined) {
          jointPositions.set(relatedJointId, { x: relatedJoint.position.x, z: relatedJoint.position.z });
        }
      }
    }

    if (affectedWallIds.size === 0) {
      return null;
    }

    const wallPositions: Map<string, StraightWallEndpointSnapshot> = new Map<string, StraightWallEndpointSnapshot>();
    for (const affectedWallId of affectedWallIds) {
      const affectedObject: BuildingObject | undefined = this._objects.get(affectedWallId);
      if (affectedObject === undefined || affectedObject.category !== 'wall' || (affectedObject as WallData).subType !== 'straight') {
        continue;
      }

      const affectedWall: StraightWallData = affectedObject as StraightWallData;
      wallPositions.set(affectedWallId, {
        start: { x: affectedWall.start.x, z: affectedWall.start.z },
        end: { x: affectedWall.end.x, z: affectedWall.end.z },
      });
    }

    const attachedDoorWindowPositions: Map<string, StraightWallAttachedDoorWindowSnapshot[]> =
      this._wallAttachmentService.captureAttachedDoorWindowSnapshotsForWalls(affectedWallIds);

    return {
      jointId: jointId,
      jointStart: { x: joint.position.x, z: joint.position.z },
      wallPositions: wallPositions,
      jointPositions: jointPositions,
      attachedDoorWindowPositions: attachedDoorWindowPositions,
    };
  }

  /**
   * 从拖拽开始快照按 P + L 方式移动墙体衔接点并同步直连墙体。
   * @param snapshot - 拖拽开始快照。
   * @param totalOffset - 当前鼠标相对拖拽开始位置的总偏移 L。
   * @returns 实际被更新的墙体 ID 列表。
   */
  public moveWallJointFromSnapshot(snapshot: WallJointDragSnapshot, totalOffset: Point2D): string[] {
    if (snapshot.jointId.length === 0) {
      return [];
    }

    this._restoreWallJointDragSnapshotState(snapshot);
    const joint: WallJoint | undefined = this._connectionManager.getJoint(snapshot.jointId);
    if (joint === undefined) {
      return [];
    }

    const affectedWallIds: Set<string> = new Set<string>();
    snapshot.wallPositions.forEach((_positionSnapshot: StraightWallEndpointSnapshot, wallId: string): void => {
      affectedWallIds.add(wallId);
    });

    if (affectedWallIds.size === 0) {
      return [];
    }

    /* 衔接点移动流程：只更新被拖拽节点坐标，随后统一把所有直连墙体端点同步到节点坐标。 */
    this._connectionManager.updateJointPosition(snapshot.jointId, {
      x: snapshot.jointStart.x + totalOffset.x,
      z: snapshot.jointStart.z + totalOffset.z,
    });
    this._syncWallEndpointsFromJoints(affectedWallIds, null, snapshot.attachedDoorWindowPositions);
    return Array.from(affectedWallIds);
  }

  /**
   * 移动指定墙体衔接点并同步直连墙体。
   * @param jointId - 被移动的墙体衔接点 ID。
   * @param offset - 平移偏移量（世界 XZ 平面）。
   * @returns 实际被更新的墙体 ID 列表。
   */
  public moveWallJoint(jointId: string, offset: Point2D): string[] {
    const snapshot: WallJointDragSnapshot | null = this.createWallJointDragSnapshot(jointId);
    if (snapshot === null) {
      return [];
    }
    return this.moveWallJointFromSnapshot(snapshot, offset);
  }

  /**
   * 修改直墙厚度，并按墙体布置方向右侧缩进中心线。
   * @param wallId - 需要修改厚度的直墙 ID。
   * @param nextThickness - 修改后的墙厚（米）。
   * @returns 实际被重建或联动更新的墙体 ID 列表。
   */
  public updateStraightWallThicknessWithRightIndent(wallId: string, nextThickness: number): string[] {
    const wallObject: BuildingObject | undefined = this._objects.get(wallId);
    if (wallObject === undefined || wallObject.category !== 'wall' || (wallObject as WallData).subType !== 'straight') {
      return [];
    }

    const wallData: StraightWallData = wallObject as StraightWallData;
    const previousThickness: number = wallData.thickness;
    const wallDirection: Point2D | null = this._normalizePoint2D({
      x: wallData.end.x - wallData.start.x,
      z: wallData.end.z - wallData.start.z,
    });
    if (wallDirection === null || !Number.isFinite(nextThickness) || !Number.isFinite(previousThickness)) {
      return [];
    }

    /* 厚度更新流程：先写入目标厚度，再按右法向移动中心线，使布置方向左侧墙面保持不动、右侧产生缩进/外扩。 */
    wallData.thickness = nextThickness;
    const halfDelta: number = (nextThickness - previousThickness) / 2;
    const rightOffset: Point2D = { x: wallDirection.z * halfDelta, z: -wallDirection.x * halfDelta };
    const affectedWallIds: string[] = this.moveStraightWallWithConnections(wallId, rightOffset);
    if (affectedWallIds.length === 0) {
      /* 异常分支：若连接约束无法求解，仍需重建自身以反映墙厚属性变化。 */
      this._wallAttachmentService.recomputeOpeningsFromAttachedDoorWindows(wallData);
      this._callbacks.removeMeshFromScene(wallId);
      this._callbacks.createWallMesh(wallData);
      this._wallAttachmentService.syncAdaptiveDoorWindowThickness(wallData);
      this._callbacks.refreshConnectionLines();
      this._callbacks.notify(wallId, 'update');
      return [wallId];
    }

    return affectedWallIds;
  }

  /**
   * 根据指定连接节点坐标同步单面墙的起终点。
   * @param wallData - 需要同步端点的墙体数据。
   * @param startJointId - 起点连接节点 ID。
   * @param endJointId - 终点连接节点 ID。
   * @returns 起点或终点发生变化时返回 true。
   */
  public syncWallEndpointsFromJointIds(wallData: WallData, startJointId: string, endJointId: string): boolean {
    if (wallData.subType !== 'straight' && wallData.subType !== 'arc') {
      return false;
    }

    const startJoint: WallJoint | undefined = this._connectionManager.getJoint(startJointId);
    const endJoint: WallJoint | undefined = this._connectionManager.getJoint(endJointId);
    let changed: boolean = false;

    if (startJoint !== undefined) {
      changed = changed || wallData.start.x !== startJoint.position.x || wallData.start.z !== startJoint.position.z;
      wallData.start = { x: startJoint.position.x, z: startJoint.position.z };
    }

    if (endJoint !== undefined) {
      changed = changed || wallData.end.x !== endJoint.position.x || wallData.end.z !== endJoint.position.z;
      wallData.end = { x: endJoint.position.x, z: endJoint.position.z };
    }

    return changed;
  }

  /**
   * 收集被删除墙体在断开拓扑前的外部相邻直墙。
   * @param wallId - 即将删除或断开的墙体 ID。
   * @param targetWallIds - 用于累积相邻墙 ID 的集合。
   */
  public collectAdjacentWallIdsForRemovedWall(wallId: string, targetWallIds: Set<string>): void {
    const joints: { start: string | null; end: string | null } = this._connectionManager.getWallJoints(wallId);
    const jointIds: Array<string | null> = [joints.start, joints.end];

    for (const jointId of jointIds) {
      if (jointId === null) {
        continue;
      }

      const connections: WallConnection[] = this._connectionManager.getJointConnections(jointId);
      for (const connection of connections) {
        if (connection.wallId === wallId) {
          continue;
        }

        const adjacentObject: BuildingObject | undefined = this._objects.get(connection.wallId);
        if (adjacentObject === undefined || adjacentObject.category !== 'wall' || (adjacentObject as WallData).subType !== 'straight') {
          continue;
        }

        targetWallIds.add(connection.wallId);
      }
    }
  }

  /**
   * 按指定墙体集合重建直墙 Mesh，并同步洞口、自适应门窗厚度和变更通知。
   * @param wallIds - 需要按当前连接拓扑重建截面的墙体 ID 集合。
   */
  public rebuildWallSet(wallIds: Set<string>): void {
    wallIds.forEach((wallId: string): void => {
      const objectData: BuildingObject | undefined = this._objects.get(wallId);
      if (objectData === undefined || objectData.category !== 'wall' || (objectData as WallData).subType !== 'straight') {
        return;
      }

      /* 重建流程：连接拓扑已经移除被删除墙体，此时重新计算 miter 可还原相邻墙体删除端截面。 */
      const wallData: StraightWallData = objectData as StraightWallData;
      this._wallAttachmentService.recomputeOpeningsFromAttachedDoorWindows(wallData);
      this._callbacks.removeMeshFromScene(wallId);
      this._callbacks.createWallMesh(wallData);
      this._wallAttachmentService.syncAdaptiveDoorWindowThickness(wallData);
      this._callbacks.notify(wallId, 'update');
    });
  }

  /**
   * 按当前连接拓扑重建指定直墙/弧墙 Mesh。
   * @param wallIds - 需要重建的墙体 ID 集合。
   */
  public rebuildWallMeshesForCurrentTopology(wallIds: Set<string>): void {
    wallIds.forEach((wallId: string): void => {
      const objectData: BuildingObject | undefined = this._objects.get(wallId);
      if (objectData === undefined || objectData.category !== 'wall') {
        return;
      }

      const wallData: WallData = objectData as WallData;
      if (wallData.subType === 'rect') {
        return;
      }

      /* 直墙重建前同步门窗洞口；弧墙当前不承载门窗洞口，仅按最新拓扑重建端部裁剪。 */
      if (wallData.subType === 'straight') {
        const straightWallData: StraightWallData = wallData as StraightWallData;
        this._wallAttachmentService.recomputeOpeningsFromAttachedDoorWindows(straightWallData);
        this._wallAttachmentService.syncAdaptiveDoorWindowThickness(straightWallData);
      }

      this._callbacks.removeMeshFromScene(wallId);
      this._callbacks.createWallMesh(wallData);
      this._callbacks.notify(wallId, 'update');
    });
  }

  /**
   * 重建与指定墙体共享节点的相邻墙体几何。
   * @param wallId - 触发重建的墙体 ID（自身不重建）。
   */
  public rebuildAdjacentWalls(wallId: string): void {
    const joints: { start: string | null; end: string | null } = this._connectionManager.getWallJoints(wallId);
    const rebuiltSet: Set<string> = new Set<string>();
    const jointIds: Array<string | null> = [joints.start, joints.end];

    for (const jointId of jointIds) {
      if (jointId === null) {
        continue;
      }
      const connections: WallConnection[] = this._connectionManager.getJointConnections(jointId);

      for (const connection of connections) {
        if (connection.wallId === wallId || rebuiltSet.has(connection.wallId)) {
          continue;
        }
        rebuiltSet.add(connection.wallId);

        const adjacentObject: BuildingObject | undefined = this._objects.get(connection.wallId);
        if (adjacentObject === undefined || adjacentObject.category !== 'wall') {
          continue;
        }

        const adjacentWall: WallData = adjacentObject as WallData;
        if (adjacentWall.subType === 'rect') {
          continue;
        }

        /* 相邻墙重建流程：连接拓扑已变化，移除旧 Mesh 后按最新节点关系重建端部裁剪。 */
        this._callbacks.removeMeshFromScene(connection.wallId);
        this._callbacks.createWallMesh(adjacentWall);
      }
    }
  }

  /**
   * 恢复直墙拖拽快照中的墙体端点和连接节点坐标。
   * @param snapshot - 拖拽开始快照。
   */
  private _restoreStraightWallDragSnapshotState(snapshot: StraightWallDragSnapshot): void {
    snapshot.wallPositions.forEach((positionSnapshot: StraightWallEndpointSnapshot, wallId: string): void => {
      const wallObject: BuildingObject | undefined = this._objects.get(wallId);
      if (wallObject === undefined || wallObject.category !== 'wall' || (wallObject as WallData).subType !== 'straight') {
        return;
      }
      const wallData: StraightWallData = wallObject as StraightWallData;
      wallData.start = { x: positionSnapshot.start.x, z: positionSnapshot.start.z };
      wallData.end = { x: positionSnapshot.end.x, z: positionSnapshot.end.z };
    });

    snapshot.jointPositions.forEach((position: Point2D, jointId: string): void => {
      this._connectionManager.updateJointPosition(jointId, { x: position.x, z: position.z });
    });
  }

  /**
   * 恢复墙体衔接点拖拽快照中的墙体端点和连接节点坐标。
   * @param snapshot - 拖拽开始快照。
   */
  private _restoreWallJointDragSnapshotState(snapshot: WallJointDragSnapshot): void {
    snapshot.wallPositions.forEach((positionSnapshot: StraightWallEndpointSnapshot, wallId: string): void => {
      const wallObject: BuildingObject | undefined = this._objects.get(wallId);
      if (wallObject === undefined || wallObject.category !== 'wall' || (wallObject as WallData).subType !== 'straight') {
        return;
      }
      const wallData: StraightWallData = wallObject as StraightWallData;
      wallData.start = { x: positionSnapshot.start.x, z: positionSnapshot.start.z };
      wallData.end = { x: positionSnapshot.end.x, z: positionSnapshot.end.z };
    });

    snapshot.jointPositions.forEach((position: Point2D, jointId: string): void => {
      this._connectionManager.updateJointPosition(jointId, { x: position.x, z: position.z });
    });
  }

  /**
   * 解析拖拽墙端点的新位置。
   * @param draggedWallId - 被拖拽墙体 ID。
   * @param draggedEndpoint - 被拖拽墙体端点类型。
   * @param originalEndpointPoint - 端点当前坐标。
   * @param offset - 拖拽墙法向偏移。
   * @param draggedLinePoint - 拖拽墙当前起点，用于构造目标中心线。
   * @param draggedLineDirection - 拖拽墙当前方向单位向量。
   * @param jointId - 端点连接节点 ID。
   * @param affectedWallIds - 受影响墙体 ID 集合。
   * @returns 端点新坐标；约束无解时返回 null 表示取消本次拖拽。
   */
  private _resolveDraggedWallEndpointPosition(
    draggedWallId: string,
    draggedEndpoint: WallEndpoint,
    originalEndpointPoint: Point2D,
    offset: Point2D,
    draggedLinePoint: Point2D,
    draggedLineDirection: Point2D,
    jointId: string | null,
    affectedWallIds: Set<string>
  ): Point2D | null {
    const fallbackPoint: Point2D = { x: originalEndpointPoint.x + offset.x, z: originalEndpointPoint.z + offset.z };
    if (jointId === null) {
      return fallbackPoint;
    }

    const connections: WallConnection[] = this._connectionManager.getJointConnections(jointId);
    for (const connection of connections) {
      affectedWallIds.add(connection.wallId);
    }

    const constraints: WallDragDirectionConstraint[] = this._collectWallDragDirectionConstraints(draggedWallId, jointId, originalEndpointPoint);
    if (constraints.length === 0) {
      return fallbackPoint;
    }

    const primaryConstraint: WallDragDirectionConstraint = constraints[0]!;
    const targetLinePoint: Point2D = { x: draggedLinePoint.x + offset.x, z: draggedLinePoint.z + offset.z };
    const intersection: Point2D | null = this._intersectInfiniteLines(
      targetLinePoint,
      draggedLineDirection,
      primaryConstraint.fixedPoint,
      primaryConstraint.direction
    );
    if (intersection === null) {
      /* 平行约束无唯一交点时无法同时保持连接墙方向和拖拽墙目标线，取消本次拖拽。 */
      return null;
    }

    /* 多个连接墙体共节点时，只有所有方向约束共线才允许移动该节点，避免破坏任一连接墙体方向。 */
    for (let constraintIndex: number = 1; constraintIndex < constraints.length; constraintIndex++) {
      const constraint: WallDragDirectionConstraint = constraints[constraintIndex]!;
      if (!this._isPointOnLine(intersection, constraint.fixedPoint, constraint.direction)) {
        console.warn(
          `[BuildingWallService] 墙体拖拽端点存在多条非共线约束，已取消本次移动: wallId=${draggedWallId}, endpoint=${draggedEndpoint}`
        );
        return null;
      }
    }

    return intersection;
  }

  /**
   * 收集指定拖拽端点处连接墙体的方向约束。
   * @param draggedWallId - 被拖拽墙体 ID。
   * @param jointId - 拖拽端点连接节点 ID。
   * @param jointPosition - 当前共享节点坐标。
   * @returns 方向约束列表。
   */
  private _collectWallDragDirectionConstraints(
    draggedWallId: string,
    jointId: string,
    jointPosition: Point2D
  ): WallDragDirectionConstraint[] {
    const constraints: WallDragDirectionConstraint[] = [];
    const connections: WallConnection[] = this._connectionManager.getJointConnections(jointId);

    for (const connection of connections) {
      if (connection.wallId === draggedWallId) {
        continue;
      }

      const connectedObject: BuildingObject | undefined = this._objects.get(connection.wallId);
      if (connectedObject === undefined || connectedObject.category !== 'wall' || (connectedObject as WallData).subType !== 'straight') {
        continue;
      }

      const connectedWall: StraightWallData = connectedObject as StraightWallData;
      const fixedPoint: Point2D = connection.endpoint === 'start'
        ? { x: connectedWall.end.x, z: connectedWall.end.z }
        : { x: connectedWall.start.x, z: connectedWall.start.z };
      const direction: Point2D | null = this._normalizePoint2D({
        x: jointPosition.x - fixedPoint.x,
        z: jointPosition.z - fixedPoint.z,
      });
      if (direction === null) {
        continue;
      }

      constraints.push({ wallId: connection.wallId, fixedPoint: fixedPoint, direction: direction });
    }

    return constraints;
  }

  /**
   * 根据连接节点坐标同步一组直墙端点、吸附门窗并重建 Mesh。
   * @param wallIds - 需要同步和重建的墙体 ID 集合。
   * @param draggedWallId - 用户正在法向拖拽的主动墙体 ID；传入 null 时表示所有受影响墙体都按快照恢复门窗位置。
   * @param attachedDoorWindowPositions - 拖拽开始时吸附在受影响墙体上的门窗定位快照。
   */
  private _syncWallEndpointsFromJoints(
    wallIds: Set<string>,
    draggedWallId: string | null,
    attachedDoorWindowPositions: Map<string, StraightWallAttachedDoorWindowSnapshot[]>
  ): void {
    for (const wallId of wallIds) {
      const wallObject: BuildingObject | undefined = this._objects.get(wallId);
      if (wallObject === undefined || wallObject.category !== 'wall' || (wallObject as WallData).subType !== 'straight') {
        continue;
      }

      const wallData: StraightWallData = wallObject as StraightWallData;
      const mapping: { start: string | null; end: string | null } = this._connectionManager.getWallJoints(wallId);
      const nextStart: Point2D = { x: wallData.start.x, z: wallData.start.z };
      const nextEnd: Point2D = { x: wallData.end.x, z: wallData.end.z };

      if (mapping.start !== null) {
        const startJoint: WallJoint | undefined = this._connectionManager.getJoint(mapping.start);
        if (startJoint !== undefined) {
          nextStart.x = startJoint.position.x;
          nextStart.z = startJoint.position.z;
        }
      }
      if (mapping.end !== null) {
        const endJoint: WallJoint | undefined = this._connectionManager.getJoint(mapping.end);
        if (endJoint !== undefined) {
          nextEnd.x = endJoint.position.x;
          nextEnd.z = endJoint.position.z;
        }
      }

      wallData.start = nextStart;
      wallData.end = nextEnd;

      /* 门窗同步流程：只有主动拖拽墙上的门窗跟随墙体重定位；衔接墙只发生端点联动，墙上门窗保持原世界位置不动。 */
      const doorWindowSnapshots: StraightWallAttachedDoorWindowSnapshot[] | undefined = attachedDoorWindowPositions.get(wallId);
      if ((draggedWallId === null || wallId === draggedWallId) && doorWindowSnapshots !== undefined) {
        this._wallAttachmentService.restoreAttachedDoorWindowsOnWall(wallData, doorWindowSnapshots);
      }

      this._wallAttachmentService.recomputeOpeningsFromAttachedDoorWindows(wallData);
      this._callbacks.removeMeshFromScene(wallId);
      this._callbacks.createWallMesh(wallData);
      this._wallAttachmentService.syncAdaptiveDoorWindowThickness(wallData);
      this._callbacks.notify(wallId, 'update');
    }

    /* 拖拽完成后清理已停用衔接线残留，保持与 updateObject 行为一致。 */
    this._callbacks.refreshConnectionLines();
  }

  /**
   * 计算 XZ 平面二维向量的单位向量。
   * @param vector - 原始二维向量。
   * @returns 单位向量；长度过小时返回 null。
   */
  private _normalizePoint2D(vector: Point2D): Point2D | null {
    return Geometry2DUtils.normalizePoint2D(vector, BuildingWallService.WALL_DRAG_EPSILON);
  }

  /**
   * 计算两条 XZ 平面无限直线的交点。
   * @param pointA - 第一条直线上的点。
   * @param directionA - 第一条直线方向。
   * @param pointB - 第二条直线上的点。
   * @param directionB - 第二条直线方向。
   * @returns 交点；平行或近似平行时返回 null。
   */
  private _intersectInfiniteLines(pointA: Point2D, directionA: Point2D, pointB: Point2D, directionB: Point2D): Point2D | null {
    return Geometry2DUtils.intersectInfiniteLines(pointA, directionA, pointB, directionB, BuildingWallService.WALL_DRAG_EPSILON);
  }

  /**
   * 判断点是否落在指定 XZ 平面无限直线上。
   * @param point - 待检测点。
   * @param linePoint - 直线上的已知点。
   * @param lineDirection - 直线方向单位向量。
   * @returns 点到直线距离在容差内返回 true。
   */
  private _isPointOnLine(point: Point2D, linePoint: Point2D, lineDirection: Point2D): boolean {
    return Geometry2DUtils.isPointOnLine(point, linePoint, lineDirection, BuildingWallService.WALL_DRAG_EPSILON);
  }

  /**
   * 计算弧形墙圆心指向弦中心点的单位方向。
   * @param data - 弧形墙数据。
   * @returns 圆心到弦中心点方向；弧线或弦长退化时返回 null。
   */
  private _computeArcWallCenterToChordMidDirection(data: ArcWallData): Point2D | null {
    if (Math.abs(data.bulge) < 0.001) {
      return null;
    }

    const chordX: number = data.end.x - data.start.x;
    const chordZ: number = data.end.z - data.start.z;
    const chordLength: number = Math.sqrt(chordX * chordX + chordZ * chordZ);
    if (chordLength < 0.001) {
      return null;
    }

    const sagitta: number = (data.bulge * chordLength) / 2;
    if (Math.abs(sagitta) < 0.001) {
      return null;
    }

    const radius: number = (chordLength * chordLength / 4 + sagitta * sagitta) / (2 * Math.abs(sagitta));
    const midX: number = (data.start.x + data.end.x) / 2;
    const midZ: number = (data.start.z + data.end.z) / 2;
    const perpendicularX: number = -chordZ / chordLength;
    const perpendicularZ: number = chordX / chordLength;
    const centerOffset: number = radius - Math.abs(sagitta);
    const centerSign: number = data.bulge > 0 ? 1 : -1;
    const centerX: number = midX + perpendicularX * centerOffset * centerSign;
    const centerZ: number = midZ + perpendicularZ * centerOffset * centerSign;

    /* 方向约束流程：拖拽只允许沿圆心与弦中心点连线移动，避免弧墙被任意方向平移。 */
    return this._normalizePoint2D({ x: midX - centerX, z: midZ - centerZ });
  }
}