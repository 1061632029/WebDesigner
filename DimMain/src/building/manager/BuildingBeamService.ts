/**
 * 建筑梁对象领域服务。
 * 负责梁拖拽、梁衔接点聚合与梁局部重建 ID 计算，避免 BuildingObjectManager 承载梁专属逻辑。
 */

import type {
  BeamData,
  BuildingObject,
  Point2D,
  WallConnection,
  WallEndpoint,
  WallJoint,
} from '../BuildingTypes';
import { BeamGeometryBuilder } from '../BeamGeometryBuilder';
import { BeamMiterCalculator } from '../BeamMiterCalculator';
import { LineElementDragGeometryHelper } from '../../interaction/LineElementDragGeometryHelper';
import type { LineElementDirectionConstraint } from '../../interaction/LineElementDragGeometryHelper';
import { Geometry2DUtils } from './Geometry2DUtils';

/** 线性对象起终点坐标快照。 */
export interface LineEndpointSnapshot {
  /** 起点坐标。 */
  start: Point2D;
  /** 终点坐标。 */
  end: Point2D;
}

/** 梁整体拖拽开始快照。 */
export interface BeamDragSnapshot {
  /** 被拖拽梁 ID。 */
  beamId: string;
  /** 梁拖拽开始时的中心线起点。 */
  start: Point2D;
  /** 梁拖拽开始时的中心线终点。 */
  end: Point2D;
  /** 梁拖拽开始时的中心线单位方向。 */
  direction: Point2D;
  /** 拖拽开始时受影响梁的端点坐标快照。 */
  beamPositions: Map<string, LineEndpointSnapshot>;
}

/** 梁衔接点拖拽开始快照。 */
export interface BeamJointDragSnapshot {
  /** 被拖拽的梁衔接点 ID。 */
  jointId: string;
  /** 衔接点拖拽开始时的坐标。 */
  jointStart: Point2D;
  /** 拖拽开始时受影响梁的端点坐标快照。 */
  beamPositions: Map<string, LineEndpointSnapshot>;
}

/** 梁拖拽或节点拖拽的结果。 */
export interface BeamMoveResult {
  /** 实际被修改的梁 ID 集合。 */
  affectedBeamIds: Set<string>;
  /** 需要重建 Mesh 的梁 ID 集合，包含受斜接影响的相邻梁。 */
  rebuildBeamIds: Set<string>;
}

/** 梁端点方向约束。 */
interface BeamDragDirectionConstraint extends LineElementDirectionConstraint {
  /** 相邻梁 ID。 */
  beamId: string;
  /** 相邻梁被约束移动的端点。 */
  endpoint: WallEndpoint;
}

/** 建筑梁对象领域服务。 */
export class BuildingBeamService {
  /** 梁衔接节点聚合容差：与梁斜接端点重合判断保持一致。 */
  public static readonly BEAM_JOINT_EPSILON: number = 0.001;

  /** 所有建筑对象的纯数据集合。 */
  private readonly _objects: Map<string, BuildingObject>;

  /** 梁斜接计算器。 */
  private readonly _beamMiterCalculator: BeamMiterCalculator;

  /**
   * @param objects - 建筑对象数据集合。
   * @param beamMiterCalculator - 梁斜接计算器。
   */
  public constructor(objects: Map<string, BuildingObject>, beamMiterCalculator: BeamMiterCalculator) {
    this._objects = objects;
    this._beamMiterCalculator = beamMiterCalculator;
  }

  /**
   * 获取当前全部梁对象。
   * @returns 梁对象数组。
   */
  public getAllBeamData(): BeamData[] {
    const beams: BeamData[] = [];
    this._objects.forEach((object: BuildingObject): void => {
      if (object.category === 'beam') {
        beams.push(object as BeamData);
      }
    });
    return beams;
  }

