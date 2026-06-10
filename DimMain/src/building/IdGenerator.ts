/**
 * 全局唯一 ID 生成器
 * 为所有渲染对象和建筑对象生成不重复的标识符
 */

/**
 * ID 生成器
 * 使用自增计数器 + 时间戳前缀确保唯一性
 */
export class IdGenerator {
  /** 自增计数器 */
  private static _counter: number = 0;

  /** 时间戳前缀（应用启动时确定） */
  private static _prefix: string = Date.now().toString(36);

  /**
   * 生成全局唯一 ID
   * 格式：{前缀}-{分类}-{自增序号}
   * @param category - 对象分类标识（如 'wall'、'column'）
   * @returns 全局唯一 ID 字符串
   */
  public static generate(category: string = 'obj'): string {
    IdGenerator._counter += 1;
    const id: string = `${IdGenerator._prefix}-${category}-${IdGenerator._counter}`;
    return id;
  }

  /**
   * 重置计数器（仅用于测试）
   */
  public static reset(): void {
    IdGenerator._counter = 0;
    IdGenerator._prefix = Date.now().toString(36);
  }
}
