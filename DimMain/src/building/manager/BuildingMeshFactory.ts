/**
 * 建筑模型 Mesh 工厂。
 * 按建筑模型类型集中创建墙、梁、楼板、天花板的 Three.js Mesh，避免对象管理器承载过多渲染构建细节。
 */

import * as THREE from 'three/webgpu';
import type {
  ArcWallData,
  BeamData,
  BuildingObject,
  CeilingData,
  MaterialProperties,
  MiterParams,
  Point2D,
  SlabData,
  StraightWallData,
  WallData,
  WallEndpointDirection,
} from '../BuildingTypes';
import { BeamGeometryBuilder } from '../BeamGeometryBuilder';
import { BeamMiterCalculator } from '../BeamMiterCalculator';
import { CeilingGeometryBuilder } from '../CeilingGeometryBuilder';
import { SlabGeometryBuilder } from '../SlabGeometryBuilder';
import { WallConnectionManager } from '../WallConnectionManager';
import { WallGeometryBuilder } from '../WallGeometryBuilder';

/** 材质创建函数。 */
export type BuildingMaterialCreator = (props: MaterialProperties) => THREE.Material;

/** 折角线框创建函数。 */
export type BuildingFilteredEdgeCreator = (
  geometry: THREE.BufferGeometry,
  excludeGroupIndices?: number[],
  hideArcSegmentVerticalEdges?: boolean
) => THREE.LineSegments | null;

/** 面状构件边线创建函数。 */
export type BuildingSurfaceEdgeCreator = (
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation
) => THREE.Object3D | null;

/** 墙体端点查询函数。 */
export type BuildingWallEndpointsGetter = (id: string) => { start: Point2D; end: Point2D; thickness: number } | null;

/** 墙体端点方向查询函数。 */
export type BuildingWallEndpointDirectionGetter = (id: string) => WallEndpointDirection | null;

/** 墙 Mesh 创建配置。 */
export interface BuildingWallMeshFactoryOptions {
  /** 墙几何构建器。 */
  wallBuilder: WallGeometryBuilder;
  /** 墙连接拓扑管理器。 */
  connectionManager: WallConnectionManager;
  /** 墙端点查询函数。 */
  getWallEndpoints: BuildingWallEndpointsGetter;
  /** 墙端点方向查询函数。 */
  getWallEndpointDirection: BuildingWallEndpointDirectionGetter;
  /** 材质创建函数。 */
  createMaterial: BuildingMaterialCreator;
  /** 折角线框创建函数。 */
  createFilteredEdges: BuildingFilteredEdgeCreator;
  /** 普通墙面材质数量。 */
  wallFaceCount: number;
  /** 带洞口墙面材质数量。 */
  wallFaceCountWithOpening: number;
}

/** 梁 Mesh 创建配置。 */
export interface BuildingBeamMeshFactoryOptions {
  /** 梁几何构建器。 */
  beamBuilder: BeamGeometryBuilder;
  /** 梁斜接计算器。 */
  beamMiterCalculator: BeamMiterCalculator;
  /** 全量梁数据查询函数。 */
  getAllBeamData: () => BeamData[];
  /** 材质创建函数。 */
  createMaterial: BuildingMaterialCreator;
  /** 折角线框创建函数。 */
  createFilteredEdges: BuildingFilteredEdgeCreator;
}

/** 楼板 Mesh 创建配置。 */
export interface BuildingSlabMeshFactoryOptions {
  /** 楼板几何构建器。 */
  slabBuilder: SlabGeometryBuilder;
  /** 材质创建函数。 */
  createMaterial: BuildingMaterialCreator;
  /** 面状构件边线创建函数。 */
  createSurfaceEdgeWireframe: BuildingSurfaceEdgeCreator;
}

/** 天花板 Mesh 创建配置。 */
export interface BuildingCeilingMeshFactoryOptions {
  /** 天花板几何构建器。 */
  ceilingBuilder: CeilingGeometryBuilder;
  /** 材质创建函数。 */
  createMaterial: BuildingMaterialCreator;
  /** 面状构件边线创建函数。 */
  createSurfaceEdgeWireframe: BuildingSurfaceEdgeCreator;
}

/** 建筑模型 Mesh 工厂。 */
export class BuildingMeshFactory {
  /**
   * 创建墙体 Mesh。
   * 关键流程：按直墙/弧墙计算端点斜接，创建面级独立材质，并挂载折角线框。
   * @param data - 墙体数据。
   * @param options - 墙体 Mesh 创建配置。
   * @returns 墙体 Mesh；矩形墙由子墙表达时返回 null。
   */
  public static createWallMesh(data: WallData, options: BuildingWallMeshFactoryOptions): THREE.Mesh | null {
    if (data.subType === 'rect') {
      return null;
    }

    const geometry: THREE.BufferGeometry = BuildingMeshFactory.createWallGeometry(data, options);
    const hasStraightOpenings: boolean = BuildingMeshFactory.hasStraightWallOpenings(data);
    const faceCount: number = hasStraightOpenings ? options.wallFaceCountWithOpening : options.wallFaceCount;
    const materials: THREE.Material[] = BuildingMeshFactory.createMaterialArray(data.material, faceCount, options.createMaterial);
    const mesh: THREE.Mesh = BuildingMeshFactory.createNamedMesh(data, geometry, materials);

    const excludeGroups: number[] = hasStraightOpenings ? [2] : [];
    const shouldHideArcSegmentVerticalEdges: boolean = data.subType === 'arc';
    const wireframe: THREE.LineSegments | null = options.createFilteredEdges(
      mesh.geometry,
      excludeGroups,
      shouldHideArcSegmentVerticalEdges
    );
    BuildingMeshFactory.attachWireframe(mesh, wireframe);
    return mesh;
  }

