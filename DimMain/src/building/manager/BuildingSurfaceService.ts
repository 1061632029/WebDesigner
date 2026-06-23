/**
 * 建筑水平面对象领域服务。
 * 负责楼板、天花板的创建、封闭环自动生成、轮廓冲孔、墙体绑定同步与渲染实例创建。
 */

import * as THREE from 'three/webgpu';
import type {
  ArcWallData,
  BuildingObject,
  CeilingData,
  MaterialProperties,
  Point2D,
  SlabBoundaryDimensionSegment,
  SlabData,
  SlabInnerOutlineBinding,
  StraightWallData,
  WallData,
} from '../BuildingTypes';
import { CEILING_DEFAULTS, SLAB_DEFAULTS, getDefaultMaterial } from '../BuildingTypes';
import { CeilingGeometryBuilder } from '../CeilingGeometryBuilder';
import { IdGenerator } from '../IdGenerator';
import { SlabContourPuncher } from '../SlabContourPuncher';
import type { SlabPunchResult } from '../SlabContourPuncher';
import { SlabGeometryBuilder } from '../SlabGeometryBuilder';
import { WallConnectionManager } from '../WallConnectionManager';
import { WallLoopBoundaryBuilder } from '../WallLoopBoundaryBuilder';
import type { SceneManager } from '../../scene/SceneManager';
import { BuildingMeshFactory } from './BuildingMeshFactory';

/** 楼板/天花板自动生成签名缓存快照。 */
export interface GeneratedSurfaceSignatureSnapshot {
  /** 已生成楼板的封闭环签名列表。 */
  slabSignatures: string[];
  /** 已生成天花板的封闭环签名列表。 */
  ceilingSignatures: string[];
}

/** 待刷新水平面的封闭空间候选。 */
interface SurfaceLoopCandidate {
  /** 封闭环规范签名，用于跨节点去重。 */
  signature: string;
  /** 墙中心线围成的封闭轮廓。 */
  outline: Point2D[];
  /** 围合该封闭轮廓的墙体 ID 列表。 */
  wallIds: string[];
  /** XZ 平面轮廓面积，用于排除包含小空间的外层大空间。 */
  area: number;
}

/** 水平面服务回调集合，用于隔离主管理器的通用场景与通知能力。 */
export interface BuildingSurfaceServiceCallbacks {
  /** 根据材质属性创建 Three.js 材质。 */
  createMaterialFromProperties: (props: MaterialProperties) => THREE.Material;
  /** 为楼板/天花板创建边缘线框。 */
  createSurfaceEdgeWireframe: (geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation) => THREE.Object3D | null;
  /** 计算并写回对象包围盒。 */
  computeAndStoreBoundingBox: (data: BuildingObject, mesh: THREE.Mesh) => void;
  /** 从场景中移除指定对象 Mesh。 */
  removeMeshFromScene: (objectId: string) => void;
  /** 按最新直墙数据重建墙体 Mesh。 */
  createWallMesh: (wallData: StraightWallData) => void;
  /** 通知对象变更。 */
  notify: (objectId: string, action: 'add' | 'remove' | 'update') => void;
  /** 刷新连接线显示。 */
  refreshConnectionLines: () => void;
  /** 删除指定对象。 */
  removeObject: (objectId: string) => boolean;
}

/** 建筑水平面对象领域服务。 */
export class BuildingSurfaceService {
  /** 所有建筑对象的纯数据集合。 */
  private readonly _objects: Map<string, BuildingObject>;

  /** 所有建筑对象的渲染实例集合。 */
  private readonly _meshes: Map<string, THREE.Mesh>;

  /** 场景管理器引用。 */
  private readonly _sceneManager: SceneManager;

  /** 墙体连接管理器。 */
  private readonly _connectionManager: WallConnectionManager;

  /** 楼板几何构建器。 */
  private readonly _slabBuilder: SlabGeometryBuilder;

  /** 天花板几何构建器。 */
  private readonly _ceilingBuilder: CeilingGeometryBuilder;

  /** 通用场景与通知回调。 */
  private readonly _callbacks: BuildingSurfaceServiceCallbacks;

  /** 楼板计数器（用于自动命名）。 */
  private _slabCount: number = 0;

  /** 已生成楼板的封闭环签名集合。 */
  private _generatedSlabSignatures: Set<string> = new Set<string>();

  /** 天花板计数器（用于自动命名）。 */
  private _ceilingCount: number = 0;

  /** 已生成天花板的封闭环签名集合。 */
  private _generatedCeilingSignatures: Set<string> = new Set<string>();

  /**
   * @param objects - 建筑对象数据集合。
   * @param meshes - 建筑对象 Mesh 集合。
   * @param sceneManager - 场景管理器。
   * @param connectionManager - 墙体连接管理器。
   * @param slabBuilder - 楼板几何构建器。
   * @param ceilingBuilder - 天花板几何构建器。
   * @param callbacks - 主管理器提供的通用场景与通知能力。
   */
  public constructor(
    objects: Map<string, BuildingObject>,
    meshes: Map<string, THREE.Mesh>,
    sceneManager: SceneManager,
    connectionManager: WallConnectionManager,
    slabBuilder: SlabGeometryBuilder,
    ceilingBuilder: CeilingGeometryBuilder,
    callbacks: BuildingSurfaceServiceCallbacks
  ) {
    this._objects = objects;
    this._meshes = meshes;
    this._sceneManager = sceneManager;
    this._connectionManager = connectionManager;
    this._slabBuilder = slabBuilder;
    this._ceilingBuilder = ceilingBuilder;
    this._callbacks = callbacks;
  }

  /**
   * 获取楼板/天花板自动生成签名快照。
   * @returns 当前签名缓存快照。
   */
  public getGeneratedSurfaceSignatureSnapshot(): GeneratedSurfaceSignatureSnapshot {
    return {
      slabSignatures: Array.from(this._generatedSlabSignatures.values()),
      ceilingSignatures: Array.from(this._generatedCeilingSignatures.values()),
    };
  }

  /**
   * 恢复楼板/天花板自动生成签名快照。
   * @param snapshot - 需要恢复的签名缓存快照。
   */
  public restoreGeneratedSurfaceSignatureSnapshot(snapshot: GeneratedSurfaceSignatureSnapshot): void {
    /* 撤销/重做流程会直接增删楼板与天花板对象，因此必须同步恢复去重缓存，避免重复自动生成。 */
    this._generatedSlabSignatures = new Set<string>(snapshot.slabSignatures);
    this._generatedCeilingSignatures = new Set<string>(snapshot.ceilingSignatures);
  }

  /** 清空楼板/天花板自动生成签名缓存。 */
  public clearGeneratedSurfaceSignatures(): void {
    this._generatedSlabSignatures.clear();
    this._generatedCeilingSignatures.clear();
  }

