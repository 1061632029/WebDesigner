/**
 * 纹理预设数据定义
 * 定义预设纹理的数据结构和本地/远程资源提供者接口
 */

/* ========== 纹理预设数据结构 ========== */

/**
 * 单个纹理预设
 */
export interface TexturePreset {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 缩略图 URL（用于面板列表展示） */
  thumbnailUrl: string;
  /** 纹理贴图 URL（实际应用到材质的图片） */
  textureUrl: string;
  /** 纹理分类标签（如 "金属"、"木材"、"石材"） */
  category: string;
  /** UV 缩放倍率，默认 1.0（值越大纹理越密集） */
  uvScale: number;
}

/* ========== 纹理资源提供者接口（预留远程接入） ========== */

/**
 * 纹理资源提供者接口
 * 抽象纹理来源，支持本地文件和远程 CDN（如火山云）
 */
export interface TextureProvider {
  /** 获取可用纹理列表 */
  getTextureList(): Promise<Array<TexturePreset>>;
  /** 根据 ID 获取纹理贴图 URL（可能是 CDN 签名地址） */
  getTextureUrl(id: string): Promise<string>;
  /** 根据 ID 获取缩略图 URL */
  getThumbnailUrl(id: string): Promise<string>;
}

/* ========== 本地纹理提供者 ========== */

/**
 * 本地文件纹理提供者
 * 从 public/textures/ 目录加载纹理资源
 */
export class LocalTextureProvider implements TextureProvider {
  /** 预设纹理列表 */
  private _presets: Array<TexturePreset>;

  constructor(presets: Array<TexturePreset>) {
    this._presets = presets;
  }

  public async getTextureList(): Promise<Array<TexturePreset>> {
    return this._presets;
  }

  public async getTextureUrl(id: string): Promise<string> {
    const preset: TexturePreset | undefined = this._presets.find(
      (p: TexturePreset): boolean => p.id === id
    );
    if (preset === undefined) {
      throw new Error(`纹理预设不存在: ${id}`);
    }
    return preset.textureUrl;
  }

  public async getThumbnailUrl(id: string): Promise<string> {
    const preset: TexturePreset | undefined = this._presets.find(
      (p: TexturePreset): boolean => p.id === id
    );
    if (preset === undefined) {
      throw new Error(`纹理预设不存在: ${id}`);
    }
    return preset.thumbnailUrl;
  }
}

/* ========== 火山云纹理提供者（未来实现） ========== */

/**
 * 火山云纹理提供者（预留接口）
 * 未来通过火山云 API 获取纹理资源列表和签名 URL
 */
// export class VolcanoCloudTextureProvider implements TextureProvider {
//   private _apiEndpoint: string;
//   constructor(apiEndpoint: string) { this._apiEndpoint = apiEndpoint; }
//   public async getTextureList(): Promise<Array<TexturePreset>> { /* TODO */ }
//   public async getTextureUrl(id: string): Promise<string> { /* TODO */ }
//   public async getThumbnailUrl(id: string): Promise<string> { /* TODO */ }
// }

/* ========== 程序化纹理生成工具 ========== */

/**
 * 使用 Canvas 2D 生成程序化纹理的 data URL
 * 无需外部图片文件即可测试纹理管线
 */

/**
 * 生成纯色+噪点纹理
 * @param baseColor - CSS 颜色字符串
 * @param noiseAmount - 噪点强度（0~255）
 * @param size - 纹理尺寸（像素）
 * @returns data URL
 */
function generateSolidNoiseTexture(baseColor: string, noiseAmount: number, size: number = 128): string {
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx: CanvasRenderingContext2D = canvas.getContext('2d')!;

  /* 底色填充 */
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  /* 叠加随机噪点 */
  const imageData: ImageData = ctx.getImageData(0, 0, size, size);
  const data: Uint8ClampedArray = imageData.data;
  for (let i: number = 0; i < data.length; i += 4) {
    const noise: number = (Math.random() - 0.5) * noiseAmount;
    data[i] = Math.max(0, Math.min(255, data[i]! + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1]! + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2]! + noise));
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL('image/png');
}

