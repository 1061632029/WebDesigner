/**
 * STL 常规模型布置距离标注渲染器。
 * 在普通 STL 模型布置预览时，显示预览模型四条 XZ 包围盒边界到最近目标包围平面的水平/垂直距离。
 */

import * as THREE from 'three/webgpu';

/** XZ 平面包围盒数据，单位为米。 */
interface StlPlacementFlatBox {
  /** X 轴最小边界 */
  minX: number;
  /** X 轴最大边界 */
  maxX: number;
  /** Z 轴最小边界 */
  minZ: number;
  /** Z 轴最大边界 */
  maxZ: number;
}

/** STL 布置标注方向。 */
export type StlPlacementDimensionSide = 'minX' | 'maxX' | 'minZ' | 'maxZ';

/** STL 标注点击命中结果。 */
export interface StlPlacementDimensionHitResult {
  /** 命中的模型包围盒方向。 */
  side: StlPlacementDimensionSide;
}

/** 单段距离标注数据。 */
interface StlPlacementDimensionSegment {
  /** 标注所属预览包围盒边界 */
  side: StlPlacementDimensionSide;
  /** 起点世界坐标 */
  startPoint: THREE.Vector3;
  /** 终点世界坐标 */
  endPoint: THREE.Vector3;
  /** 两端界线方向单位向量 */
  extensionDir: THREE.Vector3;
  /** 标注距离，单位米 */
  distance: number;
}

/** 文字标签 Sprite 及其可更新资源。 */
interface StlPlacementLabelSpriteResources {
  /** 文字标签 Sprite */
  sprite: THREE.Sprite;
  /** 文字标签画布 */
  canvas: HTMLCanvasElement;
  /** 文字标签纹理 */
  texture: THREE.CanvasTexture;
}

/** 已创建的单段标注对象缓存，用于动态刷新时复用 GPU 资源。 */
interface RenderedStlPlacementDimensionSegment {
  /** 单段标注对象组 */
  group: THREE.Group;
  /** 主尺寸线 */
  dimensionLine: THREE.Line;
  /** 两端界线 */
  extensionLine: THREE.LineSegments;
  /** 文字标签 */
  label: THREE.Sprite;
  /** 文字标签画布 */
  labelCanvas: HTMLCanvasElement;
  /** 文字标签纹理 */
  labelTexture: THREE.CanvasTexture;
  /** 当前显示文本 */
  labelText: string;
  /** 当前标注方向 */
  side: StlPlacementDimensionSide | null;
  /** 当前是否处于编辑状态 */
  active: boolean;
}

/** 投影和显示容差，单位米。 */
const RANGE_EPSILON: number = 0.001;

/** 标注所在高度，略高于地面与普通吸附虚线，避免闪烁。 */
const DIMENSION_Y: number = 0.13;

/** 两端界线长度，单位米。 */
const EXTENSION_LINE_LENGTH: number = 0.16;

/** 标注线颜色，与门窗布置距离标注保持一致。 */
const DIMENSION_LINE_COLOR: number = 0x8f8f8f;

/** 当前可编辑标注线颜色。 */
const ACTIVE_DIMENSION_LINE_COLOR: number = 0x2f8df6;

/** 文字颜色。 */
const LABEL_TEXT_COLOR: string = '#333333';

/** 标签边框颜色。 */
const LABEL_BORDER_COLOR: string = '#b8b8b8';

/** 标签背景颜色。 */
const LABEL_BACKGROUND_COLOR: string = 'rgba(255,255,255,0.94)';

/** 当前可编辑标签背景颜色。 */
const ACTIVE_LABEL_BACKGROUND_COLOR: string = '#2f8df6';

/** 当前可编辑标签文字颜色。 */
const ACTIVE_LABEL_TEXT_COLOR: string = '#ffffff';

/** 标签画布宽度，单位像素。 */
const LABEL_CANVAS_WIDTH: number = 240;

/** 标签画布高度，单位像素。 */
const LABEL_CANVAS_HEIGHT: number = 96;

