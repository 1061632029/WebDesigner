/**
 * 鼠标悬停轮廓辅助工具
 * 优先根据目标 Mesh 的真实几何边绘制 3D 轮廓线，用于鼠标移动命中模型时的轻量视觉提示。
 */

import * as THREE from 'three/webgpu';
import { StlObbHelper, type StlObb2D } from '../model/StlObbHelper';

/** 悬停轮廓线颜色（橙黄色）。 */
const HOVER_OUTLINE_COLOR: number = 0xffcc33;

/** 悬停轮廓线渲染顺序，确保尽量显示在普通模型之后。 */
const HOVER_OUTLINE_RENDER_ORDER: number = 998;

/** Mesh 几何边提取角度阈值，超过该夹角的折角边会被显示为悬停轮廓。 */
const EDGE_THRESHOLD_ANGLE_DEGREES: number = 15;

/** 包围盒最小有效尺寸，避免退化包围盒导致轮廓不可见。 */
const MIN_BOX_SIZE: number = 0.001;

/** 包围盒退化时的扩展半径。 */
const DEGENERATE_BOX_EXPAND_SIZE: number = 0.02;

/** 悬停轮廓对象在 userData 中的标记键名。 */
const HOVER_OUTLINE_MARK_KEY: string = '__hoverOutline__';

/** STL 常规模型在 userData 中的模型标识键名。 */
const STL_MODEL_ID_KEY: string = 'stlModelId';

/**
 * 鼠标悬停轮廓辅助类。
 * 只负责根据当前悬停 Object3D 创建、更新与释放轮廓线，不修改业务对象材质。
 */
export class HoverOutlineHelper {
  /** 当前被绘制轮廓的对象 UUID。 */
  private _currentTargetUuid: string | null = null;

  /** 当前场景中的轮廓线对象。 */
  private _outline: THREE.LineSegments | null = null;

  /**
   * 显示指定对象的悬停轮廓。
   * @param target - 当前鼠标命中的目标对象
   * @param scene - Three.js 场景，轮廓线会挂载到场景根节点
   */
  public show(target: THREE.Object3D, scene: THREE.Scene): void {
    /* 同一对象重复触发时仅刷新世界矩阵和轮廓几何，避免频繁重建材质对象。 */
    target.updateMatrixWorld(true);

    const outlineGeometry: THREE.BufferGeometry | null = HoverOutlineHelper._createOutlineGeometry(target);
    if (outlineGeometry === null) {
      this.clear(scene);
      return;
    }

    if (this._outline !== null && this._currentTargetUuid === target.uuid) {
      HoverOutlineHelper._replaceOutlineGeometry(this._outline, outlineGeometry);
      return;
    }

    this.clear(scene);

    const outline: THREE.LineSegments = HoverOutlineHelper._createOutline(outlineGeometry);
    outline.userData[HOVER_OUTLINE_MARK_KEY] = true;
    scene.add(outline);

    this._outline = outline;
    this._currentTargetUuid = target.uuid;
  }

  /**
   * 清除当前悬停轮廓并释放几何体、材质资源。
   * @param scene - Three.js 场景
   */
  public clear(scene: THREE.Scene): void {
    if (this._outline === null) {
      this._currentTargetUuid = null;
      return;
    }

    scene.remove(this._outline);
    this._outline.geometry.dispose();

    if (Array.isArray(this._outline.material)) {
      const materials: THREE.Material[] = this._outline.material;
      for (const material of materials) {
        material.dispose();
      }
    } else {
      this._outline.material.dispose();
    }

    this._outline = null;
    this._currentTargetUuid = null;
  }

  /**
   * 判断对象是否为本辅助类创建的悬停轮廓。
   * @param object - 待判断对象
   * @returns 是悬停轮廓时返回 true
   */
  public static isHoverOutline(object: THREE.Object3D): boolean {
    return object.userData[HOVER_OUTLINE_MARK_KEY] === true;
  }

