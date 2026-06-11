/**
 * 墙体绘制场景组件
 * 提供交互式墙体建模体验
 * 包含地面网格、光照、相机和状态显示条
 * 墙体工具按钮已移至左侧面板"模型库→基础几何体"分组
 */

import React, { useEffect, useCallback, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { PerspectiveCamera, OrthographicCamera } from '../react/components/Camera';
import { AmbientLight, DirectionalLight } from '../react/components/Light';
import { Skybox } from '../react/components/Skybox';
import { SceneSolidBackground } from '../react/components/SceneSolidBackground';
import { GridHelper } from '../react/components/GridHelper';
import { useDrawTool } from '../react/hooks/useDrawTool';
import { useDrawToolBridge } from '../react/context/DrawToolContext';
import { useTextureDrag } from '../react/context/TextureDragContext';
import { useEngine } from '../react/hooks/useEngine';
import { useSelection } from '../react/hooks/useSelection';
import { useBuildingContext, BuildingProvider } from '../react/context/BuildingContext';
import type { BuildingContextValue } from '../react/context/BuildingContext';
import { SelectionProvider } from '../react/context/SelectionContext';
import { GizmoProvider } from '../react/context/GizmoContext';
import type { UseSelectionResult } from '../react/hooks/useSelection';
import { ViewCube } from '../react/components/ViewCube';
import { SelectionPropertyBinder } from '../react/components/SelectionPropertyBinder';
import { useStlPlaceBridge } from '../react/context/StlPlaceContext';
import { StlPlaceTool } from '../model/StlPlaceTool';
import type { StlModelDef } from '../model/StlModelRegistry';
import type { StlPlaceBridge } from '../react/context/StlPlaceContext';
import { useHistoryManager } from '../react/context/HistoryContext';
import type { CommandHistoryManager } from '../history/CommandHistoryManager';
import { useFitSceneBridge } from '../react/context/FitSceneContext';
import type { FitSceneBridge } from '../react/context/FitSceneContext';
import { useClearSceneBridge } from '../react/context/ClearSceneContext';
import type { ClearSceneBridge } from '../react/context/ClearSceneContext';
import { fitSceneToView } from '../camera/FitSceneUtil';
import type { OrbitControlsWrapper } from '../camera/OrbitControlsWrapper';
import { RaycastHelper } from '../interaction/RaycastHelper';
import { IndoorVisibilityController } from '../interaction/IndoorVisibilityController';
import { ClearSceneCommand } from '../history/commands/ClearSceneCommand';
import { TextureService } from '../material/TextureService';
import { defaultTextureProvider, DEFAULT_TEXTURE_PRESETS } from '../material/TexturePresets';
import type { TexturePreset } from '../material/TexturePresets';
import type { MeshFaceHitResult } from '../interaction/RaycastHelper';
import type { UseDrawToolResult } from '../react/hooks/useDrawTool';
import type { DrawToolBridge } from '../react/context/DrawToolContext';
import type { Engine } from '../core/Engine';
import { useViewMode } from '../react/context/ViewModeContext';
import type { ViewMode } from '../react/context/ViewModeContext';
import { FloorBoundaryDimensionLabel } from '../react/components/FloorBoundaryDimensionLabel';
import { DoorWindow2DSymbolHelper } from '../model/DoorWindow2DSymbolHelper';

/**
 * 绘制状态显示条
 * 浮动在 Canvas 底部，显示当前绘制模式和预览信息
 */
function DrawToolStatusBar(): React.ReactElement | null {
  const {
    activateMode,
    deactivate,
    currentMode,
    previewLength,
    objectCount,
  }: UseDrawToolResult = useDrawTool();

  /** 将 activateMode / deactivate 注册到桥接上下文，供左侧面板调用 */
  const bridge: DrawToolBridge = useDrawToolBridge();

  useEffect((): (() => void) => {
    bridge.activateModeRef.current = activateMode;
    bridge.deactivateRef.current = deactivate;

    return (): void => {
      bridge.activateModeRef.current = null;
      bridge.deactivateRef.current = null;
    };
  }, [activateMode, deactivate, bridge]);

  /* 无激活模式时不显示状态条 */
  if (currentMode === 'none') {
    return null;
  }

  /** 模式名称映射 */
  const modeLabels: Record<string, string> = {
    'straight-wall': '直墙',
    'beam': '梁',
    'arc-wall': '弧形墙',
    'rect-wall': '矩形墙',
  };

  /** 容器样式 */
  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '16px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 20px',
    background: 'rgba(20, 20, 30, 0.85)',
    borderRadius: '10px',
    backdropFilter: 'blur(8px)',
    zIndex: 100,
    userSelect: 'none',
  };

  /** 模式标签样式 */
  const modeLabelStyle: React.CSSProperties = {
    color: '#88bbff',
    fontSize: '13px',
    fontWeight: 'bold',
  };

  /** 信息文字样式 */
  const infoStyle: React.CSSProperties = {
    color: '#999',
    fontSize: '12px',
  };

  /** 取消按钮样式 */
  const cancelBtnStyle: React.CSSProperties = {
    padding: '4px 12px',
    border: '1px solid #ff4444',
    borderRadius: '4px',
    background: 'transparent',
    color: '#ff6666',
    cursor: 'pointer',
    fontSize: '12px',
  };

  return (
    <div style={containerStyle}>
      <span style={modeLabelStyle}>
        🖊️ {modeLabels[currentMode] ?? currentMode}
      </span>
      <span style={infoStyle}>
        长度: {(previewLength * 1000).toFixed(0)}mm | 对象数: {objectCount}
      </span>
      <span style={infoStyle}>
        点击放置 · Esc/右键取消
      </span>
      <button
        style={cancelBtnStyle}
        onClick={deactivate}
      >
        ✕ 退出
      </button>
    </div>
  );
}

