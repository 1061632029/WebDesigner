import React, { useEffect, useRef, useState } from 'react';
import { Engine } from '../../core/Engine';
import { EngineContext, EngineContextValue } from '../context/EngineContext';

/**
 * Canvas 组件属性接口
 */
export interface CanvasProps {
  /** 子组件（场景内容） */
  children?: React.ReactNode;
  /** 容器样式 */
  style?: React.CSSProperties;
  /** 引擎初始化失败时的回调 */
  onError?: (error: Error) => void;
  /** 引擎就绪时的回调 */
  onReady?: (engine: Engine) => void;
}

/**
 * Canvas 根组件
 * 三维场景的根容器，负责初始化引擎实例、创建 WebGPURenderer、
 * 启动渲染循环，并通过 React Context 向子组件提供引擎实例
 */
export function Canvas(props: CanvasProps): React.ReactElement {
  const containerRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null!);
  const engineRef: React.MutableRefObject<Engine | null> = useRef<Engine | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect((): (() => void) => {
    const container: HTMLDivElement | null = containerRef.current;
    if (!container) {
      return (): void => {};
    }

    let disposed: boolean = false;

    /* 异步初始化引擎 */
    const initEngine = async (): Promise<void> => {
      try {
        const engine: Engine = new Engine({ container });

        await engine.init();

        /* React StrictMode 下 useEffect 会双重调用，检查是否已被清理 */
        if (disposed) {
          engine.dispose();
          return;
        }

        engineRef.current = engine;
        engine.start();

        setIsReady(true);

        if (props.onReady) {
          props.onReady(engine);
        }
      } catch (err: unknown) {
        const engineError: Error = err instanceof Error ? err : new Error(String(err));
        console.error('[Dim Engine] 初始化失败:', engineError);
        if (!disposed) {
          setError(engineError);
          if (props.onError) {
            props.onError(engineError);
          }
        }
      }
    };

    initEngine();

    /* 组件卸载时销毁引擎 */
    return (): void => {
      disposed = true;
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
      setIsReady(false);
    };
  }, []);

  /* WebGPU 不支持时的错误提示 */
  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          backgroundColor: '#1a1a2e',
          color: '#e94560',
          fontFamily: 'sans-serif',
          padding: '20px',
          textAlign: 'center',
          ...props.style,
        }}
      >
        <div>
          <h2 style={{ marginBottom: '12px' }}>⚠️ WebGPU 不可用</h2>
          <p style={{ color: '#eee', lineHeight: 1.6 }}>{error.message}</p>
        </div>
      </div>
    );
  }

  /* 构建 Context 值 */
  const contextValue: EngineContextValue | null =
    isReady && engineRef.current ? { engine: engineRef.current } : null;

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        ...props.style,
      }}
    >
      {/* 加载中状态提示 */}
      {!isReady && !error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            backgroundColor: '#1a1a2e',
            color: '#eee',
            fontFamily: 'sans-serif',
            position: 'absolute',
            top: 0,
            left: 0,
            zIndex: 10,
          }}
        >
          <p>⏳ 正在初始化 WebGPU 引擎...</p>
        </div>
      )}
      {contextValue && (
        <EngineContext.Provider value={contextValue}>
          {props.children}
        </EngineContext.Provider>
      )}
    </div>
  );
}
