/**
 * 门左右开属性辅助工具
 * 统一维护门 comb 属性的默认值、读写逻辑与 2D 门图标刷新逻辑。
 */

import * as THREE from 'three/webgpu';
import { DoorWindow2DSymbolHelper } from './DoorWindow2DSymbolHelper';

/** 门左右开属性值 */
export type DoorComb = '左开' | '右开';

/** 门左右开 userData 字段名 */
export const DOOR_COMB_USER_DATA_KEY: string = 'comb';

/** 门左右开选项 */
export const DOOR_COMB_OPTIONS: Array<DoorComb> = ['左开', '右开'];

/**
 * 门左右开属性辅助工具
 */
export class DoorCombHelper {
  /** 默认门左右开：保持历史 2D 图标门板位于左侧的表现 */
  public static readonly DEFAULT_COMB: DoorComb = '左开';

  /**
   * 判断 Mesh 是否为门类型 STL。
   * @param mesh - 待判断 Mesh
   * @returns 是门类型 STL 时返回 true
   */
  public static isDoorMesh(mesh: THREE.Mesh): boolean {
    return mesh.userData['category'] === 'door';
  }

  /**
   * 读取门左右开属性；缺失或非法时返回默认值。
   * @param mesh - 门 Mesh
   * @returns 当前门左右开属性
   */
  public static getComb(mesh: THREE.Mesh): DoorComb {
    const rawComb: unknown = mesh.userData[DOOR_COMB_USER_DATA_KEY];
    if (rawComb === '左开' || rawComb === '右开') {
      return rawComb;
    }
    return DoorCombHelper.DEFAULT_COMB;
  }

  /**
   * 写入门左右开属性。
   * @param mesh - 门 Mesh
   * @param comb - 目标左右开属性
   */
  public static setComb(mesh: THREE.Mesh, comb: DoorComb): void {
    mesh.userData[DOOR_COMB_USER_DATA_KEY] = comb;
  }

  /**
   * 确保门 Mesh 存在左右开属性。
   * @param mesh - 门 Mesh
   * @returns 最终写入或读取到的左右开属性
   */
  public static ensureComb(mesh: THREE.Mesh): DoorComb {
    const comb: DoorComb = DoorCombHelper.getComb(mesh);
    DoorCombHelper.setComb(mesh, comb);
    return comb;
  }

  /**
   * 切换门左右开属性。
   * @param mesh - 门 Mesh
   * @returns 切换后的左右开属性
   */
  public static toggleComb(mesh: THREE.Mesh): DoorComb {
    const currentComb: DoorComb = DoorCombHelper.getComb(mesh);
    const nextComb: DoorComb = currentComb === '左开' ? '右开' : '左开';
    DoorCombHelper.setComb(mesh, nextComb);
    return nextComb;
  }

  /**
   * 切换门左右开属性并刷新 2D 图标。
   * @param mesh - 门 Mesh
   * @param visible - 2D 图标刷新后的可见状态
   * @returns 切换后的左右开属性
   */
  public static toggleCombAndRefreshSymbol(mesh: THREE.Mesh, visible: boolean): DoorComb {
    const nextComb: DoorComb = DoorCombHelper.toggleComb(mesh);
    DoorWindow2DSymbolHelper.attachSymbol(mesh, visible);
    return nextComb;
  }

  /**
   * 设置门左右开属性并刷新 2D 图标。
   * @param mesh - 门 Mesh
   * @param comb - 目标左右开属性
   * @param visible - 2D 图标刷新后的可见状态
   */
  public static setCombAndRefreshSymbol(mesh: THREE.Mesh, comb: DoorComb, visible: boolean): void {
    DoorCombHelper.setComb(mesh, comb);
    DoorWindow2DSymbolHelper.attachSymbol(mesh, visible);
  }
}