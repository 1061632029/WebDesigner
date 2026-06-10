/**
 * 墙体连接管理器
 * 管理墙体端点的拓扑连接关系，支持端点吸附和连接图查询
 * 每个共享点（Joint）可连接多面墙的端点
 */

import type {
  Point2D,
  WallEndpoint,
  WallConnection,
  WallJoint,
  SnapResult,
  MiterParams,
  MiterEndParams,
  WallSubtractionRect,
} from './BuildingTypes';
import { SNAP_THRESHOLD } from './BuildingTypes';
import { IdGenerator } from './IdGenerator';

/**
 * 墙体连接管理器
 */
export class WallConnectionManager {
  /** 所有连接节点（key = 节点 ID） */
  private _joints: Map<string, WallJoint> = new Map();

  /** 墙体 → 节点映射（key = wallId，value = { start: jointId, end: jointId }） */
  private _wallToJoints: Map<string, { start: string | null; end: string | null }> = new Map();

  /* ========== 吸附检测 ========== */

  /**
   * 检测指定坐标是否在吸附阈值内存在已有端点
   * 如果找到，返回最近节点的坐标和 ID；否则返回原始坐标
   * @param point - 待检测的世界坐标
   * @param threshold - 吸附距离阈值（米），默认使用全局常量
   * @returns 吸附检测结果
   */
  public snap(point: Point2D, threshold: number = SNAP_THRESHOLD): SnapResult {
    let nearestJointId: string | null = null;
    let nearestDist: number = threshold;
    let nearestPos: Point2D = point;

    /* 遍历所有节点，找到最近的 */
    this._joints.forEach((joint: WallJoint): void => {
      const dx: number = joint.position.x - point.x;
      const dz: number = joint.position.z - point.z;
      const dist: number = Math.sqrt(dx * dx + dz * dz);

      if (dist < nearestDist) {
        nearestDist = dist;
        nearestJointId = joint.id;
        nearestPos = { x: joint.position.x, z: joint.position.z };
      }
    });

    if (nearestJointId !== null) {
      return {
        snapped: true,
        position: nearestPos,
        jointId: nearestJointId,
      };
    }

    return {
      snapped: false,
      position: point,
      jointId: null,
    };
  }

  /* ========== 节点管理 ========== */

  /**
   * 在指定位置创建新的连接节点
   * @param position - 节点坐标
   * @returns 新节点的 ID
   */
  public createJoint(position: Point2D): string {
    const jointId: string = IdGenerator.generate('joint');
    const joint: WallJoint = {
      id: jointId,
      position: { x: position.x, z: position.z },
      connections: [],
    };
    this._joints.set(jointId, joint);
    return jointId;
  }

  /**
   * 获取节点
   * @param jointId - 节点 ID
   * @returns 节点数据，不存在返回 undefined
   */
  public getJoint(jointId: string): WallJoint | undefined {
    return this._joints.get(jointId);
  }

  /**
   * 更新指定连接节点的中心坐标。
   * 拖拽墙体时需要先移动拓扑节点，再由建筑对象管理器把节点坐标同步回墙体端点。
   * @param jointId - 节点 ID
   * @param position - 新节点坐标
   * @returns 更新成功返回 true；节点不存在返回 false
   */
  public updateJointPosition(jointId: string, position: Point2D): boolean {
    const joint: WallJoint | undefined = this._joints.get(jointId);
    if (joint === undefined) {
      return false;
    }

    joint.position = { x: position.x, z: position.z };
    return true;
  }

  /**
   * 获取所有节点
   * @returns 节点数组
   */
  public getAllJoints(): Array<WallJoint> {
    return Array.from(this._joints.values());
  }

  /* ========== 连接操作 ========== */