/**
 * 纹理拖拽放置处理器
 * 在 Canvas 内部注册 applyTexture 回调
 * 当用户从材质面板拖拽纹理到 3D 视口并松开鼠标时触发
 */
function TextureDropHandler(): null {
  const engine: Engine = useEngine();
  const { applyTextureRef } = useTextureDrag();

  /** 射线投射辅助器（复用单例） */
  const raycastHelperRef: React.MutableRefObject<RaycastHelper> = useRef<RaycastHelper>(new RaycastHelper());

  /** 纹理加载/缓存服务（复用单例） */
  const textureServiceRef: React.MutableRefObject<TextureService> = useRef<TextureService>(
    new TextureService(defaultTextureProvider)
  );

  /**
   * 纹理应用回调
   * 接收屏幕坐标和纹理预设，执行射线拾取并将纹理应用到命中面
   */
  const handleApplyTexture: (screenX: number, screenY: number, preset: TexturePreset) => void = useCallback(
    (screenX: number, screenY: number, preset: TexturePreset): void => {
      const renderer = engine.renderer;
      if (renderer === null) {
        console.warn('渲染器尚未初始化，无法应用纹理');
        return;
      }

      const scene = engine.sceneManager.getScene();
      const camera = engine.cameraManager.getActiveCamera();
      const domElement: HTMLCanvasElement = renderer.domElement;

      /* 射线投射到场景 Mesh，获取命中的面 */
      const hitResult: MeshFaceHitResult | null = raycastHelperRef.current.screenToMeshFace(
        screenX,
        screenY,
        camera,
        domElement,
        scene.children
      );

      if (hitResult === null) {
        console.warn('❌ 纹理拖放：未命中任何物体');
        return;
      }

      console.log(
        `✅ 纹理拖放：命中物体 "${hitResult.mesh.name}"`,
        `\n  - faceIndex: ${hitResult.faceIndex}`,
        `\n  - materialIndex: ${hitResult.materialIndex}`,
        `\n  - 材质类型: ${Array.isArray(hitResult.mesh.material) ? '材质数组' : '单材质'}`,
        `\n  - 材质数量: ${Array.isArray(hitResult.mesh.material) ? hitResult.mesh.material.length : 1}`,
        `\n  - 应用纹理: "${preset.name}"`
      );

      /* 异步加载纹理并应用到命中面 */
      textureServiceRef.current
        .loadByPresetId(preset.id, DEFAULT_TEXTURE_PRESETS)
        .then((texture: THREE.Texture): void => {
          console.log(`📦 纹理加载成功: "${preset.name}"`, texture);

          const result = textureServiceRef.current.applyTextureToFace(
            hitResult.mesh,
            hitResult.materialIndex,
            texture
          );

          if (result.success) {
            console.log(`✅ 纹理应用成功到 materialIndex=${hitResult.materialIndex}`);
          } else {
            console.error(`❌ 纹理应用失败: ${result.error}`);
          }
        })
        .catch((error: Error): void => {
          console.error(`❌ 纹理加载失败: ${error.message}`);
        });
    },
    [engine]
  );

  /* 注册/注销 applyTexture 回调到拖拽上下文 */
  useEffect((): (() => void) => {
    applyTextureRef.current = handleApplyTexture;

    return (): void => {
      applyTextureRef.current = null;
    };
  }, [handleApplyTexture, applyTextureRef]);

  /* 组件销毁时释放纹理缓存 */
  useEffect((): (() => void) => {
    const service: TextureService = textureServiceRef.current;
    return (): void => {
      service.dispose();
    };
  }, []);

  return null;
}

