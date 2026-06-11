/**
 * 门窗布置距离标注渲染器
 * 在门窗吸附墙体并处于布置预览时，显示门窗包围盒沿墙方向到最近门窗边界或墙端边界的距离。
 */

import * as THREE from 'three/webgpu';
import type { StraightWallData } from '../building/BuildingTypes';
import type { WallSnapResult } from '../building/WallSnapHelper';

/** 门窗投影区间，单位为米，坐标原点为墙体起点，方向为墙体终点方向。 */
interface DoorWindowWallRange {
  /** 沿墙方向最小投影值 */
  min: number;
  /** 沿墙方向最大投影值 */
  max: number;
}

/** 距离标注段数据。 */
interface DoorWindowDimensionSegment {
  /** 起点沿墙投影值 */
  start: number;
  /** 终点沿墙投影值 */
  end: number;
  /** 标注距离，单位米 */
  distance: number;
}

/** 门窗距离标注可编辑方向。 */
export type DoorWindowDimensionEditSide = 'left' | 'right';

/** 门窗标注点击命中结果。 */
export interface DoorWindowDimensionHitResult {
  /** 命中的门窗标注侧。 */
  side: DoorWindowDimensionEditSide;
}

/** 门窗距离标注上下文，描述已知墙体与门窗沿墙投影信息。 */
export interface DoorWindowPlacementDimensionContext {
  /** 当前门窗 Mesh，收集同墙门窗时用于排除自身。 */
  targetMesh: THREE.Mesh;
  /** 当前门窗所属直墙数据。 */
  wallData: StraightWallData;
  /** 墙体起点世界坐标。 */
  wallOrigin: THREE.Vector3;
  /** 墙布置方向单位向量。 */
  wallDir: THREE.Vector3;
  /** 墙法线单位向量，用于确定标注偏移方向。 */
  wallNormal: THREE.Vector3;
  /** 当前门窗包围盒沿墙方向的投影区间。 */
  targetRange: DoorWindowWallRange;
}

/** 文字标签 Sprite 及其可更新资源。 */
interface DoorWindowLabelSpriteResources {
  /** 文字标签 Sprite */
  sprite: THREE.Sprite;
  /** 文字标签画布 */
  canvas: HTMLCanvasElement;
  /** 文字标签纹理 */
  texture: THREE.CanvasTexture;
}

/** 已创建的单段标注对象缓存，用于动态刷新时复用 GPU 资源。 */
interface RenderedDoorWindowDimensionSegment {
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
  /** 当前是否为键盘可编辑标注段 */
  active: boolean;
}

/** 门窗距离标注当前可编辑侧�?*/
type DoorWindowDimensionActiveSide = DoorWindowDimensionEditSide | null;

/** 门窗类别集合，用于收集同墙已有门窗。 */
const DOOR_WINDOW_CATEGORIES: Set<string> = new Set<string>(['door', 'window']);

/** 投影和显示容差，单位米。 */
const RANGE_EPSILON: number = 0.001;

/** 标注所在高度，略高于地面与 2D 符号，避免闪烁。 */
const DIMENSION_Y: number = 0.13;

/** 标注线距离墙中心线的偏移附加值，单位米。 */
const DIMENSION_OUTSIDE_OFFSET: number = 0.22;

/** 两端界线长度，单位米。 */
const EXTENSION_LINE_LENGTH: number = 0.16;

/** 标注线颜色。 */
const DIMENSION_LINE_COLOR: number = 0x8f8f8f;

/** 当前可编辑标注线颜色。 */
const ACTIVE_DIMENSION_LINE_COLOR: number = 0x2f8df6;

/** 文字颜色。 */
const LABEL_TEXT_COLOR: string = '#333333';

/** 标签边框颜色。 */
const LABEL_BORDER_COLOR: string = '#b8b8b8';

/** 标签背景颜色。 */
const LABEL_BACKGROUND_COLOR: string = 'rgba(255,255,255,0.94)';

/** 当前可编辑标签背景颜色，用蓝底突出编辑状态。 */
const ACTIVE_LABEL_BACKGROUND_COLOR: string = '#2f8df6';

/** 当前可编辑标签文字颜色，保证蓝底下清晰可读。 */
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
const DIMENSION_GROUP_NAME: string = 'door-window-placement-dimensions';