  /**
   * 创建梁 Mesh。
   * 关键流程：刷新梁长度与底标高，根据相邻梁端点计算斜接后挂载折角线框。
   * @param data - 梁数据。
   * @param options - 梁 Mesh 创建配置。
   * @returns 梁 Mesh。
   */
  public static createBeamMesh(data: BeamData, options: BuildingBeamMeshFactoryOptions): THREE.Mesh {
    data.length = BeamGeometryBuilder.computeLength(data.start, data.end);
    data.elevation = BeamGeometryBuilder.computeBottomY(data);

    const beamMiter: MiterParams = options.beamMiterCalculator.computeMiterForBeam(data, options.getAllBeamData());
    const geometry: THREE.BufferGeometry = options.beamBuilder.buildWithMiter(data, beamMiter);
    const material: THREE.Material = options.createMaterial(data.material);
    const mesh: THREE.Mesh = BuildingMeshFactory.createNamedMesh(data, geometry, material);
    const wireframe: THREE.LineSegments | null = options.createFilteredEdges(mesh.geometry);
    BuildingMeshFactory.attachWireframe(mesh, wireframe);
    return mesh;
  }

  /**
   * 创建楼板 Mesh。
   * 关键流程：生成楼板挤压几何，设置楼板顶面高度，并挂载面状构件边线。
   * @param data - 楼板数据。
   * @param options - 楼板 Mesh 创建配置。
   * @returns 楼板 Mesh。
   */
  public static createSlabMesh(data: SlabData, options: BuildingSlabMeshFactoryOptions): THREE.Mesh {
    const geometry: THREE.BufferGeometry = options.slabBuilder.build(data);
    const material: THREE.Material = options.createMaterial(data.material);
    const mesh: THREE.Mesh = BuildingMeshFactory.createNamedMesh(data, geometry, material);
    mesh.position.set(0, data.topOffset - data.slabThickness, 0);

    const slabWireframe: THREE.Object3D | null = options.createSurfaceEdgeWireframe(geometry, 0x555555);
    BuildingMeshFactory.attachWireframe(mesh, slabWireframe);
    return mesh;
  }

  /**
   * 创建天花板 Mesh。
   * 关键流程：生成天花板挤压几何，设置底面贴合高度，并挂载面状构件边线。
   * @param data - 天花板数据。
   * @param options - 天花板 Mesh 创建配置。
   * @returns 天花板 Mesh。
   */
  public static createCeilingMesh(data: CeilingData, options: BuildingCeilingMeshFactoryOptions): THREE.Mesh {
    const geometry: THREE.BufferGeometry = options.ceilingBuilder.build(data);
    const material: THREE.Material = options.createMaterial(data.material);
    const mesh: THREE.Mesh = BuildingMeshFactory.createNamedMesh(data, geometry, material);
    mesh.position.set(0, data.bottomOffset, 0);

    const ceilWireframe: THREE.Object3D | null = options.createSurfaceEdgeWireframe(geometry, 0x888888);
    BuildingMeshFactory.attachWireframe(mesh, ceilWireframe);
    return mesh;
  }

  private static createWallGeometry(
    data: StraightWallData | ArcWallData,
    options: BuildingWallMeshFactoryOptions
  ): THREE.BufferGeometry {
    const miter: MiterParams = options.connectionManager.computeMiterForWall(
      data.id,
      data.start,
      data.end,
      data.thickness,
      options.getWallEndpoints,
      options.getWallEndpointDirection
    );

    if (data.subType === 'straight') {
      return options.wallBuilder.buildWithMiter(data, miter);
    }

    return options.wallBuilder.buildArcWithMiter(data, miter);
  }

  private static hasStraightWallOpenings(data: WallData): boolean {
    if (data.subType !== 'straight') {
      return false;
    }

    return (data.openings?.length ?? 0) > 0;
  }

  private static createMaterialArray(
    materialProperties: MaterialProperties,
    faceCount: number,
    createMaterial: BuildingMaterialCreator
  ): THREE.Material[] {
    const materials: THREE.Material[] = [];
    for (let faceIndex: number = 0; faceIndex < faceCount; faceIndex++) {
      materials.push(createMaterial(materialProperties));
    }
    return materials;
  }

  private static createNamedMesh(
    data: BuildingObject,
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[]
  ): THREE.Mesh {
    const mesh: THREE.Mesh = new THREE.Mesh(geometry, material);
    mesh.userData['buildingObjectId'] = data.id;
    mesh.name = data.name;
    return mesh;
  }

  private static attachWireframe(mesh: THREE.Mesh, wireframe: THREE.Object3D | null): void {
    if (wireframe === null) {
      return;
    }

    wireframe.position.set(0, 0.001, 0);
    wireframe.renderOrder = 1;
    mesh.add(wireframe);
  }
}