/**
 * 墙体绘制场景内容（外层包装）
 * 用 BuildingProvider 包裹整个场景，确保所有子组件共享同一份
 * BuildingObjectManager 和 WallDrawTool 实例
 */
export function WallDrawScene(): React.ReactElement {
  return (
    <BuildingProvider>
      {/* V5：SelectionProvider 紧贴 BuildingProvider 内层，让选中状态被所有子组件订阅 */}
      <SelectionProvider>
        {/* V5：GizmoProvider 在 SelectionProvider 内层，依赖 selectionManager */}
        <GizmoProvider>
          <WallDrawSceneInner />
        </GizmoProvider>
      </SelectionProvider>
    </BuildingProvider>
  );
}

/**
 * 标注显隐控制器
 * 监听视图模式变化，在 3D 模式下隐藏所有矩形墙标注，在 2D 模式下恢复显示
 */
function AnnotationVisibilityController(): null {
  const { viewMode }: { viewMode: ViewMode } = useViewMode();
  const ctx: BuildingContextValue = useBuildingContext();

  useEffect((): void => {
    const { drawTool } = ctx;
    if (drawTool === null) {
      return;
    }
    /* 3D 模式隐藏标注，2D 模式显示标注 */
    drawTool.setAnnotationsVisible(viewMode === '2d');
  }, [viewMode, ctx]);

  return null;
}

/**
 * 视图模式透明度控制器
 * 监听视图模式变化：
 * - 切换到 2D 俯视模式时，将墙体设为深灰不透明，突出白色门窗符号并便于选中
 * - 切回 3D 模式时，恢复墙体原始材质和天花板可见状态
 */
function ViewModeOpacityController(): null {
  const { viewMode }: { viewMode: ViewMode } = useViewMode();
  const buildingCtx: BuildingContextValue = useBuildingContext();

  useEffect((): void => {
    const { objectManager } = buildingCtx;
    if (objectManager === null) {
      return;
    }

    if (viewMode === '2d') {
      /* 2D 模式：墙体使用深灰不透明临时样式，门窗白色平面符号叠加在线框上方，提升识别和选中效率。 */
      objectManager.setCategoryVisualStyle('wall', 0x4a4a4a, 1.0);
      objectManager.setWallJointNodesVisible(true);
      objectManager.setCategoryVisible('ceiling', false);
    } else {
      /* 3D 模式：恢复墙体真实材质，天花板恢复可见和原透明度。 */
      objectManager.restoreCategoryVisualStyle('wall');
      objectManager.setWallJointNodesVisible(false);
      objectManager.setCategoryVisible('ceiling', true);
      objectManager.setCategoryOpacity('ceiling', 1.0);
    }
  }, [viewMode, buildingCtx]);

  return null;
}

