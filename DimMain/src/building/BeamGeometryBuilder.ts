/**
 * 梁几何构建器
 * 根据梁中心线、宽度、高度和位置基准生成线式矩形梁实体。
 */

import * as THREE from 'three/webgpu';
import type { BeamData, MiterParams, Point2D } from './BuildingTypes';
import { BEAM_DEFAULTS } from './BuildingTypes';

/** 梁几何构建器 */
export class BeamGeometryBuilder {
  /** 无斜接偏移常量（梁端点未连接时使用） */
  public static readonly NO_MITER: MiterParams = {
    start: { frontOffset: 0, backOffset: 0 },
    end: { frontOffset: 0, backOffset: 0 },
  };

  /**
   * 构建梁实体几何体
   * 关键流程：以 start/end 作为梁长方向，在 XZ 平面按 width 偏移两侧，并按位置基准换算 Y 向高度范围。
   * @param data - 梁构件数据
   * @returns 梁 BufferGeometry
   */
  public build(data: BeamData): THREE.BufferGeometry {
    const baseY: number = BeamGeometryBuilder.computeBottomY(data);
    return this.buildPreview(data.start, data.end, data.width, data.height, baseY);
  }

  /**
   * 构建带端点斜接的梁实体几何体
   * @param data - 梁构件数据
   * @param miter - 梁两端斜切偏移参数
   * @returns 梁 BufferGeometry
   */
  public buildWithMiter(data: BeamData, miter: MiterParams): THREE.BufferGeometry {
    const baseY: number = BeamGeometryBuilder.computeBottomY(data);
    return this.buildPreview(data.start, data.end, data.width, data.height, baseY, miter);
  }

  /**
   * 构建梁预览几何体
   * @param start - 梁中心线起点
   * @param end - 梁中心线终点
   * @param width - 梁宽度（XZ 平面垂直线向）
   * @param height - 梁高度（Y 方向）
   * @param bottomY - 梁底部世界高度
   * @returns 梁预览 BufferGeometry
   */
  public buildPreview(
    start: Point2D,
    end: Point2D,
    width: number = BEAM_DEFAULTS.width,
    height: number = BEAM_DEFAULTS.height,
    bottomY: number = BEAM_DEFAULTS.distanceFromFloor,
    miter: MiterParams = BeamGeometryBuilder.NO_MITER
  ): THREE.BufferGeometry {
    const dx: number = end.x - start.x;
    const dz: number = end.z - start.z;
    const length: number = Math.sqrt(dx * dx + dz * dz);
    if (length < 0.001) {
      return new THREE.BufferGeometry();
    }

    const dirX: number = dx / length;
    const dirZ: number = dz / length;
    const normalX: number = -dirZ;
    const normalZ: number = dirX;
    const halfWidth: number = width / 2;
    const topY: number = bottomY + height;

    /* 端点斜接流程：根据梁端有符号偏移调整两侧端点，正值向梁内侧收口，负值向节点外侧延展以消除连接留缝。 */
    const p1: Point2D = {
      x: start.x + dirX * miter.start.frontOffset + normalX * halfWidth,
      z: start.z + dirZ * miter.start.frontOffset + normalZ * halfWidth,
    };
    const p2: Point2D = {
      x: start.x + dirX * miter.start.backOffset - normalX * halfWidth,
      z: start.z + dirZ * miter.start.backOffset - normalZ * halfWidth,
    };
    const p3: Point2D = {
      x: end.x - dirX * miter.end.backOffset - normalX * halfWidth,
      z: end.z - dirZ * miter.end.backOffset - normalZ * halfWidth,
    };
    const p4: Point2D = {
      x: end.x - dirX * miter.end.frontOffset + normalX * halfWidth,
      z: end.z - dirZ * miter.end.frontOffset + normalZ * halfWidth,
    };

    const vertices: number[] = [
      p1.x, bottomY, p1.z, p2.x, bottomY, p2.z, p3.x, bottomY, p3.z, p4.x, bottomY, p4.z,
      p1.x, topY, p1.z, p2.x, topY, p2.z, p3.x, topY, p3.z, p4.x, topY, p4.z,
    ];
    const indices: number[] = [
      0, 1, 2, 0, 2, 3,
      4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1,
      3, 2, 6, 3, 6, 7,
      0, 3, 7, 0, 7, 4,
      1, 5, 6, 1, 6, 2,
    ];

    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  /**
   * 计算梁长度
   * @param start - 梁中心线起点
   * @param end - 梁中心线终点
   * @returns 两点间距，单位米
   */
  public static computeLength(start: Point2D, end: Point2D): number {
    const dx: number = end.x - start.x;
    const dz: number = end.z - start.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /**
   * 根据位置基准计算梁底部 Y 坐标
   * @param data - 梁构件数据
   * @returns 梁底部世界高度
   */
  public static computeBottomY(data: BeamData): number {
    if (data.placementReference === 'ceiling') {
      return BEAM_DEFAULTS.ceilingReferenceHeight - data.distanceFromCeiling - data.height;
    }
    return data.distanceFromFloor;
  }
}