/** 标签文字字号，单位像素。 */
const LABEL_FONT_SIZE: number = 44;

/** 标签 Sprite 世界宽度，单位米。 */
const LABEL_SPRITE_WIDTH: number = 0.72;

/** 标签 Sprite 世界高度，单位米。 */
const LABEL_SPRITE_HEIGHT: number = 0.288;

/** 标注对象名称前缀。 */
const DIMENSION_GROUP_NAME: string = 'stl-placement-dimensions';

/** STL 常规模型四方向距离标注渲染器。 */
export class StlPlacementDimensionRenderer {
  /** 当前渲染的临时标注组。 */
  private _group: THREE.Group | null = null;

  /** 动态标注段缓存，最多包含四段：minX、maxX、minZ、maxZ。 */
  private readonly _renderedSegments: RenderedStlPlacementDimensionSegment[] = [];

  /** 标注标签射线拾取器，用于点击进入尺寸编辑。 */
  private readonly _labelRaycaster: THREE.Raycaster = new THREE.Raycaster();

  /**
   * 预创建 STL 布置距离标注对象池。
   * @param scene - Three.js 场景
   */
  public prepare(scene: THREE.Scene): void {
    /* 对象池初始化流程：布置开始时一次性创建四段标注，后续鼠标移动只更新位置和显隐。 */
    this.ensureGroup(scene);
    this.hide();
  }

  /**
   * 刷新普通 STL 布置距离标注。
   * @param previewMesh - 当前普通 STL 布置预览 Mesh
   * @param targetMeshes - 可作为最近包围平面的目标 Mesh 列表
   * @param scene - Three.js 场景
   */
  public update(
    previewMesh: THREE.Mesh,
    targetMeshes: THREE.Mesh[],
    scene: THREE.Scene,
    activeSide: StlPlacementDimensionSide | null = null,
    activeInputText: string | null = null
  ): void {
    /* 标注刷新流程：基于预览 AABB 四条边，分别查找对应方向最近的目标 AABB 平面并原地更新对象池。 */
    const group: THREE.Group | null = this._group;
    if (group === null || group.parent !== scene) {
      return;
    }
    group.name = `${DIMENSION_GROUP_NAME}-${previewMesh.uuid}`;

    if (!previewMesh.visible || targetMeshes.length === 0) {
      this.hide();
      return;
    }

    previewMesh.updateMatrixWorld(true);
    const previewBox: StlPlacementFlatBox = StlPlacementDimensionRenderer.computeFlatBox(previewMesh);
    const targetBoxes: StlPlacementFlatBox[] = StlPlacementDimensionRenderer.collectTargetBoxes(previewMesh, targetMeshes);
    if (targetBoxes.length === 0) {
      this.hide();
      return;
    }

    const segments: StlPlacementDimensionSegment[] = StlPlacementDimensionRenderer.computeDimensionSegments(
      previewBox,
      targetBoxes
    );
    if (segments.length === 0) {
      this.hide();
      return;
    }

    group.visible = true;
    for (let segmentIndex: number = 0; segmentIndex < this._renderedSegments.length; segmentIndex += 1) {
      const renderedSegment: RenderedStlPlacementDimensionSegment | undefined = this._renderedSegments[segmentIndex];
      if (renderedSegment === undefined) {
        continue;
      }
      const segment: StlPlacementDimensionSegment | undefined = segments[segmentIndex];
      if (segment === undefined) {
        renderedSegment.group.visible = false;
        continue;
      }
      const active: boolean = segment.side === activeSide;
      const activeLabelText: string | null = active ? activeInputText : null;
      this.updateDimensionSegment(renderedSegment, segment, active, activeLabelText);
    }
  }