  /**
   * 创建梁整体拖拽开始快照。
   * @param beamId - 被拖拽梁 ID。
   * @returns 拖拽快照；梁不存在或长度无效时返回 null。
   */
  public createBeamDragSnapshot(beamId: string): BeamDragSnapshot | null {
    const beamObject: BuildingObject | undefined = this._objects.get(beamId);
    if (beamObject === undefined || beamObject.category !== 'beam') {
      return null;
    }

    const beamData: BeamData = beamObject as BeamData;
    const beamDirection: Point2D | null = Geometry2DUtils.normalizePoint2D({
      x: beamData.end.x - beamData.start.x,
      z: beamData.end.z - beamData.start.z,
    });
    if (beamDirection === null) {
      return null;
    }

    const beamPositions: Map<string, LineEndpointSnapshot> = new Map<string, LineEndpointSnapshot>();
    beamPositions.set(beamId, {
      start: { x: beamData.start.x, z: beamData.start.z },
      end: { x: beamData.end.x, z: beamData.end.z },
    });

    /* 梁拖拽快照采集流程：记录被拖拽梁以及与其起终点重合的相邻梁，供实时拖拽按 P + L 绝对计算。 */
    const allBeams: BeamData[] = this.getAllBeamData();
    for (const candidateBeam of allBeams) {
      if (candidateBeam.id === beamId) {
        continue;
      }

      const sharesStartEndpoint: boolean =
        this.isBeamJointSamePoint(candidateBeam.start, beamData.start) ||
        this.isBeamJointSamePoint(candidateBeam.end, beamData.start);
      const sharesEndEndpoint: boolean =
        this.isBeamJointSamePoint(candidateBeam.start, beamData.end) ||
        this.isBeamJointSamePoint(candidateBeam.end, beamData.end);
      if (!sharesStartEndpoint && !sharesEndEndpoint) {
        continue;
      }

      beamPositions.set(candidateBeam.id, {
        start: { x: candidateBeam.start.x, z: candidateBeam.start.z },
        end: { x: candidateBeam.end.x, z: candidateBeam.end.z },
      });
    }

    return {
      beamId: beamId,
      start: { x: beamData.start.x, z: beamData.start.z },
      end: { x: beamData.end.x, z: beamData.end.z },
      direction: beamDirection,
      beamPositions: beamPositions,
    };
  }

  /**
   * 根据拖拽快照移动梁，并返回受影响梁集合。
   * @param snapshot - 梁拖拽开始快照。
   * @param totalOffset - 当前拖拽总偏移。
   * @returns 移动结果；约束无法求解或对象无效时返回 null。
   */
  public moveBeamFromSnapshot(snapshot: BeamDragSnapshot, totalOffset: Point2D): BeamMoveResult | null {
    this.restoreBeamDragSnapshotState(snapshot);

    const beamObject: BuildingObject | undefined = this._objects.get(snapshot.beamId);
    if (beamObject === undefined || beamObject.category !== 'beam') {
      return null;
    }

    const beamData: BeamData = beamObject as BeamData;
    const affectedBeamIds: Set<string> = new Set<string>(snapshot.beamPositions.keys());
    const startConstraints: BeamDragDirectionConstraint[] = this.collectBeamDragDirectionConstraints(snapshot, snapshot.start);
    const endConstraints: BeamDragDirectionConstraint[] = this.collectBeamDragDirectionConstraints(snapshot, snapshot.end);
    const nextStart: Point2D | null = LineElementDragGeometryHelper.resolveEndpointPosition(
      snapshot.start,
      totalOffset,
      snapshot.start,
      snapshot.direction,
      startConstraints
    );
    const nextEnd: Point2D | null = LineElementDragGeometryHelper.resolveEndpointPosition(
      snapshot.end,
      totalOffset,
      snapshot.start,
      snapshot.direction,
      endConstraints
    );
    if (nextStart === null || nextEnd === null) {
      console.warn(`[BuildingBeamService] 梁拖拽方向约束无法求解，取消梁移动: beamId=${snapshot.beamId}`);
      return null;
    }

    /* 梁整体拖拽流程：被拖拽梁按总偏移移动，相邻梁共享端点跟随以保持原方向。 */
    beamData.start = { x: nextStart.x, z: nextStart.z };
    beamData.end = { x: nextEnd.x, z: nextEnd.z };
    beamData.length = BeamGeometryBuilder.computeLength(beamData.start, beamData.end);
    this.applyBeamEndpointConstraints(startConstraints, nextStart, affectedBeamIds);
    this.applyBeamEndpointConstraints(endConstraints, nextEnd, affectedBeamIds);

    return {
      affectedBeamIds: affectedBeamIds,
      rebuildBeamIds: this.collectRebuildBeamIds(affectedBeamIds),
    };
  }