  /**
   * 将墙体端点连接到指定节点
   * 如果该节点不存在则自动创建
   * @param wallId - 墙体 ID
   * @param endpoint - 端点类型（start 或 end）
   * @param jointId - 目标节点 ID（为 null 时在 position 处自动创建新节点）
   * @param position - 端点坐标（当 jointId 为 null 时使用）
   * @returns 连接到的节点 ID
   */
  public connectWallEndpoint(
    wallId: string,
    endpoint: WallEndpoint,
    jointId: string | null,
    position: Point2D
  ): string {
    /* 如果没有指定节点，创建新节点 */
    let actualJointId: string;
    if (jointId === null) {
      actualJointId = this.createJoint(position);
    } else {
      actualJointId = jointId;
    }

    /* 获取节点并添加连接 */
    const joint: WallJoint | undefined = this._joints.get(actualJointId);
    if (joint === undefined) {
      /* 不应该发生，但防御性处理 */
      actualJointId = this.createJoint(position);
      const newJoint: WallJoint = this._joints.get(actualJointId)!;
      newJoint.connections.push({ wallId: wallId, endpoint: endpoint });
    } else {
      /* 检查是否已经存在相同的连接（避免重复） */
      const exists: boolean = joint.connections.some(
        (c: WallConnection): boolean => c.wallId === wallId && c.endpoint === endpoint
      );
      if (!exists) {
        joint.connections.push({ wallId: wallId, endpoint: endpoint });
      }
    }

    /* 更新墙体→节点映射 */
    let wallMapping = this._wallToJoints.get(wallId);
    if (wallMapping === undefined) {
      wallMapping = { start: null, end: null };
      this._wallToJoints.set(wallId, wallMapping);
    }
    wallMapping[endpoint] = actualJointId;

    return actualJointId;
  }

  /**
   * 注册墙体的两个端点
   * 对每个端点执行吸附检测，吸附到已有节点或创建新节点
   * @param wallId - 墙体 ID
   * @param startPos - 起点坐标
   * @param endPos - 终点坐标
   * @returns 起点和终点连接到的节点 ID
   */
  public registerWall(
    wallId: string,
    startPos: Point2D,
    endPos: Point2D
  ): { startJointId: string; endJointId: string } {
    /* 起点吸附检测 */
    const startSnap: SnapResult = this.snap(startPos);
    const startJointId: string = this.connectWallEndpoint(
      wallId, 'start', startSnap.jointId, startSnap.position
    );

    /* 终点吸附检测 */
    const endSnap: SnapResult = this.snap(endPos);
    const endJointId: string = this.connectWallEndpoint(
      wallId, 'end', endSnap.jointId, endSnap.position
    );

    return { startJointId, endJointId };
  }

  /**
   * 断开墙体的所有连接并清理空节点
   * @param wallId - 要断开的墙体 ID
   */
  public disconnectWall(wallId: string): void {
    const mapping = this._wallToJoints.get(wallId);
    if (mapping === undefined) {
      return;
    }

    /* 从起点节点中移除此墙体 */
    if (mapping.start !== null) {
      this._removeConnectionFromJoint(mapping.start, wallId);
    }

    /* 从终点节点中移除此墙体 */
    if (mapping.end !== null) {
      this._removeConnectionFromJoint(mapping.end, wallId);
    }

    /* 移除映射 */
    this._wallToJoints.delete(wallId);
  }

  /**
   * 获取指定节点上连接的所有墙体
   * @param jointId - 节点 ID
   * @returns 连接的墙体列表
   */
  public getJointConnections(jointId: string): Array<WallConnection> {
    const joint: WallJoint | undefined = this._joints.get(jointId);
    if (joint === undefined) {
      return [];
    }
    return [...joint.connections];
  }

  /**
   * 获取墙体连接的节点 ID
   * @param wallId - 墙体 ID
   * @returns 起点和终点的节点 ID（可能为 null）
   */
  public getWallJoints(wallId: string): { start: string | null; end: string | null } {
    const mapping = this._wallToJoints.get(wallId);
    if (mapping === undefined) {
      return { start: null, end: null };
    }
    return { ...mapping };
  }

  /**
   * 获取节点总数
   */
  public get jointCount(): number {
    return this._joints.size;
  }

  /* ========== 内部方法 ========== */

  /**
   * 从节点中移除指定墙体的连接
   * 如果节点变为空（无连接），自动删除节点
   */
  private _removeConnectionFromJoint(jointId: string, wallId: string): void {
    const joint: WallJoint | undefined = this._joints.get(jointId);
    if (joint === undefined) {
      return;
    }

    /* 过滤掉该墙体的所有连接 */
    joint.connections = joint.connections.filter(
      (c: WallConnection): boolean => c.wallId !== wallId
    );

    /* 空节点自动清理 */
    if (joint.connections.length === 0) {
      this._joints.delete(jointId);
    }
  }

