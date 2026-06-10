/**
 * DimServer — Fastify 服务入口
 * 启动 HTTP 服务，注册路由、CORS、WebSocket 等插件
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getServerConfig } from './config/ServerConfig.js';
import { registerCadRoutes } from './routes/CadRoutes.js';
import { registerConvertRoutes } from './routes/ConvertRoutes.js';
import { registerParametricRoutes } from './routes/ParametricRoutes.js';
import { registerTaskRoutes } from './routes/TaskRoutes.js';
import { registerStorageRoutes } from './routes/StorageRoutes.js';

/**
 * 启动服务器主函数
 */
async function startServer(): Promise<void> {
  const config = getServerConfig();

  /* 创建 Fastify 实例 */
  const server = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    },
  });

  /* 注册 CORS 插件 */
  await server.register(cors, {
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  /* 注册健康检查路由 */
  server.get('/api/health', async (_request, _reply) => {
    return { status: 'ok', timestamp: Date.now(), version: '0.2.0' };
  });

  /* 注册各模块路由 */
  await registerCadRoutes(server);
  await registerConvertRoutes(server);
  await registerParametricRoutes(server);
  await registerTaskRoutes(server);
  await registerStorageRoutes(server);

  /* 启动服务器 */
  try {
    const address: string = await server.listen({
      port: config.port,
      host: config.host,
    });
    server.log.info(`🚀 DimServer 已启动: ${address}`);
  } catch (err: unknown) {
    server.log.error(err);
    process.exit(1);
  }
}

startServer();