  /**
   * 检测屏幕坐标是否命中 STL 四方向距离标注标签。
   * @param clientX - 鼠标屏幕 X 坐标。
   * @param clientY - 鼠标屏幕 Y 坐标。
   * @param camera - 当前相机。
   * @param domElement - 渲染画布元素。
   * @returns 命中标注时返回方向，否则返回 null。
   */
  public hitTestLabel(
    clientX: number,
    clientY: number,
    camera: THREE.Camera,
    domElement: HTMLCanvasElement
  ): StlPlacementDimensionHitResult | null {
    const group: THREE.Group | null = this._group;
    if (group === null || !group.visible) {
      return null;
    }

    const rect: DOMRect = domElement.getBoundingClientRect();
    const ndcX: number = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY: number = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._labelRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

    for (let segmentIndex: number = 0; segmentIndex < this._renderedSegments.length; segmentIndex += 1) {
      const renderedSegment: RenderedStlPlacementDimensionSegment | undefined = this._renderedSegments[segmentIndex];
      if (renderedSegment === undefined || !renderedSegment.group.visible || renderedSegment.side === null) {
        continue;
      }
      const hits: THREE.Intersection[] = this._labelRaycaster.intersectObject(renderedSegment.label, false);
      if (hits.length > 0) {
        return { side: renderedSegment.side };
      }
    }

    return null;
  }

  /**
   * 隐藏当前临时距离标注。
   * @param scene - Three.js 场景
   */
  public clear(scene: THREE.Scene): void {
    void scene;
    /* 清理流程只隐藏对象池，不从场景移除、不释放资源，避免动态布置退出时触发 WebGPU Buffer 销毁问题。 */
    this.hide();
  }

  /**
   * 最终释放当前临时距离标注资源。
   * 注意：动态拖拽刷新不调用该方法，避免 WebGPU Buffer 在提交队列中被销毁。
   * @param scene - Three.js 场景
   */
  public dispose(scene: THREE.Scene): void {
    if (this._group === null) {
      return;
    }

    const group: THREE.Group = this._group;
    if (group.parent === scene) {
      scene.remove(group);
    }
    this._group = null;
    this._renderedSegments.length = 0;

    /* 延迟到后续帧释放 GPU 资源，避免释放仍在 WebGPU 命令队列中提交的 Buffer。 */
    window.requestAnimationFrame((): void => {
      window.requestAnimationFrame((): void => {
        StlPlacementDimensionRenderer.disposeObject(group);
      });
    });
  }

  /** 隐藏标注组和所有标注段。 */
  private hide(): void {
    if (this._group !== null) {
      this._group.visible = false;
    }
    for (let segmentIndex: number = 0; segmentIndex < this._renderedSegments.length; segmentIndex += 1) {
      const renderedSegment: RenderedStlPlacementDimensionSegment | undefined = this._renderedSegments[segmentIndex];
      if (renderedSegment !== undefined) {
        renderedSegment.group.visible = false;
      }
    }
  }

  /**
   * 获取或创建可复用标注组。
   * @param scene - Three.js 场景
   * @returns 可复用标注组
   */
  private ensureGroup(scene: THREE.Scene): THREE.Group {
    if (this._group === null) {
      const group: THREE.Group = new THREE.Group();
      group.name = DIMENSION_GROUP_NAME;
      group.renderOrder = 11000;
      group.userData['isStlPlacementDimension'] = true;
      this._group = group;
    }

    if (this._group.parent !== scene) {
      scene.add(this._group);
    }

    while (this._renderedSegments.length < 4) {
      const renderedSegment: RenderedStlPlacementDimensionSegment = StlPlacementDimensionRenderer.createRenderedSegment();
      this._renderedSegments.push(renderedSegment);
      this._group.add(renderedSegment.group);
    }

    return this._group;
  }

