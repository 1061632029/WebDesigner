/**
 * 墙体绘制工具门面类。
 * 对外保持原有 WallDrawTool API，内部按模型类型和通用功能拆分到多个处理器。
 */

import { WallDrawToolLifecycle } from './WallDrawToolLifecycle';

/**
 * 墙体绘制工具。
 * 通过继承组合各功能处理器，保持外部构造方式和公开方法兼容。
 */
export class WallDrawTool extends WallDrawToolLifecycle {}
