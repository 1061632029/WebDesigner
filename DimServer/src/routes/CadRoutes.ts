/**
 * CAD 图形处理 API 路由
 * 提供 CAD 文件解析、布尔运算、导出等接口
 */

import type { FastifyInstance } from 'fastify';
import type { ApiResponse, CadParseResponse, CadBooleanResponse } from 'dim-shared';
import { v4 as uuidv4 } from 'uuid';

/**
 * 注册 CAD 路由
 * @param server - Fastify 实例
 */
export async function registerCadRoutes(server: FastifyInstance): Promise<void> {
  /**
   * POST /api/cad/parse — 上传并解析 CAD 文件
   * 当前为 mock 实现，返回模拟任务 ID
   */
  server.post('/api/cad/parse', async (_request, _reply) => {
    const taskId: string = uuidv4();
    const response: ApiResponse<CadParseResponse> = {
      success: true,
      data: { taskId, geometryKey: null },
      error: null,
      timestamp: Date.now(),
    };
    return response;
  });

  /**
   * POST /api/cad/boolean — 布尔运算
   * 当前为 mock 实现
   */
  server.post('/api/cad/boolean', async (_request, _reply) => {
    const taskId: string = uuidv4();
    const response: ApiResponse<CadBooleanResponse> = {
      success: true,
      data: { taskId, resultKey: null },
      error: null,
      timestamp: Date.now(),
    };
    return response;
  });

  /**
   * POST /api/cad/export — 导出 CAD 文件
   * 当前为 mock 实现
   */
  server.post('/api/cad/export', async (_request, _reply) => {
    const taskId: string = uuidv4();
    const response: ApiResponse<{ taskId: string }> = {
      success: true,
      data: { taskId },
      error: null,
      timestamp: Date.now(),
    };
    return response;
  });
}
