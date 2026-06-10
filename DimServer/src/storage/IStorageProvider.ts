/**
 * 存储提供者抽象接口
 * 定义统一的文件存储操作，支持本地/火山引擎 TOS/AWS S3 等多种后端
 */

import type { Readable } from 'node:stream';
import type { FileMetadata, FileInfo } from 'dim-shared';

/**
 * 存储提供者接口
 * 所有存储后端实现必须遵循此接口
 */
export interface IStorageProvider {
  /**
   * 上传文件
   * @param key - 存储 key（路径）
   * @param data - 文件数据（Buffer 或可读流）
   * @param metadata - 文件元数据
   * @returns 上传后的访问 URL
   */
  upload(key: string, data: Buffer | Readable, metadata?: FileMetadata): Promise<string>;

  /**
   * 下载文件
   * @param key - 存储 key
   * @returns 可读流
   */
  download(key: string): Promise<Readable>;

  /**
   * 删除文件
   * @param key - 存储 key
   */
  delete(key: string): Promise<void>;

  /**
   * 获取签名 URL（临时访问链接）
   * @param key - 存储 key
   * @param expiresIn - 过期时间（秒），默认 3600
   * @returns 签名后的 URL
   */
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;

  /**
   * 列举文件
   * @param prefix - key 前缀筛选
   * @returns 文件信息列表
   */
  list(prefix: string): Promise<Array<FileInfo>>;

  /**
   * 检查文件是否存在
   * @param key - 存储 key
   */
  exists(key: string): Promise<boolean>;
}