  /* ========== Miter 偏移计算 ========== */

  /**
   * 计算指定墙体的 miter 偏移参数
   * 当墙体端点连接到一个节点且该节点连接了其他墙体时，
   * 根据交汇角度计算需要的端点偏移量
   *
   * 算法说明：
   * - 只处理两墙交汇（节点只有 2 个连接）的情况
   * - 计算两墙中心线在交汇点的夹角
   * - miter offset = thickness/2 * |tan(θ/2)|
   *   其中 θ 是两墙从交汇点出发方向的夹角
   *
   * @param wallId - 墙体 ID
   * @param wallStart - 该墙体的起点坐标
   * @param wallEnd - 该墙体的终点坐标
   * @param thickness - 该墙体的厚度
   * @param getWallEndpoints - 回调函数：根据 wallId 获取墙体的 start/end 坐标
   * @returns MiterParams（起点和终点的偏移量）
   */
  public computeMiterForWall(
    wallId: string,
    wallStart: Point2D,
    wallEnd: Point2D,
    thickness: number,
    getWallEndpoints: (id: string) => { start: Point2D; end: Point2D; thickness: number } | null
  ): MiterParams {
    /* 零偏移的默认值 */
    const noMiter: MiterEndParams = { frontOffset: 0, backOffset: 0 };

    const mapping = this._wallToJoints.get(wallId);
    if (mapping === undefined) {
      return { start: noMiter, end: noMiter };
    }

    /* 计算起点端的斜切参数 */
    const startMiter: MiterEndParams = mapping.start !== null
      ? this._computeEndpointMiter(
          mapping.start, wallId, 'start', wallStart, wallEnd, thickness, getWallEndpoints
        )
      : noMiter;

    /* 计算终点端的斜切参数 */
    const endMiter: MiterEndParams = mapping.end !== null
      ? this._computeEndpointMiter(
          mapping.end, wallId, 'end', wallStart, wallEnd, thickness, getWallEndpoints
        )
      : noMiter;

    return { start: startMiter, end: endMiter };
  }

