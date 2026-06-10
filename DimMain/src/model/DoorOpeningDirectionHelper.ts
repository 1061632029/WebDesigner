/**
 * 门开启方向辅助工具
 * 统一维护门开启方向属性的默认值、切换逻辑与 2D 符号刷新逻辑。
 */

import * as THREE from 'three/webgpu';
import { DoorWindow2DSymbolHelper } from './DoorWindow2DSymbolHelper';

/** 门开启方向属性值 */
export type DoorOpeningDirection = '内开' | '外开';

/** 门开启方向 userData 字段名 */
export const DOOR_OPENING_DIRECTION_USER_DATA_KEY: string = 'doorOpeningDirection';

/** 门开启方向选项 */
export const DOOR_OPENING_DIRECTION_OPTIONS: Array<DoorOpeningDirection> = ['内开', '外开'];

/**
 * 门开启方向辅助工具
 */
export class DoorOpeningDirectionHelper {
  /** 默认门开启方向：保持历史 2D 图标向墙外开启的表现 */
  public static readonly DEFAULT_DIRECTION: DoorOpeningDirection = '外开';

  /**
   * 判断 Mesh 是否为门类型 STL。
   * @param mesh - 待判断 Mesh
   * @returns 是门类型 STL 时返回 true
   */
  public static isDoorMesh(mesh: THREE.Mesh): boolean {
    return mesh.userData['category'] === 'door';
  }

  /**
   * 读取门开启方向；缺失或非法时返回默认值。
   * @param mesh - 门 Mesh
   * @returns 当前门开启方向
   */
  public static getDirection(mesh: THREE.Mesh): DoorOpeningDirection {
    const rawDirection: unknown = mesh.userData[DOOR_OPENING_DIRECTION_USER_DATA_KEY];
    if (rawDirection === '内开' || rawDirection === '外开') {
      return rawDirection;
    }
    return DoorOpeningDirectionHelper.DEFAULT_DIRECTION;
  }

  /**
   * 写入门开启方向属性。
   * @param mesh - 门 Mesh
   * @param direction - 目标开启方向
   */
  public static setDirection(mesh: THREE.Mesh, direction: DoorOpeningDirection): void {
    mesh.userData[DOOR_OPENING_DIRECTION_USER_DATA_KEY] = direction;
  }

  /**
   * 确保门 Mesh 存在开启方向属性。
   * @param mesh - 门 Mesh
   * @returns 最终写入或读取到的开启方向
   */
  public static ensureDirection(mesh: THREE.Mesh): DoorOpeningDirection {
    const direction: DoorOpeningDirection = DoorOpeningDirectionHelper.getDirection(mesh);
    DoorOpeningDirectionHelper.setDirection(mesh, direction);
    return direction;
  }

  /**
   * 切换门开启方向属性。
   * @param mesh - 门 Mesh
   * @returns 切换后的开启方向
   */
  public static toggleDirection(mesh: THREE.Mesh): DoorOpeningDirection {
    const currentDirection: DoorOpeningDirection = DoorOpeningDirectionHelper.getDirection(mesh);
    const nextDirection: DoorOpeningDirection = currentDirection === '内开' ? '外开' : '内开';
    DoorOpeningDirectionHelper.setDirection(mesh, nextDirection);
    return nextDirection;
  }

  /**
   * 切换门开启方向并刷新 2D 图标。
   * @param mesh - 门 Mesh
   * @param visible - 2D 图标刷新后的可见状态
   * @returns 切换后的开启方向
   */
  public static toggleDirectionAndRefreshSymbol(mesh: THREE.Mesh, visible: boolean): DoorOpeningDirection {
    const nextDirection: DoorOpeningDirection = DoorOpeningDirectionHelper.toggleDirection(mesh);
    DoorWindow2DSymbolHelper.attachSymbol(mesh, visible);
    return nextDirection;
  }

  /**
   * 设置门开启方向并刷新 2D 图标。
   * @param mesh - 门 Mesh
   * @param direction - 目标开启方向
   * @param visible - 2D 图标刷新后的可见状态
   */
  public static setDirectionAndRefreshSymbol(
    mesh: THREE.Mesh,
    direction: DoorOpeningDirection,
    visible: boolean
  ): void {
    DoorOpeningDirectionHelper.setDirection(mesh, direction);
    DoorWindow2DSymbolHelper.attachSymbol(mesh, visible);
  }
}