/**
 * 三维室内可见性控制器
 * 基于相机与建筑对象的空间关系，稳定控制遮挡室内视线的墙体与天花板显示状态。
 */

import * as THREE from 'three/webgpu';
import type { BuildingObject, CeilingData, Point2D, StraightWallData, WallData } from '../building/BuildingTypes';
import type { BuildingObjectManager } from '../building/BuildingObjectManager';

/**
 * 室内可见性控制配置
 */
export interface IndoorVisibilityOptions {
  /** @deprecated 旧版墙体中心投影阈值已不再作为隐藏依据，保留字段用于兼容外部配置 */
  sideThreshold: number;
  /** 是否让天花板作为独立对象参与剖切隐藏 */
  hideCeilings: boolean;
  /** 对象持续满足隐藏条件后延迟隐藏的毫秒数 */
  hideDelayMs: number;
  /** 对象持续不满足隐藏条件后延迟恢复显示的毫秒数 */
  showDelayMs: number;
  /** 屏幕中心采样网格尺寸，3 表示 3x3 采样 */
  sampleGridSize: number;
  /** 屏幕中心采样区域占 NDC 全屏宽高的比例，越小越关注视口中心 */
  centralRegionScale: number;
  /** 墙体至少获得多少条采样射线投票才允许隐藏 */
  wallHideVoteThreshold: number;
  /** 天花板至少获得多少条采样射线投票才允许隐藏 */
  ceilingHideVoteThreshold: number;
  /** 视线通道宽度（米），墙段离相机-目标线段过远时不隐藏 */
  corridorWidth: number;
  /** @deprecated 旧版墙体法线投影阈值已不再作为隐藏依据，保留字段用于兼容外部配置 */
  wallFacingDotThreshold: number;
  /** 外侧墙面隐藏触发角度，单位：度；观察方向越接近墙体房间内侧法线，越应隐藏该墙 */
  externalWallHideAngleDegrees: number;
  /** 单次最多隐藏的墙体数量，避免剖切范围过大导致空间边界丢失 */
  maxHiddenWalls: number;
  /** 室内漫游模式下，相机距离墙体小于该值时才允许近距离剖切 */
  indoorWallCutDistance: number;
  /** 是否允许隐藏被多个房间共用的墙体 */
  allowSharedWallHiding: boolean;
  /** 判断墙体被多个房间共用时的坐标匹配容差（米） */
  sharedWallMatchTolerance: number;
  /** 顶视模式下，相机高于天花板顶面的最小高度差 */
  topViewCeilingHeightOffset: number;
  /** 顶视模式下，相机世界方向 Y 分量阈值，小于该值表示明显向下看 */
  topViewCeilingDirectionY: number;
  /** 鸟瞰模式下，相机高于天花板顶面的最小高度差 */
  birdViewCeilingHeightOffset: number;
  /** 鸟瞰模式下，相机世界方向 Y 分量阈值，小于该值表示轻微向下看 */
  birdViewCeilingDirectionY: number;
}

/**
 * Object3D 原始状态快照
 */
interface ObjectSnapshot {
  /** 原始显示状态 */
  visible: boolean;
}

/** 屏幕采样点定义 */
interface ScreenSamplePoint {
  /** NDC X 坐标 */
  ndcX: number;
  /** NDC Y 坐标 */
  ndcY: number;
}

/** 房间区域定义，由天花板轮廓和关联墙体生成 */
interface RoomRegion {
  /** 房间 ID，当前使用天花板 ID */
  id: string;
  /** 房间世界坐标轮廓（XZ 平面） */
  outline: Point2D[];
  /** 围合该房间的墙体 ID 集合 */
  wallIds: Set<string>;
  /** 对应天花板数据 */
  ceiling: CeilingData;
}

/** 二维线段定义（XZ 平面） */
interface Segment2D {
  /** 起点 */
  start: Point2D;
  /** 终点 */
  end: Point2D;
}

/** 墙体剖切观察模式 */
type WallCutMode = 'exterior' | 'indoor';

/** 墙体隐藏候选项 */
interface WallHideCandidate {
  /** 墙体 ID */
  wallId: string;
  /** 墙体与相机 XZ 投影的最短距离 */
  distanceToCamera: number;
  /** 墙体是否被多个房间共用 */
  sharedWall: boolean;
  /** 候选项来源模式 */
  mode: WallCutMode;
}

/** 屏幕射线投票信息 */
interface ScreenHitVote {
  /** 命中票数 */
  voteCount: number;
  /** 命中候选对象的最近射线距离 */
  nearestDistance: number;
}

/** 屏幕采样射线命中结果 */
interface CandidateRayHit {
  /** 命中的建筑对象 ID */
  id: string;
  /** 射线命中距离 */
  distance: number;
}

/**
 * 三维室内可见性控制器
 *
 * 关键流程：
 * 1. 天花板作为独立对象参与室内剖切规则判断，避免 3D 环境下常驻隐藏。
 * 2. 仅封闭区域墙体参与剖切隐藏，开放墙段或孤立墙体永远显示。
 * 3. 根据对象中心与相机位置的确定性空间关系，隐藏靠近相机一侧的墙体或天花板。
 * 4. 绑定在隐藏墙体上的门窗模型同步隐藏，避免门窗孤立遮挡室内视线。
 * 5. 满足隐藏条件的对象先进入延迟队列，持续满足条件超过配置时间后才真正隐藏。
 * 6. 退出控制器时恢复所有被修改对象的原始 visible 状态。
 */