  /**
   * 计算单个端点的确定性斜切偏移参数。
   *
   * 核心流程参照梁节点斜切：仅使用节点坐标、两条墙从节点向内的几何方向和当前墙厚度计算，
   * 不依赖绘制顺序；front/back 始终按当前墙 start -> end 的全局方向定义。
   *
   * @param jointId - 节点 ID
   * @param wallId - 当前墙 ID
   * @param endpoint - 当前端点类型
   * @param wallStart - 当前墙起点
   * @param wallEnd - 当前墙终点
   * @param thickness - 当前墙厚度
   * @param getWallEndpoints - 获取其他墙端点的回调
   * @returns MiterEndParams（前侧/后侧角点各自的偏移量）
   */
  private _computeEndpointMiter(
    jointId: string,
    wallId: string,
    endpoint: WallEndpoint,
    wallStart: Point2D,
    wallEnd: Point2D,
    thickness: number,
    getWallEndpoints: (id: string) => { start: Point2D; end: Point2D; thickness: number } | null
  ): MiterEndParams {
    const noMiter: MiterEndParams = { frontOffset: 0, backOffset: 0 };

    const joint: WallJoint | undefined = this._joints.get(jointId);
    if (joint === undefined) {
      return noMiter;
    }

    /* 节点上没有其他墙时不处理。 */
    if (joint.connections.length < 2) {
      return noMiter;
    }

    const jointPos: Point2D = joint.position;
    let myDirX: number;
    let myDirZ: number;
    if (endpoint === 'start') {
      /* 起点在节点上，向内方向 = 终点 - 节点。 */
      myDirX = wallEnd.x - jointPos.x;
      myDirZ = wallEnd.z - jointPos.z;
    } else {
      /* 终点在节点上，向内方向 = 起点 - 节点。 */
      myDirX = wallStart.x - jointPos.x;
      myDirZ = wallStart.z - jointPos.z;
    }

    const myLen: number = Math.sqrt(myDirX * myDirX + myDirZ * myDirZ);
    if (myLen < 0.001) {
      return noMiter;
    }
    const inwardDirX: number = myDirX / myLen;
    const inwardDirZ: number = myDirZ / myLen;

    /* front/back 法线必须与 WallGeometryBuilder 的 start -> end 全局方向保持一致。 */
    const globalDirX: number = endpoint === 'start' ? inwardDirX : -inwardDirX;
    const globalDirZ: number = endpoint === 'start' ? inwardDirZ : -inwardDirZ;
    const globalNormalX: number = -globalDirZ;
    const globalNormalZ: number = globalDirX;
    const halfThick: number = thickness / 2;

    /* 收集节点上有效的唯一相邻墙；多墙共节点暂不做猜测，避免过度切割。 */
    const connectedConnections: WallConnection[] = [];
    for (let connectionIndex: number = 0; connectionIndex < joint.connections.length; connectionIndex++) {
      const conn: WallConnection = joint.connections[connectionIndex]!;
      if (conn.wallId === wallId) {
        continue;
      }
      const otherData: { start: Point2D; end: Point2D; thickness: number } | null = getWallEndpoints(conn.wallId);
      if (otherData === null) {
        continue;
      }
      connectedConnections.push(conn);
    }
    if (connectedConnections.length !== 1) {
      return noMiter;
    }

    const otherConnection: WallConnection = connectedConnections[0]!;
    const otherData: { start: Point2D; end: Point2D; thickness: number } | null = getWallEndpoints(otherConnection.wallId);
    if (otherData === null) {
      return noMiter;
    }

    let otherDirX: number;
    let otherDirZ: number;
    if (otherConnection.endpoint === 'start') {
      otherDirX = otherData.end.x - jointPos.x;
      otherDirZ = otherData.end.z - jointPos.z;
    } else {
      otherDirX = otherData.start.x - jointPos.x;
      otherDirZ = otherData.start.z - jointPos.z;
    }

    const otherLen: number = Math.sqrt(otherDirX * otherDirX + otherDirZ * otherDirZ);
    if (otherLen < 0.001) {
      return noMiter;
    }

    const normalizedOtherDirX: number = otherDirX / otherLen;
    const normalizedOtherDirZ: number = otherDirZ / otherLen;
    const cross: number = inwardDirX * normalizedOtherDirZ - inwardDirZ * normalizedOtherDirX;
    if (Math.abs(cross) < 0.05) {
      return noMiter;
    }

    /* 使用两条节点射线的角平分线作为唯一斜切线，保证同节点双墙斜切结果确定。 */
    const seamDirX: number = inwardDirX + normalizedOtherDirX;
    const seamDirZ: number = inwardDirZ + normalizedOtherDirZ;
    const seamLen: number = Math.sqrt(seamDirX * seamDirX + seamDirZ * seamDirZ);
    if (seamLen < 0.001) {
      return noMiter;
    }

    const normalizedSeamDirX: number = seamDirX / seamLen;
    const normalizedSeamDirZ: number = seamDirZ / seamLen;
    const frontOffset: number | null = this._tryComputeLineIntersectionParameter(
      jointPos.x + globalNormalX * halfThick,
      jointPos.z + globalNormalZ * halfThick,
      inwardDirX,
      inwardDirZ,
      jointPos.x,
      jointPos.z,
      normalizedSeamDirX,
      normalizedSeamDirZ
    );
    const backOffset: number | null = this._tryComputeLineIntersectionParameter(
      jointPos.x - globalNormalX * halfThick,
      jointPos.z - globalNormalZ * halfThick,
      inwardDirX,
      inwardDirZ,
      jointPos.x,
      jointPos.z,
      normalizedSeamDirX,
      normalizedSeamDirZ
    );
    if (frontOffset === null || backOffset === null) {
      return noMiter;
    }

    const maxOffset: number = Math.min(myLen * 0.45, thickness * 2.5);
    if (Math.abs(frontOffset) > maxOffset || Math.abs(backOffset) > maxOffset) {
      return noMiter;
    }

    return { frontOffset: frontOffset, backOffset: backOffset };
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

  /* ========== 封闭环检测 ========== */

  /**
   * 从指定节点出发，检测是否存在封闭的墙体环路
   * 同时返回轮廓坐标数组和对应的墙体 ID 序列
   * wallIds[i] 表示从节点 i 到节点 i+1 的墙体 ID（环形，最后一段为节点 n-1 回到节点 0）
   *
   * @param startJointId - 起始节点 ID
   * @returns { outline: 节点坐标数组, wallIds: 对应墙体 ID 数组 }；未找到封闭环时返回 null
   */
  public detectClosedLoopWithWalls(
    startJointId: string
  ): { outline: Point2D[]; wallIds: string[] } | null {
    /* 起始节点不存在时直接返回 */
    const startJoint: WallJoint | undefined = this._joints.get(startJointId);
    if (startJoint === undefined) {
      return null;
    }

    /* DFS 路径：记录当前遍历路径上的节点 ID 序列 */
    const path: string[] = [];
    /* 路径上每段对应的墙体 ID（path[i] → path[i+1] 的墙体） */
    const pathWalls: string[] = [];
    /* 已访问节点集合（防止无限循环） */
    const visited: Set<string> = new Set<string>();

    /**
     * DFS 递归函数
     * @param currentJointId - 当前节点 ID
     * @param fromWallId - 来自哪条墙体（避免原路返回）
     * @returns 找到封闭环时返回 true
     */
    const dfs = (currentJointId: string, fromWallId: string | null): boolean => {
      path.push(currentJointId);
      visited.add(currentJointId);

      const currentJoint: WallJoint | undefined = this._joints.get(currentJointId);
      if (currentJoint === undefined) {
        path.pop();
        visited.delete(currentJointId);
        return false;
      }

      for (const conn of currentJoint.connections) {
        if (conn.wallId === fromWallId) {
          continue;
        }

        const wallMapping = this._wallToJoints.get(conn.wallId);
        if (wallMapping === undefined) {
          continue;
        }

        let otherJointId: string | null;
        if (conn.endpoint === 'start') {
          otherJointId = wallMapping.end;
        } else {
          otherJointId = wallMapping.start;
        }

        if (otherJointId === null) {
          continue;
        }

        /* 找到回到起始节点的路径 → 封闭环检测成功 */
        if (otherJointId === startJointId && path.length >= 3) {
          /* 记录最后一段墙体（回到起点的那段） */
          pathWalls.push(conn.wallId);
          return true;
        }

        if (!visited.has(otherJointId)) {
          /* 记录这段墙体 */
          pathWalls.push(conn.wallId);
          if (dfs(otherJointId, conn.wallId)) {
            return true;
          }
          /* 回溯时移除这段墙体 */
          pathWalls.pop();
        }
      }

      path.pop();
      visited.delete(currentJointId);
      return false;
    };

    const found: boolean = dfs(startJointId, null);

    if (!found) {
      return null;
    }

    /* 将路径上的节点 ID 转换为坐标数组 */
    const outline: Point2D[] = path.map((jointId: string): Point2D => {
      const joint: WallJoint = this._joints.get(jointId)!;
      return { x: joint.position.x, z: joint.position.z };
    });

    return { outline, wallIds: pathWalls };
  }

  /**
   * 从指定节点出发，检测是否存在封闭的墙体环路
   * 使用 DFS 图遍历，沿墙体连接边搜索回到起始节点的路径
   * 每条墙体边连接两个节点（start joint ↔ end joint），遍历时沿边跳转
   *
   * @param startJointId - 起始节点 ID（通常为新建墙体的某个端点节点）
   * @returns 封闭环路上所有节点的坐标数组（按顺序，可直接用作楼板轮廓）；
   *          未找到封闭环时返回 null
   */
  public detectClosedLoop(startJointId: string): Point2D[] | null {
    /* 起始节点不存在时直接返回 */
    const startJoint: WallJoint | undefined = this._joints.get(startJointId);
    if (startJoint === undefined) {
      return null;
    }

    /* DFS 路径：记录当前遍历路径上的节点 ID 序列 */
    const path: string[] = [];
    /* 已访问节点集合（防止无限循环） */
    const visited: Set<string> = new Set<string>();

    /**
     * DFS 递归函数
     * @param currentJointId - 当前节点 ID
     * @param fromWallId - 来自哪条墙体（避免原路返回）
     * @returns 找到封闭环时返回 true
     */
    const dfs = (currentJointId: string, fromWallId: string | null): boolean => {
      /* 将当前节点加入路径 */
      path.push(currentJointId);
      visited.add(currentJointId);

      /* 获取当前节点上的所有墙体连接 */
      const currentJoint: WallJoint | undefined = this._joints.get(currentJointId);
      if (currentJoint === undefined) {
        path.pop();
        visited.delete(currentJointId);
        return false;
      }

      /* 遍历当前节点上的每条墙体连接 */
      for (const conn of currentJoint.connections) {
        /* 跳过来时的那条墙体（避免原路返回） */
        if (conn.wallId === fromWallId) {
          continue;
        }

        /* 获取该墙体另一端的节点 ID */
        const wallMapping = this._wallToJoints.get(conn.wallId);
        if (wallMapping === undefined) {
          continue;
        }

        /* 根据当前节点是该墙体的 start 还是 end，找到另一端节点 */
        let otherJointId: string | null;
        if (conn.endpoint === 'start') {
          /* 当前节点是该墙体的 start，另一端是 end */
          otherJointId = wallMapping.end;
        } else {
          /* 当前节点是该墙体的 end，另一端是 start */
          otherJointId = wallMapping.start;
        }

        if (otherJointId === null) {
          continue;
        }

        /* 找到回到起始节点的路径 → 封闭环检测成功 */
        if (otherJointId === startJointId && path.length >= 3) {
          return true;
        }

        /* 未访问过的节点继续 DFS */
        if (!visited.has(otherJointId)) {
          if (dfs(otherJointId, conn.wallId)) {
            return true;
          }
        }
      }

      /* 当前路径无法形成封闭环，回溯 */
      path.pop();
      visited.delete(currentJointId);
      return false;
    };

    /* 从起始节点开始 DFS */
    const found: boolean = dfs(startJointId, null);

    if (!found) {
      return null;
    }

    /* 将路径上的节点 ID 转换为坐标数组 */
    const outline: Point2D[] = path.map((jointId: string): Point2D => {
      const joint: WallJoint = this._joints.get(jointId)!;
      return { x: joint.position.x, z: joint.position.z };
    });

    return outline;
  }

  /* ========== 差集检测 ========== */

  /**
   * 检测指定墙体（主墙）是否需要对其他墙体（次墙）做差集运算
   *
   * 场景：T 形连接中，次墙端点吸附到主墙端点，次墙已截断到主墙侧面，
   * 但主墙本身没有端点在该节点上（主墙"穿过"节点），导致主墙与次墙相交。
   * 此时需要从主墙几何中减去次墙占据的矩形区域。
   *
   * 判断条件：
   * - 节点上有 3 个及以上连接（T 形或十字形）
   * - 当前墙（主墙）的两个端点都不在该节点上（即主墙穿过该节点）
   *   → 实际上在当前架构中，主墙端点必须在节点上才能注册
   *   → 因此改为：检测节点上是否有次墙（端点在节点上）与主墙方向近似垂直
   *
   * 实际检测逻辑：
   * 遍历主墙两端节点，对每个节点上的其他墙（次墙），
   * 若次墙方向与主墙方向近似垂直（|sin(θ)| > 0.7），
   * 且次墙端点在主墙端点处（即次墙连接到主墙端点节点），
   * 则主墙端面已被截断，不需要差集。
   *
   * 真正需要差集的情况：
   * 主墙的某个端点节点上，有一面次墙的端点也在该节点，
   * 但次墙方向与主墙方向近似平行（|sin(θ)| < 0.3），
   * 说明次墙是从主墙端点"穿出"的，主墙端面被次墙穿透。
   *
   * 注意：当前架构中所有墙体都通过端点注册，不存在真正的"穿过"情况。
   * 差集主要用于：两墙端点重合（L 形），但由于 miter 截断不完整导致的穿插。
   *
   * @param wallId - 主墙 ID
   * @param wallStart - 主墙起点
   * @param wallEnd - 主墙终点
   * @param wallThickness - 主墙厚度
   * @param getWallEndpoints - 回调：获取墙体端点和厚度
   * @returns 需要从主墙中减去的矩形区域列表（在主墙局部坐标系中）
   */
  public detectSubtractions(
    wallId: string,
    wallStart: Point2D,
    wallEnd: Point2D,
    wallThickness: number,
    getWallEndpoints: (id: string) => { start: Point2D; end: Point2D; thickness: number } | null
  ): WallSubtractionRect[] {
    const mapping = this._wallToJoints.get(wallId);
    if (mapping === undefined) {
      return [];
    }

    /* 主墙方向向量（归一化） */
    const dxMain: number = wallEnd.x - wallStart.x;
    const dzMain: number = wallEnd.z - wallStart.z;
    const lenMain: number = Math.sqrt(dxMain * dxMain + dzMain * dzMain);
    if (lenMain < 0.001) {
      return [];
    }
    const mainDirX: number = dxMain / lenMain;
    const mainDirZ: number = dzMain / lenMain;

    const result: WallSubtractionRect[] = [];

    /* 遍历起点和终点节点 */
    const endpointEntries: Array<{ jointId: string | null; isStart: boolean }> = [
      { jointId: mapping.start, isStart: true },
      { jointId: mapping.end, isStart: false },
    ];

    for (const entry of endpointEntries) {
      if (entry.jointId === null) {
        continue;
      }

      const joint: WallJoint | undefined = this._joints.get(entry.jointId);
      if (joint === undefined) {
        continue;
      }

      /* 节点上只有 1 个连接（孤立端点），不需要差集 */
      if (joint.connections.length < 2) {
        continue;
      }

      /* 遍历节点上的其他墙（次墙） */
      for (const conn of joint.connections) {
        if (conn.wallId === wallId) {
          continue;
        }

        const otherData = getWallEndpoints(conn.wallId);
        if (otherData === null) {
          continue;
        }

        /* 次墙方向向量（从节点出发） */
        const jointPos: Point2D = joint.position;
        let otherDirX: number;
        let otherDirZ: number;
        if (conn.endpoint === 'start') {
          otherDirX = otherData.end.x - jointPos.x;
          otherDirZ = otherData.end.z - jointPos.z;
        } else {
          otherDirX = otherData.start.x - jointPos.x;
          otherDirZ = otherData.start.z - jointPos.z;
        }

        const otherLen: number = Math.sqrt(otherDirX * otherDirX + otherDirZ * otherDirZ);
        if (otherLen < 0.001) {
          continue;
        }
        otherDirX /= otherLen;
        otherDirZ /= otherLen;

        /* 计算两墙夹角 sin(θ) = |cross(main, other)| */
        const sinTheta: number = Math.abs(mainDirX * otherDirZ - mainDirZ * otherDirX);

        /*
         * 只对近似垂直的次墙做差集（sin(θ) > 0.7，即夹角 > 45°）
         * 近似平行的墙不需要差集（端面截断已处理）
         */
        if (sinTheta < 0.7) {
          continue;
        }

        /*
         * 差集矩形参数：
         * - 中心点 = 节点位置（次墙端点在主墙上的位置）
         * - halfWidth = 次墙厚度 / 2（沿主墙方向）
         * - halfDepth = 主墙厚度 / 2（沿主墙法线方向，贯穿整个主墙厚度）
         */
        result.push({
          centerX: jointPos.x,
          centerZ: jointPos.z,
          halfWidth: otherData.thickness / 2,
          halfDepth: wallThickness / 2,
          wallDirX: mainDirX,
          wallDirZ: mainDirZ,
        });
      }
    }

    return result;
  }

  /* ========== 清空和销毁 ========== */

  /**
   * 清空所有连接数据
   */
  public clear(): void {
    this._joints.clear();
    this._wallToJoints.clear();
  }

  /**
   * 销毁管理器
   */
  public dispose(): void {
    this.clear();
  }
}