  /**
   * 创建一段可复用的距离标注对象。
   * @returns 单段标注对象缓存
   */
  private static createRenderedSegment(): RenderedStlPlacementDimensionSegment {
    const segmentGroup: THREE.Group = new THREE.Group();
    segmentGroup.visible = false;

    const zeroPoint: THREE.Vector3 = new THREE.Vector3(0, DIMENSION_Y, 0);
    const dimensionLine: THREE.Line = StlPlacementDimensionRenderer.createLine([
      zeroPoint.clone(),
      zeroPoint.clone(),
    ]);
    segmentGroup.add(dimensionLine);

    const extensionLine: THREE.LineSegments = StlPlacementDimensionRenderer.createLineSegments([
      zeroPoint.clone(),
      zeroPoint.clone(),
      zeroPoint.clone(),
      zeroPoint.clone(),
    ]);
    segmentGroup.add(extensionLine);

    const labelResources: StlPlacementLabelSpriteResources = StlPlacementDimensionRenderer.createLabelSpriteResources('');
    segmentGroup.add(labelResources.sprite);

    return {
      group: segmentGroup,
      dimensionLine: dimensionLine,
      extensionLine: extensionLine,
      label: labelResources.sprite,
      labelCanvas: labelResources.canvas,
      labelTexture: labelResources.texture,
      labelText: '',
      side: null,
      active: false,
    };
  }

  /**
   * 更新单段标注对象的线段位置和文字内容。
   * @param renderedSegment - 可复用标注对象
   * @param segment - 标注段数据
   */
  private updateDimensionSegment(
    renderedSegment: RenderedStlPlacementDimensionSegment,
    segment: StlPlacementDimensionSegment,
    active: boolean,
    activeInputText: string | null
  ): void {
    const startPoint: THREE.Vector3 = segment.startPoint.clone();
    const endPoint: THREE.Vector3 = segment.endPoint.clone();
    const centerPoint: THREE.Vector3 = startPoint.clone().add(endPoint).multiplyScalar(0.5);

    StlPlacementDimensionRenderer.updateGeometryPoints(renderedSegment.dimensionLine.geometry, [startPoint, endPoint]);

    const halfExtension: number = EXTENSION_LINE_LENGTH * 0.5;
    const extensionOffset: THREE.Vector3 = segment.extensionDir.clone().multiplyScalar(halfExtension);
    const startExtensionA: THREE.Vector3 = startPoint.clone().sub(extensionOffset);
    const startExtensionB: THREE.Vector3 = startPoint.clone().add(extensionOffset);
    const endExtensionA: THREE.Vector3 = endPoint.clone().sub(extensionOffset);
    const endExtensionB: THREE.Vector3 = endPoint.clone().add(extensionOffset);
    StlPlacementDimensionRenderer.updateGeometryPoints(renderedSegment.extensionLine.geometry, [
      startExtensionA,
      startExtensionB,
      endExtensionA,
      endExtensionB,
    ]);

    /* 标签编辑流程：处于编辑态且存在键盘输入时，优先显示用户输入值；未输入时保持显示实时计算距离。 */
    const labelText: string = activeInputText !== null && activeInputText !== ''
      ? activeInputText
      : String(Math.round(segment.distance * 1000));
    if (renderedSegment.labelText !== labelText || renderedSegment.active !== active) {
      StlPlacementDimensionRenderer.drawLabelCanvas(renderedSegment.labelCanvas, labelText, active);
      renderedSegment.labelTexture.needsUpdate = true;
      renderedSegment.labelText = labelText;
      renderedSegment.active = active;
    }
    renderedSegment.side = segment.side;
    StlPlacementDimensionRenderer.updateLineColor(renderedSegment.dimensionLine, active);
    StlPlacementDimensionRenderer.updateLineColor(renderedSegment.extensionLine, active);
    renderedSegment.label.position.copy(centerPoint);
    renderedSegment.label.position.y = DIMENSION_Y + 0.02;
    renderedSegment.group.visible = true;
  }

  /**
   * 计算 Mesh 的 XZ 世界空间 AABB。
   * @param mesh - 待计算 Mesh
   * @returns XZ 平面包围盒数据
   */
  private static computeFlatBox(mesh: THREE.Mesh): StlPlacementFlatBox {
    const box3: THREE.Box3 = new THREE.Box3().setFromObject(mesh);
    return {
      minX: box3.min.x,
      maxX: box3.max.x,
      minZ: box3.min.z,
      maxZ: box3.max.z,
    };
  }

