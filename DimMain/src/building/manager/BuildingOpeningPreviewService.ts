/**
 * 墙体洞口预览服务。
 * 专门处理门窗布置期间的临时墙体几何替换，不修改墙体数据层 openings。
 */

import * as THREE from 'three/webgpu';
import type { BuildingObject, MiterParams, Point2D, StraightWallData, WallData, WallOpening } from '../BuildingTypes';
import { BuildingMaterialFactory } from './BuildingMaterialFactory';
import { WallConnectionManager } from '../WallConnectionManager';
import { WallGeometryBuilder } from '../WallGeometryBuilder';

/** 墙体洞口预览服务。 */
export class BuildingOpeningPreviewService {
  /** 普通墙体材质面数量。 */
  private static readonly WALL_FACE_COUNT: number = 6;

  /** 带洞口墙体材质面数量。 */
  private static readonly WALL_FACE_COUNT_WITH_OPENING: number = 7;

  /** 所有建筑对象数据索引。 */
  private readonly _objects: Map<string, BuildingObject>;

  /** 所有建筑对象 Mesh 索引。 */
  private readonly _meshes: Map<string, THREE.Mesh>;

  /** 墙体几何构建器。 */
  private readonly _wallBuilder: WallGeometryBuilder;

  /** 墙体连接管理器。 */
  private readonly _connectionManager: WallConnectionManager;

  /** 获取墙体端点信息的回调。 */
  private readonly _getWallEndpoints: () => (id: string) => { start: Point2D; end: Point2D; thickness: number } | null;

  /**
   * @param objects - 建筑对象数据索引。
   * @param meshes - 建筑对象 Mesh 索引。
   * @param wallBuilder - 墙体几何构建器。
   * @param connectionManager - 墙体连接管理器。
   * @param getWallEndpoints - 获取墙体端点信息的回调工厂。
   */
  public constructor(
    objects: Map<string, BuildingObject>,
    meshes: Map<string, THREE.Mesh>,
    wallBuilder: WallGeometryBuilder,
    connectionManager: WallConnectionManager,
    getWallEndpoints: () => (id: string) => { start: Point2D; end: Point2D; thickness: number } | null
  ) {
    this._objects = objects;
    this._meshes = meshes;
    this._wallBuilder = wallBuilder;
    this._connectionManager = connectionManager;
    this._getWallEndpoints = getWallEndpoints;
  }

  /**
   * 临时用指定洞口列表重建墙体 Mesh 的几何体。
   * @param wallId - 目标墙体 ID。
   * @param previewOpenings - 预览用洞口列表。
   * @returns 是否成功完成预览替换。
   */
  public previewOpeningOnMesh(wallId: string, previewOpenings: WallOpening[]): boolean {
    const straightWall: StraightWallData | null = this.getStraightWallData(wallId);
    if (straightWall === null) {
      return false;
    }
    const mesh: THREE.Mesh | undefined = this._meshes.get(wallId);
    if (mesh === undefined) {
      return false;
    }

    /* 洞口预览流程：构造临时墙体数据并替换 Mesh 几何体，避免污染真实 openings。 */
    const tempData: StraightWallData = { ...straightWall, openings: previewOpenings };
    const miter: MiterParams = this._connectionManager.computeMiterForWall(
      wallId,
      straightWall.start,
      straightWall.end,
      straightWall.thickness,
      this._getWallEndpoints()
    );
    const previewGeometry: THREE.BufferGeometry = this._wallBuilder.buildWithMiter(tempData, miter);
    BuildingOpeningPreviewService.replaceMeshGeometry(mesh, previewGeometry);
    BuildingOpeningPreviewService.ensureWallMaterialCount(mesh, straightWall, BuildingOpeningPreviewService.WALL_FACE_COUNT_WITH_OPENING);
    return true;
  }

  /**
   * 恢复指定墙体的原始几何体。
   * @param wallId - 目标墙体 ID。
   */
  public clearOpeningPreview(wallId: string): void {
    const straightWall: StraightWallData | null = this.getStraightWallData(wallId);
    if (straightWall === null) {
      return;
    }
    const mesh: THREE.Mesh | undefined = this._meshes.get(wallId);
    if (mesh === undefined) {
      return;
    }

    /* 清理预览流程：按真实墙体数据重建几何体，并按真实洞口数量恢复材质面数量。 */
    const miter: MiterParams = this._connectionManager.computeMiterForWall(
      wallId,
      straightWall.start,
      straightWall.end,
      straightWall.thickness,
      this._getWallEndpoints()
    );
    const restoredGeometry: THREE.BufferGeometry = this._wallBuilder.buildWithMiter(straightWall, miter);
    BuildingOpeningPreviewService.replaceMeshGeometry(mesh, restoredGeometry);
    const hasOpenings: boolean = (straightWall.openings?.length ?? 0) > 0;
    const faceCount: number = hasOpenings
      ? BuildingOpeningPreviewService.WALL_FACE_COUNT_WITH_OPENING
      : BuildingOpeningPreviewService.WALL_FACE_COUNT;
    BuildingOpeningPreviewService.ensureWallMaterialCount(mesh, straightWall, faceCount);
  }

  /**
   * 获取直墙数据。
   * @param wallId - 墙体 ID。
   * @returns 直墙数据；对象不存在或不是直墙时返回 null。
   */
  private getStraightWallData(wallId: string): StraightWallData | null {
    const objectData: BuildingObject | undefined = this._objects.get(wallId);
    if (objectData === undefined || objectData.category !== 'wall') {
      return null;
    }
    const wallData: WallData = objectData as WallData;
    if (wallData.subType !== 'straight') {
      return null;
    }
    return wallData as StraightWallData;
  }

  /**
   * 安全替换 Mesh 几何体并释放旧几何体。
   * @param mesh - 目标 Mesh。
   * @param nextGeometry - 新几何体。
   */
  private static replaceMeshGeometry(mesh: THREE.Mesh, nextGeometry: THREE.BufferGeometry): void {
    /* 替换流程：先赋值再释放旧几何体，避免 WebGPU 同帧缓存继续访问已销毁 BufferAttribute。 */
    const previousGeometry: THREE.BufferGeometry = mesh.geometry;
    mesh.geometry = nextGeometry;
    previousGeometry.dispose();
  }

  /**
   * 确保墙体 Mesh 材质数量与几何体分组数量一致。
   * @param mesh - 目标 Mesh。
   * @param wallData - 墙体数据。
   * @param faceCount - 目标材质数量。
   */
  private static ensureWallMaterialCount(mesh: THREE.Mesh, wallData: StraightWallData, faceCount: number): void {
    if (Array.isArray(mesh.material) && (mesh.material as Array<THREE.Material>).length === faceCount) {
      return;
    }
    BuildingOpeningPreviewService.disposeMeshMaterials(mesh);
    const newMaterials: Array<THREE.Material> = [];
    for (let materialIndex: number = 0; materialIndex < faceCount; materialIndex++) {
      newMaterials.push(BuildingMaterialFactory.createMaterialFromProperties(wallData.material));
    }
    mesh.material = newMaterials;
  }

  /**
   * 释放 Mesh 当前材质资源。
   * @param mesh - 目标 Mesh。
   */
  private static disposeMeshMaterials(mesh: THREE.Mesh): void {
    if (Array.isArray(mesh.material)) {
      const materials: Array<THREE.Material> = mesh.material as Array<THREE.Material>;
      for (const material of materials) {
        material.dispose();
      }
      return;
    }
    (mesh.material as THREE.Material).dispose();
  }
}