/**
 * 门窗布置距离标注渲染器。
 * 该类只管理临时辅助标注，不参与门窗正式放置、扣洞和历史命令。
 */
export class DoorWindowPlacementDimensionRenderer {
  /** 当前渲染的临时标注组。 */
  private _group: THREE.Group | null = null;

  /** 动态标注段缓存，最多包含左右两段。 */
  private readonly _renderedSegments: RenderedDoorWindowDimensionSegment[] = [];

  /** 标注标签射线拾取器，用于点击进入尺寸编辑。 */
  private readonly _labelRaycaster: THREE.Raycaster = new THREE.Raycaster();

  /**
   * 预创建门窗布置距离标注对象池。
   * @param scene - Three.js 场景
   */
  public prepare(scene: THREE.Scene): void {
    /* 对象池初始化流程：布置开始时一次性创建固定的两段标注，后续鼠标移动只更新位置和显隐。 */
    this.ensureGroup(scene);
    this.hide();
  }

  /**
   * 刷新门窗布置距离标注。
   * @param previewMesh - 当前门窗布置预览 Mesh
   * @param wallData - 当前吸附的直墙数据
   * @param snapResult - 当前墙中线吸附结果
   * @param scene - Three.js 场景
   */
  public update(
    previewMesh: THREE.Mesh,
    wallData: StraightWallData,
    snapResult: WallSnapResult,
    scene: THREE.Scene,
    activeSide: DoorWindowDimensionActiveSide = null,
    activeInputText: string | null = null
  ): void {
    /* 标注刷新流程：只使用 prepare 阶段已创建的对象池，动态过程不新建、不销毁 GPU 资源。 */
    const group: THREE.Group | null = this._group;
    if (group === null || group.parent !== scene) {
      return;
    }
    group.name = `${DIMENSION_GROUP_NAME}-${previewMesh.uuid}`;

    const wallLength: number = DoorWindowPlacementDimensionRenderer.computeWallLength(wallData);
    if (wallLength <= RANGE_EPSILON) {
      this.hide();
      return;
    }

    previewMesh.updateMatrixWorld(true);
    const wallOrigin: THREE.Vector3 = new THREE.Vector3(wallData.start.x, 0, wallData.start.z);
    const wallDir: THREE.Vector3 = snapResult.wallDir.clone().setY(0);
    if (wallDir.lengthSq() <= RANGE_EPSILON * RANGE_EPSILON) {
      this.hide();
      return;
    }
    wallDir.normalize();

    const wallNormal: THREE.Vector3 = snapResult.wallNormal.clone().setY(0);
    if (wallNormal.lengthSq() <= RANGE_EPSILON * RANGE_EPSILON) {
      this.hide();
      return;
    }
    wallNormal.normalize();

    const previewRange: DoorWindowWallRange = DoorWindowPlacementDimensionRenderer.computeMeshWallRange(
      previewMesh,
      wallOrigin,
      wallDir
    );
    previewRange.min = Math.max(0, Math.min(wallLength, previewRange.min));
    previewRange.max = Math.max(0, Math.min(wallLength, previewRange.max));

    const placedRanges: DoorWindowWallRange[] = DoorWindowPlacementDimensionRenderer.collectPlacedDoorWindowRanges(
      scene,
      previewMesh,
      wallData.id,
      wallOrigin,
      wallDir
    );

    const segments: DoorWindowDimensionSegment[] = DoorWindowPlacementDimensionRenderer.computeDimensionSegments(
      previewRange,
      placedRanges,
      wallLength
    );

    if (segments.length === 0) {
      this.hide();
      return;
    }

    const offsetDistance: number = Math.max(wallData.thickness * 0.5 + DIMENSION_OUTSIDE_OFFSET, DIMENSION_OUTSIDE_OFFSET);
    const offsetNormal: THREE.Vector3 = wallNormal.clone().multiplyScalar(-offsetDistance);
    group.visible = true;

    for (let segmentIndex: number = 0; segmentIndex < this._renderedSegments.length; segmentIndex += 1) {
      const renderedSegment: RenderedDoorWindowDimensionSegment | undefined = this._renderedSegments[segmentIndex];
      if (renderedSegment === undefined) {
        continue;
      }
      const segment: DoorWindowDimensionSegment | undefined = segments[segmentIndex];
      if (segment === undefined) {
        renderedSegment.group.visible = false;
        continue;
      }
      const active: boolean = DoorWindowPlacementDimensionRenderer.isSegmentActive(segmentIndex, activeSide);
      const activeLabelText: string | null = active ? activeInputText : null;
      this.updateDimensionSegment(
        renderedSegment,
        segment,
        wallOrigin,
        wallDir,
        wallNormal,
        offsetNormal,
        active,
        activeLabelText
      );
    }
  }