/**
 * 门窗 2D 符号显隐控制器
 * 监听视图模式变化：2D 显示门窗平面符号，3D 隐藏符号以避免遮挡真实模型。
 */
function DoorWindow2DSymbolVisibilityController(): null {
  const engine: Engine = useEngine();
  const { viewMode }: { viewMode: ViewMode } = useViewMode();

  useEffect((): void => {
    const scene: THREE.Scene = engine.sceneManager.getScene();
    DoorWindow2DSymbolHelper.setSymbolsVisible(scene, viewMode === '2d');
  }, [engine, viewMode]);

  return null;
}

/**
 * 墙体绘制场景实际内容
 * 包含相机、光照、地面网格辅助线、纹理拖放处理器、选择处理器
 * V6：根据视图模式（2D/3D）切换相机类型，2D 模式下隐藏 ViewCube
 */
function WallDrawSceneInner(): React.ReactElement {
  /** 当前视图模式 */
  const { viewMode }: { viewMode: ViewMode } = useViewMode();

  /** 是否为 2D 俯视模式 */
  const is2D: boolean = viewMode === '2d';

  return (
    <>
      {/* 根据视图模式切换相机：3D 透视相机 / 2D 正交俯视相机 */}
      {is2D ? (
        /* 2D 正交相机：固定俯视，仅允许平移和缩放 */
        <OrthographicCamera
          viewHeight={20}
          position={[0, 50, 0]}
          lookAt={[0, 0, 0]}
          enableOrbitControls={true}
        />
      ) : (
        /* 3D 透视相机：俯视角度，观察原点，支持全方向旋转 */
        <PerspectiveCamera
          fov={50}
          position={[8, 10, 12]}
          lookAt={[0, 0, 0]}
          enableOrbitControls={true}
        />
      )}

      {/* 环境光（WebGPU 物理光照模型需要更高强度） */}
      <AmbientLight color={0xffffff} intensity={2.0} />

      {/* 主平行光：从右上方照射（WebGPU 物理光照模型） */}
      <DirectionalLight color={0xffffff} intensity={3.0} position={[10, 15, 8]} />

      {/* 辅助平行光：从左下方补光 */}
      <DirectionalLight color={0xaaccff} intensity={1.0} position={[-5, 8, -5]} />

      {/* 背景：3D 使用渐变天空盒，2D 使用纯色背景避免正交俯视下出现白色圆形伪影 */}
      {!is2D ? <Skybox /> : <SceneSolidBackground color={0x151629} />}

      {/* XZ 平面布局网格（20m × 20m，1m 主网格 + 0.1m 细分网格） */}
      <GridHelper size={20} divisions={20} />

      {/* 绘制状态显示条（激活模式时显示） */}
      <DrawToolStatusBar />

      {/* 纹理拖放处理器（注册 applyTexture 回调到拖拽上下文） */}
      <TextureDropHandler />

      {/* 选择交互处理器（点选/框选/Delete 删除） */}
      <SelectionHandler />

      {/* 右上角视图方向指示器：2D 模式下隐藏（视角固定，无需方向指示） */}
      {!is2D ? <ViewCube /> : null}

      {/* STL 模型点式布置处理器 */}
      <StlPlaceHandler />

      {/* 自适应场景处理器：注入 fitToView 回调到 FitSceneBridge */}
      <FitSceneHandler />

      {/* 清空场景处理器：注入 clearScene 回调到 ClearSceneBridge */}
      <ClearSceneHandler />

      {/* 标注显隐控制器：3D 模式隐藏标注，2D 模式显示标注 */}
      <AnnotationVisibilityController />

      {/* 2D 楼板标注：按楼板 outline 显示边界毫米长度，并在楼板中心显示面积 */}
      {is2D ? <FloorBoundaryDimensionLabel /> : null}

      {/* 视图模式视觉控制器：2D 模式下墙体深灰不透明，3D 模式恢复真实材质 */}
      <ViewModeOpacityController />

      {/* 门窗 2D 平面符号控制器：2D 显示方便选中，3D 隐藏避免干扰 */}
      <DoorWindow2DSymbolVisibilityController />

      {/* 室内可见性控制器：3D 模式下，确定性隐藏天花板和靠近相机侧的封闭区域墙体 */}
      {!is2D ? <IndoorVisibilityHandler /> : null}
    </>
  );
}

