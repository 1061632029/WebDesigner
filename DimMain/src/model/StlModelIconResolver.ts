/**
 * STL 模型小图标解析工具
 * 根据模型显示名称匹配更准确的 emoji 图标，供模型库卡片展示使用。
 */

/**
 * 根据 STL 模型名称解析展示小图标。
 * @param name - STL 模型显示名称
 * @param fallbackIcon - 未匹配到名称规则时使用的兜底图标
 * @returns 匹配后的 emoji 小图标
 */
export function resolveStlModelIconByName(name: string, fallbackIcon: string): string {
  /* 门窗类名称优先匹配：保证门窗放入基础几何体后不会再依赖 STL 缩略图。 */
  if (name.includes('窗')) {
    return '\u{1FA9F}';
  }

  if (name.includes('门')) {
    return '\u{1F6AA}';
  }

  /* 家具和卫浴类名称匹配：普通模型缩略图未生成前也能显示准确占位图标。 */
  if (name.includes('马桶')) {
    return '\u{1F6BD}';
  }

  if (name.includes('洗手池')) {
    return '\u{1F6B0}';
  }

  if (name.includes('床')) {
    return '\u{1F6CF}\u{FE0F}';
  }

  if (name.includes('电视柜')) {
    return '\u{1F5C4}\u{FE0F}';
  }

  if (name.includes('电视')) {
    return '\u{1F4FA}';
  }

  if (name.includes('沙发')) {
    return '\u{1F6CB}\u{FE0F}';
  }

  if (name.includes('书桌')) {
    return '\u{1F4DA}';
  }

  if (name.includes('椅')) {
    return '\u{1FA91}';
  }

  return fallbackIcon;
}