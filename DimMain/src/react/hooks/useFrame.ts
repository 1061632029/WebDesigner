import { useEffect, useRef } from 'react';
import { useEngine } from './useEngine';
import { FrameCallback } from '../../core/Engine';

/**
 * 自定义 Hook：注册帧回调函数
 * 回调在每帧渲染前被调用，组件卸载时自动注销
 * 必须在 <Canvas> 组件树内调用
 * @param callback - 帧回调函数，接收 deltaTime 和 elapsedTime
 */
export function useFrame(callback: FrameCallback): void {
  const engine = useEngine();
  const callbackRef: React.MutableRefObject<FrameCallback> = useRef<FrameCallback>(callback);

  /* 始终保持回调引用为最新 */
  callbackRef.current = callback;

  useEffect((): (() => void) => {
    /* 注册一个包装回调，内部引用最新的用户回调 */
    const wrappedCallback: FrameCallback = (deltaTime: number, elapsedTime: number): void => {
      callbackRef.current(deltaTime, elapsedTime);
    };

    /* 注册帧回调，获取取消注册函数 */
    const unsubscribe: () => void = engine.onFrame(wrappedCallback);

    /* 组件卸载时自动注销帧回调 */
    return unsubscribe;
  }, [engine]);
}
