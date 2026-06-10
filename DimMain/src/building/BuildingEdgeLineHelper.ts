/**
 * 建筑结构边线辅助工具
 * 负责从建筑实体几何体中提取非共面结构边，并生成 WebGPU 兼容的 LineSegments 线稿对象。
 */

import * as THREE from 'three/webgpu';

/**
 * 建筑边线创建配置
 */
export interface BuildingEdgeLineOptions {
  /** 需要从边线提取中排除的 geometry group materialIndex 列表，例如墙洞内壁面。 */
  excludeGroupIndices?: number[];
  /** 边线颜色，默认深灰色。 */
  color?: THREE.ColorRepresentation;
  /** 共面判断点积阈值，越接近 1 越严格，默认 0.999。 */
  coplanarDotThreshold?: number;
}

/**
 * BufferGeometry 分组信息。
 * three/webgpu 中 THREE.Group 表示 Object3D 分组对象，因此这里单独声明 geometry.groups 的数据结构。
 */
interface GeometryGroupInfo {
  /** 当前分组在索引缓冲中的起始位置。 */
  start: number;
  /** 当前分组包含的索引数量。 */
  count: number;
  /** 当前分组对应的材质索引。 */
  materialIndex?: number;
}

/**
 * 建筑结构边线辅助工具
 */
export class BuildingEdgeLineHelper {
  /** 默认线稿颜色。 */
  private static readonly DEFAULT_COLOR: THREE.ColorRepresentation = 0x333333;

  /** 默认共面判断阈值：法向量点积 > 0.999 视为共面（夹角 < 约 2.6°）。 */
  private static readonly DEFAULT_COPLANAR_DOT_THRESHOLD: number = 0.999;

  /** 坐标合并精度，用于将 CSG/挤压几何中的重复物理顶点合并为逻辑顶点。 */
  private static readonly COORDINATE_PRECISION: number = 6;

  /**
   * 创建过滤后的建筑结构边线。
   * 关键流程：合并同坐标顶点，统计每条逻辑边相邻面的法向量，隐藏共面三角剖分边，仅保留边界边与折角边。
   * @param geometry - 需要提取结构边的实体几何体
   * @param options - 边线创建配置
   * @returns LineSegments 边线对象；当几何体无有效索引或无可见边时返回 null
   */
  public static createFilteredEdges(
    geometry: THREE.BufferGeometry,
    options: BuildingEdgeLineOptions = {}
  ): THREE.LineSegments | null {
    const positionAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined = geometry.getAttribute('position');
    if (positionAttribute === undefined || positionAttribute === null) {
      return null;
    }

    const indices: THREE.BufferAttribute | null = geometry.getIndex();
    if (indices === null) {
      return null;
    }

    const excludeGroupIndices: number[] = options.excludeGroupIndices ?? [];
    const threshold: number = options.coplanarDotThreshold ?? BuildingEdgeLineHelper.DEFAULT_COPLANAR_DOT_THRESHOLD;
    const totalVertices: number = positionAttribute.count;
    const count: number = indices.count;

    /* 第一步：将坐标相同的物理顶点归并为逻辑顶点，避免 CSG 重复顶点导致边线断裂。 */
    const coordToLogicalId: Map<string, number> = new Map<string, number>();
    const physicalToLogical: number[] = new Array<number>(totalVertices);
    let logicalVertexCount: number = 0;

    for (let index: number = 0; index < totalVertices; index++) {
      const coordKey: string = BuildingEdgeLineHelper._createCoordinateKey(positionAttribute, index);
      let logicalId: number | undefined = coordToLogicalId.get(coordKey);
      if (logicalId === undefined) {
        logicalId = logicalVertexCount;
        coordToLogicalId.set(coordKey, logicalId);
        logicalVertexCount += 1;
      }
      physicalToLogical[index] = logicalId;
    }

    /* 第二步：建立逻辑边到相邻面法向量、物理顶点对的映射。 */
    const edgeToNormals: Map<string, THREE.Vector3[]> = new Map<string, THREE.Vector3[]>();
    const edgeToPhysical: Map<string, [number, number]> = new Map<string, [number, number]>();
    const triangleToMaterialIndex: Map<number, number> = BuildingEdgeLineHelper._createTriangleMaterialIndexMap(
      geometry,
      excludeGroupIndices
    );

    for (let index: number = 0; index < count; index += 3) {
      if (BuildingEdgeLineHelper._shouldSkipTriangle(index, triangleToMaterialIndex, excludeGroupIndices)) {
        continue;
      }

      const physA: number = indices.getX(index);
      const physB: number = indices.getX(index + 1);
      const physC: number = indices.getX(index + 2);
      const normal: THREE.Vector3 = BuildingEdgeLineHelper._computeTriangleNormal(positionAttribute, physA, physB, physC);
      const logA: number = physicalToLogical[physA]!;
      const logB: number = physicalToLogical[physB]!;
      const logC: number = physicalToLogical[physC]!;

      BuildingEdgeLineHelper._registerFaceEdge(edgeToNormals, edgeToPhysical, logA, logB, physA, physB, normal);
      BuildingEdgeLineHelper._registerFaceEdge(edgeToNormals, edgeToPhysical, logB, logC, physB, physC, normal);
      BuildingEdgeLineHelper._registerFaceEdge(edgeToNormals, edgeToPhysical, logC, logA, physC, physA, normal);
    }

    /* 第三步：过滤掉共面边，只保留真正可见的建筑结构折线。 */
    const visibleEdges: Array<[number, number]> = BuildingEdgeLineHelper._collectVisibleEdges(
      edgeToNormals,
      edgeToPhysical,
      threshold
    );

    if (visibleEdges.length === 0) {
      return null;
    }

    return BuildingEdgeLineHelper._createLineSegments(positionAttribute, visibleEdges, options.color);
  }