  /**
   * 根据目标对象创建悬停轮廓几何体。
   * 关键流程：STL 常规模型直接使用 OBB；非 STL Mesh 优先提取真实折角边；几何体无法提取有效边时回退到世界包围盒。
   * @param target - 当前鼠标命中的目标对象
   * @returns 轮廓几何体；目标无有效空间范围时返回 null
   */
  private static _createOutlineGeometry(target: THREE.Object3D): THREE.BufferGeometry | null {
    /* STL 模型通常三角面数量较多，悬停时不计算实际边线，避免性能开销和复杂边线干扰观察。 */
    if (HoverOutlineHelper._isStlModel(target)) {
      return HoverOutlineHelper._createStlObbOutlineGeometry(target);
    }

    if (target instanceof THREE.Mesh) {
      const meshOutlineGeometry: THREE.BufferGeometry | null = HoverOutlineHelper._createMeshEdgeGeometry(target);
      if (meshOutlineGeometry !== null) {
        return meshOutlineGeometry;
      }
    }

    return HoverOutlineHelper._createBoxOutlineGeometry(target);
  }

  /**
   * 判断目标对象是否为 STL 常规模型。
   * @param target - 当前鼠标命中的目标对象
   * @returns 是 STL 常规模型时返回 true
   */
  private static _isStlModel(target: THREE.Object3D): boolean {
    const stlModelId: unknown = target.userData[STL_MODEL_ID_KEY];
    return typeof stlModelId === 'string';
  }

  /**
   * 根据 Mesh 原始几何体提取真实边线轮廓。
   * @param mesh - 当前鼠标命中的 Mesh
   * @returns 已转换到世界坐标的边线几何体；无有效顶点时返回 null
   */
  private static _createMeshEdgeGeometry(mesh: THREE.Mesh): THREE.BufferGeometry | null {
    const sourceGeometry: THREE.BufferGeometry | undefined = mesh.geometry as THREE.BufferGeometry | undefined;
    if (sourceGeometry === undefined || sourceGeometry.getAttribute('position') === undefined) {
      return null;
    }

    /* EdgesGeometry 只提取边界边和折角边，避免把三角剖分线全部显示出来影响模型识别。 */
    const edgeGeometry: THREE.EdgesGeometry = new THREE.EdgesGeometry(
      sourceGeometry,
      EDGE_THRESHOLD_ANGLE_DEGREES
    );
    const positionAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined = edgeGeometry.getAttribute('position');
    if (positionAttribute === undefined || positionAttribute.count === 0) {
      edgeGeometry.dispose();
      return null;
    }

    edgeGeometry.applyMatrix4(mesh.matrixWorld);
    edgeGeometry.computeBoundingSphere();
    return edgeGeometry;
  }

  /**
   * 根据目标对象世界包围盒创建兜底轮廓几何体。
   * @param target - 当前鼠标命中的目标对象
   * @returns 包围盒轮廓几何体；目标包围盒为空时返回 null
   */
  private static _createBoxOutlineGeometry(target: THREE.Object3D): THREE.BufferGeometry | null {
    const worldBox: THREE.Box3 = new THREE.Box3().setFromObject(target);
    if (worldBox.isEmpty()) {
      return null;
    }

    HoverOutlineHelper._ensureBoxVisible(worldBox);

    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    const positions: Float32Array = HoverOutlineHelper._createBoxLinePositions(worldBox);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }

  /**
   * 根据 STL Mesh 的 XZ 平面 OBB 创建悬停轮廓几何体。
   * 关键流程：水平四角使用模型朝向 OBB，竖向高度沿用世界包围盒，避免旋转 STL 的悬停框退回 AABB。
   * @param target - 当前鼠标命中的 STL 对象
   * @returns OBB 轮廓几何体；目标不是 Mesh 或无有效高度范围时返回 null
   */
  private static _createStlObbOutlineGeometry(target: THREE.Object3D): THREE.BufferGeometry | null {
    if (!(target instanceof THREE.Mesh)) {
      return HoverOutlineHelper._createBoxOutlineGeometry(target);
    }

    const worldBox: THREE.Box3 = new THREE.Box3().setFromObject(target);
    if (worldBox.isEmpty()) {
      return null;
    }

    HoverOutlineHelper._ensureBoxVisible(worldBox);

    const obb: StlObb2D = StlObbHelper.computeObb2D(target);
    const visibleCorners: THREE.Vector3[] = HoverOutlineHelper._createVisibleObbCorners(obb);
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    const positions: Float32Array = HoverOutlineHelper._createObbLinePositions(
      visibleCorners,
      worldBox.min.y,
      worldBox.max.y
    );
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }

