/**
 * 2D 平面投影包围盒辅助工具
 * 将 STL 模型的 2D OBB 投影到 XZ 平面，绘制有向矩形边线和控制点。
 *
 * 提供两种模式：
 * - attachOutline：仅绘制 4 条边线（用于布置预览）
 * - attachFull：绘制 4 条边线 + 8 个控制点（用于选中状态）
 *
 * 包围盒 Group 挂载到场景根节点（而非 Mesh 子对象），
 * 避免继承父 Mesh 的 scale 导致控制点尺寸异常。
 */

import * as THREE from 'three/webgpu';
import { StlObbHelper } from '../model/StlObbHelper';
import type { StlObb2D } from '../model/StlObbHelper';

/** 包围盒 Group 在 userData 中的 ownerUuid 键名 */
const BBOX_OWNER_UUID_KEY: string = '__bboxOwnerUuid__';

/** 旋转标注对象在 userData 中的可拾取标识键名 */
const ROTATE_ANNOTATION_PICKABLE_KEY: string = '__stlRotateAnnotationPickable__';

/** 包围盒边线颜色（蓝色） */
const BBOX_LINE_COLOR: number = 0x44aaff;

/** 控制点颜色（蓝色） */
const BBOX_POINT_COLOR: number = 0x44aaff;

/** 控制点半径（米，世界坐标） */
const BBOX_POINT_RADIUS: number = 0.08;

/** 控制点圆形分段数 */
const BBOX_POINT_SEGMENTS: number = 8;

/** 包围盒绘制高度偏移（世界坐标 Y，微高于地面避免 Z-fighting） */
const BBOX_Y: number = 0.01;

/** 旋转标注绘制高度，抬高到网格和 STL 顶面之上，避免贴地透明面片被遮挡。 */
const ROTATE_ANNOTATION_Y: number = 0.16;

/** STL 模型标识在 userData 中的键名。 */
const STL_MODEL_ID_KEY: string = 'stlModelId';

/** 旋转标注颜色（浅蓝色） */
const ROTATE_ANNOTATION_COLOR: number = 0x8bbff4;

/** 旋转标注渲染层级，需高于选中框控制点 */
const ROTATE_ANNOTATION_RENDER_ORDER: number = 1001;

/** 旋转标注距离选中框下边的屏幕像素距离 */
const ROTATE_ANNOTATION_OFFSET_PIXELS: number = 18;

/** 旋转标注弧线半径，单位为逻辑屏幕像素 */
const ROTATE_ANNOTATION_RADIUS_PIXELS: number = 42;

/** 旋转标注弧线宽度，单位为逻辑屏幕像素 */
const ROTATE_ANNOTATION_ARC_WIDTH_PIXELS: number = 9;

/** 旋转标注弧线中心下移距离，单位为逻辑屏幕像素 */
const ROTATE_ANNOTATION_ARC_CENTER_Z_PIXELS: number = 12;

/** 旋转标注箭头尺寸，单位为逻辑屏幕像素 */
const ROTATE_ANNOTATION_ARROW_SIZE_PIXELS: number = 14;

/** 旋转标注弧线采样分段数 */
const ROTATE_ANNOTATION_ARC_SEGMENTS: number = 24;

/** 旋转标注初始世界缩放，避免首帧缩放回调未触发时标注远离视野 */
const ROTATE_ANNOTATION_INITIAL_WORLD_SCALE: number = 0.01;

/** 旋转拖拽轮盘浅蓝色背景。 */
const ROTATE_WHEEL_BACKGROUND_COLOR: number = 0x8bbff4;

/** 旋转拖拽轮盘深蓝色可变区。 */
const ROTATE_WHEEL_ACTIVE_COLOR: number = 0x1e7ff2;

/** 旋转拖拽轮盘白色分段刻度。 */
const ROTATE_WHEEL_TICK_COLOR: number = 0xffffff;

/** 旋转拖拽轮盘半径，单位为逻辑屏幕像素。 */
const ROTATE_WHEEL_RADIUS_PIXELS: number = 86;

/** 旋转拖拽轮盘宽度，单位为逻辑屏幕像素。 */
const ROTATE_WHEEL_WIDTH_PIXELS: number = 10;

/** 旋转拖拽轮盘采样分段数。 */
const ROTATE_WHEEL_SEGMENTS: number = 96;

/** 旋转拖拽轮盘每 45° 绘制一条白色分段刻度。 */
const ROTATE_WHEEL_TICK_STEP_DEGREES: number = 45;

/** 旋转拖拽轮盘深蓝可变区固定夹角。 */
const ROTATE_WHEEL_ACTIVE_SWEEP_DEGREES: number = 90;

/** 旋转拖拽轮盘刻度外扩长度，单位为逻辑屏幕像素。 */
const ROTATE_WHEEL_TICK_OUTSET_PIXELS: number = 3;

/** 旋转拖拽轮盘刻度内收长度，单位为逻辑屏幕像素。 */
const ROTATE_WHEEL_TICK_INSET_PIXELS: number = 3;

/** 门窗类型集合：普通 STL 旋转标注需要排除门窗构件。 */
const DOOR_WINDOW_CATEGORY_SET: ReadonlySet<string> = new Set<string>(['door', 'window']);

/** 渲染器尺寸读取接口，用于兼容 three/webgpu 中较窄的 Renderer 类型声明 */
interface RotateAnnotationRendererSizeSource {
  /** 可选的 Three.js 渲染尺寸读取方法 */
  getSize?: (target: THREE.Vector2) => THREE.Vector2;
  /** 渲染器画布，用于 getSize 不可用时兜底读取高度 */
  domElement?: HTMLCanvasElement;
}

/**
 * 2D 平面投影包围盒辅助工具（静态工具类）
 * 在 2D 俯视模式下为 STL 模型 Mesh 附加 XZ 平面投影包围盒
 */