/**
 * 生成棋盘格纹理
 * @param color1 - 第一颜色
 * @param color2 - 第二颜色
 * @param gridCount - 格子数量
 * @param size - 纹理尺寸
 * @returns data URL
 */
function generateCheckerTexture(color1: string, color2: string, gridCount: number = 8, size: number = 128): string {
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx: CanvasRenderingContext2D = canvas.getContext('2d')!;
  const cellSize: number = size / gridCount;

  for (let row: number = 0; row < gridCount; row++) {
    for (let col: number = 0; col < gridCount; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? color1 : color2;
      ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
    }
  }

  return canvas.toDataURL('image/png');
}

/**
 * 生成水平条纹纹理（模拟木纹）
 * @param baseColor - 底色
 * @param stripeColor - 条纹色
 * @param stripeCount - 条纹数量
 * @param size - 纹理尺寸
 * @returns data URL
 */
function generateStripeTexture(baseColor: string, stripeColor: string, stripeCount: number = 12, size: number = 128): string {
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx: CanvasRenderingContext2D = canvas.getContext('2d')!;

  /* 底色 */
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  /* 条纹 */
  ctx.fillStyle = stripeColor;
  const stripeHeight: number = size / (stripeCount * 2);
  for (let i: number = 0; i < stripeCount; i++) {
    const y: number = (i * 2 + 1) * stripeHeight + (Math.random() - 0.5) * stripeHeight * 0.3;
    ctx.fillRect(0, y, size, stripeHeight * 0.6);
  }

  return canvas.toDataURL('image/png');
}

/* ========== 默认本地预设 ========== */

/**
 * 默认预设纹理列表
 * 使用程序化生成的 data URL 纹理，无需外部图片文件
 * 将来可替换为 public/textures/ 或远程 CDN 的真实图片
 */
const metalTexture: string = generateSolidNoiseTexture('#8899aa', 40);
const woodTexture: string = generateStripeTexture('#b87333', '#9a5f2a', 14);
const glassTexture: string = generateSolidNoiseTexture('#aaddee', 15);
const plasticTexture: string = generateSolidNoiseTexture('#e8e8e8', 10);
const brickTexture: string = generateCheckerTexture('#b44422', '#993318', 6);
const marbleTexture: string = generateSolidNoiseTexture('#e8e0d8', 30);

export const DEFAULT_TEXTURE_PRESETS: Array<TexturePreset> = [
  {
    id: 'metal-brushed',
    name: '金属拉丝',
    thumbnailUrl: metalTexture,
    textureUrl: metalTexture,
    category: '金属',
    uvScale: 1.0,
  },
  {
    id: 'wood-oak',
    name: '橡木木纹',
    thumbnailUrl: woodTexture,
    textureUrl: woodTexture,
    category: '木材',
    uvScale: 1.0,
  },
  {
    id: 'glass-frosted',
    name: '磨砂玻璃',
    thumbnailUrl: glassTexture,
    textureUrl: glassTexture,
    category: '玻璃',
    uvScale: 1.0,
  },
  {
    id: 'plastic-white',
    name: '白色塑料',
    thumbnailUrl: plasticTexture,
    textureUrl: plasticTexture,
    category: '塑料',
    uvScale: 1.0,
  },
  {
    id: 'brick-red',
    name: '红砖',
    thumbnailUrl: brickTexture,
    textureUrl: brickTexture,
    category: '石材',
    uvScale: 2.0,
  },
  {
    id: 'marble-white',
    name: '大理石',
    thumbnailUrl: marbleTexture,
    textureUrl: marbleTexture,
    category: '石材',
    uvScale: 1.0,
  },
];

/**
 * 默认本地纹理提供者实例
 */
export const defaultTextureProvider: LocalTextureProvider = new LocalTextureProvider(
  DEFAULT_TEXTURE_PRESETS
);
