/**
 * 2D 平面投影包围盒辅助工具
 * 将 STL 模型的 3D AABB 投影到 XZ 平面，绘制矩形边线和控制点。
 *
 * 提供两种模式：
 * - attachOutline：仅绘制 4 条边线（用于布置预览）
 * - attachFull：绘制 4 条边线 + 8 个控制点（用于选中状态）
 *
 * 包围盒 Group 挂载到场景根节点（而非 Mesh 子对象），
 * 避免继承父 Mesh 的 scale 导致控制点尺寸异常。
 */

import * as THREE from 'three/webgpu';

/** 包围盒 Group 在 userData 中的 ownerUuid 键名 */
const BBOX_OWNER_UUID_KEY: string = '__bboxOwnerUuid__';

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

/**
 * 2D 平面投影包围盒辅助工具（静态工具类）
 * 在 2D 俯视模式下为 STL 模型 Mesh 附加 XZ 平面投影包围盒
 */
export class BoundingBoxHelper {
  /**
   * 为指定 Mesh 附加仅含边线的包围盒（用于布置预览）
   * 若已存在包围盒则先移除旧的再创建新的
   * @param mesh - 目标 STL 模型 Mesh
   * @param scene - Three.js 场景（包围盒 Group 挂载到场景根节点）
   */
  public static attachOutline(mesh: THREE.Object3D, scene: THREE.Scene): void {
    /* 先移除旧的包围盒 */
    BoundingBoxHelper.detach(mesh, scene);

    /* 计算 Mesh 在世界坐标系中的 AABB */
    const worldBox: THREE.Box3 = new THREE.Box3().setFromObject(mesh);
    if (worldBox.isEmpty()) {
      return;
    }

    const minX: number = worldBox.min.x;
    const maxX: number = worldBox.max.x;
    const minZ: number = worldBox.min.z;
    const maxZ: number = worldBox.max.z;
    const y: number = BBOX_Y;

    /* ========== 4 个角点坐标（世界坐标 XZ 平面投影） ========== */
    const p1: THREE.Vector3 = new THREE.Vector3(minX, y, minZ);
    const p2: THREE.Vector3 = new THREE.Vector3(maxX, y, minZ);
    const p3: THREE.Vector3 = new THREE.Vector3(maxX, y, maxZ);
    const p4: THREE.Vector3 = new THREE.Vector3(minX, y, maxZ);

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

    /* 计算 Mesh 在世界坐标系中的 AABB */
    const worldBox: THREE.Box3 = new THREE.Box3().setFromObject(mesh);
    if (worldBox.isEmpty()) {
      return;
    }

    const minX: number = worldBox.min.x;
    const maxX: number = worldBox.max.x;
    const minZ: number = worldBox.min.z;
    const maxZ: number = worldBox.max.z;
    const y: number = BBOX_Y;

    /* ========== 4 个角点坐标（世界坐标 XZ 平面投影） ========== */
    const p1: THREE.Vector3 = new THREE.Vector3(minX, y, minZ); // 左前
    const p2: THREE.Vector3 = new THREE.Vector3(maxX, y, minZ); // 右前
    const p3: THREE.Vector3 = new THREE.Vector3(maxX, y, maxZ); // 右后
    const p4: THREE.Vector3 = new THREE.Vector3(minX, y, maxZ); // 左后

    /* ========== 4 个边线中点坐标 ========== */
    const mp12: THREE.Vector3 = new THREE.Vector3((minX + maxX) / 2, y, minZ); // 前边中点
    const mp23: THREE.Vector3 = new THREE.Vector3(maxX, y, (minZ + maxZ) / 2); // 右边中点
    const mp34: THREE.Vector3 = new THREE.Vector3((minX + maxX) / 2, y, maxZ); // 后边中点
    const mp41: THREE.Vector3 = new THREE.Vector3(minX, y, (minZ + maxZ) / 2); // 左边中点

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

    /* 将包围盒 Group 挂载到场景根节点 */
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
   * 递归释放 Group 内所有几何体和材质资源
   * @param obj - 要释放的 Object3D（Group）
   */
  private static _disposeGroup(obj: THREE.Object3D): void {
    /* 收集已 dispose 的材质，避免重复 dispose 共享材质 */
    const disposedMaterials: Set<THREE.Material> = new Set<THREE.Material>();

    obj.traverse((child: THREE.Object3D): void => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
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
