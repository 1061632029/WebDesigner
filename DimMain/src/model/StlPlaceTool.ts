
/**
 * STL 点式布置工具
 * 负责加载 STL 模型，在鼠标跟随位置显示半透明预览
 * 点击地面（Y=0 平面）后放置模型到场景
 * Esc / 右键取消布置模式
 *
 * V2：门窗类型（category=door/window）支持墙中线吸附、Y 轴旋转对齐、放置后扣洞
 */

import * as THREE from 'three/webgpu';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import type { StlModelDef } from './StlModelRegistry';
import type { Engine } from '../core/Engine';
import type { CommandHistoryManager } from '../history/CommandHistoryManager';
import { StlPlaceCommand } from '../history/commands/StlPlaceCommand';
import { StlPlaceWithOpeningCommand } from '../history/commands/StlPlaceWithOpeningCommand';
import { StlEdgeBuilder } from './StlEdgeBuilder';
import { StlBBoxSnapHelper } from './StlBBoxSnapHelper';
import type { BBoxSnapResult } from './StlBBoxSnapHelper';
import { StlSnapGuideLines } from './StlSnapGuideLines';
import { WallSnapHelper } from '../building/WallSnapHelper';
import { WallOpeningCutter } from '../building/WallOpeningCutter';
import { StlAdaptiveThicknessHelper } from './StlAdaptiveThicknessHelper';
import type { WallSnapResult } from '../building/WallSnapHelper';
import type { BuildingObjectManager } from '../building/BuildingObjectManager';
import type { SelectionManager } from '../interaction/SelectionManager';
import type { StraightWallData, WallData, WallOpening } from '../building/BuildingTypes';
import { BoundingBoxHelper } from '../interaction/BoundingBoxHelper';
import type { ViewMode } from '../react/context/ViewModeContext';
import { DoorWindow2DSymbolHelper } from './DoorWindow2DSymbolHelper';
import { DoorWindowCollisionDetector } from './DoorWindowCollisionDetector';
import type { DoorWindowCollisionResult } from './DoorWindowCollisionDetector';
import { DoorWindowPlacementDimensionRenderer } from './DoorWindowPlacementDimensionRenderer';
import { DoorOpeningDirectionHelper } from './DoorOpeningDirectionHelper';

/** 门窗类别集合，用于判断是否启用墙体吸附模式 */
const DOOR_WINDOW_CATEGORIES: Set<string> = new Set<string>(['door', 'window']);

/**
 * STL 点式布置工具类
 * 管理预览 Mesh 的创建、鼠标跟随、放置、清理
 */
export class StlPlaceTool {
  /** Engine 引用 */
  private _engine: Engine;

  /** 命令历史管理器引用（放置操作通过命令栈执行，支持撤销/重做） */
  private _historyManager: CommandHistoryManager;

  /** 建筑对象管理器引用（门窗放置时用于扣洞） */
  private _buildingManager: BuildingObjectManager | null = null;

  /**
   * 包围盒吸附虚线提示管理器
   * 布置普通模型时，吸附发生时在边界处显示虚线
   */
  private _snapGuideLines: StlSnapGuideLines | null = null;
  
/** 选择管理器引用（激活时禁用选择工具，避免事件冲突） */
  private _selectionManager: SelectionManager | null = null;

  /** STLLoader 实例（复用） */
  private _stlLoader: STLLoader = new STLLoader();

  /** 当前激活的模型定义 */
  private _activeModel: StlModelDef | null = null;

  /** 预览用半透明 Mesh（跟随鼠标） */
  private _previewMesh: THREE.Mesh | null = null;

  /** 射线投射器（鼠标 → 地面） */
  private _raycaster: THREE.Raycaster = new THREE.Raycaster();

  /** 地面平面（Y=0） */
  private _groundPlane: THREE.Plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /** 鼠标屏幕坐标（NDC） */
  private _mouseNdc: THREE.Vector2 = new THREE.Vector2();

  /** 缓存已加载的 BufferGeometry（避免重复网络请求） */
  private _geometryCache: Map<string, THREE.BufferGeometry> = new Map();

  /** 事件监听器引用（用于移除） */
  private _onMouseMove: ((e: MouseEvent) => void) | null = null;
  private _onClick: ((e: MouseEvent) => void) | null = null;
  private _onContextMenu: ((e: MouseEvent) => void) | null = null;
  private _onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  /** 状态变更回调（通知 React 组件更新 UI） */
  private _onStateChange: (() => void) | null = null;

  /**
   * 当前门窗吸附结果
   * 非 null 时表示预览 Mesh 已吸附到某面墙的中线上
   */
  private _currentSnapResult: WallSnapResult | null = null;

  /**
   * 当前正在预览洞口的墙体 ID
   * 非 null 时表示已对该墙体应用了临时洞口预览几何
   * 需在预览结束时调用 clearOpeningPreview 恢复
   */
  private _previewWallId: string | null = null;

  /**
   * 当前被设为透明的墙体 ID
   * 非 null 时表示该墙体已被设为半透明（吸附高亮状态）
   * 需在取消吸附或退出布置模式时调用 restoreWallOpacity 恢复
   */
  private _transparentWallId: string | null = null;

  // _lastPreviewSnapPoint 已随 _showOpeningPreview 方法一同停用
  // private _lastPreviewSnapPoint: THREE.Vector3 | null = null;

  /**
   * 普通模型（category='model'）预览时的累积 Y 轴旋转角度（弧度）
   * 每次按空格键顺时针旋转 90°（-Math.PI/2）
   * 门窗类型由墙面法线控制旋转，不使用此值
   */
  private _previewRotationY: number = 0;

