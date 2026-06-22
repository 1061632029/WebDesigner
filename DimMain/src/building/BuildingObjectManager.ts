/**
 * 建筑对象管理器
 * 统一管理所有建筑对象的数据和渲染实例
 * 数据层与渲染层分离，支持序列化和按类别查询
 */

import * as THREE from 'three/webgpu';
import type {
  BuildingObject,
  BuildingCategory,
  WallData,
  StraightWallData,
  ArcWallData,
  RectWallData,
  SlabBoundaryDimensionSegment,
  SlabData,
  CeilingData,
  BeamData,
  Point2D,
  MaterialProperties,
  WallOpening,
  WallEndpointDirection,
  WallJoint,
} from './BuildingTypes';
import { WALL_DEFAULTS, BEAM_DEFAULTS, getDefaultMaterial } from './BuildingTypes';
import { WallGeometryBuilder } from './WallGeometryBuilder';
import { BeamGeometryBuilder } from './BeamGeometryBuilder';
import { SlabGeometryBuilder } from './SlabGeometryBuilder';
import { CeilingGeometryBuilder } from './CeilingGeometryBuilder';
import { WallConnectionManager } from './WallConnectionManager';
import { BeamMiterCalculator } from './BeamMiterCalculator';
import { IdGenerator } from './IdGenerator';
import { WallPlacementLineConverter } from './WallPlacementLineConverter';
import type { ArcWallCenterLine, ClockwiseRectInnerEdges, WallCenterLine } from './WallPlacementLineConverter';
import type { SceneManager } from '../scene/SceneManager';
import { WallJointNodeRenderer } from './WallJointNodeRenderer';
import { FixedPixelLineSegmentsFactory } from '../rendering/FixedPixelLineSegmentsFactory';
import { BuildingMaterialFactory } from './manager/BuildingMaterialFactory';
import { BuildingMeshFactory } from './manager/BuildingMeshFactory';
import { BuildingWireframeFactory } from './manager/BuildingWireframeFactory';
import type { BuildingWireframeFactoryOptions } from './manager/BuildingWireframeFactory';
import { BuildingVisualStyleService } from './manager/BuildingVisualStyleService';
import { BuildingOpeningPreviewService } from './manager/BuildingOpeningPreviewService';
import { BuildingWireframeService } from './manager/BuildingWireframeService';
import { BuildingBeamService } from './manager/BuildingBeamService';
import type { BeamDragSnapshot, BeamJointDragSnapshot, BeamMoveResult } from './manager/BuildingBeamService';
import { BuildingWallAttachmentService } from './manager/BuildingWallAttachmentService';
import { BuildingWallService } from './manager/BuildingWallService';
import type { ArcWallDragSnapshot, StraightWallDragSnapshot, WallJointDragSnapshot } from './manager/BuildingWallService';
import { BuildingSurfaceService } from './manager/BuildingSurfaceService';
import type { GeneratedSurfaceSignatureSnapshot } from './manager/BuildingSurfaceService';

export type { BeamDragSnapshot, BeamJointDragSnapshot } from './manager/BuildingBeamService';
export type { ArcWallDragSnapshot, StraightWallDragSnapshot, WallJointDragSnapshot } from './manager/BuildingWallService';
export type { StraightWallAttachedDoorWindowSnapshot } from './manager/BuildingWallAttachmentService';
export type { GeneratedSurfaceSignatureSnapshot } from './manager/BuildingSurfaceService';

/**
 * 建筑对象变更事件回调
 */
export type BuildingObjectChangeCallback = (objectId: string, action: 'add' | 'remove' | 'update') => void;

/**
 * 建筑对象管理器
 */
export class BuildingObjectManager {
  /** 建筑实体线框 NDC 深度前移量；该值必须保持很小，避免背面线框被推到实体前方造成透墙显示。 */
  private static readonly WIREFRAME_DEPTH_OFFSET_NDC: number = 0.00004;

  /** 所有建筑对象的纯数据 */
  private _objects: Map<string, BuildingObject> = new Map();

  /** 所有建筑对象的渲染实例（key = 对象 ID） */
  private _meshes: Map<string, THREE.Mesh> = new Map();

  /** 场景管理器引用 */
  private _sceneManager: SceneManager;

  /** 墙体几何构建器 */
  private _wallBuilder: WallGeometryBuilder = new WallGeometryBuilder();

  /** 梁几何构建器 */
  private _beamBuilder: BeamGeometryBuilder = new BeamGeometryBuilder();

  /** 梁斜接计算器（梁拥有独立斜接逻辑，节点显示时转换为墙节点兼容对象） */
  private _beamMiterCalculator: BeamMiterCalculator = new BeamMiterCalculator();

  /** 楼板几何构建器 */
  private _slabBuilder: SlabGeometryBuilder = new SlabGeometryBuilder();

  /** 天花板几何构建器 */
  private _ceilingBuilder: CeilingGeometryBuilder = new CeilingGeometryBuilder();

  /** 墙体连接管理器（端点吸附+拓扑） */
  private _connectionManager: WallConnectionManager = new WallConnectionManager();

  /** 墙衔接节点圆片渲染器（2D 平面显示拓扑节点） */
  private _wallJointNodeRenderer: WallJointNodeRenderer;

  /** 变更事件监听器 */
  private _listeners: Set<BuildingObjectChangeCallback> = new Set();

  /** 对象计数器（用于自动命名） */
  private _wallCount: number = 0;

  /** 梁计数器（用于自动命名） */
  private _beamCount: number = 0;

  /** 是否启用 WebGPU 固定像素宽度线框强化。 */
  private _fixedPixelWireframeEnabled: boolean = true;

  /** 固定像素线框宽度，单位为 CSS 像素。 */
  private _fixedPixelWireframeWidth: number = FixedPixelLineSegmentsFactory.DEFAULT_LINE_WIDTH_PIXELS;

  /** 建筑视觉样式服务（透明度、临时颜色、类别显隐）。 */
  private _visualStyleService: BuildingVisualStyleService;

  /** 墙体洞口预览服务（门窗布置期间的临时几何替换）。 */
  private _openingPreviewService: BuildingOpeningPreviewService;

  /** 建筑线框服务（全局隐藏/恢复线框）。 */
  private _wireframeService: BuildingWireframeService;

  /** 建筑梁领域服务（梁拖拽、节点聚合与斜接影响范围计算）。 */
  private _beamService: BuildingBeamService;

  /** 墙体附着构件服务（门窗快照、洞口重算与自适应厚度同步）。 */
  private _wallAttachmentService: BuildingWallAttachmentService;

  /** 墙体领域服务（拖拽、节点移动、墙厚右缩进与拓扑重建）。 */
  private _wallService: BuildingWallService;

  /** 楼板与天花板领域服务（封闭面生成、冲孔、墙体绑定与 Mesh 创建）。 */
  private _surfaceService: BuildingSurfaceService;

