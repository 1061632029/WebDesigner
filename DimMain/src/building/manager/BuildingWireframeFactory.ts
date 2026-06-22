/**
 * 建筑线框工厂。
 * 按渲染功能拆分墙/梁折角线框、楼板/天花板面轮廓线框和 GPU 资源释放逻辑。
 */

import * as THREE from 'three/webgpu';
import { FixedPixelLineSegmentsFactory, type FixedPixelLineSegments } from '../../rendering/FixedPixelLineSegmentsFactory';

/** 建筑线框工厂配置。 */
export interface BuildingWireframeFactoryOptions {
  /** 是否启用固定像素线宽线框。 */
  fixedPixelWireframeEnabled: boolean;
  /** 固定像素线宽，单位为 CSS 像素。 */
  fixedPixelWireframeWidth: number;
  /** 固定像素线段在 NDC 空间的深度偏移。 */
  wireframeDepthOffsetNdc: number;
}

/** 建筑线框工厂。 */
export class BuildingWireframeFactory {
  /**
   * 创建过滤后的折角边界线段，主要用于墙体和梁。
   * @param geometry - 几何体。
   * @param options - 线框创建配置。
   * @param excludeGroupIndices - 需要排除的 materialIndex 列表。
   * @param hideArcSegmentVerticalEdges - 是否隐藏弧形墙内部采样段竖向分割边。
   * @returns 线段对象；无有效边时返回 null。
   */
  public static createFilteredEdges(
    geometry: THREE.BufferGeometry,
    options: BuildingWireframeFactoryOptions,
    excludeGroupIndices: number[] = [],
    hideArcSegmentVerticalEdges: boolean = false
  ): THREE.LineSegments | null {
    const positionAttribute: THREE.BufferAttribute = geometry.getAttribute('position') as THREE.BufferAttribute;
    if (positionAttribute === undefined || positionAttribute === null) {
      return null;
    }

    const indices: THREE.BufferAttribute | null = geometry.getIndex();
    if (indices === null) {
      return null;
    }

    const threshold: number = 0.999;
    const totalVertices: number = positionAttribute.count;
    const count: number = indices.count;
    const coordToLogicalId: Map<string, number> = new Map<string, number>();
    const physicalToLogical: number[] = new Array<number>(totalVertices);
    let logicalVertexCount: number = 0;

    /* 顶点归并流程：用固定精度坐标把 CSG 生成的重复顶点归为同一逻辑顶点。 */
    for (let i: number = 0; i < totalVertices; i++) {
      const coordKey: string = `${positionAttribute.getX(i).toFixed(6)},${positionAttribute.getY(i).toFixed(6)},${positionAttribute.getZ(i).toFixed(6)}`;
      let logicalId: number | undefined = coordToLogicalId.get(coordKey);
      if (logicalId === undefined) {
        logicalId = logicalVertexCount;
        coordToLogicalId.set(coordKey, logicalId);
        logicalVertexCount++;
      }
      physicalToLogical[i] = logicalId;
    }

    const edgeToNormals: Map<string, THREE.Vector3[]> = new Map<string, THREE.Vector3[]>();
    const edgeToPhysical: Map<string, [number, number]> = new Map<string, [number, number]>();
    const triangleToMaterialIndex: Map<number, number> = BuildingWireframeFactory.createTriangleMaterialIndexMap(geometry, excludeGroupIndices);

    for (let i: number = 0; i < count; i += 3) {
      const matIdx: number | undefined = triangleToMaterialIndex.get(i);
      if (matIdx !== undefined && excludeGroupIndices.includes(matIdx)) {
        continue;
      }

      const physA: number = indices.getX(i);
      const physB: number = indices.getX(i + 1);
      const physC: number = indices.getX(i + 2);
      const normal: THREE.Vector3 = BuildingWireframeFactory.computeTriangleNormal(positionAttribute, physA, physB, physC);
      const logA: number = physicalToLogical[physA]!;
      const logB: number = physicalToLogical[physB]!;
      const logC: number = physicalToLogical[physC]!;
      const faceLogEdges: Array<[number, number]> = [[logA, logB], [logB, logC], [logC, logA]];
      const facePhysEdges: Array<[number, number]> = [[physA, physB], [physB, physC], [physC, physA]];

      for (let edgeIndex: number = 0; edgeIndex < 3; edgeIndex++) {
        const [startLogicalId, endLogicalId]: [number, number] = faceLogEdges[edgeIndex]!;
        const edgeKey: string = startLogicalId < endLogicalId ? `${startLogicalId}-${endLogicalId}` : `${endLogicalId}-${startLogicalId}`;
        let normals: THREE.Vector3[] | undefined = edgeToNormals.get(edgeKey);
        if (normals === undefined) {
          normals = [];
          edgeToNormals.set(edgeKey, normals);
          edgeToPhysical.set(edgeKey, facePhysEdges[edgeIndex]!);
        }
        normals.push(normal);
      }
    }

    const visibleEdges: Array<[number, number]> = BuildingWireframeFactory.collectVisibleEdges(
      edgeToNormals,
      edgeToPhysical,
      positionAttribute,
      threshold,
      hideArcSegmentVerticalEdges
    );
    if (visibleEdges.length === 0) {
      return null;
    }

    const vertices: Float32Array = BuildingWireframeFactory.createEdgeVertices(positionAttribute, visibleEdges);
    return BuildingWireframeFactory.createLineSegments(vertices, 0x333333, options);
  }