  /**
   * 释放建筑边线对象占用的 GPU 资源。
   * @param line - 需要释放的边线对象
   */
  public static disposeLineSegments(line: THREE.LineSegments): void {
    line.geometry.dispose();
    if (line.material instanceof THREE.Material) {
      const material: THREE.Material = line.material as THREE.Material;
      material.dispose();
    }
  }

  /**
   * 根据顶点坐标生成稳定 key。
   * @param positionAttribute - 顶点位置属性
   * @param index - 顶点索引
   * @returns 坐标 key
   */
  private static _createCoordinateKey(
    positionAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    index: number
  ): string {
    return `${positionAttribute.getX(index).toFixed(BuildingEdgeLineHelper.COORDINATE_PRECISION)},` +
      `${positionAttribute.getY(index).toFixed(BuildingEdgeLineHelper.COORDINATE_PRECISION)},` +
      `${positionAttribute.getZ(index).toFixed(BuildingEdgeLineHelper.COORDINATE_PRECISION)}`;
  }

  /**
   * 建立三角形起始索引到 materialIndex 的映射。
   * @param geometry - 几何体
   * @param excludeGroupIndices - 需要排除的 materialIndex 列表
   * @returns 三角形 materialIndex 映射
   */
  private static _createTriangleMaterialIndexMap(
    geometry: THREE.BufferGeometry,
    excludeGroupIndices: number[]
  ): Map<number, number> {
    const triangleToMaterialIndex: Map<number, number> = new Map<number, number>();
    if (excludeGroupIndices.length === 0) {
      return triangleToMaterialIndex;
    }

    for (let groupIndex: number = 0; groupIndex < geometry.groups.length; groupIndex++) {
      const group: GeometryGroupInfo = geometry.groups[groupIndex]! as GeometryGroupInfo;
      const groupEnd: number = group.start + group.count;
      for (let index: number = group.start; index < groupEnd; index += 3) {
        triangleToMaterialIndex.set(index, group.materialIndex ?? 0);
      }
    }

    return triangleToMaterialIndex;
  }

  /**
   * 判断当前三角形是否需要跳过。
   * @param triangleStartIndex - 三角形在索引缓冲中的起始索引
   * @param triangleToMaterialIndex - 三角形 materialIndex 映射
   * @param excludeGroupIndices - 需要排除的 materialIndex 列表
   * @returns 需要跳过时返回 true
   */
  private static _shouldSkipTriangle(
    triangleStartIndex: number,
    triangleToMaterialIndex: Map<number, number>,
    excludeGroupIndices: number[]
  ): boolean {
    if (excludeGroupIndices.length === 0) {
      return false;
    }

    const materialIndex: number | undefined = triangleToMaterialIndex.get(triangleStartIndex);
    if (materialIndex === undefined) {
      return false;
    }

    return excludeGroupIndices.includes(materialIndex);
  }

  /**
   * 计算三角面的单位法向量。
   * @param positionAttribute - 顶点位置属性
   * @param physA - 顶点 A 的物理索引
   * @param physB - 顶点 B 的物理索引
   * @param physC - 顶点 C 的物理索引
   * @returns 三角面法向量
   */
  private static _computeTriangleNormal(
    positionAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    physA: number,
    physB: number,
    physC: number
  ): THREE.Vector3 {
    const vertexA: THREE.Vector3 = new THREE.Vector3(
      positionAttribute.getX(physA),
      positionAttribute.getY(physA),
      positionAttribute.getZ(physA)
    );
    const vertexB: THREE.Vector3 = new THREE.Vector3(
      positionAttribute.getX(physB),
      positionAttribute.getY(physB),
      positionAttribute.getZ(physB)
    );
    const vertexC: THREE.Vector3 = new THREE.Vector3(
      positionAttribute.getX(physC),
      positionAttribute.getY(physC),
      positionAttribute.getZ(physC)
    );
    const edgeAB: THREE.Vector3 = new THREE.Vector3().subVectors(vertexB, vertexA);
    const edgeAC: THREE.Vector3 = new THREE.Vector3().subVectors(vertexC, vertexA);
    const normal: THREE.Vector3 = new THREE.Vector3().crossVectors(edgeAB, edgeAC).normalize();
    return normal;
  }

