/**
 * 参数化建模 API 路由
 * 提供参数化几何体生成、参数更新、批量计算等接口
 */

import type { FastifyInstance } from 'fastify';
import type { ApiResponse, ParametricGenerateResponse } from 'dim-shared';
import { v4 as uuidv4 } from 'uuid';

/**
 * 注册参数化路由
 * @param server - Fastify 实例
 */
export async function registerParametricRoutes(server: FastifyInstance): Promise<void> {
  /** POST /api/parametric/generate — 参数化生成几何体（mock） */
  server.post('/api/parametric/generate', async () => {
    const taskId: string = uuidv4();
    const response: ApiResponse<ParametricGenerateResponse> = {
      success: true,
      data: { taskId, geometryKey: null },
      error: null,
      timestamp: Date.now(),
    };
    return response;
  });

  /** POST /api/parametric/update — 参数更新重算（mock） */
  server.post('/api/parametric/update', async () => {
    const taskId: string = uuidv4();
    const response: ApiResponse<ParametricGenerateResponse> = {
      success: true,
      data: { taskId, geometryKey: null },
      error: null,
      timestamp: Date.now(),
    };
    return response;
  });

  /** POST /api/parametric/batch — 批量参数化计算（mock） */
  server.post('/api/parametric/batch', async () => {
    const taskId: string = uuidv4();
    const response: ApiResponse<{ taskId: string; count: number }> = {
      success: true,
      data: { taskId, count: 0 },
      error: null,
      timestamp: Date.now(),
    };
    return response;
  });
}