  /**
   * 收集目标 Mesh 的 XZ 世界空间 AABB。
   * @param previewMesh - 当前预览 Mesh，用于排除自身
   * @param targetMeshes - 候选目标 Mesh 列表
   * @returns 目标 XZ 平面包围盒数组
   */
  private static collectTargetBoxes(previewMesh: THREE.Mesh, targetMeshes: THREE.Mesh[]): StlPlacementFlatBox[] {
    const targetBoxes: StlPlacementFlatBox[] = [];
    for (let targetIndex: number = 0; targetIndex < targetMeshes.length; targetIndex += 1) {
      const targetMesh: THREE.Mesh | undefined = targetMeshes[targetIndex];
      if (targetMesh === undefined || targetMesh.uuid === previewMesh.uuid || !targetMesh.visible) {
        continue;
      }
      if (targetMesh.userData['isPlacementPreview'] === true) {
        continue;
      }

      targetMesh.updateMatrixWorld(true);
      targetBoxes.push(StlPlacementDimensionRenderer.computeFlatBox(targetMesh));
    }
    return targetBoxes;
  }

  /**
   * 计算预览包围盒四条边界到最近目标包围平面的标注段。
   * @param previewBox - 预览 Mesh 的 XZ 平面包围盒
   * @param targetBoxes - 目标 XZ 平面包围盒数组
   * @returns 需要绘制的标注段数组
   */
  private static computeDimensionSegments(
    previewBox: StlPlacementFlatBox,
    targetBoxes: StlPlacementFlatBox[]
  ): StlPlacementDimensionSegment[] {
    const segments: StlPlacementDimensionSegment[] = [];
    const centerX: number = (previewBox.minX + previewBox.maxX) * 0.5;
    const centerZ: number = (previewBox.minZ + previewBox.maxZ) * 0.5;

    const nearestLeftPlane: number | null = StlPlacementDimensionRenderer.findNearestLowerPlane(
      previewBox.minX,
      targetBoxes,
      'x'
    );
    if (nearestLeftPlane !== null) {
      segments.push(StlPlacementDimensionRenderer.createXSegment('minX', nearestLeftPlane, previewBox.minX, centerZ));
    }

    const nearestRightPlane: number | null = StlPlacementDimensionRenderer.findNearestUpperPlane(
      previewBox.maxX,
      targetBoxes,
      'x'
    );
    if (nearestRightPlane !== null) {
      segments.push(StlPlacementDimensionRenderer.createXSegment('maxX', previewBox.maxX, nearestRightPlane, centerZ));
    }

    const nearestBottomPlane: number | null = StlPlacementDimensionRenderer.findNearestLowerPlane(
      previewBox.minZ,
      targetBoxes,
      'z'
    );
    if (nearestBottomPlane !== null) {
      segments.push(StlPlacementDimensionRenderer.createZSegment('minZ', centerX, nearestBottomPlane, previewBox.minZ));
    }

    const nearestTopPlane: number | null = StlPlacementDimensionRenderer.findNearestUpperPlane(
      previewBox.maxZ,
      targetBoxes,
      'z'
    );
    if (nearestTopPlane !== null) {
      segments.push(StlPlacementDimensionRenderer.createZSegment('maxZ', centerX, previewBox.maxZ, nearestTopPlane));
    }

    return segments;
  }

