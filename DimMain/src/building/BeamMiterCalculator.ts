/**
 * 梁斜接计算器
 * 负责根据梁端点连接关系计算梁端面的斜切偏移，避免多根梁在同一节点连接时互相穿插。
 */

import type { BeamData, MiterEndParams, MiterParams, Point2D, WallEndpoint } from './BuildingTypes';

/** 梁端点连接判断阈值（米），仅端点几乎重合时才视为同一梁节点。 */
const BEAM_ENDPOINT_EPSILON: number = 0.001;

/** 梁斜接计算输入描述 */
interface BeamEndpointDescriptor {
  /** 梁 ID */
  beamId: string;
  /** 当前参与计算的端点类型 */
  endpoint: WallEndpoint;
  /** 节点端点坐标 */
  point: Point2D;
  /** 远离节点的另一端坐标 */
  oppositePoint: Point2D;
  /** 梁宽度，等价于 XZ 平面上的截面厚度 */
  width: number;
}

/** 梁斜接计算器 */
export class BeamMiterCalculator {
  /** 无斜接偏移常量 */
  public static readonly NO_MITER: MiterParams = {
    start: { frontOffset: 0, backOffset: 0 },
    end: { frontOffset: 0, backOffset: 0 },
  };

  /**
   * 计算指定梁的起点和终点斜接参数
   * 关键流程：扫描所有梁端点，找出与当前梁端点重合的梁，再按两梁侧边交点换算前后侧有符号偏移量。
   * @param beam - 需要计算的梁数据
   * @param allBeams - 场景中全部梁数据
   * @returns 梁两端斜接参数
   */
  public computeMiterForBeam(beam: BeamData, allBeams: BeamData[]): MiterParams {
    const startMiter: MiterEndParams = this._computeEndpointMiter(beam, 'start', allBeams);
    const endMiter: MiterEndParams = this._computeEndpointMiter(beam, 'end', allBeams);
    return {
      start: startMiter,
      end: endMiter,
    };
  }

  /**
   * 收集与指定梁共享端点的相邻梁 ID
   * @param beam - 当前梁数据
   * @param allBeams - 场景中全部梁数据
   * @returns 相邻梁 ID 集合
   */
  public collectAdjacentBeamIds(beam: BeamData, allBeams: BeamData[]): Set<string> {
    const adjacentIds: Set<string> = new Set<string>();
    const currentStart: BeamEndpointDescriptor = this._createEndpointDescriptor(beam, 'start');
    const currentEnd: BeamEndpointDescriptor = this._createEndpointDescriptor(beam, 'end');

    for (const otherBeam of allBeams) {
      if (otherBeam.id === beam.id) {
        continue;
      }

      const otherStart: BeamEndpointDescriptor = this._createEndpointDescriptor(otherBeam, 'start');
      const otherEnd: BeamEndpointDescriptor = this._createEndpointDescriptor(otherBeam, 'end');
      if (
        this._areSamePoint(currentStart.point, otherStart.point) ||
        this._areSamePoint(currentStart.point, otherEnd.point) ||
        this._areSamePoint(currentEnd.point, otherStart.point) ||
        this._areSamePoint(currentEnd.point, otherEnd.point)
      ) {
        adjacentIds.add(otherBeam.id);
      }
    }

    return adjacentIds;
  }

  /**
   * 计算单个端点的斜切参数
   * @param beam - 当前梁数据
   * @param endpoint - 当前端点类型
   * @param allBeams - 场景中全部梁数据
   * @returns 单端斜切参数
   */
  private _computeEndpointMiter(beam: BeamData, endpoint: WallEndpoint, allBeams: BeamData[]): MiterEndParams {
    const noMiter: MiterEndParams = { frontOffset: 0, backOffset: 0 };
    const current: BeamEndpointDescriptor = this._createEndpointDescriptor(beam, endpoint);

    /* 节点确定性斜切流程：
     * 1. 仅使用节点坐标、两条梁从节点向外的几何方向和当前梁宽度计算，避免绘制顺序、顺逆时针影响结果。
     * 2. front/back 始终按当前梁 start -> end 的全局方向定义，与 BeamGeometryBuilder 保持一致。
     * 3. 使用两条节点射线的角平分线作为唯一斜切线，当前梁两侧边线与斜切线求交后得到有符号偏移。
     */
    const connectedEndpoints: BeamEndpointDescriptor[] = this._collectConnectedEndpoints(current, beam.id, allBeams);
    if (connectedEndpoints.length !== 1) {
      return noMiter;
    }

    const myDirX: number = current.oppositePoint.x - current.point.x;
    const myDirZ: number = current.oppositePoint.z - current.point.z;
    const myLen: number = Math.sqrt(myDirX * myDirX + myDirZ * myDirZ);
    if (myLen < BEAM_ENDPOINT_EPSILON) {
      return noMiter;
    }

    const inwardDirX: number = myDirX / myLen;
    const inwardDirZ: number = myDirZ / myLen;
    const globalDirX: number = endpoint === 'start' ? inwardDirX : -inwardDirX;
    const globalDirZ: number = endpoint === 'start' ? inwardDirZ : -inwardDirZ;
    const globalNormalX: number = -globalDirZ;
    const globalNormalZ: number = globalDirX;
    const halfWidth: number = current.width / 2;

    const other: BeamEndpointDescriptor = connectedEndpoints[0]!;
    const otherDirX: number = other.oppositePoint.x - other.point.x;
    const otherDirZ: number = other.oppositePoint.z - other.point.z;
    const otherLen: number = Math.sqrt(otherDirX * otherDirX + otherDirZ * otherDirZ);
    if (otherLen < BEAM_ENDPOINT_EPSILON) {
      return noMiter;
    }

    const normalizedOtherDirX: number = otherDirX / otherLen;
    const normalizedOtherDirZ: number = otherDirZ / otherLen;
    const cross: number = inwardDirX * normalizedOtherDirZ - inwardDirZ * normalizedOtherDirX;
    if (Math.abs(cross) < 0.05) {
      return noMiter;
    }

    const seamDirX: number = inwardDirX + normalizedOtherDirX;
    const seamDirZ: number = inwardDirZ + normalizedOtherDirZ;
    const seamLen: number = Math.sqrt(seamDirX * seamDirX + seamDirZ * seamDirZ);
    if (seamLen < BEAM_ENDPOINT_EPSILON) {
      return noMiter;
    }

    const normalizedSeamDirX: number = seamDirX / seamLen;
    const normalizedSeamDirZ: number = seamDirZ / seamLen;
    const frontOffset: number | null = this._tryComputeLineIntersectionParameter(
      current.point.x + globalNormalX * halfWidth,
      current.point.z + globalNormalZ * halfWidth,
      inwardDirX,
      inwardDirZ,
      current.point.x,
      current.point.z,
      normalizedSeamDirX,
      normalizedSeamDirZ
    );
    const backOffset: number | null = this._tryComputeLineIntersectionParameter(
      current.point.x - globalNormalX * halfWidth,
      current.point.z - globalNormalZ * halfWidth,
      inwardDirX,
      inwardDirZ,
      current.point.x,
      current.point.z,
      normalizedSeamDirX,
      normalizedSeamDirZ
    );
    if (frontOffset === null || backOffset === null) {
      return noMiter;
    }

    const maxOffset: number = Math.min(myLen * 0.45, current.width * 2.5);
    if (Math.abs(frontOffset) > maxOffset || Math.abs(backOffset) > maxOffset) {
      return noMiter;
    }

    return {
      frontOffset: frontOffset,
      backOffset: backOffset,
    };
  }

