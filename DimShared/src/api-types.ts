/**
 * API 请求/响应类型定义
 * 前后端共享的 REST API 数据结构
 */

/* ========== 通用响应结构 ========== */

/**
 * API 统一响应包装
 */
export interface ApiResponse<T> {
  /** 是否成功 */
  success: boolean;
  /** 响应数据 */
  data: T | null;
  /** 错误信息（失败时） */
  error: string | null;
  /** 请求时间戳 */
  timestamp: number;
}

/**
 * 分页请求参数
 */
export interface PaginationParams {
  /** 页码（从 1 开始） */
  page: number;
  /** 每页数量 */
  pageSize: number;
}

/**
 * 分页响应数据
 */
export interface PaginatedData<T> {
  /** 数据列表 */
  items: Array<T>;
  /** 总数量 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
}

/* ========== CAD 处理接口 ========== */

/**
 * CAD 文件解析请求
 */
export interface CadParseRequest {
  /** 文件存储 key（已上传到存储） */
  fileKey: string;
  /** 文件格式 */
  format: CadFileFormat;
}

/**
 * 支持的 CAD 文件格式
 */
export type CadFileFormat = 'step' | 'stp' | 'dxf' | 'dwg' | 'iges' | 'igs';

/**
 * CAD 文件解析响应
 */
export interface CadParseResponse {
  /** 任务 ID */
  taskId: string;
  /** 解析后的几何体数据 key */
  geometryKey: string | null;
}

/**
 * 布尔运算请求
 */
export interface CadBooleanRequest {
  /** 操作类型 */
  operation: BooleanOperation;
  /** 主体几何数据 key */
  bodyKey: string;
  /** 工具几何数据 key */
  toolKey: string;
}

/**
 * 布尔运算类型
 */
export type BooleanOperation = 'union' | 'subtract' | 'intersect';

/**
 * 布尔运算响应
 */
export interface CadBooleanResponse {
  /** 任务 ID */
  taskId: string;
  /** 运算结果几何数据 key */
  resultKey: string | null;
}

/**
 * CAD 导出请求
 */
export interface CadExportRequest {
  /** 源几何数据 key */
  geometryKey: string;
  /** 目标格式 */
  targetFormat: CadFileFormat;
}

/* ========== 参数化建模接口 ========== */

/**
 * 参数化生成请求
 */
export interface ParametricGenerateRequest {
  /** 模板 ID */
  templateId: string;
  /** 参数键值对 */
  parameters: Record<string, number | string | boolean>;
}

/**
 * 参数化生成响应
 */
export interface ParametricGenerateResponse {
  /** 任务 ID */
  taskId: string;
  /** 生成的几何体数据 key */
  geometryKey: string | null;
}

/**
 * 参数化更新请求
 */
export interface ParametricUpdateRequest {
  /** 现有几何体数据 key */
  geometryKey: string;
  /** 更新后的参数 */
  parameters: Record<string, number | string | boolean>;
}

/* ========== 模型转码接口 ========== */

/**
 * 模型转码请求
 */
export interface ConvertRequest {
  /** 源文件存储 key */
  sourceKey: string;
  /** 源格式 */
  sourceFormat: ModelFormat;
  /** 目标格式 */
  targetFormat: ModelFormat;
  /** 转码选项 */
  options?: ConvertOptions;
}

/**
 * 支持的模型格式
 */
export type ModelFormat = 'gltf' | 'glb' | 'obj' | 'fbx' | 'step' | 'stl' | 'ply' | 'dae';

/**
 * 转码选项
 */
export interface ConvertOptions {
  /** 是否启用 Draco 压缩 */
  draco?: boolean;
  /** 是否生成 LOD 层级 */
  generateLod?: boolean;
  /** LOD 层级数 */
  lodLevels?: number;
  /** 目标三角面数（简化用） */
  targetTriangles?: number;
}

/**
 * 模型转码响应
 */
export interface ConvertResponse {
  /** 任务 ID */
  taskId: string;
  /** 转码后文件 key */
  resultKey: string | null;
}