export class IndoorVisibilityController {
  /** 默认配置 */
  private static readonly DEFAULT_OPTIONS: IndoorVisibilityOptions = {
    sideThreshold: 0.15,
    hideCeilings: true,
    hideDelayMs: 120,
    showDelayMs: 180,
    sampleGridSize: 3,
    centralRegionScale: 0.55,
    wallHideVoteThreshold: 2,
    ceilingHideVoteThreshold: 2,
    corridorWidth: 0.8,
    wallFacingDotThreshold: 0.12,
    externalWallHideAngleDegrees: 75,
    maxHiddenWalls: 2,
    indoorWallCutDistance: 0.65,
    allowSharedWallHiding: false,
    sharedWallMatchTolerance: 0.08,
    topViewCeilingHeightOffset: 0.35,
    topViewCeilingDirectionY: -0.25,
    birdViewCeilingHeightOffset: 1.2,
    birdViewCeilingDirectionY: -0.12,
  };

  /** 当前相机引用 */
  private _camera: THREE.Camera | null = null;

  /** 当前场景引用 */
  private _scene: THREE.Scene | null = null;

  /** 建筑对象管理器引用 */
  private _objectManager: BuildingObjectManager | null = null;

  /** 当前配置 */
  private _options: IndoorVisibilityOptions = IndoorVisibilityController.DEFAULT_OPTIONS;

  /** 观察目标点（通常为 OrbitControls.target） */
  private _target: THREE.Vector3 = new THREE.Vector3(0, 0, 0);

  /** 多射线投票使用的射线投射器 */
  private _raycaster: THREE.Raycaster = new THREE.Raycaster();

  /** 已保存原始状态的对象快照 */
  private _snapshots: Map<THREE.Object3D, ObjectSnapshot> = new Map<THREE.Object3D, ObjectSnapshot>();

  /** 当前由本控制器隐藏的对象集合 */
  private _hiddenObjects: Set<THREE.Object3D> = new Set<THREE.Object3D>();

  /** 正在等待延迟隐藏的对象及开始满足隐藏条件的时间戳 */
  private _pendingHideStartedAt: Map<THREE.Object3D, number> = new Map<THREE.Object3D, number>();

  /** 正在等待延迟恢复显示的对象及开始不满足隐藏条件的时间戳 */
  private _pendingShowStartedAt: Map<THREE.Object3D, number> = new Map<THREE.Object3D, number>();

  /** 建筑对象变更监听注销函数 */
  private _unsubscribeObjectChange: (() => void) | null = null;

  /** 是否启用 */
  private _enabled: boolean = false;

  /**
   * 启用室内可见性控制
   * @param camera - 当前活动相机
   * @param scene - 当前 Three.js 场景
   * @param objectManager - 建筑对象管理器
   * @param options - 可选控制配置
   */
  public enable(
    camera: THREE.Camera,
    scene: THREE.Scene,
    objectManager: BuildingObjectManager,
    options?: Partial<IndoorVisibilityOptions>
  ): void {
    this.disable();

    this._camera = camera;
    this._scene = scene;
    this._objectManager = objectManager;
    this._options = {
      ...IndoorVisibilityController.DEFAULT_OPTIONS,
      ...options,
    };
    this._enabled = true;

    /* 建筑对象增删改后重新执行确定性可见性计算，避免新增墙体/天花板保持错误状态。 */
    this._unsubscribeObjectChange = objectManager.onChange((): void => {
      this.update();
    });

    this.update();
  }

  /**
   * 更新当前活动相机
   * @param camera - 最新活动相机
   */
  public updateCamera(camera: THREE.Camera): void {
    this._camera = camera;
  }

  /**
   * 更新观察目标点
   * @param target - OrbitControls 当前观察目标点
   */
  public updateTarget(target: THREE.Vector3): void {
    this._target.copy(target);
  }

  /**
   * 执行一帧室内可见性更新
   */
  public update(): void {
    if (!this._enabled || this._camera === null || this._scene === null || this._objectManager === null) {
      return;
    }

    const desiredHiddenObjects: Set<THREE.Object3D> = new Set<THREE.Object3D>();
    const roomRegions: RoomRegion[] = this._collectRoomRegions();
    if (roomRegions.length === 0) {
      this._applyVisibilityState(desiredHiddenObjects);
      return;
    }

    const desiredWallIds: Set<string> = new Set<string>();
    for (const roomRegion of roomRegions) {
      const roomWallIds: Set<string> = this._collectOccludingWallIds(roomRegion, roomRegions);
      for (const wallId of roomWallIds) {
        desiredWallIds.add(wallId);
      }
    }

    /* 所有封闭房间同时参与剖切判断，汇总后统一隐藏遮挡视线的墙体及其绑定门窗。 */
    for (const wallId of desiredWallIds) {
      const wallMesh: THREE.Mesh | undefined = this._objectManager.getMeshById(wallId);
      if (wallMesh !== undefined) {
        desiredHiddenObjects.add(wallMesh);
      }

      const attachedObjects: THREE.Object3D[] = this._findAttachedObjects(wallId);
      for (const attachedObject of attachedObjects) {
        desiredHiddenObjects.add(attachedObject);
      }
    }

    /* 天花板作为独立对象逐房间参与剖切判断，不与墙体隐藏状态关联。 */
    if (this._options.hideCeilings) {
      for (const roomRegion of roomRegions) {
        const ceilingMeshes: THREE.Mesh[] = this._collectOccludingCeilingMeshes(roomRegion);
        for (const ceilingMesh of ceilingMeshes) {
          desiredHiddenObjects.add(ceilingMesh);
        }
      }
    }

    this._applyVisibilityState(desiredHiddenObjects);
  }

  /**
   * 禁用控制器并恢复所有被修改对象
   */
  public disable(): void {
    if (this._unsubscribeObjectChange !== null) {
      this._unsubscribeObjectChange();
      this._unsubscribeObjectChange = null;
    }

    this._restoreAll();
    this._hiddenObjects.clear();
    this._pendingHideStartedAt.clear();
    this._pendingShowStartedAt.clear();
    this._camera = null;
    this._scene = null;
    this._objectManager = null;
    this._enabled = false;
  }

  /**
   * 销毁控制器
   */
  public dispose(): void {
    this.disable();
  }

