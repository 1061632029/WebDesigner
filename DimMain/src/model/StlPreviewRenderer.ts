/**
 * STL 预览图渲染器
 * 使用离屏 Canvas + Three.js 渲染 STL 模型缩略图
 * 生成 base64 DataURL 供面板卡片显示
 */

import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

/** 缩略图尺寸（像素） */
const THUMB_SIZE: number = 128;

/** 缩略图缓存（URL → base64） */
const thumbnailCache: Map<string, string> = new Map();

/** STLLoader 实例（复用） */
const stlLoader: STLLoader = new STLLoader();

/**
 * 生成 STL 模型的预览缩略图
 * 使用标准 WebGL 渲染器（非 WebGPU）进行离屏渲染
 * @param stlUrl - STL 文件 URL
 * @returns base64 DataURL 字符串
 */
export async function generateStlThumbnail(stlUrl: string): Promise<string> {
  /* 检查缓存 */
  const cached: string | undefined = thumbnailCache.get(stlUrl);
  if (cached !== undefined) {
    return cached;
  }

  /* 加载 STL 几何体 */
  const geometry: THREE.BufferGeometry = await new Promise<THREE.BufferGeometry>((
    resolve: (value: THREE.BufferGeometry) => void,
    reject: (reason: Error) => void
  ): void => {
    stlLoader.load(
      stlUrl,
      (geom: THREE.BufferGeometry): void => resolve(geom),
      undefined,
      (error: unknown): void => reject(new Error(`STL 预览加载失败: ${stlUrl} - ${String(error)}`))
    );
  });

  /* 创建离屏 Canvas */
  const canvas: HTMLCanvasElement = document.createElement('canvas');
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;

  /* 创建 WebGL 渲染器（标准，非 WebGPU） */
  const renderer: THREE.WebGLRenderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setSize(THUMB_SIZE, THUMB_SIZE);
  renderer.setClearColor(0x2a2a3a, 1);

  /* 创建场景 */
  const scene: THREE.Scene = new THREE.Scene();

  /* 创建相机 */
  const camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);

  /* 添加灯光 */
  const ambientLight: THREE.AmbientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const directionalLight: THREE.DirectionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(2, 3, 1);
  scene.add(directionalLight);

  /* 创建 Mesh */
  geometry.computeBoundingBox();
  const box: THREE.Box3 = geometry.boundingBox as THREE.Box3;
  const center: THREE.Vector3 = new THREE.Vector3();
  box.getCenter(center);
  const size: THREE.Vector3 = new THREE.Vector3();
  box.getSize(size);

  /* 居中几何体 */
  geometry.translate(-center.x, -center.y, -center.z);

  const material: THREE.MeshPhongMaterial = new THREE.MeshPhongMaterial({
    /* 素描灰阶中灰色 0xc8c8c8，与 STL 放置材质保持一致 */
    color: 0xc8c8c8,
    flatShading: true,
  });
  const mesh: THREE.Mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  /* 计算相机位置：从右上前方观察 */
  const maxDim: number = Math.max(size.x, size.y, size.z);
  const camDistance: number = maxDim * 1.8;
  camera.position.set(camDistance * 0.6, camDistance * 0.5, camDistance * 0.8);
  camera.lookAt(0, 0, 0);

  /* 渲染一帧 */
  renderer.render(scene, camera);

  /* 导出为 base64 */
  const dataUrl: string = canvas.toDataURL('image/png');

  /* 清理资源 */
  geometry.dispose();
  material.dispose();
  renderer.dispose();

  /* 缓存结果 */
  thumbnailCache.set(stlUrl, dataUrl);

  return dataUrl;
}