export class BoundingBoxHelper {
  /**
   * 判断射线是否命中指定 Mesh 所属的旋转标注。
   * 关键流程：遍历场景根节点中当前 Mesh 的包围盒 Group，仅对带旋转标注拾取标识的子对象执行射线命中检测。
   * @param mesh - 当前选中的 STL 模型
   * @param scene - Three.js 场景
   * @param raycaster - 已按鼠标屏幕坐标设置好的射线投射器
   * @returns 命中当前模型旋转标注时返回 true，否则返回 false
   */
  public static hitTestRotateAnnotation(
    mesh: THREE.Object3D,
    scene: THREE.Scene,
    raycaster: THREE.Raycaster
  ): boolean {
    const rotateTargets: THREE.Object3D[] = [];

    /* 只收集当前选中 Mesh 的旋转标注对象，避免其它模型的隐藏或残留对象抢占输入。 */
    scene.traverse((obj: THREE.Object3D): void => {
      if (obj.userData[BBOX_OWNER_UUID_KEY] !== mesh.uuid) {
        return;
      }

      obj.traverse((child: THREE.Object3D): void => {
        if (child.userData[ROTATE_ANNOTATION_PICKABLE_KEY] === true) {
          rotateTargets.push(child);
        }
      });
    });

    if (rotateTargets.length === 0) {
      return false;
    }

    const hits: THREE.Intersection[] = raycaster.intersectObjects(rotateTargets, false);
    return hits.length > 0;
  }

  /**
   * 为指定 Mesh 附加仅含边线的包围盒（用于布置预览）
   * 若已存在包围盒则先移除旧的再创建新的
   * @param mesh - 目标 STL 模型 Mesh
   * @param scene - Three.js 场景（包围盒 Group 挂载到场景根节点）
   */
  public static attachOutline(mesh: THREE.Object3D, scene: THREE.Scene): void {
    /* 先移除旧的包围盒 */
    BoundingBoxHelper.detach(mesh, scene);

    /* 计算 Mesh 在世界坐标系 XZ 平面的 OBB，保证旋转模型的选中框跟随模型朝向。 */
    const obb: StlObb2D | null = BoundingBoxHelper._computeMeshObb(mesh);
    if (obb === null) {
      return;
    }
    const y: number = BBOX_Y;

    /* ========== 4 个 OBB 角点坐标（世界坐标 XZ 平面投影） ========== */
    const p1: THREE.Vector3 = BoundingBoxHelper._createGroundPoint(obb.corners[0], y);
    const p2: THREE.Vector3 = BoundingBoxHelper._createGroundPoint(obb.corners[1], y);
    const p3: THREE.Vector3 = BoundingBoxHelper._createGroundPoint(obb.corners[2], y);
    const p4: THREE.Vector3 = BoundingBoxHelper._createGroundPoint(obb.corners[3], y);

    /* ========== 创建 Group 容器 ========== */
    const group: THREE.Group = new THREE.Group();
    /* 记录关联的 Mesh UUID，用于 detach 时查找 */
    group.userData[BBOX_OWNER_UUID_KEY] = mesh.uuid;

    /* ========== 4 条边线 ========== */
    group.add(BoundingBoxHelper._createLineSegments(p1, p2, p3, p4));

    /* 将包围盒 Group 挂载到场景根节点（不受父 Mesh scale 影响） */
    scene.add(group);
  }

  /**
   * 为指定 Mesh 附加完整包围盒（边线 + 控制点，用于选中状态）
   * 若已存在包围盒则先移除旧的再创建新的
   * @param mesh - 目标 STL 模型 Mesh
   * @param scene - Three.js 场景（包围盒 Group 挂载到场景根节点）
   */
  public static attachFull(mesh: THREE.Object3D, scene: THREE.Scene): void {
    /* 先移除旧的包围盒 */
    BoundingBoxHelper.detach(mesh, scene);

    /* 计算 Mesh 在世界坐标系 XZ 平面的 OBB，保证旋转模型的控制点跟随模型朝向。 */
    const obb: StlObb2D | null = BoundingBoxHelper._computeMeshObb(mesh);
    if (obb === null) {
      return;
    }
    const y: number = BBOX_Y;

    /* ========== 4 个 OBB 角点坐标（世界坐标 XZ 平面投影） ========== */
    const p1: THREE.Vector3 = BoundingBoxHelper._createGroundPoint(obb.corners[0], y); // 左前
    const p2: THREE.Vector3 = BoundingBoxHelper._createGroundPoint(obb.corners[1], y); // 右前
    const p3: THREE.Vector3 = BoundingBoxHelper._createGroundPoint(obb.corners[2], y); // 右后
    const p4: THREE.Vector3 = BoundingBoxHelper._createGroundPoint(obb.corners[3], y); // 左后

    /* ========== 4 个边线中点坐标 ========== */
    const mp12: THREE.Vector3 = p1.clone().add(p2).multiplyScalar(0.5); // 前边中点
    const mp23: THREE.Vector3 = p2.clone().add(p3).multiplyScalar(0.5); // 右边中点
    const mp34: THREE.Vector3 = p3.clone().add(p4).multiplyScalar(0.5); // 后边中点
    const mp41: THREE.Vector3 = p4.clone().add(p1).multiplyScalar(0.5); // 左边中点

    /* ========== 创建 Group 容器 ========== */
    const group: THREE.Group = new THREE.Group();
    group.userData[BBOX_OWNER_UUID_KEY] = mesh.uuid;

    /* ========== 4 条边线 ========== */
    group.add(BoundingBoxHelper._createLineSegments(p1, p2, p3, p4));

    /* ========== 8 个控制点（4 角点 + 4 中点） ========== */
    const pointPositions: THREE.Vector3[] = [p1, p2, p3, p4, mp12, mp23, mp34, mp41];

    /* 共享材质（同一 Group 内所有点颜色相同） */
    const pointMaterial: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({
      color: BBOX_POINT_COLOR,
      depthTest: false,
      side: THREE.DoubleSide,
    });

    for (const pos of pointPositions) {
      /* 每个控制点独立的 CircleGeometry，避免共享导致 dispose 问题 */
      const pointGeometry: THREE.CircleGeometry = new THREE.CircleGeometry(BBOX_POINT_RADIUS, BBOX_POINT_SEGMENTS);
      /* 将圆形旋转到 XZ 平面（默认在 XY 平面） */
      pointGeometry.rotateX(-Math.PI / 2);

      const pointMesh: THREE.Mesh = new THREE.Mesh(pointGeometry, pointMaterial);
      pointMesh.position.copy(pos);
      pointMesh.renderOrder = 1000;
      group.add(pointMesh);
    }

    /* 普通 STL 模型选中时，在下方追加固定屏幕尺寸的旋转标注。 */
    if (BoundingBoxHelper._shouldShowRotateAnnotation(mesh)) {
      const rotateAnnotationAnchor: THREE.Vector3 = BoundingBoxHelper._getRotateAnnotationAnchor(mesh, obb);
      const rotateAnnotationRotationY: number = BoundingBoxHelper._getObjectWorldRotationY(mesh);
      const rotateAnnotation: THREE.Group = BoundingBoxHelper._createRotateAnnotationGroup(
        rotateAnnotationAnchor.x,
        rotateAnnotationAnchor.z,
        rotateAnnotationRotationY
      );
      group.add(rotateAnnotation);
    }

    /* 将包围盒 Group 挂载到场景根节点 */
    scene.add(group);
  }

