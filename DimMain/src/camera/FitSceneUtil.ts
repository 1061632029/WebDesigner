/**
 * 自适应场景工具函数
 * 根据场景内所有可见 Mesh 的包围盒，计算相机位置使场景铺满视图
 *
 * 支持透视相机和正交相机两种模式：
 * - 透视相机：根据 FOV 和包围盒半径计算合适的相机距离
 * - 正交相机：调整 zoom 使包围盒铺满视口
 */

import * as THREE from 'three/webgpu';
import type { OrbitControlsWrapper } from './OrbitControlsWrapper';

/**
 * 需要跳过的辅助对象名称前缀
 * 以 __ 开头的对象为内部辅助对象（预览 Mesh、标记等），不参与包围盒计算
 */
const HELPER_NAME_PREFIX: string = '__';

/**
 * 计算场景内所有可见 Mesh 的合并包围盒
 * 跳过辅助对象（名称以 __ 开头）、GridHelper、AxesHelper、不可见对象
 *
 * @param scene - Three.js 场景
 * @returns 合并后的包围盒，场景为空时返回 null
 */
export function computeSceneBoundingBox(scene: THREE.Scene): THREE.Box3 | null {
  const box: THREE.Box3 = new THREE.Box3();
  let hasContent: boolean = false;

  scene.traverse((object: THREE.Object3D): void => {
    /* 跳过不可见对象 */
    if (!object.visible) {
      return;
    }

    /* 跳过辅助对象（名称以 __ 开头） */
    if (object.name.startsWith(HELPER_NAME_PREFIX)) {
      return;
    }

    /* 跳过 Three.js 内置辅助类型 */
    if (
      object instanceof THREE.GridHelper ||
      object instanceof THREE.AxesHelper ||
      object instanceof THREE.CameraHelper ||
      object instanceof THREE.DirectionalLightHelper ||
      object instanceof THREE.PointLightHelper ||
      object instanceof THREE.SpotLightHelper ||
      object instanceof THREE.HemisphereLightHelper
    ) {
      return;
    }

    /* 只对 Mesh 计算包围盒（跳过 Light、Camera、LineSegments 等） */
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    /* 跳过线框子对象（LineSegments 是 Mesh 的子对象，但 Mesh 已被处理） */
    /* 此处 object 已确认为 Mesh，直接扩展包围盒 */
    const meshBox: THREE.Box3 = new THREE.Box3().setFromObject(object);
    if (!meshBox.isEmpty()) {
      box.union(meshBox);
      hasContent = true;
    }
  });

  return hasContent ? box : null;
}

/**
 * 将相机自适应到场景，使场景内所有模型铺满视图
 * 支持透视相机和正交相机
 *
 * 算法：
 * 1. 计算场景包围盒 → 中心点 center 和最大半径 radius
 * 2. 根据方向向量和距离计算新的相机位置
 * 3. 调用 OrbitControlsWrapper.transitionTo 平滑过渡
 *
 * @param camera - 当前活动相机（透视或正交）
 * @param orbitControls - 轨道控制器封装
 * @param scene - Three.js 场景
 * @param directionVector - 相机相对于场景中心的方向向量（无需归一化，函数内部归一化）
 *   例：(0,0,1) 表示从前方看，(0,1,1) 表示从前方俯视 45°
 * @param durationMs - 过渡动画时长（毫秒），默认 500ms
 * @returns 过渡完成的 Promise；场景为空时立即 resolve
 */
export function fitSceneToView(
  camera: THREE.Camera,
  orbitControls: OrbitControlsWrapper,
  scene: THREE.Scene,
  directionVector: THREE.Vector3,
  durationMs: number = 500
): Promise<void> {
  /* 计算场景包围盒 */
  const box: THREE.Box3 | null = computeSceneBoundingBox(scene);
  if (box === null) {
    /* 场景为空，不执行过渡 */
    console.warn('[FitSceneUtil] 场景为空，无法自适应');
    return Promise.resolve();
  }

  /* 计算包围盒中心点和最大半径 */
  const center: THREE.Vector3 = new THREE.Vector3();
  box.getCenter(center);

  const size: THREE.Vector3 = new THREE.Vector3();
  box.getSize(size);
  /* 最大半径 = 包围盒对角线长度的一半 */
  const radius: number = size.length() / 2;

  /* 归一化方向向量 */
  const dir: THREE.Vector3 = directionVector.clone().normalize();

  /* 计算相机距离 */
  let distance: number;

  if (camera instanceof THREE.PerspectiveCamera) {
    /* 透视相机：根据 FOV 计算距离，使包围盒铺满视口
     * halfFov = fov / 2（弧度）
     * distance = radius / tan(halfFov) * 1.2（留 20% 余量）
     */
    const halfFovRad: number = (camera.fov / 2) * (Math.PI / 180);
    /* 同时考虑宽高比：取水平和垂直方向中较小的 FOV */
    const halfFovRadH: number = Math.atan(Math.tan(halfFovRad) * camera.aspect);
    const effectiveHalfFov: number = Math.min(halfFovRad, halfFovRadH);
    distance = (radius / Math.tan(effectiveHalfFov)) * 1.2;
  } else if (camera instanceof THREE.OrthographicCamera) {
    /* 正交相机：调整 zoom 使包围盒铺满视口
     * 视口高度 = (top - bottom) / zoom
     * 目标：视口高度 = radius * 2 * 1.2
     * zoom = (top - bottom) / (radius * 2 * 1.2)
     */
    const viewHeight: number = camera.top - camera.bottom;
    const viewWidth: number = camera.right - camera.left;
    const targetHeight: number = radius * 2 * 1.2;
    const targetWidth: number = radius * 2 * 1.2;
    const zoomH: number = viewHeight / targetHeight;
    const zoomW: number = viewWidth / targetWidth;
    camera.zoom = Math.min(zoomH, zoomW);
    camera.updateProjectionMatrix();

    /* 正交相机距离固定为包围盒对角线的 2 倍，确保不裁剪 */
    distance = radius * 4;
  } else {
    /* 未知相机类型，使用默认距离 */
    distance = radius * 3;
  }

  /* 确保最小距离（避免相机进入模型内部） */
  distance = Math.max(distance, radius * 1.5, 1.0);

  /* 计算新的相机位置：从中心点沿方向向量退后 distance */
  const newPosition: THREE.Vector3 = center.clone().addScaledVector(dir, distance);

  console.log(
    `[FitSceneUtil] 自适应场景：`,
    `center=(${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`,
    `radius=${radius.toFixed(2)}`,
    `distance=${distance.toFixed(2)}`,
    `dir=(${dir.x.toFixed(2)}, ${dir.y.toFixed(2)}, ${dir.z.toFixed(2)})`
  );

  /* 平滑过渡到新位置 */
  return orbitControls.transitionTo(newPosition, center, durationMs);
}