/**
 * STL 模型点式布置处理器
 * 在 Canvas 内部创建 StlPlaceTool 实例
 * 将 activate/deactivate 回调注册到 StlPlaceBridge
 */
function StlPlaceHandler(): null {
  const engine: Engine = useEngine();
  const bridge: StlPlaceBridge = useStlPlaceBridge();
  const historyManager: CommandHistoryManager = useHistoryManager();

  /** 从 BuildingContext 获取 objectManager，用于门窗吸附扣洞 */
  const buildingCtx: BuildingContextValue = useBuildingContext();

  /** 当前视图模式（2D 模式下布置预览时显示包围盒） */
  const { viewMode }: { viewMode: ViewMode } = useViewMode();

  /** StlPlaceTool 实例（随 Engine 创建一次） */
  const toolRef: React.MutableRefObject<StlPlaceTool | null> = useRef<StlPlaceTool | null>(null);

  useEffect((): (() => void) => {
    /* 创建布置工具（传入 historyManager，放置操作支持撤销/重做） */
    const tool: StlPlaceTool = new StlPlaceTool(engine, historyManager);
    toolRef.current = tool;

    /* 注入建筑对象管理器（门窗放置时用于墙体吸附和扣洞） */
    if (buildingCtx.objectManager !== null) {
      tool.setBuildingManager(buildingCtx.objectManager);
    }

    /* 注册激活回调到桥接上下文 */
    bridge.activatePlaceRef.current = (model: StlModelDef): void => {
      /* 激活 STL 点式布置前，先取消墙/梁/矩形墙线式布置，保证同一时刻只有一种布置行为。 */
      if (buildingCtx.drawTool !== null) {
        buildingCtx.drawTool.deactivate();
      }

      /* 进入模型布置模式：统一交互状态会禁用 SelectionTool，从源头停止 hover 预选中射线检测。 */
      buildingCtx.setInteractionMode('stl-place');

      tool.activate(model).catch((err: Error): void => {
        buildingCtx.setInteractionMode('select');
        console.error('STL 布置激活失败:', err.message);
      });
    };

    /* 注册取消回调 */
    bridge.deactivatePlaceRef.current = (): void => {
      tool.deactivate();
      buildingCtx.setInteractionMode('select');
    };

    /**
     * STL 布置工具状态同步回调。
     * activate/deactivate、右键取消、Esc 取消都会触发，确保交互模式不会卡在 stl-place。
     */
    tool.onStateChange((): void => {
      buildingCtx.setInteractionMode(tool.isActive ? 'stl-place' : 'select');
    });

    return (): void => {
      /* 清理 */
      bridge.activatePlaceRef.current = null;
      bridge.deactivatePlaceRef.current = null;
      tool.onStateChange((): void => {});
      buildingCtx.setInteractionMode('select');
      tool.dispose();
      toolRef.current = null;
    };
  }, [engine, bridge, buildingCtx.objectManager, buildingCtx.drawTool, buildingCtx.setInteractionMode]);

  /**
   * 视图模式变化时同步到 StlPlaceTool
   * 2D 模式下布置预览时显示平面投影包围盒
   */
  useEffect((): void => {
    const tool: StlPlaceTool | null = toolRef.current;
    if (tool !== null) {
      tool.setViewMode(viewMode);
    }
  }, [viewMode]);

  return null;
}

/**
 * 自适应场景处理器
 * 在 Canvas 内部获取 engine 引用，将实际的 fitToView 函数注入到 FitSceneBridge
 * 供 Canvas 外部的 useDemoSetup 通过桥接上下文调用
 */