  /**
   * 查找指定边界下侧/左侧最近的目标包围平面。
   * @param boundary - 当前预览边界坐标
   * @param targetBoxes - 目标包围盒数组
   * @param axis - 查找轴向
   * @returns 最近平面坐标；不存在时返回 null
   */
  private static findNearestLowerPlane(
    boundary: number,
    targetBoxes: StlPlacementFlatBox[],
    axis: 'x' | 'z'
  ): number | null {
    let nearestPlane: number | null = null;
    for (let targetIndex: number = 0; targetIndex < targetBoxes.length; targetIndex += 1) {
      const targetBox: StlPlacementFlatBox | undefined = targetBoxes[targetIndex];
      if (targetBox === undefined) {
        continue;
      }
      const planeA: number = axis === 'x' ? targetBox.minX : targetBox.minZ;
      const planeB: number = axis === 'x' ? targetBox.maxX : targetBox.maxZ;
      nearestPlane = StlPlacementDimensionRenderer.pickNearestLowerPlane(boundary, nearestPlane, planeA);
      nearestPlane = StlPlacementDimensionRenderer.pickNearestLowerPlane(boundary, nearestPlane, planeB);
    }
    return nearestPlane;
  }

  /**
   * 查找指定边界上侧/右侧最近的目标包围平面。
   * @param boundary - 当前预览边界坐标
   * @param targetBoxes - 目标包围盒数组
   * @param axis - 查找轴向
   * @returns 最近平面坐标；不存在时返回 null
   */
  private static findNearestUpperPlane(
    boundary: number,
    targetBoxes: StlPlacementFlatBox[],
    axis: 'x' | 'z'
  ): number | null {
    let nearestPlane: number | null = null;
    for (let targetIndex: number = 0; targetIndex < targetBoxes.length; targetIndex += 1) {
      const targetBox: StlPlacementFlatBox | undefined = targetBoxes[targetIndex];
      if (targetBox === undefined) {
        continue;
      }
      const planeA: number = axis === 'x' ? targetBox.minX : targetBox.minZ;
      const planeB: number = axis === 'x' ? targetBox.maxX : targetBox.maxZ;
      nearestPlane = StlPlacementDimensionRenderer.pickNearestUpperPlane(boundary, nearestPlane, planeA);
      nearestPlane = StlPlacementDimensionRenderer.pickNearestUpperPlane(boundary, nearestPlane, planeB);
    }
    return nearestPlane;
  }

  /**
   * 在下侧/左侧候选平面中挑选最近值。
   * @param boundary - 当前预览边界坐标
   * @param currentPlane - 当前已选最近平面
   * @param candidatePlane - 候选平面坐标
   * @returns 更新后的最近平面
   */
  private static pickNearestLowerPlane(
    boundary: number,
    currentPlane: number | null,
    candidatePlane: number
  ): number | null {
    if (candidatePlane > boundary + RANGE_EPSILON) {
      return currentPlane;
    }
    if (currentPlane === null || candidatePlane > currentPlane) {
      return candidatePlane;
    }
    return currentPlane;
  }

  /**
   * 在上侧/右侧候选平面中挑选最近值。
   * @param boundary - 当前预览边界坐标
   * @param currentPlane - 当前已选最近平面
   * @param candidatePlane - 候选平面坐标
   * @returns 更新后的最近平面
   */
  private static pickNearestUpperPlane(
    boundary: number,
    currentPlane: number | null,
    candidatePlane: number
  ): number | null {
    if (candidatePlane < boundary - RANGE_EPSILON) {
      return currentPlane;
    }
    if (currentPlane === null || candidatePlane < currentPlane) {
      return candidatePlane;
    }
    return currentPlane;
  }

  /**
   * 创建 X 轴方向距离标注段。
   * @param side - 预览边界方向
   * @param startX - 起点 X 坐标
   * @param endX - 终点 X 坐标
   * @param z - 标注线 Z 坐标
   * @returns 距离标注段
   */
  private static createXSegment(
    side: StlPlacementDimensionSide,
    startX: number,
    endX: number,
    z: number
  ): StlPlacementDimensionSegment {
    const startPoint: THREE.Vector3 = new THREE.Vector3(startX, DIMENSION_Y, z);
    const endPoint: THREE.Vector3 = new THREE.Vector3(endX, DIMENSION_Y, z);
    return {
      side: side,
      startPoint: startPoint,
      endPoint: endPoint,
      extensionDir: new THREE.Vector3(0, 0, 1),
      distance: Math.abs(endX - startX),
    };
  }