  /**
   * 创建楼板。
   * @param outline - XZ 平面多边形顶点数组（至少 3 个点）。
   * @param slabThickness - 楼板厚度（米）。
   * @param wallIds - 关联墙体 ID 列表。
   * @param boundaryDimensionSegments - 楼板边界标注段。
   * @param innerOutlines - 楼板内部洞口轮廓。
   * @returns 新建的楼板 ID。
   */
  public createSlab(
    outline: Point2D[],
    slabThickness: number = SLAB_DEFAULTS.slabThickness,
    wallIds: string[] = [],
    boundaryDimensionSegments: SlabBoundaryDimensionSegment[] = this.createFallbackBoundaryDimensionSegments(outline),
    innerOutlines: Point2D[][] = []
  ): string {
    this._applySlabPunchingForNewOutline(outline, wallIds);

    this._slabCount += 1;
    const id: string = IdGenerator.generate('slab');
    const data: SlabData = {
      id: id,
      category: 'slab',
      name: `楼板-${this._slabCount}`,
      visible: true,
      locked: false,
      height: slabThickness,
      elevation: 0,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      material: getDefaultMaterial('slab'),
      outline: outline,
      innerOutlines: innerOutlines.map((innerOutline: Point2D[]): Point2D[] => this._clonePointOutline(innerOutline)),
      innerOutlineBindings: [],
      wallIds: wallIds.slice(),
      boundaryDimensionSegments: boundaryDimensionSegments,
      slabThickness: slabThickness,
      topOffset: SLAB_DEFAULTS.topOffset,
      boundingBox: {
        min: { x: Number.MAX_SAFE_INTEGER, z: Number.MAX_SAFE_INTEGER },
        max: { x: Number.MIN_SAFE_INTEGER, z: Number.MIN_SAFE_INTEGER },
        center: { x: 0, z: 0 },
        size: { x: 0, y: 0, z: 0 },
      },
    };

    /* 楼板创建流程：直接写入数据并创建渲染实例，避免通过 addObject 重复触发封闭环检测。 */
    this._objects.set(id, data);
    this.createSlabMesh(data);
    if (wallIds.length > 0) {
      this.syncWallsToSlab(id, wallIds);
    }
    this._callbacks.refreshConnectionLines();
    this._callbacks.notify(id, 'add');

    console.log(`[BuildingSurfaceService] 楼板已自动生成: id=${id}, 顶点数=${outline.length}, 厚度=${slabThickness * 1000}mm`);
    return id;
  }

  /**
   * 创建天花板。
   * @param outline - XZ 平面多边形顶点数组。
   * @param ceilingThickness - 天花板厚度（米）。
   * @param bottomOffset - 天花板底面高度（米）。
   * @param wallIds - 关联墙体 ID 列表。
   * @returns 新建的天花板 ID。
   */
  public createCeiling(
    outline: Point2D[],
    ceilingThickness: number = CEILING_DEFAULTS.ceilingThickness,
    bottomOffset: number = CEILING_DEFAULTS.bottomOffset,
    wallIds: string[] = []
  ): string {
    this._ceilingCount += 1;
    const id: string = IdGenerator.generate('ceiling');
    const data: CeilingData = {
      id: id,
      category: 'ceiling',
      name: `天花板-${this._ceilingCount}`,
      visible: true,
      locked: false,
      height: ceilingThickness,
      elevation: bottomOffset,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      material: getDefaultMaterial('ceiling'),
      outline: outline,
      ceilingThickness: ceilingThickness,
      bottomOffset: bottomOffset,
      wallIds: wallIds.slice(),
      boundingBox: {
        min: { x: Number.MAX_SAFE_INTEGER, z: Number.MAX_SAFE_INTEGER },
        max: { x: Number.MIN_SAFE_INTEGER, z: Number.MIN_SAFE_INTEGER },
        center: { x: 0, z: 0 },
        size: { x: 0, y: 0, z: 0 },
      },
    };

    /* 天花板创建流程：直接写入数据并同步墙体高度，避免通过 updateObject 形成递归。 */
    this._objects.set(id, data);
    this.createCeilingMesh(data);
    if (wallIds.length > 0) {
      this.syncWallsToCeiling(id, wallIds, bottomOffset);
    }
    this._callbacks.refreshConnectionLines();
    this._callbacks.notify(id, 'add');

    console.log(
      `[BuildingSurfaceService] 天花板已自动生成: id=${id}, 顶点数=${outline.length},`,
      `厚度=${ceilingThickness * 1000}mm, 底面高度=${bottomOffset * 1000}mm,`,
      `关联墙体数=${wallIds.length}`
    );
    return id;
  }