  /**
   * 门窗布置预览 2D 图标当前同步的墙体厚度。
   * 用于避免鼠标在同一厚度墙体上移动时重复重建 2D 图标。
   */
  private _previewSymbolWallThickness: number | null = null;

  /**
   * 门窗布置距离标注渲染器。
   * 仅在门窗吸附预览阶段显示，取消吸附、放置完成或退出布置时清理。
   */
  private _doorWindowDimensionRenderer: DoorWindowPlacementDimensionRenderer = new DoorWindowPlacementDimensionRenderer();

  /**
   * 当前视图模式
   * 2D 模式下布置预览时显示平面投影包围盒
   */
  private _viewMode: ViewMode = '3d';

  // OPENING_PREVIEW_THRESHOLD 已随 _showOpeningPreview 方法一同停用
  // private static readonly OPENING_PREVIEW_THRESHOLD: number = 0.02;

  /**
   * @param engine - 引擎实例
   * @param historyManager - 命令历史管理器
   */
  constructor(engine: Engine, historyManager: CommandHistoryManager) {
    this._engine = engine;
    this._historyManager = historyManager;
  }

  /* ========== 公共属性 ========== */

  /** 当前是否处于布置模式 */
  public get isActive(): boolean {
    return this._activeModel !== null;
  }

  /** 当前激活的模型名称 */
  public get activeModelName(): string {
    return this._activeModel !== null ? this._activeModel.name : '';
  }

  /* ========== 公共方法 ========== */

  /**
   * 注册状态变更回调
   * @param cb - 状态变更时调用
   */
  public onStateChange(cb: () => void): void {
    this._onStateChange = cb;
  }

  /**
   * 注入建筑对象管理器（门窗放置时用于扣洞）
   * 需在 activate 前调用
   * @param manager - 建筑对象管理器
   */
  public setBuildingManager(manager: BuildingObjectManager): void {
    this._buildingManager = manager;
  }

  
  /**
   * 注入选择管理器（激活时需要禁用选择工具）
   * @param manager - 选择管理器
   */
  public setSelectionManager(manager: SelectionManager): void {
    this._selectionManager = manager;
  }

  /**
   * 更新当前视图模式
   * 2D 模式下布置预览时显示平面投影包围盒
   * @param mode - 视图模式
   */
  public setViewMode(mode: ViewMode): void {
    this._viewMode = mode;
    /* 若当前有预览 Mesh，立即更新包围盒显示状态 */
    if (this._previewMesh !== null && this._previewMesh.visible) {
      const scene: THREE.Scene = this._engine.sceneManager.getScene();
      if (mode === '2d' && !this._isDoorWindowModel()) {
        this._previewMesh.updateMatrixWorld(true);
        BoundingBoxHelper.attachOutline(this._previewMesh, scene);
      } else {
        BoundingBoxHelper.detach(this._previewMesh, scene);
      }
    }
  }

  /**
   * 激活布置模式
   * 加载指定 STL 模型，创建半透明预览 Mesh，注册鼠标事件
   * @param model - 要布置的 STL 模型定义
   */
  public async activate(model: StlModelDef): Promise<void> {
    /* 若已激活则先取消 */
    if (this._activeModel !== null) {
      this.deactivate();
    }

    /* 激活时禁用选择工具（避免事件冲突导致选择失效） */
    if (this._selectionManager !== null) {
      const selTool = (this._selectionManager as unknown as { _selTool: { enabled: boolean; disable: () => void } })._selTool;
      if (selTool && selTool.enabled) {
        selTool.disable();
      }
    }
    this._activeModel = model;

    /* 加载或使用缓存的 BufferGeometry */
    const geometry: THREE.BufferGeometry = await this._loadGeometry(model.url);

    /* 创建半透明预览材质
     * depthTest: false 确保预览 Mesh 不被任何物体（包括半透明墙体）遮挡
     * depthWrite: false 确保预览 Mesh 不影响其他物体的深度测试
     */
    const previewMaterial: THREE.MeshPhongMaterial = new THREE.MeshPhongMaterial({
      color: 0x44aaff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      depthTest: false,
    });

    /* 创建预览 Mesh */
    this._previewMesh = new THREE.Mesh(geometry.clone(), previewMaterial);
    this._previewMesh.name = `stl-preview-${model.id}`;
    this._previewMesh.userData['stlModelId'] = model.id;
    this._previewMesh.userData['category'] = model.category;
    this._previewMesh.userData['isAdaptiveThickness'] = StlAdaptiveThicknessHelper.resolveEnabled(
      model.category,
      model.isAdaptiveThickness
    );
    this._previewMesh.userData['isPlacementPreview'] = true;
    /* renderOrder = 999 确保预览 Mesh 在所有物体之后绘制（始终显示在最前面） */
    this._previewMesh.renderOrder = 999;

    /* 自动居中并缩放到合理尺寸 */
    this._normalizePreviewMesh(this._previewMesh);

    /* 门窗布置预览：仅显示 2D 平面符号，不显示 STL 模型本体。
     * 处理逻辑：先按注册表默认宽高缩放预览 Mesh，再创建 2D 图标，确保图标尺寸基于实际门窗尺寸。
     * 父 Mesh 仍保持可见用于承载位置、旋转、吸附与放置状态；仅隐藏自身材质，避免子级 2D 图标被一并隐藏。
     */
    if (DOOR_WINDOW_CATEGORIES.has(model.category)) {
      this._previewMesh.geometry.computeBoundingBox();
      const previewLocalBox: THREE.Box3 | null = this._previewMesh.geometry.boundingBox;
      if (previewLocalBox !== null) {
        const previewOriginalSizeX: number = previewLocalBox.max.x - previewLocalBox.min.x;
        const previewOriginalSizeY: number = previewLocalBox.max.y - previewLocalBox.min.y;
        const previewOriginalSizeZ: number = previewLocalBox.max.z - previewLocalBox.min.z;
        this._previewMesh.userData['originalSizeX'] = previewOriginalSizeX;
        this._previewMesh.userData['originalSizeY'] = previewOriginalSizeY;
        this._previewMesh.userData['originalSizeZ'] = previewOriginalSizeZ;
        this._applyDefaultDoorWindowDimensions(
          this._previewMesh,
          model,
          previewOriginalSizeX,
          previewOriginalSizeY
        );
      }
      previewMaterial.visible = false;
      DoorWindow2DSymbolHelper.attachSymbol(this._previewMesh, true);
    }

    /* 初始隐藏，等鼠标移入画布后显示 */
    this._previewMesh.visible = false;

    /* 添加到场景 */
    const scene: THREE.Scene = this._engine.sceneManager.getScene();
    scene.add(this._previewMesh);

    if (DOOR_WINDOW_CATEGORIES.has(model.category)) {
      /* 门窗距离标注初始化流程：布置开始时预创建对象池，鼠标移动阶段只更新位置和显隐。 */
      this._doorWindowDimensionRenderer.prepare(scene);
    }

    /* 普通模型（category='model'）：创建包围盒吸附虚线提示 */
    if (model.category === 'model') {
      this._snapGuideLines = new StlSnapGuideLines(scene);
    }

    /* 注册事件监听 */
    this._bindEvents();

    /* 通知状态变更 */
    if (this._onStateChange !== null) {
      this._onStateChange();
    }
  }