  /**
   * 创建 Z 轴方向距离标注段。
   * @param side - 预览边界方向
   * @param x - 标注线 X 坐标
   * @param startZ - 起点 Z 坐标
   * @param endZ - 终点 Z 坐标
   * @returns 距离标注段
   */
  private static createZSegment(
    side: StlPlacementDimensionSide,
    x: number,
    startZ: number,
    endZ: number
  ): StlPlacementDimensionSegment {
    const startPoint: THREE.Vector3 = new THREE.Vector3(x, DIMENSION_Y, startZ);
    const endPoint: THREE.Vector3 = new THREE.Vector3(x, DIMENSION_Y, endZ);
    return {
      side: side,
      startPoint: startPoint,
      endPoint: endPoint,
      extensionDir: new THREE.Vector3(1, 0, 0),
      distance: Math.abs(endZ - startZ),
    };
  }

  /**
   * 原地更新 BufferGeometry 的顶点坐标，复用 WebGPU Buffer。
   * @param geometry - 待更新几何体
   * @param points - 新顶点坐标
   */
  private static updateGeometryPoints(geometry: THREE.BufferGeometry, points: THREE.Vector3[]): void {
    const positionAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined = geometry.getAttribute('position');
    if (!(positionAttribute instanceof THREE.BufferAttribute)) {
      geometry.setFromPoints(points);
      return;
    }

    for (let pointIndex: number = 0; pointIndex < points.length; pointIndex += 1) {
      const point: THREE.Vector3 | undefined = points[pointIndex];
      if (point === undefined) {
        continue;
      }
      positionAttribute.setXYZ(pointIndex, point.x, point.y, point.z);
    }
    positionAttribute.needsUpdate = true;
    geometry.computeBoundingSphere();
  }

  /**
   * 创建尺寸线。
   * @param points - 线段点数组
   * @returns Three.js Line
   */
  private static createLine(points: THREE.Vector3[]): THREE.Line {
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const material: THREE.LineBasicMaterial = StlPlacementDimensionRenderer.createLineMaterial();
    const line: THREE.Line = new THREE.Line(geometry, material);
    line.renderOrder = 11001;
    return line;
  }

  /**
   * 创建界线线段集合。
   * @param points - 成对线段点数组
   * @returns Three.js LineSegments
   */
  private static createLineSegments(points: THREE.Vector3[]): THREE.LineSegments {
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const material: THREE.LineBasicMaterial = StlPlacementDimensionRenderer.createLineMaterial();
    const lineSegments: THREE.LineSegments = new THREE.LineSegments(geometry, material);
    lineSegments.renderOrder = 11002;
    return lineSegments;
  }

  /**
   * 创建标注线材质。
   * @returns 线材质
   */
  private static createLineMaterial(): THREE.LineBasicMaterial {
    return new THREE.LineBasicMaterial({
      color: DIMENSION_LINE_COLOR,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    });
  }

  /**
   * 根据编辑状态更新标注线颜色。
   * @param lineObject - 尺寸线或界线对象。
   * @param active - 当前线段是否处于编辑状态。
   */
  private static updateLineColor(lineObject: THREE.Line | THREE.LineSegments, active: boolean): void {
    const material: THREE.Material | THREE.Material[] = lineObject.material;
    if (Array.isArray(material)) {
      for (let materialIndex: number = 0; materialIndex < material.length; materialIndex += 1) {
        const item: THREE.Material | undefined = material[materialIndex];
        if (item instanceof THREE.LineBasicMaterial) {
          item.color.setHex(active ? ACTIVE_DIMENSION_LINE_COLOR : DIMENSION_LINE_COLOR);
        }
      }
      return;
    }
    if (material instanceof THREE.LineBasicMaterial) {
      material.color.setHex(active ? ACTIVE_DIMENSION_LINE_COLOR : DIMENSION_LINE_COLOR);
    }
  }