  /**
   * 创建指定几何体对应的 LineSegments。
   * @param geometry - 已经转换到世界坐标的轮廓几何体
   * @returns 轮廓线对象
   */
  private static _createOutline(geometry: THREE.BufferGeometry): THREE.LineSegments {
    const material: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
      color: HOVER_OUTLINE_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });

    const outline: THREE.LineSegments = new THREE.LineSegments(geometry, material);
    outline.renderOrder = HOVER_OUTLINE_RENDER_ORDER;
    return outline;
  }

  /**
   * 替换已有轮廓线的几何数据。
   * @param outline - 当前轮廓线对象
   * @param geometry - 最新轮廓几何体
   */
  private static _replaceOutlineGeometry(outline: THREE.LineSegments, geometry: THREE.BufferGeometry): void {
    const oldGeometry: THREE.BufferGeometry = outline.geometry;
    outline.geometry = geometry;
    oldGeometry.dispose();
  }

  /**
   * 生成包围盒 12 条边的顶点坐标数组。
   * @param box - 世界坐标包围盒
   * @returns 线段顶点坐标数组
   */
  private static _createBoxLinePositions(box: THREE.Box3): Float32Array {
    const minX: number = box.min.x;
    const minY: number = box.min.y;
    const minZ: number = box.min.z;
    const maxX: number = box.max.x;
    const maxY: number = box.max.y;
    const maxZ: number = box.max.z;

    return new Float32Array([
      minX, minY, minZ, maxX, minY, minZ,
      maxX, minY, minZ, maxX, minY, maxZ,
      maxX, minY, maxZ, minX, minY, maxZ,
      minX, minY, maxZ, minX, minY, minZ,

      minX, maxY, minZ, maxX, maxY, minZ,
      maxX, maxY, minZ, maxX, maxY, maxZ,
      maxX, maxY, maxZ, minX, maxY, maxZ,
      minX, maxY, maxZ, minX, maxY, minZ,

      minX, minY, minZ, minX, maxY, minZ,
      maxX, minY, minZ, maxX, maxY, minZ,
      maxX, minY, maxZ, maxX, maxY, maxZ,
      minX, minY, maxZ, minX, maxY, maxZ,
    ]);
  }

  /**
   * 生成 OBB 12 条边的顶点坐标数组。
   * @param corners - OBB 水平四角，顺序为 minU/minV、maxU/minV、maxU/maxV、minU/maxV
   * @param minY - 轮廓底部世界高度
   * @param maxY - 轮廓顶部世界高度
   * @returns 线段顶点坐标数组
   */
  private static _createObbLinePositions(corners: THREE.Vector3[], minY: number, maxY: number): Float32Array {
    const firstCorner: THREE.Vector3 = corners[0]!;
    const secondCorner: THREE.Vector3 = corners[1]!;
    const thirdCorner: THREE.Vector3 = corners[2]!;
    const fourthCorner: THREE.Vector3 = corners[3]!;

    return new Float32Array([
      firstCorner.x, minY, firstCorner.z, secondCorner.x, minY, secondCorner.z,
      secondCorner.x, minY, secondCorner.z, thirdCorner.x, minY, thirdCorner.z,
      thirdCorner.x, minY, thirdCorner.z, fourthCorner.x, minY, fourthCorner.z,
      fourthCorner.x, minY, fourthCorner.z, firstCorner.x, minY, firstCorner.z,

      firstCorner.x, maxY, firstCorner.z, secondCorner.x, maxY, secondCorner.z,
      secondCorner.x, maxY, secondCorner.z, thirdCorner.x, maxY, thirdCorner.z,
      thirdCorner.x, maxY, thirdCorner.z, fourthCorner.x, maxY, fourthCorner.z,
      fourthCorner.x, maxY, fourthCorner.z, firstCorner.x, maxY, firstCorner.z,

      firstCorner.x, minY, firstCorner.z, firstCorner.x, maxY, firstCorner.z,
      secondCorner.x, minY, secondCorner.z, secondCorner.x, maxY, secondCorner.z,
      thirdCorner.x, minY, thirdCorner.z, thirdCorner.x, maxY, thirdCorner.z,
      fourthCorner.x, minY, fourthCorner.z, fourthCorner.x, maxY, fourthCorner.z,
    ]);
  }

  /**
   * 创建具备最小可见尺寸的 OBB 四角。
   * @param obb - STL XZ 平面 OBB 数据
   * @returns 修正退化尺寸后的 OBB 四角
   */
  private static _createVisibleObbCorners(obb: StlObb2D): THREE.Vector3[] {
    const halfU: number = obb.halfU < MIN_BOX_SIZE ? DEGENERATE_BOX_EXPAND_SIZE : obb.halfU;
    const halfV: number = obb.halfV < MIN_BOX_SIZE ? DEGENERATE_BOX_EXPAND_SIZE : obb.halfV;

    /* 非退化 OBB 直接复用计算结果，避免重复计算带来浮点误差。 */
    if (halfU === obb.halfU && halfV === obb.halfV) {
      return obb.corners.map((corner: THREE.Vector3): THREE.Vector3 => corner.clone());
    }

    return [
      HoverOutlineHelper._createObbCorner(obb.center, obb.axisU, obb.axisV, -halfU, -halfV),
      HoverOutlineHelper._createObbCorner(obb.center, obb.axisU, obb.axisV, halfU, -halfV),
      HoverOutlineHelper._createObbCorner(obb.center, obb.axisU, obb.axisV, halfU, halfV),
      HoverOutlineHelper._createObbCorner(obb.center, obb.axisU, obb.axisV, -halfU, halfV),
    ];
  }

  /**
   * 按 OBB 中心、轴向与半尺寸创建角点。
   * @param center - OBB 中心点
   * @param axisU - OBB U 轴方向
   * @param axisV - OBB V 轴方向
   * @param offsetU - U 轴偏移量
   * @param offsetV - V 轴偏移量
   * @returns OBB 角点
   */
  private static _createObbCorner(
    center: THREE.Vector3,
    axisU: THREE.Vector3,
    axisV: THREE.Vector3,
    offsetU: number,
    offsetV: number
  ): THREE.Vector3 {
    const corner: THREE.Vector3 = center.clone();
    corner.add(axisU.clone().multiplyScalar(offsetU));
    corner.add(axisV.clone().multiplyScalar(offsetV));
    return corner;
  }

  /**
   * 确保包围盒在任一轴向退化时仍有可见轮廓。
   * @param box - 待修正包围盒
   */
  private static _ensureBoxVisible(box: THREE.Box3): void {
    const size: THREE.Vector3 = new THREE.Vector3();
    box.getSize(size);

    /* 当某个轴向尺寸过小时，向该轴两侧扩展，避免平面或线状对象轮廓无法被看见。 */
    if (size.x < MIN_BOX_SIZE) {
      box.min.x -= DEGENERATE_BOX_EXPAND_SIZE;
      box.max.x += DEGENERATE_BOX_EXPAND_SIZE;
    }
    if (size.y < MIN_BOX_SIZE) {
      box.min.y -= DEGENERATE_BOX_EXPAND_SIZE;
      box.max.y += DEGENERATE_BOX_EXPAND_SIZE;
    }
    if (size.z < MIN_BOX_SIZE) {
      box.min.z -= DEGENERATE_BOX_EXPAND_SIZE;
      box.max.z += DEGENERATE_BOX_EXPAND_SIZE;
    }
  }
}