  /**
   * 为楼板、天花板等面状构件创建固定像素边线。
   * @param geometry - 需要提取棱边的几何体。
   * @param color - 边线颜色。
   * @param options - 线框创建配置。
   * @returns 可作为子对象挂载到构件 Mesh 的边线对象；无边线时返回 null。
   */
  public static createSurfaceEdgeWireframe(
    geometry: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    options: BuildingWireframeFactoryOptions
  ): THREE.Object3D | null {
    const edgeGeometry: THREE.EdgesGeometry = new THREE.EdgesGeometry(geometry, 15);
    const positionAttribute: THREE.BufferAttribute = edgeGeometry.getAttribute('position') as THREE.BufferAttribute;
    if (positionAttribute === undefined || positionAttribute === null || positionAttribute.count === 0) {
      edgeGeometry.dispose();
      return null;
    }

    if (options.fixedPixelWireframeEnabled) {
      const vertices: Float32Array = new Float32Array(positionAttribute.count * 3);
      for (let vertexIndex: number = 0; vertexIndex < positionAttribute.count; vertexIndex++) {
        const offset: number = vertexIndex * 3;
        vertices[offset] = positionAttribute.getX(vertexIndex);
        vertices[offset + 1] = positionAttribute.getY(vertexIndex);
        vertices[offset + 2] = positionAttribute.getZ(vertexIndex);
      }

      const fixedPixelLines: FixedPixelLineSegments = FixedPixelLineSegmentsFactory.create(vertices, {
        color: color,
        lineWidthPixels: options.fixedPixelWireframeWidth,
        depthTest: true,
        depthWrite: false,
        opacity: 1,
        depthOffsetNdc: options.wireframeDepthOffsetNdc,
      });
      fixedPixelLines.userData['isWireframe'] = true;
      fixedPixelLines.userData['isEnhancedWireframe'] = true;
      fixedPixelLines.userData['isSurfaceEdgeWireframe'] = true;
      edgeGeometry.dispose();
      return FixedPixelLineSegmentsFactory.asObject3D(fixedPixelLines);
    }

    const wireframeMaterial: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
      color: color,
      depthTest: true,
      depthWrite: false,
    });
    const wireframe: THREE.LineSegments = new THREE.LineSegments(edgeGeometry, wireframeMaterial);
    wireframe.userData['isWireframe'] = true;
    wireframe.userData['isSurfaceEdgeWireframe'] = true;
    return wireframe;
  }

  /**
   * 释放线框辅助对象占用的 GPU 资源。
   * @param wireframeObject - 需要释放的线框辅助对象。
   */
  public static disposeWireframeObject(wireframeObject: THREE.Object3D): void {
    if (FixedPixelLineSegmentsFactory.isFixedPixelLineSegments(wireframeObject)) {
      FixedPixelLineSegmentsFactory.dispose(wireframeObject);
      return;
    }

    if (!(wireframeObject instanceof THREE.LineSegments)) {
      return;
    }

    const lineSegments: THREE.LineSegments = wireframeObject as THREE.LineSegments;
    lineSegments.geometry.dispose();
    if (Array.isArray(lineSegments.material)) {
      for (let materialIndex: number = 0; materialIndex < lineSegments.material.length; materialIndex++) {
        const material: THREE.Material = lineSegments.material[materialIndex]!;
        material.dispose();
      }
      return;
    }

    lineSegments.material.dispose();
  }

  private static createTriangleMaterialIndexMap(
    geometry: THREE.BufferGeometry,
    excludeGroupIndices: number[]
  ): Map<number, number> {
    const triangleToMaterialIndex: Map<number, number> = new Map<number, number>();
    if (excludeGroupIndices.length === 0) {
      return triangleToMaterialIndex;
    }

    for (const group of geometry.groups) {
      const groupEnd: number = group.start + group.count;
      for (let idx: number = group.start; idx < groupEnd; idx += 3) {
        triangleToMaterialIndex.set(idx, group.materialIndex ?? 0);
      }
    }
    return triangleToMaterialIndex;
  }

  private static computeTriangleNormal(positionAttribute: THREE.BufferAttribute, physA: number, physB: number, physC: number): THREE.Vector3 {
    const vA: THREE.Vector3 = new THREE.Vector3(positionAttribute.getX(physA), positionAttribute.getY(physA), positionAttribute.getZ(physA));
    const vB: THREE.Vector3 = new THREE.Vector3(positionAttribute.getX(physB), positionAttribute.getY(physB), positionAttribute.getZ(physB));
    const vC: THREE.Vector3 = new THREE.Vector3(positionAttribute.getX(physC), positionAttribute.getY(physC), positionAttribute.getZ(physC));
    return new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(vB, vA), new THREE.Vector3().subVectors(vC, vA)).normalize();
  }

  private static collectVisibleEdges(
    edgeToNormals: Map<string, THREE.Vector3[]>,
    edgeToPhysical: Map<string, [number, number]>,
    positionAttribute: THREE.BufferAttribute,
    threshold: number,
    hideArcSegmentVerticalEdges: boolean
  ): Array<[number, number]> {
    const visibleEdges: Array<[number, number]> = [];
    edgeToNormals.forEach((normals: THREE.Vector3[], edgeKey: string): void => {
      const physPair: [number, number] | undefined = edgeToPhysical.get(edgeKey);
      if (physPair === undefined) {
        return;
      }
      if (hideArcSegmentVerticalEdges && BuildingWireframeFactory.isArcSegmentVerticalDivider(positionAttribute, physPair, normals)) {
        return;
      }
      if (normals.length === 1 || !BuildingWireframeFactory.hasCoplanarNormalPair(normals, threshold)) {
        visibleEdges.push(physPair);
      }
    });
    return visibleEdges;
  }

  private static hasCoplanarNormalPair(normals: THREE.Vector3[], threshold: number): boolean {
    for (let m: number = 0; m < normals.length - 1; m++) {
      for (let n: number = m + 1; n < normals.length; n++) {
        const cosAngle: number = Math.abs(normals[m]!.dot(normals[n]!));
        if (cosAngle > threshold) {
          return true;
        }
      }
    }
    return false;
  }

  private static createEdgeVertices(positionAttribute: THREE.BufferAttribute, visibleEdges: Array<[number, number]>): Float32Array {
    const vertices: Float32Array = new Float32Array(visibleEdges.length * 6);
    for (let i: number = 0; i < visibleEdges.length; i++) {
      const [startIdx, endIdx]: [number, number] = visibleEdges[i]!;
      vertices[i * 6] = positionAttribute.getX(startIdx);
      vertices[i * 6 + 1] = positionAttribute.getY(startIdx);
      vertices[i * 6 + 2] = positionAttribute.getZ(startIdx);
      vertices[i * 6 + 3] = positionAttribute.getX(endIdx);
      vertices[i * 6 + 4] = positionAttribute.getY(endIdx);
      vertices[i * 6 + 5] = positionAttribute.getZ(endIdx);
    }
    return vertices;
  }

  private static createLineSegments(
    vertices: Float32Array,
    color: THREE.ColorRepresentation,
    options: BuildingWireframeFactoryOptions
  ): THREE.LineSegments {
    if (options.fixedPixelWireframeEnabled) {
      const fixedPixelLines: FixedPixelLineSegments = FixedPixelLineSegmentsFactory.create(vertices, {
        color: color,
        lineWidthPixels: options.fixedPixelWireframeWidth,
        depthTest: true,
        depthWrite: false,
        opacity: 1,
        depthOffsetNdc: options.wireframeDepthOffsetNdc,
      });
      fixedPixelLines.userData['isWireframe'] = true;
      fixedPixelLines.userData['isEnhancedWireframe'] = true;
      return FixedPixelLineSegmentsFactory.asLineSegments(fixedPixelLines);
    }

    const lineSegGeom: THREE.BufferGeometry = new THREE.BufferGeometry();
    lineSegGeom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    const wireframeMaterial: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
      color: color,
      depthTest: true,
      depthWrite: false,
    });
    const lines: THREE.LineSegments = new THREE.LineSegments(lineSegGeom, wireframeMaterial);
    lines.userData['isWireframe'] = true;
    return lines;
  }

  private static isArcSegmentVerticalDivider(
    positionAttribute: THREE.BufferAttribute,
    edgePair: [number, number],
    normals: THREE.Vector3[]
  ): boolean {
    const startIndex: number = edgePair[0];
    const endIndex: number = edgePair[1];
    const coordinateEpsilon: number = 0.000001;
    const dx: number = Math.abs(positionAttribute.getX(startIndex) - positionAttribute.getX(endIndex));
    const dy: number = Math.abs(positionAttribute.getY(startIndex) - positionAttribute.getY(endIndex));
    const dz: number = Math.abs(positionAttribute.getZ(startIndex) - positionAttribute.getZ(endIndex));
    if (dy <= coordinateEpsilon || dx > coordinateEpsilon || dz > coordinateEpsilon || normals.length !== 2) {
      return false;
    }

    const firstNormal: THREE.Vector3 = normals[0]!;
    const secondNormal: THREE.Vector3 = normals[1]!;
    const horizontalNormalYLimit: number = 0.01;
    if (Math.abs(firstNormal.y) > horizontalNormalYLimit || Math.abs(secondNormal.y) > horizontalNormalYLimit) {
      return false;
    }

    const adjacentSideFaceCosine: number = Math.abs(firstNormal.dot(secondNormal));
    const minAdjacentArcSegmentCosine: number = 0.5;
    return adjacentSideFaceCosine > minAdjacentArcSegmentCosine;
  }
}