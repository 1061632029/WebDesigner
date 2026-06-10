/**
 * 命令栈相关类型定义
 * 与 ICommand 解耦的状态结构与监听器签名
 */

/**
 * 命令栈对外暴露的只读状态快照
 * 用于 React 组件订阅 / 工具栏按钮联动
 */
export interface HistoryState {
  /** 撤销栈是否非空 */
  canUndo: boolean;
  /** 重做栈是否非空 */
  canRedo: boolean;
  /** 撤销栈栈顶命令的标签（用于按钮 tooltip） */
  undoLabel: string | null;
  /** 重做栈栈顶命令的标签 */
  redoLabel: string | null;
  /** 当前撤销栈深度（已包含本次变更） */
  undoDepth: number;
  /** 当前重做栈深度 */
  redoDepth: number;
}

/**
 * 命令栈状态变更监听器签名
 */
export type HistoryListener = (state: HistoryState) => void;

/**
 * 命令栈深度上限默认值
 * 超出此深度时栈底最早的命令会被丢弃并触发其 dispose()
 */
export const DEFAULT_HISTORY_LIMIT: number = 50;