  /**
   * @param sceneManager - 场景管理器
   */
  constructor(sceneManager: SceneManager) {
    this._sceneManager = sceneManager;
    this._wallJointNodeRenderer = new WallJointNodeRenderer(sceneManager.getScene());
    this._visualStyleService = new BuildingVisualStyleService(this._objects, this._meshes);
    this._openingPreviewService = new BuildingOpeningPreviewService(
      this._objects,
      this._meshes,
      this._wallBuilder,
      this._connectionManager,
      (): ((id: string) => { start: Point2D; end: Point2D; thickness: number } | null) => this._getWallEndpointsCallback()
    );
    this._wireframeService = new BuildingWireframeService(
      this._objects,
      this._meshes,
      (): BuildingWireframeFactoryOptions => this._getWireframeFactoryOptions()
    );
    this._beamService = new BuildingBeamService(this._objects, this._beamMiterCalculator);
    this._wallAttachmentService = new BuildingWallAttachmentService(this._objects, this._sceneManager);
    this._wallService = new BuildingWallService(
      this._objects,
      this._connectionManager,
      this._wallAttachmentService,
      {
        removeMeshFromScene: (objectId: string): void => this._removeMeshFromScene(objectId),
        createWallMesh: (wallData: WallData): void => this._createWallMesh(wallData),
        notify: (objectId: string, action: 'add' | 'remove' | 'update'): void => this._notify(objectId, action),
        refreshConnectionLines: (): void => this.refreshConnectionLines(),
      }
    );
    this._surfaceService = new BuildingSurfaceService(
      this._objects,
      this._meshes,
      this._sceneManager,
      this._connectionManager,
      this._slabBuilder,
      this._ceilingBuilder,
      {
        createMaterialFromProperties: (props: MaterialProperties): THREE.Material => this._createMaterialFromProperties(props),
        createSurfaceEdgeWireframe: (geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.Object3D | null =>
          this._createSurfaceEdgeWireframe(geometry, color),
        computeAndStoreBoundingBox: (data: BuildingObject, mesh: THREE.Mesh): void => this._computeAndStoreBoundingBox(data, mesh),
        removeMeshFromScene: (objectId: string): void => this._removeMeshFromScene(objectId),
        createWallMesh: (wallData: StraightWallData): void => this._createWallMesh(wallData),
        notify: (objectId: string, action: 'add' | 'remove' | 'update'): void => this._notify(objectId, action),
        refreshConnectionLines: (): void => this.refreshConnectionLines(),
        removeObject: (objectId: string): boolean => {
          this.removeObject(objectId);
          return true;
        },
      }
    );
  }

  /**
   * 获取墙体连接管理器（供 WallDrawTool 等外部模块访问）
   */
  public get connectionManager(): WallConnectionManager {
    return this._connectionManager;
  }

  /**
   * 设置建筑线框是否使用 WebGPU 固定像素宽度强化。
   * @param enabled - true 表示使用屏幕空间固定像素粗线，false 表示回退浏览器原生 1px LineSegments
   */
  public setFixedPixelWireframeEnabled(enabled: boolean): void {
    this._fixedPixelWireframeEnabled = enabled;
  }

  /**
   * 设置建筑线框固定像素宽度。
   * @param lineWidthPixels - 线宽，单位为 CSS 像素
   */
  public setFixedPixelWireframeWidth(lineWidthPixels: number): void {
    this._fixedPixelWireframeWidth = Math.max(1, lineWidthPixels);
  }

  /**
   * 获取楼板/天花板自动生成签名缓存快照
   * @returns 当前自动生成去重签名缓存的深拷贝快照
   */
  public getGeneratedSurfaceSignatureSnapshot(): GeneratedSurfaceSignatureSnapshot {
    return this._surfaceService.getGeneratedSurfaceSignatureSnapshot();
  }

  /**
   * 恢复楼板/天花板自动生成签名缓存
   * @param snapshot - 需要恢复的签名缓存快照
   */
  public restoreGeneratedSurfaceSignatureSnapshot(snapshot: GeneratedSurfaceSignatureSnapshot): void {
    this._surfaceService.restoreGeneratedSurfaceSignatureSnapshot(snapshot);
  }

  /**
   * 获取当前全部楼板数据快照。
   * @returns 楼板数据深拷贝列表，用于房间内创建子空间时回滚冲孔、拆分后的楼板轮廓状态。
   */
  public getSlabDataSnapshot(): SlabData[] {
    const slabDataList: SlabData[] = [];
    for (const objectData of this._objects.values()) {
      if (objectData.category !== 'slab') {
        continue;
      }
      slabDataList.push(JSON.parse(JSON.stringify(objectData)) as SlabData);
    }
    return slabDataList;
  }

  /**
   * 根据楼板快照恢复全部楼板状态。
   * @param snapshot - 需要恢复的楼板数据快照。
   */
  public restoreSlabDataSnapshot(snapshot: SlabData[]): void {
    const currentSlabIds: string[] = [];
    for (const objectData of this._objects.values()) {
      if (objectData.category === 'slab') {
        currentSlabIds.push(objectData.id);
      }
    }

    /* 恢复流程：先移除当前所有楼板及墙体绑定，再按快照重建楼板 Mesh，确保冲孔/拆分结果可被撤销。 */
    for (const slabId of currentSlabIds) {
      this._surfaceService.unlinkSlabFromWalls(slabId);
      this._removeMeshFromScene(slabId);
      this._objects.delete(slabId);
      this._notify(slabId, 'remove');
    }

    for (const slabData of snapshot) {
      this.addObject(JSON.parse(JSON.stringify(slabData)) as SlabData);
    }
  }

  /* ========== 材质工厂方法 ========== */

  /**
   * 根据 MaterialProperties 创建独立的 Three.js Material 实例。
   * @param props - 材质属性。
   * @returns Three.js Material 实例。
   */
  private _createMaterialFromProperties(props: MaterialProperties): THREE.Material {
    return BuildingMaterialFactory.createMaterialFromProperties(props);
  }

  /* ========== 增删改 ========== */

  /**
   * 添加建筑对象
   * @param data - 建筑对象数据
   */
  public addObject(data: BuildingObject): void {
    this._objects.set(data.id, data);

    /* 根据类别创建渲染实例 */
    if (data.category === 'wall') {
      const wallData: WallData = data as WallData;
      this._createWallMesh(wallData);

      /* 注册墙体端点到连接管理器（矩形墙由子墙体注册，跳过） */
      if (wallData.subType === 'straight' || wallData.subType === 'arc') {
        const registeredJoints: { startJointId: string; endJointId: string } =
          this._connectionManager.registerWall(wallData.id, wallData.start, wallData.end);
        const endpointChanged: boolean = this._wallService.syncWallEndpointsFromJointIds(
          wallData,
          registeredJoints.startJointId,
          registeredJoints.endJointId
        );

        /* 注册后重建自身（应用直墙/弧形墙端部裁剪）和相邻墙体。 */
        if (wallData.subType === 'straight' || wallData.subType === 'arc' || endpointChanged) {
          this._removeMeshFromScene(wallData.id);
          this._createWallMesh(wallData);
        }
        this._wallService.rebuildAdjacentWalls(wallData.id);

        /* 检测封闭环，若形成封闭区域则自动生成楼板 */
        this._surfaceService.tryAutoGenerateSlab(wallData.id);
      }
    } else if (data.category === 'slab') {
      const slabData: SlabData = data as SlabData;
      /* 历史命令重做或反序列化时可能直接恢复楼板对象，需要同步创建渲染实例并恢复墙体绑定。 */
      this._surfaceService.createSlabMesh(slabData);
      if (Array.isArray(slabData.wallIds) && slabData.wallIds.length > 0) {
        this._surfaceService.syncWallsToSlab(slabData.id, slabData.wallIds);
      }
      if (Array.isArray(slabData.innerOutlineBindings)) {
        for (const innerOutlineBinding of slabData.innerOutlineBindings) {
          this._surfaceService.syncWallsToSlab(slabData.id, innerOutlineBinding.wallIds);
        }
      }
    } else if (data.category === 'beam') {
      /* 梁使用独立线式布置数据与几何构建逻辑，不参与墙体连接拓扑。 */
      this._createBeamMesh(data as BeamData);
      this._rebuildAdjacentBeams((data as BeamData).id);
    } else if (data.category === 'ceiling') {
      const ceilingData: CeilingData = data as CeilingData;
      /* 历史命令重做或反序列化时可能直接恢复天花板对象，需要同步创建渲染实例并恢复墙体绑定。 */
      this._surfaceService.createCeilingMesh(ceilingData);
      if (Array.isArray(ceilingData.wallIds) && ceilingData.wallIds.length > 0) {
        this._surfaceService.syncWallsToCeiling(ceilingData.id, ceilingData.wallIds, ceilingData.bottomOffset);
      }
    }

    /* 衔接线功能已停用：对象变化后清理可能残留的旧衔接线节点。 */
    this.refreshConnectionLines();

    /* 通知监听器 */
    this._notify(data.id, 'add');
  }

  /* ========== 内部方法 ========== */

  /**
   * 墙面数量常量：直墙有 6 个面（前/后/起点端/终点端/顶/底）
   */
  private static readonly WALL_FACE_COUNT: number = 6;

  /**
   * 带洞口直墙的面数量常量：7 个面（前/后/洞口内壁/起点端/终点端/顶/底）
   */
  private static readonly WALL_FACE_COUNT_WITH_OPENING: number = 7;

  /**
   * 获取当前线框工厂配置。
   * @returns 固定像素线框开关、线宽和深度偏移配置。
   */
  private _getWireframeFactoryOptions(): BuildingWireframeFactoryOptions {
    return {
      fixedPixelWireframeEnabled: this._fixedPixelWireframeEnabled,
      fixedPixelWireframeWidth: this._fixedPixelWireframeWidth,
      wireframeDepthOffsetNdc: BuildingObjectManager.WIREFRAME_DEPTH_OFFSET_NDC,
    };
  }

  /**
   * 创建过滤后的边界线段（排除共面边）。
   * @param geometry - 几何体。
   * @param excludeGroupIndices - 需要排除的 materialIndex 列表。
   * @param hideArcSegmentVerticalEdges - 是否隐藏弧形墙相邻折线段之间的竖向分割边。
   * @returns LineSegments 或 null。
   */
  private _createFilteredEdges(
    geometry: THREE.BufferGeometry,
    excludeGroupIndices: number[] = [],
    hideArcSegmentVerticalEdges: boolean = false
  ): THREE.LineSegments | null {
    return BuildingWireframeFactory.createFilteredEdges(
      geometry,
      this._getWireframeFactoryOptions(),
      excludeGroupIndices,
      hideArcSegmentVerticalEdges
    );
  }

  /**
   * 为楼板、天花板等面状构件创建固定像素边线。
   * @param geometry - 需要提取棱边的几何体。
   * @param color - 边线颜色。
   * @returns 可作为子对象挂载到构件 Mesh 的边线对象；无边线时返回 null。
   */
  private _createSurfaceEdgeWireframe(
    geometry: THREE.BufferGeometry,
    color: THREE.ColorRepresentation
  ): THREE.Object3D | null {
    return BuildingWireframeFactory.createSurfaceEdgeWireframe(
      geometry,
      color,
      this._getWireframeFactoryOptions()
    );
  }

  /**
   * 释放线框辅助对象占用的 GPU 资源。
   * @param wireframeObject - 需要释放的线框辅助对象。
   */
  private _disposeWireframeObject(wireframeObject: THREE.Object3D): void {
    BuildingWireframeFactory.disposeWireframeObject(wireframeObject);
  }

  /**
   * 移除建筑对象
   * @param id - 对象 ID
   */
  public removeObject(id: string): void {
    const obj: BuildingObject | undefined = this._objects.get(id);
    if (obj === undefined) {
      return;
    }

    const removedWallAdjacentIds: Set<string> = new Set<string>();

    /* 如果是矩形墙，同时移除子墙及其连接 */
    if (obj.category === 'wall' && (obj as WallData).subType === 'rect') {
      const rectWall: RectWallData = obj as RectWallData;
      for (let childIndex: number = 0; childIndex < rectWall.childWallIds.length; childIndex++) {
        const childId: string = rectWall.childWallIds[childIndex]!;
        /* 子墙断开连接前先收集外部相邻墙，避免节点映射被删除后无法还原衔接截面。 */
        this._wallService.collectAdjacentWallIdsForRemovedWall(childId, removedWallAdjacentIds);
        this._connectionManager.disconnectWall(childId);
        this._removeMeshFromScene(childId);
        this._objects.delete(childId);
      }
    }

    /* 断开墙体连接 */
    if (obj.category === 'wall') {
      /* 墙体断开连接前先收集相邻墙，删除后按最新连接拓扑重建其端部截面。 */
      this._wallService.collectAdjacentWallIdsForRemovedWall(id, removedWallAdjacentIds);
      this._connectionManager.disconnectWall(id);
    }

    const removedBeamAdjacentIds: Set<string> = obj.category === 'beam'
      ? this._beamMiterCalculator.collectAdjacentBeamIds(obj as BeamData, this._getAllBeamData())
      : new Set<string>();

    /* 移除渲染实例 */
    this._removeMeshFromScene(id);

    /* 移除数据 */
    this._objects.delete(id);

    if (obj.category === 'beam') {
      this._rebuildBeamSet(removedBeamAdjacentIds);
    }

    if (obj.category === 'wall') {
      this._wallService.rebuildWallSet(removedWallAdjacentIds);
    }

    /* 衔接线功能已停用：对象移除后清理可能残留的旧衔接线节点。 */
    this.refreshConnectionLines();

    /* 通知监听器 */
    this._notify(id, 'remove');
  }

  /**
   * 更新建筑对象属性
   * @param id - 对象 ID
   * @param partial - 要更新的属性
   */
  public updateObject(id: string, partial: Partial<BuildingObject>): void {
    const existing: BuildingObject | undefined = this._objects.get(id);
    if (existing === undefined) {
      return;
    }

    const previousBeamAdjacentIds: Set<string> = existing.category === 'beam'
      ? this._beamMiterCalculator.collectAdjacentBeamIds(existing as BeamData, this._getAllBeamData())
      : new Set<string>();

    /* 合并属性 */
    const updated: BuildingObject = { ...existing, ...partial } as BuildingObject;
    this._objects.set(id, updated);

    /* 重建渲染实例 */
    this._removeMeshFromScene(id);
    if (updated.category === 'wall') {
      const updatedWall: WallData = updated as WallData;
      if (updatedWall.subType === 'straight' || updatedWall.subType === 'arc') {
        /* 更新墙体端点后，先重建连接拓扑，再把吸附后的节点坐标写回墙体数据，避免 Mesh 与楼板轮廓使用不同坐标。 */
        this._connectionManager.disconnectWall(id);
        const registeredJoints: { startJointId: string; endJointId: string } =
          this._connectionManager.registerWall(updatedWall.id, updatedWall.start, updatedWall.end);
        this._wallService.syncWallEndpointsFromJointIds(updatedWall, registeredJoints.startJointId, registeredJoints.endJointId);
        this._objects.set(id, updatedWall);
      }
      this._createWallMesh(updatedWall);
      if (updatedWall.subType === 'straight' || updatedWall.subType === 'arc') {
        this._wallService.rebuildAdjacentWalls(updatedWall.id);
      }
    } else if (updated.category === 'slab') {
      /* 楼板：_createSlabMesh 内部已设置 mesh.position.y = topOffset - slabThickness */
      this._surfaceService.createSlabMesh(updated as SlabData);
    } else if (updated.category === 'beam') {
      /* 梁长度由 start/end 自动计算，属性更新时强制刷新，避免用户编辑 length 造成数据不一致。 */
      const updatedBeam: BeamData = updated as BeamData;
      updatedBeam.length = BeamGeometryBuilder.computeLength(updatedBeam.start, updatedBeam.end);
      this._objects.set(id, updatedBeam);
      this._createBeamMesh(updatedBeam);
      previousBeamAdjacentIds.delete(id);
      this._rebuildBeamSet(previousBeamAdjacentIds);
      this._rebuildAdjacentBeams(updatedBeam.id);
    } else if (updated.category === 'ceiling') {
      /* 天花板：_createCeilingMesh 内部已设置 mesh.position.y = bottomOffset（底面贴合墙顶） */
      this._surfaceService.createCeilingMesh(updated as CeilingData);

      /* 联动更新所有关联墙体的高度（= 天花板底面高度）
       * 注意：PropertyChangeCommand 在调用 updateObject 之前已通过 _setByPath 直接修改了
       * _objects Map 中的对象引用，导致 existing.bottomOffset 与 updated.bottomOffset 相同，
       * 无法通过比较新旧值来判断是否变化。因此只要有关联墙体，始终执行同步。
       */
      const updatedCeiling: CeilingData = updated as CeilingData;
      if (updatedCeiling.wallIds.length > 0) {
        /* 直接修改关联墙体数据并重建 Mesh，不走 updateObject 避免递归 */
        this._surfaceService.syncWallsToCeiling(id, updatedCeiling.wallIds, updatedCeiling.bottomOffset);
      }
    }

    /* 同步 Mesh 的位置偏移（墙体等非楼板/天花板对象使用 offsetX/Y/Z） */
    const mesh: THREE.Mesh | undefined = this._meshes.get(id);
    if (mesh !== undefined && updated.category !== 'slab' && updated.category !== 'ceiling') {
      mesh.position.set(updated.offsetX, updated.offsetY, updated.offsetZ);
    }

    /* 墙体厚度变化后，同步所有吸附在该墙体上的自适应门窗厚度。 */
    if (updated.category === 'wall' && (updated as WallData).subType === 'straight') {
      this._wallAttachmentService.syncAdaptiveDoorWindowThickness(updated as StraightWallData);
    }

    /* 衔接线功能已停用：对象更新后清理可能残留的旧衔接线节点。 */
    this.refreshConnectionLines();

    /* 通知监听器 */
    this._notify(id, 'update');
  }

  /**
   * 创建梁方向拖拽开始快照。
   * @param beamId - 被拖拽梁 ID
   * @returns 梁拖拽快照；对象不存在或不是梁时返回 null
   */
  public createBeamDragSnapshot(beamId: string): BeamDragSnapshot | null {
    return this._beamService.createBeamDragSnapshot(beamId);
  }

  /**
   * 基于拖拽开始快照和当前总偏移移动梁，并重建梁及相邻梁斜接。
   * @param snapshot - 梁拖拽开始快照
   * @param totalOffset - 当前拖拽总偏移
   * @returns 成功移动时返回 true
   */
  public moveBeamFromSnapshot(snapshot: BeamDragSnapshot, totalOffset: Point2D): boolean {
    const moveResult: BeamMoveResult | null = this._beamService.moveBeamFromSnapshot(snapshot, totalOffset);
    if (moveResult === null) {
      return false;
    }

    /* 梁领域服务只修改数据和返回影响范围；管理器负责统一重建渲染实例与通知外部监听器。 */
    this._rebuildBeamSet(moveResult.rebuildBeamIds);
    this.refreshConnectionLines();
    moveResult.affectedBeamIds.forEach((affectedBeamId: string): void => this._notify(affectedBeamId, 'update'));
    return true;
  }

  /**
   * 按给定二维偏移移动梁。
   * @param beamId - 被移动梁 ID
   * @param offset - XZ 平面偏移
   * @returns 成功移动时返回 true
   */
  public moveBeam(beamId: string, offset: Point2D): boolean {
    const snapshot: BeamDragSnapshot | null = this.createBeamDragSnapshot(beamId);
    if (snapshot === null) {
      return false;
    }

    return this.moveBeamFromSnapshot(snapshot, offset);
  }

  /**
   * 创建梁衔接点拖拽开始快照。
   * @param jointId - 被拖拽的梁衔接点 ID
   * @returns 拖拽快照；节点不存在或连接梁不足时返回 null
   */
  public createBeamJointDragSnapshot(jointId: string): BeamJointDragSnapshot | null {
    return this._beamService.createBeamJointDragSnapshot(jointId);
  }

  /**
   * 从拖拽开始快照按 P + L 方式移动梁衔接点并同步直连梁端点。
   * @param snapshot - 梁衔接点拖拽开始快照
   * @param totalOffset - 当前鼠标相对拖拽开始位置的总偏移
   * @returns 实际被更新的梁 ID 列表
   */
  public moveBeamJointFromSnapshot(snapshot: BeamJointDragSnapshot, totalOffset: Point2D): string[] {
    const moveResult: BeamMoveResult | null = this._beamService.moveBeamJointFromSnapshot(snapshot, totalOffset);
    if (moveResult === null) {
      return [];
    }

    /* 梁节点移动后统一重建受影响梁及斜接相邻梁，保证数据服务与渲染生命周期解耦。 */
    this._rebuildBeamSet(moveResult.rebuildBeamIds);
    this.refreshConnectionLines();
    moveResult.affectedBeamIds.forEach((affectedBeamId: string): void => this._notify(affectedBeamId, 'update'));
    return Array.from(moveResult.affectedBeamIds);
  }

  /**
   * 移动指定梁衔接点并同步直连梁端点。
   * @param jointId - 被移动的梁衔接点 ID
   * @param offset - XZ 平面偏移
   * @returns 实际被更新的梁 ID 列表
   */
  public moveBeamJoint(jointId: string, offset: Point2D): string[] {
    const snapshot: BeamJointDragSnapshot | null = this.createBeamJointDragSnapshot(jointId);
    if (snapshot === null) {
      return [];
    }
    return this.moveBeamJointFromSnapshot(snapshot, offset);
  }

  /**
   * 创建直墙拖拽开始快照。
   * @param wallId - 被拖拽的直墙 ID
   * @returns 拖拽快照；墙体不存在或不是有效直墙时返回 null
   */
  public createStraightWallDragSnapshot(wallId: string): StraightWallDragSnapshot | null {
    return this._wallService.createStraightWallDragSnapshot(wallId);
  }

  /**
   * 从拖拽开始快照按 P + L 方式移动直墙并同步连接墙体。
   * @param snapshot - 拖拽开始快照
   * @param totalOffset - 当前鼠标相对拖拽开始位置的总法向偏移 L
   * @returns 实际被更新的墙体 ID 列表
   */
  public moveStraightWallWithConnectionsFromSnapshot(
    snapshot: StraightWallDragSnapshot,
    totalOffset: Point2D
  ): string[] {
    return this._wallService.moveStraightWallWithConnectionsFromSnapshot(snapshot, totalOffset);
  }

  /**
   * 移动指定直墙并按连接墙体原方向重算共享节点。
   * @param wallId - 被拖拽的直墙 ID
   * @param offset - 法向平移偏移量（世界 XZ 平面）
   * @returns 实际被更新的墙体 ID 列表
   */
  public moveStraightWallWithConnections(wallId: string, offset: Point2D): string[] {
    return this._wallService.moveStraightWallWithConnections(wallId, offset);
  }

  /**
   * 创建弧形墙拖拽开始快照。
   * @param wallId - 被拖拽的弧形墙 ID
   * @returns 弧形墙拖拽快照；墙体不存在或弧线退化时返回 null
   */
  public createArcWallDragSnapshot(wallId: string): ArcWallDragSnapshot | null {
    return this._wallService.createArcWallDragSnapshot(wallId);
  }

  /**
   * 从拖拽开始快照按 P + L 方式移动弧形墙。
   * @param snapshot - 弧形墙拖拽开始快照
   * @param totalOffset - 当前鼠标投影到弧墙径向拖拽线后的总偏移
   * @returns 成功移动时返回被更新墙体 ID 列表
   */
  public moveArcWallFromSnapshot(snapshot: ArcWallDragSnapshot, totalOffset: Point2D): string[] {
    return this._wallService.moveArcWallFromSnapshot(snapshot, totalOffset);
  }

  /**
   * 移动指定弧形墙。
   * @param wallId - 被移动弧形墙 ID
   * @param offset - XZ 平面偏移
   * @returns 成功移动时返回被更新墙体 ID 列表
   */
  public moveArcWall(wallId: string, offset: Point2D): string[] {
    return this._wallService.moveArcWall(wallId, offset);
  }

  /**
   * 创建墙体衔接点拖拽开始快照。
   * @param jointId - 被拖拽的墙体衔接点 ID
   * @returns 拖拽快照；衔接点不存在或未连接任何有效直墙时返回 null
   */
  public createWallJointDragSnapshot(jointId: string): WallJointDragSnapshot | null {
    return this._wallService.createWallJointDragSnapshot(jointId);
  }

  /**
   * 从拖拽开始快照按 P + L 方式移动墙体衔接点并同步直连墙体。
   * @param snapshot - 拖拽开始快照
   * @param totalOffset - 当前鼠标相对拖拽开始位置的总偏移 L
   * @returns 实际被更新的墙体 ID 列表
   */
  public moveWallJointFromSnapshot(snapshot: WallJointDragSnapshot, totalOffset: Point2D): string[] {
    return this._wallService.moveWallJointFromSnapshot(snapshot, totalOffset);
  }

  /**
   * 移动指定墙体衔接点并同步直连墙体。
   * @param jointId - 被移动的墙体衔接点 ID
   * @param offset - 平移偏移量（世界 XZ 平面）
   * @returns 实际被更新的墙体 ID 列表
   */
  public moveWallJoint(jointId: string, offset: Point2D): string[] {
    return this._wallService.moveWallJoint(jointId, offset);
  }

  /**
   * 修改直墙厚度，并按墙体布置方向右侧缩进中心线。
   * @param wallId - 需要修改厚度的直墙 ID
   * @param nextThickness - 修改后的墙厚（米）
   * @returns 实际被重建或联动更新的墙体 ID 列表
   */
  public updateStraightWallThicknessWithRightIndent(wallId: string, nextThickness: number): string[] {
    return this._wallService.updateStraightWallThicknessWithRightIndent(wallId, nextThickness);
  }

  /* ========== 查询 ========== */

  /**
   * 按 ID 获取对象
   * @param id - 对象 ID
   * @returns 建筑对象数据，不存在返回 undefined
   */
  public getById(id: string): BuildingObject | undefined {
    return this._objects.get(id);
  }

  /**
   * 按类别获取所有对象
   * @param category - 对象类别
   * @returns 该类别的所有对象数组
   */
  public getByCategory(category: BuildingCategory): BuildingObject[] {
    const result: BuildingObject[] = [];
    this._objects.forEach((obj: BuildingObject): void => {
      if (obj.category === category) {
        result.push(obj);
      }
    });
    return result;
  }

  /**
   * 获取所有对象
   * @returns 所有建筑对象数组
   */
  public getAll(): BuildingObject[] {
    return Array.from(this._objects.values());
  }

  /**
   * 获取对象总数
   */
  public get count(): number {
    return this._objects.size;
  }

  /**
   * 根据对象 ID 获取对应的 Three.js Mesh 实例
   * 供选择管理器、高亮工具等模块访问渲染实例
   * @param id - 建筑对象 ID
   * @returns Three.js Mesh 实例，不存在返回 undefined
   */
  public getMeshById(id: string): THREE.Mesh | undefined {
    return this._meshes.get(id);
  }

  /**
   * 获取所有 Mesh 实例的快照数组
   * 用于框选时遍历检测
   * @returns 所有 Mesh 实例数组（含全局 ID）
   */
  public getAllMeshes(): Array<{ id: string; mesh: THREE.Mesh }> {
    const result: Array<{ id: string; mesh: THREE.Mesh }> = [];
    this._meshes.forEach((mesh: THREE.Mesh, id: string): void => {
      result.push({ id: id, mesh: mesh });
    });
    return result;
  }

  /* ========== 便捷创建方法 ========== */

  /**
   * 构造直墙数据但不加入场景
   * 用于命令模式先生成稳定 ID 与快照，再由命令统一 execute/undo。
   * @param start - 起点
   * @param end - 终点
   * @param thickness - 厚度（默认 0.24m）
   * @param height - 高度（默认 2.8m）
   * @returns 新建的直墙数据
   */
  public createStraightWallData(
    start: Point2D,
    end: Point2D,
    thickness: number = WALL_DEFAULTS.thickness,
    height: number = WALL_DEFAULTS.height
  ): StraightWallData {
    this._wallCount += 1;
    const id: string = IdGenerator.generate('wall');
    const data: StraightWallData = {
      id: id,
      category: 'wall',
      subType: 'straight',
      name: `直墙-${this._wallCount}`,
      visible: true,
      locked: false,
      height: height,
      elevation: WALL_DEFAULTS.elevation,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      material: getDefaultMaterial('wall'),
      thickness: thickness,
      start: start,
      end: end,
      /* 初始无关联天花板/楼板 */
      ceilingId: null,
      slabId: null,
      boundingBox: {
        min: { x: Number.MAX_SAFE_INTEGER, z: Number.MAX_SAFE_INTEGER },
        max: { x: Number.MIN_SAFE_INTEGER, z: Number.MIN_SAFE_INTEGER },
        center: { x: 0, z: 0 },
        size: { x: 0, y: 0, z: 0 },
      },
    };
    return data;
  }

  /**
   * 构造梁数据但不加入场景
   * 用于命令模式先生成稳定 ID 与快照，再由命令统一 execute/undo。
   * @param start - 梁中心线起点
   * @param end - 梁中心线终点
   * @param width - 梁宽度（XZ 平面垂直布置方向）
   * @param height - 梁高度（Y 方向）
   * @returns 新建的梁数据
   */
  public createBeamData(
    start: Point2D,
    end: Point2D,
    width: number = BEAM_DEFAULTS.width,
    height: number = BEAM_DEFAULTS.height
  ): BeamData {
    this._beamCount += 1;
    const id: string = IdGenerator.generate('beam');
    const length: number = BeamGeometryBuilder.computeLength(start, end);
    const data: BeamData = {
      id: id,
      category: 'beam',
      name: `梁-${this._beamCount}`,
      visible: true,
      locked: false,
      height: height,
      elevation: BEAM_DEFAULTS.distanceFromFloor,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      material: getDefaultMaterial('beam'),
      start: start,
      end: end,
      width: width,
      length: length,
      placementReference: 'floor',
      distanceFromFloor: BEAM_DEFAULTS.distanceFromFloor,
      distanceFromCeiling: BEAM_DEFAULTS.distanceFromCeiling,
      boundingBox: {
        min: { x: Number.MAX_SAFE_INTEGER, z: Number.MAX_SAFE_INTEGER },
        max: { x: Number.MIN_SAFE_INTEGER, z: Number.MIN_SAFE_INTEGER },
        center: { x: 0, z: 0 },
        size: { x: 0, y: 0, z: 0 },
      },
    };
    return data;
  }

  /**
   * 创建梁
   * @param start - 梁中心线起点
   * @param end - 梁中心线终点
   * @param width - 梁宽度（默认 0.2m）
   * @param height - 梁高度（默认 0.3m）
   * @returns 新建梁 ID
   */
  public createBeam(
    start: Point2D,
    end: Point2D,
    width: number = BEAM_DEFAULTS.width,
    height: number = BEAM_DEFAULTS.height
  ): string {
    const data: BeamData = this.createBeamData(start, end, width, height);
    this.addObject(data);
    return data.id;
  }

  /**
   * 创建直墙
   * @param start - 起点
   * @param end - 终点
   * @param thickness - 厚度（默认 0.24m）
   * @param height - 高度（默认 2.8m）
   * @returns 新建的直墙 ID
   */
  public createStraightWall(
    start: Point2D,
    end: Point2D,
    thickness: number = WALL_DEFAULTS.thickness,
    height: number = WALL_DEFAULTS.height
  ): string {
    const data: StraightWallData = this.createStraightWallData(start, end, thickness, height);
    this.addObject(data);
    return data.id;
  }

  /**
   * 构造弧形墙数据但不加入场景
   * 用于命令模式先生成稳定 ID 与快照，再由命令统一 execute/undo。
   * @param start - 弧线起点
   * @param end - 弧线终点
   * @param bulge - 弧度因子（tan(angle/4)，正值左凸，负值右凸）
   * @param thickness - 厚度（默认 0.24m）
   * @param height - 高度（默认 2.8m）
   * @param segments - 弧线分段数（默认使用全局弧墙细分配置）
   * @returns 新建的弧形墙数据
   */
  public createArcWallData(
    start: Point2D,
    end: Point2D,
    bulge: number,
    thickness: number = WALL_DEFAULTS.thickness,
    height: number = WALL_DEFAULTS.height,
    segments: number = WALL_DEFAULTS.arcSegments
  ): ArcWallData {
    /* 弧墙布置关键流程：交互传入的弧线表示墙内侧面，入库前转换为内部几何仍使用的中心弧线。 */
    const centerArc: ArcWallCenterLine = WallPlacementLineConverter.convertInnerArcToCenterArc(
      start,
      end,
      bulge,
      thickness
    );
    this._wallCount += 1;
    const id: string = IdGenerator.generate('wall');
    const data: ArcWallData = {
      id: id,
      category: 'wall',
      subType: 'arc',
      name: `弧形墙-${this._wallCount}`,
      visible: true,
      locked: false,
      height: height,
      elevation: WALL_DEFAULTS.elevation,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      material: getDefaultMaterial('wall'),
      thickness: thickness,
      start: centerArc.start,
      end: centerArc.end,
      bulge: centerArc.bulge,
      segments: segments,
      boundingBox: {
        min: { x: Number.MAX_SAFE_INTEGER, z: Number.MAX_SAFE_INTEGER },
        max: { x: Number.MIN_SAFE_INTEGER, z: Number.MIN_SAFE_INTEGER },
        center: { x: 0, z: 0 },
        size: { x: 0, y: 0, z: 0 },
      },
    };
    return data;
  }

  /**
   * 创建弧形墙
   * @param start - 弧线起点
   * @param end - 弧线终点
   * @param bulge - 弧度因子（tan(angle/4)，正值左凸，负值右凸）
   * @param thickness - 厚度（默认 0.24m）
   * @param height - 高度（默认 2.8m）
   * @param segments - 弧线分段数（默认使用全局弧墙细分配置）
   * @returns 新建的弧形墙 ID
   */
  public createArcWall(
    start: Point2D,
    end: Point2D,
    bulge: number,
    thickness: number = WALL_DEFAULTS.thickness,
    height: number = WALL_DEFAULTS.height,
    segments: number = WALL_DEFAULTS.arcSegments
  ): string {
    const data: ArcWallData = this.createArcWallData(start, end, bulge, thickness, height, segments);
    this.addObject(data);
    return data.id;
  }

  /**
   * 构造矩形墙组数据但不加入场景
   * 返回四面子直墙与矩形墙父级数据，供命令模式原子提交。
   * @param corner1 - 矩形对角点 1
   * @param corner2 - 矩形对角点 2
   * @param thickness - 厚度
   * @param height - 高度
   * @returns 矩形墙父级与子墙数据
   */
  public createRectWallDataBundle(
    corner1: Point2D,
    corner2: Point2D,
    thickness: number = WALL_DEFAULTS.thickness,
    height: number = WALL_DEFAULTS.height
  ): { rect: RectWallData; children: [StraightWallData, StraightWallData, StraightWallData, StraightWallData] } {
    /* 矩形墙创建关键流程：对角点只定义室内净轮廓范围，子墙节点统一按顺时针生成。 */
    const innerEdges: ClockwiseRectInnerEdges = WallPlacementLineConverter.createClockwiseRectInnerEdges(corner1, corner2);
    const innerOutline: Point2D[] = [innerEdges.c1, innerEdges.c2, innerEdges.c3, innerEdges.c4];
    const centerLines: WallCenterLine[] = WallPlacementLineConverter.convertClosedInnerOutlineToCenterLines(
      innerOutline,
      thickness
    );
    const line1: WallCenterLine = centerLines[0]!;
    const line2: WallCenterLine = centerLines[1]!;
    const line3: WallCenterLine = centerLines[2]!;
    const line4: WallCenterLine = centerLines[3]!;

    /* 构造四面子直墙数据，暂不加入场景；内部数据仍保存中心线。 */
    const wall1: StraightWallData = this.createStraightWallData(line1.start, line1.end, thickness, height);
    const wall2: StraightWallData = this.createStraightWallData(line2.start, line2.end, thickness, height);
    const wall3: StraightWallData = this.createStraightWallData(line3.start, line3.end, thickness, height);
    const wall4: StraightWallData = this.createStraightWallData(line4.start, line4.end, thickness, height);

    /* 创建矩形墙组数据 */
    this._wallCount += 1;
    const rectId: string = IdGenerator.generate('rect-wall');
    const rectData: RectWallData = {
      id: rectId,
      category: 'wall',
      subType: 'rect',
      name: `矩形墙-${this._wallCount}`,
      visible: true,
      locked: false,
      height: height,
      elevation: WALL_DEFAULTS.elevation,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      material: getDefaultMaterial('wall'),
      thickness: thickness,
      corner1: corner1,
      corner2: corner2,
      childWallIds: [wall1.id, wall2.id, wall3.id, wall4.id],
      boundingBox: {
        min: { x: Number.MAX_SAFE_INTEGER, z: Number.MAX_SAFE_INTEGER },
        max: { x: Number.MIN_SAFE_INTEGER, z: Number.MIN_SAFE_INTEGER },
        center: { x: 0, z: 0 },
        size: { x: 0, y: 0, z: 0 },
      },
    };

    return { rect: rectData, children: [wall1, wall2, wall3, wall4] };
  }

  /**
   * 创建矩形墙（四面墙）
   * @param corner1 - 矩形对角点 1
   * @param corner2 - 矩形对角点 2
   * @param thickness - 厚度
   * @param height - 高度
   * @returns 矩形墙组 ID
   */
  public createRectWall(
    corner1: Point2D,
    corner2: Point2D,
    thickness: number = WALL_DEFAULTS.thickness,
    height: number = WALL_DEFAULTS.height
  ): string {
    const bundle: { rect: RectWallData; children: [StraightWallData, StraightWallData, StraightWallData, StraightWallData] } =
      this.createRectWallDataBundle(corner1, corner2, thickness, height);

    /* 先添加四面子墙，再添加矩形墙父级数据 */
    for (const child of bundle.children) {
      this.addObject(child);
    }
    this.addObject(bundle.rect);

    return bundle.rect.id;
  }

  /* ========== 序列化 ========== */

  /**
   * 导出所有对象为 JSON 可序列化数组
   */
  public serialize(): BuildingObject[] {
    return Array.from(this._objects.values());
  }

  /**
   * 从序列化数据恢复
   * @param data - 建筑对象数组
   */
  public deserialize(data: BuildingObject[]): void {
    /* 清空现有数据 */
    this.clear();

    /* 逐个添加 */
    for (const obj of data) {
      this.addObject(obj);
    }
  }

  /**
   * 创建楼板
   * 由封闭墙体围合的多边形轮廓自动生成，厚度默认 300mm
   * @param outline - XZ 平面多边形顶点数组（至少 3 个点）
   * @param slabThickness - 楼板厚度（米），默认 0.3
   * @returns 新建的楼板 ID
   */
  public createSlab(
    outline: Point2D[],
    slabThickness: number = 0.1,
    wallIds: string[] = [],
    boundaryDimensionSegments: SlabBoundaryDimensionSegment[] = this._surfaceService.createFallbackBoundaryDimensionSegments(outline),
    innerOutlines: Point2D[][] = []
  ): string {
    return this._surfaceService.createSlab(outline, slabThickness, wallIds, boundaryDimensionSegments, innerOutlines);
  }
  public refreshClosedSurfacesForWalls(wallIds: string[]): void {
    this._surfaceService.refreshClosedSurfacesForWalls(wallIds);
  }
  public clear(): void {
    /* 清理历史版本可能遗留的衔接线对象，避免对象清空后残留黑色粗线。 */
    this.refreshConnectionLines();

    /* 移除所有渲染实例 */
    this._meshes.forEach((_mesh: THREE.Mesh, id: string): void => {
      this._removeMeshFromScene(id);
    });
    this._objects.clear();
    this._meshes.clear();
    /* 清空连接拓扑 */
    this._connectionManager.clear();
    this._surfaceService.clearGeneratedSurfaceSignatures();
    this.refreshConnectionLines();
  }

  /* ========== 事件订阅 ========== */

  /**
   * 订阅对象变更事件
   * @param callback - 回调函数
   * @returns 取消订阅函数
   */
  public onChange(callback: BuildingObjectChangeCallback): () => void {
    this._listeners.add(callback);
    return (): void => {
      this._listeners.delete(callback);
    };
  }

  /**
   * 创建墙体的 Three.js Mesh 并加入场景。
   * 关键流程：委托 BuildingMeshFactory 按墙体类型创建 Mesh，本管理器仅负责场景登记与包围盒同步。
   * @param data - 墙体数据。
   */
  private _createWallMesh(data: WallData): void {
    const mesh: THREE.Mesh | null = BuildingMeshFactory.createWallMesh(data, {
      wallBuilder: this._wallBuilder,
      connectionManager: this._connectionManager,
      getWallEndpoints: this._getWallEndpointsCallback(),
      getWallEndpointDirection: this._getWallEndpointDirectionCallback(),
      createMaterial: (props: MaterialProperties): THREE.Material => this._createMaterialFromProperties(props),
      createFilteredEdges: (
        geometry: THREE.BufferGeometry,
        excludeGroupIndices?: number[],
        hideArcSegmentVerticalEdges?: boolean
      ): THREE.LineSegments | null => this._createFilteredEdges(geometry, excludeGroupIndices, hideArcSegmentVerticalEdges),
      wallFaceCount: BuildingObjectManager.WALL_FACE_COUNT,
      wallFaceCountWithOpening: BuildingObjectManager.WALL_FACE_COUNT_WITH_OPENING,
    });

    if (mesh === null) {
      return;
    }

    this._sceneManager.add(mesh);
    this._meshes.set(data.id, mesh);
    this._computeAndStoreBoundingBox(data, mesh);
  }

  /**
   * 创建梁的 Three.js Mesh 并加入场景。
   * 关键流程：委托 BuildingMeshFactory 创建梁实体，本管理器仅负责场景登记与包围盒同步。
   * @param data - 梁构件数据。
   */
  private _createBeamMesh(data: BeamData): void {
    const mesh: THREE.Mesh = BuildingMeshFactory.createBeamMesh(data, {
      beamBuilder: this._beamBuilder,
      beamMiterCalculator: this._beamMiterCalculator,
      getAllBeamData: (): BeamData[] => this._getAllBeamData(),
      createMaterial: (props: MaterialProperties): THREE.Material => this._createMaterialFromProperties(props),
      createFilteredEdges: (
        geometry: THREE.BufferGeometry,
        excludeGroupIndices?: number[],
        hideArcSegmentVerticalEdges?: boolean
      ): THREE.LineSegments | null => this._createFilteredEdges(geometry, excludeGroupIndices, hideArcSegmentVerticalEdges),
    });

    this._sceneManager.add(mesh);
    this._meshes.set(data.id, mesh);
    this._computeAndStoreBoundingBox(data, mesh);
  }

  /**
   * 获取当前场景内所有梁数据
   * @returns 梁数据数组
   */
  private _getAllBeamData(): BeamData[] {
    const beams: BeamData[] = [];
    this._objects.forEach((object: BuildingObject): void => {
      if (object.category === 'beam') {
        beams.push(object as BeamData);
      }
    });
    return beams;
  }

  /**
   * 收集梁端点衔接节点，并转换为墙衔接节点渲染器可复用的节点对象。
   * 关键流程：遍历全部梁的起终点，按梁斜接相同容差聚合重合端点，只保留至少两条梁端点共享的节点。
   * @returns 与 WallJoint 结构兼容的梁衔接节点列表
   */
  private _collectBeamJointNodes(): WallJoint[] {
    return this._beamService.collectBeamJointNodes();
  }

  /**
   * 重建指定梁集合
   * @param beamIds - 需要重建的梁 ID 集合
   */
  private _rebuildBeamSet(beamIds: Set<string>): void {
    beamIds.forEach((beamId: string): void => {
      const object: BuildingObject | undefined = this._objects.get(beamId);
      if (object === undefined || object.category !== 'beam') {
        return;
      }

      this._removeMeshFromScene(beamId);
      this._createBeamMesh(object as BeamData);
    });
  }

  /**
   * 重建与指定梁共享端点的相邻梁
   * @param beamId - 触发重建的梁 ID
   */
  private _rebuildAdjacentBeams(beamId: string): void {
    const object: BuildingObject | undefined = this._objects.get(beamId);
    if (object === undefined || object.category !== 'beam') {
      return;
    }

    const adjacentIds: Set<string> = this._beamMiterCalculator.collectAdjacentBeamIds(
      object as BeamData,
      this._getAllBeamData()
    );
    adjacentIds.delete(beamId);
    this._rebuildBeamSet(adjacentIds);
  }
  /**
     * 计算几何体包围盒并存储到对象数据中
     * 用于支持选择/碰撞检测和未来的布尔运算
     * @param data - 建筑对象数据
     * @param mesh - 对应的 Three.js Mesh
     */
  private _computeAndStoreBoundingBox(data: BuildingObject, mesh: THREE.Mesh): void {
    /* 计算 Mesh 的世界包围盒 */
    const box: THREE.Box3 = new THREE.Box3().setFromObject(mesh);

    /* 转换为 Point2D 格式存储 */
    data.boundingBox = {
      min: { x: box.min.x, z: box.min.z },
      max: { x: box.max.x, z: box.max.z },
      center: { x: box.max.x - (box.max.x - box.min.x) / 2, z: box.max.z - (box.max.z - box.min.z) / 2 },
      size: {
        x: box.max.x - box.min.x,
        y: box.max.y - box.min.y,
        z: box.max.z - box.min.z,
      },
    };
  }

  /**
   * 从场景移除 Mesh 并释放几何体和独立材质资源
   */
  private _removeMeshFromScene(id: string): void {
    const mesh: THREE.Mesh | undefined = this._meshes.get(id);
    if (mesh !== undefined) {
      this._sceneManager.remove(mesh);

      /* 释放线框子对象资源：固定像素线段使用自定义 Mesh，需要在父 Mesh 销毁前显式释放几何体和材质。 */
      mesh.children.forEach((child: THREE.Object3D): void => {
        if (child.userData['isWireframe'] === true) {
          this._disposeWireframeObject(child);
        }
      });

      mesh.geometry.dispose();

      /* 释放独立材质（支持单材质和材质数组两种情况） */
      if (Array.isArray(mesh.material)) {
        for (const mat of mesh.material as Array<THREE.Material>) {
          mat.dispose();
        }
      } else if (mesh.material instanceof THREE.Material) {
        mesh.material.dispose();
      }

      this._meshes.delete(id);
    }
  }

  /**
   * 刷新建筑衔接线显示
   * 衔接线功能已停用：仅清理历史版本可能遗留的衔接线根节点或线段对象，不再生成任何新线段。
   */
  public refreshConnectionLines(): void {
    const scene: THREE.Scene = this._sceneManager.getScene();
    const staleObjects: THREE.Object3D[] = [];

    /* 遍历场景并收集旧衔接线对象，统一在遍历完成后移除，避免遍历过程中修改层级结构。 */
    scene.traverse((child: THREE.Object3D): void => {
      if (child.name === 'BuildingConnectionLines' || child.userData['isBuildingConnectionLine'] === true) {
        staleObjects.push(child);
      }
    });

    for (const staleObject of staleObjects) {
      /* 移除前释放几何体和材质资源，避免旧衔接线对象造成显存泄漏。 */
      staleObject.traverse((child: THREE.Object3D): void => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          const renderObject: THREE.Mesh | THREE.LineSegments = child as THREE.Mesh | THREE.LineSegments;
          renderObject.geometry.dispose();
          if (Array.isArray(renderObject.material)) {
            for (const material of renderObject.material as THREE.Material[]) {
              material.dispose();
            }
          } else if (renderObject.material instanceof THREE.Material) {
            renderObject.material.dispose();
          }
        }
      });

      if (staleObject.parent !== null) {
        staleObject.parent.remove(staleObject);
      }
    }

