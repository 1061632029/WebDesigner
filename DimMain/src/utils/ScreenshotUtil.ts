/**
 * 截图工具
 * 对 WebGPU 渲染器的当前帧进行高清截图，并触发浏览器下载
 *
 * 高清原理：
 * - 截图前临时将像素比提升为 devicePixelRatio * 2（2倍超采样）
 * - 截图后恢复原始像素比，避免影响正常渲染性能
 *
 * 注意：WebGPU renderer 需要在 init 时传入 preserveDrawingBuffer: true，
 * 否则 toDataURL 会返回空白图像（WebGPU 默认不保留帧缓冲）
 */

import type { WebGPURenderer } from 'three/webgpu';

/**
 * 截图配置选项
 */
export interface ScreenshotOptions {
  /** 图片格式，默认 'image/png' */
  format?: string;
  /** 图片质量（仅 jpeg 有效，0-1），默认 0.95 */
  quality?: number;
  /** 下载文件名（不含扩展名），默认 'screenshot' */
  filename?: string;
  /** 超采样倍率（相对于 devicePixelRatio），默认 2 */
  supersample?: number;
}

/**
 * 对 WebGPU 渲染器执行高清截图并触发浏览器下载
 *
 * @param renderer - WebGPU 渲染器实例
 * @param options - 截图配置选项
 */
export function takeScreenshot(
  renderer: WebGPURenderer,
  options: ScreenshotOptions = {}
): void {
  const format: string = options.format ?? 'image/png';
  const quality: number = options.quality ?? 0.95;
  const filename: string = options.filename ?? 'screenshot';
  const supersample: number = options.supersample ?? 2;

  /* 记录原始像素比（以 devicePixelRatio 为基准），截图后恢复 */
  const originalPixelRatio: number = window.devicePixelRatio;

  /* 提升像素比实现超采样高清截图 */
  renderer.setPixelRatio(originalPixelRatio * supersample);

  /* 从 canvas 获取图像数据 URL */
  const canvas: HTMLCanvasElement = renderer.domElement;
  const dataUrl: string = canvas.toDataURL(format, quality);

  /* 恢复原始像素比，避免影响后续渲染性能 */
  renderer.setPixelRatio(originalPixelRatio);

  /* 根据格式确定文件扩展名 */
  const ext: string = format === 'image/jpeg' ? 'jpg' : 'png';

  /* 创建隐藏的 <a> 标签触发浏览器下载 */
  const link: HTMLAnchorElement = document.createElement('a');
  link.href = dataUrl;
  link.download = `${filename}.${ext}`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  console.log(`📸 截图已下载：${filename}.${ext}`);
}
