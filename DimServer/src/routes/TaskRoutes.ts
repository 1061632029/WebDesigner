/**
 * 任务管理 API 路由
 * 提供任务状态查询、取消等接口
 */

import type { FastifyInstance } from 'fastify';
import type { ApiResponse, TaskInfo } from 'dim-shared';

/**
 * 注册任务管理路由
 * @param server - Fastify 实例
 */
export async function registerTaskRoutes(server: FastifyInstance): Promise<void> {
  /**
   * GET /api/tasks/:id — 查询任务状态（mock）
   */
  server.get<{ Params: { id: string } }>('/api/tasks/:id', async (request) => {
    const taskId: string = request.params.id;
    const response: ApiResponse<TaskInfo> = {
      success: true,
      data: {
        id: taskId,
        type: 'cad-parse',
        status: 'pending',
        progress: 0,
        createdAt: Date.now(),
        startedAt: null,
        completedAt: null,
        resultKey: null,
        errorMessage: null,
      },
      error: null,
      timestamp: Date.now(),
    };
    return response;
  });

  /**
   * DELETE /api/tasks/:id — 取消任务（mock）
   */
  server.delete<{ Params: { id: string } }>('/api/tasks/:id', async (request) => {
    const taskId: string = request.params.id;
    const response: ApiResponse<{ taskId: string; cancelled: boolean }> = {
      success: true,
      data: { taskId, cancelled: true },
      error: null,
      timestamp: Date.now(),
    };
    return response;
  });
}