  /**
   * 从天花板数据收集房间区域
   * @returns 房间区域列表
   */
  private _collectRoomRegions(): RoomRegion[] {
    const result: RoomRegion[] = [];
    if (this._objectManager === null) {
      return result;
    }

    /* 每个自动生成天花板都代表一个封闭房间，所有房间区域同时参与墙体和天花板遮挡判断。 */
    const ceilingObjects: BuildingObject[] = this._objectManager.getByCategory('ceiling');
    for (const ceilingObject of ceilingObjects) {
      const ceilingData: CeilingData = ceilingObject as CeilingData;
      if (ceilingData.outline.length < 3 || ceilingData.wallIds.length === 0) {
        continue;
      }

      const outline: Point2D[] = [];
      for (const point of ceilingData.outline) {
        const worldPoint: Point2D = {
          x: point.x + ceilingData.offsetX,
          z: point.z + ceilingData.offsetZ,
        };
        outline.push(worldPoint);
      }

      result.push({
        id: ceilingData.id,
        outline,
        wallIds: new Set<string>(ceilingData.wallIds),
        ceiling: ceilingData,
      });
    }

    return result;
  }

  /**
   * 收集指定房间中真正遮挡当前视线的墙体 ID
   * @param roomRegion - 当前参与遮挡判断的房间
   * @param roomRegions - 当前所有房间区域
   * @returns 需要隐藏的墙体 ID 集合
   */
  private _collectOccludingWallIds(roomRegion: RoomRegion, roomRegions: RoomRegion[]): Set<string> {
    const result: Set<string> = new Set<string>();
    const candidates: WallHideCandidate[] = this._collectSpatialCandidateWalls(roomRegion, roomRegions);
    if (candidates.length === 0) {
      return result;
    }

    const candidateWallIds: Set<string> = new Set<string>();
    for (const candidate of candidates) {
      candidateWallIds.add(candidate.wallId);
    }

    const voteMap: Map<string, ScreenHitVote> = this._collectScreenHitVotes(candidateWallIds);
    const eligibleCandidates: WallHideCandidate[] = [];
    for (const candidate of candidates) {
      /* 外部观察使用同视角成组剖切：只要墙体位于房间靠相机侧，就不再依赖屏幕中心射线投票。 */
      if (candidate.mode === 'exterior') {
        eligibleCandidates.push(candidate);
        continue;
      }

      const voteInfo: ScreenHitVote | undefined = voteMap.get(candidate.wallId);
      if (voteInfo === undefined || voteInfo.voteCount < this._options.wallHideVoteThreshold) {
        continue;
      }

      eligibleCandidates.push(candidate);
    }

    /* 先隐藏射线最近、距离相机最近的房间边界墙体，并限制数量，形成更稳定的剖切体验。 */
    eligibleCandidates.sort((first: WallHideCandidate, second: WallHideCandidate): number => {
      if (first.sharedWall !== second.sharedWall) {
        return first.sharedWall ? 1 : -1;
      }

      const firstVote: ScreenHitVote | undefined = voteMap.get(first.wallId);
      const secondVote: ScreenHitVote | undefined = voteMap.get(second.wallId);
      const firstHitDistance: number = firstVote === undefined ? Number.POSITIVE_INFINITY : firstVote.nearestDistance;
      const secondHitDistance: number = secondVote === undefined ? Number.POSITIVE_INFINITY : secondVote.nearestDistance;
      if (Math.abs(firstHitDistance - secondHitDistance) > 0.000001) {
        return firstHitDistance - secondHitDistance;
      }

      return first.distanceToCamera - second.distanceToCamera;
    });

    const maxHiddenWalls: number = Math.max(1, Math.floor(this._options.maxHiddenWalls));
    const selectedCount: number = Math.min(maxHiddenWalls, eligibleCandidates.length);
    for (let index: number = 0; index < selectedCount; index += 1) {
      const selectedCandidate: WallHideCandidate = eligibleCandidates[index]!;
      result.add(selectedCandidate.wallId);
    }

    return result;
  }

  /**
   * 通过房间语义、视线通道和墙体朝向收集候选墙体
   * @param roomRegion - 当前参与遮挡判断的房间
   * @param roomRegions - 当前所有房间区域
   * @returns 候选墙体列表
   */
  private _collectSpatialCandidateWalls(roomRegion: RoomRegion, roomRegions: RoomRegion[]): WallHideCandidate[] {
    const result: WallHideCandidate[] = [];
    if (this._camera === null || this._objectManager === null) {
      return result;
    }

    const cameraPoint: Point2D = {
      x: this._camera.position.x,
      z: this._camera.position.z,
    };
    const cameraInsideRoom: boolean = this._isPointInPolygon(cameraPoint, roomRegion.outline);

    const walls: BuildingObject[] = this._objectManager.getByCategory('wall');
    for (const wallObject of walls) {
      const wallData: WallData = wallObject as WallData;
      if (wallData.subType !== 'straight') {
        continue;
      }

      const straightWall: StraightWallData = wallData as StraightWallData;
      if (!roomRegion.wallIds.has(straightWall.id)) {
        continue;
      }

      const wallSegment: Segment2D = this._getStraightWallSegment(straightWall);
      const sharedWall: boolean = this._isSharedWall(straightWall, roomRegion, roomRegions);
      if (sharedWall && !this._options.allowSharedWallHiding) {
        continue;
      }

      const distanceToCamera: number = this._getPointToSegmentDistance(cameraPoint, wallSegment);
      let candidateMode: WallCutMode = 'exterior';

      if (cameraInsideRoom) {
        candidateMode = 'indoor';

        /* 室内漫游只剖切贴近相机的房间边界墙体，避免人在房间中央时墙面无故消失。 */
        if (distanceToCamera > this._options.indoorWallCutDistance) {
          continue;
        }
      } else {
        /* 外部观察时先按房间靠相机侧筛选，背墙和明显远离相机侧的墙体保持显示。 */
        if (!this._isWallOnCameraSideOfRoom(roomRegion, wallSegment, cameraPoint)) {
          continue;
        }

        /* 仅剖切靠近“相机到观察目标”视线通道的墙体，避免斜视角下侧墙被误判为遮挡墙。 */
        if (!this._isWallNearViewCorridor(wallSegment, cameraPoint)) {
          continue;
        }
      }

      /* 根据观察方向与墙体房间内侧法线的夹角判断外侧墙，侧墙和背墙保持显示。 */
      if (!this._isViewingWallExteriorSide(roomRegion, wallSegment)) {
        continue;
      }

      result.push({
        wallId: straightWall.id,
        distanceToCamera,
        sharedWall,
        mode: candidateMode,
      });
    }

    return result;
  }