  /**
   * 取消布置模式
   * 移除预览 Mesh，注销事件监听，恢复墙体洞口预览
   */
  public deactivate(): void {
    /* ESC 或右键退出布置模式时仅隐藏门窗临时距离标注，不销毁 WebGPU 资源，避免退出瞬间卡死。 */
    this._doorWindowDimensionRenderer.clear(this._engine.sceneManager.getScene());

    /* 恢复墙体洞口预览（若有） */
    this._clearOpeningPreview();

    /* 移除预览 Mesh（先清理包围盒，再从场景移除 Mesh） */
    if (this._previewMesh !== null) {
      /* 清理 2D 模式下可能残留的包围盒 Group */
      BoundingBoxHelper.detach(this._previewMesh, this._engine.sceneManager.getScene());
      this._engine.sceneManager.getScene().remove(this._previewMesh);
      this._previewMesh.geometry.dispose();
      const material = this._previewMesh.material;
      if (material instanceof THREE.Material) {
        material.dispose();
      }
      this._previewMesh = null;
    }

    this._previewSymbolWallThickness = null;

    /* 注销事件 */
    this._unbindEvents();

    /* 销毁包围盒吸附虚线提示（若有） */
    if (this._snapGuideLines !== null) {
      this._snapGuideLines.dispose();
      this._snapGuideLines = null;
    }

    this._activeModel = null;
    this._currentSnapResult = null;
 /* 停用后重新启用选择工具 */
    if (this._selectionManager !== null) {
      const selTool = (this._selectionManager as unknown as { _selTool: { enabled: boolean; enable: (camera: THREE.Camera, domElement: HTMLCanvasElement) => void } })._selTool;
      if (selTool && !selTool.enabled && this._engine.renderer !== null) {
        selTool.enable(this._engine.cameraManager.getActiveCamera(), this._engine.renderer.domElement);
      }
    }

    /* 重置普通模型的累积旋转角度，下次激活时从 0 开始 */
    this._previewRotationY = 0;

    /* 恢复被透明化的墙体（若有） */
    if (this._transparentWallId !== null && this._buildingManager !== null) {
      this._buildingManager.restoreWallOpacity(this._transparentWallId);
      this._transparentWallId = null;
    }

    if (this._onStateChange !== null) {
      this._onStateChange();
    }
  }

  /**
   * 销毁工具，清理所有资源
   */
  public dispose(): void {
    this.deactivate();
    /* 清理几何体缓存 */
    this._geometryCache.forEach((geom: THREE.BufferGeometry): void => {
      geom.dispose();
    });
    this._geometryCache.clear();
    this._onStateChange = null;
  }

  /* ========== 内部方法 ========== */

  /**
   * 加载 STL 几何体（带缓存）
   * @param url - STL 文件 URL
   * @returns BufferGeometry
   */
  private async _loadGeometry(url: string): Promise<THREE.BufferGeometry> {
    const cached: THREE.BufferGeometry | undefined = this._geometryCache.get(url);
    if (cached !== undefined) {
      return cached;
    }

    return new Promise<THREE.BufferGeometry>((
      resolve: (value: THREE.BufferGeometry) => void,
      reject: (reason: Error) => void
    ): void => {
      this._stlLoader.load(
        url,
        (geometry: THREE.BufferGeometry): void => {
          this._geometryCache.set(url, geometry);
          resolve(geometry);
        },
        undefined,
        (error: unknown): void => {
          reject(new Error(`STL 加载失败: ${url} - ${String(error)}`));
        }
      );
    });
  }

