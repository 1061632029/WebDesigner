/**
 * OCCT 布尔运算
 * 封装 BRepAlgoAPI 系列 API，支持并集/差集/交集
 */

import type { OpenCascadeInstance } from './OcctTypes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** 布尔运算类型 */
export type BooleanOpType = 'fuse' | 'cut' | 'common';

/**
 * 布尔运算器
 */
export class OcctBooleanOps {
  /** OCCT 实例引用 */
  private _oc: OpenCascadeInstance;

  constructor(oc: OpenCascadeInstance) {
    this._oc = oc;
  }

  /**
   * 并集（Union / Fuse）
   * @param shapeA - 第一个 Shape
   * @param shapeB - 第二个 Shape
   * @returns 并集结果 TopoDS_Shape
   */
  public fuse(shapeA: any, shapeB: any): any {
    const op: any = new this._oc.BRepAlgoAPI_Fuse(shapeA, shapeB);
    const result: any = op.Shape();
    return result;
  }

  /**
   * 差集（Cut / Subtract）
   * @param shapeA - 被减 Shape
   * @param shapeB - 减去的 Shape
   * @returns 差集结果 TopoDS_Shape
   */
  public cut(shapeA: any, shapeB: any): any {
    const op: any = new this._oc.BRepAlgoAPI_Cut(shapeA, shapeB);
    const result: any = op.Shape();
    return result;
  }

  /**
   * 交集（Common / Intersect）
   * @param shapeA - 第一个 Shape
   * @param shapeB - 第二个 Shape
   * @returns 交集结果 TopoDS_Shape
   */
  public common(shapeA: any, shapeB: any): any {
    const op: any = new this._oc.BRepAlgoAPI_Common(shapeA, shapeB);
    const result: any = op.Shape();
    return result;
  }

  /**
   * 截面/交线运算（Section）
   * 计算两个 Shape 的精确交线，返回包含所有交线 Edge 的 Shape
   * @param shapeA - 第一个 Shape
   * @param shapeB - 第二个 Shape
   * @returns 交线 Shape（TopoDS_Shape，内含若干 Edge）
   */
  public section(shapeA: any, shapeB: any): any {
    const op: any = new this._oc.BRepAlgoAPI_Section(shapeA, shapeB);
    const result: any = op.Shape();
    return result;
  }

  /**
   * 通用布尔运算方法
   * @param type - 运算类型
   * @param shapeA - 第一个 Shape
   * @param shapeB - 第二个 Shape
   * @returns 运算结果 TopoDS_Shape
   */
  public perform(type: BooleanOpType, shapeA: any, shapeB: any): any {
    switch (type) {
      case 'fuse':
        return this.fuse(shapeA, shapeB);
      case 'cut':
        return this.cut(shapeA, shapeB);
      case 'common':
        return this.common(shapeA, shapeB);
      default:
        throw new Error(`不支持的布尔运算类型: ${type}`);
    }
  }
}
