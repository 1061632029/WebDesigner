import { useContext } from 'react';
import { EngineContext, EngineContextValue } from '../context/EngineContext';
import { Engine } from '../../core/Engine';

/**
 * 自定义 Hook：获取当前引擎实例
 * 必须在 <Canvas> 组件树内调用，否则抛出错误
 * @returns 引擎实例
 */
export function useEngine(): Engine {
  const contextValue: EngineContextValue | null = useContext(EngineContext);

  if (!contextValue) {
    throw new Error(
      'useEngine 必须在 <Canvas> 组件内使用。请确保组件位于 Canvas 组件树中。'
    );
  }

  return contextValue.engine;
}
