/**
 * 照片存储栏组件
 * 场景菜单激活时替代右侧属性栏，用于承载当前项目的拍摄照片列表。
 */

import React, { useState } from 'react';
import type { PanelManager } from '../../../panel/PanelManager';
import type { PhotoStorageItem } from '../../../panel/PanelTypes';
import { usePanelData, usePanelManager } from '../../hooks/usePanel';
import {
  photoStoragePanelStyle,
  photoStorageTitleStyle,
  photoStorageContentStyle,
  photoStorageEmptyStyle,
  photoStorageListStyle,
  photoStorageCardStyle,
  photoStorageImageStyle,
  photoStorageMetaStyle,
  photoStorageNameStyle,
  photoStorageTimeStyle,
  photoStorageActionsStyle,
  photoStorageActionButtonStyle,
  photoStorageDeleteButtonStyle,
  photoPreviewOverlayStyle,
  photoPreviewDialogStyle,
  photoPreviewHeaderStyle,
  photoPreviewTitleStyle,
  photoPreviewCloseButtonStyle,
  photoPreviewImageWrapStyle,
  photoPreviewImageStyle,
  photoPreviewFooterStyle,
  photoPreviewInfoStyle,
  photoPreviewPrimaryButtonStyle,
} from './LayoutStyles';

/**
 * 照片存储栏。
 * @returns 场景菜单右侧照片存储栏元素
 */
export function PhotoStoragePanel(): React.ReactElement {
  const panelManager: PanelManager = usePanelManager();
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoStorageItem | null>(null);
  const photoStorageItems: Array<PhotoStorageItem> = usePanelData(
    (manager: PanelManager): Array<PhotoStorageItem> => manager.getPhotoStorageItems()
  );

  /**
   * 打开照片预览。
   * @param item - 当前点击的照片项
   */
  const handlePreviewPhoto = (item: PhotoStorageItem): void => {
    /* 使用页面内弹窗预览，避免浏览器拦截 Data URL 新窗口导致图片无法显示。 */
    setSelectedPhoto(item);
  };

  /**
   * 关闭照片预览弹窗。
   */
  const handleClosePreview = (): void => {
    setSelectedPhoto(null);
  };

  /**
   * 下载当前预览照片。
   * @param item - 待下载照片项
   */
  const handleDownloadPhoto = (item: PhotoStorageItem): void => {
    /* 通过临时 a 标签触发浏览器下载，文件内容来自已生成的 Data URL。 */
    const linkElement: HTMLAnchorElement = document.createElement('a');
    linkElement.href = item.dataUrl;
    linkElement.download = `${item.name}.png`;
    linkElement.click();
  };

  /**
   * 删除照片存储项。
   * @param item - 待删除照片项
   */
  const handleRemovePhoto = (item: PhotoStorageItem): void => {
    /* 删除仅影响当前内存中的照片列表，不会触发本地文件操作。 */
    panelManager.removePhotoStorageItem(item.id);
  };

  return (
    <>
      <aside style={photoStoragePanelStyle}>
        {/* 标题区域：明确当前右侧栏已从属性编辑切换为照片存储。 */}
        <div style={photoStorageTitleStyle}>照片存储</div>

        {/* 内容区域：展示拍摄生成的内存照片列表，空列表时显示引导提示。 */}
        <div style={photoStorageContentStyle}>
          {photoStorageItems.length === 0 ? (
            <div style={photoStorageEmptyStyle}>
              <div>暂无照片</div>
              <div>请在场景菜单点击“拍摄”生成当前场景图片。</div>
            </div>
          ) : (
            <div style={photoStorageListStyle}>
              {photoStorageItems.map((item: PhotoStorageItem): React.ReactElement => (
                <div key={item.id} style={photoStorageCardStyle}>
                  {/* 缩略图点击后打开页面内原图预览弹窗。 */}
                  <button
                    type="button"
                    style={photoStorageImageStyle}
                    title="点击预览照片"
                    onClick={(): void => handlePreviewPhoto(item)}
                  >
                    <img src={item.dataUrl} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </button>

                  <div style={photoStorageMetaStyle}>
                    <div style={photoStorageNameStyle} title={item.name}>{item.name}</div>
                    <div style={photoStorageTimeStyle}>{new Date(item.createdAt).toLocaleString()}</div>
                  </div>

                  <div style={photoStorageActionsStyle}>
                    <button
                      type="button"
                      style={photoStorageActionButtonStyle}
                      onClick={(): void => handlePreviewPhoto(item)}
                    >
                      预览
                    </button>
                    <button
                      type="button"
                      style={photoStorageDeleteButtonStyle}
                      onClick={(): void => handleRemovePhoto(item)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {selectedPhoto !== null && (
        <div style={photoPreviewOverlayStyle} onClick={handleClosePreview}>
          {/* 预览弹窗点击内部区域时阻止冒泡，避免误触遮罩关闭。 */}
          <div
            style={photoPreviewDialogStyle}
            onClick={(event: React.MouseEvent<HTMLDivElement>): void => event.stopPropagation()}
          >
            <div style={photoPreviewHeaderStyle}>
              <div style={photoPreviewTitleStyle}>{selectedPhoto.name}</div>
              <button type="button" style={photoPreviewCloseButtonStyle} onClick={handleClosePreview}>关闭</button>
            </div>

            <div style={photoPreviewImageWrapStyle}>
              <img src={selectedPhoto.dataUrl} alt={selectedPhoto.name} style={photoPreviewImageStyle} />
            </div>

            <div style={photoPreviewFooterStyle}>
              <div style={photoPreviewInfoStyle}>拍摄时间：{new Date(selectedPhoto.createdAt).toLocaleString()}</div>
              <button
                type="button"
                style={photoPreviewPrimaryButtonStyle}
                onClick={(): void => handleDownloadPhoto(selectedPhoto)}
              >
                下载图片
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}