  /**
   * 注册单个三角面的逻辑边与面法向量。
   * @param edgeToNormals - 逻辑边到相邻面法向量的映射
   * @param edgeToPhysical - 逻辑边到物理顶点对的映射
   * @param logicalA - 边起点逻辑索引
   * @param logicalB - 边终点逻辑索引
   * @param physicalA - 边起点物理索引
   * @param physicalB - 边终点物理索引
   * @param normal - 当前三角面法向量
   */
  private static _registerFaceEdge(
    edgeToNormals: Map<string, THREE.Vector3[]>,
    edgeToPhysical: Map<string, [number, number]>,
    logicalA: number,
    logicalB: number,
    physicalA: number,
    physicalB: number,
    normal: THREE.Vector3
  ): void {
    const edgeKey: string = logicalA < logicalB ? `${logicalA}-${logicalB}` : `${logicalB}-${logicalA}`;
    let normals: THREE.Vector3[] | undefined = edgeToNormals.get(edgeKey);
    if (normals === undefined) {
      normals = [];
      edgeToNormals.set(edgeKey, normals);
      edgeToPhysical.set(edgeKey, [physicalA, physicalB]);
    }
    normals.push(normal);
  }

  /**
   * 收集需要显示的边界边与折角边。
   * @param edgeToNormals - 逻辑边到相邻面法向量的映射
   * @param edgeToPhysical - 逻辑边到物理顶点对的映射
   * @param threshold - 共面判断阈值
   * @returns 可见物理顶点边列表
   */
  private static _collectVisibleEdges(
    edgeToNormals: Map<string, THREE.Vector3[]>,
    edgeToPhysical: Map<string, [number, number]>,
    threshold: number
  ): Array<[number, number]> {
    const visibleEdges: Array<[number, number]> = [];

    edgeToNormals.forEach((normals: THREE.Vector3[], edgeKey: string): void => {
      const physicalPair: [number, number] | undefined = edgeToPhysical.get(edgeKey);
      if (physicalPair === undefined) {
        return;
      }

      if (normals.length === 1) {
        visibleEdges.push(physicalPair);
        return;
      }

      const isCoplanar: boolean = BuildingEdgeLineHelper._hasCoplanarAdjacentFace(normals, threshold);
      if (!isCoplanar) {
        visibleEdges.push(physicalPair);
      }
    });

    return visibleEdges;
  }

  /**
   * 判断一条逻辑边的相邻面中是否存在共面关系。
   * @param normals - 相邻面法向量列表
   * @param threshold - 共面判断阈值
   * @returns 存在共面相邻面时返回 true
   */
  private static _hasCoplanarAdjacentFace(normals: THREE.Vector3[], threshold: number): boolean {
    for (let firstIndex: number = 0; firstIndex < normals.length - 1; firstIndex++) {
      for (let secondIndex: number = firstIndex + 1; secondIndex < normals.length; secondIndex++) {
        const cosAngle: number = Math.abs(normals[firstIndex]!.dot(normals[secondIndex]!));
        if (cosAngle > threshold) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 根据可见边顶点创建 LineSegments 对象。
   * @param positionAttribute - 顶点位置属性
   * @param visibleEdges - 可见物理顶点边列表
   * @param color - 边线颜色
   * @returns LineSegments 对象
   */
  private static _createLineSegments(
    positionAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    visibleEdges: Array<[number, number]>,
    color: THREE.ColorRepresentation | undefined
  ): THREE.LineSegments {
    const vertices: Float32Array = new Float32Array(visibleEdges.length * 6);
    for (let edgeIndex: number = 0; edgeIndex < visibleEdges.length; edgeIndex++) {
      const edgePair: [number, number] = visibleEdges[edgeIndex]!;
      const startIndex: number = edgePair[0];
      const endIndex: number = edgePair[1];
      vertices[edgeIndex * 6] = positionAttribute.getX(startIndex);
      vertices[edgeIndex * 6 + 1] = positionAttribute.getY(startIndex);
      vertices[edgeIndex * 6 + 2] = positionAttribute.getZ(startIndex);
      vertices[edgeIndex * 6 + 3] = positionAttribute.getX(endIndex);
      vertices[edgeIndex * 6 + 4] = positionAttribute.getY(endIndex);
      vertices[edgeIndex * 6 + 5] = positionAttribute.getZ(endIndex);
    }

    const lineGeometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

    const colorValue: THREE.ColorRepresentation = color ?? BuildingEdgeLineHelper.DEFAULT_COLOR;
    const lineMaterial: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
      color: colorValue,
      depthTest: true,
      depthWrite: false,
    });

    const lines: THREE.LineSegments = new THREE.LineSegments(lineGeometry, lineMaterial);
    lines.userData['isWireframe'] = true;
    return lines;
  }
}