  /**
   * 收集真正遮挡当前视线的天花板 Mesh
   * @param roomRegion - 当前参与遮挡判断的房间
   * @returns 需要隐藏的天花板 Mesh 列表
   */
  private _collectOccludingCeilingMeshes(roomRegion: RoomRegion): THREE.Mesh[] {
    const result: THREE.Mesh[] = [];
    if (this._camera === null || this._objectManager === null) {
      return result;
    }

    const ceilingData: CeilingData = roomRegion.ceiling;
    const ceilingTopY: number = ceilingData.bottomOffset + ceilingData.ceilingThickness + ceilingData.offsetY;
    const cameraDirection: THREE.Vector3 = new THREE.Vector3();
    this._camera.getWorldDirection(cameraDirection);
    const cameraAboveCeilingTop: boolean = this._camera.position.y > ceilingTopY + this._options.topViewCeilingHeightOffset;
    const isTopViewDirection: boolean = cameraDirection.y < this._options.topViewCeilingDirectionY;

    /* 明显从上方俯视户型时逐房间隐藏天花板，避免顶面遮挡房间内部布局。 */
    if (cameraAboveCeilingTop && isTopViewDirection) {
      const overheadCeilingMesh: THREE.Mesh | undefined = this._objectManager.getMeshById(ceilingData.id);
      if (overheadCeilingMesh !== undefined) {
        result.push(overheadCeilingMesh);
      }

      return result;
    }

    const cameraFarAboveCeilingTop: boolean = this._camera.position.y > ceilingTopY + this._options.birdViewCeilingHeightOffset;
    const isBirdViewDirection: boolean = cameraDirection.y < this._options.birdViewCeilingDirectionY;
    if (!cameraFarAboveCeilingTop && !isBirdViewDirection) {
      return result;
    }

    const candidateIds: Set<string> = new Set<string>([ceilingData.id]);
    const voteMap: Map<string, ScreenHitVote> = this._collectScreenHitVotes(candidateIds);
    const voteInfo: ScreenHitVote | undefined = voteMap.get(ceilingData.id);
    const voteCount: number = voteInfo === undefined ? 0 : voteInfo.voteCount;
    if (voteCount < this._options.ceilingHideVoteThreshold) {
      return result;
    }

    const ceilingMesh: THREE.Mesh | undefined = this._objectManager.getMeshById(ceilingData.id);
    if (ceilingMesh !== undefined) {
      result.push(ceilingMesh);
    }

    return result;
  }

  /**
   * 对屏幕中心区域执行多射线投票
   * @param candidateIds - 允许获得投票的建筑对象 ID 集合
   * @returns 建筑对象 ID 到投票信息的映射
   */
  private _collectScreenHitVotes(candidateIds: Set<string>): Map<string, ScreenHitVote> {
    const voteMap: Map<string, ScreenHitVote> = new Map<string, ScreenHitVote>();
    if (this._camera === null || this._scene === null || this._objectManager === null || candidateIds.size === 0) {
      return voteMap;
    }

    const samplePoints: ScreenSamplePoint[] = this._buildScreenSamplePoints();
    this._withHiddenObjectsTemporarilyVisible((): void => {
      for (const samplePoint of samplePoints) {
        const hit: CandidateRayHit | null = this._castCandidateRay(samplePoint, candidateIds);
        if (hit === null) {
          continue;
        }

        const currentVote: ScreenHitVote | undefined = voteMap.get(hit.id);
        if (currentVote === undefined) {
          voteMap.set(hit.id, {
            voteCount: 1,
            nearestDistance: hit.distance,
          });
          continue;
        }

        currentVote.voteCount += 1;
        currentVote.nearestDistance = Math.min(currentVote.nearestDistance, hit.distance);
      }
    });

    return voteMap;
  }

  /**
   * 构建屏幕中心区域采样点
   * @returns NDC 采样点列表
   */
  private _buildScreenSamplePoints(): ScreenSamplePoint[] {
    const result: ScreenSamplePoint[] = [];
    const gridSize: number = Math.max(1, Math.floor(this._options.sampleGridSize));
    const regionScale: number = Math.max(0.05, Math.min(1.8, this._options.centralRegionScale));

    if (gridSize === 1) {
      result.push({ ndcX: 0, ndcY: 0 });
      return result;
    }

    const start: number = -regionScale * 0.5;
    const step: number = regionScale / (gridSize - 1);
    for (let yIndex: number = 0; yIndex < gridSize; yIndex += 1) {
      for (let xIndex: number = 0; xIndex < gridSize; xIndex += 1) {
        result.push({
          ndcX: start + step * xIndex,
          ndcY: start + step * yIndex,
        });
      }
    }

    return result;
  }

