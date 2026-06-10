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
  SlabData,
  CeilingData,
  BeamData,
  Point2D,
  MaterialProperties,
  MiterParams,
  WallConnection,
  WallJoint,
  WallOpening,
  WallEndpoint,
} from './BuildingTypes';
import { WALL_DEFAULTS, SLAB_DEFAULTS, CEILING_DEFAULTS, BEAM_DEFAULTS, getDefaultMaterial } from './BuildingTypes';
import { WallGeometryBuilder } from './WallGeometryBuilder';
import { BeamGeometryBuilder } from './BeamGeometryBuilder';
import { SlabGeometryBuilder } from './SlabGeometryBuilder';
import { CeilingGeometryBuilder } from './CeilingGeometryBuilder';
import { WallConnectionManager } from './WallConnectionManager';
import { BeamMiterCalculator } from './BeamMiterCalculator';
import { IdGenerator } from './IdGenerator';
import { WallPlacementLineConverter } from './WallPlacementLineConverter';
import type { ClockwiseRectInnerEdges, WallCenterLine } from './WallPlacementLineConverter';
import type { SceneManager } from '../scene/SceneManager';
import { StlAdaptiveThicknessHelper } from '../model/StlAdaptiveThicknessHelper';

/**
 * 建筑对象变更事件回调
 */
export type BuildingObjectChangeCallback = (objectId: string, action: 'add' | 'remove' | 'update') => void;

/**
 * 楼板/天花板自动生成签名缓存快照
 * 用于历史命令在撤销/重做时恢复自动生成去重状态，避免同一封闭环重复生成或无法再次生成。
 */
export interface GeneratedSurfaceSignatureSnapshot {
  /** 已生成楼板的封闭环签名列表 */
  slabSignatures: string[];
  /** 已生成天花板的封闭环签名列表 */
  ceilingSignatures: string[];
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

/**
 * 建筑对象管理器
 */
export class BuildingObjectManager {
  /** 墙体拖拽几何计算容差。 */
  private static readonly WALL_DRAG_EPSILON: number = 0.000001;

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

  /** 梁斜接计算器（梁拥有独立连接逻辑，不复用墙体拓扑） */
  private _beamMiterCalculator: BeamMiterCalculator = new BeamMiterCalculator();

  /** 楼板几何构建器 */
  private _slabBuilder: SlabGeometryBuilder = new SlabGeometryBuilder();

  /** 天花板几何构建器 */
  private _ceilingBuilder: CeilingGeometryBuilder = new CeilingGeometryBuilder();

  /** 墙体连接管理器（端点吸附+拓扑） */
  private _connectionManager: WallConnectionManager = new WallConnectionManager();

  /** 楼板计数器（用于自动命名） */
  private _slabCount: number = 0;

  /**
   * 已生成楼板的封闭环签名集合
   * 签名 = 轮廓节点坐标排序后的字符串，用于防止同一封闭环重复生成楼板
   */
  private _generatedSlabSignatures: Set<string> = new Set<string>();

  /** 天花板计数器（用于自动命名） */
  private _ceilingCount: number = 0;

  /**
   * 已生成天花板的封闭环签名集合
   * 签名与楼板签名相同格式，防止同一封闭环重复生成天花板
   */
  private _generatedCeilingSignatures: Set<string> = new Set<string>();

  /** 变更事件监听器 */
  private _listeners: Set<BuildingObjectChangeCallback> = new Set();

  /** 对象计数器（用于自动命名） */
  private _wallCount: number = 0;

  /** 梁计数器（用于自动命名） */
  private _beamCount: number = 0;

  /**
   * @param sceneManager - 场景管理器
   */
  constructor(sceneManager: SceneManager) {
    this._sceneManager = sceneManager;
  }

  /**
   * 获取墙体连接管理器（供 WallDrawTool 等外部模块访问）
   */
  public get connectionManager(): WallConnectionManager {
    return this._connectionManager;
  }

  /**
   * 获取楼板/天花板自动生成签名缓存快照
   * @returns 当前自动生成去重签名缓存的深拷贝快照
   */
  public getGeneratedSurfaceSignatureSnapshot(): GeneratedSurfaceSignatureSnapshot {
    return {
      slabSignatures: Array.from(this._generatedSlabSignatures.values()),
      ceilingSignatures: Array.from(this._generatedCeilingSignatures.values()),
    };
  }

  /**
   * 恢复楼板/天花板自动生成签名缓存
   * @param snapshot - 需要恢复的签名缓存快照
   */
  public restoreGeneratedSurfaceSignatureSnapshot(snapshot: GeneratedSurfaceSignatureSnapshot): void {
    /* 撤销/重做流程会直接增删楼板与天花板对象，因此必须同步恢复去重缓存，避免重复自动生成。 */
    this._generatedSlabSignatures = new Set<string>(snapshot.slabSignatures);
    this._generatedCeilingSignatures = new Set<string>(snapshot.ceilingSignatures);
  }

  /* ========== 材质工厂方法 ========== */