  /**
   * 创建楼板 Mesh 并加入场景。
   * @param data - 楼板数据。
   */
  public createSlabMesh(data: SlabData): void {
    const mesh: THREE.Mesh = BuildingMeshFactory.createSlabMesh(data, {
      slabBuilder: this._slabBuilder,
      createMaterial: (props: MaterialProperties): THREE.Material => this._callbacks.createMaterialFromProperties(props),
      createSurfaceEdgeWireframe: (geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.Object3D | null =>
        this._callbacks.createSurfaceEdgeWireframe(geometry, color),
    });

    this._sceneManager.add(mesh);
    this._meshes.set(data.id, mesh);
    this._callbacks.computeAndStoreBoundingBox(data, mesh);
  }

  /**
   * 创建天花板 Mesh 并加入场景。
   * @param data - 天花板数据。
   */
  public createCeilingMesh(data: CeilingData): void {
    const mesh: THREE.Mesh = BuildingMeshFactory.createCeilingMesh(data, {
      ceilingBuilder: this._ceilingBuilder,
      createMaterial: (props: MaterialProperties): THREE.Material => this._callbacks.createMaterialFromProperties(props),
      createSurfaceEdgeWireframe: (geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.Object3D | null =>
        this._callbacks.createSurfaceEdgeWireframe(geometry, color),
    });

    this._sceneManager.add(mesh);
    this._meshes.set(data.id, mesh);
    this._callbacks.computeAndStoreBoundingBox(data, mesh);
  }

  /**
   * 尝试根据指定墙体自动生成楼板和天花板。
   * @param wallId - 触发检测的墙体 ID。
   */
  public tryAutoGenerateSlab(wallId: string): void {
    const joints: { start: string | null; end: string | null } = this._connectionManager.getWallJoints(wallId);
    const jointIds: Array<string | null> = [joints.start, joints.end];

    for (const jointId of jointIds) {
      if (jointId === null) {
        continue;
      }

      const loopResults: Array<{ outline: Point2D[]; wallIds: string[] }> = this._connectionManager.detectMinimalClosedLoopsWithWalls(jointId);
      for (const loopResult of loopResults) {
        if (loopResult.outline.length < 3) {
          continue;
        }

        const signature: string = this.computeOutlineSignature(loopResult.outline);
        if (this._generatedSlabSignatures.has(signature)) {
          continue;
        }

        /* 自动生成流程：按最小封闭区域生成独立空间，再同步创建楼板与天花板关系。 */
        const innerOutline: Point2D[] = this.convertOutlineToInnerBoundary(loopResult.outline, loopResult.wallIds);
        const boundaryDimensionSegments: SlabBoundaryDimensionSegment[] = this.createBoundaryDimensionSegments(
          innerOutline,
          loopResult.wallIds
        );

        this._generatedSlabSignatures.add(signature);
        this.createSlab(innerOutline, SLAB_DEFAULTS.slabThickness, loopResult.wallIds, boundaryDimensionSegments);
        this._tryAutoGenerateCeiling(signature, innerOutline, loopResult.wallIds);
      }
    }
  }

  /**
   * 墙体拖拽完成后刷新相关封闭区域的楼板、天花板和标注数据。
   * @param wallIds - 本次拖拽直接或间接受影响的墙体 ID 列表。
   */
  public refreshClosedSurfacesForWalls(wallIds: string[]): void {
    const candidateMap: Map<string, SurfaceLoopCandidate> = new Map<string, SurfaceLoopCandidate>();

    /* 收集流程：先跨全部受影响墙体收集候选闭环，再做全局最小空间筛选，避免局部节点检测生成外层大楼板。 */
    for (const wallId of wallIds) {
      const joints: { start: string | null; end: string | null } = this._connectionManager.getWallJoints(wallId);
      const jointIds: Array<string | null> = [joints.start, joints.end];

      for (const jointId of jointIds) {
        if (jointId === null) {
          continue;
        }

        const loopResults: Array<{ outline: Point2D[]; wallIds: string[] }> = this._connectionManager.detectMinimalClosedLoopsWithWalls(jointId);
        for (const loopResult of loopResults) {
          if (loopResult.outline.length < 3) {
            continue;
          }

          const signature: string = this.computeOutlineSignature(loopResult.outline);
          if (candidateMap.has(signature)) {
            continue;
          }

          candidateMap.set(signature, {
            signature: signature,
            outline: loopResult.outline,
            wallIds: loopResult.wallIds,
            area: BuildingSurfaceService._computePolygonArea(loopResult.outline),
          });
        }
      }
    }

    const allCandidates: SurfaceLoopCandidate[] = Array.from(candidateMap.values());
    const minimalCandidates: SurfaceLoopCandidate[] = BuildingSurfaceService._selectMinimalSurfaceLoopCandidates(allCandidates);
    for (const minimalCandidate of minimalCandidates) {
      this._refreshClosedSurfaceFromLoop(minimalCandidate.signature, minimalCandidate.outline, minimalCandidate.wallIds);
    }

    this._rebindWallsToCurrentSurfaces();
  }

  /**
   * 从全局候选闭环中筛选真正最小的封闭空间。
   * @param candidates - 跨所有受影响节点收集到的候选闭环。
   * @returns 排除外层大闭环后的最小封闭空间候选。
   */
  private static _selectMinimalSurfaceLoopCandidates(candidates: SurfaceLoopCandidate[]): SurfaceLoopCandidate[] {
    const minimalCandidates: SurfaceLoopCandidate[] = [];
    const areaTolerance: number = 0.000001;

    for (const candidate of candidates) {
      let containsSmallerCandidate: boolean = false;
      for (const otherCandidate of candidates) {
        if (otherCandidate === candidate || otherCandidate.area >= candidate.area - areaTolerance) {
          continue;
        }

        if (BuildingSurfaceService._isOutlineInsideOrOnPolygon(otherCandidate.outline, candidate.outline)) {
          containsSmallerCandidate = true;
          break;
        }
      }

      if (!containsSmallerCandidate) {
        minimalCandidates.push(candidate);
      }
    }

    return minimalCandidates;
  }

  /**
   * 判断一个轮廓是否整体位于另一个多边形内部或边界上。
   * @param outline - 待判断的轮廓点集。
   * @param polygon - 作为容器的多边形点集。
   * @returns 全部点都在容器多边形内部或边界上时返回 true。
   */
  private static _isOutlineInsideOrOnPolygon(outline: Point2D[], polygon: Point2D[]): boolean {
    for (const point of outline) {
      if (!BuildingSurfaceService._isPointInsideOrOnPolygon(point, polygon)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 判断点是否位于多边形内部或边界上。
   * @param point - 待判断点。
   * @param polygon - 多边形轮廓。
   * @returns 点在多边形内部或边界上时返回 true。
   */
  private static _isPointInsideOrOnPolygon(point: Point2D, polygon: Point2D[]): boolean {
    let isInside: boolean = false;
    const count: number = polygon.length;

    for (let index: number = 0, previousIndex: number = count - 1; index < count; previousIndex = index, index += 1) {
      const current: Point2D = polygon[index]!;
      const previous: Point2D = polygon[previousIndex]!;

      if (BuildingSurfaceService._isPointOnSegment(point, previous, current)) {
        return true;
      }

      const crossesRay: boolean = (current.z > point.z) !== (previous.z > point.z);
      if (!crossesRay) {
        continue;
      }

      const intersectionX: number = ((previous.x - current.x) * (point.z - current.z)) / (previous.z - current.z) + current.x;
      if (point.x < intersectionX) {
        isInside = !isInside;
      }
    }

    return isInside;
  }

  /**
   * 判断点是否位于指定线段上。
   * @param point - 待判断点。
   * @param segmentStart - 线段起点。
   * @param segmentEnd - 线段终点。
   * @returns 点在线段容差范围内时返回 true。
   */
  private static _isPointOnSegment(point: Point2D, segmentStart: Point2D, segmentEnd: Point2D): boolean {
    const tolerance: number = 0.000001;
    const cross: number =
      (point.z - segmentStart.z) * (segmentEnd.x - segmentStart.x) -
      (point.x - segmentStart.x) * (segmentEnd.z - segmentStart.z);
    if (Math.abs(cross) > tolerance) {
      return false;
    }

    const minX: number = Math.min(segmentStart.x, segmentEnd.x) - tolerance;
    const maxX: number = Math.max(segmentStart.x, segmentEnd.x) + tolerance;
    const minZ: number = Math.min(segmentStart.z, segmentEnd.z) - tolerance;
    const maxZ: number = Math.max(segmentStart.z, segmentEnd.z) + tolerance;
    return point.x >= minX && point.x <= maxX && point.z >= minZ && point.z <= maxZ;
  }

  /**
   * 计算 XZ 平面多边形面积。
   * @param outline - 多边形顶点数组，首尾不重复。
   * @returns 多边形绝对面积。
   */
  private static _computePolygonArea(outline: Point2D[]): number {
    if (outline.length < 3) {
      return 0;
    }

    let signedArea: number = 0;
    for (let index: number = 0; index < outline.length; index += 1) {
      const current: Point2D = outline[index]!;
      const next: Point2D = outline[(index + 1) % outline.length]!;
      signedArea += current.x * next.z - next.x * current.z;
    }

    return Math.abs(signedArea) / 2;
  }

  /**
   * 将指定墙体列表的 slabId 写回。
   * @param slabId - 楼板 ID。
   * @param wallIds - 围合该楼板的墙体 ID 列表。
   */
  public syncWallsToSlab(slabId: string, wallIds: string[]): void {
    for (const wallId of wallIds) {
      const wallObject: BuildingObject | undefined = this._objects.get(wallId);
      if (wallObject === undefined || wallObject.category !== 'wall') {
        continue;
      }
      const wallData: WallData = wallObject as WallData;
      if (wallData.subType !== 'straight') {
        continue;
      }
      const straightWall: StraightWallData = wallData as StraightWallData;
      const nextSlabIds: string[] = this._appendUniqueId(straightWall.slabIds, slabId);
      straightWall.slabIds = nextSlabIds;
      straightWall.slabId = nextSlabIds.length > 0 ? nextSlabIds[0]! : null;
      this._callbacks.notify(wallId, 'update');
    }
  }

  /**
   * 从所有直墙中解除指定楼板绑定。
   * @param slabId - 需要解除绑定的楼板 ID。
   * @param excludedWallIds - 需要跳过解绑的墙体 ID 集合；用于即将删除的旧墙，避免无意义字段更新。
   */
  public unlinkSlabFromWalls(slabId: string, excludedWallIds: ReadonlySet<string> | null = null): void {
    for (const objectData of this._objects.values()) {
      if (objectData.category !== 'wall') {
        continue;
      }

      if (excludedWallIds !== null && excludedWallIds.has(objectData.id)) {
        /* 跳过流程：旧墙随后会被删除，不需要再清理其楼板绑定字段。 */
        continue;
      }

      const wallData: WallData = objectData as WallData;
      if (wallData.subType !== 'straight') {
        continue;
      }

      const straightWall: StraightWallData = wallData as StraightWallData;
      const nextSlabIds: string[] = this._removeId(straightWall.slabIds, slabId);
      const legacySlabMatched: boolean = straightWall.slabId === slabId;
      if (!legacySlabMatched && nextSlabIds.length === (Array.isArray(straightWall.slabIds) ? straightWall.slabIds.length : 0)) {
        continue;
      }

      /* 解绑流程：优先维护多楼板列表，再用首个 ID 回填兼容字段，保证共享墙仍保留其它房间楼板引用。 */
      straightWall.slabIds = nextSlabIds;
      straightWall.slabId = nextSlabIds.length > 0 ? nextSlabIds[0]! : null;
      this._callbacks.notify(straightWall.id, 'update');
    }
  }

  /**
   * 将指定墙体列表的 ceilingId 写回，并同步墙高为天花板底面高度。
   * @param ceilingId - 天花板 ID。
   * @param wallIds - 关联的墙体 ID 列表。
   * @param newHeight - 新的墙高。
   */
  public syncWallsToCeiling(ceilingId: string, wallIds: string[], newHeight: number): void {
    for (const wallId of wallIds) {
      const obj: BuildingObject | undefined = this._objects.get(wallId);
      if (obj === undefined || obj.category !== 'wall') {
        continue;
      }
      const wallData: WallData = obj as WallData;
      if (wallData.subType !== 'straight') {
        continue;
      }

      const straightWall: StraightWallData = wallData as StraightWallData;
      const nextCeilingIds: string[] = this._appendUniqueId(straightWall.ceilingIds, ceilingId);
      straightWall.ceilingIds = nextCeilingIds;
      straightWall.ceilingId = nextCeilingIds.length > 0 ? nextCeilingIds[0]! : null;
      straightWall.height = newHeight;
      this._callbacks.removeMeshFromScene(wallId);
      this._callbacks.createWallMesh(straightWall);
      this._callbacks.notify(wallId, 'update');
    }
  }

  /**
   * 按当前楼板和天花板数据重建所有直墙的空间绑定关系。
   * 关键流程：空间分割后旧墙可能残留已失效的 slabIds/ceilingIds，先清空再按现有空间重新写回。
   */
  private _rebindWallsToCurrentSurfaces(): void {
    for (const objectData of this._objects.values()) {
      if (objectData.category !== 'wall') {
        continue;
      }

      const wallData: WallData = objectData as WallData;
      if (wallData.subType !== 'straight') {
        continue;
      }

      const straightWall: StraightWallData = wallData as StraightWallData;
      straightWall.slabIds = [];
      straightWall.slabId = null;
      straightWall.ceilingIds = [];
      straightWall.ceilingId = null;
    }

    for (const objectData of this._objects.values()) {
      if (objectData.category === 'slab') {
        const slabData: SlabData = objectData as SlabData;
        this.syncWallsToSlab(slabData.id, slabData.wallIds);
        continue;
      }

      if (objectData.category === 'ceiling') {
        const ceilingData: CeilingData = objectData as CeilingData;
        this.syncWallsToCeiling(ceilingData.id, ceilingData.wallIds, ceilingData.bottomOffset);
      }
    }
  }

  /**
   * 从所有直墙中解除指定天花板绑定。
   * @param ceilingId - 需要解除绑定的天花板 ID。
   * @param excludedWallIds - 需要跳过解绑的墙体 ID 集合；用于即将删除的旧墙，避免无意义字段更新。
   */
  public unlinkCeilingFromWalls(ceilingId: string, excludedWallIds: ReadonlySet<string> | null = null): void {
    for (const objectData of this._objects.values()) {
      if (objectData.category !== 'wall') {
        continue;
      }

      if (excludedWallIds !== null && excludedWallIds.has(objectData.id)) {
        /* 跳过流程：旧墙随后会被删除，不需要再清理其天花板绑定字段。 */
        continue;
      }

      const wallData: WallData = objectData as WallData;
      if (wallData.subType !== 'straight') {
        continue;
      }

      const straightWall: StraightWallData = wallData as StraightWallData;
      const nextCeilingIds: string[] = this._removeId(straightWall.ceilingIds, ceilingId);
      const legacyCeilingMatched: boolean = straightWall.ceilingId === ceilingId;
      if (!legacyCeilingMatched && nextCeilingIds.length === (Array.isArray(straightWall.ceilingIds) ? straightWall.ceilingIds.length : 0)) {
        continue;
      }

      /* 解绑流程：优先维护多天花板列表，再用首个 ID 回填兼容字段，保证共享墙仍保留其它房间天花板引用。 */
      straightWall.ceilingIds = nextCeilingIds;
      straightWall.ceilingId = nextCeilingIds.length > 0 ? nextCeilingIds[0]! : null;
      this._callbacks.notify(straightWall.id, 'update');
    }
  }

  /**
   * 根据楼板净轮廓与墙体顺序创建边界长度标注段。
   * @param innerOutline - 楼板室内净轮廓点，首尾不重复。
   * @param wallIds - 围合楼板的墙体 ID 列表。
   * @returns 可直接用于楼板边界标注的结构化标注段。
   */
  public createBoundaryDimensionSegments(innerOutline: Point2D[], wallIds: string[]): SlabBoundaryDimensionSegment[] {
    const wallCount: number = wallIds.length;
    const outlineCount: number = innerOutline.length;
    if (outlineCount < 2 || wallCount === 0) {
      return this.createFallbackBoundaryDimensionSegments(innerOutline);
    }

    const boundaryDimensionSegments: SlabBoundaryDimensionSegment[] = [];
    let outlineIndex: number = 0;
    for (let wallIndex: number = 0; wallIndex < wallCount; wallIndex += 1) {
      const wallId: string = wallIds[wallIndex]!;
      const wallObject: BuildingObject | undefined = this._objects.get(wallId);
      const wallData: WallData | null = wallObject !== undefined && wallObject.category === 'wall'
        ? wallObject as WallData
        : null;
      const sourceType: 'straight' | 'arc' | 'fallback' = wallData !== null && wallData.subType === 'arc'
        ? 'arc'
        : wallData !== null
          ? 'straight'
          : 'fallback';
      const segmentCount: number = this._getWallBoundarySegmentCount(wallData);
      const start: Point2D = innerOutline[outlineIndex % outlineCount]!;
      const endIndex: number = (outlineIndex + segmentCount) % outlineCount;
      const end: Point2D = innerOutline[endIndex]!;

      if (!this._arePointsClose2D(start, end)) {
        /* 弧形墙只保留弧段起终点形成的弦线，保证标注显示起点到终点的长度。 */
        boundaryDimensionSegments.push({
          start: { x: start.x, z: start.z },
          end: { x: end.x, z: end.z },
          wallId: wallId,
          sourceType: sourceType,
        });
      }

      outlineIndex += segmentCount;
    }

    if (boundaryDimensionSegments.length === 0) {
      return this.createFallbackBoundaryDimensionSegments(innerOutline);
    }
    return boundaryDimensionSegments;
  }

  /**
   * 为缺少墙体关联的楼板创建逐边兜底标注段。
   * @param outline - 楼板轮廓点，首尾不重复。
   * @returns 与轮廓边一一对应的标注段。
   */
  public createFallbackBoundaryDimensionSegments(outline: Point2D[]): SlabBoundaryDimensionSegment[] {
    const boundaryDimensionSegments: SlabBoundaryDimensionSegment[] = [];
    const count: number = outline.length;
    if (count < 2) {
      return boundaryDimensionSegments;
    }

    for (let index: number = 0; index < count; index += 1) {
      const start: Point2D = outline[index]!;
      const end: Point2D = outline[(index + 1) % count]!;
      if (this._arePointsClose2D(start, end)) {
        /* 退化边不生成标注，避免显示 0mm 噪声。 */
        continue;
      }
      boundaryDimensionSegments.push({
        start: { x: start.x, z: start.z },
        end: { x: end.x, z: end.z },
        wallId: null,
        sourceType: 'fallback',
      });
    }
    return boundaryDimensionSegments;
  }

  /**
   * 将中心线节点轮廓还原为室内净轮廓。
   * @param centerOutline - 中心线节点坐标数组。
   * @param wallIds - 对应的墙体 ID 数组。
   * @returns 室内净边界角点坐标数组。
   */
  public convertOutlineToInnerBoundary(centerOutline: Point2D[], wallIds: string[]): Point2D[] {
    return WallLoopBoundaryBuilder.buildInnerBoundary(
      centerOutline,
      wallIds,
      (wallId: string): BuildingObject | undefined => this._objects.get(wallId)
    );
  }

  /**
   * 计算多边形轮廓的唯一签名。
   * @param outline - 多边形顶点数组。
   * @returns 签名字符串。
   */
  public computeOutlineSignature(outline: Point2D[]): string {
    const pointStrings: string[] = outline.map((pt: Point2D): string => `${pt.x.toFixed(3)},${pt.z.toFixed(3)}`);
    pointStrings.sort();
    return pointStrings.join('|');
  }

  /**
   * 对新生成楼板轮廓与既有楼板执行冲孔/裁剪。
   * @param newOutline - 即将创建的楼板净轮廓。
   * @param newWallIds - 即将创建楼板绑定的墙体 ID。
   */
  private _applySlabPunchingForNewOutline(newOutline: Point2D[], newWallIds: string[]): void {
    if (newOutline.length < 3) {
      return;
    }

    const existingSlabs: SlabData[] = [];
    this._objects.forEach((objectData: BuildingObject): void => {
      if (objectData.category !== 'slab') {
        return;
      }

      const slabData: SlabData = objectData as SlabData;
      if (this._areWallIdSetsEqual(slabData.wallIds, new Set<string>(newWallIds))) {
        return;
      }

      existingSlabs.push(slabData);
    });

    /* 冲孔流程：完全包含时追加内洞，多边形相交时扣除相交区域并重绘。 */
    for (const slabData of existingSlabs) {
      const punchResult: SlabPunchResult = SlabContourPuncher.punch(slabData.outline, newOutline);
      if (punchResult.relation === 'none') {
        continue;
      }

      if (punchResult.relation === 'contained' && punchResult.innerOutline !== null) {
        if (this._doesOutlineShareBoundarySegment(slabData.outline, punchResult.innerOutline)) {
          this._removeSurfacePairForBoundarySplit(slabData);
          continue;
        }

        this._appendSlabInnerOutline(slabData, punchResult.innerOutline, newWallIds);
        continue;
      }

      this._replaceSlabWithRemainingOutlines(slabData, punchResult.remainingOutlines);
    }
  }

  /**
   * 移除被边界分割命中的原楼板及对应天花板，为后续最小闭环重新生成独立表面做准备。
   * @param slabData - 被新封闭空间沿边界切分的原楼板。
   */
  private _removeSurfacePairForBoundarySplit(slabData: SlabData): void {
    const relatedCeilingIds: string[] = this._collectCeilingIdsForSurfaceRebuild(slabData);

    /* 重组流程：边界共线代表房间分割而不是楼板洞口，先删除父表面，后续闭环会重新创建子表面。 */
    this.unlinkSlabFromWalls(slabData.id);
    this._callbacks.removeMeshFromScene(slabData.id);
    this._objects.delete(slabData.id);
    this._callbacks.notify(slabData.id, 'remove');

    for (const ceilingId of relatedCeilingIds) {
      this.unlinkCeilingFromWalls(ceilingId);
      this._callbacks.removeMeshFromScene(ceilingId);
      this._objects.delete(ceilingId);
      this._callbacks.notify(ceilingId, 'remove');
    }
  }

  /**
   * 收集与原楼板同属一个封闭空间的天花板 ID。
   * @param slabData - 作为匹配依据的原楼板数据。
   * @returns 需要随原楼板一起重组删除的天花板 ID 列表。
   */
  private _collectCeilingIdsForSurfaceRebuild(slabData: SlabData): string[] {
    const ceilingIds: string[] = [];
    const slabWallIdSet: Set<string> = new Set<string>(slabData.wallIds);

    for (const objectData of this._objects.values()) {
      if (objectData.category !== 'ceiling') {
        continue;
      }

      const ceilingData: CeilingData = objectData as CeilingData;
      const usesSameWalls: boolean = this._areWallIdSetsEqual(ceilingData.wallIds, slabWallIdSet);
      const usesSameOutline: boolean = this._arePointOutlinesEqual(ceilingData.outline, slabData.outline);
      if (usesSameWalls || usesSameOutline) {
        ceilingIds.push(ceilingData.id);
      }
    }

    return ceilingIds;
  }

  /**
   * 判断内部轮廓是否与外部轮廓共享一段有效边界。
   * @param outerOutline - 原楼板外轮廓。
   * @param innerOutline - 新封闭空间净轮廓。
   * @returns 存在共线且长度有效的重合边界时返回 true。
   */
  private _doesOutlineShareBoundarySegment(outerOutline: Point2D[], innerOutline: Point2D[]): boolean {
    const tolerance: number = 0.000001;

    for (let outerIndex: number = 0; outerIndex < outerOutline.length; outerIndex += 1) {
      const outerStart: Point2D = outerOutline[outerIndex]!;
      const outerEnd: Point2D = outerOutline[(outerIndex + 1) % outerOutline.length]!;

      for (let innerIndex: number = 0; innerIndex < innerOutline.length; innerIndex += 1) {
        const innerStart: Point2D = innerOutline[innerIndex]!;
        const innerEnd: Point2D = innerOutline[(innerIndex + 1) % innerOutline.length]!;
        const overlapLength: number = this._computeCollinearSegmentOverlapLength(outerStart, outerEnd, innerStart, innerEnd);
        if (overlapLength > tolerance) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 计算两条共线线段的重合长度；非共线或仅端点接触时返回 0。
   * @param firstStart - 第一条线段起点。
   * @param firstEnd - 第一条线段终点。
   * @param secondStart - 第二条线段起点。
   * @param secondEnd - 第二条线段终点。
   * @returns 两条线段在 XZ 平面上的重合长度。
   */
  private _computeCollinearSegmentOverlapLength(
    firstStart: Point2D,
    firstEnd: Point2D,
    secondStart: Point2D,
    secondEnd: Point2D
  ): number {
    const tolerance: number = 0.000001;
    const firstVectorX: number = firstEnd.x - firstStart.x;
    const firstVectorZ: number = firstEnd.z - firstStart.z;
    const firstLength: number = Math.sqrt(firstVectorX * firstVectorX + firstVectorZ * firstVectorZ);
    if (firstLength <= tolerance) {
      return 0;
    }

    const secondStartOffsetX: number = secondStart.x - firstStart.x;
    const secondStartOffsetZ: number = secondStart.z - firstStart.z;
    const secondEndOffsetX: number = secondEnd.x - firstStart.x;
    const secondEndOffsetZ: number = secondEnd.z - firstStart.z;
    const firstToSecondStartCross: number = this._computeCross2D(firstVectorX, firstVectorZ, secondStartOffsetX, secondStartOffsetZ);
    const firstToSecondEndCross: number = this._computeCross2D(firstVectorX, firstVectorZ, secondEndOffsetX, secondEndOffsetZ);
    if (Math.abs(firstToSecondStartCross) > tolerance || Math.abs(firstToSecondEndCross) > tolerance) {
      return 0;
    }

    const axisX: number = firstVectorX / firstLength;
    const axisZ: number = firstVectorZ / firstLength;
    const secondStartProjection: number = secondStartOffsetX * axisX + secondStartOffsetZ * axisZ;
    const secondEndProjection: number = secondEndOffsetX * axisX + secondEndOffsetZ * axisZ;
    const overlapStart: number = Math.max(0, Math.min(secondStartProjection, secondEndProjection));
    const overlapEnd: number = Math.min(firstLength, Math.max(secondStartProjection, secondEndProjection));
    return Math.max(0, overlapEnd - overlapStart);
  }

  /**
   * 计算二维向量叉积。
   * @param firstX - 第一向量 X 分量。
   * @param firstZ - 第一向量 Z 分量。
   * @param secondX - 第二向量 X 分量。
   * @param secondZ - 第二向量 Z 分量。
   * @returns XZ 平面叉积标量。
   */
  private _computeCross2D(firstX: number, firstZ: number, secondX: number, secondZ: number): number {
    return firstX * secondZ - firstZ * secondX;
  }

  /**
   * 给父楼板追加内轮廓洞口并刷新渲染对象。
   * @param slabData - 需要冲孔的父楼板。
   * @param innerOutline - 子空间净轮廓。
   * @param wallIds - 围合该洞口的子空间墙体 ID 列表。
   */
  private _appendSlabInnerOutline(slabData: SlabData, innerOutline: Point2D[], wallIds: string[]): void {
    const innerOutlines: Point2D[][] = Array.isArray(slabData.innerOutlines) ? slabData.innerOutlines : [];
    const innerOutlineBindings: SlabInnerOutlineBinding[] = Array.isArray(slabData.innerOutlineBindings)
      ? slabData.innerOutlineBindings
      : [];
    for (const existingInnerOutline of innerOutlines) {
      if (this._arePointOutlinesEqual(existingInnerOutline, innerOutline)) {
        this._upsertSlabInnerOutlineBinding(innerOutlineBindings, innerOutline, wallIds);
        slabData.innerOutlineBindings = innerOutlineBindings;
        this.syncWallsToSlab(slabData.id, wallIds);
        return;
      }
    }

    innerOutlines.push(this._clonePointOutline(innerOutline));
    slabData.innerOutlines = innerOutlines;
    this._upsertSlabInnerOutlineBinding(innerOutlineBindings, innerOutline, wallIds);
    slabData.innerOutlineBindings = innerOutlineBindings;
    this.syncWallsToSlab(slabData.id, wallIds);
    this._callbacks.removeMeshFromScene(slabData.id);
    this.createSlabMesh(slabData);
    this._callbacks.notify(slabData.id, 'update');
  }

  /**
   * 用裁剪后的剩余轮廓重绘原楼板，必要时为额外剩余区域创建独立楼板。
   * @param slabData - 被部分相交裁剪的楼板。
   * @param remainingOutlines - 扣除相交区域后的剩余轮廓集合。
   */
  private _replaceSlabWithRemainingOutlines(slabData: SlabData, remainingOutlines: Point2D[][]): void {
    if (remainingOutlines.length === 0) {
      this._callbacks.removeObject(slabData.id);
      return;
    }

    const firstRemainingOutline: Point2D[] = remainingOutlines[0]!;
    slabData.outline = this._clonePointOutline(firstRemainingOutline);
    slabData.innerOutlines = this._filterInnerOutlinesForOuterOutline(slabData.innerOutlines, slabData.outline);
    slabData.innerOutlineBindings = this._filterInnerOutlineBindingsForOuterOutline(slabData.innerOutlineBindings, slabData.outline);
    slabData.boundaryDimensionSegments = this.createFallbackBoundaryDimensionSegments(slabData.outline);
    this._callbacks.removeMeshFromScene(slabData.id);
    this.createSlabMesh(slabData);
    this._callbacks.notify(slabData.id, 'update');

    for (let index: number = 1; index < remainingOutlines.length; index += 1) {
      const remainingOutline: Point2D[] = remainingOutlines[index]!;
      this._createDetachedSlabFromSource(slabData, remainingOutline);
    }
  }

  /**
   * 根据父楼板属性创建一个不绑定墙体的剩余楼板。
   * @param sourceSlab - 提供材质、厚度和高度参数的源楼板。
   * @param outline - 剩余区域外轮廓。
   */
  private _createDetachedSlabFromSource(sourceSlab: SlabData, outline: Point2D[]): void {
    this._slabCount += 1;
    const id: string = IdGenerator.generate('slab');
    const data: SlabData = {
      id: id,
      category: 'slab',
      name: `楼板-${this._slabCount}`,
      visible: sourceSlab.visible,
      locked: sourceSlab.locked,
      height: sourceSlab.height,
      elevation: sourceSlab.elevation,
      offsetX: sourceSlab.offsetX,
      offsetY: sourceSlab.offsetY,
      offsetZ: sourceSlab.offsetZ,
      material: { ...sourceSlab.material },
      outline: this._clonePointOutline(outline),
      innerOutlines: this._filterInnerOutlinesForOuterOutline(sourceSlab.innerOutlines, outline),
      innerOutlineBindings: this._filterInnerOutlineBindingsForOuterOutline(sourceSlab.innerOutlineBindings, outline),
      wallIds: [],
      boundaryDimensionSegments: this.createFallbackBoundaryDimensionSegments(outline),
      slabThickness: sourceSlab.slabThickness,
      topOffset: sourceSlab.topOffset,
      boundingBox: {
        min: { x: 0, z: 0 },
        max: { x: 0, z: 0 },
        center: { x: 0, z: 0 },
        size: { x: 0, y: 0, z: 0 },
      },
    };

    this._objects.set(id, data);
    this.createSlabMesh(data);
    this._callbacks.notify(id, 'add');
  }

  /**
   * 过滤仍完全位于指定外轮廓内部的楼板内洞。
   * @param innerOutlines - 原内洞集合。
   * @param outerOutline - 新外轮廓。
   * @returns 可继续保留的内洞集合。
   */
  private _filterInnerOutlinesForOuterOutline(innerOutlines: Point2D[][] | undefined, outerOutline: Point2D[]): Point2D[][] {
    if (!Array.isArray(innerOutlines)) {
      return [];
    }

    const filteredInnerOutlines: Point2D[][] = [];
    for (const innerOutline of innerOutlines) {
      if (SlabContourPuncher.isOutlineContained(innerOutline, outerOutline)) {
        filteredInnerOutlines.push(this._clonePointOutline(innerOutline));
      }
    }
    return filteredInnerOutlines;
  }

  /**
   * 过滤仍完全位于指定外轮廓内部的楼板洞口绑定。
   * @param innerOutlineBindings - 原洞口绑定集合。
   * @param outerOutline - 新外轮廓。
   * @returns 可继承到指定外轮廓内的洞口绑定集合。
   */
  private _filterInnerOutlineBindingsForOuterOutline(
    innerOutlineBindings: SlabInnerOutlineBinding[] | undefined,
    outerOutline: Point2D[]
  ): SlabInnerOutlineBinding[] {
    if (!Array.isArray(innerOutlineBindings)) {
      return [];
    }

    const filteredBindings: SlabInnerOutlineBinding[] = [];
    for (const innerOutlineBinding of innerOutlineBindings) {
      if (SlabContourPuncher.isOutlineContained(innerOutlineBinding.outline, outerOutline)) {
        filteredBindings.push({
          outline: this._clonePointOutline(innerOutlineBinding.outline),
          wallIds: innerOutlineBinding.wallIds.slice(),
        });
      }
    }
    return filteredBindings;
  }

  /**
   * 追加或更新楼板洞口绑定。
   * @param bindings - 待更新的洞口绑定集合。
   * @param innerOutline - 洞口内轮廓。
   * @param wallIds - 围合该洞口的墙体 ID 列表。
   */
  private _upsertSlabInnerOutlineBinding(bindings: SlabInnerOutlineBinding[], innerOutline: Point2D[], wallIds: string[]): void {
    for (const binding of bindings) {
      if (this._arePointOutlinesEqual(binding.outline, innerOutline)) {
        binding.wallIds = wallIds.slice();
        return;
      }
    }

    bindings.push({
      outline: this._clonePointOutline(innerOutline),
      wallIds: wallIds.slice(),
    });
  }

  /**
   * 根据子空间封闭环刷新父楼板内轮廓洞口。
   * @param innerOutline - 当前子空间封闭环的最新室内净轮廓。
   * @param wallIds - 围合当前子空间封闭环的墙体 ID 列表。
   */
  private _refreshSlabInnerOutlinesForLoop(innerOutline: Point2D[], wallIds: string[]): void {
    const targetWallIdSet: Set<string> = new Set<string>(wallIds);

    for (const objectData of this._objects.values()) {
      if (objectData.category !== 'slab') {
        continue;
      }

      const slabData: SlabData = objectData as SlabData;
      if (this._areWallIdSetsEqual(slabData.wallIds, targetWallIdSet)) {
        continue;
      }

      const innerOutlineBindings: SlabInnerOutlineBinding[] = Array.isArray(slabData.innerOutlineBindings)
        ? slabData.innerOutlineBindings
        : [];
      if (innerOutlineBindings.length === 0) {
        continue;
      }

      const innerOutlines: Point2D[][] = Array.isArray(slabData.innerOutlines) ? slabData.innerOutlines : [];
      const shouldKeepInnerOutline: boolean = SlabContourPuncher.isOutlineContained(innerOutline, slabData.outline);
      let hasChanged: boolean = false;

      /* 循环逻辑：倒序处理绑定，便于新轮廓移出父楼板时同步删除旧绑定和旧洞口。 */
      for (let bindingIndex: number = innerOutlineBindings.length - 1; bindingIndex >= 0; bindingIndex -= 1) {
        const binding: SlabInnerOutlineBinding = innerOutlineBindings[bindingIndex]!;
        if (!this._areWallIdSetsEqual(binding.wallIds, targetWallIdSet)) {
          continue;
        }

        const oldBindingOutline: Point2D[] = binding.outline;
        const innerOutlineIndex: number = this._findMatchingInnerOutlineIndex(innerOutlines, oldBindingOutline);
        if (!shouldKeepInnerOutline) {
          innerOutlineBindings.splice(bindingIndex, 1);
          if (innerOutlineIndex >= 0) {
            innerOutlines.splice(innerOutlineIndex, 1);
          }
          hasChanged = true;
          continue;
        }

        const clonedInnerOutline: Point2D[] = this._clonePointOutline(innerOutline);
        binding.outline = clonedInnerOutline;
        binding.wallIds = wallIds.slice();
        if (innerOutlineIndex >= 0) {
          innerOutlines[innerOutlineIndex] = this._clonePointOutline(innerOutline);
        } else {
          innerOutlines.push(this._clonePointOutline(innerOutline));
        }
        hasChanged = true;
      }

      if (!hasChanged) {
        continue;
      }

      slabData.innerOutlines = innerOutlines;
      slabData.innerOutlineBindings = innerOutlineBindings;
      this._callbacks.removeMeshFromScene(slabData.id);
      this.createSlabMesh(slabData);
      this._callbacks.notify(slabData.id, 'update');
    }
  }

  /**
   * 根据封闭环刷新对应的楼板和天花板。
   * @param signature - 当前中心线封闭环签名。
   * @param centerOutline - 当前中心线封闭环轮廓。
   * @param wallIds - 围合该封闭环的墙体 ID 列表。
   */
  private _refreshClosedSurfaceFromLoop(signature: string, centerOutline: Point2D[], wallIds: string[]): void {
    const innerOutline: Point2D[] = this.convertOutlineToInnerBoundary(centerOutline, wallIds);
    const boundaryDimensionSegments: SlabBoundaryDimensionSegment[] = this.createBoundaryDimensionSegments(innerOutline, wallIds);

    const existingSlabId: string | null = this._findExistingSlabIdForWalls(wallIds);
    if (existingSlabId !== null) {
      const slabObject: BuildingObject | undefined = this._objects.get(existingSlabId);
      if (slabObject !== undefined && slabObject.category === 'slab') {
        const slabData: SlabData = slabObject as SlabData;
        slabData.outline = innerOutline;
        slabData.wallIds = wallIds.slice();
        slabData.boundaryDimensionSegments = boundaryDimensionSegments;
        this._callbacks.removeMeshFromScene(existingSlabId);
        this.createSlabMesh(slabData);
        this.syncWallsToSlab(existingSlabId, wallIds);
        this._generatedSlabSignatures.add(signature);
        this._callbacks.notify(existingSlabId, 'update');
      }
    } else if (!this._generatedSlabSignatures.has(signature)) {
      this._generatedSlabSignatures.add(signature);
      this.createSlab(innerOutline, SLAB_DEFAULTS.slabThickness, wallIds, boundaryDimensionSegments);
    }

    this._refreshSlabInnerOutlinesForLoop(innerOutline, wallIds);

    const existingCeilingId: string | null = this._findExistingCeilingIdForWalls(wallIds);
    if (existingCeilingId !== null) {
      const ceilingObject: BuildingObject | undefined = this._objects.get(existingCeilingId);
      if (ceilingObject !== undefined && ceilingObject.category === 'ceiling') {
        const ceilingData: CeilingData = ceilingObject as CeilingData;
        ceilingData.outline = innerOutline;
        ceilingData.wallIds = wallIds.slice();
        this._callbacks.removeMeshFromScene(existingCeilingId);
        this.createCeilingMesh(ceilingData);
        this.syncWallsToCeiling(existingCeilingId, wallIds, ceilingData.bottomOffset);
        this._generatedCeilingSignatures.add(signature);
        this._callbacks.notify(existingCeilingId, 'update');
      }
    } else if (!this._generatedCeilingSignatures.has(signature)) {
      this._generatedCeilingSignatures.add(signature);
      this.createCeiling(innerOutline, CEILING_DEFAULTS.ceilingThickness, CEILING_DEFAULTS.bottomOffset, wallIds);
    }
  }

  /**
   * 尝试自动生成天花板。
   * @param signature - 封闭环签名。
   * @param innerOutline - 室内净轮廓。
   * @param wallIds - 围合该封闭环的墙体 ID 列表。
   */
  private _tryAutoGenerateCeiling(signature: string, innerOutline: Point2D[], wallIds: string[]): void {
    if (this._generatedCeilingSignatures.has(signature)) {
      return;
    }

    this._generatedCeilingSignatures.add(signature);
    this.createCeiling(innerOutline, CEILING_DEFAULTS.ceilingThickness, CEILING_DEFAULTS.bottomOffset, wallIds);
  }

  /**
   * 查找指定墙体集合已关联的楼板 ID。
   * @param wallIds - 围合封闭区域的墙体 ID 列表。
   * @returns 关联楼板 ID；没有有效关联时返回 null。
   */
  private _findExistingSlabIdForWalls(wallIds: string[]): string | null {
    const wallIdSet: Set<string> = new Set<string>(wallIds);
    for (const objectData of this._objects.values()) {
      if (objectData.category !== 'slab') {
        continue;
      }

      const slabData: SlabData = objectData as SlabData;
      if (this._areWallIdSetsEqual(slabData.wallIds, wallIdSet)) {
        return slabData.id;
      }
    }
    return null;
  }

  /**
   * 查找指定墙体集合已关联的天花板 ID。
   * @param wallIds - 围合封闭区域的墙体 ID 列表。
   * @returns 关联天花板 ID；没有有效关联时返回 null。
   */
  private _findExistingCeilingIdForWalls(wallIds: string[]): string | null {
    const wallIdSet: Set<string> = new Set<string>(wallIds);
    for (const objectData of this._objects.values()) {
      if (objectData.category !== 'ceiling') {
        continue;
      }

      const ceilingData: CeilingData = objectData as CeilingData;
      if (this._areWallIdSetsEqual(ceilingData.wallIds, wallIdSet)) {
        return ceilingData.id;
      }
    }
    return null;
  }

  /**
   * 判断对象记录的墙体 ID 列表是否与目标墙体集合完全一致。
   * @param sourceWallIds - 对象记录的墙体 ID 列表。
   * @param targetWallIdSet - 当前封闭空间的墙体 ID 集合。
   * @returns 两个集合完全一致时返回 true。
   */
  private _areWallIdSetsEqual(sourceWallIds: string[] | undefined, targetWallIdSet: Set<string>): boolean {
    if (sourceWallIds === undefined || sourceWallIds.length !== targetWallIdSet.size) {
      return false;
    }

    for (const sourceWallId of sourceWallIds) {
      if (!targetWallIdSet.has(sourceWallId)) {
        return false;
      }
    }
    return true;
  }

  /**
   * 从可选 ID 列表中移除指定 ID。
   * @param sourceIds - 原始 ID 列表。
   * @param removedId - 需要移除的 ID。
   * @returns 移除指定 ID 后的新列表。
   */
  private _removeId(sourceIds: string[] | undefined, removedId: string): string[] {
    if (!Array.isArray(sourceIds)) {
      return [];
    }

    const resultIds: string[] = [];
    for (const sourceId of sourceIds) {
      if (sourceId !== removedId && !resultIds.includes(sourceId)) {
        resultIds.push(sourceId);
      }
    }
    return resultIds;
  }

  /**
   * 向可选 ID 列表追加唯一 ID。
   * @param sourceIds - 原始 ID 列表。
   * @param nextId - 需要追加的 ID。
   * @returns 已去重的新 ID 列表。
   */
  private _appendUniqueId(sourceIds: string[] | undefined, nextId: string): string[] {
    const resultIds: string[] = Array.isArray(sourceIds) ? sourceIds.slice() : [];
    if (!resultIds.includes(nextId)) {
      resultIds.push(nextId);
    }
    return resultIds;
  }

  /**
   * 获取指定墙体在楼板净轮廓中对应的采样边数量。
   * @param wallData - 墙体数据，缺失时按一条边处理。
   * @returns 该墙体生成的边界采样段数量。
   */
  private _getWallBoundarySegmentCount(wallData: WallData | null): number {
    if (wallData === null || wallData.subType !== 'arc') {
      return 1;
    }
    const arcWall: ArcWallData = wallData as ArcWallData;
    const minArcSegments: number = 8;
    const maxArcSegments: number = 96;
    const requestedSegments: number = Math.max(arcWall.segments, minArcSegments);
    return Math.min(requestedSegments, maxArcSegments);
  }

  /**
   * 在楼板内洞集合中查找与目标轮廓完全一致的索引。
   * @param innerOutlines - 待搜索的楼板内洞集合。
   * @param targetOutline - 目标洞口轮廓。
   * @returns 匹配轮廓索引；未找到时返回 -1。
   */
  private _findMatchingInnerOutlineIndex(innerOutlines: Point2D[][], targetOutline: Point2D[]): number {
    for (let index: number = 0; index < innerOutlines.length; index += 1) {
      const innerOutline: Point2D[] = innerOutlines[index]!;
      if (this._arePointOutlinesEqual(innerOutline, targetOutline)) {
        return index;
      }
    }
    return -1;
  }

  /**
   * 克隆 XZ 平面点轮廓，避免多个楼板共享可变数组引用。
   * @param outline - 原始轮廓。
   * @returns 克隆后的轮廓。
   */
  private _clonePointOutline(outline: Point2D[]): Point2D[] {
    return outline.map((point: Point2D): Point2D => ({ x: point.x, z: point.z }));
  }

  /**
   * 判断两个点轮廓是否按相同顺序完全一致。
   * @param firstOutline - 第一个轮廓。
   * @param secondOutline - 第二个轮廓。
   * @returns 点数量与各点坐标均一致时返回 true。
   */
  private _arePointOutlinesEqual(firstOutline: Point2D[], secondOutline: Point2D[]): boolean {
    if (firstOutline.length !== secondOutline.length) {
      return false;
    }

    for (let index: number = 0; index < firstOutline.length; index += 1) {
      const firstPoint: Point2D = firstOutline[index]!;
      const secondPoint: Point2D = secondOutline[index]!;
      if (!this._arePointsClose2D(firstPoint, secondPoint)) {
        return false;
      }
    }
    return true;
  }

  /**
   * 判断两个 XZ 平面点是否近似重合。
   * @param first - 第一个点。
   * @param second - 第二个点。
   * @returns 小于容差时返回 true。
   */
  private _arePointsClose2D(first: Point2D, second: Point2D): boolean {
    const dx: number = first.x - second.x;
    const dz: number = first.z - second.z;
    return dx * dx + dz * dz <= 0.0000000001;
  }
}