  /**
   * 自动居中并缩放预览 Mesh
   * 使模型底部贴合 Y=0 平面，整体尺寸适中
   */
  private _normalizePreviewMesh(mesh: THREE.Mesh): void {
    /* 计算包围盒 */
    mesh.geometry.computeBoundingBox();
    const box: THREE.Box3 = mesh.geometry.boundingBox as THREE.Box3;

    /* 居中 XZ，底部对齐 Y=0 */
    const center: THREE.Vector3 = new THREE.Vector3();
    box.getCenter(center);
    const size: THREE.Vector3 = new THREE.Vector3();
    box.getSize(size);

    /* 平移几何体使底部在 Y=0 */
    mesh.geometry.translate(-center.x, -box.min.y, -center.z);

    /* 缩放到最大维度为 1 米 */
    const maxDim: number = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const scale: number = 1.0 / maxDim;
      mesh.scale.set(scale, scale, scale);
    }
  }

  /**
   * 判断当前激活模型是否为门窗类型
   * 门窗类型需要启用墙体吸附模式
   */
  private _isDoorWindowModel(): boolean {
    return this._activeModel !== null && DOOR_WINDOW_CATEGORIES.has(this._activeModel.category);
  }

  /**
   * 绑定鼠标和键盘事件
   */
  private _bindEvents(): void {
    const renderer = this._engine.renderer;
    if (renderer === null) {
      return;
    }
    const canvas: HTMLCanvasElement = renderer.domElement;

    /* 鼠标移动：更新预览位置 */
    this._onMouseMove = (e: MouseEvent): void => {
      this._handleMouseMove(e, canvas);
    };

    /* 左键点击：放置模型 */
    this._onClick = (e: MouseEvent): void => {
      if (e.button === 0) {
        this._handlePlace(canvas);
      }
    };

    /* 右键：取消布置 */
    this._onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
      this.deactivate();
    };

    /* 键盘事件：Esc 取消布置；空格键普通模型旋转，门预览切换内开/外开并刷新 2D 图标。 */
    this._onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        this.deactivate();
        return;
      }
      if (e.key === ' ' && this._activeModel !== null && this._activeModel.category === 'door') {
        /* 门布置预览方向切换：阻止页面滚动，切换 userData 后重建 2D 符号以体现内开/外开方向。 */
        e.preventDefault();
        if (this._previewMesh !== null) {
          DoorOpeningDirectionHelper.toggleDirectionAndRefreshSymbol(this._previewMesh, true);
        }
        return;
      }
      /* 空格键：仅对普通模型（category='model'）生效，门窗由墙面法线控制旋转 */
      if (e.key === ' ' && this._activeModel !== null && this._activeModel.category === 'model') {
        /* 阻止页面滚动 */
        e.preventDefault();
        /* 顺时针旋转 90°（绕 Y 轴负方向旋转，即 -Math.PI/2） */
        this._previewRotationY -= Math.PI / 2;
        /* 立即更新预览 Mesh 旋转 */
        if (this._previewMesh !== null) {
          this._previewMesh.rotation.set(0, this._previewRotationY, 0);
        }
      }
    };

    canvas.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('click', this._onClick);
    canvas.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('keydown', this._onKeyDown);
  }

  /**
   * 注销事件监听
   */
  private _unbindEvents(): void {
    const renderer = this._engine.renderer;
    if (renderer !== null) {
      const canvas: HTMLCanvasElement = renderer.domElement;
      if (this._onMouseMove !== null) {
        canvas.removeEventListener('mousemove', this._onMouseMove);
      }
      if (this._onClick !== null) {
        canvas.removeEventListener('click', this._onClick);
      }
      if (this._onContextMenu !== null) {
        canvas.removeEventListener('contextmenu', this._onContextMenu);
      }
    }
    if (this._onKeyDown !== null) {
      window.removeEventListener('keydown', this._onKeyDown);
    }
    this._onMouseMove = null;
    this._onClick = null;
    this._onContextMenu = null;
    this._onKeyDown = null;
  }

  /**
   * 清除当前墙体的洞口预览，恢复原始几何体
   * 若 _previewWallId 为 null 则无操作
   * 同时重置上次吸附点记录，确保下次吸附时立即刷新预览
   */
  private _clearOpeningPreview(): void {
    if (this._previewWallId !== null && this._buildingManager !== null) {
      this._buildingManager.clearOpeningPreview(this._previewWallId);
      this._previewWallId = null;
    }
  }

  // _showOpeningPreview 方法已暂时停用（洞口预览功能待重构），保留代码供参考

  /**
   * 鼠标移动处理：
   * - 普通模型：射线与地面求交，更新预览位置
   * - 门窗模型：必须检测到墙中线吸附后才显示预览；未吸附时隐藏预览并禁止地面退化放置
   */
  private _handleMouseMove(e: MouseEvent, canvas: HTMLCanvasElement): void {
    if (this._previewMesh === null) {
      return;
    }

    /* 计算 NDC 坐标 */
    const rect: DOMRect = canvas.getBoundingClientRect();
    this._mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouseNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const camera: THREE.Camera = this._engine.cameraManager.getActiveCamera();
    this._raycaster.setFromCamera(this._mouseNdc, camera);

    /* 门窗类型：优先尝试墙中线吸附 */
    if (this._isDoorWindowModel() && this._buildingManager !== null) {
      const snapResult: WallSnapResult | null = this._tryWallSnap(this._raycaster.ray);
      if (snapResult !== null) {
        /* 吸附成功：将预览 Mesh 移动到吸附点并旋转对齐墙面法线 */
        this._currentSnapResult = snapResult;
        /* 窗户类型：在吸附点基础上加窗台高度偏移（_activeModel 在此分支必然非 null） */
        const sillHeight: number = this._activeModel !== null ? (this._activeModel.sillHeight ?? 0) : 0;
        this._previewMesh.position.set(
          snapResult.snapPoint.x,
          snapResult.snapPoint.y + sillHeight,
          snapResult.snapPoint.z
        );
        this._alignPreviewToWall(this._previewMesh, snapResult);
        this._syncPreviewDoorWindowThicknessWithWall(snapResult);
        this._previewMesh.visible = true;

        /* 门窗预览已使用 2D 平面符号表达，不再显示模型本体包围盒。 */
        BoundingBoxHelper.detach(this._previewMesh, this._engine.sceneManager.getScene());

        /* 门窗吸附预览距离标注：显示门窗包围盒沿墙方向到最近门窗边界或墙端边界的距离。 */
        const wallObj: ReturnType<BuildingObjectManager['getById']> = this._buildingManager.getById(snapResult.wallId);
        if (wallObj !== undefined && wallObj.category === 'wall' && (wallObj as WallData).subType === 'straight') {
          const wallData: StraightWallData = wallObj as StraightWallData;
          this._doorWindowDimensionRenderer.update(
            this._previewMesh,
            wallData,
            snapResult,
            this._engine.sceneManager.getScene()
          );
        } else {
          this._doorWindowDimensionRenderer.clear(this._engine.sceneManager.getScene());
        }

        /* 吸附到新墙体时：恢复旧墙体透明度，将新墙体设为半透明 */
        if (this._transparentWallId !== snapResult.wallId) {
          if (this._transparentWallId !== null) {
            this._buildingManager.restoreWallOpacity(this._transparentWallId);
          }
          this._buildingManager.setWallTransparent(snapResult.wallId);
          this._transparentWallId = snapResult.wallId;
        }

        return;
      }
    }

    /* 未吸附或非门窗类型：恢复被透明化的墙体，清除吸附状态 */
    if (this._transparentWallId !== null && this._buildingManager !== null) {
      this._buildingManager.restoreWallOpacity(this._transparentWallId);
      this._transparentWallId = null;
    }
    this._currentSnapResult = null;
    this._previewSymbolWallThickness = null;
    this._doorWindowDimensionRenderer.clear(this._engine.sceneManager.getScene());

    /* 门窗未吸附墙体时不允许退化到地面预览。
     * 预期结果：用户只有靠近墙体并成功吸附时才能看到门窗预览，点击空白地面不会放置门窗。
     */
    if (this._isDoorWindowModel()) {
      this._previewMesh.visible = false;
      BoundingBoxHelper.detach(this._previewMesh, this._engine.sceneManager.getScene());
      if (this._snapGuideLines !== null) {
        this._snapGuideLines.hide();
      }
      return;
    }

    const intersection: THREE.Vector3 = new THREE.Vector3();
    const hit: THREE.Vector3 | null = this._raycaster.ray.intersectPlane(this._groundPlane, intersection);

    if (hit !== null) {
      this._previewMesh.position.copy(intersection);
      /* 非门窗模型：保留空格键累积的旋转角度（_previewRotationY），不重置为 0 */
      if (!this._isDoorWindowModel()) {
        this._previewMesh.rotation.set(0, this._previewRotationY, 0);
      }
      this._previewMesh.visible = true;

      /* 普通模型（category='model'）：检测包围盒边界吸附（STL 模型 + 墙体） */
      if (
        this._activeModel !== null &&
        this._activeModel.category === 'model'
      ) {
        /* 收集目标 Mesh：场景中已放置的 STL 模型 + 建筑对象 Mesh（墙体等） */
        const targetMeshes: Array<THREE.Mesh> = this._collectBBoxSnapTargets();

        if (targetMeshes.length > 0) {
          /* 先更新矩阵，确保包围盒计算基于最新位置/旋转 */
          this._previewMesh.updateMatrixWorld(true);
          const snapResult: BBoxSnapResult = StlBBoxSnapHelper.findSnap(
            this._previewMesh,
            targetMeshes
          );

          /* 将吸附偏移量叠加到预览位置（仅 XZ 平面，Y 轴不变） */
          if (snapResult.snappedX || snapResult.snappedZ) {
            this._previewMesh.position.x += snapResult.offsetX;
            this._previewMesh.position.z += snapResult.offsetZ;
          }

          /* 更新虚线提示：吸附时显示对应边界虚线，无吸附时隐藏 */
          if (this._snapGuideLines !== null) {
            /* 吸附偏移已叠加，需再次更新矩阵以获取最终包围盒坐标 */
            this._previewMesh.updateMatrixWorld(true);
            this._snapGuideLines.update(snapResult, this._previewMesh);
          }
        } else {
          /* 无目标可吸附：隐藏虚线 */
          if (this._snapGuideLines !== null) {
            this._snapGuideLines.hide();
          }
        }
      }

      /* 2D 模式下：更新包围盒（位置已变更，需重新计算） */
      if (this._viewMode === '2d' && !this._isDoorWindowModel()) {
        this._previewMesh.updateMatrixWorld(true);
        BoundingBoxHelper.attachOutline(this._previewMesh, this._engine.sceneManager.getScene());
      }
    } else {
      this._previewMesh.visible = false;
      /* 预览不可见时移除包围盒 */
      BoundingBoxHelper.detach(this._previewMesh, this._engine.sceneManager.getScene());
      /* 预览不可见时清理门窗临时距离标注 */
      this._doorWindowDimensionRenderer.clear(this._engine.sceneManager.getScene());
      /* 预览不可见时隐藏吸附虚线 */
      if (this._snapGuideLines !== null) {
        this._snapGuideLines.hide();
      }
    }
  }

  /**
   * 收集包围盒吸附目标 Mesh 列表
   * 包含：场景中已放置的 STL 模型 Mesh + 建筑对象 Mesh（墙体等）
   * 预览 Mesh 本身由 StlBBoxSnapHelper 内部跳过（uuid 比对）
   * @returns 目标 Mesh 数组
   */
  private _collectBBoxSnapTargets(): Array<THREE.Mesh> {
    const targets: Array<THREE.Mesh> = [];

    /* 收集场景中已放置的 STL 模型 Mesh */
    const scene: THREE.Scene = this._engine.sceneManager.getScene();
    scene.traverse((child: THREE.Object3D): void => {
      if (
        child instanceof THREE.Mesh &&
        child.userData['stlModelId'] !== undefined &&
        child.visible
      ) {
        targets.push(child);
      }
    });

    /* 收集建筑对象 Mesh（墙体等） */
    if (this._buildingManager !== null) {
      const buildingMeshes: Array<{ id: string; mesh: THREE.Mesh }> = this._buildingManager.getAllMeshes();
      for (const item of buildingMeshes) {
        if (item.mesh.visible) {
          targets.push(item.mesh);
        }
      }
    }

    return targets;
  }

  /**
   * 尝试墙中线吸附
   * 从 BuildingObjectManager 获取所有直墙，调用 WallSnapHelper 检测最近墙体
   * @param ray - 鼠标射线
   * @returns 吸附结果，若无则返回 null
   */
  private _tryWallSnap(ray: THREE.Ray): WallSnapResult | null {
    if (this._buildingManager === null) {
      return null;
    }

    /* 获取所有墙体数据并过滤出直墙 */
    const allWalls: WallData[] = this._buildingManager.getByCategory('wall') as WallData[];
    const straightWalls: StraightWallData[] = WallSnapHelper.filterStraightWalls(allWalls);

    if (straightWalls.length === 0) {
      return null;
    }

    return WallSnapHelper.findNearestWall(ray, straightWalls);
  }

  /**
   * 将预览 Mesh 旋转对齐到墙面法线方向
   * 约定 STL 模型的"正面"为 +Z 轴方向
   * 计算绕 Y 轴旋转角度，使 +Z 轴与墙面法线方向一致
   *
   * @param mesh - 预览 Mesh
   * @param snapResult - 墙中线吸附结果
   */
  private _alignPreviewToWall(mesh: THREE.Mesh, snapResult: WallSnapResult): void {
    /* 计算绕 Y 轴的旋转角度：将 +Z 轴旋转到与 wallNormal 方向一致
     * angle = atan2(wallNormal.x, wallNormal.z)
     * 这是将 +Z 轴旋转到目标方向所需的 Y 轴旋转角
     */
    const angle: number = Math.atan2(snapResult.wallNormal.x, snapResult.wallNormal.z);
    mesh.rotation.set(0, angle, 0);
  }

  /**
   * 将门窗布置预览的局部厚度同步为当前吸附墙体厚度，并刷新 2D 图标。
   * @param snapResult - 当前墙中线吸附结果
   */
  private _syncPreviewDoorWindowThicknessWithWall(snapResult: WallSnapResult): void {
    if (this._previewMesh === null || this._buildingManager === null) {
      return;
    }

    /* 墙体厚度同步流程：只处理有效直墙，避免门窗预览在无效吸附数据下错误缩放。 */
    const wallObj: ReturnType<BuildingObjectManager['getById']> = this._buildingManager.getById(snapResult.wallId);
    if (wallObj === undefined || wallObj.category !== 'wall' || (wallObj as WallData).subType !== 'straight') {
      return;
    }

    const wallData: StraightWallData = wallObj as StraightWallData;
    if (this._previewSymbolWallThickness === wallData.thickness) {
      return;
    }

    if (StlAdaptiveThicknessHelper.isEnabledForMesh(this._previewMesh)) {
      StlAdaptiveThicknessHelper.applyWallThickness(this._previewMesh, wallData.thickness);
    }

    /* 2D 图标尺寸依赖当前 Mesh 缩放；墙厚变化后必须重建图标，确保预览厚度等于墙厚。 */
    DoorWindow2DSymbolHelper.attachSymbol(this._previewMesh, true);
    this._previewSymbolWallThickness = wallData.thickness;
  }

  /**
   * 按模型注册表中的默认门窗尺寸缩放正式 Mesh
   * @param mesh - 待布置的正式 Mesh
   * @param model - 当前 STL 模型定义
   * @param originalSizeX - 模型局部 X 轴原始宽度（米）
   * @param originalSizeY - 模型局部 Y 轴原始高度（米）
   */
  private _applyDefaultDoorWindowDimensions(
    mesh: THREE.Mesh,
    model: StlModelDef,
    originalSizeX: number,
    originalSizeY: number
  ): void {
    /* 默认宽高仅对门窗生效。
     * 处理逻辑：将注册表中的米制默认尺寸转换为局部轴缩放，属性栏随后会按 originalSize × scale 显示对应 mm 值。
     */
    if (!DOOR_WINDOW_CATEGORIES.has(model.category)) {
      return;
    }

    const defaultWidth: number | undefined = model.defaultWidth;
    const defaultHeight: number | undefined = model.defaultHeight;

    if (defaultWidth !== undefined && originalSizeX > 0) {
      mesh.scale.setX(defaultWidth / originalSizeX);
    }

    if (defaultHeight !== undefined && originalSizeY > 0) {
      mesh.scale.setY(defaultHeight / originalSizeY);
    }
  }

  /**
   * 放置模型：克隆预览 Mesh 为正式对象添加到场景
   * 门窗类型：放置后对吸附的墙体执行扣洞操作
   */
  private _handlePlace(_canvas: HTMLCanvasElement): void {
    if (this._previewMesh === null || !this._previewMesh.visible || this._activeModel === null) {
      return;
    }

    /* 门窗放置强依赖墙体吸附。
     * 触发条件：当前模型属于门/窗，但没有有效墙体吸附结果或建筑对象管理器未注入。
     * 处理逻辑：直接取消本次放置，避免门窗作为普通 STL 模型落在地面上。
     */
    if (this._isDoorWindowModel() && (this._currentSnapResult === null || this._buildingManager === null)) {
      console.warn(`❌ 门窗必须吸附到墙体后才能放置: "${this._activeModel.name}"`);
      return;
    }

    /* 创建正式材质（不透明，素描灰阶中灰色 0xc8c8c8） */
    const placedMaterial: THREE.MeshPhongMaterial = new THREE.MeshPhongMaterial({
      color: 0xc8c8c8,
      flatShading: true,
    });

    /* 克隆几何体并创建新 Mesh */
    const placedGeometry: THREE.BufferGeometry = this._previewMesh.geometry.clone();
    const placedMesh: THREE.Mesh = new THREE.Mesh(placedGeometry, placedMaterial);
    placedMesh.name = `stl-${this._activeModel.id}-${Date.now()}`;
    placedMesh.position.copy(this._previewMesh.position);
    placedMesh.scale.copy(this._previewMesh.scale);

    /* 复制预览 Mesh 的旋转角度到正式 Mesh
     * 门窗类型：复制墙面法线对齐角度
     * 普通模型（category='model'）：复制空格键累积的旋转角度
     */
    placedMesh.rotation.copy(this._previewMesh.rotation);

    /* 标记 stlModelId，供 SelectionTool 射线拾取识别 */
    placedMesh.userData['stlModelId'] = this._activeModel.id;
    placedMesh.userData['category'] = this._activeModel.category;
    placedMesh.userData['isAdaptiveThickness'] = StlAdaptiveThicknessHelper.resolveEnabled(
      this._activeModel.category,
      this._activeModel.isAdaptiveThickness
    );
    /* 窗户类型：存储窗台高度，供属性面板编辑和洞口联动使用 */
    if (this._activeModel.category === 'window') {
      placedMesh.userData['sillHeight'] = this._activeModel.sillHeight ?? 0;
    }
    /* 门类型：存储门底高度，供属性面板编辑使用 */
    if (this._activeModel.category === 'door') {
      const doorBottomHeight: number = this._activeModel.doorBottomHeight ?? 0.05;
      placedMesh.userData['doorBottomHeight'] = doorBottomHeight;
      DoorOpeningDirectionHelper.setDirection(placedMesh, DoorOpeningDirectionHelper.getDirection(this._previewMesh));
      /* 将门底高度应用到模型 Y 轴位置 */
      placedMesh.position.setY(doorBottomHeight);
    }
    /* 门窗吸附放置时记录 wallId，供 TransformGizmo 判断是否禁止旋转 */
    if (
      this._isDoorWindowModel() &&
      this._currentSnapResult !== null
    ) {
      placedMesh.userData['wallId'] = this._currentSnapResult.wallId;
      /* 同时记录吸附时的 snapResult（t 值），供属性面板修改 sillHeight 时重新计算洞口 */
      placedMesh.userData['snapT'] = this._currentSnapResult.t;
      placedMesh.userData['wallNormalX'] = this._currentSnapResult.wallNormal.x;
      placedMesh.userData['wallNormalZ'] = this._currentSnapResult.wallNormal.z;
      placedMesh.userData['wallDirX'] = this._currentSnapResult.wallDir.x;
      placedMesh.userData['wallDirZ'] = this._currentSnapResult.wallDir.z;
    }

    /* 存储 STL 局部坐标原始包围盒尺寸（scale=1 时的尺寸），供属性面板计算尺寸参数使用
     * 关键逻辑：属性面板的 X/Y/Z 尺寸必须固定对应模型局部坐标轴，不能使用世界 AABB。
     * 原因：门窗会按墙体方向旋转，普通模型也可旋转放置；世界 AABB 会随朝向改变，导致宽度/厚度含义不稳定。
     */
    placedGeometry.computeBoundingBox();
    const localBBox: THREE.Box3 | null = placedGeometry.boundingBox;
    if (localBBox !== null) {
      const originalSizeX: number = localBBox.max.x - localBBox.min.x;
      const originalSizeY: number = localBBox.max.y - localBBox.min.y;
      const originalSizeZ: number = localBBox.max.z - localBBox.min.z;
      placedMesh.userData['originalSizeX'] = originalSizeX;
      placedMesh.userData['originalSizeY'] = originalSizeY;
      placedMesh.userData['originalSizeZ'] = originalSizeZ;
      this._applyDefaultDoorWindowDimensions(placedMesh, this._activeModel, originalSizeX, originalSizeY);
    }

    /* 更新世界矩阵（确保默认门窗宽高缩放已生效，后续包围盒、碰撞检测和扣洞都使用最终尺寸） */
    placedMesh.updateMatrixWorld(true);

    /* 计算并存储 AABB 包围盒到 userData */
    const bbox: THREE.Box3 = new THREE.Box3().setFromObject(placedMesh);
    placedMesh.userData['boundingBox'] = {
      min: { x: bbox.min.x, z: bbox.min.z },
      max: { x: bbox.max.x, z: bbox.max.z },
      center: { x: (bbox.min.x + bbox.max.x) / 2, z: (bbox.min.z + bbox.max.z) / 2 },
      size: {
        x: bbox.max.x - bbox.min.x,
        y: bbox.max.y - bbox.min.y,
        z: bbox.max.z - bbox.min.z,
      },
    };

    if (this._activeModel.category === 'model') {
      /* 底部高度：模型底部距地面的 Y 轴偏移，默认 0.05m（5cm 离地） */
      const defaultFloorHeight: number = 0.05;
      placedMesh.userData['floorHeight'] = defaultFloorHeight;
      /* 将底部高度应用到模型 Y 轴位置 */
      placedMesh.position.setY(defaultFloorHeight);
    }

    /* 提取边界边和折角边，添加为子对象 LineSegments（随 Mesh 一起移动/缩放/删除） */
    const edgeGeometry: THREE.BufferGeometry = StlEdgeBuilder.buildEdgeGeometry(placedGeometry, 30);
    const edgeMaterial: THREE.LineBasicMaterial = new THREE.LineBasicMaterial({
      color: 0x333333,
    });
    const edgeLines: THREE.LineSegments = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edgeLines.name = `${placedMesh.name}-edges`;
    /* 标记为边界边对象，供射线拾取时跳过 */
    edgeLines.userData['isEdgeLines'] = true;
    placedMesh.add(edgeLines);

    const scene: THREE.Scene = this._engine.sceneManager.getScene();

    /* 门窗类型且有吸附结果：使用复合命令（放置 + 扣洞原子操作，支持撤销/重做） */
    if (
      this._isDoorWindowModel() &&
      this._currentSnapResult !== null &&
      this._buildingManager !== null
    ) {
      const snapResult: WallSnapResult = this._currentSnapResult;
      const wallObj: ReturnType<BuildingObjectManager['getById']> = this._buildingManager.getById(snapResult.wallId);

      if (wallObj !== undefined && wallObj.category === 'wall' && (wallObj as WallData).subType === 'straight') {
        const wallData: StraightWallData = wallObj as StraightWallData;

        /* 门窗吸附墙体且启用自适应厚度时，先读取墙体厚度并同步局部 Z 轴，再计算洞口。 */
        if (StlAdaptiveThicknessHelper.isEnabledForMesh(placedMesh)) {
          StlAdaptiveThicknessHelper.applyWallThickness(placedMesh, wallData.thickness);
        }

        /* 门窗吸附到墙体并同步最终厚度后挂载 2D 平面符号，确保符号尺寸基于正式门窗实际尺寸。 */
        DoorWindow2DSymbolHelper.attachSymbol(placedMesh, this._viewMode === '2d');

        /* 门窗正式入栈前执行碰撞检测：若与同墙已有门窗重叠，则取消本次布置和扣洞。 */
        placedMesh.updateMatrixWorld(true);
        const collisionResult: DoorWindowCollisionResult = DoorWindowCollisionDetector.detect(placedMesh, scene);
        if (collisionResult.collided) {
          const collidedName: string = collisionResult.collidedMesh?.name ?? '未知门窗';
          console.warn(`❌ 门窗碰撞，已取消布置: "${this._activeModel.name}" 与 "${collidedName}" 重叠`);
          return;
        }

        /* 计算洞口参数（纯计算，不修改状态） */
        const newOpening: WallOpening = WallOpeningCutter.computeOpening(snapResult, placedMesh, wallData);

        /* 读取扣洞前的旧洞口列表快照 */
        const oldOpenings: WallOpening[] = wallData.openings !== undefined
          ? wallData.openings.map((op: WallOpening): WallOpening => ({ ...op }))
          : [];

        /* 通过复合命令入栈（放置 Mesh + 扣洞原子操作） */
        const cmd: StlPlaceWithOpeningCommand = new StlPlaceWithOpeningCommand(
          scene,
          placedMesh,
          this._buildingManager,
          snapResult.wallId,
          newOpening,
          oldOpenings,
          `放置门窗 "${this._activeModel.name}"`
        );
        this._historyManager.execute(cmd);

        /* 门窗放置完成后清理布置预览距离标注，正式对象不保留该临时辅助线。 */
        this._doorWindowDimensionRenderer.clear(scene);

        console.log(`✅ 门窗已放置并扣洞: "${this._activeModel.name}" 墙体=${snapResult.wallId}`);
        return;
      }

      /* 吸附结果对应的墙体无效时禁止回退为普通 STL 放置。
       * 预期结果：门窗始终与有效直墙绑定，避免生成没有 wallId 和洞口数据的孤立门窗。
       */
      console.warn(`❌ 门窗吸附墙体无效，已取消放置: "${this._activeModel.name}" 墙体=${snapResult.wallId}`);
      return;
    }

    /* 普通模型或无吸附：使用普通放置命令 */
    const cmd: StlPlaceCommand = new StlPlaceCommand(
      scene,
      placedMesh,
      `放置 STL 模型 "${this._activeModel.name}"`
    );
    this._historyManager.execute(cmd);

    console.log(`✅ STL 模型已放置: "${this._activeModel.name}" 于 (${placedMesh.position.x.toFixed(2)}, ${placedMesh.position.y.toFixed(2)}, ${placedMesh.position.z.toFixed(2)})`);
  }
}
