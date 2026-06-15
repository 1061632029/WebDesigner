/**
 * STL 普通模型旋转角度辅助工具
 * 统一处理属性面板角度值与 Three.js Y 轴欧拉角之间的换算，确保角度增加时模型绕 Y 轴正方向逆时针旋转。
 */

import * as THREE from 'three/webgpu';

/** STL 模型旋转角度属性名称 */
export const STL_ROTATION_ANGLE_USER_DATA_KEY: string = 'rotationAngle';

/** 最大可编辑 Y 轴正方向逆时针旋转角度（度） */
export const STL_ROTATION_ANGLE_MAX_DEGREES: number = 359;

/** 最小可编辑 Y 轴正方向逆时针旋转角度（度） */
export const STL_ROTATION_ANGLE_MIN_DEGREES: number = 0;

/**
 * STL 普通模型旋转角度辅助工具。
 */
export class StlRotationAngleHelper {
  /**
   * 将任意角度归一化为 0-359 的整数角度。
   * @param angleInDegrees - 输入角度，单位为度
   * @returns 归一化后的无负值整数角度
   */
  public static normalizeCounterClockwiseDegrees(angleInDegrees: number): number {
    const roundedDegrees: number = Math.round(angleInDegrees);
    const normalizedDegrees: number = ((roundedDegrees % 360) + 360) % 360;
    return normalizedDegrees;
  }

  /**
   * 将属性面板输入值限制为 0-359 的整数角度。
   * @param angleInDegrees - 属性面板输入角度，单位为度
   * @returns 限制后的合法角度
   */
  public static clampCounterClockwiseDegrees(angleInDegrees: number): number {
    const roundedDegrees: number = Math.round(angleInDegrees);
    const clampedDegrees: number = THREE.MathUtils.clamp(
      roundedDegrees,
      STL_ROTATION_ANGLE_MIN_DEGREES,
      STL_ROTATION_ANGLE_MAX_DEGREES
    );
    return clampedDegrees;
  }

  /**
   * 从 Mesh 当前 Y 轴旋转读取属性面板使用的 Y 轴正方向逆时针角度。
   * @param mesh - STL 普通模型 Mesh
   * @returns 0-359 的 Y 轴正方向逆时针旋转角度
   */
  public static getCounterClockwiseYDegrees(mesh: THREE.Mesh): number {
    const rawDegrees: number = THREE.MathUtils.radToDeg(mesh.rotation.y);
    const normalizedDegrees: number = StlRotationAngleHelper.normalizeCounterClockwiseDegrees(rawDegrees);
    return normalizedDegrees;
  }

  /**
   * 将属性面板 Y 轴正方向逆时针角度应用到 Mesh 的 Y 轴旋转，并同步 userData 属性。
   * @param mesh - STL 普通模型 Mesh
   * @param counterClockwiseDegrees - Y 轴正方向逆时针旋转角度，单位为度
   */
  public static applyCounterClockwiseYDegrees(mesh: THREE.Mesh, counterClockwiseDegrees: number): void {
    const normalizedDegrees: number = StlRotationAngleHelper.normalizeCounterClockwiseDegrees(counterClockwiseDegrees);
    const rotationInRadians: number = THREE.MathUtils.degToRad(normalizedDegrees);
    mesh.rotation.y = rotationInRadians;
    mesh.userData[STL_ROTATION_ANGLE_USER_DATA_KEY] = normalizedDegrees;
    mesh.updateMatrixWorld(true);
  }

  /**
   * 按 Mesh 当前 Y 轴正方向旋转同步 userData 中的角度属性。
   * @param mesh - STL 普通模型 Mesh
   * @returns 同步后的 Y 轴正方向逆时针旋转角度
   */
  public static syncUserDataFromMesh(mesh: THREE.Mesh): number {
    const normalizedDegrees: number = StlRotationAngleHelper.getCounterClockwiseYDegrees(mesh);
    mesh.userData[STL_ROTATION_ANGLE_USER_DATA_KEY] = normalizedDegrees;
    return normalizedDegrees;
  }
}