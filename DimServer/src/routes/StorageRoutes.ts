/**
 * 存储管理 API 路由
 * 提供文件上传、下载、删除、列举等接口
 */

import type { FastifyInstance } from 'fastify';
import type { ApiResponse, UploadResponse, FileInfo } from 'dim-shared';
import { v4 as uuidv4 } from 'uuid';

/**
 * 注册存储路由
 * @param server - Fastify 实例
 */
export async function registerStorageRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /api/storage/upload — 上传文件（mock）
   * 实际实现中将通过 IStorageProvider 写入本地/TOS
   */
  server.post('/api/storage/upload', async () => {
    const key: string = `uploads/${uuidv4()}`;
    const response: ApiResponse<UploadResponse> = {
      success: true,
      data: { key, url: null, size: 0 },
      error: null,
      timestamp: Date.now(),
    };
    return response;
  });

  /**
   * GET /api/storage/list — 列举文件（mock）
   */
  server.get('/api/storage/list', async () => {
    const response: ApiResponse<Array<FileInfo>> = {
      success: true,
      data: [],
      error: null,
      timestamp: Date.now(),
    };
    return response;
  });

  /**
   * DELETE /api/storage/:key — 删除文件（mock）
   */
  server.delete<{ Params: { key: string } }>('/api/storage/:key', async (request) => {
    const fileKey: string = request.params.key;
    const response: ApiResponse<{ key: string; deleted: boolean }> = {
      success: true,
      data: { key: fileKey, deleted: true },
      error: null,
      timestamp: Date.now(),
    };
    return response;
  });
}
