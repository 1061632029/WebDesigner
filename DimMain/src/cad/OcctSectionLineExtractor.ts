/**
 * OCCT 截面交线提取器
 * 使用 BRepAlgoAPI_Section 计算两个 B-Rep 实体的精确交线，
 * 遍历结果 Shape 中的所有 Edge，通过 BRepAdaptor_Curve 离散化为折线段坐标数组
 */

import type { OpenCascadeInstance } from './OcctTypes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 交线离散化结果
 * 每条 Edge 对应一段折线，points 为 flat 坐标数组 [x0,y0,z0, x1,y1,z1, ...]
 */
export interface SectionEdgePoints {
  /** 折线顶点坐标（flat array，每 3 个为一个点） */
  points: Float32Array;
}

/**
 * OCCT 截面交线提取器
 * 职责：调用 Section 运算 → 遍历 Edge → 离散化为坐标数组
 */
export class OcctSectionLineExtractor {
  /** OCCT 实例引用 */
  private _oc: OpenCascadeInstance;

  /**
   * @param oc - OpenCascade WASM 实例
   */
  constructor(oc: OpenCascadeInstance) {
    this._oc = oc;
  }

  /**
   * 计算两个 Shape 的精确交线并离散化
   * @param shapeA - 第一个 B-Rep Shape
   * @param shapeB - 第二个 B-Rep Shape
   * @param deflection - 离散化精度（越小越精细，默认 0.05）
   * @returns 所有交线 Edge 的离散化坐标数组列表
   */
  public extract(
    shapeA: any,
    shapeB: any,
    deflection: number = 0.05
  ): SectionEdgePoints[] {
    /* 执行截面运算，得到包含所有交线 Edge 的 Shape */
    const sectionOp: any = new this._oc.BRepAlgoAPI_Section(shapeA, shapeB);
    const sectionShape: any = sectionOp.Shape();

    /* 遍历截面 Shape 中的所有 Edge */
    const results: SectionEdgePoints[] = [];
    const explorer: any = new this._oc.TopExp_Explorer(
      sectionShape,
      this._oc.TopAbs_ShapeEnum.TopAbs_EDGE
    );

    while (explorer.More()) {
      const edge: any = this._oc.TopoDS.Edge(explorer.Current());

      /* 将 Edge 离散化为折线段坐标 */
      const edgePoints: SectionEdgePoints | null = this._discretizeEdge(edge, deflection);
      if (edgePoints !== null) {
        results.push(edgePoints);
      }

      explorer.Next();
    }

    return results;
  }

  /**
   * 将单条 Edge 离散化为折线段坐标数组
   * 使用 BRepAdaptor_Curve 获取参数化曲线，按均匀参数步长采样
   * @param edge - OCCT TopoDS_Edge
   * @param deflection - 离散化精度（控制采样步数）
   * @returns 折线坐标数组，若 Edge 无效则返回 null
   */
  private _discretizeEdge(edge: any, deflection: number): SectionEdgePoints | null {
    try {
      /* 创建曲线适配器，获取参数范围 [first, last] */
      const adaptor: any = new this._oc.BRepAdaptor_Curve(edge);
      const first: number = adaptor.FirstParameter();
      const last: number = adaptor.LastParameter();

      /* 参数范围过小时跳过（退化 Edge） */
      if (Math.abs(last - first) < 1e-10) {
        return null;
      }

      /* 根据 deflection 计算采样步数（最少 2 个点，即线段两端） */
      const steps: number = Math.max(2, Math.ceil(Math.abs(last - first) / deflection));
      const coords: number[] = [];

      /* 按均匀参数步长采样曲线上的点 */
      for (let i: number = 0; i <= steps; i++) {
        const t: number = first + (last - first) * (i / steps);
        const pnt: any = adaptor.Value(t);
        coords.push(pnt.X(), pnt.Y(), pnt.Z());
      }

      return {
        points: new Float32Array(coords),
      };
    } catch {
      /* 某些退化 Edge 可能抛出异常，跳过 */
      return null;
    }
  }

  /**
   * 将所有交线 Edge 的坐标合并为一个 flat 坐标数组
   * 用于直接构建 THREE.BufferGeometry（LineSegments 模式：每两个点为一段）
   * @param edgePointsList - extract() 返回的结果列表
   * @returns 合并后的 flat 坐标数组（LineSegments 格式：[p0,p1, p2,p3, ...]）
   */
  public mergeToLineSegments(edgePointsList: SectionEdgePoints[]): Float32Array {
    const allCoords: number[] = [];

    for (const edgePoints of edgePointsList) {
      const pts: Float32Array = edgePoints.points;
      const pointCount: number = pts.length / 3;

      /* 将折线转换为线段对（每相邻两点构成一段） */
      for (let i: number = 0; i < pointCount - 1; i++) {
        const base: number = i * 3;
        const nextBase: number = base + 3;
        /* 线段起点（显式断言为 number，Float32Array 索引访问在运行时始终有效） */
        allCoords.push(
          pts[base] as number,
          pts[base + 1] as number,
          pts[base + 2] as number
        );
        /* 线段终点 */
        allCoords.push(
          pts[nextBase] as number,
          pts[nextBase + 1] as number,
          pts[nextBase + 2] as number
        );
      }
    }

    return new Float32Array(allCoords);
  }
}