  /**
   * 根据已放置门窗刷新距离标注。
   * @param mesh - 当前已放置门窗 Mesh
   * @param wallData - 当前门窗所属直墙数据
   * @param scene - Three.js 场景
   */
  public updateForPlacedDoorWindow(
    mesh: THREE.Mesh,
    wallData: StraightWallData,
    scene: THREE.Scene,
    activeSide: DoorWindowDimensionActiveSide = null,
    activeInputText: string | null = null
  ): void {
    /* 已放置门窗标注流程：从墙体数据和 Mesh 当前世界包围盒还原沿墙投影区间，复用布置预览的最近边界计算逻辑。 */
    const context: DoorWindowPlacementDimensionContext | null = DoorWindowPlacementDimensionRenderer.createContextFromMesh(
      mesh,
      wallData
    );
    if (context === null) {
      this.hide();
      return;
    }

    this.updateWithContext(context, scene, activeSide, activeInputText);
  }

  /**
   * 根据已放置门窗刷新已有距离标注，不创建新的动态标注对象。
   * @param mesh - 当前已放置门窗 Mesh
   * @param wallData - 当前门窗所属直墙数据
   * @param scene - Three.js 场景
   * @param activeSide - 当前键盘编辑的标注侧
   * @param activeInputText - 当前键盘输入文本，单位为毫米
   */
  public updateExistingForPlacedDoorWindow(
    mesh: THREE.Mesh,
    wallData: StraightWallData,
    scene: THREE.Scene,
    activeSide: DoorWindowDimensionActiveSide = null,
    activeInputText: string | null = null
  ): void {
    /* 编辑态刷新流程：仅复用已显示的标注对象池，避免点击标注后额外新增动态标注组。 */
    const context: DoorWindowPlacementDimensionContext | null = DoorWindowPlacementDimensionRenderer.createContextFromMesh(
      mesh,
      wallData
    );
    if (context === null) {
      this.hideExisting(scene);
      return;
    }

    this.updateWithContextInternal(context, scene, activeSide, activeInputText, false);
  }

  /**
   * 检测屏幕坐标是否命中门窗距离标注标签。
   * @param clientX - 鼠标屏幕 X 坐标。
   * @param clientY - 鼠标屏幕 Y 坐标。
   * @param camera - 当前相机。
   * @param domElement - 渲染画布元素。
   * @returns 命中标注时返回标注侧，否则返回 null。
   */
  public hitTestLabel(
    clientX: number,
    clientY: number,
    camera: THREE.Camera,
    domElement: HTMLCanvasElement
  ): DoorWindowDimensionHitResult | null {
    const group: THREE.Group | null = this._group;
    if (group === null || !group.visible) {
      return null;
    }

    const rect: DOMRect = domElement.getBoundingClientRect();
    const ndcX: number = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY: number = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._labelRaycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

    for (let segmentIndex: number = 0; segmentIndex < this._renderedSegments.length; segmentIndex += 1) {
      const renderedSegment: RenderedDoorWindowDimensionSegment | undefined = this._renderedSegments[segmentIndex];
      if (renderedSegment === undefined || !renderedSegment.group.visible) {
        continue;
      }
      const hits: THREE.Intersection[] = this._labelRaycaster.intersectObject(renderedSegment.label, false);
      if (hits.length > 0) {
        const side: DoorWindowDimensionEditSide = segmentIndex === 0 ? 'left' : 'right';
        return { side: side };
      }
    }

    return null;
  }

