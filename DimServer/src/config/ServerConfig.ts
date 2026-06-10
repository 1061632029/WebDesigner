/**
 * 服务器配置
 * 集中管理所有服务端配置项
 */

import type { StorageProviderType } from 'dim-shared';

/**
 * 服务器配置接口
 */
export interface ServerConfigOptions {
  /** HTTP 端口 */
  port: number;
  /** 监听地址 */
  host: string;
  /** CORS 允许的源 */
  corsOrigin: string | Array<string>;
  /** 存储提供者类型 */
  storageProvider: StorageProviderType;
  /** 本地存储路径 */
  localStoragePath: string;
  /** 火山引擎 TOS 配置（生产环境） */
  tos?: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    bucket: string;
    endpoint: string;
  };
}

/**
 * 获取服务器配置
 * 优先读取环境变量，回退到默认值
 */
export function getServerConfig(): ServerConfigOptions {
  const config: ServerConfigOptions = {
    port: parseInt(process.env['DIM_PORT'] ?? '3001', 10),
    host: process.env['DIM_HOST'] ?? '0.0.0.0',
    corsOrigin: process.env['DIM_CORS_ORIGIN'] ?? 'http://localhost:5173',
    storageProvider: (process.env['DIM_STORAGE_PROVIDER'] as StorageProviderType) ?? 'local',
    localStoragePath: process.env['DIM_LOCAL_STORAGE_PATH'] ?? './uploads',
  };

  /* 火山引擎 TOS 配置（仅在 storageProvider 为 volcengine-tos 时需要） */
  if (config.storageProvider === 'volcengine-tos') {
    config.tos = {
      accessKeyId: process.env['TOS_ACCESS_KEY_ID'] ?? '',
      secretAccessKey: process.env['TOS_SECRET_ACCESS_KEY'] ?? '',
      region: process.env['TOS_REGION'] ?? 'cn-beijing',
      bucket: process.env['TOS_BUCKET'] ?? 'dim-3d-assets',
      endpoint: process.env['TOS_ENDPOINT'] ?? 'tos-cn-beijing.volces.com',
    };
  }

  return config;
}