  /**
   * 为指定 Mesh 附加旋转拖拽态包围盒与中心轮盘。
   * 关键流程：拖拽开始后隐藏普通旋转箭头，改为以模型旋转中心为圆心绘制固定屏幕尺寸轮盘。
   * @param mesh - 目标 STL 模型 Mesh
   * @param scene - Three.js 场景
   * @param rotationY - 当前 Mesh 的 Y 轴旋转角，单位弧度
   * @param fixedWorldScale - 拖拽开始时计算出的固定世界缩放，用于避免轮盘重建首帧忽大忽小
   */
  public static attachRotatingWheel(
    mesh: THREE.Object3D,
    scene: THREE.Scene,
    rotationY: number,
    fixedWorldScale?: number
  ): void {
    /* 先移除旧包围盒，保证拖拽态轮盘与包围盒同步刷新且不会残留普通旋转箭头。 */
    BoundingBoxHelper.detach(mesh, scene);

    const obb: StlObb2D | null = BoundingBoxHelper._computeMeshObb(mesh);
    if (obb === null) {
      return;
    }
    const y: number = BBOX_Y;

    const p1: THREE.Vector3 = BoundingBoxHelper._createGroundPoint(obb.corners[0], y);
    const p2: THREE.Vector3 = BoundingBoxHelper._createGroundPoint(obb.corners[1], y);
    const p3: THREE.Vector3 = BoundingBoxHelper._createGroundPoint(obb.corners[2], y);
    const p4: THREE.Vector3 = BoundingBoxHelper._createGroundPoint(obb.corners[3], y);

    const group: THREE.Group = new THREE.Group();
    group.userData[BBOX_OWNER_UUID_KEY] = mesh.uuid;
    group.add(BoundingBoxHelper._createLineSegments(p1, p2, p3, p4));

    if (BoundingBoxHelper._shouldShowRotateAnnotation(mesh)) {
      const wheelCenter: THREE.Vector3 = BoundingBoxHelper._getObjectWorldCenter(mesh, obb);
      const wheelActiveCenterAngle: number = BoundingBoxHelper._getRotateDirectionAngle(rotationY);
      const wheelGroup: THREE.Group = BoundingBoxHelper._createRotateWheelGroup(
        wheelCenter.x,
        wheelCenter.z,
        wheelActiveCenterAngle,
        fixedWorldScale
      );
      group.add(wheelGroup);
    }

    scene.add(group);
  }

  /**
   * 移除指定 Mesh 关联的包围盒 Group
   * 从场景根节点中查找 userData[BBOX_OWNER_UUID_KEY] === mesh.uuid 的 Group 并移除
   * @param mesh - 目标 STL 模型 Mesh
   * @param scene - Three.js 场景
   */
  public static detach(mesh: THREE.Object3D, scene: THREE.Scene): void {
    const toRemove: THREE.Object3D[] = [];

    /* 遍历场景直接子对象，查找关联的包围盒 Group */
    for (const child of scene.children) {
      if (child.userData[BBOX_OWNER_UUID_KEY] === mesh.uuid) {
        toRemove.push(child);
      }
    }

    for (const obj of toRemove) {
      /* 释放几何体和材质资源 */
      BoundingBoxHelper._disposeGroup(obj);
      scene.remove(obj);
    }
  }

  /* ========== 内部辅助方法 ========== */

  /**
   * 计算 STL Mesh 的 XZ 平面 OBB。
   * @param mesh - 目标对象
   * @returns Mesh 对象的 OBB；非 Mesh 或退化模型返回 null
   */
  private static _computeMeshObb(mesh: THREE.Object3D): StlObb2D | null {
    if (!(mesh instanceof THREE.Mesh)) {
      return null;
    }

    const obb: StlObb2D = StlObbHelper.computeObb2D(mesh);
    if (obb.halfU <= 0 && obb.halfV <= 0) {
      return null;
    }

    return obb;
  }

  /**
   * 将 OBB 角点转换为包围盒绘制高度上的世界坐标。
   * @param point - OBB 角点
   * @param y - 绘制高度
   * @returns 固定高度后的角点坐标
   */
  private static _createGroundPoint(point: THREE.Vector3 | undefined, y: number): THREE.Vector3 {
    if (point === undefined) {
      return new THREE.Vector3(0, y, 0);
    }

    return new THREE.Vector3(point.x, y, point.z);
  }