  /**
   * 从指定屏幕采样点发射射线，返回第一个有效候选对象 ID
   * @param samplePoint - 屏幕采样点
   * @param candidateIds - 候选建筑对象 ID 集合
   * @returns 命中的候选对象和射线距离；没有命中时返回 null
   */
  private _castCandidateRay(samplePoint: ScreenSamplePoint, candidateIds: Set<string>): CandidateRayHit | null {
    if (this._camera === null || this._scene === null || this._objectManager === null) {
      return null;
    }

    this._raycaster.setFromCamera(new THREE.Vector2(samplePoint.ndcX, samplePoint.ndcY), this._camera);
    const intersections: THREE.Intersection[] = this._raycaster.intersectObjects(this._scene.children, true);
    for (const intersection of intersections) {
      const buildingObjectId: string | undefined = intersection.object.userData['buildingObjectId'] as string | undefined;
      if (buildingObjectId === undefined) {
        continue;
      }

      if (candidateIds.has(buildingObjectId)) {
        return {
          id: buildingObjectId,
          distance: intersection.distance,
        };
      }

      const buildingObject: BuildingObject | undefined = this._objectManager.getById(buildingObjectId);
      if (buildingObject !== undefined && (buildingObject.category === 'wall' || buildingObject.category === 'ceiling')) {
        return null;
      }
    }

    return null;
  }

  /**
   * 射线投票期间临时恢复本控制器隐藏的对象，确保上一帧隐藏对象仍可参与本帧遮挡判断
   * @param callback - 需要在临时可见状态下执行的逻辑
   */
  private _withHiddenObjectsTemporarilyVisible(callback: () => void): void {
    const hiddenObjects: THREE.Object3D[] = Array.from(this._hiddenObjects.values());
    for (const object of hiddenObjects) {
      object.visible = true;
    }

    try {
      callback();
    } finally {
      for (const object of hiddenObjects) {
        object.visible = false;
      }
    }
  }