  /**
   * 收集与当前梁端点重合的其它梁端点。
   * @param current - 当前梁端点描述
   * @param currentBeamId - 当前梁 ID
   * @param allBeams - 场景内所有梁数据
   * @returns 与当前端点重合的其它梁端点列表
   */
  private _collectConnectedEndpoints(
    current: BeamEndpointDescriptor,
    currentBeamId: string,
    allBeams: BeamData[]
  ): BeamEndpointDescriptor[] {
    const endpoints: BeamEndpointDescriptor[] = [];
    for (const otherBeam of allBeams) {
      if (otherBeam.id === currentBeamId) {
        continue;
      }

      const otherStart: BeamEndpointDescriptor = this._createEndpointDescriptor(otherBeam, 'start');
      if (this._areSamePoint(current.point, otherStart.point)) {
        endpoints.push(otherStart);
      }

      const otherEnd: BeamEndpointDescriptor = this._createEndpointDescriptor(otherBeam, 'end');
      if (this._areSamePoint(current.point, otherEnd.point)) {
        endpoints.push(otherEnd);
      }
    }
    return endpoints;
  }

  /**
   * 尝试计算两条 XZ 平面参数直线的第一条直线参数 t。
   * @param firstX - 第一条直线起点 X
   * @param firstZ - 第一条直线起点 Z
   * @param firstDirX - 第一条直线方向 X
   * @param firstDirZ - 第一条直线方向 Z
   * @param secondX - 第二条直线起点 X
   * @param secondZ - 第二条直线起点 Z
   * @param secondDirX - 第二条直线方向 X
   * @param secondDirZ - 第二条直线方向 Z
   * @returns 第一条直线到交点的有符号参数 t；平行或近似平行时返回 null
   */
  private _tryComputeLineIntersectionParameter(
    firstX: number,
    firstZ: number,
    firstDirX: number,
    firstDirZ: number,
    secondX: number,
    secondZ: number,
    secondDirX: number,
    secondDirZ: number
  ): number | null {
    const denominator: number = firstDirX * secondDirZ - firstDirZ * secondDirX;
    if (Math.abs(denominator) < 0.000001) {
      return null;
    }

    const diffX: number = secondX - firstX;
    const diffZ: number = secondZ - firstZ;
    return (diffX * secondDirZ - diffZ * secondDirX) / denominator;
  }

  /**
   * 创建梁端点描述对象
   * @param beam - 梁数据
   * @param endpoint - 端点类型
   * @returns 梁端点描述
   */
  private _createEndpointDescriptor(beam: BeamData, endpoint: WallEndpoint): BeamEndpointDescriptor {
    if (endpoint === 'start') {
      return {
        beamId: beam.id,
        endpoint: endpoint,
        point: beam.start,
        oppositePoint: beam.end,
        width: beam.width,
      };
    }

    return {
      beamId: beam.id,
      endpoint: endpoint,
      point: beam.end,
      oppositePoint: beam.start,
      width: beam.width,
    };
  }

  /**
   * 判断两个 XZ 平面点是否重合
   * @param first - 第一个点
   * @param second - 第二个点
   * @returns 是否在阈值内重合
   */
  private _areSamePoint(first: Point2D, second: Point2D): boolean {
    const dx: number = first.x - second.x;
    const dz: number = first.z - second.z;
    return Math.sqrt(dx * dx + dz * dz) <= BEAM_ENDPOINT_EPSILON;
  }
}