  /**
   * 创建 4 条边线的 LineSegments 对象
   * @param p1 - 左前角点
   * @param p2 - 右前角点
   * @param p3 - 右后角点
   * @param p4 - 左后角点
   * @returns LineSegments 对象
   */
  private static _createLineSegments(
    p1: THREE.Vector3,
    p2: THREE.Vector3,
    p3: THREE.Vector3,
    p4: THREE.Vector3
  ): THREE.LineSegments {
    const linePositions: Float32Array = new Float32Array([
      /* 前边：p1 → p2 */
      p1.x, p1.y, p1.z,  p2.x, p2.y, p2.z,
      /* 右边：p2 → p3 */
      p2.x, p2.y, p2.z,  p3.x, p3.y, p3.z,
      /* 后边：p3 → p4 */
      p3.x, p3.y, p3.z,  p4.x, p4.y, p4.z,
      /* 左边：p4 → p1 */
      p4.x, p4.y, p4.z,  p1.x, p1.y, p1.z,
    ]);

    const lineGeometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));

    const lineMaterial: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
      color: BBOX_LINE_COLOR,
      depthTest: false,
    });

    const lineSegments: THREE.LineSegments = new THREE.LineSegments(lineGeometry, lineMaterial);
    lineSegments.renderOrder = 999;
    return lineSegments;
  }

  /**
   * 判断指定 STL 对象是否需要显示旋转标注。
   * @param mesh - 待判断的 STL 对象
   * @returns 仅普通 model 类型返回 true，门窗等构件不显示
   */
  private static _shouldShowRotateAnnotation(mesh: THREE.Object3D): boolean {
    const category: unknown = mesh.userData['category'];
    const stlModelId: unknown = mesh.userData[STL_MODEL_ID_KEY];

    /* 普通 model 类型直接显示；若旧数据未写入 category，则用 stlModelId 兜底识别 STL，并排除门窗类型。 */
    if (category === 'model') {
      return true;
    }

    if (typeof stlModelId !== 'string') {
      return false;
    }

    if (typeof category === 'string' && DOOR_WINDOW_CATEGORY_SET.has(category)) {
      return false;
    }

    return category === undefined || category === null || category === '';
  }

  /**
   * 创建普通 STL 选中态的旋转标注容器。
   * 关键流程：几何坐标按逻辑像素构建，并在渲染前按正交相机 zoom 转换为世界尺寸，保证滚轮缩放不改变屏幕大小。
   * @param anchorX - 标注锚点世界坐标 X
   * @param anchorZ - 标注锚点世界坐标 Z
   * @param rotationY - 标注跟随 STL 当前朝向的 Y 轴旋转角，单位弧度
   * @returns 旋转标注 Group
   */
  private static _createRotateAnnotationGroup(anchorX: number, anchorZ: number, rotationY: number): THREE.Group {
    const annotationGroup: THREE.Group = new THREE.Group();
    annotationGroup.position.set(anchorX, ROTATE_ANNOTATION_Y, anchorZ);
    annotationGroup.rotation.y = rotationY;
    annotationGroup.scale.set(
      ROTATE_ANNOTATION_INITIAL_WORLD_SCALE,
      1,
      ROTATE_ANNOTATION_INITIAL_WORLD_SCALE
    );
    annotationGroup.renderOrder = ROTATE_ANNOTATION_RENDER_ORDER;

    const annotationFillMaterial: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({
      color: ROTATE_ANNOTATION_COLOR,
      transparent: true,
      opacity: 0.72,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const annotationLineMaterial: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
      color: ROTATE_ANNOTATION_COLOR,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });

    const arcMesh: THREE.Mesh = BoundingBoxHelper._createRotateArcMesh(annotationFillMaterial);
    const arrowMesh: THREE.Mesh = BoundingBoxHelper._createRotateArrowMesh(annotationFillMaterial);
    const outlineSegments: THREE.LineSegments = BoundingBoxHelper._createRotateOutlineSegments(annotationLineMaterial);
    arcMesh.userData[ROTATE_ANNOTATION_PICKABLE_KEY] = true;
    arrowMesh.userData[ROTATE_ANNOTATION_PICKABLE_KEY] = true;
    outlineSegments.userData[ROTATE_ANNOTATION_PICKABLE_KEY] = true;
    const updateScreenScale = (
      renderer: THREE.Renderer,
      _scene: THREE.Scene,
      camera: THREE.Camera
    ): void => {
      BoundingBoxHelper._updateRotateAnnotationScreenScale(annotationGroup, renderer, camera);
    };

    /* Group 本身不会稳定触发 onBeforeRender，必须挂到实际可渲染对象上，保证缩放每帧更新。 */
    arcMesh.onBeforeRender = updateScreenScale;
    arrowMesh.onBeforeRender = updateScreenScale;
    outlineSegments.onBeforeRender = updateScreenScale;

    annotationGroup.add(arcMesh);
    annotationGroup.add(arrowMesh);
    annotationGroup.add(outlineSegments);

    return annotationGroup;
  }

  /**
   * 创建旋转拖拽态中心轮盘。
   * 关键流程：浅蓝圆环作为背景，每 45° 追加白色刻度，并用深蓝 90° 弧段表达当前旋转区间。
   * @param centerX - 轮盘中心世界坐标 X
   * @param centerZ - 轮盘中心世界坐标 Z
   * @param activeCenterAngle - 深蓝活动弧段中心角，单位弧度
   * @param fixedWorldScale - 固定世界缩放；未传入时使用初始兜底缩放并由渲染前回调修正
   * @returns 旋转轮盘 Group
   */
  private static _createRotateWheelGroup(
    centerX: number,
    centerZ: number,
    activeCenterAngle: number,
    fixedWorldScale?: number
  ): THREE.Group {
    const wheelGroup: THREE.Group = new THREE.Group();
    wheelGroup.position.set(centerX, ROTATE_ANNOTATION_Y, centerZ);
    const initialWorldScale: number = fixedWorldScale !== undefined && fixedWorldScale > 0
      ? fixedWorldScale
      : ROTATE_ANNOTATION_INITIAL_WORLD_SCALE;
    wheelGroup.scale.set(
      initialWorldScale,
      1,
      initialWorldScale
    );
    wheelGroup.renderOrder = ROTATE_ANNOTATION_RENDER_ORDER;

    const backgroundMaterial: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({
      color: ROTATE_WHEEL_BACKGROUND_COLOR,
      transparent: true,
      opacity: 0.78,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const activeMaterial: THREE.MeshBasicMaterial = new THREE.MeshBasicMaterial({
      color: ROTATE_WHEEL_ACTIVE_COLOR,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const tickMaterial: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
      color: ROTATE_WHEEL_TICK_COLOR,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });

    const backgroundMesh: THREE.Mesh = BoundingBoxHelper._createRotateWheelRingMesh(
      0,
      Math.PI * 2,
      ROTATE_WHEEL_SEGMENTS,
      backgroundMaterial
    );
    const activeStartAngle: number = activeCenterAngle - THREE.MathUtils.degToRad(ROTATE_WHEEL_ACTIVE_SWEEP_DEGREES / 2);
    const activeEndAngle: number = activeCenterAngle + THREE.MathUtils.degToRad(ROTATE_WHEEL_ACTIVE_SWEEP_DEGREES / 2);
    const activeMesh: THREE.Mesh = BoundingBoxHelper._createRotateWheelRingMesh(
      activeStartAngle,
      activeEndAngle,
      Math.max(12, ROTATE_WHEEL_SEGMENTS / 4),
      activeMaterial
    );
    const tickSegments: THREE.LineSegments = BoundingBoxHelper._createRotateWheelTickSegments(tickMaterial);
    const updateScreenScale = (
      renderer: THREE.Renderer,
      _scene: THREE.Scene,
      camera: THREE.Camera
    ): void => {
      BoundingBoxHelper._updateRotateAnnotationScreenScale(wheelGroup, renderer, camera);
    };

    backgroundMesh.onBeforeRender = updateScreenScale;
    activeMesh.onBeforeRender = updateScreenScale;
    tickSegments.onBeforeRender = updateScreenScale;

    wheelGroup.add(backgroundMesh);
    wheelGroup.add(activeMesh);
    wheelGroup.add(tickSegments);
    return wheelGroup;
  }

  /**
   * 创建旋转轮盘圆环面片。
   * @param startAngle - 起始角度，单位弧度
   * @param endAngle - 结束角度，单位弧度
   * @param segments - 采样分段数
   * @param material - 圆环材质
   * @returns 圆环 Mesh
   */
  private static _createRotateWheelRingMesh(
    startAngle: number,
    endAngle: number,
    segments: number,
    material: THREE.MeshBasicMaterial
  ): THREE.Mesh {
    const positions: number[] = [];
    const indices: number[] = [];
    const halfWidth: number = ROTATE_WHEEL_WIDTH_PIXELS / 2;
    const innerRadius: number = ROTATE_WHEEL_RADIUS_PIXELS - halfWidth;
    const outerRadius: number = ROTATE_WHEEL_RADIUS_PIXELS + halfWidth;

    /* 圆环按 XZ 平面采样，后续由父级 Group 缩放为固定屏幕尺寸。 */
    for (let index: number = 0; index <= segments; index += 1) {
      const ratio: number = index / segments;
      const angle: number = startAngle + (endAngle - startAngle) * ratio;
      positions.push(innerRadius * Math.cos(angle), 0, innerRadius * Math.sin(angle));
      positions.push(outerRadius * Math.cos(angle), 0, outerRadius * Math.sin(angle));

      if (index < segments) {
        const innerCurrentIndex: number = index * 2;
        const outerCurrentIndex: number = innerCurrentIndex + 1;
        const innerNextIndex: number = innerCurrentIndex + 2;
        const outerNextIndex: number = innerCurrentIndex + 3;
        indices.push(innerCurrentIndex, outerCurrentIndex, innerNextIndex);
        indices.push(outerCurrentIndex, outerNextIndex, innerNextIndex);
      }
    }

    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh: THREE.Mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = ROTATE_ANNOTATION_RENDER_ORDER + 1;
    return mesh;
  }

  /**
   * 创建旋转轮盘 45° 白色分段刻度。
   * @param material - 刻度线材质
   * @returns 刻度线段对象
   */
  private static _createRotateWheelTickSegments(material: THREE.LineBasicMaterial): THREE.LineSegments {
    const positions: number[] = [];
    const halfWidth: number = ROTATE_WHEEL_WIDTH_PIXELS / 2;
    const innerRadius: number = ROTATE_WHEEL_RADIUS_PIXELS - halfWidth - ROTATE_WHEEL_TICK_INSET_PIXELS;
    const outerRadius: number = ROTATE_WHEEL_RADIUS_PIXELS + halfWidth + ROTATE_WHEEL_TICK_OUTSET_PIXELS;

    /* 每 45° 画一条径向白杠，对轮盘进行 8 等分。 */
    for (let degree: number = 0; degree < 360; degree += ROTATE_WHEEL_TICK_STEP_DEGREES) {
      const angle: number = THREE.MathUtils.degToRad(degree);
      positions.push(
        innerRadius * Math.cos(angle),
        0,
        innerRadius * Math.sin(angle),
        outerRadius * Math.cos(angle),
        0,
        outerRadius * Math.sin(angle)
      );
    }

    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const tickSegments: THREE.LineSegments = new THREE.LineSegments(geometry, material);
    tickSegments.renderOrder = ROTATE_ANNOTATION_RENDER_ORDER + 2;
    return tickSegments;
  }

  /**
   * 获取对象世界中心，优先使用对象自身世界坐标，缺失时退回 OBB 中心。
   * @param mesh - 目标对象
   * @param obb - 目标对象 OBB
   * @returns 世界坐标中心点
   */
  private static _getObjectWorldCenter(mesh: THREE.Object3D, obb: StlObb2D): THREE.Vector3 {
    const center: THREE.Vector3 = new THREE.Vector3();
    mesh.getWorldPosition(center);
    if (Number.isFinite(center.x) && Number.isFinite(center.z)) {
      return center;
    }

    return obb.center.clone();
  }

  /**
   * 计算普通选中态旋转箭头的世界锚点。
   * 关键流程：先将 Mesh 的 Y 轴旋转转换为 XZ 平面方向，再按该方向投影 OBB 半尺寸，确保箭头位置随模型角度绕中心旋转。
   * @param mesh - 目标 STL 对象
   * @param obb - 目标对象 OBB
   * @returns 旋转箭头锚点世界坐标
   */
  private static _getRotateAnnotationAnchor(mesh: THREE.Object3D, obb: StlObb2D): THREE.Vector3 {
    const center: THREE.Vector3 = BoundingBoxHelper._getObjectWorldCenter(mesh, obb);
    const rotationY: number = BoundingBoxHelper._getObjectWorldRotationY(mesh);
    const directionAngle: number = BoundingBoxHelper._getRotateDirectionAngle(rotationY);
    const outwardDirection: THREE.Vector2 = new THREE.Vector2(
      Math.cos(directionAngle),
      Math.sin(directionAngle)
    ).normalize();
    const outwardDirection3D: THREE.Vector3 = new THREE.Vector3(outwardDirection.x, 0, outwardDirection.y);
    const projectedHalfExtent: number = Math.abs(StlObbHelper.dotXZ(outwardDirection3D, obb.axisU)) * obb.halfU +
      Math.abs(StlObbHelper.dotXZ(outwardDirection3D, obb.axisV)) * obb.halfV;

    /* 沿模型当前朝向移动到包围盒外侧，保证默认位置与拖拽态蓝色轮盘方向一致。 */
    return new THREE.Vector3(
      center.x + outwardDirection.x * projectedHalfExtent,
      ROTATE_ANNOTATION_Y,
      center.z + outwardDirection.y * projectedHalfExtent
    );
  }

  /**
   * 获取对象世界空间下的 Y 轴旋转角。
   * @param mesh - 目标对象
   * @returns 世界空间 Y 轴旋转角，单位弧度
   */
  private static _getObjectWorldRotationY(mesh: THREE.Object3D): number {
    const worldQuaternion: THREE.Quaternion = new THREE.Quaternion();
    const worldEuler: THREE.Euler = new THREE.Euler();
    mesh.getWorldQuaternion(worldQuaternion);
    worldEuler.setFromQuaternion(worldQuaternion, 'YXZ');
    return worldEuler.y;
  }

  /**
   * 将 Three.js 的 Y 轴旋转角转换为 XZ 平面圆环采样角。
   * @param rotationY - 对象 Y 轴旋转角，单位弧度
   * @returns XZ 平面中与旋转箭头默认朝向一致的圆环角度，单位弧度
   */
  private static _getRotateDirectionAngle(rotationY: number): number {
    return Math.PI / 2 - rotationY;
  }

  /**
   * 创建旋转标注线框兜底对象。
   * 关键流程：即使透明面片在当前渲染管线中不可见，也用不参与深度测试的线段明确画出旋转轮盘轮廓。
   * @param material - 线框材质
   * @returns 旋转标注线段对象
   */
  private static _createRotateOutlineSegments(material: THREE.LineBasicMaterial): THREE.LineSegments {
    const positions: number[] = [];
    const arcCenterZ: number = ROTATE_ANNOTATION_OFFSET_PIXELS + ROTATE_ANNOTATION_ARC_CENTER_Z_PIXELS;

    /* 按弧线采样生成连续线段，保证俯视模式下一定有可见的蓝色轮盘主体。 */
    for (let index: number = 0; index < ROTATE_ANNOTATION_ARC_SEGMENTS; index += 1) {
      const currentRatio: number = index / ROTATE_ANNOTATION_ARC_SEGMENTS;
      const nextRatio: number = (index + 1) / ROTATE_ANNOTATION_ARC_SEGMENTS;
      const currentAngle: number = THREE.MathUtils.degToRad(145 - 110 * currentRatio);
      const nextAngle: number = THREE.MathUtils.degToRad(145 - 110 * nextRatio);
      positions.push(
        ROTATE_ANNOTATION_RADIUS_PIXELS * Math.cos(currentAngle),
        0,
        arcCenterZ + ROTATE_ANNOTATION_RADIUS_PIXELS * Math.sin(currentAngle),
        ROTATE_ANNOTATION_RADIUS_PIXELS * Math.cos(nextAngle),
        0,
        arcCenterZ + ROTATE_ANNOTATION_RADIUS_PIXELS * Math.sin(nextAngle)
      );
    }

    BoundingBoxHelper._appendRotateArrowOutlineSegments(positions, 145, false);
    BoundingBoxHelper._appendRotateArrowOutlineSegments(positions, 35, true);

    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const outlineSegments: THREE.LineSegments = new THREE.LineSegments(geometry, material);
    outlineSegments.renderOrder = ROTATE_ANNOTATION_RENDER_ORDER + 1;
    return outlineSegments;
  }

  /**
   * 创建旋转标注弧形带状面片。
   * 关键流程：沿弧线内外半径生成三角带，让箭头线本身具备可见宽度和填充面积。
   * @param material - 弧形带材质
   * @returns 弧形带面片对象
   */
  private static _createRotateArcMesh(material: THREE.MeshBasicMaterial): THREE.Mesh {
    const positions: number[] = [];
    const indices: number[] = [];
    const halfWidth: number = ROTATE_ANNOTATION_ARC_WIDTH_PIXELS / 2;
    const innerRadius: number = ROTATE_ANNOTATION_RADIUS_PIXELS - halfWidth;
    const outerRadius: number = ROTATE_ANNOTATION_RADIUS_PIXELS + halfWidth;
    const arcCenterZ: number = ROTATE_ANNOTATION_OFFSET_PIXELS + ROTATE_ANNOTATION_ARC_CENTER_Z_PIXELS;

    /* 弧形带从左上到右上，中心略向下，形成有面积的旋转提示主体。 */
    for (let index: number = 0; index <= ROTATE_ANNOTATION_ARC_SEGMENTS; index += 1) {
      const ratio: number = index / ROTATE_ANNOTATION_ARC_SEGMENTS;
      const angle: number = THREE.MathUtils.degToRad(145 - 110 * ratio);
      const innerX: number = innerRadius * Math.cos(angle);
      const innerZ: number = arcCenterZ + innerRadius * Math.sin(angle);
      const outerX: number = outerRadius * Math.cos(angle);
      const outerZ: number = arcCenterZ + outerRadius * Math.sin(angle);

      positions.push(innerX, 0, innerZ);
      positions.push(outerX, 0, outerZ);

      /* 相邻采样点之间用两个三角形拼接成连续弧形带面片。 */
      if (index < ROTATE_ANNOTATION_ARC_SEGMENTS) {
        const innerCurrentIndex: number = index * 2;
        const outerCurrentIndex: number = innerCurrentIndex + 1;
        const innerNextIndex: number = innerCurrentIndex + 2;
        const outerNextIndex: number = innerCurrentIndex + 3;

        indices.push(innerCurrentIndex, outerCurrentIndex, innerNextIndex);
        indices.push(outerCurrentIndex, outerNextIndex, innerNextIndex);
      }
    }

    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const arcMesh: THREE.Mesh = new THREE.Mesh(geometry, material);
    arcMesh.renderOrder = ROTATE_ANNOTATION_RENDER_ORDER;
    return arcMesh;
  }

  /**
   * 创建旋转标注左右两端实心箭头面片。
   * 关键流程：用两个三角形构成左右箭头，箭头坐标仍按逻辑屏幕像素生成，后续由父级 Group 缩放为固定屏幕尺寸。
   * @param material - 箭头材质
   * @returns 箭头面片对象
   */
  private static _createRotateArrowMesh(material: THREE.MeshBasicMaterial): THREE.Mesh {
    const positions: number[] = [];

    /* 左右箭头均基于弧线端点的切线方向生成，确保箭头底边与弧形引线自然贴合。 */
    BoundingBoxHelper._appendRotateArrowTriangle(positions, 145, false);
    BoundingBoxHelper._appendRotateArrowTriangle(positions, 35, true);

    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();

    const arrowMesh: THREE.Mesh = new THREE.Mesh(geometry, material);
    arrowMesh.renderOrder = ROTATE_ANNOTATION_RENDER_ORDER;
    return arrowMesh;
  }

  /**
   * 向顶点数组追加一个沿弧线切线方向的旋转箭头三角形。
   * @param positions - 待写入的顶点数组
   * @param degree - 箭头所在弧线端点角度，单位度
   * @param followArcForward - true 表示沿 145°→35° 的弧线方向，false 表示反向
   */
  private static _appendRotateArrowTriangle(
    positions: number[],
    degree: number,
    followArcForward: boolean
  ): void {
    const angle: number = THREE.MathUtils.degToRad(degree);
    const arcEndPoint: THREE.Vector3 = BoundingBoxHelper._getRotateArcPoint(degree);
    const directionSign: number = followArcForward ? 1 : -1;
    const tangentX: number = Math.sin(angle) * directionSign;
    const tangentZ: number = -Math.cos(angle) * directionSign;
    const tangent: THREE.Vector2 = new THREE.Vector2(tangentX, tangentZ).normalize();
    const normal: THREE.Vector2 = new THREE.Vector2(-tangent.y, tangent.x).normalize();
    const arrowLength: number = ROTATE_ANNOTATION_ARROW_SIZE_PIXELS;
    const arrowHalfWidth: number = Math.max(
      ROTATE_ANNOTATION_ARC_WIDTH_PIXELS * 0.85,
      ROTATE_ANNOTATION_ARROW_SIZE_PIXELS * 0.42
    );
    const tipX: number = arcEndPoint.x + tangent.x * arrowLength;
    const tipZ: number = arcEndPoint.z + tangent.y * arrowLength;
    const baseCenterX: number = tipX - tangent.x * arrowLength;
    const baseCenterZ: number = tipZ - tangent.y * arrowLength;
    const baseLeftX: number = baseCenterX + normal.x * arrowHalfWidth;
    const baseLeftZ: number = baseCenterZ + normal.y * arrowHalfWidth;
    const baseRightX: number = baseCenterX - normal.x * arrowHalfWidth;
    const baseRightZ: number = baseCenterZ - normal.y * arrowHalfWidth;

    /* 三角形顶点顺序保持一致，并将箭头整体向引线内部移动一个箭头长度，避免箭头外飘。 */
    positions.push(tipX, 0, tipZ);
    positions.push(baseLeftX, 0, baseLeftZ);
    positions.push(baseRightX, 0, baseRightZ);
  }

  /**
   * 向线段顶点数组追加一个旋转箭头三角形轮廓。
   * @param positions - 待写入的线段顶点数组
   * @param degree - 箭头所在弧线端点角度，单位度
   * @param followArcForward - true 表示沿 145°→35° 的弧线方向，false 表示反向
   */
  private static _appendRotateArrowOutlineSegments(
    positions: number[],
    degree: number,
    followArcForward: boolean
  ): void {
    const angle: number = THREE.MathUtils.degToRad(degree);
    const arcEndPoint: THREE.Vector3 = BoundingBoxHelper._getRotateArcPoint(degree);
    const directionSign: number = followArcForward ? 1 : -1;
    const tangentX: number = Math.sin(angle) * directionSign;
    const tangentZ: number = -Math.cos(angle) * directionSign;
    const tangent: THREE.Vector2 = new THREE.Vector2(tangentX, tangentZ).normalize();
    const normal: THREE.Vector2 = new THREE.Vector2(-tangent.y, tangent.x).normalize();
    const arrowLength: number = ROTATE_ANNOTATION_ARROW_SIZE_PIXELS;
    const arrowHalfWidth: number = Math.max(
      ROTATE_ANNOTATION_ARC_WIDTH_PIXELS * 0.85,
      ROTATE_ANNOTATION_ARROW_SIZE_PIXELS * 0.42
    );
    const tipX: number = arcEndPoint.x + tangent.x * arrowLength;
    const tipZ: number = arcEndPoint.z + tangent.y * arrowLength;
    const baseCenterX: number = tipX - tangent.x * arrowLength;
    const baseCenterZ: number = tipZ - tangent.y * arrowLength;
    const baseLeftX: number = baseCenterX + normal.x * arrowHalfWidth;
    const baseLeftZ: number = baseCenterZ + normal.y * arrowHalfWidth;
    const baseRightX: number = baseCenterX - normal.x * arrowHalfWidth;
    const baseRightZ: number = baseCenterZ - normal.y * arrowHalfWidth;

    /* 线段按三角形三条边依次写入，作为透明面片不可见时的兜底箭头轮廓。 */
    positions.push(tipX, 0, tipZ, baseLeftX, 0, baseLeftZ);
    positions.push(baseLeftX, 0, baseLeftZ, baseRightX, 0, baseRightZ);
    positions.push(baseRightX, 0, baseRightZ, tipX, 0, tipZ);
  }

  /**
   * 根据角度获取旋转弧线上的逻辑像素坐标。
   * @param degree - 弧线角度，单位度
   * @returns 弧线点坐标
   */
  private static _getRotateArcPoint(degree: number): THREE.Vector3 {
    const angle: number = THREE.MathUtils.degToRad(degree);
    const x: number = ROTATE_ANNOTATION_RADIUS_PIXELS * Math.cos(angle);
    const z: number = ROTATE_ANNOTATION_OFFSET_PIXELS +
      ROTATE_ANNOTATION_ARC_CENTER_Z_PIXELS +
      ROTATE_ANNOTATION_RADIUS_PIXELS * Math.sin(angle);
    return new THREE.Vector3(x, 0, z);
  }

  /**
   * 按当前相机缩放更新旋转标注的世界尺寸。
   * @param annotationGroup - 旋转标注 Group
   * @param renderer - 当前渲染器
   * @param camera - 当前相机
   */
  private static _updateRotateAnnotationScreenScale(
    annotationGroup: THREE.Group,
    renderer: THREE.Renderer,
    camera: THREE.Camera
  ): void {
    const rendererHeight: number = BoundingBoxHelper._getRendererHeight(renderer);
    if (rendererHeight <= 0) {
      return;
    }

    /* 正交 2D 视图：用可见高度 / 屏幕高度得到每像素世界尺寸，抵消滚轮 zoom 对标注大小的影响。 */
    if (camera instanceof THREE.OrthographicCamera) {
      const visibleHeight: number = (camera.top - camera.bottom) / camera.zoom;
      const worldUnitsPerPixel: number = visibleHeight / rendererHeight;
      annotationGroup.scale.set(worldUnitsPerPixel, 1, worldUnitsPerPixel);
      return;
    }

    /* 兜底处理：若未来在透视相机中复用，则按相机距离估算屏幕像素对应的世界尺寸。 */
    if (camera instanceof THREE.PerspectiveCamera) {
      const distanceToCamera: number = annotationGroup.position.distanceTo(camera.position);
      const visibleHeight: number = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distanceToCamera;
      const worldUnitsPerPixel: number = visibleHeight / rendererHeight;
      annotationGroup.scale.set(worldUnitsPerPixel, 1, worldUnitsPerPixel);
    }
  }

  /**
   * 获取当前渲染器画布高度。
   * @param renderer - 当前渲染器
   * @returns 渲染高度，单位像素；无法获取时返回 0
   */
  private static _getRendererHeight(renderer: THREE.Renderer): number {
    const rendererSizeSource: RotateAnnotationRendererSizeSource = renderer as unknown as RotateAnnotationRendererSizeSource;
    const rendererSize: THREE.Vector2 = new THREE.Vector2();

    /* 优先使用 Three.js 渲染器标准 getSize，保证读取到实际绘制尺寸。 */
    if (typeof rendererSizeSource.getSize === 'function') {
      rendererSizeSource.getSize(rendererSize);
      return rendererSize.y;
    }

    /* three/webgpu 的 Renderer 类型声明较窄时，退回到画布 CSS 高度。 */
    if (rendererSizeSource.domElement !== undefined) {
      return rendererSizeSource.domElement.clientHeight;
    }

    return 0;
  }

  /**
   * 递归释放 Group 内所有几何体和材质资源
   * @param obj - 要释放的 Object3D（Group）
   */
  private static _disposeGroup(obj: THREE.Object3D): void {
    /* 收集已 dispose 的材质，避免重复 dispose 共享材质 */
    const disposedMaterials: Set<THREE.Material> = new Set<THREE.Material>();

    obj.traverse((child: THREE.Object3D): void => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();

        if (Array.isArray(child.material)) {
          for (const mat of child.material) {
            if (!disposedMaterials.has(mat)) {
              mat.dispose();
              disposedMaterials.add(mat);
            }
          }
        } else {
          if (!disposedMaterials.has(child.material)) {
            child.material.dispose();
            disposedMaterials.add(child.material);
          }
        }
      }
    });
  }
}