  /**
   * 判断目标墙体是否被多个房间共享
   * @param wallData - 目标直墙数据
   * @param currentRoom - 当前参与共享墙判断的房间
   * @param roomRegions - 当前所有房间区域
   * @returns 被其他房间共用时返回 true
   */
  private _isSharedWall(wallData: StraightWallData, currentRoom: RoomRegion, roomRegions: RoomRegion[]): boolean {
    if (this._objectManager === null) {
      return false;
    }

    const wallSegment: Segment2D = this._getStraightWallSegment(wallData);
    for (const roomRegion of roomRegions) {
      if (roomRegion.id === currentRoom.id) {
        continue;
      }

      /* 优先使用 CeilingData.wallIds 判断共享墙；若墙体被复制成不同 ID，则退化为坐标线段匹配。 */
      if (roomRegion.wallIds.has(wallData.id)) {
        return true;
      }

      if (this._doesRoomContainEquivalentWall(roomRegion, wallSegment)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 判断房间是否包含与目标墙段几何等价的墙体
   * @param roomRegion - 待检测房间
   * @param targetSegment - 目标墙体线段
   * @returns 存在等价墙段时返回 true
   */
  private _doesRoomContainEquivalentWall(roomRegion: RoomRegion, targetSegment: Segment2D): boolean {
    if (this._objectManager === null) {
      return false;
    }

    for (const wallId of roomRegion.wallIds) {
      const buildingObject: BuildingObject | undefined = this._objectManager.getById(wallId);
      if (buildingObject === undefined || buildingObject.category !== 'wall') {
        continue;
      }

      const wallData: WallData = buildingObject as WallData;
      if (wallData.subType !== 'straight') {
        continue;
      }

      const straightWallData: StraightWallData = wallData as StraightWallData;
      const roomWallSegment: Segment2D = this._getStraightWallSegment(straightWallData);
      if (this._areSegmentsEquivalent(targetSegment, roomWallSegment, this._options.sharedWallMatchTolerance)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 判断两条墙体线段是否在容差范围内等价，支持端点顺序相反的情况
   * @param first - 第一条线段
   * @param second - 第二条线段
   * @param tolerance - 坐标匹配容差
   * @returns 两条线段等价时返回 true
   */
  private _areSegmentsEquivalent(first: Segment2D, second: Segment2D, tolerance: number): boolean {
    const sameDirection: boolean = this._getPointDistance(first.start, second.start) <= tolerance
      && this._getPointDistance(first.end, second.end) <= tolerance;
    if (sameDirection) {
      return true;
    }

    const reverseDirection: boolean = this._getPointDistance(first.start, second.end) <= tolerance
      && this._getPointDistance(first.end, second.start) <= tolerance;
    return reverseDirection;
  }

  /**
   * 判断点是否位于多边形内
   * @param point - 测试点
   * @param polygon - 多边形顶点
   * @returns 位于多边形内返回 true
   */
  private _isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
    let inside: boolean = false;
    for (let currentIndex: number = 0, previousIndex: number = polygon.length - 1; currentIndex < polygon.length; previousIndex = currentIndex, currentIndex += 1) {
      const currentPoint: Point2D = polygon[currentIndex]!;
      const previousPoint: Point2D = polygon[previousIndex]!;
      const intersects: boolean = (currentPoint.z > point.z) !== (previousPoint.z > point.z)
        && point.x < ((previousPoint.x - currentPoint.x) * (point.z - currentPoint.z)) / (previousPoint.z - currentPoint.z + Number.EPSILON) + currentPoint.x;
      if (intersects) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * 获取直墙中心线线段
   * @param wallData - 直墙数据
   * @returns 世界坐标线段
   */
  private _getStraightWallSegment(wallData: StraightWallData): Segment2D {
    return {
      start: {
        x: wallData.start.x + wallData.offsetX,
        z: wallData.start.z + wallData.offsetZ,
      },
      end: {
        x: wallData.end.x + wallData.offsetX,
        z: wallData.end.z + wallData.offsetZ,
      },
    };
  }

  /**
   * 获取线段中心点
   * @param segment - 目标线段
   * @returns 中心点
   */
  private _getSegmentCenter(segment: Segment2D): Point2D {
    return {
      x: (segment.start.x + segment.end.x) * 0.5,
      z: (segment.start.z + segment.end.z) * 0.5,
    };
  }

  /**
   * 获取房间轮廓面积形心
   * @param roomRegion - 当前房间区域
   * @returns 房间轮廓面积形心；轮廓退化时返回顶点平均中心
   */
  private _getRoomCenter(roomRegion: RoomRegion): Point2D {
    let signedAreaTwice: number = 0;
    let centroidXFactor: number = 0;
    let centroidZFactor: number = 0;
    for (let currentIndex: number = 0, previousIndex: number = roomRegion.outline.length - 1; currentIndex < roomRegion.outline.length; previousIndex = currentIndex, currentIndex += 1) {
      const previousPoint: Point2D = roomRegion.outline[previousIndex]!;
      const currentPoint: Point2D = roomRegion.outline[currentIndex]!;
      const crossValue: number = previousPoint.x * currentPoint.z - currentPoint.x * previousPoint.z;
      signedAreaTwice += crossValue;
      centroidXFactor += (previousPoint.x + currentPoint.x) * crossValue;
      centroidZFactor += (previousPoint.z + currentPoint.z) * crossValue;
    }

    /* 标准多边形面积形心计算，适配非矩形房间；面积过小时回退到顶点平均值，避免除零。 */
    if (Math.abs(signedAreaTwice) > 0.000001) {
      return {
        x: centroidXFactor / (3 * signedAreaTwice),
        z: centroidZFactor / (3 * signedAreaTwice),
      };
    }

    let sumX: number = 0;
    let sumZ: number = 0;
    for (const point of roomRegion.outline) {
      sumX += point.x;
      sumZ += point.z;
    }

    const pointCount: number = Math.max(1, roomRegion.outline.length);
    return {
      x: sumX / pointCount,
      z: sumZ / pointCount,
    };
  }

  /**
   * 判断墙体是否位于房间靠相机一侧
   * @param roomRegion - 当前房间区域
   * @param wallSegment - 目标墙体线段
   * @param cameraPoint - 相机 XZ 坐标
   * @returns 墙体位于房间靠相机侧时返回 true
   */
  private _isWallOnCameraSideOfRoom(roomRegion: RoomRegion, wallSegment: Segment2D, cameraPoint: Point2D): boolean {
    const roomCenter: Point2D = this._getRoomCenter(roomRegion);
    const wallCenter: Point2D = this._getSegmentCenter(wallSegment);
    const cameraDirectionX: number = cameraPoint.x - roomCenter.x;
    const cameraDirectionZ: number = cameraPoint.z - roomCenter.z;
    const cameraDirectionLength: number = Math.sqrt(cameraDirectionX * cameraDirectionX + cameraDirectionZ * cameraDirectionZ);
    if (cameraDirectionLength < 0.000001) {
      return false;
    }

    const normalizedCameraX: number = cameraDirectionX / cameraDirectionLength;
    const normalizedCameraZ: number = cameraDirectionZ / cameraDirectionLength;
    const wallDirectionX: number = wallCenter.x - roomCenter.x;
    const wallDirectionZ: number = wallCenter.z - roomCenter.z;
    const projectionToCameraSide: number = wallDirectionX * normalizedCameraX + wallDirectionZ * normalizedCameraZ;

    /* 只有墙体中心投影到相机方向的一侧时才剖切，背墙和大多数侧墙保持显示。 */
    return projectionToCameraSide > 0;
  }

  /**
   * 判断墙体是否靠近当前观察视线通道
   * @param wallSegment - 目标墙体线段
   * @param cameraPoint - 相机 XZ 坐标
   * @returns 墙体中段进入视线通道时返回 true
   */
  private _isWallNearViewCorridor(wallSegment: Segment2D, cameraPoint: Point2D): boolean {
    const targetPoint: Point2D = {
      x: this._target.x,
      z: this._target.z,
    };
    const viewSegment: Segment2D = {
      start: cameraPoint,
      end: targetPoint,
    };
    const viewSegmentLength: number = this._getPointDistance(viewSegment.start, viewSegment.end);
    if (viewSegmentLength < 0.000001) {
      return true;
    }

    const wallMiddleSegment: Segment2D = this._getSegmentPortion(wallSegment, 0.15, 0.85);
    const distanceToViewCorridor: number = this._getSegmentToSegmentDistance(wallMiddleSegment, viewSegment);
    const corridorWidth: number = Math.max(0.05, this._options.corridorWidth);

    /* 使用墙体中段与视线通道判断：正面长墙可被命中，只有墙角靠近视线的侧墙不会被整面隐藏。 */
    return distanceToViewCorridor <= corridorWidth;
  }

  /**
   * 获取线段的局部片段
   * @param segment - 原始线段
   * @param startRatio - 局部起点比例，范围 0 到 1
   * @param endRatio - 局部终点比例，范围 0 到 1
   * @returns 按比例截取后的线段
   */
  private _getSegmentPortion(segment: Segment2D, startRatio: number, endRatio: number): Segment2D {
    const clampedStartRatio: number = Math.max(0, Math.min(1, startRatio));
    const clampedEndRatio: number = Math.max(0, Math.min(1, endRatio));
    return {
      start: this._interpolatePointOnSegment(segment, clampedStartRatio),
      end: this._interpolatePointOnSegment(segment, clampedEndRatio),
    };
  }

  /**
   * 按比例获取线段上的插值点
   * @param segment - 目标线段
   * @param ratio - 插值比例，范围 0 到 1
   * @returns 插值后的点
   */
  private _interpolatePointOnSegment(segment: Segment2D, ratio: number): Point2D {
    return {
      x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
      z: segment.start.z + (segment.end.z - segment.start.z) * ratio,
    };
  }

  /**
   * 判断当前观察方向是否正在从外侧看向目标墙面
   * @param roomRegion - 当前房间区域
   * @param wallSegment - 墙体线段
   * @returns 观察方向与墙体房间内侧法线夹角满足隐藏阈值时返回 true
   */
  private _isViewingWallExteriorSide(roomRegion: RoomRegion, wallSegment: Segment2D): boolean {
    if (this._camera === null) {
      return false;
    }

    const interiorNormal: Point2D | null = this._createWallInteriorNormal(roomRegion, wallSegment);
    if (interiorNormal === null) {
      return false;
    }

    const cameraDirection: THREE.Vector3 = new THREE.Vector3();
    this._camera.getWorldDirection(cameraDirection);
    const viewDirectionLength: number = Math.sqrt(cameraDirection.x * cameraDirection.x + cameraDirection.z * cameraDirection.z);
    if (viewDirectionLength < 0.000001) {
      return false;
    }

    const normalizedViewX: number = cameraDirection.x / viewDirectionLength;
    const normalizedViewZ: number = cameraDirection.z / viewDirectionLength;
    const dotToInteriorNormal: number = normalizedViewX * interiorNormal.x + normalizedViewZ * interiorNormal.z;
    const clampedAngleDegrees: number = Math.max(1, Math.min(89, this._options.externalWallHideAngleDegrees));
    const angleThresholdCos: number = Math.cos((clampedAngleDegrees * Math.PI) / 180);

    /* 观察方向接近房间内侧法线，表示相机从墙外侧看向房间内部，此时隐藏该外侧墙面。 */
    return dotToInteriorNormal >= angleThresholdCos;
  }

  /**
   * 计算目标墙体指向房间内部的墙面法线
   * @param roomRegion - 当前房间区域
   * @param wallSegment - 墙体线段
   * @returns 指向房间内部的单位法线；墙体退化时返回 null
   */
  private _createWallInteriorNormal(roomRegion: RoomRegion, wallSegment: Segment2D): Point2D | null {
    const wallDirectionX: number = wallSegment.end.x - wallSegment.start.x;
    const wallDirectionZ: number = wallSegment.end.z - wallSegment.start.z;
    const wallLength: number = Math.sqrt(wallDirectionX * wallDirectionX + wallDirectionZ * wallDirectionZ);
    if (wallLength < 0.000001) {
      return null;
    }

    const normalX: number = -wallDirectionZ / wallLength;
    const normalZ: number = wallDirectionX / wallLength;
    const wallCenter: Point2D = this._getSegmentCenter(wallSegment);
    const roomCenter: Point2D = this._getRoomCenter(roomRegion);
    const wallToRoomCenterX: number = roomCenter.x - wallCenter.x;
    const wallToRoomCenterZ: number = roomCenter.z - wallCenter.z;
    const positiveDot: number = normalX * wallToRoomCenterX + normalZ * wallToRoomCenterZ;

    /* 每面墙先生成垂直于墙线的法线，再选择朝向房间面积形心的一侧作为房间内侧法线。 */
    if (positiveDot >= 0) {
      return { x: normalX, z: normalZ };
    }

    return { x: -normalX, z: -normalZ };
  }

  /**
   * 获取点到线段的最短距离
   * @param point - 目标点
   * @param segment - 目标线段
   * @returns 最短距离
   */
  private _getPointToSegmentDistance(point: Point2D, segment: Segment2D): number {
    const segmentX: number = segment.end.x - segment.start.x;
    const segmentZ: number = segment.end.z - segment.start.z;
    const lengthSq: number = segmentX * segmentX + segmentZ * segmentZ;
    if (lengthSq < 0.000001) {
      return this._getPointDistance(point, segment.start);
    }

    const pointX: number = point.x - segment.start.x;
    const pointZ: number = point.z - segment.start.z;
    const ratio: number = Math.max(0, Math.min(1, (pointX * segmentX + pointZ * segmentZ) / lengthSq));
    const projectedPoint: Point2D = {
      x: segment.start.x + ratio * segmentX,
      z: segment.start.z + ratio * segmentZ,
    };

    return this._getPointDistance(point, projectedPoint);
  }

  /**
   * 获取两条线段之间的最短距离
   * @param first - 第一条线段
   * @param second - 第二条线段
   * @returns 两条线段相交时返回 0，否则返回端点到对方线段的最短距离
   */
  private _getSegmentToSegmentDistance(first: Segment2D, second: Segment2D): number {
    if (this._doSegmentsIntersect(first, second)) {
      return 0;
    }

    const firstStartDistance: number = this._getPointToSegmentDistance(first.start, second);
    const firstEndDistance: number = this._getPointToSegmentDistance(first.end, second);
    const secondStartDistance: number = this._getPointToSegmentDistance(second.start, first);
    const secondEndDistance: number = this._getPointToSegmentDistance(second.end, first);
    return Math.min(firstStartDistance, firstEndDistance, secondStartDistance, secondEndDistance);
  }

  /**
   * 判断两条二维线段是否相交
   * @param first - 第一条线段
   * @param second - 第二条线段
   * @returns 两条线段相交或端点重合时返回 true
   */
  private _doSegmentsIntersect(first: Segment2D, second: Segment2D): boolean {
    const firstStartOrientation: number = this._getOrientationValue(first.start, first.end, second.start);
    const firstEndOrientation: number = this._getOrientationValue(first.start, first.end, second.end);
    const secondStartOrientation: number = this._getOrientationValue(second.start, second.end, first.start);
    const secondEndOrientation: number = this._getOrientationValue(second.start, second.end, first.end);
    const tolerance: number = 0.000001;

    /* 常规相交：两条线段的端点分别位于对方线段两侧。 */
    if (firstStartOrientation * firstEndOrientation < -tolerance && secondStartOrientation * secondEndOrientation < -tolerance) {
      return true;
    }

    /* 共线或端点贴合时，使用包围盒判断端点是否落在线段范围内。 */
    if (Math.abs(firstStartOrientation) <= tolerance && this._isPointOnSegment(second.start, first, tolerance)) {
      return true;
    }

    if (Math.abs(firstEndOrientation) <= tolerance && this._isPointOnSegment(second.end, first, tolerance)) {
      return true;
    }

    if (Math.abs(secondStartOrientation) <= tolerance && this._isPointOnSegment(first.start, second, tolerance)) {
      return true;
    }

    if (Math.abs(secondEndOrientation) <= tolerance && this._isPointOnSegment(first.end, second, tolerance)) {
      return true;
    }

    return false;
  }

  /**
   * 获取三点方向值
   * @param first - 方向起点
   * @param second - 方向终点
   * @param point - 待判断点
   * @returns 大于 0 表示一侧，小于 0 表示另一侧，接近 0 表示共线
   */
  private _getOrientationValue(first: Point2D, second: Point2D, point: Point2D): number {
    return (second.x - first.x) * (point.z - first.z) - (second.z - first.z) * (point.x - first.x);
  }

  /**
   * 判断点是否位于线段包围范围内
   * @param point - 待判断点
   * @param segment - 目标线段
   * @param tolerance - 坐标容差
   * @returns 点落在线段范围内时返回 true
   */
  private _isPointOnSegment(point: Point2D, segment: Segment2D, tolerance: number): boolean {
    const minX: number = Math.min(segment.start.x, segment.end.x) - tolerance;
    const maxX: number = Math.max(segment.start.x, segment.end.x) + tolerance;
    const minZ: number = Math.min(segment.start.z, segment.end.z) - tolerance;
    const maxZ: number = Math.max(segment.start.z, segment.end.z) + tolerance;
    return point.x >= minX && point.x <= maxX && point.z >= minZ && point.z <= maxZ;
  }

  /**
   * 获取两点距离
   * @param first - 第一个点
   * @param second - 第二个点
   * @returns 距离
   */
  private _getPointDistance(first: Point2D, second: Point2D): number {
    const diffX: number = first.x - second.x;
    const diffZ: number = first.z - second.z;
    return Math.sqrt(diffX * diffX + diffZ * diffZ);
  }

  /**
   * 应用期望显隐状态，并恢复不再需要处理的对象
   * @param desiredHiddenObjects - 本帧应隐藏的对象集合
   */
  private _applyVisibilityState(desiredHiddenObjects: Set<THREE.Object3D>): void {
    const affectedObjects: Set<THREE.Object3D> = new Set<THREE.Object3D>(Array.from(this._hiddenObjects.values()));
    const pendingObjects: THREE.Object3D[] = Array.from(this._pendingHideStartedAt.keys());
    for (const pendingObject of pendingObjects) {
      affectedObjects.add(pendingObject);
    }

    const nowMs: number = Date.now();

    /* 对本帧不再满足隐藏条件的对象启动恢复显示滞回，避免视角临界时墙体和天花板快速闪烁。 */
    for (const object of affectedObjects) {
      if (desiredHiddenObjects.has(object)) {
        this._pendingShowStartedAt.delete(object);
        continue;
      }

      this._pendingHideStartedAt.delete(object);
      if (!this._hiddenObjects.has(object)) {
        this._pendingShowStartedAt.delete(object);
        continue;
      }

      const pendingStartedAt: number | undefined = this._pendingShowStartedAt.get(object);
      if (pendingStartedAt === undefined) {
        this._pendingShowStartedAt.set(object, nowMs);
        if (this._options.showDelayMs > 0) {
          continue;
        }
      }

      const effectiveStartedAt: number = pendingStartedAt === undefined ? nowMs : pendingStartedAt;
      const elapsedMs: number = nowMs - effectiveStartedAt;
      if (elapsedMs >= this._options.showDelayMs) {
        this._restoreObject(object);
        this._hiddenObjects.delete(object);
        this._pendingShowStartedAt.delete(object);
      }
    }

    for (const object of desiredHiddenObjects) {
      this._pendingShowStartedAt.delete(object);
      if (this._hiddenObjects.has(object)) {
        continue;
      }

      const pendingStartedAt: number | undefined = this._pendingHideStartedAt.get(object);
      if (pendingStartedAt === undefined) {
        this._pendingHideStartedAt.set(object, nowMs);
        if (this._options.hideDelayMs > 0) {
          continue;
        }
      }

      const effectiveStartedAt: number = pendingStartedAt === undefined ? nowMs : pendingStartedAt;
      const elapsedMs: number = nowMs - effectiveStartedAt;
      if (elapsedMs >= this._options.hideDelayMs) {
        this._hideObject(object);
        this._hiddenObjects.add(object);
        this._pendingHideStartedAt.delete(object);
      }
    }
  }

  /**
   * 隐藏对象
   * @param object - 目标对象
   */
  private _hideObject(object: THREE.Object3D): void {
    this._ensureSnapshot(object);
    object.visible = false;
  }

  /**
   * 确保对象原始状态已保存
   * @param object - 目标对象
   */
  private _ensureSnapshot(object: THREE.Object3D): void {
    if (this._snapshots.has(object)) {
      return;
    }

    this._snapshots.set(object, {
      visible: object.visible,
    });
  }

  /**
   * 恢复单个对象的原始状态
   * @param object - 目标对象
   */
  private _restoreObject(object: THREE.Object3D): void {
    const snapshot: ObjectSnapshot | undefined = this._snapshots.get(object);
    if (snapshot === undefined) {
      return;
    }

    object.visible = snapshot.visible;

    this._snapshots.delete(object);
  }

  /**
   * 恢复所有受控对象
   */
  private _restoreAll(): void {
    const objects: THREE.Object3D[] = Array.from(this._snapshots.keys());
    for (const object of objects) {
      this._restoreObject(object);
    }
  }

  /**
   * 查找吸附到指定墙体的门窗或 STL 构件
   * @param wallId - 墙体 ID
   * @returns 绑定到墙体的对象列表
   */
  private _findAttachedObjects(wallId: string): THREE.Object3D[] {
    if (this._scene === null) {
      return [];
    }

    const result: THREE.Object3D[] = [];
    this._scene.traverse((object: THREE.Object3D): void => {
      const attachedWallId: string | undefined = object.userData['wallId'] as string | undefined;
      if (attachedWallId === wallId) {
        result.push(object);
      }
    });

    return result;
  }
}