    /* 节点显示流程：衔接线停用后，墙节点与梁节点统一转换为 WallJoint 兼容对象并使用同一个圆片渲染器。 */
    const wallJoints: WallJoint[] = this._collectRenderableWallJointNodes();
    const beamJoints: WallJoint[] = this._collectBeamJointNodes();
    const allJointNodes: WallJoint[] = [...wallJoints, ...beamJoints];
    this._wallJointNodeRenderer.refresh(allJointNodes);
  }

  /**
   * 收集允许显示圆片的墙体衔接节点。
   * 弧形墙端点衔接处由弧形轮廓自身表达，不显示额外圆片，避免在弧形墙衔接处产生视觉干扰。
   * @returns 过滤后的墙体衔接节点列表
   */
  private _collectRenderableWallJointNodes(): WallJoint[] {
    const joints: WallJoint[] = this._connectionManager.getAllJoints();
    const renderableJoints: WallJoint[] = [];

    for (const joint of joints) {
      if (this._isWallJointConnectedToArcWall(joint)) {
        /* 连接到弧形墙时跳过圆片渲染，保留连接拓扑但不显示节点圆片。 */
        continue;
      }
      renderableJoints.push(joint);
    }

    return renderableJoints;
  }

  /**
   * 判断墙体衔接节点是否连接到了弧形墙。
   * @param joint - 待判断的墙体衔接节点
   * @returns 连接到任意弧形墙时返回 true
   */
  private _isWallJointConnectedToArcWall(joint: WallJoint): boolean {
    for (const connection of joint.connections) {
      const object: BuildingObject | undefined = this._objects.get(connection.wallId);
      if (object !== undefined && object.category === 'wall' && object.subType === 'arc') {
        return true;
      }
    }

    return false;
  }

  /**
   * 设置墙衔接节点圆片显隐状态。
   * @param visible - true 表示在 2D 平面显示节点，false 表示隐藏
   */
  public setWallJointNodesVisible(visible: boolean): void {
    this._wallJointNodeRenderer.setVisible(visible);
  }

  /* ========== 洞口预览、视觉样式与线框门面 ========== */

  /**
   * 临时用指定洞口列表重建墙体 Mesh 的几何体，用于门窗布置时的洞口预览。
   * @param wallId - 目标墙体 ID。
   * @param previewOpenings - 预览用洞口列表。
   * @returns 成功替换预览几何体时返回 true。
   */
  public previewOpeningOnMesh(wallId: string, previewOpenings: WallOpening[]): boolean {
    return this._openingPreviewService.previewOpeningOnMesh(wallId, previewOpenings);
  }

  /**
   * 恢复指定墙体的真实洞口几何体。
   * @param wallId - 目标墙体 ID。
   */
  public clearOpeningPreview(wallId: string): void {
    this._openingPreviewService.clearOpeningPreview(wallId);
  }

  /**
   * 将指定墙体 Mesh 的所有材质设置为半透明。
   * @param wallId - 目标墙体 ID。
   * @param opacity - 透明度，取值范围 0~1。
   */
  public setWallTransparent(wallId: string, opacity: number = 0.3): void {
    this._visualStyleService.setWallTransparent(wallId, opacity);
  }

  /**
   * 批量设置指定类别所有对象的材质透明度。
   * @param category - 建筑对象类别。
   * @param opacity - 透明度，1 表示完全不透明。
   */
  public setCategoryOpacity(category: BuildingCategory, opacity: number): void {
    this._visualStyleService.setCategoryOpacity(category, opacity);
  }

  /**
   * 批量设置指定类别所有对象的临时颜色和透明度。
   * @param category - 建筑对象类别。
   * @param color - 临时显示颜色。
   * @param opacity - 临时透明度。
   */
  public setCategoryVisualStyle(category: BuildingCategory, color: number, opacity: number): void {
    this._visualStyleService.setCategoryVisualStyle(category, color, opacity);
  }

  /**
   * 按对象真实材质数据恢复指定类别的渲染材质显示状态。
   * @param category - 建筑对象类别。
   */
  public restoreCategoryVisualStyle(category: BuildingCategory): void {
    this._visualStyleService.restoreCategoryVisualStyle(category);
  }

  /**
   * 批量设置指定类别所有对象的 Mesh 可见性。
   * @param category - 建筑对象类别。
   * @param visible - true 表示显示，false 表示隐藏。
   */
  public setCategoryVisible(category: BuildingCategory, visible: boolean): void {
    this._visualStyleService.setCategoryVisible(category, visible);
  }

  /**
   * 恢复指定墙体 Mesh 的材质为完全不透明。
   * @param wallId - 目标墙体 ID。
   */
  public restoreWallOpacity(wallId: string): void {
    this._visualStyleService.restoreWallOpacity(wallId);
  }

  /**
   * 隐藏所有 Mesh 的线框子对象。
   */
  public hideAllWireframes(): void {
    this._wireframeService.hideAllWireframes();
  }

  /**
   * 恢复所有 Mesh 的线框子对象。
   */
  public restoreAllWireframes(): void {
    this._wireframeService.restoreAllWireframes();
  }


  /**
   * 创建 getWallEndpoints 回调函数
   * 供 WallConnectionManager.computeMiterForWall 使用
   * 根据 wallId 查找墙体数据并返回起点、终点和厚度
   */
  private _getWallEndpointsCallback(): (id: string) => { start: Point2D; end: Point2D; thickness: number } | null {
    return (id: string): { start: Point2D; end: Point2D; thickness: number } | null => {
      const obj: BuildingObject | undefined = this._objects.get(id);
      if (obj === undefined || obj.category !== 'wall') {
        return null;
      }
      const wallData: WallData = obj as WallData;
      /* 矩形墙没有 start/end */
      if (wallData.subType === 'rect') {
        return null;
      }
      return {
        start: wallData.start,
        end: wallData.end,
        thickness: wallData.thickness,
      };
    };
  }

  /**
   * 获取墙体端点向墙体内部延伸的单位方向。
   * 直墙使用起终点连线方向；弧形墙使用端点处中心弧线切线，供衔接裁剪计算斜切平面。
   * @returns 根据墙体 ID 查询端点内部方向的回调函数；墙体不存在或为矩形墙时返回 null。
   */
  private _getWallEndpointDirectionCallback(): (id: string) => WallEndpointDirection | null {
    return (id: string): WallEndpointDirection | null => {
      const obj: BuildingObject | undefined = this._objects.get(id);
      if (obj === undefined || obj.category !== 'wall') {
        return null;
      }

      const wallData: WallData = obj as WallData;
      if (wallData.subType === 'rect') {
        return null;
      }

      if (wallData.subType === 'arc') {
        return this._computeArcWallEndpointDirection(wallData);
      }

      const dx: number = wallData.end.x - wallData.start.x;
      const dz: number = wallData.end.z - wallData.start.z;
      const length: number = Math.sqrt(dx * dx + dz * dz);
      if (length < 0.001) {
        return null;
      }

      const dirX: number = dx / length;
      const dirZ: number = dz / length;
      return {
        startInwardDir: { x: dirX, z: dirZ },
        endInwardDir: { x: -dirX, z: -dirZ },
      };
    };
  }

  /**
   * 计算弧形墙起点/终点沿中心弧线切线进入墙体内部的单位方向。
   * @param data - 弧形墙数据，包含中心弧线起终点、bulge 和分段数。
   * @returns 弧形墙两个端点的内部方向；退化为直线时回退到弦线方向。
   */
  private _computeArcWallEndpointDirection(data: ArcWallData): WallEndpointDirection | null {
    const segments: number = Math.max(2, data.segments);
    const centerPoints: Point2D[] = this._computeArcCenterPoints(data.start, data.end, data.bulge, segments);
    if (centerPoints.length < 2) {
      return null;
    }

    const firstPoint: Point2D = centerPoints[0]!;
    const secondPoint: Point2D = centerPoints[1]!;
    const startDirX: number = secondPoint.x - firstPoint.x;
    const startDirZ: number = secondPoint.z - firstPoint.z;
    const startLength: number = Math.sqrt(startDirX * startDirX + startDirZ * startDirZ);

    const lastIndex: number = centerPoints.length - 1;
    const previousPoint: Point2D = centerPoints[lastIndex - 1]!;
    const lastPoint: Point2D = centerPoints[lastIndex]!;
    const endDirX: number = previousPoint.x - lastPoint.x;
    const endDirZ: number = previousPoint.z - lastPoint.z;
    const endLength: number = Math.sqrt(endDirX * endDirX + endDirZ * endDirZ);

    if (startLength < 0.001 || endLength < 0.001) {
      return null;
    }

    return {
      startInwardDir: { x: startDirX / startLength, z: startDirZ / startLength },
      endInwardDir: { x: endDirX / endLength, z: endDirZ / endLength },
    };
  }

  /**
   * 依据 bulge 参数采样弧形墙中心线点。
   * 该算法与 WallGeometryBuilder 内部弧线采样保持一致，用于让连接裁剪与实际弧墙网格端点切线一致。
   * @param start - 弧线起点。
   * @param end - 弧线终点。
   * @param bulge - 弧度因子，tan(圆心角 / 4)。
   * @param segments - 弧线分段数。
   * @returns 中心线采样点数组。
   */
  private _computeArcCenterPoints(start: Point2D, end: Point2D, bulge: number, segments: number): Point2D[] {
    const points: Point2D[] = [];

    /* bulge 接近 0 时视为直线，避免圆心计算数值不稳定。 */
    if (Math.abs(bulge) < 0.001) {
      for (let pointIndex: number = 0; pointIndex <= segments; pointIndex++) {
        const t: number = pointIndex / segments;
        points.push({
          x: start.x + (end.x - start.x) * t,
          z: start.z + (end.z - start.z) * t,
        });
      }
      return points;
    }

    const chordX: number = end.x - start.x;
    const chordZ: number = end.z - start.z;
    const chordLength: number = Math.sqrt(chordX * chordX + chordZ * chordZ);
    if (chordLength < 0.001) {
      return [start];
    }

    const sagitta: number = (bulge * chordLength) / 2;
    const radius: number = (chordLength * chordLength / 4 + sagitta * sagitta) / (2 * Math.abs(sagitta));
    const midX: number = (start.x + end.x) / 2;
    const midZ: number = (start.z + end.z) / 2;
    const perpX: number = -chordZ / chordLength;
    const perpZ: number = chordX / chordLength;
    const centerOffset: number = radius - Math.abs(sagitta);
    const centerSign: number = bulge > 0 ? 1 : -1;
    const centerX: number = midX + perpX * centerOffset * centerSign;
    const centerZ: number = midZ + perpZ * centerOffset * centerSign;
    const startAngle: number = Math.atan2(start.z - centerZ, start.x - centerX);
    const endAngle: number = Math.atan2(end.z - centerZ, end.x - centerX);

    let deltaAngle: number = endAngle - startAngle;
    if (bulge > 0 && deltaAngle < 0) {
      deltaAngle += Math.PI * 2;
    } else if (bulge < 0 && deltaAngle > 0) {
      deltaAngle -= Math.PI * 2;
    }

    for (let pointIndex: number = 0; pointIndex <= segments; pointIndex++) {
      const t: number = pointIndex / segments;
      const angle: number = startAngle + deltaAngle * t;
      points.push({
        x: centerX + Math.cos(angle) * radius,
        z: centerZ + Math.sin(angle) * radius,
      });
    }

    return points;
  }

  /**
   * 创建天花板
   * 由封闭墙体围合的多边形外边界轮廓向上挤压生成，厚度默认 200mm
   * 天花板底面贴合墙顶（bottomOffset = 墙高，默认 3.0m）
   * @param outline - XZ 平面多边形顶点数组（至少 3 个点，外边界）
   * @param ceilingThickness - 天花板厚度（米），默认 0.2
   * @param bottomOffset - 天花板底面高度（米），默认 3.0
   * @param wallIds - 关联的墙体 ID 列表（围合该天花板的墙体），可选
   * @returns 新建的天花板 ID
   */
  public createCeiling(
    outline: Point2D[],
    ceilingThickness: number = 0.1,
    bottomOffset: number = 2.8,
    wallIds: string[] = []
  ): string {
    return this._surfaceService.createCeiling(outline, ceilingThickness, bottomOffset, wallIds);
  }

  /**
   * 通知所有监听器
   */
  private _notify(objectId: string, action: 'add' | 'remove' | 'update'): void {
    this._listeners.forEach((cb: BuildingObjectChangeCallback): void => {
      cb(objectId, action);
    });
  }

  /**
   * 销毁管理器，释放所有渲染资源
   * 独立材质已在 _removeMeshFromScene 中逐个释放
   */
  public dispose(): void {
    this.clear();
    this._wallJointNodeRenderer.dispose();
    this._listeners.clear();
  }
}
