/**
 * 命令栈全局快捷键 Hook
 * 注册 Ctrl+Z（撤销）、Ctrl+Y（重做）、Ctrl+Shift+Z（重做）
 * 当焦点位于 <input> / <textarea> / contentEditable 元素时不拦截，保留浏览器默认行为
 */

import { useEffect } from 'react';
import { useHistoryManager } from '../context/HistoryContext';

/**
 * 判断当前焦点是否位于可编辑文本元素
 * 这些元素需要保留浏览器原生的撤销/重做能力
 */
function isEditableElementFocused(): boolean {
  const active: Element | null = document.activeElement;
  if (active === null) {
    return false;
  }

  /* HTMLInputElement / HTMLTextAreaElement 优先判定 */
  const tagName: string = active.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea') {
    return true;
  }

  /* contentEditable 元素（如 div[contenteditable="true"]） */
  if (active instanceof HTMLElement && active.isContentEditable) {
    return true;
  }

  return false;
}

/**
 * 注册全局命令栈快捷键
 * 必须在 HistoryProvider 子组件中调用
 * 通常由 AppShell 或顶层布局组件调用一次
 */
export function useHistoryShortcuts(): void {
  const manager = useHistoryManager();

  useEffect((): (() => void) => {
    /* 键盘事件处理函数 */
    const handler = (event: KeyboardEvent): void => {
      /* 焦点在可编辑元素上时跳过，保留浏览器默认撤销/重做 */
      if (isEditableElementFocused()) {
        return;
      }

      /* macOS 兼容：metaKey 等价于 ctrlKey */
      const isCtrl: boolean = event.ctrlKey || event.metaKey;
      if (!isCtrl) {
        return;
      }

      const key: string = event.key.toLowerCase();

      /* Ctrl+Z 撤销（无 Shift） */
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        manager.undo();
        return;
      }

      /* Ctrl+Y 或 Ctrl+Shift+Z 重做 */
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        manager.redo();
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return (): void => {
      window.removeEventListener('keydown', handler);
    };
  }, [manager]);
}