  /**
   * 根据 MaterialProperties 创建独立的 Three.js Material 实例
   * 每个渲染对象拥有独立材质，支持个性化颜色和属性
   * @param props - 材质属性
   * @returns Three.js Material 实例
   */
  private _createMaterialFromProperties(props: MaterialProperties): THREE.Material {
    const isTransparent: boolean = props.opacity < 1.0;

    if (props.materialType === 'basic') {
      return new THREE.MeshBasicMaterial({
        color: props.color,
        opacity: props.opacity,
        transparent: isTransparent,
        side: THREE.DoubleSide,
      });
    }

    /* standard 和 physical 都使用 MeshStandardMaterial */
    return new THREE.MeshStandardMaterial({
      color: props.color,
      metalness: props.metalness,
      roughness: props.roughness,
      opacity: props.opacity,
      transparent: isTransparent,
      side: THREE.DoubleSide,
    });
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
        this._connectionManager.registerWall(wallData.id, wallData.start, wallData.end);

        /* 注册后重建自身（应用 miter 偏移）和相邻墙体 */
        if (wallData.subType === 'straight') {
          this._removeMeshFromScene(wallData.id);
          this._createWallMesh(wallData);
        }
        this._rebuildAdjacentWalls(wallData.id);

        /* 检测封闭环，若形成封闭区域则自动生成楼板 */
        this._tryAutoGenerateSlab(wallData.id);
      }
    } else if (data.category === 'slab') {
      /* 历史命令重做或反序列化时可能直接恢复楼板对象，需要同步创建渲染实例。 */
      this._createSlabMesh(data as SlabData);
    } else if (data.category === 'beam') {
      /* 梁使用独立线式布置数据与几何构建逻辑，不参与墙体连接拓扑。 */
      this._createBeamMesh(data as BeamData);
      this._rebuildAdjacentBeams((data as BeamData).id);
    } else if (data.category === 'ceiling') {
      const ceilingData: CeilingData = data as CeilingData;
      /* 历史命令重做或反序列化时可能直接恢复天花板对象，需要同步创建渲染实例并恢复墙体绑定。 */
      this._createCeilingMesh(ceilingData);
      if (ceilingData.wallIds.length > 0) {
        this._syncWallsToCeiling(ceilingData.id, ceilingData.wallIds, ceilingData.bottomOffset);
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
   * 创建过滤后的边界线段（排除共面边）
   *
   * 算法说明：
   * CSG 开洞后，同一大面被切割成多个三角形，这些三角形之间的边虽然共面，
   * 但由于顶点重复（坐标相同但索引不同），基于索引的共享边检测会失败。
   *
   * 本方法采用"逻辑顶点ID"方案：
   * 1. 预建坐标→逻辑ID映射，将坐标相同的顶点归为同一逻辑顶点
   * 2. 建立逻辑边→共享面法向量列表的映射（O(n) 查表，替代 O(n²) 遍历）
   * 3. 过滤掉所有共面边（法向量夹角余弦 > threshold），保留折角边和边界边
   *
   * @param geometry - 几何体（需有 index）
   * @param excludeGroupIndices - 需要排除的 materialIndex 列表（这些面的边不参与计算，不出现在线框中）
   *   用于排除洞口内壁面（materialIndex=2），避免内壁边产生竖线
   * @returns LineSegments 或 null（无有效边时）
   */
  private _createFilteredEdges(
    geometry: THREE.BufferGeometry,
    excludeGroupIndices: number[] = []
  ): THREE.LineSegments | null {
    /* 获取顶点位置属性（强制转换为 BufferAttribute，InterleavedBufferAttribute 同样支持 getX/Y/Z） */
    const positionAttribute: THREE.BufferAttribute = geometry.getAttribute('position') as THREE.BufferAttribute;
    if (positionAttribute === undefined || positionAttribute === null) {
      return null;
    }

    const indices: THREE.BufferAttribute | null = geometry.getIndex();
    if (indices === null) {
      return null;
    }

    /* 共面判断阈值：法向量点积 > 0.999 视为共面（夹角 < 约 2.6°） */
    const threshold: number = 0.999;
    const totalVertices: number = positionAttribute.count;
    const count: number = indices.count;

    /* ── 第一步：建立物理顶点索引 → 逻辑顶点ID 的映射 ──
     * 坐标相同的顶点归为同一逻辑顶点，解决 CSG 重复顶点问题
     */
    const coordToLogicalId: Map<string, number> = new Map<string, number>();
    const physicalToLogical: number[] = new Array<number>(totalVertices);
    let logicalVertexCount: number = 0;

    for (let i: number = 0; i < totalVertices; i++) {
      /* 用 6 位小数精度作为坐标 key，容忍浮点误差 */
      const coordKey: string =
        `${positionAttribute.getX(i).toFixed(6)},` +
        `${positionAttribute.getY(i).toFixed(6)},` +
        `${positionAttribute.getZ(i).toFixed(6)}`;

      let logicalId: number | undefined = coordToLogicalId.get(coordKey);
      if (logicalId === undefined) {
        logicalId = logicalVertexCount;
        coordToLogicalId.set(coordKey, logicalId);
        logicalVertexCount++;
      }
      physicalToLogical[i] = logicalId;
    }

    /* ── 第二步：预计算所有面的法向量，并建立逻辑边 → 面法向量列表的映射 ──
     * 逻辑边 key = "min(logA,logB)-max(logA,logB)"
     * 值 = 所有共享该逻辑边的面的法向量数组
     */
    const edgeToNormals: Map<string, THREE.Vector3[]> = new Map<string, THREE.Vector3[]>();

    /* 同时记录每条逻辑边对应的一个物理顶点对（用于最终输出坐标） */
    const edgeToPhysical: Map<string, [number, number]> = new Map<string, [number, number]>();

    /* 预建三角形索引 → materialIndex 的映射（用于排除指定面的边）
     * 遍历 geometry.groups，每个 group 覆盖 [start, start+count) 范围内的索引
     * 三角形 i 对应的索引范围为 [i, i+2]，取 i 所在的 group 即可
     */
    const triangleToMaterialIndex: Map<number, number> = new Map<number, number>();
    if (excludeGroupIndices.length > 0) {
      for (const group of geometry.groups) {
        /* group.start 和 group.count 是索引数量（每个三角形 3 个索引） */
        const groupEnd: number = group.start + group.count;
        for (let idx: number = group.start; idx < groupEnd; idx += 3) {
          triangleToMaterialIndex.set(idx, group.materialIndex ?? 0);
        }
      }
    }

    for (let i: number = 0; i < count; i += 3) {
      /* 若当前三角形属于需要排除的 materialIndex，跳过（不参与边计算） */
      if (excludeGroupIndices.length > 0) {
        const matIdx: number | undefined = triangleToMaterialIndex.get(i);
        if (matIdx !== undefined && excludeGroupIndices.includes(matIdx)) {
          continue;
        }
      }

      const physA: number = indices.getX(i);
      const physB: number = indices.getX(i + 1);
      const physC: number = indices.getX(i + 2);

      /* 计算面法向量 */
      const vA: THREE.Vector3 = new THREE.Vector3(
        positionAttribute.getX(physA),
        positionAttribute.getY(physA),
        positionAttribute.getZ(physA)
      );
      const vB: THREE.Vector3 = new THREE.Vector3(
        positionAttribute.getX(physB),
        positionAttribute.getY(physB),
        positionAttribute.getZ(physB)
      );
      const vC: THREE.Vector3 = new THREE.Vector3(
        positionAttribute.getX(physC),
        positionAttribute.getY(physC),
        positionAttribute.getZ(physC)
      );
      const normal: THREE.Vector3 = new THREE.Vector3()
        .crossVectors(
          new THREE.Vector3().subVectors(vB, vA),
          new THREE.Vector3().subVectors(vC, vA)
        )
        .normalize();

      /* 转换为逻辑顶点ID */
      const logA: number = physicalToLogical[physA]!;
      const logB: number = physicalToLogical[physB]!;
      const logC: number = physicalToLogical[physC]!;

      /* 遍历该面的三条逻辑边，将法向量注册到映射表 */
      const faceLogEdges: Array<[number, number]> = [[logA, logB], [logB, logC], [logC, logA]];
      const facePhysEdges: Array<[number, number]> = [[physA, physB], [physB, physC], [physC, physA]];

      for (let e: number = 0; e < 3; e++) {
        const [la, lb]: [number, number] = faceLogEdges[e]!;
        /* 无向边 key：小ID在前，确保同一条边两个方向映射到同一个 key */
        const eKey: string = la < lb ? `${la}-${lb}` : `${lb}-${la}`;

        /* 注册法向量 */
        let normals: THREE.Vector3[] | undefined = edgeToNormals.get(eKey);
        if (normals === undefined) {
          normals = [];
          edgeToNormals.set(eKey, normals);
          /* 记录物理顶点对（只需记录第一次出现的，用于输出坐标） */
          edgeToPhysical.set(eKey, facePhysEdges[e]!);
        }
        normals.push(normal);
      }
    }

    /* ── 第三步：过滤共面边，收集需要显示的边 ──
     * 边界边（只有 1 个面共享）：一定显示
     * 内部边（≥2 个面共享）：若所有相邻面对均共面则隐藏，否则显示
     */
    const visibleEdges: Array<[number, number]> = [];

    edgeToNormals.forEach((normals: THREE.Vector3[], eKey: string): void => {
      /* 边界边：只有一个面，直接显示 */
      if (normals.length === 1) {
        const physPair: [number, number] | undefined = edgeToPhysical.get(eKey);
        if (physPair !== undefined) {
          visibleEdges.push(physPair);
        }
        return;
      }

      /* 内部边：检查所有相邻面对是否共面 */
      let isCoplanar: boolean = false;
      outer: for (let m: number = 0; m < normals.length - 1; m++) {
        for (let n: number = m + 1; n < normals.length; n++) {
          const cosAngle: number = Math.abs(normals[m]!.dot(normals[n]!));
          if (cosAngle > threshold) {
            /* 找到一对共面的相邻面，标记为共面边 */
            isCoplanar = true;
            break outer;
          }
        }
      }

      /* 非共面边（折角边）：显示 */
      if (!isCoplanar) {
        const physPair: [number, number] | undefined = edgeToPhysical.get(eKey);
        if (physPair !== undefined) {
          visibleEdges.push(physPair);
        }
      }
    });

    if (visibleEdges.length === 0) {
      return null;
    }

    /* ── 第四步：构建 LineSegments 几何体 ── */
    const vertices: Float32Array = new Float32Array(visibleEdges.length * 6);
    for (let i: number = 0; i < visibleEdges.length; i++) {
      const [startIdx, endIdx]: [number, number] = visibleEdges[i]!;
      vertices[i * 6]     = positionAttribute.getX(startIdx);
      vertices[i * 6 + 1] = positionAttribute.getY(startIdx);
      vertices[i * 6 + 2] = positionAttribute.getZ(startIdx);
      vertices[i * 6 + 3] = positionAttribute.getX(endIdx);
      vertices[i * 6 + 4] = positionAttribute.getY(endIdx);
      vertices[i * 6 + 5] = positionAttribute.getZ(endIdx);
    }

    /* 使用 WebGPU 兼容的 LineSegments 创建线框。
     * 注意：LineBasicMaterial.linewidth 在多数浏览器中固定为 1px，若需要粗线需改为 Mesh 化线框。
     */
    const lineSegGeom: THREE.BufferGeometry = new THREE.BufferGeometry();
    lineSegGeom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

    const wireframeMaterial: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
      color: 0x333333,
      depthTest: true,
      depthWrite: false,
    });

    const lines: THREE.LineSegments = new THREE.LineSegments(lineSegGeom, wireframeMaterial);
    /* 标记为线框对象，供 hideAllWireframes / restoreAllWireframes 识别 */
    lines.userData['isWireframe'] = true;
    return lines;
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

    /* 如果是矩形墙，同时移除子墙及其连接 */
    if (obj.category === 'wall' && (obj as WallData).subType === 'rect') {
      const rectWall: RectWallData = obj as RectWallData;
      for (const childId of rectWall.childWallIds) {
        this._connectionManager.disconnectWall(childId);
        this._removeMeshFromScene(childId);
        this._objects.delete(childId);
      }
    }

    /* 断开墙体连接 */
    if (obj.category === 'wall') {
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
      this._createWallMesh(updated as WallData);
    } else if (updated.category === 'slab') {
      /* 楼板：_createSlabMesh 内部已设置 mesh.position.y = topOffset - slabThickness */
      this._createSlabMesh(updated as SlabData);
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
      this._createCeilingMesh(updated as CeilingData);

      /* 联动更新所有关联墙体的高度（= 天花板底面高度）
       * 注意：PropertyChangeCommand 在调用 updateObject 之前已通过 _setByPath 直接修改了
       * _objects Map 中的对象引用，导致 existing.bottomOffset 与 updated.bottomOffset 相同，
       * 无法通过比较新旧值来判断是否变化。因此只要有关联墙体，始终执行同步。
       */
      const updatedCeiling: CeilingData = updated as CeilingData;
      if (updatedCeiling.wallIds.length > 0) {
        /* 直接修改关联墙体数据并重建 Mesh，不走 updateObject 避免递归 */
        this._syncWallsToCeiling(id, updatedCeiling.wallIds, updatedCeiling.bottomOffset);
      }
    }

    /* 同步 Mesh 的位置偏移（墙体等非楼板/天花板对象使用 offsetX/Y/Z） */
    const mesh: THREE.Mesh | undefined = this._meshes.get(id);
    if (mesh !== undefined && updated.category !== 'slab' && updated.category !== 'ceiling') {
      mesh.position.set(updated.offsetX, updated.offsetY, updated.offsetZ);
    }

    /* 墙体厚度变化后，同步所有吸附在该墙体上的自适应门窗厚度。 */
    if (updated.category === 'wall' && (updated as WallData).subType === 'straight') {
      this._syncAdaptiveDoorWindowThickness(updated as StraightWallData);
    }

    /* 衔接线功能已停用：对象更新后清理可能残留的旧衔接线节点。 */
    this.refreshConnectionLines();

    /* 通知监听器 */
    this._notify(id, 'update');
  }