  /**
   * 创建梁衔接点拖拽开始快照。
   * @param jointId - 被拖拽梁衔接点 ID。
   * @returns 拖拽快照；节点无效时返回 null。
   */
  public createBeamJointDragSnapshot(jointId: string): BeamJointDragSnapshot | null {
    const beamJoint: WallJoint | undefined = this.collectBeamJointNodes().find(
      (joint: WallJoint): boolean => joint.id === jointId
    );
    if (beamJoint === undefined || beamJoint.connections.length < 2) {
      return null;
    }

    const beamPositions: Map<string, LineEndpointSnapshot> = new Map<string, LineEndpointSnapshot>();
    for (const connection of beamJoint.connections) {
      const beamObject: BuildingObject | undefined = this._objects.get(connection.wallId);
      if (beamObject === undefined || beamObject.category !== 'beam') {
        continue;
      }

      const beamData: BeamData = beamObject as BeamData;
      beamPositions.set(beamData.id, {
        start: { x: beamData.start.x, z: beamData.start.z },
        end: { x: beamData.end.x, z: beamData.end.z },
      });
    }

    if (beamPositions.size < 2) {
      return null;
    }

    return {
      jointId: jointId,
      jointStart: { x: beamJoint.position.x, z: beamJoint.position.z },
      beamPositions: beamPositions,
    };
  }

  /**
   * 根据快照移动梁衔接点，并返回受影响梁集合。
   * @param snapshot - 梁衔接点拖拽开始快照。
   * @param totalOffset - 当前拖拽总偏移。
   * @returns 移动结果；没有受影响梁时返回 null。
   */
  public moveBeamJointFromSnapshot(snapshot: BeamJointDragSnapshot, totalOffset: Point2D): BeamMoveResult | null {
    if (snapshot.jointId.length === 0) {
      return null;
    }

    this.restoreBeamJointDragSnapshotState(snapshot);
    const targetPoint: Point2D = {
      x: snapshot.jointStart.x + totalOffset.x,
      z: snapshot.jointStart.z + totalOffset.z,
    };
    const affectedBeamIds: Set<string> = new Set<string>();

    snapshot.beamPositions.forEach((positionSnapshot: LineEndpointSnapshot, beamId: string): void => {
      const beamObject: BuildingObject | undefined = this._objects.get(beamId);
      if (beamObject === undefined || beamObject.category !== 'beam') {
        return;
      }

      const beamData: BeamData = beamObject as BeamData;
      const startSharesJoint: boolean = this.isBeamJointSamePoint(positionSnapshot.start, snapshot.jointStart);
      const endSharesJoint: boolean = this.isBeamJointSamePoint(positionSnapshot.end, snapshot.jointStart);
      if (!startSharesJoint && !endSharesJoint) {
        return;
      }

      /* 梁节点移动流程：只移动与衔接点重合的端点，另一端保持不变。 */
      if (startSharesJoint) {
        beamData.start = { x: targetPoint.x, z: targetPoint.z };
      }
      if (endSharesJoint) {
        beamData.end = { x: targetPoint.x, z: targetPoint.z };
      }
      beamData.length = BeamGeometryBuilder.computeLength(beamData.start, beamData.end);
      affectedBeamIds.add(beamId);
    });

    if (affectedBeamIds.size === 0) {
      return null;
    }

    return {
      affectedBeamIds: affectedBeamIds,
      rebuildBeamIds: this.collectRebuildBeamIds(affectedBeamIds),
    };
  }

