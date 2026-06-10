/**
 * 右侧属性面板组件
 * 分组折叠面板，包含各种属性控件（滑块/开关/颜色/数值/下拉）
 */

import React from 'react';
import { usePanelData, usePanelManager } from '../../hooks/usePanel';
import type { PropertyGroup, PropertyItem } from '../../../panel/PanelTypes';
import {
  rightPanelStyle,
  propertyGroupHeaderStyle,
  propertyGroupContentStyle,
  propertyRowStyle,
  propertyLabelStyle,
} from './LayoutStyles';

/**
 * 渲染单个属性控件
 */
function PropertyControl({ item }: { item: PropertyItem }): React.ReactElement {
  switch (item.type) {
    case 'number': {
      /* 只读状态：输入框置灰禁用，显示锁定图标和提示 */
      const isReadonly: boolean = item.readonly === true;
      const inputStyle: React.CSSProperties = {
        width: 70,
        padding: '4px 6px',
        border: `1px solid ${isReadonly ? '#d0d0d0' : '#ddd'}`,
        borderRadius: 4,
        fontSize: 12,
        textAlign: 'right',
        background: isReadonly ? '#f0f0f0' : '#fff',
        color: isReadonly ? '#aaa' : '#333',
        cursor: isReadonly ? 'not-allowed' : 'text',
      };
      return (
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          title={isReadonly ? (item.readonlyHint ?? '只读，不可编辑') : undefined}
        >
          <input
            type="number"
            value={item.value}
            min={item.min}
            max={item.max}
            step={item.step ?? 1}
            disabled={isReadonly}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              if (!isReadonly) {
                item.onChange(parseFloat(e.target.value) || 0);
              }
            }}
            style={inputStyle}
          />
          {item.unit !== undefined && (
            <span style={{ fontSize: 11, color: isReadonly ? '#bbb' : '#888' }}>{item.unit}</span>
          )}
          {/* 只读时显示锁定图标，鼠标悬停显示提示 */}
          {isReadonly && (
            <span
              style={{ fontSize: 12, color: '#bbb', cursor: 'default', userSelect: 'none' }}
              title={item.readonlyHint ?? '只读，不可编辑'}
            >
              🔒
            </span>
          )}
        </div>
      );
    }

    case 'slider':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, maxWidth: 160 }}>
          <input
            type="range"
            min={item.min}
            max={item.max}
            step={item.step ?? 1}
            value={item.value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              item.onChange(parseFloat(e.target.value))
            }
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 11, color: '#666', minWidth: 30, textAlign: 'right' }}>
            {item.value}
          </span>
        </div>
      );

    case 'toggle':
      return (
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={item.value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              item.onChange(e.target.checked)
            }
            style={{ width: 36, height: 20, cursor: 'pointer' }}
          />
        </label>
      );

    case 'color':
      return (
        <input
          type="color"
          value={item.value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            item.onChange(e.target.value)
          }
          style={{ width: 32, height: 24, border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer', padding: 0 }}
        />
      );

    case 'select':
      return (
        <select
          value={item.value}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            item.onChange(e.target.value)
          }
          style={{ padding: '4px 6px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12 }}
        >
          {item.options.map((opt: { label: string; value: string }) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      );

    case 'button':
      return (
        <button
          onClick={item.action}
          style={{ padding: '4px 12px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12, cursor: 'pointer', background: '#f5f5f5' }}
        >
          {item.label}
        </button>
      );

    default:
      return <span>—</span>;
  }
}

/**
 * 右侧属性面板
 */
export function RightPropertyPanel(): React.ReactElement {
  const panelManager = usePanelManager();
  const groups: Array<PropertyGroup> = usePanelData((m) => m.getPropertyGroups());

  return (
    <div style={rightPanelStyle}>
      {groups.map((group: PropertyGroup, index: number) => (
        <div key={index}>
          {/* 分组标题（可折叠） */}
          <div
            style={propertyGroupHeaderStyle}
            onClick={() => panelManager.togglePropertyGroup(index)}
          >
            <span style={{ marginRight: 6, fontSize: 10 }}>
              {group.expanded ? '▼' : '▶'}
            </span>
            {group.title}
          </div>

          {/* 分组内容（折叠时隐藏） */}
          {group.expanded && (
            <div style={propertyGroupContentStyle}>
              {group.items.map((item: PropertyItem) => (
                <div key={item.id} style={propertyRowStyle}>
                  {/* 按钮类型不显示额外标签 */}
                  {item.type !== 'button' && (
                    <span style={propertyLabelStyle}>{item.label}</span>
                  )}
                  <PropertyControl item={item} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* 无属性时的占位提示 */}
      {groups.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', color: '#999', fontSize: 12 }}>
          选择对象以查看属性
        </div>
      )}
    </div>
  );
}