  /**
   * 使用完整上下文刷新门窗距离标注。
   * @param context - 门窗距离标注上下文
   * @param scene - Three.js 场景
   */
  public updateWithContext(
    context: DoorWindowPlacementDimensionContext,
    scene: THREE.Scene,
    activeSide: DoorWindowDimensionActiveSide = null,
    activeInputText: string | null = null
  ): void {
    this.updateWithContextInternal(context, scene, activeSide, activeInputText, true);
  }

  /**
   * 使用完整上下文刷新门窗距离标注。
   * @param context - 门窗距离标注上下文
   * @param scene - Three.js 场景
   * @param activeSide - 当前键盘编辑的标注侧
   * @param activeInputText - 当前键盘输入文本，单位为毫米
   * @param allowCreate - 是否允许创建新的动态标注对象池
   */
  private updateWithContextInternal(
    context: DoorWindowPlacementDimensionContext,
    scene: THREE.Scene,
    activeSide: DoorWindowDimensionActiveSide,
    activeInputText: string | null,
    allowCreate: boolean
  ): void {
    const group: THREE.Group | null = allowCreate ? this.ensureGroup(scene) : this.getExistingGroup(scene);
    if (group === null) {
      return;
    }
    group.name = `${DIMENSION_GROUP_NAME}-${context.targetMesh.uuid}`;

    const wallLength: number = DoorWindowPlacementDimensionRenderer.computeWallLength(context.wallData);
    if (wallLength <= RANGE_EPSILON) {
      this.hide();
      return;
    }

    const targetRange: DoorWindowWallRange = {
      min: Math.max(0, Math.min(wallLength, context.targetRange.min)),
      max: Math.max(0, Math.min(wallLength, context.targetRange.max)),
    };

    const placedRanges: DoorWindowWallRange[] = DoorWindowPlacementDimensionRenderer.collectPlacedDoorWindowRanges(
      scene,
      context.targetMesh,
      context.wallData.id,
      context.wallOrigin,
      context.wallDir
    );

    const segments: DoorWindowDimensionSegment[] = DoorWindowPlacementDimensionRenderer.computeDimensionSegments(
      targetRange,
      placedRanges,
      wallLength
    );

    if (segments.length === 0) {
      this.hide();
      return;
    }

    const offsetDistance: number = Math.max(
      context.wallData.thickness * 0.5 + DIMENSION_OUTSIDE_OFFSET,
      DIMENSION_OUTSIDE_OFFSET
    );
    const offsetNormal: THREE.Vector3 = context.wallNormal.clone().multiplyScalar(-offsetDistance);
    group.visible = true;

    for (let segmentIndex: number = 0; segmentIndex < this._renderedSegments.length; segmentIndex += 1) {
      const renderedSegment: RenderedDoorWindowDimensionSegment | undefined = this._renderedSegments[segmentIndex];
      if (renderedSegment === undefined) {
        continue;
      }
      const segment: DoorWindowDimensionSegment | undefined = segments[segmentIndex];
      if (segment === undefined) {
        renderedSegment.group.visible = false;
        continue;
      }
      const active: boolean = DoorWindowPlacementDimensionRenderer.isSegmentActive(segmentIndex, activeSide);
      const activeLabelText: string | null = active ? activeInputText : null;
      this.updateDimensionSegment(
        renderedSegment,
        segment,
        context.wallOrigin,
        context.wallDir,
        context.wallNormal,
        offsetNormal,
        active,
        activeLabelText
      );
    }
  }

  /**
   * 获取当前场景中已存在的标注组。
   * @param scene - Three.js 场景
   * @returns 已挂载到当前场景的标注组；不存在时返回 null
   */
  private getExistingGroup(scene: THREE.Scene): THREE.Group | null {
    if (this._group === null || this._group.parent !== scene || this._renderedSegments.length < 2) {
      return null;
    }

    return this._group;
  }

  /**
   * 仅隐藏当前场景中已存在的标注对象，不创建新对象。
   * @param scene - Three.js 场景
   */
  private hideExisting(scene: THREE.Scene): void {
    if (this.getExistingGroup(scene) === null) {
      return;
    }

    this.hide();
  }

