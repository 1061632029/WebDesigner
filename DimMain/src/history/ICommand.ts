/**
 * 命令模式接口定义
 * 所有可撤销操作的统一契约，遵循同步执行模型
 * 实现类必须保证 execute() 与 undo() 形成幂等对：
 * 任意次数的 execute → undo 序列执行后系统状态与执行前一致
 */

/**
 * 可撤销命令接口
 * 所有进入 CommandHistoryManager 的命令都需要实现此接口
 */
export interface ICommand {
  /** 命令标签，用于 UI 显示（如撤销/重做按钮的 tooltip） */
  readonly label: string;

  /**
   * 执行命令（包括首次执行与重做）
   * 必须是同步的、无副作用之外的网络调用
   */
  execute(): void;

  /**
   * 撤销命令，将系统状态还原到 execute 之前
   */
  undo(): void;

  /**
   * 可选钩子：当命令被栈丢弃（超出深度上限）时调用
   * 用于释放命令内部持有的可释放资源（如已 detach 的 GPU geometry/material）
   * 不实现此方法时丢弃命令不做额外清理
   */
  dispose?(): void;
}