  /**
   * 收集梁端点衔接节点。
   * @returns 复用 WallJoint 结构表达的梁节点列表。
   */
  public collectBeamJointNodes(): WallJoint[] {
    const beamJoints: WallJoint[] = [];
    const beams: BeamData[] = this.getAllBeamData();

    for (const beam of beams) {
      const beamLength: number = BeamGeometryBuilder.computeLength(beam.start, beam.end);
      if (beamLength < BuildingBeamService.BEAM_JOINT_EPSILON) {
        continue;
      }

      this.registerBeamEndpointJoint(beamJoints, beam, 'start', beam.start);
      this.registerBeamEndpointJoint(beamJoints, beam, 'end', beam.end);
    }

    return beamJoints.filter((joint: WallJoint): boolean => joint.connections.length >= 2);
  }

  /**
   * 判断两个梁端点是否属于同一个衔接节点。
   * @param first - 第一个端点坐标。
   * @param second - 第二个端点坐标。
   * @returns 距离不大于梁节点容差时返回 true。
   */
  public isBeamJointSamePoint(first: Point2D, second: Point2D): boolean {
    const dx: number = first.x - second.x;
    const dz: number = first.z - second.z;
    const distance: number = Math.sqrt(dx * dx + dz * dz);
    return distance <= BuildingBeamService.BEAM_JOINT_EPSILON;
  }

  /**
   * 计算受影响梁及其斜接相邻梁的重建集合。
   * @param affectedBeamIds - 已被修改的梁 ID 集合。
   * @returns 需要重建 Mesh 的梁 ID 集合。
   */
  public collectRebuildBeamIds(affectedBeamIds: Set<string>): Set<string> {
    const rebuildBeamIds: Set<string> = new Set<string>(affectedBeamIds);
    affectedBeamIds.forEach((affectedBeamId: string): void => {
      const affectedBeamObject: BuildingObject | undefined = this._objects.get(affectedBeamId);
      if (affectedBeamObject === undefined || affectedBeamObject.category !== 'beam') {
        return;
      }
      const adjacentBeamIds: Set<string> = this._beamMiterCalculator.collectAdjacentBeamIds(
        affectedBeamObject as BeamData,
        this.getAllBeamData()
      );
      adjacentBeamIds.forEach((adjacentBeamId: string): void => {
        rebuildBeamIds.add(adjacentBeamId);
      });
    });
    return rebuildBeamIds;
  }

  /**
   * 将梁端点登记到衔接节点集合。
   * @param beamJoints - 当前已聚合的梁衔接节点列表。
   * @param beam - 梁对象。
   * @param endpoint - 梁端点名称。
   * @param point - 梁端点坐标。
   */
  private registerBeamEndpointJoint(
    beamJoints: WallJoint[],
    beam: BeamData,
    endpoint: WallEndpoint,
    point: Point2D
  ): void {
    const existingJoint: WallJoint | undefined = beamJoints.find(
      (joint: WallJoint): boolean => this.isBeamJointSamePoint(joint.position, point)
    );

    if (existingJoint !== undefined) {
      const exists: boolean = existingJoint.connections.some(
        (connection: WallConnection): boolean => connection.wallId === beam.id && connection.endpoint === endpoint
      );
      if (!exists) {
        existingJoint.connections.push({ wallId: beam.id, endpoint: endpoint });
      }
      return;
    }

    const jointId: string = `beam-joint-${beamJoints.length}-${point.x.toFixed(3)}-${point.z.toFixed(3)}`;
    const newJoint: WallJoint = {
      id: jointId,
      position: { x: point.x, z: point.z },
      connections: [{ wallId: beam.id, endpoint: endpoint }],
    };
    beamJoints.push(newJoint);
  }

  /**
   * 恢复单根梁的端点快照。
   * @param beamId - 梁 ID。
   * @param positionSnapshot - 起终点快照。
   */
  private restoreBeamEndpointSnapshot(beamId: string, positionSnapshot: LineEndpointSnapshot): void {
    const beamObject: BuildingObject | undefined = this._objects.get(beamId);
    if (beamObject === undefined || beamObject.category !== 'beam') {
      return;
    }

    /* 快照恢复流程：每次预览计算前先回到拖拽起点，再按总偏移重新计算，避免逐帧累加误差。 */
    const beamData: BeamData = beamObject as BeamData;
    beamData.start = { x: positionSnapshot.start.x, z: positionSnapshot.start.z };
    beamData.end = { x: positionSnapshot.end.x, z: positionSnapshot.end.z };
    beamData.length = BeamGeometryBuilder.computeLength(beamData.start, beamData.end);
  }

