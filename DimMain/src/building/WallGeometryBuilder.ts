/**
 * 墙体几何构建器
 * 根据墙体数据生成 Three.js BufferGeometry
 * 支持直墙、弧形墙的几何生成
 */

import * as THREE from 'three/webgpu';
import type {
  WallData,
  StraightWallData,
  ArcWallData,
  Point2D,
  MiterParams,
  WallSubtractionRect,
  WallOpening,
} from './BuildingTypes';
import { getDefaultMaterial } from './BuildingTypes';

/**
 * 墙体几何构建器
 */
export class WallGeometryBuilder {
  /**
   * 根据墙体数据生成几何体
   * @param data - 墙体数据（直墙或弧形墙）
   * @returns Three.js BufferGeometry
   */
  public build(data: WallData): THREE.BufferGeometry {
    switch (data.subType) {
      case 'straight':
        return this._buildStraightWall(data);
      case 'arc':
        return this._buildArcWall(data);
      case 'rect':
        /* 矩形墙不直接生成几何体，由 4 面直墙组成 */
        return new THREE.BufferGeometry();
      default:
        return new THREE.BufferGeometry();
    }
  }

  /** 零偏移 miter 常量（无连接时使用） */
  public static readonly NO_MITER: MiterParams = {
    start: { frontOffset: 0, backOffset: 0 },
    end:   { frontOffset: 0, backOffset: 0 },
  };

  /**
   * 构建直墙几何体（支持斜切 miter 端面）
   *
   * 斜切原理：
   * 端面的前侧角点（+法线方向）和后侧角点（-法线方向）沿墙体方向
   * 分别缩进不同距离，使端面平面恰好与对方墙侧面共面。
   *
   * 顶点布局（XZ 平面，Y 为高度）：
   *   p0 = 起点前侧（+norm），p1 = 终点前侧（+norm）
   *   p2 = 终点后侧（-norm），p3 = 起点后侧（-norm）
   *   各角点沿墙体方向独立偏移，形成斜切端面
   *
   * @param data - 直墙数据
   * @param miter - 斜切偏移参数（前侧/后侧角点各自的偏移量）
   * @returns BufferGeometry（6 面，每面独立材质组）
   */
  private _buildStraightWall(
    data: StraightWallData,
    miter: MiterParams = WallGeometryBuilder.NO_MITER
  ): THREE.BufferGeometry {
    const halfThick: number = data.thickness / 2;
    const elevation: number = data.elevation;
    const height: number = data.height;

    /* 计算中心线方向向量（XZ 平面） */
    const dx: number = data.end.x - data.start.x;
    const dz: number = data.end.z - data.start.z;
    const length: number = Math.sqrt(dx * dx + dz * dz);

    /* 长度为零时返回空几何体 */
    if (length < 0.001) {
      return new THREE.BufferGeometry();
    }

    /* 单位方向向量 */
    const dirX: number = dx / length;
    const dirZ: number = dz / length;

    /* 法线方向（在 XZ 平面上逆时针旋转 90°） */
    const normX: number = -dirZ;
    const normZ: number = dirX;

    /*
     * 斜切端面：4 个角点各自独立偏移
     *
     * 起点端（miter.start）：
     *   p0（前侧，+norm）向内缩进 frontOffset（沿 +dir 方向，朝向终点）
     *   p3（后侧，-norm）向内缩进 backOffset（沿 +dir 方向，朝向终点）
     *
     * 终点端（miter.end）：
     *   p1（前侧，+norm）向内缩进 frontOffset（沿 -dir 方向，朝向起点）
     *   p2（后侧，-norm）向内缩进 backOffset（沿 -dir 方向，朝向起点）
     *
     * 正值 offset 表示向内缩短：
     *   起点端 +dir 方向 = 朝终点 = 向内
     *   终点端 -dir 方向 = 朝起点 = 向内
     */
    const p0x: number = data.start.x + dirX * miter.start.frontOffset + normX * halfThick;
    const p0z: number = data.start.z + dirZ * miter.start.frontOffset + normZ * halfThick;
    const p3x: number = data.start.x + dirX * miter.start.backOffset - normX * halfThick;
    const p3z: number = data.start.z + dirZ * miter.start.backOffset - normZ * halfThick;

    const p1x: number = data.end.x - dirX * miter.end.frontOffset + normX * halfThick;
    const p1z: number = data.end.z - dirZ * miter.end.frontOffset + normZ * halfThick;
    const p2x: number = data.end.x - dirX * miter.end.backOffset - normX * halfThick;
    const p2z: number = data.end.z - dirZ * miter.end.backOffset - normZ * halfThick;

    const yBottom: number = elevation;
    const yTop: number = elevation + height;
    const wallLength: number = length;
    const wallThickness: number = data.thickness;
    const wallHeight: number = height;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    /**
     * 添加一个四边形面（两个三角形）
     * 顶点顺序：左下(a) → 右下(b) → 右上(c) → 左上(d)
     * @param nx,ny,nz - 面法线
     * @param uWidth,vHeight - UV 尺寸
     */
    const addFace = (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
      ddx: number, dy: number, dz: number,
      nx: number, ny: number, nz: number,
      uWidth: number, vHeight: number
    ): void => {
      const baseIdx: number = positions.length / 3;
      positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, ddx, dy, dz);
      normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
      uvs.push(0, 0, uWidth, 0, uWidth, vHeight, 0, vHeight);
      indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
    };

    /* 前面（法线方向 +norm）— materialIndex = 0
     * 顶点：p0(起点前侧) → p1(终点前侧) → p1(顶) → p0(顶)
     */
    addFace(
      p0x, yBottom, p0z,  p1x, yBottom, p1z,  p1x, yTop, p1z,  p0x, yTop, p0z,
      normX, 0, normZ,
      wallLength, wallHeight
    );

    /* 后面（法线方向 -norm）— materialIndex = 1
     * 顶点：p2(终点后侧) → p3(起点后侧) → p3(顶) → p2(顶)
     */
    addFace(
      p2x, yBottom, p2z,  p3x, yBottom, p3z,  p3x, yTop, p3z,  p2x, yTop, p2z,
      -normX, 0, -normZ,
      wallLength, wallHeight
    );

    /* 起点端面（法线方向 -dir）— materialIndex = 2
     * 斜切端面：p3(后侧) → p0(前侧) → p0(顶) → p3(顶)
     * 端面法线近似为 -dir（斜切后法线会略微偏转，但视觉效果可接受）
     */
    addFace(
      p3x, yBottom, p3z,  p0x, yBottom, p0z,  p0x, yTop, p0z,  p3x, yTop, p3z,
      -dirX, 0, -dirZ,
      wallThickness, wallHeight
    );

    /* 终点端面（法线方向 +dir）— materialIndex = 3
     * 斜切端面：p1(前侧) → p2(后侧) → p2(顶) → p1(顶)
     */
    addFace(
      p1x, yBottom, p1z,  p2x, yBottom, p2z,  p2x, yTop, p2z,  p1x, yTop, p1z,
      dirX, 0, dirZ,
      wallThickness, wallHeight
    );

    /* 顶面（法线方向 +Y）— materialIndex = 4
     * 斜切后顶面为梯形（4 个角点不共面时退化为三角形，但通常仍为四边形）
     */
    addFace(
      p0x, yTop, p0z,  p1x, yTop, p1z,  p2x, yTop, p2z,  p3x, yTop, p3z,
      0, 1, 0,
      wallLength, wallThickness
    );

    /* 底面（法线方向 -Y）— materialIndex = 5 */
    addFace(
      p3x, yBottom, p3z,  p2x, yBottom, p2z,  p1x, yBottom, p1z,  p0x, yBottom, p0z,
      0, -1, 0,
      wallLength, wallThickness
    );

