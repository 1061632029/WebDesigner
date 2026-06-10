/**
 * OCCT 网格转换器
 * 将 OCCT B-Rep Shape 三角化并提取为 Three.js BufferGeometry 可用的数据
 */

import * as THREE from 'three/webgpu';
import type { OpenCascadeInstance, OcctMeshData } from './OcctTypes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * OCCT → Three.js 网格转换器
 */
export class OcctMeshConverter {
  /** OCCT 实例引用 */
  private _oc: OpenCascadeInstance;

  constructor(oc: OpenCascadeInstance) {
    this._oc = oc;
  }

  /**
   * 将 OCCT Shape 三角化并提取网格数据
   * @param shape - OCCT TopoDS_Shape
   * @param deflection - 三角化精度（越小越精细，默认 0.1）
   * @returns 网格数据（顶点、法线、索引）
   */
  public shapeToMeshData(shape: any, deflection: number = 0.1): OcctMeshData {
    /* 执行三角化 */
    new this._oc.BRepMesh_IncrementalMesh(shape, deflection);

    /* 收集所有面的三角形数据 */
    const allVertices: number[] = [];
    const allNormals: number[] = [];
    const allIndices: number[] = [];
    let vertexOffset: number = 0;

    /* 遍历 Shape 的所有 Face */
    const explorer: any = new this._oc.TopExp_Explorer(
      shape,
      this._oc.TopAbs_ShapeEnum.TopAbs_FACE
    );

    while (explorer.More()) {
      const face: any = this._oc.TopoDS.Face(explorer.Current());
      const location: any = new this._oc.TopLoc_Location();
      const triangulation: any = this._oc.BRep_Tool.Triangulation(face, location);

      /* 某些面可能没有三角化结果 */
      if (triangulation !== null && !triangulation.IsNull()) {
        const nbTriangles: number = triangulation.NbTriangles();
        const nbNodes: number = triangulation.NbNodes();

        /* 提取顶点坐标 */
        for (let i: number = 1; i <= nbNodes; i++) {
          const node: any = triangulation.Node(i);
          /* 应用 Location 变换 */
          const transformedNode: any = node.Transformed(location.Transformation());
          allVertices.push(transformedNode.X(), transformedNode.Y(), transformedNode.Z());
        }

        /* 提取法线（通过三角形计算） */
        if (triangulation.HasNormals()) {
          for (let i: number = 1; i <= nbNodes; i++) {
            const normal: any = triangulation.Normal(i);
            allNormals.push(normal.X(), normal.Y(), normal.Z());
          }
        } else {
          /* 无预计算法线时填充零值，后续由 Three.js 计算 */
          for (let i: number = 0; i < nbNodes; i++) {
            allNormals.push(0, 0, 0);
          }
        }

        /* 提取三角形索引 */
        for (let i: number = 1; i <= nbTriangles; i++) {
          const triangle: any = triangulation.Triangle(i);
          /* OCCT 索引从 1 开始，转为 0-based 并加上偏移 */
          const n1: number = triangle.Value(1) - 1 + vertexOffset;
          const n2: number = triangle.Value(2) - 1 + vertexOffset;
          const n3: number = triangle.Value(3) - 1 + vertexOffset;

          /* 检测面的朝向，反转面需要翻转三角形缠绕方向 */
          const orientation: any = face.Orientation_1();
          if (orientation === 1) {
            /* TopAbs_REVERSED：翻转缠绕顺序 */
            allIndices.push(n1, n3, n2);
          } else {
            allIndices.push(n1, n2, n3);
          }
        }

        vertexOffset += nbNodes;
      }

      explorer.Next();
    }

    return {
      vertices: new Float32Array(allVertices),
      normals: new Float32Array(allNormals),
      indices: new Uint32Array(allIndices),
    };
  }

  /**
   * 将 OCCT Shape 直接转换为 Three.js BufferGeometry
   * @param shape - OCCT TopoDS_Shape
   * @param deflection - 三角化精度
   * @returns Three.js BufferGeometry
   */
  public shapeToBufferGeometry(shape: any, deflection: number = 0.1): THREE.BufferGeometry {
    const meshData: OcctMeshData = this.shapeToMeshData(shape, deflection);
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();

    /* 设置顶点属性 */
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(meshData.vertices, 3)
    );

    /* 设置索引 */
    geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));

    /* 设置法线 */
    if (meshData.normals.length > 0) {
      const hasValidNormals: boolean = meshData.normals.some(
        (n: number) => n !== 0
      );
      if (hasValidNormals) {
        geometry.setAttribute(
          'normal',
          new THREE.BufferAttribute(meshData.normals, 3)
        );
      } else {
        /* 无有效法线时自动计算 */
        geometry.computeVertexNormals();
      }
    } else {
      geometry.computeVertexNormals();
    }

    return geometry;
  }

  /**
   * 将 OCCT Shape 转换为 Three.js Mesh
   * @param shape - OCCT TopoDS_Shape
   * @param material - Three.js 材质（默认使用标准材质）
   * @param deflection - 三角化精度
   * @returns Three.js Mesh
   */
  public shapeToMesh(
    shape: any,
    material?: THREE.Material,
    deflection: number = 0.1
  ): THREE.Mesh {
    const geometry: THREE.BufferGeometry = this.shapeToBufferGeometry(shape, deflection);

    const defaultMaterial: THREE.MeshStandardMaterial = new THREE.MeshStandardMaterial({
      color: 0x4488aa,
      metalness: 0.3,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });

    const mesh: THREE.Mesh = new THREE.Mesh(geometry, material || defaultMaterial);
    return mesh;
  }
}
