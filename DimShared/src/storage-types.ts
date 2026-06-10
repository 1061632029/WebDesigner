/**
 * 存储相关类型定义
 * 前后端共享的文件存储数据结构
 */

/**
 * 文件元数据
 */
export interface FileMetadata {
  /** 原始文件名 */
  originalName: string;
  /** MIME 类型 */
  mimeType: string;
  /** 文件大小（字节） */
  size: number;
  /** 自定义标签 */
  tags?: Record<string, string>;
}

/**
 * 文件信息（列表查询结果）
 */
export interface FileInfo {
  /** 存储 key */
  key: string;
  /** 文件大小（字节） */
  size: number;
  /** 最后修改时间 */
  lastModified: number;
  /** MIME 类型 */
  mimeType: string;
}

/**
 * 文件上传响应
 */
export interface UploadResponse {
  /** 存储 key */
  key: string;
  /** 公开访问 URL（如有） */
  url: string | null;
  /** 文件大小 */
  size: number;
}

/**
 * 签名 URL 响应
 */
export interface SignedUrlResponse {
  /** 签名后的访问 URL */
  url: string;
  /** 过期时间戳 */
  expiresAt: number;
}

/**
 * 存储提供者类型
 */
export type StorageProviderType = 'local' | 'volcengine-tos' | 'aws-s3';
