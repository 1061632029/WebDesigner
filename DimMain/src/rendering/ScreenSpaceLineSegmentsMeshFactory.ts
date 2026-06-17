/**
 * 屏幕空间固定像素线段 Mesh 工厂。
 * 负责将业务线段端点转换为面向相机的矩形面片，使线宽在缩放时保持固定 CSS 像素。
 */

import * as THREE from 'three/webgpu';

/**
 * 屏幕空间线段 Mesh 创建配置。
 */
export interface ScreenSpaceLineSegmentsMeshOptions {
  /** 线段颜色。 */
  color: THREE.ColorRepresentation;
  /** 屏幕空间线宽，单位为 CSS 像素。 */
  lineWidthPixels: number;
  /** 是否启用深度测试。 */
  depthTest: boolean;
  /** 是否写入深度缓冲。 */
  depthWrite: boolean;
  /** 透明度，范围 0-1。 */
  opacity: number;
}

/**
 * 屏幕空间固定像素线段 Mesh。
 */
export type ScreenSpaceLineSegmentsMesh = THREE.Mesh;

/**
 * 可读取渲染尺寸的渲染器接口。
 */
interface RendererSizeReader {
  /**
   * 获取当前渲染尺寸。
   * @param target - 接收尺寸的二维向量
   * @returns 写入尺寸后的二维向量
   */
  getSize(target: THREE.Vector2): THREE.Vector2;
}

/**
 * 屏幕空间固定像素线段 Mesh 工厂。
 */
export class ScreenSpaceLineSegmentsMeshFactory {
  /** 最小有效线宽，避免 0 宽线段不可见。 */
  private static readonly MIN_LINE_WIDTH_PIXELS: number = 1;

  /** 线段端点在 userData 中的存储键。 */
  private static readonly LOCAL_SEGMENTS_KEY: string = 'screenSpaceLineLocalSegments';

  /** 复用的渲染器尺寸对象，避免每帧分配临时对象。 */
  private static readonly RENDERER_SIZE: THREE.Vector2 = new THREE.Vector2();

  /** 复用的世界坐标起点。 */
  private static readonly START_WORLD: THREE.Vector3 = new THREE.Vector3();

  /** 复用的世界坐标终点。 */
  private static readonly END_WORLD: THREE.Vector3 = new THREE.Vector3();

  /** 复用的屏幕裁剪空间起点。 */
  private static readonly START_CLIP: THREE.Vector3 = new THREE.Vector3();

  /** 复用的屏幕裁剪空间终点。 */
  private static readonly END_CLIP: THREE.Vector3 = new THREE.Vector3();

  /** 复用的矩形顶点世界坐标。 */
  private static readonly CORNER_WORLD: THREE.Vector3 = new THREE.Vector3();

  /** 复用的矩形顶点局部坐标。 */
  private static readonly CORNER_LOCAL: THREE.Vector3 = new THREE.Vector3();