    /* 构建 BufferGeometry */
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    /* 每面 6 个索引（2 个三角形），共 6 个面 → 6 个材质组 */
    const indicesPerFace: number = 6;
    geometry.addGroup(0 * indicesPerFace, indicesPerFace, 0); /* 前面 */
    geometry.addGroup(1 * indicesPerFace, indicesPerFace, 1); /* 后面 */
    geometry.addGroup(2 * indicesPerFace, indicesPerFace, 2); /* 起点端面 */
    geometry.addGroup(3 * indicesPerFace, indicesPerFace, 3); /* 终点端面 */
    geometry.addGroup(4 * indicesPerFace, indicesPerFace, 4); /* 顶面 */
    geometry.addGroup(5 * indicesPerFace, indicesPerFace, 5); /* 底面 */

    return geometry;
  }

  /**
   * 构建弧形墙几何体
   * 算法：将弧线等分为 N 段折线，每段生成四边形墙面片
   * @param data - 弧形墙数据
   * @returns BufferGeometry
   */
  private _buildArcWall(data: ArcWallData): THREE.BufferGeometry {
    const segments: number = data.segments;
    const halfThick: number = data.thickness / 2;
    const elevation: number = data.elevation;
    const height: number = data.height;

    /* 根据 bulge 因子计算弧线的中心线采样点 */
    const centerPoints: Point2D[] = this._computeArcPoints(
      data.start, data.end, data.bulge, segments
    );

    /* 采样点数不足时返回空几何体 */
    if (centerPoints.length < 2) {
      return new THREE.BufferGeometry();
    }

    const positions: number[] = [];
    const normalsArr: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    /* 为每个中心线点计算内外侧偏移点 */
    const outerPoints: Point2D[] = [];
    const innerPoints: Point2D[] = [];

    for (let i: number = 0; i < centerPoints.length; i++) {
      /* 计算该点处的法线方向 */
      let nx: number;
      let nz: number;
      const cp: Point2D = centerPoints[i]!;

      if (i === 0) {
        /* 起点：使用第一段方向 */
        const cp1: Point2D = centerPoints[1]!;
        const ddx: number = cp1.x - cp.x;
        const ddz: number = cp1.z - cp.z;
        const len: number = Math.sqrt(ddx * ddx + ddz * ddz);
        nx = -ddz / len;
        nz = ddx / len;
      } else if (i === centerPoints.length - 1) {
        /* 终点：使用最后一段方向 */
        const cpPrev: Point2D = centerPoints[i - 1]!;
        const ddx: number = cp.x - cpPrev.x;
        const ddz: number = cp.z - cpPrev.z;
        const len: number = Math.sqrt(ddx * ddx + ddz * ddz);
        nx = -ddz / len;
        nz = ddx / len;
      } else {
        /* 中间点：取前后段的平均法线 */
        const cpPrev: Point2D = centerPoints[i - 1]!;
        const cpNext: Point2D = centerPoints[i + 1]!;
        const dx1: number = cp.x - cpPrev.x;
        const dz1: number = cp.z - cpPrev.z;
        const len1: number = Math.sqrt(dx1 * dx1 + dz1 * dz1);
        const dx2: number = cpNext.x - cp.x;
        const dz2: number = cpNext.z - cp.z;
        const len2: number = Math.sqrt(dx2 * dx2 + dz2 * dz2);

        const n1x: number = -dz1 / len1;
        const n1z: number = dx1 / len1;
        const n2x: number = -dz2 / len2;
        const n2z: number = dx2 / len2;

        const avgX: number = n1x + n2x;
        const avgZ: number = n1z + n2z;
        const avgLen: number = Math.sqrt(avgX * avgX + avgZ * avgZ);
        nx = avgLen > 0.001 ? avgX / avgLen : n1x;
        nz = avgLen > 0.001 ? avgZ / avgLen : n1z;
      }

      outerPoints.push({ x: cp.x + nx * halfThick, z: cp.z + nz * halfThick });
      innerPoints.push({ x: cp.x - nx * halfThick, z: cp.z - nz * halfThick });
    }

    const yBottom: number = elevation;
    const yTop: number = elevation + height;
    const wallHeight: number = height;
    const wallThickness: number = data.thickness;

    /* 计算每段的累积弧长（用于 UV 的 U 坐标） */
    const segArcLengths: number[] = [0];
    for (let i: number = 1; i < outerPoints.length; i++) {
      const prevP: Point2D = outerPoints[i - 1]!;
      const curP: Point2D = outerPoints[i]!;
      const dx: number = curP.x - prevP.x;
      const dz: number = curP.z - prevP.z;
      segArcLengths.push(segArcLengths[i - 1]! + Math.sqrt(dx * dx + dz * dz));
    }
    const totalArcLength: number = segArcLengths[segArcLengths.length - 1]!;

    /*
     * 按面类型分批生成，确保 Material Groups 连续
     * materialIndex: 0=外侧面, 1=内侧面, 2=顶面, 3=底面, 4=起点端面, 5=终点端面
     */

    /* ===== 外侧面 (materialIndex=0) ===== */
    const outerIndexStart: number = indices.length;
    for (let i: number = 0; i < centerPoints.length - 1; i++) {
      const baseIdx: number = positions.length / 3;
      const o0: Point2D = outerPoints[i]!;
      const o1: Point2D = outerPoints[i + 1]!;
      const segDx: number = o1.x - o0.x;
      const segDz: number = o1.z - o0.z;
      const segLen: number = Math.sqrt(segDx * segDx + segDz * segDz);
      const faceNx: number = segLen > 0 ? -segDz / segLen : 0;
      const faceNz: number = segLen > 0 ? segDx / segLen : 0;

      positions.push(o0.x, yBottom, o0.z, o1.x, yBottom, o1.z, o1.x, yTop, o1.z, o0.x, yTop, o0.z);
      normalsArr.push(faceNx, 0, faceNz, faceNx, 0, faceNz, faceNx, 0, faceNz, faceNx, 0, faceNz);

      /* UV：U 沿弧长归一化，V 沿高度归一化 */
      const u0: number = totalArcLength > 0 ? segArcLengths[i]! / totalArcLength * totalArcLength : 0;
      const u1: number = totalArcLength > 0 ? segArcLengths[i + 1]! / totalArcLength * totalArcLength : 0;
      uvs.push(u0, 0, u1, 0, u1, wallHeight, u0, wallHeight);

      indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
    }
    const outerIndexCount: number = indices.length - outerIndexStart;

    /* ===== 内侧面 (materialIndex=1) ===== */
    const innerIndexStart: number = indices.length;
    for (let i: number = 0; i < centerPoints.length - 1; i++) {
      const baseIdx: number = positions.length / 3;
      const in0: Point2D = innerPoints[i]!;
      const in1: Point2D = innerPoints[i + 1]!;
      const o0: Point2D = outerPoints[i]!;
      const o1: Point2D = outerPoints[i + 1]!;
      const segDx: number = o1.x - o0.x;
      const segDz: number = o1.z - o0.z;
      const segLen: number = Math.sqrt(segDx * segDx + segDz * segDz);
      const faceNx: number = segLen > 0 ? -segDz / segLen : 0;
      const faceNz: number = segLen > 0 ? segDx / segLen : 0;

      positions.push(in1.x, yBottom, in1.z, in0.x, yBottom, in0.z, in0.x, yTop, in0.z, in1.x, yTop, in1.z);
      normalsArr.push(-faceNx, 0, -faceNz, -faceNx, 0, -faceNz, -faceNx, 0, -faceNz, -faceNx, 0, -faceNz);

      const u0: number = totalArcLength > 0 ? segArcLengths[i + 1]! / totalArcLength * totalArcLength : 0;
      const u1: number = totalArcLength > 0 ? segArcLengths[i]! / totalArcLength * totalArcLength : 0;
      uvs.push(u0, 0, u1, 0, u1, wallHeight, u0, wallHeight);

      indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
    }
    const innerIndexCount: number = indices.length - innerIndexStart;

    /* ===== 顶面 (materialIndex=2) ===== */
    const topIndexStart: number = indices.length;
    for (let i: number = 0; i < centerPoints.length - 1; i++) {
      const baseIdx: number = positions.length / 3;
      const o0: Point2D = outerPoints[i]!;
      const o1: Point2D = outerPoints[i + 1]!;
      const in0: Point2D = innerPoints[i]!;
      const in1: Point2D = innerPoints[i + 1]!;

      positions.push(o0.x, yTop, o0.z, o1.x, yTop, o1.z, in1.x, yTop, in1.z, in0.x, yTop, in0.z);
      normalsArr.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);

      const u0: number = totalArcLength > 0 ? segArcLengths[i]! / totalArcLength * totalArcLength : 0;
      const u1: number = totalArcLength > 0 ? segArcLengths[i + 1]! / totalArcLength * totalArcLength : 0;
      uvs.push(u0, 0, u1, 0, u1, wallThickness, u0, wallThickness);

      indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
    }
    const topIndexCount: number = indices.length - topIndexStart;

    /* ===== 底面 (materialIndex=3) ===== */
    const bottomIndexStart: number = indices.length;
    for (let i: number = 0; i < centerPoints.length - 1; i++) {
      const baseIdx: number = positions.length / 3;
      const o0: Point2D = outerPoints[i]!;
      const o1: Point2D = outerPoints[i + 1]!;
      const in0: Point2D = innerPoints[i]!;
      const in1: Point2D = innerPoints[i + 1]!;

      positions.push(in0.x, yBottom, in0.z, in1.x, yBottom, in1.z, o1.x, yBottom, o1.z, o0.x, yBottom, o0.z);
      normalsArr.push(0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0);

      const u0: number = totalArcLength > 0 ? segArcLengths[i]! / totalArcLength * totalArcLength : 0;
      const u1: number = totalArcLength > 0 ? segArcLengths[i + 1]! / totalArcLength * totalArcLength : 0;
      uvs.push(u0, 0, u1, 0, u1, wallThickness, u0, wallThickness);

      indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
    }
    const bottomIndexCount: number = indices.length - bottomIndexStart;

    /* ===== 起点端面 (materialIndex=4) ===== */
    const startCapIndexStart: number = indices.length;
    const startBaseIdx: number = positions.length / 3;
    const so: Point2D = outerPoints[0]!;
    const si: Point2D = innerPoints[0]!;
    const sdx: number = centerPoints[1]!.x - centerPoints[0]!.x;
    const sdz: number = centerPoints[1]!.z - centerPoints[0]!.z;
    const slen: number = Math.sqrt(sdx * sdx + sdz * sdz);
    const snx: number = slen > 0 ? -sdx / slen : 0;
    const snz: number = slen > 0 ? -sdz / slen : 0;
    positions.push(si.x, yBottom, si.z, so.x, yBottom, so.z, so.x, yTop, so.z, si.x, yTop, si.z);
    normalsArr.push(snx, 0, snz, snx, 0, snz, snx, 0, snz, snx, 0, snz);
    uvs.push(0, 0, wallThickness, 0, wallThickness, wallHeight, 0, wallHeight);
    indices.push(startBaseIdx, startBaseIdx + 1, startBaseIdx + 2, startBaseIdx, startBaseIdx + 2, startBaseIdx + 3);
    const startCapIndexCount: number = indices.length - startCapIndexStart;

    /* ===== 终点端面 (materialIndex=5) ===== */
    const endCapIndexStart: number = indices.length;
    const endBaseIdx: number = positions.length / 3;
    const lastIdx: number = centerPoints.length - 1;
    const eo: Point2D = outerPoints[lastIdx]!;
    const ei: Point2D = innerPoints[lastIdx]!;
    const edx: number = centerPoints[lastIdx]!.x - centerPoints[lastIdx - 1]!.x;
    const edz: number = centerPoints[lastIdx]!.z - centerPoints[lastIdx - 1]!.z;
    const elen: number = Math.sqrt(edx * edx + edz * edz);
    const enx: number = elen > 0 ? edx / elen : 0;
    const enz: number = elen > 0 ? edz / elen : 0;
    positions.push(eo.x, yBottom, eo.z, ei.x, yBottom, ei.z, ei.x, yTop, ei.z, eo.x, yTop, eo.z);
    normalsArr.push(enx, 0, enz, enx, 0, enz, enx, 0, enz, enx, 0, enz);
    uvs.push(0, 0, wallThickness, 0, wallThickness, wallHeight, 0, wallHeight);
    indices.push(endBaseIdx, endBaseIdx + 1, endBaseIdx + 2, endBaseIdx, endBaseIdx + 2, endBaseIdx + 3);
    const endCapIndexCount: number = indices.length - endCapIndexStart;

    /* 构建 BufferGeometry */
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normalsArr, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    /* 6 个面的 Material Groups */
    geometry.addGroup(outerIndexStart, outerIndexCount, 0);       /* 外侧面 */
    geometry.addGroup(innerIndexStart, innerIndexCount, 1);       /* 内侧面 */
    geometry.addGroup(topIndexStart, topIndexCount, 2);           /* 顶面 */
    geometry.addGroup(bottomIndexStart, bottomIndexCount, 3);     /* 底面 */
    geometry.addGroup(startCapIndexStart, startCapIndexCount, 4); /* 起点端面 */
    geometry.addGroup(endCapIndexStart, endCapIndexCount, 5);     /* 终点端面 */

    return geometry;
  }

  /**
   * 根据 bulge 因子计算弧线上的等分采样点
   * bulge = tan(弧度/4)，这是 DXF/DWG 标准
   * @param start - 起点
   * @param end - 终点
   * @param bulge - 弧度因子
   * @param segments - 分段数
   * @returns 弧线上的采样点数组
   */
  private _computeArcPoints(
    start: Point2D,
    end: Point2D,
    bulge: number,
    segments: number
  ): Point2D[] {
    /* bulge 接近 0 时退化为直线 */
    if (Math.abs(bulge) < 0.001) {
      const points: Point2D[] = [];
      for (let i: number = 0; i <= segments; i++) {
        const t: number = i / segments;
        points.push({
          x: start.x + (end.x - start.x) * t,
          z: start.z + (end.z - start.z) * t,
        });
      }
      return points;
    }

    /* 计算弧线参数 */
    const chordDx: number = end.x - start.x;
    const chordDz: number = end.z - start.z;
    const chordLen: number = Math.sqrt(chordDx * chordDx + chordDz * chordDz);

    /* 弧度角 = 4 * atan(bulge) */
    const includedAngle: number = 4 * Math.atan(Math.abs(bulge));

    /* 半径 = chordLen / (2 * sin(includedAngle/2)) */
    const sinHalf: number = Math.sin(includedAngle / 2);
    if (Math.abs(sinHalf) < 0.0001) {
      /* 退化为直线 */
      return [start, end];
    }
    const radius: number = chordLen / (2 * sinHalf);

    /* 弦中点 */
    const midX: number = (start.x + end.x) / 2;
    const midZ: number = (start.z + end.z) / 2;

    /* 弦的单位法线（逆时针 90°） */
    const cnx: number = -chordDz / chordLen;
    const cnz: number = chordDx / chordLen;

    /* 弦中点到圆心的距离 */
    const d: number = radius * Math.cos(includedAngle / 2);

    /* 圆心位置（bulge 正值左凸，负值右凸） */
    const sign: number = bulge > 0 ? 1 : -1;
    const cx: number = midX + cnx * d * sign;
    const cz: number = midZ + cnz * d * sign;

    /* 起点和终点的角度 */
    const startAngle: number = Math.atan2(start.z - cz, start.x - cx);
    let endAngle: number = Math.atan2(end.z - cz, end.x - cx);

    /* 确保角度方向正确 */
    if (bulge > 0) {
      /* 逆时针弧 */
      while (endAngle <= startAngle) {
        endAngle += Math.PI * 2;
      }
    } else {
      /* 顺时针弧 */
      while (endAngle >= startAngle) {
        endAngle -= Math.PI * 2;
      }
    }

    /* 等分采样 */
    const points: Point2D[] = [];
    for (let i: number = 0; i <= segments; i++) {
      const t: number = i / segments;
      const angle: number = startAngle + (endAngle - startAngle) * t;
      points.push({
        x: cx + radius * Math.cos(angle),
        z: cz + radius * Math.sin(angle),
      });
    }

    return points;
  }

  /**
   * 构建带 miter 偏移的直墙几何体（公开方法）
   * 若墙体含有 openings，则调用带洞口的几何构建方法
   * 供 BuildingObjectManager 在检测到交汇连接时调用
   * @param data - 直墙数据
   * @param miter - miter 偏移参数
   * @returns BufferGeometry
   */
  public buildWithMiter(data: StraightWallData, miter: MiterParams): THREE.BufferGeometry {
    /* 若有洞口，使用带洞口的几何构建方法 */
    if (data.openings !== undefined && data.openings.length > 0) {
      return this._buildStraightWallWithOpenings(data, miter);
    }
    return this._buildStraightWall(data, miter);
  }

  /**
   * 构建带洞口的直墙几何体
   *
   * 算法：
   * 对每个洞口，将墙体前面和后面拆分为：
   *   - 洞口左侧矩形段
   *   - 洞口右侧矩形段
   *   - 洞口上方横条（若洞口未到顶）
   *   - 洞口下方横条（若洞口底部标高 > 0）
   *   - 洞口内壁（厚度方向的顶面、底面、左侧、右侧）
   * 端面、顶面、底面保持不变
   *
   * @param data - 直墙数据（含 openings）
   * @param miter - miter 偏移参数
   * @returns BufferGeometry
   */
  private _buildStraightWallWithOpenings(
    data: StraightWallData,
    miter: MiterParams
  ): THREE.BufferGeometry {
    const openings: WallOpening[] = data.openings ?? [];
    const halfThick: number = data.thickness / 2;
    const elevation: number = data.elevation;
    const height: number = data.height;

    /* 计算中心线方向向量（XZ 平面） */
    const dx: number = data.end.x - data.start.x;
    const dz: number = data.end.z - data.start.z;
    const length: number = Math.sqrt(dx * dx + dz * dz);
    if (length < 0.001) {
      return new THREE.BufferGeometry();
    }

    const dirX: number = dx / length;
    const dirZ: number = dz / length;
    const normX: number = -dirZ;
    const normZ: number = dirX;

    /* 计算 miter 后的 4 个角点（与 _buildStraightWall 一致） */
    const p0x: number = data.start.x + dirX * miter.start.frontOffset + normX * halfThick;
    const p0z: number = data.start.z + dirZ * miter.start.frontOffset + normZ * halfThick;
    const p3x: number = data.start.x + dirX * miter.start.backOffset - normX * halfThick;
    const p3z: number = data.start.z + dirZ * miter.start.backOffset - normZ * halfThick;
    const p1x: number = data.end.x - dirX * miter.end.frontOffset + normX * halfThick;
    const p1z: number = data.end.z - dirZ * miter.end.frontOffset + normZ * halfThick;
    const p2x: number = data.end.x - dirX * miter.end.backOffset - normX * halfThick;
    const p2z: number = data.end.z - dirZ * miter.end.backOffset - normZ * halfThick;

    const yBottom: number = elevation;
    const yTop: number = elevation + height;
    const wallThickness: number = data.thickness;
    const wallHeight: number = height;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    /**
     * 添加一个四边形面（两个三角形）
     */
    const addFace = (
      ax: number, ay: number, az: number,
      bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number,
      ddx: number, dy: number, dz: number,
      nx: number, ny: number, nz: number,
      uWidth: number, vHeight: number
    ): void => {
      const baseIdx: number = positions.length / 3;
      positions.push(ax, ay, az, bx, by, bz, cx, cy, cz, ddx, dy, dz);
      normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
      uvs.push(0, 0, uWidth, 0, uWidth, vHeight, 0, vHeight);
      indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
    };

    /* 将洞口按 t 值排序，便于分段处理 */
    const sortedOpenings: WallOpening[] = [...openings].sort(
      (a: WallOpening, b: WallOpening): number => a.centerT - b.centerT
    );

    /**
     * 生成前面或后面的带洞口网格分段
     *
     * 核心修复：以洞口左右边界和上下边界构造 U/Y 二维网格，只生成不在洞口内部的矩形单元。
     * 相邻单元使用完全相同的 U/Y 切分坐标，线框提取时可识别共面共享边，避免洞口上方竖线或横向分割线外显。
     *
     * @param faceOffX - 面在 X 方向的厚度偏移量
     * @param faceOffZ - 面在 Z 方向的厚度偏移量
     * @param faceNx - 面法线 X 分量
     * @param faceNz - 面法线 Z 分量
     * @param endP0x - 起点侧 miter 角点 X 坐标
     * @param endP0z - 起点侧 miter 角点 Z 坐标
     * @param endP1x - 终点侧 miter 角点 X 坐标
     * @param endP1z - 终点侧 miter 角点 Z 坐标
     */
    const addFaceWithOpenings = (
      faceOffX: number, faceOffZ: number,
      faceNx: number, faceNz: number,
      endP0x: number, endP0z: number,
      endP1x: number, endP1z: number
    ): void => {
      /* 使用中心线长度作为洞口定位基准 */
      const refLen: number = length;

      /**
       * 根据中心线距离 U 计算面上的顶点坐标
       * point = data.start + dirX * U + faceOffX, data.start.z + dirZ * U + faceOffZ
       */
      const ptX: (u: number) => number = (u: number): number => data.start.x + dirX * u + faceOffX;
      const ptZ: (u: number) => number = (u: number): number => data.start.z + dirZ * u + faceOffZ;

      /* 将洞口转换为沿中心线长度的区间 [leftU, rightU] */
      interface OpeningSegment {
        leftU: number;
        rightU: number;
        yOpenBottom: number;
        yOpenTop: number;
      }
      const segments: OpeningSegment[] = sortedOpenings.map((op: WallOpening): OpeningSegment => {
        const centerU: number = op.centerT * refLen;
        return {
          leftU: Math.max(0, centerU - op.width / 2),
          rightU: Math.min(refLen, centerU + op.width / 2),
          yOpenBottom: Math.max(yBottom, yBottom + op.bottomElevation),
          yOpenTop: Math.min(yTop, yBottom + op.bottomElevation + op.height),
        };
      });

      /**
       * 向切分数组添加坐标，避免近似重复值导致极窄面片和线框误判。
       * @param cuts - 待追加的切分数组
       * @param value - 需要追加的坐标值
       */
      const addUniqueCut: (cuts: number[], value: number) => void = (cuts: number[], value: number): void => {
        for (let i: number = 0; i < cuts.length; i++) {
          if (Math.abs(cuts[i]! - value) < 0.001) {
            return;
          }
        }
        cuts.push(value);
      };

      /**
       * 判断网格单元是否落在洞口内部，落入洞口内部的面片需要跳过。
       * @param uMin - 单元 U 方向最小值
       * @param uMax - 单元 U 方向最大值
       * @param yMin - 单元 Y 方向最小值
       * @param yMax - 单元 Y 方向最大值
       * @returns 是否为洞口内部单元
       */
      const isCellInsideOpening: (uMin: number, uMax: number, yMin: number, yMax: number) => boolean = (
        uMin: number,
        uMax: number,
        yMin: number,
        yMax: number
      ): boolean => {
        const midU: number = (uMin + uMax) / 2;
        const midY: number = (yMin + yMax) / 2;
        for (let i: number = 0; i < segments.length; i++) {
          const seg: OpeningSegment = segments[i]!;
          if (
            midU > seg.leftU + 0.001 &&
            midU < seg.rightU - 0.001 &&
            midY > seg.yOpenBottom + 0.001 &&
            midY < seg.yOpenTop - 0.001
          ) {
            return true;
          }
        }
        return false;
      };

      /* 收集所有洞口贡献的 U/Y 切分线，形成规则网格以消除 T-junction。 */
      const uCuts: number[] = [0, refLen];
      const yCuts: number[] = [yBottom, yTop];
      for (let i: number = 0; i < segments.length; i++) {
        const seg: OpeningSegment = segments[i]!;
        if (seg.rightU <= seg.leftU + 0.001 || seg.yOpenTop <= seg.yOpenBottom + 0.001) {
          continue;
        }
        addUniqueCut(uCuts, seg.leftU);
        addUniqueCut(uCuts, seg.rightU);
        addUniqueCut(yCuts, seg.yOpenBottom);
        addUniqueCut(yCuts, seg.yOpenTop);
      }

      uCuts.sort((a: number, b: number): number => a - b);
      yCuts.sort((a: number, b: number): number => a - b);

      /**
       * 根据 U 坐标返回面片顶点 X 坐标，墙体起终点使用 miter 角点保持端面封闭。
       * @param u - 中心线长度方向坐标
       * @returns 顶点 X 坐标
       */
      const getFaceX: (u: number) => number = (u: number): number => {
        if (Math.abs(u) < 0.001) {
          return endP0x;
        }
        if (Math.abs(u - refLen) < 0.001) {
          return endP1x;
        }
        return ptX(u);
      };

      /**
       * 根据 U 坐标返回面片顶点 Z 坐标，墙体起终点使用 miter 角点保持端面封闭。
       * @param u - 中心线长度方向坐标
       * @returns 顶点 Z 坐标
       */
      const getFaceZ: (u: number) => number = (u: number): number => {
        if (Math.abs(u) < 0.001) {
          return endP0z;
        }
        if (Math.abs(u - refLen) < 0.001) {
          return endP1z;
        }
        return ptZ(u);
      };

      /* 遍历 U/Y 网格，只为非洞口区域生成矩形单元，相邻单元共享完整边。 */
      for (let uIndex: number = 0; uIndex < uCuts.length - 1; uIndex++) {
        const uMin: number = uCuts[uIndex]!;
        const uMax: number = uCuts[uIndex + 1]!;
        if (uMax <= uMin + 0.001) {
          continue;
        }

        const ax: number = getFaceX(uMin);
        const az: number = getFaceZ(uMin);
        const bx: number = getFaceX(uMax);
        const bz: number = getFaceZ(uMax);

        for (let yIndex: number = 0; yIndex < yCuts.length - 1; yIndex++) {
          const yMin: number = yCuts[yIndex]!;
          const yMax: number = yCuts[yIndex + 1]!;
          if (yMax <= yMin + 0.001 || isCellInsideOpening(uMin, uMax, yMin, yMax)) {
            continue;
          }

          addFace(
            ax, yMin, az,  bx, yMin, bz,  bx, yMax, bz,  ax, yMax, az,
            faceNx, 0, faceNz,
            uMax - uMin, yMax - yMin
          );
        }
      }
    };

    /* ── 前面（materialIndex=0）：带洞口分段
     * 法线偏移 = +normX*halfThick, +normZ*halfThick（前面方向）
     * miter 角点：起点=p0，终点=p1 ── */
    const frontIndexStart: number = indices.length;
    addFaceWithOpenings(
      normX * halfThick, normZ * halfThick,
      normX, normZ,
      p0x, p0z, p1x, p1z
    );
    const frontIndexCount: number = indices.length - frontIndexStart;

    /* ── 后面（materialIndex=1）：带洞口分段
     * 法线偏移 = -normX*halfThick, -normZ*halfThick（后面方向）
     * miter 角点：起点=p3，终点=p2（起点→终点方向） ── */
    const backIndexStart: number = indices.length;
    addFaceWithOpenings(
      -normX * halfThick, -normZ * halfThick,
      -normX, -normZ,
      p3x, p3z, p2x, p2z
    );
    const backIndexCount: number = indices.length - backIndexStart;

    /* ── 洞口内壁（materialIndex=2）：每个洞口生成顶面、底面、左侧、右侧 ── */
    const innerWallIndexStart: number = indices.length;
    for (const op of sortedOpenings) {
      const centerU: number = op.centerT * length;
      const leftU: number = Math.max(0, centerU - op.width / 2);
      const rightU: number = Math.min(length, centerU + op.width / 2);
      const yOpenBottom: number = yBottom + op.bottomElevation;
      const yOpenTop: number = Math.min(yTop, yOpenBottom + op.height);

      /* 洞口左侧端面（沿墙方向，法线为 -dir） */
      const lx: number = data.start.x + dirX * leftU;
      const lz: number = data.start.z + dirZ * leftU;
      addFace(
        lx + normX * halfThick, yOpenBottom, lz + normZ * halfThick,
        lx - normX * halfThick, yOpenBottom, lz - normZ * halfThick,
        lx - normX * halfThick, yOpenTop,    lz - normZ * halfThick,
        lx + normX * halfThick, yOpenTop,    lz + normZ * halfThick,
        -dirX, 0, -dirZ,
        wallThickness, yOpenTop - yOpenBottom
      );

      /* 洞口右侧端面（沿墙方向，法线为 +dir） */
      const rx: number = data.start.x + dirX * rightU;
      const rz: number = data.start.z + dirZ * rightU;
      addFace(
        rx - normX * halfThick, yOpenBottom, rz - normZ * halfThick,
        rx + normX * halfThick, yOpenBottom, rz + normZ * halfThick,
        rx + normX * halfThick, yOpenTop,    rz + normZ * halfThick,
        rx - normX * halfThick, yOpenTop,    rz - normZ * halfThick,
        dirX, 0, dirZ,
        wallThickness, yOpenTop - yOpenBottom
      );

      /* 洞口顶面（法线为 -Y，朝下） */
      if (yOpenTop < yTop - 0.001) {
        addFace(
          lx + normX * halfThick, yOpenTop, lz + normZ * halfThick,
          rx + normX * halfThick, yOpenTop, rz + normZ * halfThick,
          rx - normX * halfThick, yOpenTop, rz - normZ * halfThick,
          lx - normX * halfThick, yOpenTop, lz - normZ * halfThick,
          0, -1, 0,
          rightU - leftU, wallThickness
        );
      }

      /* 洞口底面（法线为 +Y，朝上，仅当底部标高 > 0 时） */
      if (yOpenBottom > yBottom + 0.001) {
        addFace(
          lx - normX * halfThick, yOpenBottom, lz - normZ * halfThick,
          rx - normX * halfThick, yOpenBottom, rz - normZ * halfThick,
          rx + normX * halfThick, yOpenBottom, rz + normZ * halfThick,
          lx + normX * halfThick, yOpenBottom, lz + normZ * halfThick,
          0, 1, 0,
          rightU - leftU, wallThickness
        );
      }
    }
    const innerWallIndexCount: number = indices.length - innerWallIndexStart;

    /* ── 起点端面（materialIndex=3）── */
    const startCapIndexStart: number = indices.length;
    addFace(
      p3x, yBottom, p3z,  p0x, yBottom, p0z,  p0x, yTop, p0z,  p3x, yTop, p3z,
      -dirX, 0, -dirZ,
      wallThickness, wallHeight
    );
    const startCapIndexCount: number = indices.length - startCapIndexStart;

    /* ── 终点端面（materialIndex=4）── */
    const endCapIndexStart: number = indices.length;
    addFace(
      p1x, yBottom, p1z,  p2x, yBottom, p2z,  p2x, yTop, p2z,  p1x, yTop, p1z,
      dirX, 0, dirZ,
      wallThickness, wallHeight
    );
    const endCapIndexCount: number = indices.length - endCapIndexStart;

    /* ── 顶面（materialIndex=5）── */
    const topIndexStart: number = indices.length;
    addFace(
      p0x, yTop, p0z,  p1x, yTop, p1z,  p2x, yTop, p2z,  p3x, yTop, p3z,
      0, 1, 0,
      length, wallThickness
    );
    const topIndexCount: number = indices.length - topIndexStart;

    /* ── 底面（materialIndex=6）── */
    const bottomIndexStart: number = indices.length;
    addFace(
      p3x, yBottom, p3z,  p2x, yBottom, p2z,  p1x, yBottom, p1z,  p0x, yBottom, p0z,
      0, -1, 0,
      length, wallThickness
    );
    const bottomIndexCount: number = indices.length - bottomIndexStart;

    /* 构建 BufferGeometry */
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    /* 材质组：前面=0，后面=1，洞口内壁=2，起点端面=3，终点端面=4，顶面=5，底面=6 */
    geometry.addGroup(frontIndexStart,    frontIndexCount,    0);
    geometry.addGroup(backIndexStart,     backIndexCount,     1);
    geometry.addGroup(innerWallIndexStart, innerWallIndexCount, 2);
    geometry.addGroup(startCapIndexStart, startCapIndexCount, 3);
    geometry.addGroup(endCapIndexStart,   endCapIndexCount,   4);
    geometry.addGroup(topIndexStart,      topIndexCount,      5);
    geometry.addGroup(bottomIndexStart,   bottomIndexCount,   6);

    return geometry;
  }

  /**
   * 构建带差集运算的直墙几何体
   *
   * 算法：
   * 1. 先用 miter 偏移计算墙体的 XZ 截面矩形（4 个角点）
   * 2. 对每个差集矩形，在 XZ 截面上做多边形差集（Sutherland-Hodgman 裁剪）
   * 3. 将差集后的多边形挤压为 3D 几何体（侧面 + 顶面 + 底面）
   *
   * 差集矩形坐标系：以矩形中心为原点，wallDir 为 U 轴，wallDir 的法线为 V 轴
   * 差集矩形在 XZ 平面上的 4 个角点：
   *   center ± halfWidth * wallDir ± halfDepth * wallNorm
   *
   * @param data - 直墙数据
   * @param miter - miter 偏移参数
   * @param subtractions - 需要减去的矩形区域列表
   * @returns BufferGeometry（差集后的墙体几何）
   */
  public buildWithSubtraction(
    data: StraightWallData,
    miter: MiterParams,
    subtractions: WallSubtractionRect[]
  ): THREE.BufferGeometry {
    /* 无差集时退化为普通 miter 构建 */
    if (subtractions.length === 0) {
      return this._buildStraightWall(data, miter);
    }

    const elevation: number = data.elevation;
    const height: number = data.height;
    const yBottom: number = elevation;
    const yTop: number = elevation + height;
    const halfThick: number = data.thickness / 2;

    /* ── Step 1：计算 miter 后的墙体中心线端点 ── */
    const dx: number = data.end.x - data.start.x;
    const dz: number = data.end.z - data.start.z;
    const length: number = Math.sqrt(dx * dx + dz * dz);
    if (length < 0.001) {
      return new THREE.BufferGeometry();
    }
    const dirX: number = dx / length;
    const dirZ: number = dz / length;
    /* 法线方向（逆时针 90°） */
    const normX: number = -dirZ;
    const normZ: number = dirX;

    /*
     * buildWithSubtraction 使用各端面前后偏移的平均值作为中心线偏移量
     * 以保持与差集矩形计算的兼容性
     */
    const startCenterOffset: number = (miter.start.frontOffset + miter.start.backOffset) / 2;
    const endCenterOffset: number   = (miter.end.frontOffset   + miter.end.backOffset)   / 2;
    const actualStartX: number = data.start.x + dirX * startCenterOffset;
    const actualStartZ: number = data.start.z + dirZ * startCenterOffset;
    const actualEndX: number = data.end.x - dirX * endCenterOffset;
    const actualEndZ: number = data.end.z - dirZ * endCenterOffset;
    let wallPolygon: Point2D[] = [
      { x: actualStartX + normX * halfThick, z: actualStartZ + normZ * halfThick },
      { x: actualEndX + normX * halfThick,   z: actualEndZ + normZ * halfThick   },
      { x: actualEndX - normX * halfThick,   z: actualEndZ - normZ * halfThick   },
      { x: actualStartX - normX * halfThick, z: actualStartZ - normZ * halfThick },
    ];

    /* ── Step 3：对每个差集矩形做多边形差集 ──
     * 使用 Sutherland-Hodgman 算法将差集矩形从墙体多边形中裁去
     * 注意：Sutherland-Hodgman 是裁剪（交集），不是差集
     * 差集 = 原多边形 - 差集矩形
     * 对于简单的矩形差集（端部开口），等价于：
     *   将墙体多边形沿差集矩形的边界裁切，保留差集矩形外侧的部分
     *
     * 简化实现：对于端部差集（差集矩形与墙体端面重叠），
     * 直接将墙体端面向内推进 halfWidth，形成 U 形截面
     */
    for (const sub of subtractions) {
      wallPolygon = this._subtractRectFromPolygon(wallPolygon, sub);
      if (wallPolygon.length < 3) {
        /* 差集后多边形退化，返回空几何体 */
        return new THREE.BufferGeometry();
      }
    }

    /* ── Step 4：将差集后的多边形挤压为 3D 几何体 ── */
    return this._extrudePolygon(wallPolygon, yBottom, yTop, data.thickness, length);
  }

  /**
   * 从多边形中减去矩形区域
   *
   * 算法：
   * 将差集矩形转换为 4 条裁剪边，对每条边使用 Sutherland-Hodgman 算法
   * 保留在裁剪边"外侧"的部分（即差集矩形外侧）
   *
   * 注意：标准 Sutherland-Hodgman 是求交集（保留内侧）
   * 这里反转逻辑，保留外侧（差集）
   *
   * 对于端部差集（差集矩形覆盖墙体端面），结果为 U 形或 L 形多边形
   *
   * @param polygon - 输入多边形（XZ 平面，逆时针顺序）
   * @param sub - 差集矩形参数
   * @returns 差集后的多边形
   */
  private _subtractRectFromPolygon(
    polygon: Point2D[],
    sub: WallSubtractionRect
  ): Point2D[] {
    /* 计算差集矩形的 4 个角点（世界坐标） */
    const wdx: number = sub.wallDirX;
    const wdz: number = sub.wallDirZ;
    /* 法线方向（逆时针 90°） */
    const wnx: number = -wdz;
    const wnz: number = wdx;

    /* 差集矩形 4 个角点（逆时针） */
    const subRect: Point2D[] = [
      { x: sub.centerX - wdx * sub.halfWidth - wnx * sub.halfDepth, z: sub.centerZ - wdz * sub.halfWidth - wnz * sub.halfDepth },
      { x: sub.centerX + wdx * sub.halfWidth - wnx * sub.halfDepth, z: sub.centerZ + wdz * sub.halfWidth - wnz * sub.halfDepth },
      { x: sub.centerX + wdx * sub.halfWidth + wnx * sub.halfDepth, z: sub.centerZ + wdz * sub.halfWidth + wnz * sub.halfDepth },
      { x: sub.centerX - wdx * sub.halfWidth + wnx * sub.halfDepth, z: sub.centerZ - wdz * sub.halfWidth + wnz * sub.halfDepth },
    ];

    /* 检测多边形是否与差集矩形有交叉
     * 若多边形完全在差集矩形外，直接返回原多边形
     * 若多边形完全在差集矩形内，返回空数组
     */
    const intersects: boolean = this._polygonsIntersect(polygon, subRect);
    if (!intersects) {
      return polygon;
    }

    /*
     * 差集算法：
     * 对差集矩形的每条边，将多边形中位于该边"内侧"（差集矩形内部）的顶点
     * 替换为边界交点，从而将多边形"切开"并保留外侧部分
     *
     * 实现方式：使用 Greiner-Hormann 算法的简化版本
     * 对于凸多边形差集，使用逐边裁剪（反向 Sutherland-Hodgman）
     */
    return this._clipPolygonByConvexHole(polygon, subRect);
  }

  /**
   * 检测两个多边形是否相交（AABB 快速检测）
   * @param polyA - 多边形 A
   * @param polyB - 多边形 B
   * @returns 是否相交
   */
  private _polygonsIntersect(polyA: Point2D[], polyB: Point2D[]): boolean {
    /* 计算 AABB */
    let minAx: number = Infinity;
    let maxAx: number = -Infinity;
    let minAz: number = Infinity;
    let maxAz: number = -Infinity;
    for (const p of polyA) {
      if (p.x < minAx) minAx = p.x;
      if (p.x > maxAx) maxAx = p.x;
      if (p.z < minAz) minAz = p.z;
      if (p.z > maxAz) maxAz = p.z;
    }
    let minBx: number = Infinity;
    let maxBx: number = -Infinity;
    let minBz: number = Infinity;
    let maxBz: number = -Infinity;
    for (const p of polyB) {
      if (p.x < minBx) minBx = p.x;
      if (p.x > maxBx) maxBx = p.x;
      if (p.z < minBz) minBz = p.z;
      if (p.z > maxBz) maxBz = p.z;
    }
    /* AABB 不相交则多边形不相交 */
    if (maxAx < minBx - 0.001 || minAx > maxBx + 0.001) return false;
    if (maxAz < minBz - 0.001 || minAz > maxBz + 0.001) return false;
    return true;
  }

  /**
   * 从多边形中裁去凸多边形孔洞（差集）
   *
   * 算法：对孔洞（差集矩形）的每条边，
   * 将输入多边形中位于该边内侧的部分裁去，保留外侧部分。
   * 这是反向 Sutherland-Hodgman 算法。
   *
   * 注意：此算法对于端部差集（孔洞与多边形边界重叠）效果最好。
   * 对于完全内部的孔洞，会产生自相交多边形（需要更复杂的算法处理）。
   *
   * @param polygon - 输入多边形（逆时针）
   * @param hole - 孔洞多边形（逆时针凸多边形）
   * @returns 差集后的多边形
   */
  private _clipPolygonByConvexHole(
    polygon: Point2D[],
    hole: Point2D[]
  ): Point2D[] {
    let result: Point2D[] = polygon.slice();

    /* 对孔洞的每条边进行裁剪 */
    for (let i: number = 0; i < hole.length; i++) {
      if (result.length === 0) break;

      const edgeA: Point2D = hole[i]!;
      const edgeB: Point2D = hole[(i + 1) % hole.length]!;

      /* 裁剪边方向向量 */
      const edgeDx: number = edgeB.x - edgeA.x;
      const edgeDz: number = edgeB.z - edgeA.z;

      /* 保留在裁剪边"外侧"（右侧，即孔洞外部）的顶点
       * 判断点 P 在边 AB 的哪侧：cross(AB, AP) > 0 → 左侧（孔洞内部），< 0 → 右侧（孔洞外部）
       * 孔洞为逆时针，内部 = 左侧，外部 = 右侧
       */
      const isOutside = (p: Point2D): boolean => {
        const cross: number = edgeDx * (p.z - edgeA.z) - edgeDz * (p.x - edgeA.x);
        return cross <= 0; /* 右侧或边上 = 孔洞外部 */
      };

      /* 计算线段 AB 与裁剪边的交点 */
      const intersect = (a: Point2D, b: Point2D): Point2D | null => {
        const dx1: number = b.x - a.x;
        const dz1: number = b.z - a.z;
        const denom: number = edgeDx * dz1 - edgeDz * dx1;
        if (Math.abs(denom) < 0.000001) return null; /* 平行 */
        const t: number = (edgeDx * (a.z - edgeA.z) - edgeDz * (a.x - edgeA.x)) / denom;
        return { x: a.x + t * dx1, z: a.z + t * dz1 };
      };

      /* Sutherland-Hodgman 裁剪（保留外侧） */
      const clipped: Point2D[] = [];
      for (let j: number = 0; j < result.length; j++) {
        const curr: Point2D = result[j]!;
        const next: Point2D = result[(j + 1) % result.length]!;
        const currOut: boolean = isOutside(curr);
        const nextOut: boolean = isOutside(next);

        if (currOut) {
          clipped.push(curr);
          if (!nextOut) {
            /* 从外到内：添加交点 */
            const pt: Point2D | null = intersect(curr, next);
            if (pt !== null) clipped.push(pt);
          }
        } else {
          if (nextOut) {
            /* 从内到外：添加交点 */
            const pt: Point2D | null = intersect(curr, next);
            if (pt !== null) clipped.push(pt);
          }
          /* 内部顶点不保留 */
        }
      }

      result = clipped;
    }

    return result;
  }

  /**
   * 将 XZ 平面多边形挤压为 3D 几何体
   * 生成侧面（每段边对应一个矩形面）+ 顶面 + 底面
   * 使用 earcut 三角剖分算法处理顶面和底面
   *
   * @param polygon - XZ 平面多边形（逆时针顺序）
   * @param yBottom - 底部 Y 坐标
   * @param yTop - 顶部 Y 坐标
   * @param wallThickness - 墙体厚度（用于 UV 映射）
   * @param wallLength - 墙体长度（用于 UV 映射）
   * @returns BufferGeometry
   */
  private _extrudePolygon(
    polygon: Point2D[],
    yBottom: number,
    yTop: number,
    wallThickness: number,
    wallLength: number
  ): THREE.BufferGeometry {
    const n: number = polygon.length;
    if (n < 3) {
      return new THREE.BufferGeometry();
    }

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    /* ── 侧面：每段边生成一个矩形面 ── */
    const sideIndexStart: number = 0;
    for (let i: number = 0; i < n; i++) {
      const a: Point2D = polygon[i]!;
      const b: Point2D = polygon[(i + 1) % n]!;

      /* 边方向和法线 */
      const edgeDx: number = b.x - a.x;
      const edgeDz: number = b.z - a.z;
      const edgeLen: number = Math.sqrt(edgeDx * edgeDx + edgeDz * edgeDz);
      if (edgeLen < 0.0001) continue;

      /* 外侧法线（逆时针多边形，外侧 = 右侧） */
      const faceNx: number = edgeDz / edgeLen;
      const faceNz: number = -edgeDx / edgeLen;

      const baseIdx: number = positions.length / 3;
      positions.push(
        a.x, yBottom, a.z,
        b.x, yBottom, b.z,
        b.x, yTop,    b.z,
        a.x, yTop,    a.z
      );
      normals.push(
        faceNx, 0, faceNz,
        faceNx, 0, faceNz,
        faceNx, 0, faceNz,
        faceNx, 0, faceNz
      );
      uvs.push(0, 0, edgeLen, 0, edgeLen, yTop - yBottom, 0, yTop - yBottom);
      indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
    }
    const sideIndexCount: number = indices.length - sideIndexStart;

    /* ── 顶面：使用 earcut 三角剖分 ── */
    const topIndexStart: number = indices.length;
    const topBaseIdx: number = positions.length / 3;
    for (const p of polygon) {
      positions.push(p.x, yTop, p.z);
      normals.push(0, 1, 0);
      uvs.push(p.x / wallLength, p.z / wallThickness);
    }
    const topTriangles: number[] = this._earcut(polygon);
    for (const idx of topTriangles) {
      indices.push(topBaseIdx + idx);
    }
    const topIndexCount: number = indices.length - topIndexStart;

    /* ── 底面：使用 earcut 三角剖分（法线朝下，顶点顺序反转） ── */
    const bottomIndexStart: number = indices.length;
    const bottomBaseIdx: number = positions.length / 3;
    for (const p of polygon) {
      positions.push(p.x, yBottom, p.z);
      normals.push(0, -1, 0);
      uvs.push(p.x / wallLength, p.z / wallThickness);
    }
    const bottomTriangles: number[] = this._earcut(polygon);
    /* 底面顶点顺序反转（使法线朝下） */
    for (let i: number = 0; i < bottomTriangles.length; i += 3) {
      indices.push(
        bottomBaseIdx + bottomTriangles[i]!,
        bottomBaseIdx + bottomTriangles[i + 2]!,
        bottomBaseIdx + bottomTriangles[i + 1]!
      );
    }
    const bottomIndexCount: number = indices.length - bottomIndexStart;

    /* 构建 BufferGeometry */
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);

    /* Material Groups：侧面=0，顶面=1，底面=2 */
    geometry.addGroup(sideIndexStart, sideIndexCount, 0);
    geometry.addGroup(topIndexStart, topIndexCount, 1);
    geometry.addGroup(bottomIndexStart, bottomIndexCount, 2);

    return geometry;
  }

  /**
   * Earcut 多边形三角剖分（简化版，仅支持凸多边形和简单凹多边形）
   * 使用"耳切法"（Ear Clipping）算法
   * @param polygon - XZ 平面多边形（逆时针顺序）
   * @returns 三角形索引数组（每 3 个为一个三角形）
   */
  private _earcut(polygon: Point2D[]): number[] {
    const n: number = polygon.length;
    if (n < 3) return [];
    if (n === 3) return [0, 1, 2];

    const result: number[] = [];
    /* 剩余顶点索引列表 */
    const remaining: number[] = Array.from({ length: n }, (_: unknown, i: number): number => i);

    let maxIter: number = n * n; /* 防止无限循环 */
    let i: number = 0;

    while (remaining.length > 3 && maxIter > 0) {
      maxIter--;
      const len: number = remaining.length;
      const prevIdx: number = remaining[(i - 1 + len) % len]!;
      const currIdx: number = remaining[i % len]!;
      const nextIdx: number = remaining[(i + 1) % len]!;

      const prev: Point2D = polygon[prevIdx]!;
      const curr: Point2D = polygon[currIdx]!;
      const next: Point2D = polygon[nextIdx]!;

      /* 检查是否为"耳"（凸顶点且三角形内无其他顶点） */
      if (this._isEar(prev, curr, next, polygon, remaining)) {
        result.push(prevIdx, currIdx, nextIdx);
        remaining.splice(i % len, 1);
        i = Math.max(0, i - 1);
      } else {
        i++;
      }
    }

    /* 最后剩余 3 个顶点 */
    if (remaining.length === 3) {
      result.push(remaining[0]!, remaining[1]!, remaining[2]!);
    }

    return result;
  }

  /**
   * 判断顶点 curr 是否为"耳"（Ear Clipping 算法辅助）
   * 条件：curr 是凸顶点，且三角形 prev-curr-next 内无其他顶点
   */
  private _isEar(
    prev: Point2D,
    curr: Point2D,
    next: Point2D,
    polygon: Point2D[],
    remaining: number[]
  ): boolean {
    /* 检查是否为凸顶点（叉积 > 0 表示逆时针，即凸） */
    const cross: number =
      (curr.x - prev.x) * (next.z - prev.z) -
      (curr.z - prev.z) * (next.x - prev.x);
    if (cross <= 0) return false; /* 凹顶点 */

    /* 检查三角形内是否有其他顶点 */
    for (const idx of remaining) {
      const p: Point2D = polygon[idx]!;
      if (p === prev || p === curr || p === next) continue;
      if (this._pointInTriangle(p, prev, curr, next)) return false;
    }

    return true;
  }

  /**
   * 判断点 P 是否在三角形 ABC 内（使用重心坐标法）
   */
  private _pointInTriangle(
    p: Point2D,
    a: Point2D,
    b: Point2D,
    c: Point2D
  ): boolean {
    const d1: number = (p.x - b.x) * (a.z - b.z) - (a.x - b.x) * (p.z - b.z);
    const d2: number = (p.x - c.x) * (b.z - c.z) - (b.x - c.x) * (p.z - c.z);
    const d3: number = (p.x - a.x) * (c.z - a.z) - (c.x - a.x) * (p.z - a.z);
    const hasNeg: boolean = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos: boolean = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  }

  /**
   * 构建预览几何体（半透明线框效果用）
   * 使用相同算法但可指定不同参数
   * @param start - 起点
   * @param end - 终点
   * @param thickness - 墙体厚度
   * @param height - 墙体高度
   * @returns BufferGeometry
   */
  public buildPreview(
    start: Point2D,
    end: Point2D,
    thickness: number,
    height: number
  ): THREE.BufferGeometry {
    /** 预览用占位包围盒 */
    const emptyBoundingBox = {
      min: { x: 0, z: 0 },
      max: { x: 0, z: 0 },
      center: { x: 0, z: 0 },
      size: { x: 0, y: 0, z: 0 },
    };
    const previewData: StraightWallData = {
      id: '__preview__',
      category: 'wall',
      subType: 'straight',
      name: '预览',
      visible: true,
      locked: false,
      height: height,
      elevation: 0,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      material: getDefaultMaterial('wall'),
      thickness: thickness,
      start: start,
      end: end,
      /* 预览用，无关联天花板/楼板 */
      ceilingId: null,
      slabId: null,
      boundingBox: emptyBoundingBox,
    };
    return this._buildStraightWall(previewData);
  }

  /**
   * 构建弧形墙预览几何体
   * 使用弧形墙算法生成预览用的半透明几何体
   * @param start - 弧线起点
   * @param end - 弧线终点
   * @param bulge - 弧度因子（tan(angle/4)，DXF/DWG 标准）
   * @param thickness - 墙体厚度
   * @param height - 墙体高度
   * @param segments - 弧线分段数，默认 16
   * @returns BufferGeometry
   */
  public buildArcPreview(
    start: Point2D,
    end: Point2D,
    bulge: number,
    thickness: number,
    height: number,
    segments: number = 16
  ): THREE.BufferGeometry {
    /** 预览用占位包围盒 */
    const emptyBoundingBox = {
      min: { x: 0, z: 0 },
      max: { x: 0, z: 0 },
      center: { x: 0, z: 0 },
      size: { x: 0, y: 0, z: 0 },
    };
    const previewData: ArcWallData = {
      id: '__arc_preview__',
      category: 'wall',
      subType: 'arc',
      name: '弧形预览',
      visible: true,
      locked: false,
      height: height,
      elevation: 0,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      material: getDefaultMaterial('wall'),
      thickness: thickness,
      start: start,
      end: end,
      bulge: bulge,
      segments: segments,
      boundingBox: emptyBoundingBox,
    };
    return this._buildArcWall(previewData);
  }
}
