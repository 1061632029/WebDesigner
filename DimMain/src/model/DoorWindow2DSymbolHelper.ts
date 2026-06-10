/**
 * 门窗 2D 平面符号辅助工具
 * 负责为吸附到墙体的门窗 STL 创建俯视平面符号，并提供显示控制与拾取归属解析能力。
 */

import * as THREE from 'three/webgpu';
import { DoorOpeningDirectionHelper } from './DoorOpeningDirectionHelper';
import type { DoorOpeningDirection } from './DoorOpeningDirectionHelper';

/** 门窗 2D 符号 userData 标记字段 */
export const DOOR_WINDOW_2D_SYMBOL_FLAG: string = 'isDoorWindow2DSymbol';

/** 门窗类别类型 */
type DoorWindowCategory = 'door' | 'window';

/** 门窗 2D 符号配置 */
interface DoorWindowSymbolConfig {
  /** 门窗未缩放局部宽度，沿模型局部 X 轴 */
  width: number;
  /** 门窗未缩放局部厚度，沿模型局部 Z 轴 */
  depth: number;
  /** 符号离地局部高度，避免与地面/墙体深度冲突 */
  y: number;
}

/**
 * 门窗 2D 平面符号辅助工具
 */
export class DoorWindow2DSymbolHelper {
  /** 符号 Group 名称前缀 */
  private static readonly SYMBOL_GROUP_NAME: string = '__doorWindow2DSymbol';

  /** 符号显示高度：位于地面上方，俯视时覆盖墙体，便于点击 */
  private static readonly SYMBOL_Y: number = 0.08;

  /** 线条颜色 */
  private static readonly LINE_COLOR: number = 0x111111;

  /** 填充颜色 */
  private static readonly FILL_COLOR: number = 0xffffff;

  /** 门扇线框厚度比例，控制门扇呈现为细长矩形 */
  private static readonly DOOR_LEAF_THICKNESS_SCALE: number = 0.18;

  /** 缩放换算最小值，避免父级缩放异常时出现除零或无限尺寸 */
  private static readonly MIN_SCALE_ABS: number = 0.000001;

  /**
   * 判断 STL 类别是否为门窗。
   * @param category - STL 模型类别
   * @returns 为门或窗时返回 true
   */
  public static isDoorWindowCategory(category: unknown): category is DoorWindowCategory {
    return category === 'door' || category === 'window';
  }

  /**
   * 为门窗 Mesh 挂载 2D 平面符号。
   * 符号作为 Mesh 子对象存在，移动、旋转、撤销、删除时会自动跟随父 Mesh。
   * @param mesh - 门窗 STL Mesh
   * @param visible - 初始可见状态，通常 2D 模式为 true，3D 模式为 false
   */
  public static attachSymbol(mesh: THREE.Mesh, visible: boolean): void {
    const category: unknown = mesh.userData['category'];
    if (!DoorWindow2DSymbolHelper.isDoorWindowCategory(category)) {
      return;
    }

    /* 重新挂载流程：先移除旧符号，再按当前门窗几何和父级缩放关系重建，确保尺寸调整后符号同步更新。 */
    const oldSymbol: THREE.Object3D | undefined = mesh.children.find(
      (child: THREE.Object3D): boolean => child.userData[DOOR_WINDOW_2D_SYMBOL_FLAG] === true
    );
    if (oldSymbol !== undefined) {
      mesh.remove(oldSymbol);
      DoorWindow2DSymbolHelper.disposeObjectResources(oldSymbol);
    }

    mesh.geometry.computeBoundingBox();
    const localBox: THREE.Box3 | null = mesh.geometry.boundingBox;
    if (localBox === null) {
      return;
    }

    const rawWidth: number = localBox.max.x - localBox.min.x;
    const rawDepth: number = localBox.max.z - localBox.min.z;
    const config: DoorWindowSymbolConfig = {
      width: Math.max(rawWidth, 0.5),
      depth: Math.max(rawDepth, 0.08),
      y: DoorWindow2DSymbolHelper.SYMBOL_Y,
    };

    const symbolGroup: THREE.Group = new THREE.Group();
    symbolGroup.name = `${DoorWindow2DSymbolHelper.SYMBOL_GROUP_NAME}-${mesh.uuid}`;
    symbolGroup.visible = visible;
    DoorWindow2DSymbolHelper.markSymbolObject(symbolGroup, mesh);

    /* 根据门/窗类别创建不同的建筑平面符号。 */
    if (category === 'door') {
      DoorWindow2DSymbolHelper.buildDoorSymbol(symbolGroup, config, mesh);
    } else {
      DoorWindow2DSymbolHelper.buildWindowSymbol(symbolGroup, config, mesh);
    }

    mesh.add(symbolGroup);
  }