function FitSceneHandler(): null {
  const engine: Engine = useEngine();
  const bridge: FitSceneBridge = useFitSceneBridge();

  useEffect((): (() => void) => {
    /**
     * 自适应场景回调
     * 获取当前活动相机和轨道控制器，调用 FitSceneUtil.fitSceneToView
     * @param directionVector - 相机相对于场景中心的方向向量
     */
    const handleFitToView = (directionVector: THREE.Vector3): void => {
      const camera: THREE.Camera = engine.cameraManager.getActiveCamera();
      const orbitControls: OrbitControlsWrapper | null = engine.cameraManager.getOrbitControls();
      if (orbitControls === null) {
        console.warn('[FitSceneHandler] 轨道控制器尚未初始化，无法自适应场景');
        return;
      }
      const scene: THREE.Scene = engine.sceneManager.getScene();
      /* 调用自适应算法，过渡被中断时静默忽略 */
      fitSceneToView(camera, orbitControls, scene, directionVector).catch(
        (err: unknown): void => {
          const cancelled: boolean =
            typeof err === 'object' && err !== null && (err as { cancelled?: boolean }).cancelled === true;
          if (!cancelled) {
            console.warn('[FitSceneHandler] 自适应场景过渡异常:', err);
          }
        }
      );
    };

    /* 注入回调到桥接上下文 */
    bridge.fitToViewRef.current = handleFitToView;

    return (): void => {
      bridge.fitToViewRef.current = null;
    };
  }, [engine, bridge]);

  return null;
}

/**
 * 选择交互处理器组件
 * 启用点选/Ctrl 多选/Delete 删除功能
 * 渲染选中状态显示条
 */
function SelectionHandler(): React.ReactElement {
  const {
    selectedCount,
    deleteSelected,
    clearSelection,
  }: UseSelectionResult = useSelection();

  /** 从 BuildingContext 获取 selectionManager 和 objectManager，传递给属性绑定器 */
  const buildingCtx = useBuildingContext();
  const selectionManager = buildingCtx.selectionManager;
  const objectManager = buildingCtx.objectManager;

  /** 命令历史管理器（用于属性修改的撤销/重做） */
  const historyManager: CommandHistoryManager = useHistoryManager();

  return (
    <>
      {/* 选中对象属性绑定器（监听选中变更，推送属性到右侧面板） */}
      {selectionManager !== null && objectManager !== null ? (
        <SelectionPropertyBinder
          selectionManager={selectionManager}
          objectManager={objectManager}
          historyManager={historyManager}
        />
      ) : null}

      {/* 选中状态显示条（有选中对象时显示） */}
      {selectedCount > 0 ? (
        <SelectionStatusBar
          count={selectedCount}
          onDelete={deleteSelected}
          onClear={clearSelection}
        />
      ) : null}
    </>
  );
}

/**
 * 选中状态显示条
 * 浮动在 Canvas 顶部，显示选中数量和操作按钮
 */
interface SelectionStatusBarProps {
  count: number;
  onDelete: () => void;
  onClear: () => void;
}

/**
 * 清空场景处理器
 * 在 Canvas 内部获取 Engine / BuildingContext / HistoryManager，向 ClearSceneBridge 注入真实清空命令。
 */
function ClearSceneHandler(): null {
  const engine: Engine = useEngine();
  const buildingCtx: BuildingContextValue = useBuildingContext();
  const bridge: ClearSceneBridge = useClearSceneBridge();
  const historyManager: CommandHistoryManager = useHistoryManager();
  const selection: UseSelectionResult = useSelection();

  useEffect((): (() => void) => {
    /**
     * 触发清空场景命令
     * @returns 实际执行清空时返回 true，无模型或管理器未就绪时返回 false
     */
    bridge.clearSceneRef.current = (): boolean => {
      if (buildingCtx.objectManager === null) {
        console.warn('[ClearSceneHandler] 建筑对象管理器尚未就绪，无法清空场景');
        return false;
      }

      const command: ClearSceneCommand = new ClearSceneCommand(
        buildingCtx.objectManager,
        engine.sceneManager.getScene()
      );

      if (!command.hasContent()) {
        command.dispose();
        console.log('[ClearSceneHandler] 当前场景内没有可清空的模型');
        return false;
      }

      /* 清空前先取消选中，避免 UI 保留已被移除对象的选中状态。 */
      selection.clearSelection();
      historyManager.execute(command);
      return true;
    };

    return (): void => {
      bridge.clearSceneRef.current = null;
    };
  }, [engine, buildingCtx.objectManager, bridge, historyManager, selection]);

  return null;
}

