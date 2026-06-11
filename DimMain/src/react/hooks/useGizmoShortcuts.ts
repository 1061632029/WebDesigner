/**
 * useGizmoShortcuts Hook
 * 注册全局键盘快捷键：Q（选择）
 * G（移动）/ R（旋转）/ S（缩放）暂时禁用，避免误触后点选模型显示可拖动坐标轴
 * 当焦点在 input / textarea / select / contenteditable 元素上时不响应
 * 通过 GizmoBridge 调用 setMode，同时更新 PanelManager 的激活工具栏 ID
 */

import { useEffect } from 'react';
import { useGizmoBridge } from '../context/GizmoContext';
import { usePanelManager } from './usePanel';
import type { GizmoBridge } from '../context/GizmoContext';
import type { PanelManager } from '../../panel/PanelManager';
import type { GizmoMode } from '../../interaction/TransformGizmo';

/**
 * 快捷键到 Gizmo 模式的映射（小写键名）
 * 仅保留 Q 返回选择模式；G/R/S 暂时禁用，防止误触显示 TransformControls 坐标轴。
 */
const KEY_TO_GIZMO_MODE: Record<string, GizmoMode> = {
  q: 'select',
};

/**
 * Gizmo 模式到工具栏按钮 ID 的映射
 */
const GIZMO_MODE_BUTTON_MAP: Record<GizmoMode, string> = {
  select: 'tb-select',
  move: 'tb-move',
  rotate: 'tb-rotate',
  scale: 'tb-scale',
};

/**
 * 判断当前焦点是否在文本输入元素上
 * 若是，则不拦截快捷键（避免干扰用户输入）
 */
function isFocusOnInput(): boolean {
  const activeElement: Element | null = document.activeElement;
  if (activeElement === null) {
    return false;
  }
  const tagName: string = activeElement.tagName.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }
  /* contenteditable 元素 */
  if ((activeElement as HTMLElement).isContentEditable) {
    return true;
  }
  return false;
}

/**
 * Gizmo 快捷键 Hook
 * 在 GizmoBridgeProvider 内部调用（通常在 AppShell 或 App 层）
 */
export function useGizmoShortcuts(): void {
  const gizmoBridge: GizmoBridge = useGizmoBridge();
  const panelManager: PanelManager = usePanelManager();

  useEffect((): (() => void) => {
    /**
     * 键盘按下事件处理
     * 仅响应 Q 键（无修饰键），G/R/S 变换快捷键暂时禁用。
     */
    const handleKeyDown = (event: KeyboardEvent): void => {
      /* 有修饰键时不响应（避免与 Ctrl+Z 等冲突） */
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }

      /* 焦点在输入框时不响应 */
      if (isFocusOnInput()) {
        return;
      }

      const key: string = event.key.toLowerCase();
      const mode: GizmoMode | undefined = KEY_TO_GIZMO_MODE[key];

      if (mode === undefined) {
        return;
      }

      /* 阻止默认行为（如 S 键触发页面滚动） */
      event.preventDefault();

      /* 调用 GizmoBridge 切换模式 */
      if (gizmoBridge.setModeRef.current !== null) {
        gizmoBridge.setModeRef.current(mode);
      }

      /* 同步更新工具栏高亮 */
      panelManager.setActiveToolbarId(GIZMO_MODE_BUTTON_MAP[mode]);
    };

    window.addEventListener('keydown', handleKeyDown);

    return (): void => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [gizmoBridge, panelManager]);
}