  /**
   * 恢复梁整体拖拽快照中的梁端点坐标。
   * @param snapshot - 梁整体拖拽快照。
   */
  private restoreBeamDragSnapshotState(snapshot: BeamDragSnapshot): void {
    snapshot.beamPositions.forEach((positionSnapshot: LineEndpointSnapshot, beamId: string): void => {
      this.restoreBeamEndpointSnapshot(beamId, positionSnapshot);
    });
  }

  /**
   * 恢复梁节点拖拽快照中的梁端点坐标。
   * @param snapshot - 梁节点拖拽快照。
   */
  private restoreBeamJointDragSnapshotState(snapshot: BeamJointDragSnapshot): void {
    snapshot.beamPositions.forEach((positionSnapshot: LineEndpointSnapshot, beamId: string): void => {
      this.restoreBeamEndpointSnapshot(beamId, positionSnapshot);
    });
  }

  /**
   * 收集梁拖拽端点处相邻梁的方向约束。
   * @param snapshot - 梁拖拽开始快照。
   * @param jointPosition - 被拖拽梁端点在拖拽开始时的坐标。
   * @returns 相邻梁方向约束列表。
   */
  private collectBeamDragDirectionConstraints(
    snapshot: BeamDragSnapshot,
    jointPosition: Point2D
  ): BeamDragDirectionConstraint[] {
    const constraints: BeamDragDirectionConstraint[] = [];
    snapshot.beamPositions.forEach((positionSnapshot: LineEndpointSnapshot, beamId: string): void => {
      if (beamId === snapshot.beamId) {
        return;
      }

      const startSharesJoint: boolean = this.isBeamJointSamePoint(positionSnapshot.start, jointPosition);
      const endSharesJoint: boolean = this.isBeamJointSamePoint(positionSnapshot.end, jointPosition);
      if (!startSharesJoint && !endSharesJoint) {
        return;
      }

      const endpoint: WallEndpoint = startSharesJoint ? 'start' : 'end';
      const fixedPoint: Point2D = endpoint === 'start'
        ? { x: positionSnapshot.end.x, z: positionSnapshot.end.z }
        : { x: positionSnapshot.start.x, z: positionSnapshot.start.z };
      const direction: Point2D | null = Geometry2DUtils.normalizePoint2D({
        x: jointPosition.x - fixedPoint.x,
        z: jointPosition.z - fixedPoint.z,
      });
      if (direction === null) {
        return;
      }

      constraints.push({
        beamId: beamId,
        endpoint: endpoint,
        fixedPoint: fixedPoint,
        direction: direction,
      });
    });
    return constraints;
  }

  /**
   * 将端点方向约束应用到相邻梁。
   * @param constraints - 相邻梁方向约束。
   * @param sharedPoint - 被拖拽端点的新共享坐标。
   * @param affectedBeamIds - 受影响梁 ID 集合。
   */
  private applyBeamEndpointConstraints(
    constraints: BeamDragDirectionConstraint[],
    sharedPoint: Point2D,
    affectedBeamIds: Set<string>
  ): void {
    for (const constraint of constraints) {
      const beamObject: BuildingObject | undefined = this._objects.get(constraint.beamId);
      if (beamObject === undefined || beamObject.category !== 'beam') {
        continue;
      }

      /* 约束应用流程：只移动与被拖拽梁相连的端点，另一端保持不变，使相邻梁延长或缩短并保持原方向。 */
      const beamData: BeamData = beamObject as BeamData;
      if (constraint.endpoint === 'start') {
        beamData.start = { x: sharedPoint.x, z: sharedPoint.z };
      } else {
        beamData.end = { x: sharedPoint.x, z: sharedPoint.z };
      }

      beamData.length = BeamGeometryBuilder.computeLength(beamData.start, beamData.end);
      affectedBeamIds.add(constraint.beamId);
    }
  }
}