  /**
   * 隐藏当前临时距离标注。
   * @param scene - Three.js 场景
   */
  public clear(scene: THREE.Scene): void {
    void scene;
    if (this._group === null) {
      return;
    }

    /* 清理流程只隐藏对象池，不从场景移除、不释放资源，避免 ESC 退出时触发 WebGPU Buffer 销毁问题。 */
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
        DoorWindowPlacementDimensionRenderer.disposeObject(group);
      });
    });
  }

  /** 隐藏标注组和所有标注段。 */
  private hide(): void {
    if (this._group !== null) {
      this._group.visible = false;
    }
    for (let segmentIndex: number = 0; segmentIndex < this._renderedSegments.length; segmentIndex += 1) {
      const renderedSegment: RenderedDoorWindowDimensionSegment | undefined = this._renderedSegments[segmentIndex];
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
      group.userData['isDoorWindowPlacementDimension'] = true;
      this._group = group;
    }

    if (this._group.parent !== scene) {
      scene.add(this._group);
    }

    while (this._renderedSegments.length < 2) {
      const renderedSegment: RenderedDoorWindowDimensionSegment = DoorWindowPlacementDimensionRenderer.createRenderedSegment();
      this._renderedSegments.push(renderedSegment);
      this._group.add(renderedSegment.group);
    }

    return this._group;
  }

  /**
   * 创建一段可复用的距离标注对象。
   * @returns 单段标注对象缓存
   */
  private static createRenderedSegment(): RenderedDoorWindowDimensionSegment {
    const segmentGroup: THREE.Group = new THREE.Group();
    segmentGroup.visible = false;

    const zeroPoint: THREE.Vector3 = new THREE.Vector3(0, DIMENSION_Y, 0);
    const dimensionLine: THREE.Line = DoorWindowPlacementDimensionRenderer.createLine([
      zeroPoint.clone(),
      zeroPoint.clone(),
    ]);
    segmentGroup.add(dimensionLine);

    const extensionLine: THREE.LineSegments = DoorWindowPlacementDimensionRenderer.createLineSegments([
      zeroPoint.clone(),
      zeroPoint.clone(),
      zeroPoint.clone(),
      zeroPoint.clone(),
    ]);
    segmentGroup.add(extensionLine);

    const labelResources: DoorWindowLabelSpriteResources = DoorWindowPlacementDimensionRenderer.createLabelSpriteResources('');
    segmentGroup.add(labelResources.sprite);

    return {
      group: segmentGroup,
      dimensionLine: dimensionLine,
      extensionLine: extensionLine,
      label: labelResources.sprite,
      labelCanvas: labelResources.canvas,
      labelTexture: labelResources.texture,
      labelText: '',
      active: false,
    };
  }

  /**
   * 更新单段标注对象的线段位置和文字内容。
   * @param renderedSegment - 可复用标注对象
   * @param segment - 标注段数据
   * @param wallOrigin - 墙体起点世界坐标
   * @param wallDir - 墙方向单位向量
   * @param wallNormal - 墙法线单位向量
   * @param offsetNormal - 标注整体偏移向量
   * @param active - 当前标注段是否处于可编辑状态
   */
  private updateDimensionSegment(
    renderedSegment: RenderedDoorWindowDimensionSegment,
    segment: DoorWindowDimensionSegment,
    wallOrigin: THREE.Vector3,
    wallDir: THREE.Vector3,
    wallNormal: THREE.Vector3,
    offsetNormal: THREE.Vector3,
    active: boolean,
    activeInputText: string | null
  ): void {
    const startPoint: THREE.Vector3 = DoorWindowPlacementDimensionRenderer.createDimensionPoint(
      wallOrigin,
      wallDir,
      offsetNormal,
      segment.start
    );
    const endPoint: THREE.Vector3 = DoorWindowPlacementDimensionRenderer.createDimensionPoint(
      wallOrigin,
      wallDir,
      offsetNormal,
      segment.end
    );
    const centerPoint: THREE.Vector3 = startPoint.clone().add(endPoint).multiplyScalar(0.5);

    DoorWindowPlacementDimensionRenderer.updateGeometryPoints(renderedSegment.dimensionLine.geometry, [startPoint, endPoint]);

    const halfExtension: number = EXTENSION_LINE_LENGTH * 0.5;
    const startExtensionA: THREE.Vector3 = startPoint.clone().add(wallNormal.clone().multiplyScalar(-halfExtension));
    const startExtensionB: THREE.Vector3 = startPoint.clone().add(wallNormal.clone().multiplyScalar(halfExtension));
    const endExtensionA: THREE.Vector3 = endPoint.clone().add(wallNormal.clone().multiplyScalar(-halfExtension));
    const endExtensionB: THREE.Vector3 = endPoint.clone().add(wallNormal.clone().multiplyScalar(halfExtension));
    DoorWindowPlacementDimensionRenderer.updateGeometryPoints(renderedSegment.extensionLine.geometry, [
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
      DoorWindowPlacementDimensionRenderer.drawLabelCanvas(renderedSegment.labelCanvas, labelText, active);
      renderedSegment.labelTexture.needsUpdate = true;
      renderedSegment.labelText = labelText;
      renderedSegment.active = active;
    }
    DoorWindowPlacementDimensionRenderer.updateLineColor(renderedSegment.dimensionLine, active);
    DoorWindowPlacementDimensionRenderer.updateLineColor(renderedSegment.extensionLine, active);
    renderedSegment.label.position.copy(centerPoint);
    renderedSegment.label.position.y = DIMENSION_Y + 0.02;
    renderedSegment.group.visible = true;
  }

  /**
   * 判断指定标注段是否为当前可编辑侧。
   * @param segmentIndex - 标注段索引，0 表示左侧，1 表示右侧
   * @param activeSide - 当前键盘编辑侧
   * @returns 当前段处于编辑状态时返回 true
   */
  private static isSegmentActive(segmentIndex: number, activeSide: DoorWindowDimensionActiveSide): boolean {
    if (activeSide === null) {
      return false;
    }
    if (segmentIndex === 0) {
      return activeSide === 'left';
    }
    if (segmentIndex === 1) {
      return activeSide === 'right';
    }
    return false;
  }

  /**
   * 根据编辑状态更新标注线颜色。
   * @param lineObject - 尺寸线或界线对象
   * @param active - 当前线段是否处于编辑状态
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
   * 计算直墙中心线长度。
   * @param wallData - 直墙数据
   * @returns 墙体长度，单位米
   */
  private static computeWallLength(wallData: StraightWallData): number {
    const deltaX: number = wallData.end.x - wallData.start.x;
    const deltaZ: number = wallData.end.z - wallData.start.z;
    return Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
  }

  /**
   * 计算 Mesh 世界包围盒在墙方向上的投影区间。
   * @param mesh - 门窗 Mesh
   * @param wallOrigin - 墙体起点世界坐标
   * @param wallDir - 墙方向单位向量
   * @returns 门窗沿墙投影区间
   */
  private static computeMeshWallRange(
    mesh: THREE.Mesh,
    wallOrigin: THREE.Vector3,
    wallDir: THREE.Vector3
  ): DoorWindowWallRange {
    const box: THREE.Box3 = new THREE.Box3().setFromObject(mesh);
    const corners: THREE.Vector3[] = [
      new THREE.Vector3(box.min.x, 0, box.min.z),
      new THREE.Vector3(box.max.x, 0, box.min.z),
      new THREE.Vector3(box.min.x, 0, box.max.z),
      new THREE.Vector3(box.max.x, 0, box.max.z),
    ];

    let minValue: number = Infinity;
    let maxValue: number = -Infinity;
    for (let cornerIndex: number = 0; cornerIndex < corners.length; cornerIndex += 1) {
      const corner: THREE.Vector3 | undefined = corners[cornerIndex];
      if (corner === undefined) {
        continue;
      }
      const relativeCorner: THREE.Vector3 = corner.clone().sub(wallOrigin);
      const projectedValue: number = relativeCorner.dot(wallDir);
      if (projectedValue < minValue) {
        minValue = projectedValue;
      }
      if (projectedValue > maxValue) {
        maxValue = projectedValue;
      }
    }

    return {
      min: minValue,
      max: maxValue,
    };
  }

  /**
   * 从已放置门窗 Mesh 和墙体数据创建距离标注上下文。
   * @param mesh - 当前门窗 Mesh
   * @param wallData - 当前门窗所属直墙数据
   * @returns 可用于刷新标注的上下文；墙体长度异常时返回 null
   */
  private static createContextFromMesh(
    mesh: THREE.Mesh,
    wallData: StraightWallData
  ): DoorWindowPlacementDimensionContext | null {
    const wallOrigin: THREE.Vector3 = new THREE.Vector3(wallData.start.x, 0, wallData.start.z);
    const wallDir: THREE.Vector3 = new THREE.Vector3(
      wallData.end.x - wallData.start.x,
      0,
      wallData.end.z - wallData.start.z
    );
    if (wallDir.lengthSq() <= RANGE_EPSILON * RANGE_EPSILON) {
      return null;
    }
    wallDir.normalize();

    const wallNormal: THREE.Vector3 = DoorWindowPlacementDimensionRenderer.createWallNormal(mesh, wallDir);
    mesh.updateMatrixWorld(true);
    const targetRange: DoorWindowWallRange = DoorWindowPlacementDimensionRenderer.computeMeshWallRange(
      mesh,
      wallOrigin,
      wallDir
    );

    return {
      targetMesh: mesh,
      wallData: wallData,
      wallOrigin: wallOrigin,
      wallDir: wallDir,
      wallNormal: wallNormal,
      targetRange: targetRange,
    };
  }

  /**
   * 创建与当前门窗朝向一致的墙法线。
   * @param mesh - 当前门窗 Mesh
   * @param wallDir - 墙布置方向单位向量
   * @returns 墙法线单位向量
   */
  private static createWallNormal(mesh: THREE.Mesh, wallDir: THREE.Vector3): THREE.Vector3 {
    const normalFromUserData: THREE.Vector3 | null = DoorWindowPlacementDimensionRenderer.createWallNormalFromUserData(mesh);
    if (normalFromUserData !== null) {
      return normalFromUserData;
    }

    const normalFromRotation: THREE.Vector3 = new THREE.Vector3(
      Math.sin(mesh.rotation.y),
      0,
      Math.cos(mesh.rotation.y)
    );
    if (normalFromRotation.lengthSq() > RANGE_EPSILON * RANGE_EPSILON) {
      normalFromRotation.normalize();
      return normalFromRotation;
    }

    return new THREE.Vector3(-wallDir.z, 0, wallDir.x).normalize();
  }

  /**
   * 从 Mesh userData 读取墙法线。
   * @param mesh - 当前门窗 Mesh
   * @returns 读取成功时返回单位法线，否则返回 null
   */
  private static createWallNormalFromUserData(mesh: THREE.Mesh): THREE.Vector3 | null {
    const normalX: unknown = mesh.userData['wallNormalX'];
    const normalZ: unknown = mesh.userData['wallNormalZ'];
    if (typeof normalX !== 'number' || typeof normalZ !== 'number') {
      return null;
    }

    const normal: THREE.Vector3 = new THREE.Vector3(normalX, 0, normalZ);
    if (normal.lengthSq() <= RANGE_EPSILON * RANGE_EPSILON) {
      return null;
    }
    normal.normalize();
    return normal;
  }

  /**
   * 收集同一墙体上已放置门窗的沿墙投影区间。
   * @param scene - Three.js 场景
   * @param previewMesh - 当前预览 Mesh，用于排除自身
   * @param wallId - 当前墙体 ID
   * @param wallOrigin - 墙体起点世界坐标
   * @param wallDir - 墙方向单位向量
   * @returns 同墙门窗投影区间数组
   */
  private static collectPlacedDoorWindowRanges(
    scene: THREE.Scene,
    previewMesh: THREE.Mesh,
    wallId: string,
    wallOrigin: THREE.Vector3,
    wallDir: THREE.Vector3
  ): DoorWindowWallRange[] {
    const ranges: DoorWindowWallRange[] = [];

    scene.traverse((object: THREE.Object3D): void => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }
      if (!object.visible || object.uuid === previewMesh.uuid) {
        return;
      }
      if (object.userData['isPlacementPreview'] === true) {
        return;
      }
      const category: string | undefined = object.userData['category'] as string | undefined;
      const objectWallId: string | undefined = object.userData['wallId'] as string | undefined;
      if (category === undefined || !DOOR_WINDOW_CATEGORIES.has(category) || objectWallId !== wallId) {
        return;
      }

      object.updateMatrixWorld(true);
      const range: DoorWindowWallRange = DoorWindowPlacementDimensionRenderer.computeMeshWallRange(
        object,
        wallOrigin,
        wallDir
      );
      ranges.push(range);
    });

    return ranges;
  }

  /**
   * 计算预览门窗左右两侧到最近边界的标注段。
   * @param previewRange - 预览门窗投影区间
   * @param placedRanges - 同墙已放置门窗投影区间
   * @param wallLength - 墙体长度，单位米
   * @returns 需要绘制的标注段数组
   */
  private static computeDimensionSegments(
    previewRange: DoorWindowWallRange,
    placedRanges: DoorWindowWallRange[],
    wallLength: number
  ): DoorWindowDimensionSegment[] {
    let leftBoundary: number = 0;
    let rightBoundary: number = wallLength;

    /* 左侧边界查找：优先取预览左边界之前最近的同墙门窗右边界，否则使用墙起点内侧边界。 */
    for (let placedRangeIndex: number = 0; placedRangeIndex < placedRanges.length; placedRangeIndex += 1) {
      const placedRange: DoorWindowWallRange | undefined = placedRanges[placedRangeIndex];
      if (placedRange === undefined) {
        continue;
      }
      if (placedRange.max <= previewRange.min + RANGE_EPSILON && placedRange.max > leftBoundary) {
        leftBoundary = placedRange.max;
      }
      if (placedRange.min >= previewRange.max - RANGE_EPSILON && placedRange.min < rightBoundary) {
        rightBoundary = placedRange.min;
      }
    }

    const segments: DoorWindowDimensionSegment[] = [];
    const leftDistance: number = Math.max(0, previewRange.min - leftBoundary);
    const rightDistance: number = Math.max(0, rightBoundary - previewRange.max);

    segments.push({
      start: leftBoundary,
      end: previewRange.min,
      distance: leftDistance,
    });
    segments.push({
      start: previewRange.max,
      end: rightBoundary,
      distance: rightDistance,
    });

    return segments;
  }

  /**
   * 根据沿墙投影值生成标注点世界坐标。
   * @param wallOrigin - 墙体起点世界坐标
   * @param wallDir - 墙方向单位向量
   * @param offsetNormal - 标注偏移向量
   * @param projection - 沿墙投影值，单位米
   * @returns 标注点世界坐标
   */
  private static createDimensionPoint(
    wallOrigin: THREE.Vector3,
    wallDir: THREE.Vector3,
    offsetNormal: THREE.Vector3,
    projection: number
  ): THREE.Vector3 {
    const point: THREE.Vector3 = wallOrigin.clone().add(wallDir.clone().multiplyScalar(projection)).add(offsetNormal);
    point.y = DIMENSION_Y;
    return point;
  }

  /**
   * 创建尺寸线。
   * @param points - 线段点数组
   * @returns Three.js Line
   */
  private static createLine(points: THREE.Vector3[]): THREE.Line {
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const material: THREE.LineBasicMaterial = DoorWindowPlacementDimensionRenderer.createLineMaterial();
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
    const material: THREE.LineBasicMaterial = DoorWindowPlacementDimensionRenderer.createLineMaterial();
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
   * 创建白底距离文字 Sprite 及其可复用贴图资源。
   * @param text - 标签文本
   * @returns Sprite 与画布贴图资源
   */
  private static createLabelSpriteResources(text: string): DoorWindowLabelSpriteResources {
    const canvas: HTMLCanvasElement = document.createElement('canvas');
    canvas.width = LABEL_CANVAS_WIDTH;
    canvas.height = LABEL_CANVAS_HEIGHT;
    DoorWindowPlacementDimensionRenderer.drawLabelCanvas(canvas, text, false);

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
   * @param active - 当前标签是否处于可编辑状态
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
    /* 标签重绘流程：编辑态绘制蓝底白字，非编辑态保持白底深色文字，便于观察当前可修改标注。 */
    DoorWindowPlacementDimensionRenderer.drawRoundRect(context, 12, 14, 216, 68, 10);
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
            DoorWindowPlacementDimensionRenderer.disposeMaterial(material);
          }
        } else {
          DoorWindowPlacementDimensionRenderer.disposeMaterial(materialOwner.material);
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