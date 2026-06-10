/**
 * OCCT 基础几何体创建器
 * 封装 BRepPrimAPI 系列 API，创建 B-Rep 实体
 */

import type { OpenCascadeInstance } from './OcctTypes';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 几何体创建器
 * 通过 OCCT 内核创建基础几何实体（Box/Sphere/Cylinder/Cone/Torus）
 */
export class OcctShapeBuilder {
  /** OCCT 实例引用 */
  private _oc: OpenCascadeInstance;

  /**
   * @param oc - OpenCascade WASM 实例
   */
  constructor(oc: OpenCascadeInstance) {
    this._oc = oc;
  }

  /**
   * 创建立方体
   * @param width - X 方向尺寸
   * @param height - Y 方向尺寸
   * @param depth - Z 方向尺寸
   * @returns TopoDS_Shape
   */
  public makeBox(width: number = 1, height: number = 1, depth: number = 1): any {
    const maker: any = new this._oc.BRepPrimAPI_MakeBox(width, height, depth);
    const shape: any = maker.Shape();
    return shape;
  }

  /**
   * 创建球体
   * @param radius - 半径
   * @returns TopoDS_Shape
   */
  public makeSphere(radius: number = 0.5): any {
    const maker: any = new this._oc.BRepPrimAPI_MakeSphere(radius);
    const shape: any = maker.Shape();
    return shape;
  }

  /**
   * 创建圆柱体
   * @param radius - 底面半径
   * @param height - 高度
   * @returns TopoDS_Shape
   */
  public makeCylinder(radius: number = 0.5, height: number = 1): any {
    const maker: any = new this._oc.BRepPrimAPI_MakeCylinder(radius, height);
    const shape: any = maker.Shape();
    return shape;
  }

  /**
   * 创建圆锥体
   * @param bottomRadius - 底面半径
   * @param topRadius - 顶面半径（0 为尖锥）
   * @param height - 高度
   * @returns TopoDS_Shape
   */
  public makeCone(bottomRadius: number = 0.5, topRadius: number = 0, height: number = 1): any {
    const maker: any = new this._oc.BRepPrimAPI_MakeCone(bottomRadius, topRadius, height);
    const shape: any = maker.Shape();
    return shape;
  }

  /**
   * 创建圆环体
   * @param majorRadius - 主半径（环心到管中心）
   * @param minorRadius - 管半径
   * @returns TopoDS_Shape
   */
  public makeTorus(majorRadius: number = 0.5, minorRadius: number = 0.15): any {
    const maker: any = new this._oc.BRepPrimAPI_MakeTorus(majorRadius, minorRadius);
    const shape: any = maker.Shape();
    return shape;
  }

  /**
   * 对 Shape 添加圆角
   * @param shape - 原始 Shape
   * @param radius - 圆角半径
   * @returns 带圆角的 TopoDS_Shape
   */
  public makeFillet(shape: any, radius: number = 0.05): any {
    const fillet: any = new this._oc.BRepFilletAPI_MakeFillet(shape);

    /* 遍历所有边添加圆角 */
    const explorer: any = new this._oc.TopExp_Explorer(
      shape,
      this._oc.TopAbs_ShapeEnum.TopAbs_EDGE
    );

    while (explorer.More()) {
      const edge: any = explorer.Current();
      fillet.Add_1(radius, edge);
      explorer.Next();
    }

    const result: any = fillet.Shape();
    return result;
  }
}
