/**
 * 墙体绘制工具共享类型定义。
 * 仅存放跨模型、跨功能模块复用的类型，避免模型处理器之间互相耦合。
 */

/** 绘制工具状态变更回调。 */
export type DrawToolChangeCallback = () => void;

/** 线性布置预览当前键盘编辑目标，Tab 在长度与角度之间切换。 */
export type LinearPreviewEditTarget = 'length' | 'angle';
