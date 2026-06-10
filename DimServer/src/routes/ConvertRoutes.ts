/**
 * 模型转码 API 路由
 * 提供格式转换、Draco 压缩、LOD 生成等接口
 */

import type { FastifyInstance } from 'fastify';
import type { ApiResponse, ConvertResponse } from 'dim-shared';
import { v4 as uuidv4 } from 'uuid';

/**
 * 注册模型转码路由
 * @param server - Fastify 实例
 */
export async function registerConvertRoutes(server: FastifyInstance): Promise<void> {
  /** POST /api/convert/to-gltf — 转换为 GLTF/GLB 格式（mock） */
  server.post('/api/convert/to-gltf', async () => {
    const taskId: string = uuidv4();
    const response: ApiResponse<ConvertResponse> = {
      success: true,
      data: { taskId, resultKey: null },
      error: null,
      timestamp: Date.now(),
    };
    return response;
  });

  /** POST /api/convert/to-step — 转换为 STEP 格式（mock） */
  server.post('/api/convert/to-step', async () => {
    const taskId: string = uuidv4();
    const response: ApiResponse<ConvertResponse> = {
      success: true,
      data: { taskId, resultKey: null },
      error: null,
      timestamp: Date.now(),
    };
    return response;
  });

  /** POST /api/convert/compress — Draco 压缩（mock） */
  server.post('/api/convert/compress', async () => {
    const taskId: string = uuidv4();
    const response: ApiResponse<ConvertResponse> = {
      success: true,
      data: { taskId, resultKey: null },
      error: null,
      timestamp: Date.now(),
    };
    return response;
  });

  /** POST /api/convert/lod — LOD 层级生成（mock） */
  server.post('/api/convert/lod', async () => {
    const taskId: string = uuidv4();
    const response: ApiResponse<ConvertResponse> = {
      success: true,
      data: { taskId, resultKey: null },
      error: null,
      timestamp: Date.now(),
    };
    return response;
  });
}