  /**
   * 批量控制场景中所有门窗 2D 符号的可见性。
   * @param scene - Three.js 场景
   * @param visible - 是否显示 2D 符号
   */
  public static setSymbolsVisible(scene: THREE.Scene, visible: boolean): void {
    const doorWindowMeshes: Array<THREE.Mesh> = [];

    /* 先收集再重建：避免 traverse 过程中增删子对象导致遍历状态异常，同时保证旧符号按最新尺寸刷新。 */
    scene.traverse((object: THREE.Object3D): void => {
      if (object instanceof THREE.Mesh && DoorWindow2DSymbolHelper.isDoorWindowCategory(object.userData['category'])) {
        doorWindowMeshes.push(object);
      }
    });

    for (let index: number = 0; index < doorWindowMeshes.length; index += 1) {
      const mesh: THREE.Mesh = doorWindowMeshes[index]!;
      DoorWindow2DSymbolHelper.attachSymbol(mesh, visible);
    }
  }

  /**
   * 收集场景中可见的门窗 2D 符号 Mesh，用于 2D 点选优先拾取。
   * @param scene - Three.js 场景
   * @returns 可参与射线拾取的符号 Mesh 列表
   */
  public static collectVisibleSymbolMeshes(scene: THREE.Scene): Array<THREE.Object3D> {
    const targets: Array<THREE.Object3D> = [];
    scene.traverse((object: THREE.Object3D): void => {
      if (
        object instanceof THREE.Mesh &&
        object.visible &&
        object.userData[DOOR_WINDOW_2D_SYMBOL_FLAG] === true
      ) {
        targets.push(object);
      }
    });
    return targets;
  }

