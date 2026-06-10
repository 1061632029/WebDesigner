/**
 * OpenCascade.js WASM 类型声明
 * 定义 opencascade.js 模块的核心 API 类型
 * 注意：opencascade.js 的类型是动态映射自 C++ OCCT API
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * OpenCascade WASM 模块实例
 * 包含所有 OCCT 类的构造器和方法
 */
export interface OpenCascadeInstance {
  /* ========== 基础拓扑类型 ========== */
  TopoDS_Shape: any;
  TopoDS_Solid: any;
  TopoDS_Face: any;
  TopoDS_Edge: any;
  TopoDS_Wire: any;
  TopoDS_Compound: any;

  /* ========== 几何体创建 ========== */
  BRepPrimAPI_MakeBox: new (dx: number, dy: number, dz: number) => any;
  BRepPrimAPI_MakeSphere: new (radius: number) => any;
  BRepPrimAPI_MakeCylinder: new (radius: number, height: number) => any;
  BRepPrimAPI_MakeCone: new (r1: number, r2: number, height: number) => any;
  BRepPrimAPI_MakeTorus: new (r1: number, r2: number) => any;

  /* ========== 布尔运算 ========== */
  BRepAlgoAPI_Fuse: new (s1: any, s2: any) => any;
  BRepAlgoAPI_Cut: new (s1: any, s2: any) => any;
  BRepAlgoAPI_Common: new (s1: any, s2: any) => any;
  /** 截面/交线运算：计算两个 Shape 的精确交线 */
  BRepAlgoAPI_Section: new (s1: any, s2: any) => any;

  /* ========== 圆角/倒角 ========== */
  BRepFilletAPI_MakeFillet: new (shape: any) => any;
  BRepFilletAPI_MakeChamfer: new (shape: any) => any;

  /* ========== 变换 ========== */
  gp_Trsf: new () => any;
  gp_Pnt: new (x: number, y: number, z: number) => any;
  gp_Vec: new (x: number, y: number, z: number) => any;
  gp_Dir: new (x: number, y: number, z: number) => any;
  gp_Ax1: new (pnt: any, dir: any) => any;
  gp_Ax2: new (pnt: any, dir: any) => any;
  BRepBuilderAPI_Transform: new (shape: any, trsf: any, copy: boolean) => any;

  /* ========== 三角化（网格化） ========== */
  BRepMesh_IncrementalMesh: new (shape: any, deflection: number) => any;

  /* ========== 拓扑遍历 ========== */
  TopExp_Explorer: new (shape: any, type: any) => any;
  TopAbs_ShapeEnum: {
    TopAbs_FACE: any;
    TopAbs_EDGE: any;
    TopAbs_VERTEX: any;
    TopAbs_WIRE: any;
  };

  /* ========== 曲线适配器（Edge → 3D 曲线） ========== */
  /** 将 TopoDS_Edge 适配为可采样的 3D 曲线 */
  BRepAdaptor_Curve: new (edge: any) => any;

  /* ========== STEP 文件读写 ========== */
  STEPControl_Reader: new () => any;
  STEPControl_Writer: new () => any;

  /* ========== 虚拟文件系统 ========== */
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
  };

  /* ========== 工具方法 ========== */
  BRep_Tool: {
    Triangulation: (face: any, location: any) => any;
    /** 从 Edge 提取参数化 3D 曲线，返回 [Handle_Geom_Curve, first, last] */
    Curve: (edge: any, first: any, last: any) => any;
  };
  TopLoc_Location: new () => any;
  TopoDS: {
    Face: (shape: any) => any;
    Edge: (shape: any) => any;
  };
}

/**
 * 三角化网格数据
 * 从 OCCT Shape 提取的用于 Three.js 渲染的数据
 */
export interface OcctMeshData {
  /** 顶点坐标（flat array：[x0,y0,z0, x1,y1,z1, ...]） */
  vertices: Float32Array;
  /** 法线向量（flat array：[nx0,ny0,nz0, ...]） */
  normals: Float32Array;
  /** 三角形索引 */
  indices: Uint32Array;
}

/**
 * OCCT 初始化状态
 */
export type OcctInitStatus = 'idle' | 'loading' | 'ready' | 'error';
