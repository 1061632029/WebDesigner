/**
 * opencascade.js 模块声明
 * 该库无内置 TypeScript 类型，使用自定义类型覆盖
 */
declare module 'opencascade.js' {
  const initOpenCascade: () => Promise<any>;
  export default initOpenCascade;
}

/**
 * Three.js WebGPU 模块类型声明
 * three/webgpu 导出了完整的 Three.js 核心 + WebGPU 节点材质系统
 * 重导出所有 three 核心类型，并额外声明 WebGPURenderer
 */
declare module 'three/webgpu' {
  /* 重导出 three 核心的所有导出 */
  export * from 'three';

  import { Scene, Camera, Vector2 } from 'three';

  /**
   * WebGPU 渲染器类
   * 使用 WebGPU API 进行三维场景渲染
   * 内置 NodeLibrary 使传统材质（MeshStandardMaterial 等）自动转换为节点材质
   */
  export class WebGPURenderer {
    /** 渲染器的 canvas DOM 元素 */
    public domElement: HTMLCanvasElement;

    constructor(parameters?: {
      canvas?: HTMLCanvasElement;
      antialias?: boolean;
      alpha?: boolean;
      stencil?: boolean;
      depth?: boolean;
      powerPreference?: string;
      forceWebGL?: boolean;
    });

    /** 异步初始化渲染器 */
    init(): Promise<void>;

    /** 渲染场景 */
    render(scene: Scene, camera: Camera): void;

    /** 设置渲染器输出尺寸 */
    setSize(width: number, height: number): void;

    /** 设置设备像素比 */
    setPixelRatio(value: number): void;

    /** 获取渲染器当前尺寸 */
    getSize(target: Vector2): Vector2;

    /** 销毁渲染器 */
    dispose(): void;
  }
}

/**
 * Three.js WebGPU 源码路径类型声明
 */
declare module 'three/src/renderers/webgpu/WebGPURenderer.js' {
  import { Scene, Camera, Vector2 } from 'three';

  export default class WebGPURenderer {
    public domElement: HTMLCanvasElement;

    constructor(parameters?: {
      canvas?: HTMLCanvasElement;
      antialias?: boolean;
      alpha?: boolean;
    });

    init(): Promise<void>;
    render(scene: Scene, camera: Camera): void;
    setSize(width: number, height: number): void;
    setPixelRatio(value: number): void;
    getSize(target: Vector2): Vector2;
    dispose(): void;
  }
}
