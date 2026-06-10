/**
 * 属性变更命令
 * 通过点分路径（如 "material.color"、"thickness"）定位嵌套属性并修改其值
 * 提供 onApply 钩子，让调用方在属性写入后触发副作用（如重建几何体、刷新材质）
 */

import type { ICommand } from '../ICommand';

/**
 * 属性变更应用回调
 * @param target - 目标对象
 * @param path - 属性路径
 * @param value - 当前已写入的值
 */
export type PropertyChangeApplyHook<T> = (target: T, path: string, value: unknown) => void;

/**
 * 属性变更命令配置
 */
export interface PropertyChangeCommandOptions<T> {
  /** 目标对象（命令生命周期内必须存活） */
  target: T;
  /** 属性路径，支持点分嵌套（如 "material.color"） */
  propertyPath: string;
  /** 变更前的值（深拷贝） */
  before: unknown;
  /** 变更后的值（深拷贝） */
  after: unknown;
  /** 命令标签 */
  label?: string;
  /** 属性写入完成后的副作用回调（如调用 manager.updateObject 重建几何） */
  onApply?: PropertyChangeApplyHook<T>;
}

/**
 * 属性变更命令
 */
export class PropertyChangeCommand<T = unknown> implements ICommand {
  /** 命令标签 */
  public readonly label: string;

  /** 目标对象 */
  private readonly _target: T;

  /** 属性路径 */
  private readonly _path: string;

  /** 变更前的值 */
  private readonly _before: unknown;

  /** 变更后的值 */
  private readonly _after: unknown;

  /** 应用副作用回调 */
  private readonly _onApply: PropertyChangeApplyHook<T> | undefined;

  /**
   * @param options - 命令配置
   */
  public constructor(options: PropertyChangeCommandOptions<T>) {
    this._target = options.target;
    this._path = options.propertyPath;
    /* 深拷贝防止外部 mutate 影响 before/after */
    this._before = PropertyChangeCommand._safeClone(options.before);
    this._after = PropertyChangeCommand._safeClone(options.after);
    this._onApply = options.onApply;
    this.label = options.label !== undefined ? options.label : `修改 ${options.propertyPath}`;
  }

  /**
   * 执行：将目标的指定路径属性设为 after 值
   */
  public execute(): void {
    PropertyChangeCommand._setByPath(this._target, this._path, PropertyChangeCommand._safeClone(this._after));
    if (this._onApply !== undefined) {
      this._onApply(this._target, this._path, this._after);
    }
  }

  /**
   * 撤销：将目标的指定路径属性还原为 before 值
   */
  public undo(): void {
    PropertyChangeCommand._setByPath(this._target, this._path, PropertyChangeCommand._safeClone(this._before));
    if (this._onApply !== undefined) {
      this._onApply(this._target, this._path, this._before);
    }
  }

  /**
   * 按点分路径设置属性值
   * 支持嵌套对象路径（如 "material.color"），中间节点必须已存在
   * @param target - 目标对象（按 any 处理，因为路径动态）
   * @param path - 点分路径
   * @param value - 新值
   */
  private static _setByPath(target: unknown, path: string, value: unknown): void {
    const segments: Array<string> = path.split('.');
    if (segments.length === 0) {
      return;
    }

    /* 走到倒数第二级 */
    let current: Record<string, unknown> = target as Record<string, unknown>;
    for (let i: number = 0; i < segments.length - 1; i++) {
      const key: string = segments[i] as string;
      const next: unknown = current[key];
      if (next === null || next === undefined || typeof next !== 'object') {
        /* 路径中断，无法继续，静默忽略以避免抛错破坏栈状态 */
        return;
      }
      current = next as Record<string, unknown>;
    }

    /* 写入末级属性 */
    const lastKey: string = segments[segments.length - 1] as string;
    current[lastKey] = value;
  }

  /**
   * 安全克隆值：基础类型直接返回；对象类型用 JSON 克隆
   */
  private static _safeClone(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value;
    }
    const type: string = typeof value;
    if (type === 'number' || type === 'string' || type === 'boolean') {
      return value;
    }
    /* 对象/数组深拷贝（要求仅包含 JSON 安全类型） */
    return JSON.parse(JSON.stringify(value));
  }
}