/**
 * 三维室内可见性处理器
 * 仅在 3D 模式下挂载，不再通过射线命中判断遮挡对象。
 * 根据相机与观察目标的空间关系，隐藏天花板，并隐藏靠近相机一侧的封闭区域墙体和绑定门窗。
 */
function IndoorVisibilityHandler(): null {
  const engine: Engine = useEngine();
  const buildingCtx: BuildingContextValue = useBuildingContext();

  /** 室内可见性控制器实例（随组件挂载创建，卸载时销毁） */
  const controllerRef: React.MutableRefObject<IndoorVisibilityController | null> = useRef<IndoorVisibilityController | null>(null);

  useEffect((): (() => void) => {
    const { objectManager } = buildingCtx;
    if (objectManager === null) {
      return (): void => { /* 无需清理 */ };
    }

    /* 创建控制器实例，使用确定性空间规则替代 X-Ray 射线拾取，避免视角临界闪烁。 */
    const controller: IndoorVisibilityController = new IndoorVisibilityController();
    controllerRef.current = controller;
    const camera: THREE.Camera = engine.cameraManager.getActiveCamera();
    const scene: THREE.Scene = engine.sceneManager.getScene();
    controller.enable(camera, scene, objectManager, {
      sideThreshold: 0.15,
      hideCeilings: true,
    });

    /* 注册帧回调，每帧根据相机和 OrbitControls 目标点更新确定性可见性。 */
    const unregister: () => void = engine.onFrame((): void => {
      const activeCamera: THREE.Camera = engine.cameraManager.getActiveCamera();
      const orbitControls: OrbitControlsWrapper | null = engine.cameraManager.getOrbitControls();
      controller.updateCamera(activeCamera);
      if (orbitControls !== null) {
        controller.updateTarget(orbitControls.getControls().target);
      }
      controller.update();
    });

    return (): void => {
      /* 取消帧回调并销毁控制器，恢复所有被隐藏的对象。 */
      unregister();
      controller.dispose();
      controllerRef.current = null;
    };
  }, [engine, buildingCtx.objectManager]);

  return null;
}

function SelectionStatusBar(props: SelectionStatusBarProps): React.ReactElement {
  const { count, onDelete, onClear } = props;

  /** 容器样式 */
  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    top: '16px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 20px',
    background: 'rgba(20, 20, 30, 0.85)',
    borderRadius: '10px',
    backdropFilter: 'blur(8px)',
    zIndex: 100,
    userSelect: 'none',
  };

  /** 信息文字样式 */
  const infoStyle: React.CSSProperties = {
    color: '#88bbff',
    fontSize: '13px',
    fontWeight: 'bold',
  };

  /** 提示文字样式 */
  const hintStyle: React.CSSProperties = {
    color: '#999',
    fontSize: '12px',
  };

  /** 删除按钮样式 */
  const deleteBtnStyle: React.CSSProperties = {
    padding: '4px 12px',
    border: '1px solid #ff4444',
    borderRadius: '4px',
    background: 'transparent',
    color: '#ff6666',
    cursor: 'pointer',
    fontSize: '12px',
  };

  /** 清空按钮样式 */
  const clearBtnStyle: React.CSSProperties = {
    padding: '4px 12px',
    border: '1px solid #666',
    borderRadius: '4px',
    background: 'transparent',
    color: '#aaa',
    cursor: 'pointer',
    fontSize: '12px',
  };

  return (
    <div style={containerStyle}>
      <span style={infoStyle}>✓ 已选中 {count} 个对象</span>
      <span style={hintStyle}>Delete 删除 · Esc 取消 · Ctrl+点击 多选</span>
      <button style={deleteBtnStyle} onClick={onDelete}>
        🗑️ 删除
      </button>
      <button style={clearBtnStyle} onClick={onClear}>
        ✕ 取消选择
      </button>
    </div>
  );
}
