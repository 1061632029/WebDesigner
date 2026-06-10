import React from 'react';
import { Engine } from '../../core/Engine';

/**
 * 引擎上下文类型定义
 * 包含引擎实例的引用，允许子组件访问引擎核心功能
 */
export interface EngineContextValue {
  /** 引擎实例 */
  engine: Engine;
}

/**
 * React Context，用于向组件树传递引擎实例
 * 默认值为 null，仅在 Canvas 组件内才有有效值
 */
export const EngineContext: React.Context<EngineContextValue | null> =
  React.createContext<EngineContextValue | null>(null);