  /**
   * 创建白底距离文字 Sprite 及其可复用贴图资源。
   * @param text - 标签文本
   * @returns Sprite 与画布贴图资源
   */
  private static createLabelSpriteResources(text: string): StlPlacementLabelSpriteResources {
    const canvas: HTMLCanvasElement = document.createElement('canvas');
    canvas.width = LABEL_CANVAS_WIDTH;
    canvas.height = LABEL_CANVAS_HEIGHT;
    StlPlacementDimensionRenderer.drawLabelCanvas(canvas, text, false);

    const texture: THREE.CanvasTexture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material: THREE.SpriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite: THREE.Sprite = new THREE.Sprite(material);
    sprite.renderOrder = 11003;
    sprite.scale.set(LABEL_SPRITE_WIDTH, LABEL_SPRITE_HEIGHT, 1);
    return {
      sprite: sprite,
      canvas: canvas,
      texture: texture,
    };
  }

  /**
   * 重绘文字标签画布。
   * @param canvas - 标签画布
   * @param text - 标签文本
   */
  private static drawLabelCanvas(canvas: HTMLCanvasElement, text: string, active: boolean): void {
    const context: CanvasRenderingContext2D | null = canvas.getContext('2d');
    if (context === null) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = active ? ACTIVE_LABEL_BACKGROUND_COLOR : LABEL_BACKGROUND_COLOR;
    context.strokeStyle = active ? ACTIVE_LABEL_BACKGROUND_COLOR : LABEL_BORDER_COLOR;
    context.lineWidth = active ? 4 : 2;
    /* 标签重绘流程：编辑态绘制蓝底白字，非编辑态保持白底深色文字。 */
    StlPlacementDimensionRenderer.drawRoundRect(context, 12, 14, 216, 68, 10);
    context.fill();
    context.stroke();
    context.fillStyle = active ? ACTIVE_LABEL_TEXT_COLOR : LABEL_TEXT_COLOR;
    context.font = `900 ${LABEL_FONT_SIZE}px Arial, Microsoft YaHei, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, LABEL_CANVAS_WIDTH / 2, LABEL_CANVAS_HEIGHT / 2);
  }

  /**
   * 绘制圆角矩形路径。
   * @param context - Canvas 2D 上下文
   * @param x - 左上角 X
   * @param y - 左上角 Y
   * @param width - 宽度
   * @param height - 高度
   * @param radius - 圆角半径
   */
  private static drawRoundRect(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
  }

  /**
   * 释放对象树中的几何体、材质和贴图资源。
   * @param object - 待释放对象
   */
  private static disposeObject(object: THREE.Object3D): void {
    object.traverse((child: THREE.Object3D): void => {
      const geometryOwner: THREE.Object3D & { geometry?: THREE.BufferGeometry } = child as THREE.Object3D & { geometry?: THREE.BufferGeometry };
      if (geometryOwner.geometry !== undefined) {
        geometryOwner.geometry.dispose();
      }

      const materialOwner: THREE.Object3D & { material?: THREE.Material | THREE.Material[] } = child as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
      if (materialOwner.material !== undefined) {
        if (Array.isArray(materialOwner.material)) {
          for (let materialIndex: number = 0; materialIndex < materialOwner.material.length; materialIndex += 1) {
            const material: THREE.Material | undefined = materialOwner.material[materialIndex];
            if (material === undefined) {
              continue;
            }
            StlPlacementDimensionRenderer.disposeMaterial(material);
          }
        } else {
          StlPlacementDimensionRenderer.disposeMaterial(materialOwner.material);
        }
      }
    });
  }

  /**
   * 释放材质及材质贴图。
   * @param material - 待释放材质
   */
  private static disposeMaterial(material: THREE.Material): void {
    const materialWithMap: THREE.Material & { map?: THREE.Texture | null } = material as THREE.Material & { map?: THREE.Texture | null };
    if (materialWithMap.map !== undefined && materialWithMap.map !== null) {
      materialWithMap.map.dispose();
    }
    material.dispose();
  }
}