  /**
   * 从被命中的符号对象回溯到所属门窗 STL Mesh。
   * @param object - 射线命中的符号对象
   * @returns 所属 STL Mesh，找不到时返回 null
   */
  public static resolveOwnerStlMesh(object: THREE.Object3D): THREE.Mesh | null {
    let current: THREE.Object3D | null = object;
    while (current !== null) {
      if (current instanceof THREE.Mesh && typeof current.userData['stlModelId'] === 'string') {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  /**
   * 创建门的 2D 平开符号：墙体洞口白色填充框 + 门扇按开启方向 90° 开启状态 + 等比开启弧线。
   * @param group - 符号父组
   * @param config - 符号尺寸配置
   * @param owner - 所属 STL Mesh
   */
  private static buildDoorSymbol(group: THREE.Group, config: DoorWindowSymbolConfig, owner: THREE.Mesh): void {
    /* 洞口白框用于覆盖墙体开洞区域，尺寸严格等于门洞在墙体上的投影，便于表现留洞和点击选中。 */
    const openingMinX: number = -config.width * 0.5;
    const openingMaxX: number = config.width * 0.5;
    const openingMinZ: number = -config.depth * 0.5;
    const openingMaxZ: number = config.depth * 0.5;
    const openingFillMesh: THREE.Mesh = DoorWindow2DSymbolHelper.createRectMesh(
      openingMinX,
      openingMaxX,
      openingMinZ,
      openingMaxZ,
      config.y,
      0.98,
      owner
    );
    group.add(openingFillMesh);

    const openingOutline: THREE.LineSegments = DoorWindow2DSymbolHelper.createRectangleOutlineSegments(
      openingMinX,
      openingMaxX,
      openingMinZ,
      openingMaxZ,
      config.y + 0.006,
      owner
    );
    group.add(openingOutline);

    /* 门扇与开启弧按世界尺寸统一：先计算门洞世界宽度，再反推到父 Mesh 局部坐标，避免不同模型原始厚宽比导致同尺寸门图标不一致。 */
    const scaleXAbs: number = Math.max(Math.abs(owner.scale.x), DoorWindow2DSymbolHelper.MIN_SCALE_ABS);
    const scaleZAbs: number = Math.max(Math.abs(owner.scale.z), DoorWindow2DSymbolHelper.MIN_SCALE_ABS);
    const openingWorldWidth: number = config.width * scaleXAbs;
    const openingWorldDepth: number = config.depth * scaleZAbs;
    const doorLeafLocalLength: number = openingWorldWidth / scaleZAbs;
    const radiusXLocal: number = openingWorldWidth / scaleXAbs;
    const radiusZLocal: number = openingWorldWidth / scaleZAbs;
    const leafWorldThickness: number = Math.max(
      openingWorldDepth * DoorWindow2DSymbolHelper.DOOR_LEAF_THICKNESS_SCALE,
      0.025
    );
    const leafHalfThickness: number = (leafWorldThickness / scaleXAbs) * 0.5;
    const openingDirection: DoorOpeningDirection = DoorOpeningDirectionHelper.getDirection(owner);
    const directionSign: number = openingDirection === '内开' ? 1 : -1;
    const hingeX: number = openingMinX;
    const hingeZ: number = openingDirection === '内开' ? openingMaxZ : openingMinZ;
    const leafMinX: number = hingeX;
    const leafMaxX: number = hingeX + leafHalfThickness * 2;
    const leafMinZ: number = directionSign > 0 ? hingeZ : hingeZ - doorLeafLocalLength;
    const leafMaxZ: number = directionSign > 0 ? hingeZ + doorLeafLocalLength : hingeZ;

    const leafMesh: THREE.Mesh = DoorWindow2DSymbolHelper.createRectMesh(
      leafMinX,
      leafMaxX,
      leafMinZ,
      leafMaxZ,
      config.y + 0.003,
      0.95,
      owner
    );
    group.add(leafMesh);

    const leafOutline: THREE.LineSegments = DoorWindow2DSymbolHelper.createRectangleOutlineSegments(
      leafMinX,
      leafMaxX,
      leafMinZ,
      leafMaxZ,
      config.y + 0.01,
      owner
    );
    group.add(leafOutline);

    const arcHitMesh: THREE.Mesh = DoorWindow2DSymbolHelper.createDoorArcSectorMesh(
      hingeX,
      hingeZ,
      radiusXLocal,
      radiusZLocal,
      directionSign,
      config.y + 0.004,
      owner
    );
    group.add(arcHitMesh);

    const arcLine: THREE.Line = DoorWindow2DSymbolHelper.createArcLine(
      hingeX,
      hingeZ,
      radiusXLocal,
      radiusZLocal,
      directionSign,
      config.y + 0.011,
      owner
    );
    group.add(arcLine);

    const arcBoundaryLines: THREE.LineSegments = DoorWindow2DSymbolHelper.createLineSegments(
      [
        new THREE.Vector3(hingeX, config.y + 0.012, hingeZ),
        new THREE.Vector3(hingeX + radiusXLocal, config.y + 0.012, hingeZ),
        new THREE.Vector3(hingeX, config.y + 0.012, hingeZ),
        new THREE.Vector3(hingeX, config.y + 0.012, hingeZ + radiusZLocal * directionSign),
      ],
      owner
    );
    group.add(arcBoundaryLines);

    const openingLine: THREE.LineSegments = DoorWindow2DSymbolHelper.createLineSegments(
      [
        new THREE.Vector3(openingMinX, config.y + 0.013, hingeZ),
        new THREE.Vector3(openingMaxX, config.y + 0.013, hingeZ),
      ],
      owner
    );
    group.add(openingLine);
  }

  /**
   * 创建窗的 2D 符号：白色窗框矩形 + 外框线 + 双线窗框，覆盖墙洞区域便于点选。
   * @param group - 符号父组
   * @param config - 符号尺寸配置
   * @param owner - 所属 STL Mesh
   */
  private static buildWindowSymbol(group: THREE.Group, config: DoorWindowSymbolConfig, owner: THREE.Mesh): void {
    const halfWidth: number = config.width * 0.5;
    const halfDepth: number = Math.max(config.depth * 0.5, 0.06);
    const frameMesh: THREE.Mesh = DoorWindow2DSymbolHelper.createRectMesh(
      -halfWidth,
      halfWidth,
      -halfDepth,
      halfDepth,
      config.y,
      0.9,
      owner
    );
    group.add(frameMesh);

    const outlineSegments: THREE.LineSegments = DoorWindow2DSymbolHelper.createRectangleOutlineSegments(
      -halfWidth,
      halfWidth,
      -halfDepth,
      halfDepth,
      config.y + 0.007,
      owner
    );
    group.add(outlineSegments);

    const insetZ: number = Math.max(halfDepth * 0.45, 0.025);
    const lineSegments: THREE.LineSegments = DoorWindow2DSymbolHelper.createLineSegments(
      [
        new THREE.Vector3(-halfWidth, config.y + 0.006, -insetZ),
        new THREE.Vector3(halfWidth, config.y + 0.006, -insetZ),
        new THREE.Vector3(-halfWidth, config.y + 0.006, insetZ),
        new THREE.Vector3(halfWidth, config.y + 0.006, insetZ),
        new THREE.Vector3(0, config.y + 0.006, -halfDepth),
        new THREE.Vector3(0, config.y + 0.006, halfDepth),
      ],
      owner
    );
    group.add(lineSegments);
  }

  /**
   * 创建 XZ 平面矩形外框线段。
   * @param minX - 局部最小 X
   * @param maxX - 局部最大 X
   * @param minZ - 局部最小 Z
   * @param maxZ - 局部最大 Z
   * @param y - 局部 Y 高度
   * @param owner - 所属 STL Mesh
   * @returns 矩形外框线段对象
   */
  private static createRectangleOutlineSegments(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    y: number,
    owner: THREE.Mesh
  ): THREE.LineSegments {
    const points: Array<THREE.Vector3> = [
      new THREE.Vector3(minX, y, minZ),
      new THREE.Vector3(maxX, y, minZ),
      new THREE.Vector3(maxX, y, minZ),
      new THREE.Vector3(maxX, y, maxZ),
      new THREE.Vector3(maxX, y, maxZ),
      new THREE.Vector3(minX, y, maxZ),
      new THREE.Vector3(minX, y, maxZ),
      new THREE.Vector3(minX, y, minZ),
    ];
    return DoorWindow2DSymbolHelper.createLineSegments(points, owner);
  }

  /**
   * 创建 XZ 平面矩形 Mesh。
   * @param minX - 局部最小 X
   * @param maxX - 局部最大 X
   * @param minZ - 局部最小 Z
   * @param maxZ - 局部最大 Z
   * @param y - 局部 Y 高度
   * @param opacity - 填充透明度
   * @param owner - 所属 STL Mesh
   * @returns 矩形 Mesh
   */
  private static createRectMesh(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    y: number,
    opacity: number,
    owner: THREE.Mesh
  ): THREE.Mesh {
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    const vertices: Float32Array = new Float32Array([
      minX, y, minZ,
      maxX, y, minZ,
      maxX, y, maxZ,
      minX, y, maxZ,
    ]);
    const indices: Array<number> = [0, 1, 2, 0, 2, 3];
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material: THREE.MeshBasicMaterial = DoorWindow2DSymbolHelper.createFillMaterial(opacity);
    const mesh: THREE.Mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'door-window-2d-rect-hit';
    mesh.renderOrder = 10000;
    DoorWindow2DSymbolHelper.markSymbolObject(mesh, owner);
    return mesh;
  }

  /**
   * 创建门开启扇形点击 Mesh。
   * @param hingeX - 合页局部 X
   * @param hingeZ - 合页局部 Z
   * @param radiusX - 局部 X 方向开启半径
   * @param radiusZ - 局部 Z 方向开启半径
   * @param directionSign - 开启方向符号，1 表示向局部 +Z 绘制，-1 表示向局部 -Z 绘制
   * @param y - 局部 Y 高度
   * @param owner - 所属 STL Mesh
   * @returns 扇形 Mesh
   */
  private static createDoorArcSectorMesh(
    hingeX: number,
    hingeZ: number,
    radiusX: number,
    radiusZ: number,
    directionSign: number,
    y: number,
    owner: THREE.Mesh
  ): THREE.Mesh {
    const segmentCount: number = 24;
    const positions: Array<number> = [hingeX, y, hingeZ];
    const indices: Array<number> = [];

    for (let index: number = 0; index <= segmentCount; index += 1) {
      const angle: number = (Math.PI * 0.5 * index) / segmentCount;
      /* 扇形点击区域需与门开启方向一致，内开绘制到局部 +Z，外开绘制到局部 -Z。 */
      positions.push(hingeX + Math.cos(angle) * radiusX, y, hingeZ + Math.sin(angle) * radiusZ * directionSign);
      if (index > 0) {
        indices.push(0, index, index + 1);
      }
    }

    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material: THREE.MeshBasicMaterial = DoorWindow2DSymbolHelper.createFillMaterial(0.12);
    const mesh: THREE.Mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'door-window-2d-door-arc-hit';
    mesh.renderOrder = 9999;
    DoorWindow2DSymbolHelper.markSymbolObject(mesh, owner);
    return mesh;
  }

  /**
   * 创建门开启弧线。
   * @param hingeX - 合页局部 X
   * @param hingeZ - 合页局部 Z
   * @param radiusX - 局部 X 方向开启半径
   * @param radiusZ - 局部 Z 方向开启半径
   * @param directionSign - 开启方向符号，1 表示向局部 +Z 绘制，-1 表示向局部 -Z 绘制
   * @param y - 局部 Y 高度
   * @param owner - 所属 STL Mesh
   * @returns 弧线对象
   */
  private static createArcLine(
    hingeX: number,
    hingeZ: number,
    radiusX: number,
    radiusZ: number,
    directionSign: number,
    y: number,
    owner: THREE.Mesh
  ): THREE.Line {
    const points: Array<THREE.Vector3> = [];
    const segmentCount: number = 32;
    for (let index: number = 0; index <= segmentCount; index += 1) {
      const angle: number = (Math.PI * 0.5 * index) / segmentCount;
      /* 弧线方向跟随开启方向，避免只切换门扇而弧线仍固定向外侧显示。 */
      points.push(new THREE.Vector3(hingeX + Math.cos(angle) * radiusX, y, hingeZ + Math.sin(angle) * radiusZ * directionSign));
    }

    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const material: THREE.LineBasicMaterial = DoorWindow2DSymbolHelper.createLineMaterial();
    const line: THREE.Line = new THREE.Line(geometry, material);
    line.name = 'door-window-2d-door-arc-line';
    line.renderOrder = 10001;
    DoorWindow2DSymbolHelper.markSymbolObject(line, owner);
    return line;
  }

  /**
   * 创建线段集合。
   * @param points - 线段端点数组，每两个点构成一条线段
   * @param owner - 所属 STL Mesh
   * @returns 线段对象
   */
  private static createLineSegments(points: Array<THREE.Vector3>, owner: THREE.Mesh): THREE.LineSegments {
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const material: THREE.LineBasicMaterial = DoorWindow2DSymbolHelper.createLineMaterial();
    const lineSegments: THREE.LineSegments = new THREE.LineSegments(geometry, material);
    lineSegments.name = 'door-window-2d-symbol-lines';
    lineSegments.renderOrder = 10002;
    DoorWindow2DSymbolHelper.markSymbolObject(lineSegments, owner);
    return lineSegments;
  }

  /**
   * 创建符号填充材质。
   * @param opacity - 透明度
   * @returns MeshBasicMaterial
   */
  private static createFillMaterial(opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color: DoorWindow2DSymbolHelper.FILL_COLOR,
      transparent: true,
      opacity: opacity,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
  }

  /**
   * 创建符号线条材质。
   * @returns LineBasicMaterial
   */
  private static createLineMaterial(): THREE.LineBasicMaterial {
    return new THREE.LineBasicMaterial({
      color: DoorWindow2DSymbolHelper.LINE_COLOR,
      depthTest: false,
      depthWrite: false,
    });
  }

  /**
   * 为符号对象写入统一 userData 标记。
   * @param object - 需要标记的符号对象
   * @param owner - 所属 STL Mesh
   */
  private static markSymbolObject(object: THREE.Object3D, owner: THREE.Mesh): void {
    object.userData[DOOR_WINDOW_2D_SYMBOL_FLAG] = true;
    object.userData['ownerStlUuid'] = owner.uuid;
    object.userData['ownerStlModelId'] = owner.userData['stlModelId'];
  }

  /**
   * 释放旧符号对象占用的几何体和材质资源。
   * @param root - 需要释放资源的符号根对象
   */
  private static disposeObjectResources(root: THREE.Object3D): void {
    root.traverse((object: THREE.Object3D): void => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
        const geometry: THREE.BufferGeometry | undefined = object.geometry as THREE.BufferGeometry | undefined;
        const material: THREE.Material | Array<THREE.Material> | undefined = object.material as THREE.Material | Array<THREE.Material> | undefined;

        if (geometry !== undefined) {
          geometry.dispose();
        }

        if (Array.isArray(material)) {
          for (let index: number = 0; index < material.length; index += 1) {
            const item: THREE.Material = material[index]!;
            item.dispose();
          }
        } else if (material !== undefined) {
          material.dispose();
        }
      }
    });
  }
}