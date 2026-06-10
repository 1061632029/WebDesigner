/**
 * 任务状态类型定义
 * 前后端共享的异步任务管理数据结构
 */

/**
 * 任务状态枚举
 */
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

/**
 * 任务类型枚举
 */
export type TaskType = 'cad-parse' | 'cad-boolean' | 'cad-export' | 'parametric-generate' | 'parametric-update' | 'convert' | 'compress' | 'lod-generate';

/**
 * 任务信息
 */
export interface TaskInfo {
  /** 任务唯一 ID */
  id: string;
  /** 任务类型 */
  type: TaskType;
  /** 任务状态 */
  status: TaskStatus;
  /** 进度百分比（0-100） */
  progress: number;
  /** 任务创建时间戳 */
  createdAt: number;
  /** 任务开始处理时间戳 */
  startedAt: number | null;
  /** 任务完成时间戳 */
  completedAt: number | null;
  /** 结果数据 key（完成后） */
  resultKey: string | null;
  /** 错误信息（失败时） */
  errorMessage: string | null;
}

/**
 * 任务进度更新（WebSocket 推送）
 */
export interface TaskProgressEvent {
  /** 任务 ID */
  taskId: string;
  /** 当前状态 */
  status: TaskStatus;
  /** 进度百分比（0-100） */
  progress: number;
  /** 进度描述消息 */
  message: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * WebSocket 消息类型
 */
export type WsMessageType = 'task-progress' | 'task-completed' | 'task-failed' | 'server-status';

/**
 * WebSocket 消息包装
 */
export interface WsMessage<T> {
  /** 消息类型 */
  type: WsMessageType;
  /** 消息数据 */
  payload: T;
}
