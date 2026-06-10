/**
 * 命令历史管理器
 * 命令栈的执行 / 撤销 / 重做 / 栈深度管理 / 状态订阅
 * 全局只应该有一个实例（通过 Context 注入）
 */

import type { ICommand } from './ICommand';
import type { HistoryState, HistoryListener } from './HistoryTypes';
import { DEFAULT_HISTORY_LIMIT } from './HistoryTypes';

/**
 * 命令历史管理器类
 * 提供 execute / undo / redo / clear / subscribe / dispose 接口
 */
export class CommandHistoryManager {
  /** 撤销栈：栈顶为最新执行的命令 */
  private _undoStack: Array<ICommand> = [];

  /** 重做栈：栈顶为最近一次被撤销的命令 */
  private _redoStack: Array<ICommand> = [];

  /** 栈深度上限 */
  private readonly _limit: number;

  /** 状态变更监听器集合 */
  private _listeners: Set<HistoryListener> = new Set<HistoryListener>();

  /**
   * @param limit - 撤销栈深度上限，默认 50
   */
  public constructor(limit: number = DEFAULT_HISTORY_LIMIT) {
    this._limit = Math.max(1, limit);
  }

  /* ========== 核心操作 ========== */

  /**
   * 执行命令并推入撤销栈
   * 关键流程：
   * 1. 调用 command.execute() 立即应用变更
   * 2. 推入撤销栈顶
   * 3. 清空重做栈（新命令执行后历史分支不可恢复）
   * 4. 若超出深度上限，丢弃栈底最早的命令并调用其 dispose()
   * 5. 通知所有订阅者
   * @param command - 待执行的命令
   */
  public execute(command: ICommand): void {
    /* 步骤 1：同步执行 */
    command.execute();

    /* 步骤 2：推入撤销栈 */
    this._undoStack.push(command);

    /* 步骤 3：清空重做栈 */
    this._disposeAndClear(this._redoStack);

    /* 步骤 4：超出深度上限时丢弃最早的命令 */
    while (this._undoStack.length > this._limit) {
      const dropped: ICommand | undefined = this._undoStack.shift();
      if (dropped !== undefined && typeof dropped.dispose === 'function') {
        dropped.dispose();
      }
    }

    /* 步骤 5：通知订阅者 */
    this._notify();
  }

  /**
   * 撤销栈顶命令
   * 空栈时安全返回，无任何副作用
   */
  public undo(): void {
    const command: ICommand | undefined = this._undoStack.pop();
    if (command === undefined) {
      /* 空栈静默忽略，不抛异常 */
      return;
    }

    /* 调用命令的 undo 还原状态 */
    command.undo();

    /* 压入重做栈，用户可重做 */
    this._redoStack.push(command);

    this._notify();
  }

  /**
   * 重做最近一次被撤销的命令
   * 空栈时安全返回
   */
  public redo(): void {
    const command: ICommand | undefined = this._redoStack.pop();
    if (command === undefined) {
      return;
    }

    /* 重做即再次 execute */
    command.execute();

    /* 压回撤销栈 */
    this._undoStack.push(command);

    this._notify();
  }

  /**
   * 清空两个栈，触发所有命令的 dispose
   */
  public clear(): void {
    this._disposeAndClear(this._undoStack);
    this._disposeAndClear(this._redoStack);
    this._notify();
  }

  /* ========== 查询 ========== */

  /**
   * 获取当前命令栈状态快照
   */
  public getState(): HistoryState {
    const undoTop: ICommand | undefined = this._undoStack[this._undoStack.length - 1];
    const redoTop: ICommand | undefined = this._redoStack[this._redoStack.length - 1];
    return {
      canUndo: this._undoStack.length > 0,
      canRedo: this._redoStack.length > 0,
      undoLabel: undoTop !== undefined ? undoTop.label : null,
      redoLabel: redoTop !== undefined ? redoTop.label : null,
      undoDepth: this._undoStack.length,
      redoDepth: this._redoStack.length,
    };
  }

  /* ========== 订阅 ========== */

  /**
   * 订阅命令栈状态变更
   * @param listener - 状态变更回调
   * @returns 取消订阅函数
   */
  public subscribe(listener: HistoryListener): () => void {
    this._listeners.add(listener);
    /* 注册时立即触发一次，使订阅方拿到当前状态 */
    listener(this.getState());
    return (): void => {
      this._listeners.delete(listener);
    };
  }

  /* ========== 资源释放 ========== */

  /**
   * 销毁管理器，释放所有命令资源与监听器
   */
  public dispose(): void {
    this._disposeAndClear(this._undoStack);
    this._disposeAndClear(this._redoStack);
    this._listeners.clear();
  }

  /* ========== 内部方法 ========== */

  /**
   * 通知所有监听器当前状态
   */
  private _notify(): void {
    const state: HistoryState = this.getState();
    this._listeners.forEach((listener: HistoryListener): void => {
      listener(state);
    });
  }

  /**
   * 释放栈内所有命令的资源并清空数组
   * @param stack - 待清空的命令栈
   */
  private _disposeAndClear(stack: Array<ICommand>): void {
    for (const command of stack) {
      if (typeof command.dispose === 'function') {
        command.dispose();
      }
    }
    stack.length = 0;
  }
}