  /**
   * 移动指定直墙并按连接墙体原方向重算共享节点。
   * 该方法用于 2D 墙体实体拖拽：拖拽墙体沿自身法向移动；若端点连接其他直墙，
   * 则通过“拖拽墙目标中心线”和“连接墙原方向约束线”的交点确定新节点，
   * 从而保证连接墙体布置方向不变，仅允许拖拽墙体和连接墙体长度变化。
   * @param wallId - 被拖拽的直墙 ID
   * @param offset - 法向平移偏移量（世界 XZ 平面）
   * @returns 实际被更新的墙体 ID 列表
   */
  public moveStraightWallWithConnections(wallId: string, offset: Point2D): string[] {
    const wallObject: BuildingObject | undefined = this._objects.get(wallId);
    if (wallObject === undefined || wallObject.category !== 'wall' || (wallObject as WallData).subType !== 'straight') {
      return [];
    }

    const wallData: StraightWallData = wallObject as StraightWallData;
    const wallDirection: Point2D | null = this._normalizePoint2D({
      x: wallData.end.x - wallData.start.x,
      z: wallData.end.z - wallData.start.z,
    });
    if (wallDirection === null) {
      return [];
    }

    const affectedWallIds: Set<string> = new Set<string>();
    const jointMapping: { start: string | null; end: string | null } = this._connectionManager.getWallJoints(wallId);
    affectedWallIds.add(wallId);

    /* 分别计算拖拽墙两个端点的新位置。连接端点通过方向约束求交，自由端点直接按法向偏移。 */
    const startPoint: Point2D | null = this._resolveDraggedWallEndpointPosition(
      wallId,
      'start',
      wallData.start,
      offset,
      wallData.start,
      wallDirection,
      jointMapping.start,
      affectedWallIds
    );
    const endPoint: Point2D | null = this._resolveDraggedWallEndpointPosition(
      wallId,
      'end',
      wallData.end,
      offset,
      wallData.start,
      wallDirection,
      jointMapping.end,
      affectedWallIds
    );

    if (startPoint === null || endPoint === null) {
      console.warn(`[BuildingObjectManager] 墙体拖拽存在无法保持连接墙体方向的约束，已取消本次移动: wallId=${wallId}`);
      return [];
    }

    if (jointMapping.start !== null) {
      this._connectionManager.updateJointPosition(jointMapping.start, startPoint);
    } else {
      wallData.start = startPoint;
    }

    if (jointMapping.end !== null && jointMapping.end !== jointMapping.start) {
      this._connectionManager.updateJointPosition(jointMapping.end, endPoint);
    } else if (jointMapping.end === null) {
      wallData.end = endPoint;
    }

    this._syncWallEndpointsFromJoints(affectedWallIds);
    return Array.from(affectedWallIds);
  }

  /**
   * 解析拖拽墙端点的新位置。
   * 有连接墙体时使用连接墙体原方向约束求交；无有效约束时端点直接沿拖拽偏移移动。
   * @param draggedWallId - 被拖拽墙体 ID
   * @param draggedEndpoint - 被拖拽墙体端点类型
   * @param originalEndpointPoint - 端点当前坐标
   * @param offset - 拖拽墙法向偏移
   * @param draggedLinePoint - 拖拽墙当前起点，用于构造目标中心线
   * @param draggedLineDirection - 拖拽墙当前方向单位向量
   * @param jointId - 端点连接节点 ID
   * @param affectedWallIds - 受影响墙体 ID 集合
   * @returns 端点新坐标；约束无解时返回 null 表示取消本次拖拽
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
    const fallbackPoint: Point2D = {
      x: originalEndpointPoint.x + offset.x,
      z: originalEndpointPoint.z + offset.z,
    };
    if (jointId === null) {
      return fallbackPoint;
    }

    const connections: WallConnection[] = this._connectionManager.getJointConnections(jointId);
    for (const connection of connections) {
      affectedWallIds.add(connection.wallId);
    }

    const constraints: WallDragDirectionConstraint[] = this._collectWallDragDirectionConstraints(
      draggedWallId,
      jointId,
      originalEndpointPoint
    );
    if (constraints.length === 0) {
      return fallbackPoint;
    }

    const primaryConstraint: WallDragDirectionConstraint = constraints[0]!;
    const targetLinePoint: Point2D = {
      x: draggedLinePoint.x + offset.x,
      z: draggedLinePoint.z + offset.z,
    };
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
          `[BuildingObjectManager] 墙体拖拽端点存在多条非共线约束，已取消本次移动: wallId=${draggedWallId}, endpoint=${draggedEndpoint}`
        );
        return null;
      }
    }

    return intersection;
  }

  /**
   * 收集指定拖拽端点处连接墙体的方向约束。
   * 每条约束使用连接墙体的固定端和原方向表示，使连接端移动后仍落在原中心线上。
   * @param draggedWallId - 被拖拽墙体 ID
   * @param jointId - 拖拽端点连接节点 ID
   * @param jointPosition - 当前共享节点坐标
   * @returns 方向约束列表
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
      if (
        connectedObject === undefined ||
        connectedObject.category !== 'wall' ||
        (connectedObject as WallData).subType !== 'straight'
      ) {
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

      constraints.push({
        wallId: connection.wallId,
        fixedPoint: fixedPoint,
        direction: direction,
      });
    }

    return constraints;
  }

  /**
   * 计算 XZ 平面二维向量的单位向量。
   * @param vector - 原始二维向量
   * @returns 单位向量；长度过小时返回 null
   */
  private _normalizePoint2D(vector: Point2D): Point2D | null {
    const length: number = Math.sqrt(vector.x * vector.x + vector.z * vector.z);
    if (length < BuildingObjectManager.WALL_DRAG_EPSILON) {
      return null;
    }
    return {
      x: vector.x / length,
      z: vector.z / length,
    };
  }

  /**
   * 计算两条 XZ 平面无限直线的交点。
   * 直线 A = pointA + t * directionA，直线 B = pointB + s * directionB。
   * @param pointA - 第一条直线上的点
   * @param directionA - 第一条直线方向
   * @param pointB - 第二条直线上的点
   * @param directionB - 第二条直线方向
   * @returns 交点；平行或近似平行时返回 null
   */
  private _intersectInfiniteLines(
    pointA: Point2D,
    directionA: Point2D,
    pointB: Point2D,
    directionB: Point2D
  ): Point2D | null {
    const denominator: number = directionA.x * directionB.z - directionA.z * directionB.x;
    if (Math.abs(denominator) < BuildingObjectManager.WALL_DRAG_EPSILON) {
      return null;
    }

    const diffX: number = pointB.x - pointA.x;
    const diffZ: number = pointB.z - pointA.z;
    const t: number = (diffX * directionB.z - diffZ * directionB.x) / denominator;
    return {
      x: pointA.x + t * directionA.x,
      z: pointA.z + t * directionA.z,
    };
  }

  /**
   * 判断点是否落在指定 XZ 平面无限直线上。
   * @param point - 待检测点
   * @param linePoint - 直线上的已知点
   * @param lineDirection - 直线方向单位向量
   * @returns 点到直线距离在容差内返回 true
   */
  private _isPointOnLine(point: Point2D, linePoint: Point2D, lineDirection: Point2D): boolean {
    const diffX: number = point.x - linePoint.x;
    const diffZ: number = point.z - linePoint.z;
    const crossDistance: number = Math.abs(diffX * lineDirection.z - diffZ * lineDirection.x);
    return crossDistance < BuildingObjectManager.WALL_DRAG_EPSILON;
  }

  /**
   * 根据连接节点坐标同步一组直墙端点并重建 Mesh。
   * @param wallIds - 需要同步和重建的墙体 ID 集合
   */
  private _syncWallEndpointsFromJoints(wallIds: Set<string>): void {
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
      this._removeMeshFromScene(wallId);
      this._createWallMesh(wallData);
      this._syncAdaptiveDoorWindowThickness(wallData);
      this._notify(wallId, 'update');
    }