  /**
   * 创建固定像素线段 Mesh。
   * 关键流程：先为每条线段分配四边形顶点和索引；每帧渲染前根据相机、视口尺寸把端点投影到 NDC，
   * 再按像素宽度计算法线偏移并反投影回当前对象局部坐标，从而获得不随透视缩放变化的视觉线宽。
   * @param vertices - 线段端点数组，格式为 x/y/z/x/y/z 循环排列
   * @param options - 屏幕空间线段 Mesh 创建配置
   * @returns 固定像素线段 Mesh
   */
  public static create(vertices: Float32Array, options: ScreenSpaceLineSegmentsMeshOptions): ScreenSpaceLineSegmentsMesh {
    const segmentCount: number = Math.floor(vertices.length / 6);
    const positionArray: Float32Array = new Float32Array(segmentCount * 4 * 3);
    const indexArray: Uint32Array = new Uint32Array(segmentCount * 6);

    /* 初始化索引缓冲：每条逻辑线段对应一个矩形面片，两个三角形用于渲染粗线。 */
    for (let segmentIndex: number = 0; segmentIndex < segmentCount; segmentIndex++) {
      const vertexOffset: number = segmentIndex * 4;
      const indexOffset: number = segmentIndex * 6;
      indexArray[indexOffset] = vertexOffset;
      indexArray[indexOffset + 1] = vertexOffset + 1;
      indexArray[indexOffset + 2] = vertexOffset + 2;
      indexArray[indexOffset + 3] = vertexOffset + 2;
      indexArray[indexOffset + 4] = vertexOffset + 1;
      indexArray[indexOffset + 5] = vertexOffset + 3;
    }

    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
    geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));

    const lineWidthPixels: number = Math.max(ScreenSpaceLineSegmentsMeshFactory.MIN_LINE_WIDTH_PIXELS, options.lineWidthPixels);
    const materialParameters: THREE.MeshBasicMaterialParameters = {
      color: options.color,
      transparent: options.opacity < 1,
      opacity: options.opacity,
      depthTest: options.depthTest,
      depthWrite: options.depthWrite,
      side: THREE.DoubleSide,
    };
    const material: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial(materialParameters);

    const mesh: ScreenSpaceLineSegmentsMesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.userData['isScreenSpaceLineSegmentsMesh'] = true;
    mesh.userData['isFixedPixelLineSegments'] = true;
    mesh.userData['isVisualHelper'] = true;
    mesh.userData['isPickable'] = false;
    mesh.userData['lineWidthPixels'] = lineWidthPixels;
    mesh.userData[ScreenSpaceLineSegmentsMeshFactory.LOCAL_SEGMENTS_KEY] = new Float32Array(vertices);

    /* 交互隔离流程：屏幕空间线段仅承担显示职责，不参与业务射线拾取。 */
    mesh.raycast = function (_raycaster: THREE.Raycaster, _intersects: THREE.Intersection[]): void {
      return;
    };

    /* 渲染更新流程：每帧根据当前相机与视口刷新四边形顶点，保证线宽固定为 CSS 像素。 */
    mesh.onBeforeRender = (
      renderer: THREE.Renderer,
      _scene: THREE.Scene,
      camera: THREE.Camera,
      _geometry: THREE.BufferGeometry,
      _material: THREE.Material,
      _group: THREE.Group
    ): void => {
      ScreenSpaceLineSegmentsMeshFactory._updateGeometryForCamera(mesh, renderer, camera);
    };

    return mesh;
  }

  /**
   * 判断对象是否为屏幕空间线段 Mesh。
   * @param object3D - 需要判断的三维对象
   * @returns 是屏幕空间线段 Mesh 时返回 true，否则返回 false
   */
  public static isScreenSpaceLineSegmentsMesh(object3D: THREE.Object3D): boolean {
    return object3D.userData['isScreenSpaceLineSegmentsMesh'] === true;
  }

  /**
   * 释放屏幕空间线段 Mesh 占用的 GPU 资源。
   * @param object3D - 需要释放的对象
   */
  public static dispose(object3D: THREE.Object3D): void {
    if (!(object3D instanceof THREE.Mesh)) {
      return;
    }

    const mesh: THREE.Mesh = object3D as THREE.Mesh;
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      for (let materialIndex: number = 0; materialIndex < mesh.material.length; materialIndex++) {
        const material: THREE.Material = mesh.material[materialIndex]!;
        material.dispose();
      }
      return;
    }

    mesh.material.dispose();
  }

  /**
   * 根据当前相机和渲染视口刷新 Mesh 顶点。
   * @param mesh - 屏幕空间线段 Mesh
   * @param renderer - 当前渲染器
   * @param camera - 当前相机
   */
  private static _updateGeometryForCamera(mesh: THREE.Mesh, renderer: THREE.Renderer, camera: THREE.Camera): void {
    const localSegments: Float32Array | undefined = mesh.userData[ScreenSpaceLineSegmentsMeshFactory.LOCAL_SEGMENTS_KEY] as Float32Array | undefined;
    if (localSegments === undefined) {
      return;
    }

    const geometry: THREE.BufferGeometry = mesh.geometry;
    const positionAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined = geometry.getAttribute('position');
    if (!(positionAttribute instanceof THREE.BufferAttribute)) {
      return;
    }

    const rendererSize: THREE.Vector2 = ScreenSpaceLineSegmentsMeshFactory.RENDERER_SIZE;
    const rendererSizeReader: RendererSizeReader = renderer as unknown as RendererSizeReader;
    rendererSizeReader.getSize(rendererSize);
    if (rendererSize.x <= 0 || rendererSize.y <= 0) {
      return;
    }

    const lineWidthPixels: number = mesh.userData['lineWidthPixels'] as number;
    const halfWidthPixels: number = lineWidthPixels / 2;
    const ndcPixelX: number = 2 / rendererSize.x;
    const ndcPixelY: number = 2 / rendererSize.y;
    const segmentCount: number = Math.floor(localSegments.length / 6);

    /* 逐线段投影并反投影四边形顶点；退化线段写成零面积面片，避免产生异常闪烁。 */
    for (let segmentIndex: number = 0; segmentIndex < segmentCount; segmentIndex++) {
      const sourceOffset: number = segmentIndex * 6;
      const vertexOffset: number = segmentIndex * 12;

      ScreenSpaceLineSegmentsMeshFactory.START_WORLD.set(
        localSegments[sourceOffset]!,
        localSegments[sourceOffset + 1]!,
        localSegments[sourceOffset + 2]!
      );
      ScreenSpaceLineSegmentsMeshFactory.END_WORLD.set(
        localSegments[sourceOffset + 3]!,
        localSegments[sourceOffset + 4]!,
        localSegments[sourceOffset + 5]!
      );
      mesh.localToWorld(ScreenSpaceLineSegmentsMeshFactory.START_WORLD);
      mesh.localToWorld(ScreenSpaceLineSegmentsMeshFactory.END_WORLD);

      ScreenSpaceLineSegmentsMeshFactory.START_CLIP.copy(ScreenSpaceLineSegmentsMeshFactory.START_WORLD).project(camera);
      ScreenSpaceLineSegmentsMeshFactory.END_CLIP.copy(ScreenSpaceLineSegmentsMeshFactory.END_WORLD).project(camera);

      const clipDx: number = ScreenSpaceLineSegmentsMeshFactory.END_CLIP.x - ScreenSpaceLineSegmentsMeshFactory.START_CLIP.x;
      const clipDy: number = ScreenSpaceLineSegmentsMeshFactory.END_CLIP.y - ScreenSpaceLineSegmentsMeshFactory.START_CLIP.y;
      const pixelDx: number = clipDx / ndcPixelX;
      const pixelDy: number = clipDy / ndcPixelY;
      const pixelLength: number = Math.sqrt(pixelDx * pixelDx + pixelDy * pixelDy);

      if (pixelLength <= 0.001) {
        ScreenSpaceLineSegmentsMeshFactory._writeDegenerateQuad(positionAttribute, vertexOffset, localSegments, sourceOffset);
        continue;
      }

      const normalPixelX: number = -pixelDy / pixelLength;
      const normalPixelY: number = pixelDx / pixelLength;
      const offsetClipX: number = normalPixelX * halfWidthPixels * ndcPixelX;
      const offsetClipY: number = normalPixelY * halfWidthPixels * ndcPixelY;

      ScreenSpaceLineSegmentsMeshFactory._writeCorner(positionAttribute, vertexOffset, mesh, camera, ScreenSpaceLineSegmentsMeshFactory.START_CLIP.x + offsetClipX, ScreenSpaceLineSegmentsMeshFactory.START_CLIP.y + offsetClipY, ScreenSpaceLineSegmentsMeshFactory.START_CLIP.z);
      ScreenSpaceLineSegmentsMeshFactory._writeCorner(positionAttribute, vertexOffset + 3, mesh, camera, ScreenSpaceLineSegmentsMeshFactory.START_CLIP.x - offsetClipX, ScreenSpaceLineSegmentsMeshFactory.START_CLIP.y - offsetClipY, ScreenSpaceLineSegmentsMeshFactory.START_CLIP.z);
      ScreenSpaceLineSegmentsMeshFactory._writeCorner(positionAttribute, vertexOffset + 6, mesh, camera, ScreenSpaceLineSegmentsMeshFactory.END_CLIP.x + offsetClipX, ScreenSpaceLineSegmentsMeshFactory.END_CLIP.y + offsetClipY, ScreenSpaceLineSegmentsMeshFactory.END_CLIP.z);
      ScreenSpaceLineSegmentsMeshFactory._writeCorner(positionAttribute, vertexOffset + 9, mesh, camera, ScreenSpaceLineSegmentsMeshFactory.END_CLIP.x - offsetClipX, ScreenSpaceLineSegmentsMeshFactory.END_CLIP.y - offsetClipY, ScreenSpaceLineSegmentsMeshFactory.END_CLIP.z);
    }

    positionAttribute.needsUpdate = true;
    geometry.computeBoundingSphere();
  }

  /**
   * 写入一个反投影后的矩形顶点。
   * @param positionAttribute - 位置属性
   * @param targetOffset - 目标数组偏移
   * @param mesh - 当前线段 Mesh
   * @param camera - 当前相机
   * @param clipX - 裁剪空间 X
   * @param clipY - 裁剪空间 Y
   * @param clipZ - 裁剪空间 Z
   */
  private static _writeCorner(
    positionAttribute: THREE.BufferAttribute,
    targetOffset: number,
    mesh: THREE.Mesh,
    camera: THREE.Camera,
    clipX: number,
    clipY: number,
    clipZ: number
  ): void {
    ScreenSpaceLineSegmentsMeshFactory.CORNER_WORLD.set(clipX, clipY, clipZ).unproject(camera);
    ScreenSpaceLineSegmentsMeshFactory.CORNER_LOCAL.copy(ScreenSpaceLineSegmentsMeshFactory.CORNER_WORLD);
    mesh.worldToLocal(ScreenSpaceLineSegmentsMeshFactory.CORNER_LOCAL);
    positionAttribute.array[targetOffset] = ScreenSpaceLineSegmentsMeshFactory.CORNER_LOCAL.x;
    positionAttribute.array[targetOffset + 1] = ScreenSpaceLineSegmentsMeshFactory.CORNER_LOCAL.y;
    positionAttribute.array[targetOffset + 2] = ScreenSpaceLineSegmentsMeshFactory.CORNER_LOCAL.z;
  }

  /**
   * 写入退化四边形，避免零长度线段生成无效方向。
   * @param positionAttribute - 位置属性
   * @param targetOffset - 目标数组偏移
   * @param localSegments - 原始局部线段端点数组
   * @param sourceOffset - 源数组偏移
   */
  private static _writeDegenerateQuad(
    positionAttribute: THREE.BufferAttribute,
    targetOffset: number,
    localSegments: Float32Array,
    sourceOffset: number
  ): void {
    for (let vertexIndex: number = 0; vertexIndex < 4; vertexIndex++) {
      const offset: number = targetOffset + vertexIndex * 3;
      positionAttribute.array[offset] = localSegments[sourceOffset]!;
      positionAttribute.array[offset + 1] = localSegments[sourceOffset + 1]!;
      positionAttribute.array[offset + 2] = localSegments[sourceOffset + 2]!;
    }
  }
}