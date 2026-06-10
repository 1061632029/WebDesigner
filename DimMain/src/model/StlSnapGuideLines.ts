/**
 * STL 模型包围盒吸附虚线提示
 * 当预览模型发生包围盒边界吸附时，在吸附边界处绘制虚线提示
 * X 轴吸附：在吸附的 X 边界处绘制沿 Z 轴方向延伸的虚线
 * Z 轴吸附：在吸附的 Z 边界处绘制沿 X 轴方向延伸的虚线
 */

import * as THREE from 'three/webgpu';
import type { BBoxSnapResult } from './StlBBoxSnapHelper';

/**
 * 虚线延伸半长（米）
 * 以吸附边界为中心，向两侧各延伸此距离
 */
const GUIDE_HALF_LENGTH: number = 10;

/**
 * 虚线 Y 轴高度（米）
 * 略高于地面，避免 Z-fighting
 */
const GUIDE_Y: number = 0.01;

/**
 * 吸附虚线提示管理器
 * 负责创建、更新、销毁吸附提示虚线
 */
export class StlSnapGuideLines {
  /** 场景引用 */
  private _scene: THREE.Scene;

  /**
   * X 轴吸附虚线（沿 Z 轴方向延伸）
   * 在吸附的 X 边界处显示
   */
  private _lineX: THREE.LineSegments | null = null;

  /**
   * Z 轴吸附虚线（沿 X 轴方向延伸）
   * 在吸附的 Z 边界处显示
   */
  private _lineZ: THREE.LineSegments | null = null;

  /**
   * @param scene - Three.js 场景
   */
  constructor(scene: THREE.Scene) {
    this._scene = scene;
    this._createLines();
  }

  /* ========== 公共方法 ========== */

  /**
   * 根据吸附结果更新虚线位置和可见性
   * 无吸附时隐藏所有虚线
   *
   * @param snapResult - 包围盒吸附结果
   * @param previewMesh - 预览 Mesh（用于获取吸附后的包围盒边界坐标）
   */
  public update(snapResult: BBoxSnapResult, previewMesh: THREE.Mesh): void {
    if (!snapResult.snappedX && !snapResult.snappedZ) {
      /* 无吸附：隐藏所有虚线 */
      this._setVisible(false, false);
      return;
    }

    /* previewMesh 参数保留供未来扩展使用（如限制虚线延伸范围） */
    void previewMesh;

    /* X 轴吸附：在吸附的 X 边界处绘制沿 Z 轴方向的虚线
     * 直接使用 snapResult.snapEdgeX（吸附后的精确边界坐标），避免从包围盒推断出错 */
    if (snapResult.snappedX && this._lineX !== null) {
      const snapX: number = snapResult.snapEdgeX;
      this._updateLineGeometry(
        this._lineX,
        new THREE.Vector3(snapX, GUIDE_Y, -GUIDE_HALF_LENGTH),
        new THREE.Vector3(snapX, GUIDE_Y, GUIDE_HALF_LENGTH)
      );
      this._lineX.visible = true;
    } else if (this._lineX !== null) {
      this._lineX.visible = false;
    }

    /* Z 轴吸附：在吸附的 Z 边界处绘制沿 X 轴方向的虚线
     * 直接使用 snapResult.snapEdgeZ（吸附后的精确边界坐标），避免从包围盒推断出错 */
    if (snapResult.snappedZ && this._lineZ !== null) {
      const snapZ: number = snapResult.snapEdgeZ;
      this._updateLineGeometry(
        this._lineZ,
        new THREE.Vector3(-GUIDE_HALF_LENGTH, GUIDE_Y, snapZ),
        new THREE.Vector3(GUIDE_HALF_LENGTH, GUIDE_Y, snapZ)
      );
      this._lineZ.visible = true;
    } else if (this._lineZ !== null) {
      this._lineZ.visible = false;
    }
  }

  /**
   * 隐藏所有虚线（无吸附时调用）
   */
  public hide(): void {
    this._setVisible(false, false);
  }

  /**
   * 销毁虚线，从场景移除并释放资源
   */
  public dispose(): void {
    this._destroyLine(this._lineX);
    this._destroyLine(this._lineZ);
    this._lineX = null;
    this._lineZ = null;
  }

  /* ========== 内部方法 ========== */

  /**
   * 创建 X 轴和 Z 轴两条虚线对象并添加到场景
   * 初始隐藏，等待 update() 调用时显示
   */
  private _createLines(): void {
    /* 虚线材质：青蓝色，dashSize/gapSize 控制虚线间距 */
    const material: THREE.LineDashedMaterial = new THREE.LineDashedMaterial({
      color: 0x00ccff,
      dashSize: 0.12,
      gapSize: 0.06,
      linewidth: 1,
    });

    /* X 轴吸附虚线（沿 Z 轴方向） */
    this._lineX = this._createLine(material.clone());
    this._lineX.name = 'stl-snap-guide-x';
    this._lineX.visible = false;
    this._scene.add(this._lineX);

    /* Z 轴吸附虚线（沿 X 轴方向） */
    this._lineZ = this._createLine(material.clone());
    this._lineZ.name = 'stl-snap-guide-z';
    this._lineZ.visible = false;
    this._scene.add(this._lineZ);
  }

  /**
   * 创建单条虚线 LineSegments 对象
   * 初始几何体为零长度线段，后续通过 _updateLineGeometry 更新
   * @param material - 虚线材质
   * @returns LineSegments 对象
   */
  private _createLine(material: THREE.LineDashedMaterial): THREE.LineSegments {
    /* 初始化为零长度线段（两点重合），等待 update 时更新 */
    const positions: Float32Array = new Float32Array([0, 0, 0, 0, 0, 0]);
    const geometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const line: THREE.LineSegments = new THREE.LineSegments(geometry, material);
    /* renderOrder 高于普通对象，确保虚线不被地面遮挡 */
    line.renderOrder = 100;
    return line;
  }

  /**
   * 更新虚线几何体的两个端点坐标
   * 同时调用 computeLineDistances() 使虚线间距生效
   * @param line - 要更新的 LineSegments 对象
   * @param start - 起点世界坐标
   * @param end - 终点世界坐标
   */
  private _updateLineGeometry(
    line: THREE.LineSegments,
    start: THREE.Vector3,
    end: THREE.Vector3
  ): void {
    const posAttr: THREE.BufferAttribute = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    /* 更新起点 */
    posAttr.setXYZ(0, start.x, start.y, start.z);
    /* 更新终点 */
    posAttr.setXYZ(1, end.x, end.y, end.z);
    posAttr.needsUpdate = true;
    /* 重新计算线段累积长度，LineDashedMaterial 依赖此数据渲染虚线 */
    line.computeLineDistances();
  }

  /**
   * 设置两条虚线的可见性
   * @param visX - X 轴虚线是否可见
   * @param visZ - Z 轴虚线是否可见
   */
  private _setVisible(visX: boolean, visZ: boolean): void {
    if (this._lineX !== null) {
      this._lineX.visible = visX;
    }
    if (this._lineZ !== null) {
      this._lineZ.visible = visZ;
    }
  }

  /**
   * 销毁单条虚线，从场景移除并释放几何体/材质资源
   * @param line - 要销毁的 LineSegments 对象
   */
  private _destroyLine(line: THREE.LineSegments | null): void {
    if (line === null) {
      return;
    }
    this._scene.remove(line);
    line.geometry.dispose();
    const mat: THREE.Material | THREE.Material[] = line.material;
    if (Array.isArray(mat)) {
      mat.forEach((m: THREE.Material): void => m.dispose());
    } else {
      mat.dispose();
    }
  }
}
