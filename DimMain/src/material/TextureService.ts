/**
 * 纹理加载与缓存服务
 * 负责纹理图片的异步加载、缓存管理和应用到材质面
 */

import * as THREE from 'three/webgpu';
import type { TexturePreset, TextureProvider } from './TexturePresets';

/**
 * 面级别纹理应用结果
 */
export interface FaceTextureApplyResult {
  /** 是否成功 */
  success: boolean;
  /** 错误信息（失败时） */
  error?: string;
}

/**
 * 纹理加载与缓存服务
 * 使用 TextureLoader 加载纹理图片，内部维护 LRU 缓存避免重复加载
 */
export class TextureService {
  /** 纹理缓存（key = textureUrl） */
  private _cache: Map<string, THREE.Texture> = new Map();
  /** Three.js 纹理加载器 */
  private _loader: THREE.TextureLoader = new THREE.TextureLoader();
  /** 纹理资源提供者 */
  private _provider: TextureProvider;
  /** 缓存容量上限 */
  private _maxCacheSize: number;

  /**
   * @param provider - 纹理资源提供者（本地或远程）
   * @param maxCacheSize - 缓存容量上限，默认 50
   */
  constructor(provider: TextureProvider, maxCacheSize: number = 50) {
    this._provider = provider;
    this._maxCacheSize = maxCacheSize;
  }

  /**
   * 获取纹理提供者
   */
  public get provider(): TextureProvider {
    return this._provider;
  }

  /**
   * 切换纹理提供者（如从本地切换到火山云）
   * @param provider - 新的纹理资源提供者
   */
  public setProvider(provider: TextureProvider): void {
    this._provider = provider;
  }

  /**
   * 异步加载纹理
   * 优先从缓存获取，缓存未命中时通过 TextureLoader 加载
   * @param textureUrl - 纹理贴图 URL
   * @param uvScale - UV 缩放倍率
   * @returns Three.js Texture 实例
   */
  public async loadTexture(textureUrl: string, uvScale: number = 1.0): Promise<THREE.Texture> {
    /* 缓存命中 */
    const cached: THREE.Texture | undefined = this._cache.get(textureUrl);
    if (cached !== undefined) {
      return cached;
    }

    /* 异步加载纹理图片 */
    const texture: THREE.Texture = await new Promise<THREE.Texture>(
      (resolve: (value: THREE.Texture) => void, reject: (reason: Error) => void): void => {
        this._loader.load(
          textureUrl,
          (tex: THREE.Texture): void => resolve(tex),
          undefined,
          (): void => reject(new Error(`纹理加载失败: ${textureUrl}`))
        );
      }
    );

    /* 设置纹理参数 */
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(uvScale, uvScale);
    texture.colorSpace = THREE.SRGBColorSpace;

    /* 缓存管理：超过上限时移除最早的条目 */
    if (this._cache.size >= this._maxCacheSize) {
      const firstKey: string = this._cache.keys().next().value!;
      const firstTexture: THREE.Texture | undefined = this._cache.get(firstKey);
      if (firstTexture !== undefined) {
        firstTexture.dispose();
      }
      this._cache.delete(firstKey);
    }

    this._cache.set(textureUrl, texture);
    return texture;
  }

  /**
   * 根据预设 ID 加载纹理
   * @param presetId - 纹理预设 ID
   * @param presets - 预设列表（用于查找 uvScale）
   * @returns Three.js Texture 实例
   */
  public async loadByPresetId(presetId: string, presets: Array<TexturePreset>): Promise<THREE.Texture> {
    const preset: TexturePreset | undefined = presets.find(
      (p: TexturePreset): boolean => p.id === presetId
    );
    if (preset === undefined) {
      throw new Error(`纹理预设不存在: ${presetId}`);
    }

    const textureUrl: string = await this._provider.getTextureUrl(presetId);
    return this.loadTexture(textureUrl, preset.uvScale);
  }

  /**
   * 将纹理应用到 Mesh 的指定面（materialIndex）
   * 要求 Mesh 使用材质数组 + Geometry 已设置 Material Groups
   * @param mesh - 目标 Mesh
   * @param materialIndex - 面的材质索引
   * @param texture - Three.js Texture 实例
   * @returns 应用结果
   */
  public applyTextureToFace(
    mesh: THREE.Mesh,
    materialIndex: number,
    texture: THREE.Texture
  ): FaceTextureApplyResult {
    /* 确保 Mesh 使用材质数组 */
    if (!Array.isArray(mesh.material)) {
      return { success: false, error: 'Mesh 未使用材质数组，无法应用面级纹理' };
    }

    const materials: Array<THREE.Material> = mesh.material as Array<THREE.Material>;
    if (materialIndex < 0 || materialIndex >= materials.length) {
      return { success: false, error: `materialIndex ${materialIndex} 超出范围 [0, ${materials.length - 1}]` };
    }

    /* 获取目标面的材质 */
    const faceMaterial: THREE.Material = materials[materialIndex]!;

    /* 检查材质是否支持 map 属性 */
    if (faceMaterial instanceof THREE.MeshStandardMaterial || faceMaterial instanceof THREE.MeshBasicMaterial) {
      faceMaterial.map = texture;
      faceMaterial.needsUpdate = true;
      return { success: true };
    }

    return { success: false, error: `材质类型 ${faceMaterial.type} 不支持纹理贴图` };
  }

  /**
   * 清空纹理缓存，释放所有纹理 GPU 资源
   */
  public clearCache(): void {
    this._cache.forEach((texture: THREE.Texture): void => {
      texture.dispose();
    });
    this._cache.clear();
  }

  /**
   * 销毁服务，释放所有资源
   */
  public dispose(): void {
    this.clearCache();
  }
}
