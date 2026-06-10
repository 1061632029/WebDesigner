/**
 * 选中状态 React Context
 * 订阅 BuildingContext 提供的全局 SelectionManager，将选中变化映射为 React 响应式状态
 * 暴露 { selected, count, primary }，供 PropertyBinding / Gizmo / StatusBar 等模块消费
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useBuildingContext } from './BuildingContext';
import type { BuildingObject } from '../../building/BuildingTypes';
import type { SelectionManager } from '../../interaction/SelectionManager';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';

/**
 * Context 值类型
 */
export interface SelectionContextValue {
  /** 当前选中的对象列表（按 SelectionManager 顺序快照） */
  selected: ReadonlyArray<BuildingObject>;
  /** 当前选中对象数量 */
  count: number;
  /**
   * 主选对象：单选时为唯一选中项；多选时为第一个；无选时为 null
   * 由 PropertyBinding / Gizmo 等用作"操作主体"
   */
  primary: BuildingObject | null;
  /**
   * 选中管理器（用于命令式操作：select / clear 等）
   * 在 BuildingProvider 初始化完成前可能为 null
   */
  manager: SelectionManager | null;
}

/** Context 实例，默认 null 用于检测调用是否在 Provider 内 */
const SelectionCtx: React.Context<SelectionContextValue | null> = createContext<SelectionContextValue | null>(null);

/**
 * SelectionProvider Props
 */
export interface SelectionProviderProps {
  /** 子组件 */
  children: ReactNode;
}

/**
 * 将选中 ID 集合映射为 BuildingObject 数组
 * @param ids - 选中对象 ID
 * @param objectManager - 对象管理器（用于查表）
 */
function mapIdsToObjects(
  ids: ReadonlySet<string>,
  objectManager: BuildingObjectManager
): ReadonlyArray<BuildingObject> {
  const result: Array<BuildingObject> = [];
  ids.forEach((id: string): void => {
    const obj: BuildingObject | undefined = objectManager.getById(id);
    if (obj !== undefined) {
      result.push(obj);
    }
  });
  return result;
}

/**
 * SelectionProvider 组件
 * 必须放置在 BuildingProvider 内部（依赖其 selectionManager 与 objectManager）
 */
export function SelectionProvider(props: SelectionProviderProps): React.ReactElement {
  const { selectionManager, objectManager } = useBuildingContext();

  /** 响应式选中对象列表 */
  const [selected, setSelected] = useState<ReadonlyArray<BuildingObject>>([]);

  /**
   * 订阅 SelectionManager.onChange
   * 仅当两个管理器都就绪时建立订阅
   */
  useEffect((): (() => void) => {
    if (selectionManager === null || objectManager === null) {
      return (): void => {};
    }

    /* 初始同步一次当前选中（覆盖首次挂载时已存在选中的情况） */
    setSelected(mapIdsToObjects(selectionManager.selectedIds, objectManager));

    const unsubscribe: () => void = selectionManager.onChange(
      (ids: ReadonlySet<string>): void => {
        setSelected(mapIdsToObjects(ids, objectManager));
      }
    );

    return (): void => {
      unsubscribe();
    };
  }, [selectionManager, objectManager]);

  /** 计算派生状态：count 与 primary */
  const value: SelectionContextValue = useMemo(
    (): SelectionContextValue => ({
      selected: selected,
      count: selected.length,
      primary: selected.length > 0 ? (selected[0] as BuildingObject) : null,
      manager: selectionManager,
    }),
    [selected, selectionManager]
  );

  return <SelectionCtx.Provider value={value}>{props.children}</SelectionCtx.Provider>;
}

/**
 * 获取选中状态上下文
 * @throws 不在 SelectionProvider 内调用时抛出
 */
export function useSelectionContext(): SelectionContextValue {
  const ctx: SelectionContextValue | null = useContext(SelectionCtx);
  if (ctx === null) {
    throw new Error('useSelectionContext 必须在 <SelectionProvider> 组件树内调用');
  }
  return ctx;
}
