/**
 * DimShared — 前后端共享类型统一导出
 */

/* API 请求/响应类型 */
export type {
  ApiResponse,
  PaginationParams,
  PaginatedData,
  CadParseRequest,
  CadFileFormat,
  CadParseResponse,
  CadBooleanRequest,
  BooleanOperation,
  CadBooleanResponse,
  CadExportRequest,
  ParametricGenerateRequest,
  ParametricGenerateResponse,
  ParametricUpdateRequest,
  ConvertRequest,
  ModelFormat,
  ConvertOptions,
  ConvertResponse,
} from './api-types';

/* 任务管理类型 */
export type {
  TaskStatus,
  TaskType,
  TaskInfo,
  TaskProgressEvent,
  WsMessageType,
  WsMessage,
} from './task-types';

/* 存储类型 */
export type {
  FileMetadata,
  FileInfo,
  UploadResponse,
  SignedUrlResponse,
  StorageProviderType,
} from './storage-types';