    /* 拖拽完成后清理已停用衔接线残留，保持与 updateObject 行为一致。 */
    this.refreshConnectionLines();
  }

  /**
   * 同步吸附到指定直墙的门窗厚度
   * 遍历场景中的 STL Mesh，找到 wallId 匹配且启用自适应厚度的门窗，按墙体厚度更新局部 Z 轴缩放。
   * @param wallData - 已更新的直墙数据
   */
  private _syncAdaptiveDoorWindowThickness(wallData: StraightWallData): void {
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
   * 创建弧形墙
   * @param start - 弧线起点
   * @param end - 弧线终点
   * @param bulge - 弧度因子（tan(angle/4)，正值左凸，负值右凸）
   * @param thickness - 厚度（默认 0.24m）
   * @param height - 高度（默认 2.8m）
   * @param segments - 弧线分段数（默认 16）
   * @returns 新建的弧形墙 ID
   */
  public createArcWall(
    start: Point2D,
    end: Point2D,
    bulge: number,
    thickness: number = WALL_DEFAULTS.thickness,
    height: number = WALL_DEFAULTS.height,
    segments: number = 16
  ): string {
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
      start: start,
      end: end,
      bulge: bulge,
      segments: segments,
      boundingBox: {
        min: { x: Number.MAX_SAFE_INTEGER, z: Number.MAX_SAFE_INTEGER },
        max: { x: Number.MIN_SAFE_INTEGER, z: Number.MIN_SAFE_INTEGER },
        center: { x: 0, z: 0 },
        size: { x: 0, y: 0, z: 0 },
      },
    };
    this.addObject(data);
    return id;
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
    slabThickness: number = SLAB_DEFAULTS.slabThickness,
    wallIds: string[] = []
  ): string {
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
      slabThickness: slabThickness,
      /* 楼板顶面高度偏移，默认顶面位于 Y=0（楼板顶面 Y = topOffset） */
      topOffset: SLAB_DEFAULTS.topOffset,
      boundingBox: {
        min: { x: Number.MAX_SAFE_INTEGER, z: Number.MAX_SAFE_INTEGER },
        max: { x: Number.MIN_SAFE_INTEGER, z: Number.MIN_SAFE_INTEGER },
        center: { x: 0, z: 0 },
        size: { x: 0, y: 0, z: 0 },
      },
    };

    /* 直接存入数据并创建渲染实例（不走 addObject 避免重复触发封闭环检测） */
    this._objects.set(id, data);
    this._createSlabMesh(data);
    if (wallIds.length > 0) {
      this._syncWallsToSlab(id, wallIds);
    }
    /* 衔接线功能已停用：楼板创建后清理可能残留的旧衔接线节点。 */
    this.refreshConnectionLines();
    this._notify(id, 'add');

    console.log(`[BuildingObjectManager] 楼板已自动生成: id=${id}, 顶点数=${outline.length}, 厚度=${slabThickness * 1000}mm`);
    return id;
  }

  /**
   * 墙体拖拽完成后刷新相关封闭区域的楼板、天花板和标注数据。
   * 关键流程：根据受影响墙体的连接节点重新检测封闭环，封闭时复用既有关联对象更新轮廓，未有关联对象时自动生成。
   * @param wallIds - 本次拖拽直接或间接受影响的墙体 ID 列表
   */
  public refreshClosedSurfacesForWalls(wallIds: string[]): void {
    const visitedSignatures: Set<string> = new Set<string>();

    for (const wallId of wallIds) {
      const joints: { start: string | null; end: string | null } = this._connectionManager.getWallJoints(wallId);
      const jointIds: Array<string | null> = [joints.start, joints.end];

      for (const jointId of jointIds) {
        if (jointId === null) {
          continue;
        }

        /* 条件分支：仅当连接拓扑返回有效封闭环时，才更新楼板、天花板和由楼板驱动的面积/边长标注。 */
        const loopResult: { outline: Point2D[]; wallIds: string[] } | null =
          this._connectionManager.detectClosedLoopWithWalls(jointId);
        if (loopResult === null || loopResult.outline.length < 3) {
          continue;
        }

        const signature: string = this._computeOutlineSignature(loopResult.outline);
        if (visitedSignatures.has(signature)) {
          continue;
        }
        visitedSignatures.add(signature);
        this._refreshClosedSurfaceFromLoop(signature, loopResult.outline, loopResult.wallIds);
      }
    }
  }

  /**
   * 清空所有对象
   */
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
    /* 清空楼板签名缓存 */
    this._generatedSlabSignatures.clear();
    /* 清空天花板签名缓存 */
    this._generatedCeilingSignatures.clear();
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
   * 创建墙体的 Three.js Mesh 并加入场景
   *
   * 流程：
   * 1. 计算 miter 偏移（端面截断到对方侧面）
   * 2. 检测差集区域（T 形连接时，次墙端点处需要从主墙中开洞）
   * 3. 若有差集则调用 buildWithSubtraction，否则调用 buildWithMiter
   * 4. 创建材质数组（每面独立材质）并加入场景
   *
   * 使用材质数组，每个面独立材质实例，支持面级别纹理应用
   */
  private _createWallMesh(data: WallData): void {
    /* 矩形墙不直接生成 Mesh（由子墙体生成） */
    if (data.subType === 'rect') {
      return;
    }

    let geometry: THREE.BufferGeometry;

    /* 直墙：计算 miter 偏移后构建几何 */
    if (data.subType === 'straight') {
      /* 计算 miter 偏移（端面截断到对方侧面） */
      const miter: MiterParams = this._connectionManager.computeMiterForWall(
        data.id, data.start, data.end, data.thickness, this._getWallEndpointsCallback()
      );
      geometry = this._wallBuilder.buildWithMiter(data, miter);
    } else {
      /* 弧形墙暂不支持 miter */
      geometry = this._wallBuilder.build(data);
    }

    /* 为每个面创建独立的材质实例
     * 普通直墙：6 面（前/后/起点端/终点端/顶/底）
     * 带洞口直墙：7 面（前/后/洞口内壁/起点端/终点端/顶/底）
     */
    const hasStraightOpenings: boolean =
      data.subType === 'straight' &&
      (data as import('./BuildingTypes').StraightWallData).openings !== undefined &&
      ((data as import('./BuildingTypes').StraightWallData).openings?.length ?? 0) > 0;
    const faceCount: number = hasStraightOpenings
      ? BuildingObjectManager.WALL_FACE_COUNT_WITH_OPENING
      : BuildingObjectManager.WALL_FACE_COUNT;
    const materials: Array<THREE.Material> = [];
    for (let i: number = 0; i < faceCount; i++) {
      const faceMaterial: THREE.Material = this._createMaterialFromProperties(data.material);
      materials.push(faceMaterial);
    }

    const mesh: THREE.Mesh = new THREE.Mesh(geometry, materials);

    /* 将全局 ID 存入 Mesh 的 userData，方便射线拾取时反查 */
    mesh.userData['buildingObjectId'] = data.id;
    mesh.name = data.name;

    // /* 创建边界线框（EdgesGeometry 只提取实体轮廓边） */
    // const edgesGeometry: THREE.EdgesGeometry = new THREE.EdgesGeometry(geometry, 15);
    // const wireframeMaterial: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
    //   color: 0x333333,
    //   linewidth: 1,
    //   depthTest: true,
    //   depthWrite: false,
    // });
    // const wireframe: THREE.LineSegments = new THREE.LineSegments(edgesGeometry, wireframeMaterial);

    // /* 线框稍微向外偏移，避免 Z-fighting */
    // wireframe.position.set(0, 0.001, 0);
    // wireframe.renderOrder = 1;

    // /* 将线框作为子对象添加到 Mesh，随实体一起移动/删除 */
    // mesh.add(wireframe);

    /* 创建边界线框（排除 180° 共面边）
     * 带洞口的直墙需排除 materialIndex=2（洞口内壁面），避免内壁左右端面产生竖线
     */
    const excludeGroups: number[] = hasStraightOpenings ? [2] : [];
    const wireframe: THREE.LineSegments | null = this._createFilteredEdges(mesh.geometry, excludeGroups);
    if (wireframe !== null) {
      /* 线框稍微向外偏移，避免 Z-fighting */
      wireframe.position.set(0, 0.001, 0);
      wireframe.renderOrder = 1;
      /* 将线框作为子对象添加到 Mesh，随实体一起移动/删除 */
      mesh.add(wireframe);
    }

    /* 加入场景 */
    this._sceneManager.add(mesh);
    this._meshes.set(data.id, mesh);
    /* 计算并存储包围盒 */
    this._computeAndStoreBoundingBox(data, mesh);
  }

  /**
   * 创建梁的 Three.js Mesh 并加入场景
   * 关键流程：使用梁专属几何构建器生成矩形梁实体，创建实体材质与边界线框后登记到 Mesh 映射。
   * @param data - 梁构件数据
   */
  private _createBeamMesh(data: BeamData): void {
    data.length = BeamGeometryBuilder.computeLength(data.start, data.end);
    data.elevation = BeamGeometryBuilder.computeBottomY(data);

    /* 计算梁端点斜接：梁只与梁端点重合关系联动，不写入墙体连接拓扑。 */
    const beamMiter: MiterParams = this._beamMiterCalculator.computeMiterForBeam(data, this._getAllBeamData());
    const geometry: THREE.BufferGeometry = this._beamBuilder.buildWithMiter(data, beamMiter);
    const material: THREE.Material = this._createMaterialFromProperties(data.material);
    const mesh: THREE.Mesh = new THREE.Mesh(geometry, material);

    mesh.userData['buildingObjectId'] = data.id;
    mesh.name = data.name;

    /* 梁为规则六面体，直接显示折角边即可辅助用户识别宽高和长度。 */
    const wireframe: THREE.LineSegments | null = this._createFilteredEdges(mesh.geometry);
    if (wireframe !== null) {
      wireframe.position.set(0, 0.001, 0);
      wireframe.renderOrder = 1;
      mesh.add(wireframe);
    }

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
  }

  /* ========== 洞口预览（临时几何替换，不修改数据层） ========== */

  /**
   * 临时用指定洞口列表重建墙体 Mesh 的几何体，用于门窗布置时的洞口预览
   * 不修改 wallData.openings，仅替换 Mesh 的几何体
   * 调用方需在预览结束后调用 clearOpeningPreview 恢复原始几何体
   *
   * @param wallId - 目标墙体 ID
   * @param previewOpenings - 预览用洞口列表（含当前正在布置的门窗洞口）
   * @returns 是否成功（墙体不存在或非直墙时返回 false）
   */
  public previewOpeningOnMesh(wallId: string, previewOpenings: WallOpening[]): boolean {
    const obj: BuildingObject | undefined = this._objects.get(wallId);
    if (obj === undefined || obj.category !== 'wall') {
      return false;
    }
    const wallData: WallData = obj as WallData;
    if (wallData.subType !== 'straight') {
      return false;
    }
    const straightWall: StraightWallData = wallData as StraightWallData;
    const mesh: THREE.Mesh | undefined = this._meshes.get(wallId);
    if (mesh === undefined) {
      return false;
    }

    /* 构造临时数据（不修改原始数据） */
    const tempData: StraightWallData = { ...straightWall, openings: previewOpenings };

    /* 计算 miter 偏移 */
    const miter: MiterParams = this._connectionManager.computeMiterForWall(
      wallId, straightWall.start, straightWall.end, straightWall.thickness,
      this._getWallEndpointsCallback()
    );

    /* 构建带洞口的临时几何体 */
    const previewGeometry: THREE.BufferGeometry = this._wallBuilder.buildWithMiter(tempData, miter);

    /* 替换 Mesh 的几何体
     * 先赋值新几何体，再延迟 dispose 旧几何体
     * 原因：若先 dispose 再赋值，WebGPU 渲染器在同一帧内可能仍持有旧 BufferAttribute 的缓存引用
     * 导致 this.get(index).buffer 为空（GPUBuffer 已销毁但缓存条目尚未清除）
     * 延迟到下一帧 dispose，确保渲染器已完成当前帧渲染并切换到新几何体
     */
    const oldPreviewGeometry: THREE.BufferGeometry = mesh.geometry;
    /* 先赋值新几何体，让渲染器下次 render 时使用新几何体
     * 再 dispose 旧几何体：此时 mesh.geometry 已指向新几何体
     * 渲染器不会再访问旧几何体，dispose 安全
     */
    mesh.geometry = previewGeometry;
    oldPreviewGeometry.dispose();

    /* 同步材质数组数量（带洞口需要 7 个材质） */
    const faceCount: number = BuildingObjectManager.WALL_FACE_COUNT_WITH_OPENING;
    if (!Array.isArray(mesh.material) || (mesh.material as Array<THREE.Material>).length !== faceCount) {
      /* 释放旧材质 */
      if (Array.isArray(mesh.material)) {
        for (const mat of mesh.material as Array<THREE.Material>) {
          mat.dispose();
        }
      }
      /* 创建新材质数组 */
      const newMaterials: Array<THREE.Material> = [];
      for (let i: number = 0; i < faceCount; i++) {
        newMaterials.push(this._createMaterialFromProperties(straightWall.material));
      }
      mesh.material = newMaterials;
    }

    /* 预览期间不处理线框（调用方应在 activate 时通过 hideAllWireframes 全局隐藏）
     * 此处仅替换几何体和材质，不涉及线框操作
     */

    return true;
  }

  /**
   * 恢复指定墙体的原始几何体（清除洞口预览）
   * 根据 wallData 中的实际 openings 重建几何体
   *
   * @param wallId - 目标墙体 ID
   */
  public clearOpeningPreview(wallId: string): void {
    const obj: BuildingObject | undefined = this._objects.get(wallId);
    if (obj === undefined || obj.category !== 'wall') {
      return;
    }
    const wallData: WallData = obj as WallData;
    if (wallData.subType !== 'straight') {
      return;
    }
    const mesh: THREE.Mesh | undefined = this._meshes.get(wallId);
    if (mesh === undefined) {
      return;
    }

    /* 用原始数据重建几何体 */
    const straightWall: StraightWallData = wallData as StraightWallData;
    const miter: MiterParams = this._connectionManager.computeMiterForWall(
      wallId, straightWall.start, straightWall.end, straightWall.thickness,
      this._getWallEndpointsCallback()
    );
    const restoredGeometry: THREE.BufferGeometry = this._wallBuilder.buildWithMiter(straightWall, miter);

    /* 替换几何体
     * 先赋值新几何体，再延迟 dispose 旧几何体
     * 与 previewOpeningOnMesh 保持一致，避免 WebGPU 渲染器缓存失效导致 buffer 为空
     */
    const oldRestoredGeometry: THREE.BufferGeometry = mesh.geometry;
    /* 先赋值新几何体，再 dispose 旧几何体（与 previewOpeningOnMesh 保持一致） */
    mesh.geometry = restoredGeometry;
    oldRestoredGeometry.dispose();

    /* 同步材质数量 */
    const hasOpenings: boolean = (straightWall.openings?.length ?? 0) > 0;
    const faceCount: number = hasOpenings
      ? BuildingObjectManager.WALL_FACE_COUNT_WITH_OPENING
      : BuildingObjectManager.WALL_FACE_COUNT;
    if (!Array.isArray(mesh.material) || (mesh.material as Array<THREE.Material>).length !== faceCount) {
      if (Array.isArray(mesh.material)) {
        for (const mat of mesh.material as Array<THREE.Material>) {
          mat.dispose();
        }
      }
      const newMaterials: Array<THREE.Material> = [];
      for (let i: number = 0; i < faceCount; i++) {
        newMaterials.push(this._createMaterialFromProperties(straightWall.material));
      }
      mesh.material = newMaterials;
    }

    /* clearOpeningPreview 不重建线框
     * 线框由 restoreAllWireframes 统一恢复（在 deactivate 时调用）
     * 避免每次切换吸附墙体时触发 EdgesGeometry 重建导致卡死
     */
  }

  /* ========== 墙体透明化（门窗布置期间吸附高亮） ========== */

  /**
   * 将指定墙体 Mesh 的所有材质设为半透明
   * 仅修改材质的 opacity/transparent 属性，不替换几何体，WebGPU 安全
   * 调用方需在取消吸附时调用 restoreWallOpacity 恢复
   *
   * @param wallId - 目标墙体 ID
   * @param opacity - 透明度（0~1），默认 0.3
   */
  public setWallTransparent(wallId: string, opacity: number = 0.3): void {
    const mesh: THREE.Mesh | undefined = this._meshes.get(wallId);
    if (mesh === undefined) {
      return;
    }
    /* 遍历所有材质，设置透明度 */
    const materials: Array<THREE.Material> = Array.isArray(mesh.material)
      ? (mesh.material as Array<THREE.Material>)
      : [mesh.material as THREE.Material];
    for (const mat of materials) {
      mat.transparent = true;
      mat.opacity = opacity;
      mat.needsUpdate = true;
    }
  }

  /**
   * 批量设置指定类别所有对象的材质透明度
   * 用于 2D 模式下将墙体/天花板设为半透明，切回 3D 时恢复不透明
   * @param category - 建筑对象类别（'wall' | 'slab' | 'ceiling'）
   * @param opacity - 透明度（0~1），1.0 表示完全不透明
   */
  public setCategoryOpacity(category: BuildingCategory, opacity: number): void {
    const isTransparent: boolean = opacity < 1.0;
    this._objects.forEach((obj: BuildingObject, id: string): void => {
      if (obj.category !== category) {
        return;
      }
      const mesh: THREE.Mesh | undefined = this._meshes.get(id);
      if (mesh === undefined) {
        return;
      }
      /* 遍历所有材质，设置透明度 */
      const materials: Array<THREE.Material> = Array.isArray(mesh.material)
        ? (mesh.material as Array<THREE.Material>)
        : [mesh.material as THREE.Material];
      for (const mat of materials) {
        mat.transparent = isTransparent;
        mat.opacity = opacity;
        mat.needsUpdate = true;
      }
    });
  }

  /**
   * 批量设置指定类别所有对象的临时渲染颜色与透明度。
   * 仅修改 Mesh 材质显示状态，不修改 BuildingObject 中保存的真实材质数据，适合 2D/3D 视图临时切换。
   * @param category - 建筑对象类别
   * @param color - 临时显示颜色
   * @param opacity - 临时透明度，1.0 表示完全不透明
   */
  public setCategoryVisualStyle(category: BuildingCategory, color: number, opacity: number): void {
    const isTransparent: boolean = opacity < 1.0;
    this._objects.forEach((obj: BuildingObject, id: string): void => {
      if (obj.category !== category) {
        return;
      }
      const mesh: THREE.Mesh | undefined = this._meshes.get(id);
      if (mesh === undefined) {
        return;
      }
      /* 2D 视图切换时，只覆盖渲染材质的颜色和透明度，保证对象真实材质可在 3D 恢复。 */
      const materials: Array<THREE.Material> = Array.isArray(mesh.material)
        ? (mesh.material as Array<THREE.Material>)
        : [mesh.material as THREE.Material];
      for (const mat of materials) {
        this._applyMaterialVisualStyle(mat, color, opacity, isTransparent);
      }
    });
  }

  /**
   * 按对象真实材质数据恢复指定类别的渲染材质显示状态。
   * 用于从 2D 临时深灰样式切回 3D，避免临时颜色污染真实材质。
   * @param category - 建筑对象类别
   */
  public restoreCategoryVisualStyle(category: BuildingCategory): void {
    this._objects.forEach((obj: BuildingObject, id: string): void => {
      if (obj.category !== category) {
        return;
      }
      const mesh: THREE.Mesh | undefined = this._meshes.get(id);
      if (mesh === undefined) {
        return;
      }
      const sourceMaterial: MaterialProperties = obj.material;
      const isTransparent: boolean = sourceMaterial.opacity < 1.0;
      /* 从数据层材质恢复颜色和透明度，确保 2D 临时深灰显示不会影响 3D 材质表现。 */
      const materials: Array<THREE.Material> = Array.isArray(mesh.material)
        ? (mesh.material as Array<THREE.Material>)
        : [mesh.material as THREE.Material];
      for (const mat of materials) {
        this._applyMaterialVisualStyle(mat, sourceMaterial.color, sourceMaterial.opacity, isTransparent);
      }
    });
  }

  /**
   * 设置单个材质的临时视觉样式。
   * @param material - 目标 Three.js 材质
   * @param color - 显示颜色
   * @param opacity - 显示透明度
   * @param transparent - 是否启用透明渲染
   */
  private _applyMaterialVisualStyle(
    material: THREE.Material,
    color: number,
    opacity: number,
    transparent: boolean
  ): void {
    if ('color' in material) {
      const colorMaterial: THREE.Material & { color: THREE.Color } = material as THREE.Material & { color: THREE.Color };
      colorMaterial.color.set(color);
    }
    material.transparent = transparent;
    material.opacity = opacity;
    material.needsUpdate = true;
  }

  /**
   * 批量设置指定类别所有对象的 Mesh 可见性
   * 用于 2D 模式下完全隐藏天花板，切回 3D 时恢复显示
   * @param category - 建筑对象类别（'wall' | 'slab' | 'ceiling' 等）
   * @param visible - true 显示，false 隐藏
   */
  public setCategoryVisible(category: BuildingCategory, visible: boolean): void {
    this._objects.forEach((obj: BuildingObject, id: string): void => {
      if (obj.category !== category) {
        return;
      }
      const mesh: THREE.Mesh | undefined = this._meshes.get(id);
      if (mesh !== undefined) {
        mesh.visible = visible;
      }
    });
  }

  /**
   * 恢复指定墙体 Mesh 的材质为完全不透明
   * 与 setWallTransparent 配对使用
   *
   * @param wallId - 目标墙体 ID
   */
  public restoreWallOpacity(wallId: string): void {
    const mesh: THREE.Mesh | undefined = this._meshes.get(wallId);
    if (mesh === undefined) {
      return;
    }
    /* 遍历所有材质，恢复不透明 */
    const materials: Array<THREE.Material> = Array.isArray(mesh.material)
      ? (mesh.material as Array<THREE.Material>)
      : [mesh.material as THREE.Material];
    for (const mat of materials) {
      mat.transparent = false;
      mat.opacity = 1.0;
      mat.needsUpdate = true;
    }
  }

  /* ========== 全局线框管理（门窗布置期间隐藏/恢复） ========== */

  /**
   * 隐藏所有 Mesh 的线框子对象
   * 在门窗布置模式激活时调用，避免预览期间 EdgesGeometry 引用失效导致 WebGPU 崩溃
   * 线框子对象会被完全移除（dispose + remove），不仅仅是隐藏
   */
  public hideAllWireframes(): void {
    this._meshes.forEach((mesh: THREE.Mesh): void => {
      const wireframesToRemove: THREE.Object3D[] = [];
      mesh.children.forEach((child: THREE.Object3D): void => {
        if (child.userData['isWireframe'] === true) {
          wireframesToRemove.push(child);
        }
      });
      for (const wireframeObj of wireframesToRemove) {
        const wf: THREE.LineSegments = wireframeObj as THREE.LineSegments;
        wf.geometry.dispose();
        if (wf.material instanceof THREE.Material) {
          (wf.material as THREE.Material).dispose();
        }
        mesh.remove(wireframeObj);
      }
    });
  }

  /**
   * 恢复所有 Mesh 的线框子对象
   * 在门窗布置模式退出时调用（deactivate / 放置完成后）
   * 为每个 Mesh 重新创建 EdgesGeometry + LineSegments 并添加
   * 注意：此操作有一定开销，仅在布置结束时调用一次
   */
  public restoreAllWireframes(): void {
    this._meshes.forEach((mesh: THREE.Mesh): void => {
      /* 若已有线框子对象则跳过（避免重复添加） */
      const hasWireframe: boolean = mesh.children.some(
        (child: THREE.Object3D): boolean => child.userData['isWireframe'] === true
      );
      if (hasWireframe) {
        return;
      }

      // /* 重新创建线框 */
      // const edgesGeometry: THREE.EdgesGeometry = new THREE.EdgesGeometry(mesh.geometry, 15);
      // const wireframeMaterial: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
      //   color: 0x333333,
      //   linewidth: 1,
      //   depthTest: true,
      //   depthWrite: false,
      // });
      // const wireframe: THREE.LineSegments = new THREE.LineSegments(edgesGeometry, wireframeMaterial);
      // wireframe.position.set(0, 0.001, 0);
      // wireframe.renderOrder = 1;
      // mesh.add(wireframe);

      /* 重新创建线框（排除 180° 共面边）
       * 带洞口的直墙需排除 materialIndex=2（洞口内壁面），避免内壁左右端面产生竖线
       * 通过 mesh.userData 中存储的 buildingObjectId 查找对应的墙体数据
       */
      const meshId: string | undefined = mesh.userData['buildingObjectId'] as string | undefined;
      let excludeGroupsForRestore: number[] = [];
      if (meshId !== undefined) {
        const objData: BuildingObject | undefined = this._objects.get(meshId);
        if (
          objData !== undefined &&
          objData.category === 'wall' &&
          (objData as WallData).subType === 'straight'
        ) {
          const straightData: StraightWallData = objData as StraightWallData;
          const hasOpeningsForRestore: boolean = (straightData.openings?.length ?? 0) > 0;
          if (hasOpeningsForRestore) {
            excludeGroupsForRestore = [2];
          }
        }
      }

      const wireframe: THREE.LineSegments | null = this._createFilteredEdges(
        mesh.geometry,
        excludeGroupsForRestore
      );
      if (wireframe !== null) {
        wireframe.position.set(0, 0.001, 0);
        wireframe.renderOrder = 1;
        mesh.add(wireframe);
      }
    });
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
      /** 关联的墙体 ID 列表 */
      wallIds: wallIds,
      boundingBox: {
        min: { x: Number.MAX_SAFE_INTEGER, z: Number.MAX_SAFE_INTEGER },
        max: { x: Number.MIN_SAFE_INTEGER, z: Number.MIN_SAFE_INTEGER },
        center: { x: 0, z: 0 },
        size: { x: 0, y: 0, z: 0 },
      },
    };

    /* 直接存入数据并创建渲染实例（不走 addObject 避免重复触发封闭环检测） */
    this._objects.set(id, data);
    this._createCeilingMesh(data);

    /* 将关联的墙体 ceilingId 写回，并同步墙高为 bottomOffset */
    if (wallIds.length > 0) {
      this._syncWallsToCeiling(id, wallIds, bottomOffset);
    }

    /* 衔接线功能已停用：天花板创建后清理可能残留的旧衔接线节点。 */
    this.refreshConnectionLines();
    this._notify(id, 'add');

    console.log(
      `[BuildingObjectManager] 天花板已自动生成: id=${id}, 顶点数=${outline.length},`,
      `厚度=${ceilingThickness * 1000}mm, 底面高度=${bottomOffset * 1000}mm,`,
      `关联墙体数=${wallIds.length}`
    );
    return id;
  }

  /**
   * 将指定墙体列表的 ceilingId 写回，并同步墙高为天花板底面高度
   * 不走 updateObject 避免递归，直接修改数据并重建 Mesh
   * @param ceilingId - 天花板 ID
   * @param wallIds - 关联的墙体 ID 列表
   * @param newHeight - 新的墙高（= 天花板 bottomOffset）
   */
  private _syncWallsToCeiling(ceilingId: string, wallIds: string[], newHeight: number): void {
    for (const wallId of wallIds) {
      const obj: BuildingObject | undefined = this._objects.get(wallId);
      if (obj === undefined || obj.category !== 'wall') {
        continue;
      }
      const wallData: WallData = obj as WallData;
      /* 只处理直墙（弧形墙和矩形墙暂不支持天花板绑定） */
      if (wallData.subType !== 'straight') {
        continue;
      }
      /* 直接修改数据，不走 updateObject 避免递归 */
      const straightWall: StraightWallData = wallData as StraightWallData;
      straightWall.ceilingId = ceilingId;
      straightWall.height = newHeight;
      /* 重建 Mesh（高度变化需要重建几何体） */
      this._removeMeshFromScene(wallId);
      this._createWallMesh(straightWall);
      /* 通知监听器 */
      this._notify(wallId, 'update');
    }
  }

  /**
   * 创建楼板的 Three.js Mesh 并加入场景
   * 使用 SlabGeometryBuilder 生成挤压几何体，附带边缘线框
   * @param data - 楼板数据
   */
  private _createSlabMesh(data: SlabData): void {
    const geometry: THREE.BufferGeometry = this._slabBuilder.build(data);

    /* 楼板使用单一材质（不需要面级别纹理） */
    const material: THREE.Material = this._createMaterialFromProperties(data.material);
    const mesh: THREE.Mesh = new THREE.Mesh(geometry, material);

    /* 将全局 ID 存入 Mesh 的 userData，方便射线拾取时反查 */
    mesh.userData['buildingObjectId'] = data.id;
    mesh.name = data.name;

    /* 设置楼板顶面高度：几何体从 Y=0 向下挤压，Mesh.position.y = topOffset 使顶面在 topOffset 高度
     * 修改 topOffset 时只需更新 mesh.position.y，不需要重建几何体
     */
    mesh.position.set(0, data.topOffset - data.slabThickness, 0);

    /* 创建边缘线框（WebGPU 兼容方案，线宽由浏览器固定为 1px） */
    const slabEdgesGeom: THREE.EdgesGeometry = new THREE.EdgesGeometry(geometry, 15);
    const slabWireframeMat: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
      color: 0x555555,
      depthTest: true,
      depthWrite: false,
    });
    const slabWireframe: THREE.LineSegments = new THREE.LineSegments(slabEdgesGeom, slabWireframeMat);
    slabWireframe.userData['isWireframe'] = true;
    slabWireframe.position.set(0, 0.001, 0);
    slabWireframe.renderOrder = 1;
    mesh.add(slabWireframe);

    /* 加入场景 */
    this._sceneManager.add(mesh);
    this._meshes.set(data.id, mesh);
    /* 计算并存储包围盒 */
    this._computeAndStoreBoundingBox(data, mesh);
  }

  /**
   * 创建天花板的 Three.js Mesh 并加入场景
   * 使用 CeilingGeometryBuilder 生成挤压几何体，附带边缘线框
   * 几何体从 Y=0 向下挤压（rotateX(-90°) 后 +Z → -Y），
   * Mesh.position.y = bottomOffset + ceilingThickness 使底面在 bottomOffset 高度
   * @param data - 天花板数据
   */
  private _createCeilingMesh(data: CeilingData): void {
    const geometry: THREE.BufferGeometry = this._ceilingBuilder.build(data);

    /* 天花板使用单一材质（白色，不需要面级别纹理） */
    const material: THREE.Material = this._createMaterialFromProperties(data.material);
    const mesh: THREE.Mesh = new THREE.Mesh(geometry, material);

    /* 将全局 ID 存入 Mesh 的 userData，方便射线拾取时反查 */
    mesh.userData['buildingObjectId'] = data.id;
    mesh.name = data.name;

    /* 设置天花板位置：
     * CeilingGeometryBuilder 使用 rotateX(-90°)，ExtrudeGeometry 挤压方向 +Z
     * rotateX(-90°) 后：新 Y = 旧 Z，即几何体从 Y=0 向 +Y（向上）延伸 ceilingThickness
     *   底面 = position.y + 0 = bottomOffset
     *   顶面 = position.y + ceilingThickness = bottomOffset + ceilingThickness
     * 因此 Mesh.position.y = bottomOffset 即可使底面贴合墙顶
     */
    mesh.position.set(0, data.bottomOffset, 0);

    /* 创建边缘线框（WebGPU 兼容方案，线宽由浏览器固定为 1px） */
    const ceilEdgesGeom: THREE.EdgesGeometry = new THREE.EdgesGeometry(geometry, 15);
    const ceilWireframeMat: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
      color: 0x888888,
      depthTest: true,
      depthWrite: false,
    });
    const ceilWireframe: THREE.LineSegments = new THREE.LineSegments(ceilEdgesGeom, ceilWireframeMat);
    ceilWireframe.userData['isWireframe'] = true;
    ceilWireframe.position.set(0, 0.001, 0);
    ceilWireframe.renderOrder = 1;
    mesh.add(ceilWireframe);

    /* 加入场景 */
    this._sceneManager.add(mesh);
    this._meshes.set(data.id, mesh);
    /* 计算并存储包围盒 */
    this._computeAndStoreBoundingBox(data, mesh);
  }

  /**
   * 尝试自动生成楼板
   * 在新墙体注册到连接管理器后调用，检测两端节点是否形成封闭环
   * 若检测到封闭环且该环尚未生成楼板，则自动创建楼板
   * 同时触发天花板自动生成（_tryAutoGenerateCeiling）
   * 楼板轮廓使用墙体室内净边界（中心线向内偏移半个墙厚）
   * @param wallId - 触发检测的墙体 ID
   */
  private _tryAutoGenerateSlab(wallId: string): void {
    const joints: { start: string | null; end: string | null } = this._connectionManager.getWallJoints(wallId);

    /* 对起点和终点节点分别检测封闭环 */
    const jointIds: Array<string | null> = [joints.start, joints.end];
    for (const jointId of jointIds) {
      if (jointId === null) {
        continue;
      }

      /* 检测从该节点出发是否存在封闭环（返回中心线节点坐标 + 对应的墙体 ID 序列） */
      const loopResult: { outline: Point2D[]; wallIds: string[] } | null =
        this._connectionManager.detectClosedLoopWithWalls(jointId);
      if (loopResult === null || loopResult.outline.length < 3) {
        continue;
      }

      /* 计算封闭环签名（基于中心线坐标，防止重复生成） */
      const signature: string = this._computeOutlineSignature(loopResult.outline);
      if (this._generatedSlabSignatures.has(signature)) {
        /* 该封闭环已生成过楼板，跳过 */
        continue;
      }

      /* 将中心线轮廓还原为室内净轮廓，保持用户绘制线即墙内侧线的语义。 */
      const innerOutline: Point2D[] = this._convertOutlineToInnerBoundary(
        loopResult.outline,
        loopResult.wallIds
      );

      /* 记录签名并生成楼板，同时写回围合墙体 slabId，便于后续拖拽复用并更新既有楼板。 */
      this._generatedSlabSignatures.add(signature);
      this.createSlab(innerOutline, SLAB_DEFAULTS.slabThickness, loopResult.wallIds);

      /* 同时生成天花板（使用相同的室内净轮廓和墙体 ID 列表，建立双向绑定） */
      this._tryAutoGenerateCeiling(signature, innerOutline, loopResult.wallIds);
    }
  }

  /**
   * 尝试自动生成天花板
   * 由 _tryAutoGenerateSlab 在检测到封闭环时调用
   * 使用与楼板相同的室内净轮廓，生成贴合墙顶的天花板
   * 同时将关联墙体 ID 传入，建立天花板-墙体双向绑定
   * @param signature - 封闭环签名（与楼板签名相同，防止重复生成）
   * @param innerOutline - 室内净轮廓（与楼板相同）
   * @param wallIds - 围合该封闭环的墙体 ID 列表
   */
  private _tryAutoGenerateCeiling(signature: string, innerOutline: Point2D[], wallIds: string[]): void {
    /* 检查是否已生成过天花板 */
    if (this._generatedCeilingSignatures.has(signature)) {
      return;
    }

    /* 记录签名并生成天花板，传入关联墙体 ID 列表 */
    this._generatedCeilingSignatures.add(signature);
    this.createCeiling(innerOutline, CEILING_DEFAULTS.ceilingThickness, CEILING_DEFAULTS.bottomOffset, wallIds);
  }

  /**
   * 根据封闭环刷新对应的楼板和天花板。
   * 关键流程：优先通过墙体已有 slabId/ceilingId 复用对象并重建轮廓；没有既有关联时创建新对象并写回墙体关联。
   * @param signature - 当前中心线封闭环签名
   * @param centerOutline - 当前中心线封闭环轮廓
   * @param wallIds - 围合该封闭环的墙体 ID 列表
   */
  private _refreshClosedSurfaceFromLoop(signature: string, centerOutline: Point2D[], wallIds: string[]): void {
    const innerOutline: Point2D[] = this._convertOutlineToInnerBoundary(centerOutline, wallIds);

    /* 楼板分支：有关联则更新轮廓，无关联则新建并绑定，确保拖拽后面积/边长标注跟随楼板数据刷新。 */
    const existingSlabId: string | null = this._findExistingSlabIdForWalls(wallIds);
    if (existingSlabId !== null) {
      const slabObject: BuildingObject | undefined = this._objects.get(existingSlabId);
      if (slabObject !== undefined && slabObject.category === 'slab') {
        const slabData: SlabData = slabObject as SlabData;
        slabData.outline = innerOutline;
        this._removeMeshFromScene(existingSlabId);
        this._createSlabMesh(slabData);
        this._syncWallsToSlab(existingSlabId, wallIds);
        this._generatedSlabSignatures.add(signature);
        this._notify(existingSlabId, 'update');
      }
    } else if (!this._generatedSlabSignatures.has(signature)) {
      this._generatedSlabSignatures.add(signature);
      this.createSlab(innerOutline, SLAB_DEFAULTS.slabThickness, wallIds);
    }

    /* 天花板分支：拖拽导致封闭轮廓变化时，复用既有天花板并保持原厚度/高度配置。 */
    const existingCeilingId: string | null = this._findExistingCeilingIdForWalls(wallIds);
    if (existingCeilingId !== null) {
      const ceilingObject: BuildingObject | undefined = this._objects.get(existingCeilingId);
      if (ceilingObject !== undefined && ceilingObject.category === 'ceiling') {
        const ceilingData: CeilingData = ceilingObject as CeilingData;
        ceilingData.outline = innerOutline;
        ceilingData.wallIds = wallIds.slice();
        this._removeMeshFromScene(existingCeilingId);
        this._createCeilingMesh(ceilingData);
        this._syncWallsToCeiling(existingCeilingId, wallIds, ceilingData.bottomOffset);
        this._generatedCeilingSignatures.add(signature);
        this._notify(existingCeilingId, 'update');
      }
    } else if (!this._generatedCeilingSignatures.has(signature)) {
      this._generatedCeilingSignatures.add(signature);
      this.createCeiling(innerOutline, CEILING_DEFAULTS.ceilingThickness, CEILING_DEFAULTS.bottomOffset, wallIds);
    }
  }

  /**
   * 查找指定墙体集合已关联的楼板 ID。
   * @param wallIds - 围合封闭区域的墙体 ID 列表
   * @returns 关联楼板 ID；没有有效关联时返回 null
   */
  private _findExistingSlabIdForWalls(wallIds: string[]): string | null {
    for (const wallId of wallIds) {
      const wallObject: BuildingObject | undefined = this._objects.get(wallId);
      if (wallObject === undefined || wallObject.category !== 'wall' || (wallObject as WallData).subType !== 'straight') {
        continue;
      }
      const straightWall: StraightWallData = wallObject as StraightWallData;
      if (straightWall.slabId !== null && this._objects.get(straightWall.slabId)?.category === 'slab') {
        return straightWall.slabId;
      }
    }
    return null;
  }

  /**
   * 查找指定墙体集合已关联的天花板 ID。
   * @param wallIds - 围合封闭区域的墙体 ID 列表
   * @returns 关联天花板 ID；没有有效关联时返回 null
   */
  private _findExistingCeilingIdForWalls(wallIds: string[]): string | null {
    for (const wallId of wallIds) {
      const wallObject: BuildingObject | undefined = this._objects.get(wallId);
      if (wallObject === undefined || wallObject.category !== 'wall' || (wallObject as WallData).subType !== 'straight') {
        continue;
      }
      const straightWall: StraightWallData = wallObject as StraightWallData;
      if (straightWall.ceilingId !== null && this._objects.get(straightWall.ceilingId)?.category === 'ceiling') {
        return straightWall.ceilingId;
      }
    }

    const wallIdSet: Set<string> = new Set<string>(wallIds);
    for (const objectData of this._objects.values()) {
      if (objectData.category !== 'ceiling') {
        continue;
      }
      const ceilingData: CeilingData = objectData as CeilingData;
      const hasSharedWall: boolean = ceilingData.wallIds.some((wallId: string): boolean => wallIdSet.has(wallId));
      if (hasSharedWall) {
        return ceilingData.id;
      }
    }
    return null;
  }

  /**
   * 将指定墙体列表的 slabId 写回。
   * @param slabId - 楼板 ID
   * @param wallIds - 围合该楼板的墙体 ID 列表
   */
  private _syncWallsToSlab(slabId: string, wallIds: string[]): void {
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
      straightWall.slabId = slabId;
      this._notify(wallId, 'update');
    }
  }

  /**
   * 将中心线节点轮廓还原为室内净轮廓。
   * 关键流程：按封闭环每段墙厚向室内侧偏移半墙厚，并使用相邻偏移线交点得到连续室内角点。
   * @param centerOutline - 中心线节点坐标数组（封闭环，首尾不重复）
   * @param wallIds - 对应的墙体 ID 数组（wallIds[i] 为节点 i 到节点 i+1 的墙体）
   * @returns 室内净边界角点坐标数组
   */
  private _convertOutlineToInnerBoundary(
    centerOutline: Point2D[],
    wallIds: string[]
  ): Point2D[] {
    const thicknesses: number[] = this._collectWallThicknesses(wallIds);
    return WallPlacementLineConverter.convertCenterOutlineToInnerBoundary(centerOutline, thicknesses);
  }

  /**
   * 收集封闭环每段墙体厚度。
   * @param wallIds - 围合封闭区域的墙体 ID 列表
   * @returns 与墙体 ID 顺序一致的墙厚数组
   */
  private _collectWallThicknesses(wallIds: string[]): number[] {
    const thicknesses: number[] = [];
    for (const wallId of wallIds) {
      const wallData: BuildingObject | undefined = this._objects.get(wallId);
      const thickness: number =
        wallData !== undefined && wallData.category === 'wall'
          ? (wallData as WallData).thickness
          : WALL_DEFAULTS.thickness;
      thicknesses.push(thickness);
    }
    return thicknesses;
  }

  /**
   * 计算多边形轮廓的唯一签名
   * 将所有顶点坐标四舍五入后排序拼接，使同一多边形无论起点如何都产生相同签名
   * @param outline - 多边形顶点数组
   * @returns 签名字符串
   */
  private _computeOutlineSignature(outline: Point2D[]): string {
    /* 将每个顶点转换为固定精度字符串 */
    const pointStrings: string[] = outline.map(
      (pt: Point2D): string => `${pt.x.toFixed(3)},${pt.z.toFixed(3)}`
    );
    /* 排序后拼接，消除起点差异 */
    pointStrings.sort();
    return pointStrings.join('|');
  }

  /**
   * 重建与指定墙体共享节点的相邻墙体几何
   * 当新墙体注册到节点后，已有的相邻墙体需要重新计算 miter 并重建几何
   * @param wallId - 触发重建的墙体 ID（自身不重建）
   */
  private _rebuildAdjacentWalls(wallId: string): void {
    const joints = this._connectionManager.getWallJoints(wallId);
    const rebuiltSet: Set<string> = new Set();

    /* 遍历起点和终点的节点 */
    const jointIds: Array<string | null> = [joints.start, joints.end];
    for (const jointId of jointIds) {
      if (jointId === null) continue;
      const connections: Array<WallConnection> = this._connectionManager.getJointConnections(jointId);

      for (const conn of connections) {
        /* 跳过自身，避免重复重建 */
        if (conn.wallId === wallId || rebuiltSet.has(conn.wallId)) continue;
        rebuiltSet.add(conn.wallId);

        const adjObj: BuildingObject | undefined = this._objects.get(conn.wallId);
        if (adjObj === undefined || adjObj.category !== 'wall') continue;

        const adjWall: WallData = adjObj as WallData;
        /* 只对直墙重建（弧形墙暂不支持 miter） */
        if (adjWall.subType !== 'straight') continue;

        /* 移除旧 Mesh 并重新创建 */
        this._removeMeshFromScene(conn.wallId);
        this._createWallMesh(adjWall);
      }
    }
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
    this._listeners.clear();
  }
}
