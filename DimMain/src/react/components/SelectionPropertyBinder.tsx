/**
 * 选中对象属性绑定组件
 * 监听选择管理器的选中状态变更，将选中的建筑对象属性推送到右侧属性面板
 * 支持建筑对象（墙体/楼板/天花板）和 STL 导入模型的属性展示与编辑
 * 属性修改通过 PropertyChangeCommand 接入撤销/重做历史栈
 * 无可视化 UI，纯逻辑组件
 */

import { useEffect, useCallback, useContext } from 'react';
import * as THREE from 'three/webgpu';
import type { SelectionManager } from '../../interaction/SelectionManager';
import type { BuildingObjectManager } from '../../building/BuildingObjectManager';
import type { BuildingObject } from '../../building/BuildingTypes';
import type { WallData, SlabData, CeilingData, BeamData, BeamPlacementReference, StraightWallData, WallOpening } from '../../building/BuildingTypes';
import type { PropertyGroup, PropertyItem, NumberPropertyItem, ColorPropertyItem, SelectPropertyItem } from '../../panel/PanelTypes';
import { PanelContext } from '../context/PanelContext';
import type { PanelContextValue } from '../context/PanelContext';
import type { CommandHistoryManager } from '../../history/CommandHistoryManager';
import { PropertyChangeCommand } from '../../history/commands/PropertyChangeCommand';
import { StlResizeCommand } from '../../history/commands/StlResizeCommand';
import type { ScaleSnapshot } from '../../history/commands/StlResizeCommand';
import { StlMoveCommand } from '../../history/commands/StlMoveCommand';
import { TransformCommand } from '../../history/commands/TransformCommand';
import type { TransformSnapshot } from '../../history/commands/TransformCommand';
import { StlTransformWithOpeningCommand } from '../../history/commands/StlTransformWithOpeningCommand';
import type { StlOpeningUserDataSnapshot } from '../../history/commands/StlTransformWithOpeningCommand';
import { WallOpeningCutter } from '../../building/WallOpeningCutter';
import { StlAdaptiveThicknessHelper } from '../../model/StlAdaptiveThicknessHelper';
import type { WallSnapResult } from '../../building/WallSnapHelper';
import { DoorWindowCollisionDetector } from '../../model/DoorWindowCollisionDetector';
import { DoorOpeningDirectionHelper } from '../../model/DoorOpeningDirectionHelper';
import type { DoorOpeningDirection } from '../../model/DoorOpeningDirectionHelper';

/**
 * 组件属性
 */
interface SelectionPropertyBinderProps {
  /** 选择管理器实例 */
  selectionManager: SelectionManager;
  /** 建筑对象管理器实例 */
  objectManager: BuildingObjectManager;
  /** 命令历史管理器实例（用于属性修改的撤销/重做） */
  historyManager: CommandHistoryManager;
}

/**
 * 选中对象属性绑定器
 * 挂载后自动订阅选择变更，选中对象时将属性推送到 PanelManager
 * 取消选中时清空右侧属性面板
 */
export function SelectionPropertyBinder(props: SelectionPropertyBinderProps): null {
  const { selectionManager, objectManager, historyManager } = props;
  const panelCtx: PanelContextValue | null = useContext(PanelContext);

  /**
   * 将建筑对象数据转换为属性面板分组
   * 只展示各类别的核心参数，移除无意义的通用字段（高度/底部标高/偏移 X/Y/Z）
   * @param obj - 建筑对象数据
   * @returns 属性分组数组
   */
  const buildPropertyGroups = useCallback((obj: BuildingObject): Array<PropertyGroup> => {
    if (panelCtx === null) {
      return [];
    }

    const groups: Array<PropertyGroup> = [];

    /* ===== 墙体专属属性组 ===== */
    if (obj.category === 'wall') {
      const wallData: WallData = obj as WallData;
      if (wallData.subType === 'straight' || wallData.subType === 'arc') {
        const wallItems: Array<NumberPropertyItem> = [];

        /* 墙厚 */
        const thicknessItem: NumberPropertyItem = {
          id: 'thickness',
          type: 'number',
          label: '墙厚',
          unit: 'm',
          min: 0.05,
          max: 2,
          step: 0.01,
          value: wallData.thickness,
          onChange: (value: number): void => {
            /* 包装为 PropertyChangeCommand 推入历史栈，支持撤销/重做 */
            const cmd: PropertyChangeCommand<BuildingObject> = new PropertyChangeCommand<BuildingObject>({
              target: obj,
              propertyPath: 'thickness',
              before: wallData.thickness,
              after: value,
              label: `修改墙厚 ${wallData.name}`,
              onApply: (_target: BuildingObject, _path: string, newValue: unknown): void => {
                objectManager.updateObject(obj.id, { thickness: newValue as number });
                refreshProperties();
              },
            });
            historyManager.execute(cmd);
          },
        };
        wallItems.push(thicknessItem);

        /* 墙高：直墙显示，绑定天花板时只读（由天花板 bottomOffset 控制） */
        if (wallData.subType === 'straight') {
          const straightWall: StraightWallData = wallData as StraightWallData;
          /* 是否绑定了天花板 */
          const isBoundToCeiling: boolean = straightWall.ceilingId !== null;
          const heightItem: NumberPropertyItem = {
            id: 'height',
            type: 'number',
            label: '墙高',
            unit: 'm',
            min: 0.5,
            max: 20,
            step: 0.05,
            value: wallData.height,
            /* 绑定天花板时只读，置灰显示 */
            readonly: isBoundToCeiling,
            readonlyHint: isBoundToCeiling ? '由天花板房间高控制，请修改天花板属性' : undefined,
            onChange: (value: number): void => {
              /* 绑定天花板时不允许手动修改 */
              if (isBoundToCeiling) {
                return;
              }
              const cmd: PropertyChangeCommand<BuildingObject> = new PropertyChangeCommand<BuildingObject>({
                target: obj,
                propertyPath: 'height',
                before: wallData.height,
                after: value,
                label: `修改墙高 ${wallData.name}`,
                onApply: (_target: BuildingObject, _path: string, newValue: unknown): void => {
                  objectManager.updateObject(obj.id, { height: newValue as number });
                  refreshProperties();
                },
              });
              historyManager.execute(cmd);
            },
          };
          wallItems.push(heightItem);
        }

        groups.push({
          title: `🧱 ${obj.name}`,
          expanded: true,
          items: wallItems,
        });
      }
    }

    /* ===== 梁构件专属属性组 ===== */
    if (obj.category === 'beam') {
      const beamData: BeamData = obj as BeamData;
      const beamItems: Array<PropertyItem> = [];

      /* 梁宽：面板使用毫米输入展示，内部仍以米保存，避免影响梁几何构建和斜接计算。 */
      const beamWidthItem: NumberPropertyItem = {
        id: 'beam-width',
        type: 'number',
        label: '宽度',
        unit: 'mm',
        min: 50,
        max: 5000,
        step: 10,
        value: Math.round(beamData.width * 1000),
        onChange: (value: number): void => {
          const widthInMeters: number = value / 1000;
          const cmd: PropertyChangeCommand<BuildingObject> = new PropertyChangeCommand<BuildingObject>({
            target: obj,
            propertyPath: 'width',
            before: beamData.width,
            after: widthInMeters,
            label: `修改梁宽 ${beamData.name}`,
            onApply: (_target: BuildingObject, _path: string, newValue: unknown): void => {
              objectManager.updateObject(obj.id, { width: newValue as number } as Partial<BeamData>);
              refreshProperties();
            },
          });
          historyManager.execute(cmd);
        },
      };
      beamItems.push(beamWidthItem);

      /* 梁高：面板使用毫米输入展示，内部仍以米保存，避免改变世界坐标单位。 */
      const beamHeightItem: NumberPropertyItem = {
        id: 'beam-height',
        type: 'number',
        label: '高度',
        unit: 'mm',
        min: 50,
        max: 5000,
        step: 10,
        value: Math.round(beamData.height * 1000),
        onChange: (value: number): void => {
          const heightInMeters: number = value / 1000;
          const cmd: PropertyChangeCommand<BuildingObject> = new PropertyChangeCommand<BuildingObject>({
            target: obj,
            propertyPath: 'height',
            before: beamData.height,
            after: heightInMeters,
            label: `修改梁高 ${beamData.name}`,
            onApply: (_target: BuildingObject, _path: string, newValue: unknown): void => {
              objectManager.updateObject(obj.id, { height: newValue as number } as Partial<BeamData>);
              refreshProperties();
            },
          });
          historyManager.execute(cmd);
        },
      };
      beamItems.push(beamHeightItem);

      /* 梁长：由两点线式布置自动计算，随布置点间距变化，不允许在属性面板手动编辑。 */
      const beamLengthItem: NumberPropertyItem = {
        id: 'beam-length',
        type: 'number',
        label: '长度',
        unit: 'm',
        step: 0.01,
        value: Number(beamData.length.toFixed(3)),
        readonly: true,
        readonlyHint: '长度由线式布置起点和终点距离决定，不可手动编辑',
        onChange: (_value: number): void => {
          /* 只读派生属性：长度由 start/end 自动计算，此处保留空回调用于满足属性控件接口。 */
        },
      };
      beamItems.push(beamLengthItem);

      /* 位置基准：切换地面/顶面后，面板仅显示对应距离属性。 */
      const placementReferenceItem: SelectPropertyItem = {
        id: 'beam-placement-reference',
        type: 'select',
        label: '位置',
        options: [
          { label: '地面', value: 'floor' },
          { label: '顶面', value: 'ceiling' },
        ],
        value: beamData.placementReference,
        onChange: (value: string): void => {
          const newReference: BeamPlacementReference = value as BeamPlacementReference;
          const cmd: PropertyChangeCommand<BuildingObject> = new PropertyChangeCommand<BuildingObject>({
            target: obj,
            propertyPath: 'placementReference',
            before: beamData.placementReference,
            after: newReference,
            label: `修改梁位置 ${beamData.name}`,
            onApply: (_target: BuildingObject, _path: string, newValue: unknown): void => {
              objectManager.updateObject(obj.id, { placementReference: newValue as BeamPlacementReference } as Partial<BeamData>);
              refreshProperties();
            },
          });
          historyManager.execute(cmd);
        },
      };
      beamItems.push(placementReferenceItem);

      if (beamData.placementReference === 'floor') {
        const distanceFromFloorItem: NumberPropertyItem = {
          id: 'beam-distance-from-floor',
          type: 'number',
          label: '离地面距离',
          unit: 'm',
          min: -20,
          max: 100,
          step: 0.05,
          value: beamData.distanceFromFloor,
          onChange: (value: number): void => {
            const cmd: PropertyChangeCommand<BuildingObject> = new PropertyChangeCommand<BuildingObject>({
              target: obj,
              propertyPath: 'distanceFromFloor',
              before: beamData.distanceFromFloor,
              after: value,
              label: `修改离地面距离 ${beamData.name}`,
              onApply: (_target: BuildingObject, _path: string, newValue: unknown): void => {
                objectManager.updateObject(obj.id, { distanceFromFloor: newValue as number } as Partial<BeamData>);
                refreshProperties();
              },
            });
            historyManager.execute(cmd);
          },
        };
        beamItems.push(distanceFromFloorItem);
      } else {
        const distanceFromCeilingItem: NumberPropertyItem = {
          id: 'beam-distance-from-ceiling',
          type: 'number',
          label: '离顶面距离',
          unit: 'm',
          min: -20,
          max: 100,
          step: 0.05,
          value: beamData.distanceFromCeiling,
          onChange: (value: number): void => {
            const cmd: PropertyChangeCommand<BuildingObject> = new PropertyChangeCommand<BuildingObject>({
              target: obj,
              propertyPath: 'distanceFromCeiling',
              before: beamData.distanceFromCeiling,
              after: value,
              label: `修改离顶面距离 ${beamData.name}`,
              onApply: (_target: BuildingObject, _path: string, newValue: unknown): void => {
                objectManager.updateObject(obj.id, { distanceFromCeiling: newValue as number } as Partial<BeamData>);
                refreshProperties();
              },
            });
            historyManager.execute(cmd);
          },
        };
        beamItems.push(distanceFromCeilingItem);
      }

      groups.push({
        title: `▬ ${obj.name}`,
        expanded: true,
        items: beamItems,
      });
    }

    /* ===== 楼板专属属性组 ===== */
    if (obj.category === 'slab') {
      const slabData: SlabData = obj as SlabData;
      const slabItems: Array<NumberPropertyItem> = [];

      /* 顶部高度：控制楼板顶面 Y 位置，修改不影响厚度 */
      const topOffsetItem: NumberPropertyItem = {
        id: 'topOffset',
        type: 'number',
        label: '顶部高度',
        unit: 'm',
        min: -10,
        max: 100,
        step: 0.05,
        value: slabData.topOffset,
        onChange: (value: number): void => {
          const cmd: PropertyChangeCommand<BuildingObject> = new PropertyChangeCommand<BuildingObject>({
            target: obj,
            propertyPath: 'topOffset',
            before: slabData.topOffset,
            after: value,
            label: `修改楼板顶部高度 ${slabData.name}`,
            onApply: (_target: BuildingObject, _path: string, newValue: unknown): void => {
              objectManager.updateObject(obj.id, { topOffset: newValue as number } as Partial<SlabData>);
              refreshProperties();
            },
          });
          historyManager.execute(cmd);
        },
      };
      slabItems.push(topOffsetItem);

      /* 板厚：向下拉伸，修改厚度不影响顶面高度 */
      const slabThicknessItem: NumberPropertyItem = {
        id: 'slabThickness',
        type: 'number',
        label: '板厚',
        unit: 'm',
        min: 0.05,
        max: 2,
        step: 0.01,
        value: slabData.slabThickness,
        onChange: (value: number): void => {
          const cmd: PropertyChangeCommand<BuildingObject> = new PropertyChangeCommand<BuildingObject>({
            target: obj,
            propertyPath: 'slabThickness',
            before: slabData.slabThickness,
            after: value,
            label: `修改板厚 ${slabData.name}`,
            onApply: (_target: BuildingObject, _path: string, newValue: unknown): void => {
              objectManager.updateObject(obj.id, { slabThickness: newValue as number } as Partial<SlabData>);
              refreshProperties();
            },
          });
          historyManager.execute(cmd);
        },
      };
      slabItems.push(slabThicknessItem);

      groups.push({
        title: `🏗️ ${obj.name}`,
        expanded: true,
        items: slabItems,
      });
    }

    /* ===== 天花板专属属性组 ===== */
    if (obj.category === 'ceiling') {
      const ceilingData: CeilingData = obj as CeilingData;
      const ceilingItems: Array<NumberPropertyItem> = [];

      /* 房间高：天花板底面高度，即墙体净高 */
      const bottomOffsetItem: NumberPropertyItem = {
        id: 'bottomOffset',
        type: 'number',
        label: '房间高',
        unit: 'm',
        min: 0.5,
        max: 20,
        step: 0.05,
        value: ceilingData.bottomOffset,
        onChange: (value: number): void => {
          const cmd: PropertyChangeCommand<BuildingObject> = new PropertyChangeCommand<BuildingObject>({
            target: obj,
            propertyPath: 'bottomOffset',
            before: ceilingData.bottomOffset,
            after: value,
            label: `修改房间高 ${ceilingData.name}`,
            onApply: (_target: BuildingObject, _path: string, newValue: unknown): void => {
              objectManager.updateObject(obj.id, { bottomOffset: newValue as number } as Partial<CeilingData>);
              refreshProperties();
            },
          });
          historyManager.execute(cmd);
        },
      };
      ceilingItems.push(bottomOffsetItem);

      /* 天花板厚度：向上挤压的厚度 */
      const ceilingThicknessItem: NumberPropertyItem = {
        id: 'ceilingThickness',
        type: 'number',
        label: '天花板厚度',
        unit: 'm',
        min: 0.05,
        max: 1,
        step: 0.01,
        value: ceilingData.ceilingThickness,
        onChange: (value: number): void => {
          const cmd: PropertyChangeCommand<BuildingObject> = new PropertyChangeCommand<BuildingObject>({
            target: obj,
            propertyPath: 'ceilingThickness',
            before: ceilingData.ceilingThickness,
            after: value,
            label: `修改天花板厚度 ${ceilingData.name}`,
            onApply: (_target: BuildingObject, _path: string, newValue: unknown): void => {
              objectManager.updateObject(obj.id, { ceilingThickness: newValue as number } as Partial<CeilingData>);
              refreshProperties();
            },
          });
          historyManager.execute(cmd);
        },
      };
      ceilingItems.push(ceilingThicknessItem);

      groups.push({
        title: `🪟 ${obj.name}`,
        expanded: true,
        items: ceilingItems,
      });
    }

    /* ===== 材质属性组（所有类别通用） ===== */
    const colorHex: string = '#' + obj.material.color.toString(16).padStart(6, '0');
    const colorItem: ColorPropertyItem = {
      id: 'material-color',
      type: 'color',
      label: '颜色',
      value: colorHex,
      onChange: (value: string): void => {
        const newColor: number = parseInt(value.replace('#', ''), 16);
        const oldMaterial = { ...obj.material };
        const newMaterial = { ...obj.material, color: newColor };
        const cmd: PropertyChangeCommand<BuildingObject> = new PropertyChangeCommand<BuildingObject>({
          target: obj,
          propertyPath: 'material',
          before: oldMaterial,
          after: newMaterial,
          label: `修改颜色 ${obj.name}`,
          onApply: (_target: BuildingObject, _path: string, newValue: unknown): void => {
            objectManager.updateObject(obj.id, { material: newValue as typeof obj.material });
            refreshProperties();
          },
        });
        historyManager.execute(cmd);
      },
    };

    const metalnessItem: NumberPropertyItem = {
      id: 'material-metalness',
      type: 'number',
      label: '金属度',
      min: 0,
      max: 1,
      step: 0.05,
      value: obj.material.metalness,
      onChange: (value: number): void => {
        const oldMaterial = { ...obj.material };
        const newMaterial = { ...obj.material, metalness: value };
        const cmd: PropertyChangeCommand<BuildingObject> = new PropertyChangeCommand<BuildingObject>({
          target: obj,
          propertyPath: 'material',
          before: oldMaterial,
          after: newMaterial,
          label: `修改金属度 ${obj.name}`,
          onApply: (_target: BuildingObject, _path: string, newValue: unknown): void => {
            objectManager.updateObject(obj.id, { material: newValue as typeof obj.material });
            refreshProperties();
          },
        });
        historyManager.execute(cmd);
      },
    };

    const roughnessItem: NumberPropertyItem = {
      id: 'material-roughness',
      type: 'number',
      label: '粗糙度',
      min: 0,
      max: 1,
      step: 0.05,
      value: obj.material.roughness,
      onChange: (value: number): void => {
        const oldMaterial = { ...obj.material };
        const newMaterial = { ...obj.material, roughness: value };
        const cmd: PropertyChangeCommand<BuildingObject> = new PropertyChangeCommand<BuildingObject>({
          target: obj,
          propertyPath: 'material',
          before: oldMaterial,
          after: newMaterial,
          label: `修改粗糙度 ${obj.name}`,
          onApply: (_target: BuildingObject, _path: string, newValue: unknown): void => {
            objectManager.updateObject(obj.id, { material: newValue as typeof obj.material });
            refreshProperties();
          },
        });
        historyManager.execute(cmd);
      },
    };

    groups.push({
      title: '🎨 材质属性',
      expanded: true,
      items: [colorItem, metalnessItem, roughnessItem],
    });

    return groups;
  }, [objectManager, historyManager, panelCtx]);

  /**
   * 刷新当前选中对象的属性面板
   * 重新从 objectManager 读取数据并推送到 PanelManager
   */
  const refreshProperties = useCallback((): void => {
    if (panelCtx === null) {
      return;
    }

    const selectedIds: ReadonlySet<string> = selectionManager.selectedIds;
    if (selectedIds.size === 0) {
      panelCtx.panelManager.setPropertyGroups([]);
      return;
    }

    /* 目前仅支持单选属性展示 */
    const firstId: string = selectedIds.values().next().value as string;
    const obj: BuildingObject | undefined = objectManager.getById(firstId);
    if (obj === undefined) {
      panelCtx.panelManager.setPropertyGroups([]);
      return;
    }

    const groups: Array<PropertyGroup> = buildPropertyGroups(obj);
    panelCtx.panelManager.setPropertyGroups(groups);
  }, [selectionManager, objectManager, panelCtx, buildPropertyGroups]);

  /* ===== 订阅建筑对象选中变更 ===== */
  useEffect((): (() => void) => {
    const unsubscribe: () => void = selectionManager.onChange(
      (_selectedIds: ReadonlySet<string>): void => {
        refreshProperties();
      }
    );

    return unsubscribe;
  }, [selectionManager, refreshProperties]);

  /* ===== 订阅 STL 模型选中变更 ===== */
  useEffect((): (() => void) => {
    const unsubscribe: () => void = selectionManager.onStlChange(
      (mesh: THREE.Mesh | null): void => {
        if (panelCtx === null) {
          return;
        }

        if (mesh === null) {
          /* STL 取消选中时也刷新一下建筑对象属性 */
          refreshProperties();
          return;
        }

        const stlName: string = (mesh.userData['stlModelId'] as string) ?? '未命名模型';
        const category: string = (mesh.userData['category'] as string) ?? '';

        /**
         * 捕获门窗高度类 userData 快照
         * @returns 当前 Mesh 的窗台高度/门底高度快照
         */
        const captureOpeningUserData = (): StlOpeningUserDataSnapshot => {
          const snapshot: StlOpeningUserDataSnapshot = {};
          const currentSillHeight: number | undefined = mesh.userData['sillHeight'] as number | undefined;
          const currentDoorBottomHeight: number | undefined = mesh.userData['doorBottomHeight'] as number | undefined;
          const currentDoorOpeningDirection: string | undefined = mesh.userData['doorOpeningDirection'] as string | undefined;

          if (currentSillHeight !== undefined) {
            snapshot.sillHeight = currentSillHeight;
          }
          if (currentDoorBottomHeight !== undefined) {
            snapshot.doorBottomHeight = currentDoorBottomHeight;
          }
          if (currentDoorOpeningDirection === '内开' || currentDoorOpeningDirection === '外开') {
            snapshot.doorOpeningDirection = currentDoorOpeningDirection;
          }

          return snapshot;
        };

        /**
         * 将位姿快照应用回 Mesh
         * @param snapshot - 目标位姿快照
         */
        const applyTransformSnapshot = (snapshot: TransformSnapshot): void => {
          mesh.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
          mesh.rotation.set(snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z);
          mesh.scale.set(snapshot.scale.x, snapshot.scale.y, snapshot.scale.z);
          mesh.updateMatrix();
          mesh.updateMatrixWorld(true);
        };

        /**
         * 将门窗高度类 userData 快照写回 Mesh
         * @param snapshot - 目标门窗属性快照
         */
        const applyOpeningUserData = (snapshot: StlOpeningUserDataSnapshot): void => {
          if (snapshot.sillHeight !== undefined) {
            mesh.userData['sillHeight'] = snapshot.sillHeight;
          }
          if (snapshot.doorBottomHeight !== undefined) {
            mesh.userData['doorBottomHeight'] = snapshot.doorBottomHeight;
          }
          if (snapshot.doorOpeningDirection !== undefined) {
            mesh.userData['doorOpeningDirection'] = snapshot.doorOpeningDirection;
          }
        };

        /**
         * 从当前 Mesh.userData 重建墙体吸附结果，供洞口重算使用
         * @param wallId - 目标墙体 ID
         * @param snapT - 门窗在墙体上的中心参数
         * @returns 墙体吸附结果结构
         */
        const buildSnapResultFromUserData = (wallId: string, snapT: number): WallSnapResult => {
          const wallNormalX: number = (mesh.userData['wallNormalX'] as number) ?? 0;
          const wallNormalZ: number = (mesh.userData['wallNormalZ'] as number) ?? 1;
          const wallDirX: number = (mesh.userData['wallDirX'] as number) ?? 1;
          const wallDirZ: number = (mesh.userData['wallDirZ'] as number) ?? 0;

          return {
            t: snapT,
            wallDir: new THREE.Vector3(wallDirX, 0, wallDirZ),
            wallNormal: new THREE.Vector3(wallNormalX, 0, wallNormalZ),
            snapPoint: new THREE.Vector3(mesh.position.x, 0, mesh.position.z),
            wallId: wallId,
            distance: 0,
          };
        };

        /**
         * 移除当前门窗对应洞口，保留其他洞口作为基础列表
         * @param openings - 当前墙体洞口列表
         * @param targetT - 当前门窗洞口中心参数
         * @returns 不包含当前门窗洞口的列表
         */
        const removeCurrentOpening = (openings: WallOpening[], targetT: number): WallOpening[] => {
          if (openings.length === 0) {
            return [];
          }

          let closestIndex: number = 0;
          let closestDistance: number = Math.abs(openings[0]!.centerT - targetT);

          for (let index: number = 1; index < openings.length; index++) {
            const currentDistance: number = Math.abs(openings[index]!.centerT - targetT);
            if (currentDistance < closestDistance) {
              closestDistance = currentDistance;
              closestIndex = index;
            }
          }

          const result: WallOpening[] = openings.map((op: WallOpening): WallOpening => ({ ...op }));
          result.splice(closestIndex, 1);
          return result;
        };

        /**
         * 提交门窗变换并同步重算墙体洞口
         * @param label - 命令标签
         * @param mutateMesh - 临时应用新状态的回调
         * @param refreshPanel - 命令执行/撤销后刷新属性面板的回调
         */
        const executeDoorWindowOpeningTransform = (
          label: string,
          mutateMesh: () => void,
          refreshPanel: () => void
        ): void => {
          const wallId: string | undefined = mesh.userData['wallId'] as string | undefined;
          const snapT: number | undefined = mesh.userData['snapT'] as number | undefined;

          if (wallId === undefined || snapT === undefined) {
            return;
          }

          const wallObj: BuildingObject | undefined = objectManager.getById(wallId);
          if (
            wallObj === undefined ||
            wallObj.category !== 'wall' ||
            (wallObj as WallData).subType !== 'straight'
          ) {
            return;
          }

          const wallData: StraightWallData = wallObj as StraightWallData;
          const beforeTransform: TransformSnapshot = TransformCommand.capture(mesh);
          const beforeUserData: StlOpeningUserDataSnapshot = captureOpeningUserData();
          const beforeSnapResult: WallSnapResult = buildSnapResultFromUserData(wallId, snapT);
          const beforeOpening: WallOpening = WallOpeningCutter.computeOpening(beforeSnapResult, mesh, wallData);
          const currentOpenings: WallOpening[] = wallData.openings !== undefined
            ? wallData.openings.map((op: WallOpening): WallOpening => ({ ...op }))
            : [];
          const baseOpenings: WallOpening[] = removeCurrentOpening(currentOpenings, snapT);

          /* 临时应用新状态，仅用于捕获 after 快照和计算新洞口；随后恢复，交由命令栈 execute 生效 */
          mutateMesh();
          mesh.updateMatrixWorld(true);

          /* 修改尺寸/高度后先检测门窗碰撞；若碰撞，恢复旧状态并取消本次修改。 */
          const sceneRoot: THREE.Object3D | null = mesh.parent;
          if (sceneRoot !== null) {
            const collisionResult = DoorWindowCollisionDetector.detect(mesh, sceneRoot);
            if (collisionResult.collided) {
              const collidedName: string = collisionResult.collidedMesh?.name ?? '未知门窗';
              console.warn(`❌ 门窗碰撞，已取消修改: "${stlName}" 与 "${collidedName}" 重叠`);
              applyTransformSnapshot(beforeTransform);
              applyOpeningUserData(beforeUserData);
              refreshPanel();
              return;
            }
          }

          const afterTransform: TransformSnapshot = TransformCommand.capture(mesh);
          const afterUserData: StlOpeningUserDataSnapshot = captureOpeningUserData();
          const afterSnapResult: WallSnapResult = buildSnapResultFromUserData(wallId, snapT);
          const afterOpening: WallOpening = WallOpeningCutter.computeOpening(afterSnapResult, mesh, wallData);

          applyTransformSnapshot(beforeTransform);
          applyOpeningUserData(beforeUserData);

          const cmd: StlTransformWithOpeningCommand = new StlTransformWithOpeningCommand(
            mesh,
            beforeTransform,
            afterTransform,
            beforeUserData,
            afterUserData,
            objectManager,
            wallId,
            baseOpenings,
            beforeOpening,
            afterOpening,
            refreshPanel,
            label
          );
          historyManager.execute(cmd);
        };

        /* 窗户类型：显示窗台高度属性，支持编辑并联动模型位置和洞口 */
        if (category === 'window') {
          const currentSillHeight: number = (mesh.userData['sillHeight'] as number) ?? 0;
          const originalSizeX: number = (mesh.userData['originalSizeX'] as number) ?? 1;
          const originalSizeY: number = (mesh.userData['originalSizeY'] as number) ?? 1;
          const originalSizeZ: number = (mesh.userData['originalSizeZ'] as number) ?? 1;
          const isThicknessReadonly: boolean = StlAdaptiveThicknessHelper.isThicknessReadonly(mesh);

          /**
           * 窗台高度变更处理
           * 1. 更新 mesh.position.y（保持 XZ 不变，仅改变 Y）
           * 2. 更新 userData['sillHeight']
           * 3. 若有关联墙体，重新计算洞口 bottomElevation 并更新墙体
           */
          const onSillHeightChange = (newSillHeight: number): void => {
            executeDoorWindowOpeningTransform(
              `修改窗台高度 ${stlName}`,
              (): void => {
                mesh.position.setY(newSillHeight);
                mesh.userData['sillHeight'] = newSillHeight;
              },
              (): void => {
                panelCtx.panelManager.setPropertyGroups(buildWindowPropertyGroups(mesh.userData['sillHeight'] as number));
              }
            );
          };

          /**
           * 构建窗户属性面板分组
           * @param sillHeight - 当前窗台高度
           */
          const buildWindowPropertyGroups = (sillHeight: number): Array<PropertyGroup> => {
            /* 门窗尺寸固定按模型局部坐标轴计算：局部 X=宽度，局部 Y=高度，局部 Z=厚度。
             * originalSizeX/Y/Z 在放置时来自几何体局部包围盒，不随墙体方向或世界旋转变化。
             */
            const currentSizeXmm: number = Math.round(originalSizeX * mesh.scale.x * 1000);
            const currentSizeYmm: number = Math.round(originalSizeY * mesh.scale.y * 1000);
            const currentSizeZmm: number = Math.round(originalSizeZ * mesh.scale.z * 1000);

            /**
             * 创建窗户尺寸属性项
             * @param axis - 缩放轴向
             * @param label - 面板标签
             * @param currentMm - 当前尺寸（mm）
             * @param originalSize - 原始尺寸（m）
             */
            const makeWindowSizeItem = (
              axis: 'x' | 'y' | 'z',
              label: string,
              currentMm: number,
              originalSize: number
            ): NumberPropertyItem => ({
              id: `window-size-${axis}`,
              type: 'number',
              label: label,
              unit: 'mm',
              min: 1,
              max: 100000,
              step: 1,
              value: currentMm,
              readonly: axis === 'z' ? isThicknessReadonly : false,
              readonlyHint: axis === 'z' && isThicknessReadonly ? '厚度由吸附墙体厚度自动控制' : undefined,
              onChange: (newMm: number): void => {
                if (axis === 'z' && isThicknessReadonly) {
                  return;
                }

                const newSizeM: number = newMm / 1000;
                const newScale: number = newSizeM / originalSize;
                executeDoorWindowOpeningTransform(
                  `修改窗户${label} ${stlName}`,
                  (): void => {
                    if (axis === 'x') {
                      mesh.scale.setX(newScale);
                    }
                    if (axis === 'y') {
                      mesh.scale.setY(newScale);
                    }
                    if (axis === 'z') {
                      mesh.scale.setZ(newScale);
                    }
                  },
                  (): void => {
                    panelCtx.panelManager.setPropertyGroups(buildWindowPropertyGroups(mesh.userData['sillHeight'] as number));
                  }
                );
              },
            });

            const sillHeightItem: NumberPropertyItem = {
              id: 'sillHeight',
              type: 'number',
              label: '窗台高度',
              unit: 'm',
              min: 0,
              max: 5,
              step: 0.05,
              value: sillHeight,
              onChange: onSillHeightChange,
            };

            return [
              {
                title: `🪟 窗户: ${stlName}`,
                expanded: true,
                items: [
                  makeWindowSizeItem('x', '宽（X）', currentSizeXmm, originalSizeX),
                  makeWindowSizeItem('y', '高（Y）', currentSizeYmm, originalSizeY),
                  makeWindowSizeItem('z', '厚（Z）', currentSizeZmm, originalSizeZ),
                  sillHeightItem,
                ],
              },
            ];
          };

          panelCtx.panelManager.setPropertyGroups(buildWindowPropertyGroups(currentSillHeight));
          return;
        }

        /* 门类型：显示门底高度属性，支持编辑并联动模型 Y 轴位置 */
        if (category === 'door') {
          /** 门底高度默认值（m） */
          const DEFAULT_DOOR_BOTTOM_HEIGHT: number = 0.05;
          const currentDoorBottomHeight: number =
            (mesh.userData['doorBottomHeight'] as number) ?? DEFAULT_DOOR_BOTTOM_HEIGHT;
          const originalSizeX: number = (mesh.userData['originalSizeX'] as number) ?? 1;
          const originalSizeY: number = (mesh.userData['originalSizeY'] as number) ?? 1;
          const originalSizeZ: number = (mesh.userData['originalSizeZ'] as number) ?? 1;
          const isThicknessReadonly: boolean = StlAdaptiveThicknessHelper.isThicknessReadonly(mesh);
          const currentDoorOpeningDirection: DoorOpeningDirection = DoorOpeningDirectionHelper.ensureDirection(mesh);

          /**
           * 构建门属性面板分组
           * @param doorBottomHeight - 当前门底高度（m）
           * @param doorOpeningDirection - 当前门开启方向
           */
          const buildDoorPropertyGroups = (
            doorBottomHeight: number,
            doorOpeningDirection: DoorOpeningDirection
          ): Array<PropertyGroup> => {
            /* 门窗尺寸固定按模型局部坐标轴计算：局部 X=宽度，局部 Y=高度，局部 Z=厚度。
             * originalSizeX/Y/Z 在放置时来自几何体局部包围盒，不随墙体方向或世界旋转变化。
             */
            const currentSizeXmm: number = Math.round(originalSizeX * mesh.scale.x * 1000);
            const currentSizeYmm: number = Math.round(originalSizeY * mesh.scale.y * 1000);
            const currentSizeZmm: number = Math.round(originalSizeZ * mesh.scale.z * 1000);

            /**
             * 创建门尺寸属性项
             * @param axis - 缩放轴向
             * @param label - 面板标签
             * @param currentMm - 当前尺寸（mm）
             * @param originalSize - 原始尺寸（m）
             */
            const makeDoorSizeItem = (
              axis: 'x' | 'y' | 'z',
              label: string,
              currentMm: number,
              originalSize: number
            ): NumberPropertyItem => ({
              id: `door-size-${axis}`,
              type: 'number',
              label: label,
              unit: 'mm',
              min: 1,
              max: 100000,
              step: 1,
              value: currentMm,
              readonly: axis === 'z' ? isThicknessReadonly : false,
              readonlyHint: axis === 'z' && isThicknessReadonly ? '厚度由吸附墙体厚度自动控制' : undefined,
              onChange: (newMm: number): void => {
                if (axis === 'z' && isThicknessReadonly) {
                  return;
                }

                const newSizeM: number = newMm / 1000;
                const newScale: number = newSizeM / originalSize;
                executeDoorWindowOpeningTransform(
                  `修改门${label} ${stlName}`,
                  (): void => {
                    if (axis === 'x') {
                      mesh.scale.setX(newScale);
                    }
                    if (axis === 'y') {
                      mesh.scale.setY(newScale);
                    }
                    if (axis === 'z') {
                      mesh.scale.setZ(newScale);
                    }
                  },
                  (): void => {
                    panelCtx.panelManager.setPropertyGroups(
                      buildDoorPropertyGroups(
                        mesh.userData['doorBottomHeight'] as number,
                        DoorOpeningDirectionHelper.getDirection(mesh)
                      )
                    );
                  }
                );
              },
            });

            /**
             * 门底高度属性项
             * 修改时更新 mesh.position.y 并通过门窗洞口联动命令入栈支持撤销/重做
             */
            const doorBottomHeightItem: NumberPropertyItem = {
              id: 'doorBottomHeight',
              type: 'number',
              label: '门底高度',
              unit: 'm',
              min: -10,
              max: 10,
              step: 0.01,
              value: doorBottomHeight,
              onChange: (newHeight: number): void => {
                executeDoorWindowOpeningTransform(
                  `修改门底高度 ${stlName}`,
                  (): void => {
                    mesh.position.setY(newHeight);
                    mesh.userData['doorBottomHeight'] = newHeight;
                  },
                  (): void => {
                    panelCtx.panelManager.setPropertyGroups(
                      buildDoorPropertyGroups(
                        mesh.userData['doorBottomHeight'] as number,
                        DoorOpeningDirectionHelper.getDirection(mesh)
                      )
                    );
                  }
                );
              },
            };

            /**
             * 门开启方向属性项
             * 修改时写入门开启方向并刷新 2D 图标；该属性不影响墙体洞口，仅刷新属性面板和符号表现。
             */
            const doorOpeningDirectionItem: SelectPropertyItem = {
              id: 'doorOpeningDirection',
              type: 'select',
              label: '开启方向',
              options: [
                { label: '内开', value: '内开' },
                { label: '外开', value: '外开' },
              ],
              value: doorOpeningDirection,
              onChange: (value: string): void => {
                if (value !== '内开' && value !== '外开') {
                  return;
                }
                const nextDirection: DoorOpeningDirection = value;
                DoorOpeningDirectionHelper.setDirectionAndRefreshSymbol(mesh, nextDirection, true);
                panelCtx.panelManager.setPropertyGroups(
                  buildDoorPropertyGroups(mesh.userData['doorBottomHeight'] as number, nextDirection)
                );
              },
            };

            return [
              {
                title: `🚪 门: ${stlName}`,
                expanded: true,
                items: [
                  makeDoorSizeItem('x', '宽（X）', currentSizeXmm, originalSizeX),
                  makeDoorSizeItem('y', '高（Y）', currentSizeYmm, originalSizeY),
                  makeDoorSizeItem('z', '厚（Z）', currentSizeZmm, originalSizeZ),
                  doorBottomHeightItem,
                  doorOpeningDirectionItem,
                ],
              },
            ];
          };

          panelCtx.panelManager.setPropertyGroups(
            buildDoorPropertyGroups(currentDoorBottomHeight, currentDoorOpeningDirection)
          );
          return;
        }

        /* 普通模型（category='model'）：显示长/宽/高属性，支持编辑并通过缩放修改尺寸 */
        if (category === 'model') {
          /* 读取放置时存储的原始包围盒尺寸（scale=1 时的尺寸） */
          const originalSizeX: number = (mesh.userData['originalSizeX'] as number) ?? 1;
          const originalSizeY: number = (mesh.userData['originalSizeY'] as number) ?? 1;
          const originalSizeZ: number = (mesh.userData['originalSizeZ'] as number) ?? 1;

          /** 底部高度默认值（m） */
          const DEFAULT_FLOOR_HEIGHT: number = 0.05;

          /**
           * 构建普通模型属性面板分组
           * 当前尺寸 = 原始尺寸 × 当前缩放，单位 mm
           * @param currentScale - 当前缩放值（三轴）
           * @param currentFloorHeight - 当前底部高度（m）
           */
          const buildModelPropertyGroups = (
            currentScale: THREE.Vector3,
            currentFloorHeight: number
          ): Array<PropertyGroup> => {
            /* 当前显示尺寸（mm）
             * 普通模型也固定按模型局部坐标轴计算：局部 X=长，局部 Z=宽，局部 Y=高。
             * 放置前后的世界旋转只改变朝向，不改变属性面板中 X/Z/Y 尺寸含义。
             */
            const currentSizeXmm: number = Math.round(originalSizeX * currentScale.x * 1000);
            const currentSizeYmm: number = Math.round(originalSizeY * currentScale.y * 1000);
            const currentSizeZmm: number = Math.round(originalSizeZ * currentScale.z * 1000);

            /**
             * 创建单轴尺寸属性项
             * @param axis - 轴向标识（'x' | 'y' | 'z'）
             * @param label - 显示标签
             * @param currentMm - 当前尺寸（mm）
             * @param originalSize - 原始尺寸（m）
             */
            const makeSizeItem = (
              axis: 'x' | 'y' | 'z',
              label: string,
              currentMm: number,
              originalSize: number
            ): NumberPropertyItem => ({
              id: `size-${axis}`,
              type: 'number',
              label: label,
              unit: 'mm',
              min: 1,
              max: 100000,
              step: 1,
              value: currentMm,
              onChange: (newMm: number): void => {
                /* 计算新缩放值：新缩放 = 新尺寸(m) / 原始尺寸(m) */
                const newSizeM: number = newMm / 1000;
                const newScale: number = newSizeM / originalSize;

                /* 记录修改前的缩放快照 */
                const beforeSnapshot: ScaleSnapshot = {
                  scaleX: mesh.scale.x,
                  scaleY: mesh.scale.y,
                  scaleZ: mesh.scale.z,
                };

                /* 计算修改后的缩放快照（仅修改对应轴） */
                const afterSnapshot: ScaleSnapshot = {
                  scaleX: axis === 'x' ? newScale : mesh.scale.x,
                  scaleY: axis === 'y' ? newScale : mesh.scale.y,
                  scaleZ: axis === 'z' ? newScale : mesh.scale.z,
                };

                /* 创建缩放命令并推入历史栈，支持撤销/重做 */
                const cmd: StlResizeCommand = new StlResizeCommand(
                  mesh,
                  beforeSnapshot,
                  afterSnapshot,
                  (): void => {
                    /* 刷新属性面板显示最新尺寸 */
                    panelCtx.panelManager.setPropertyGroups(
                      buildModelPropertyGroups(mesh.scale.clone(), mesh.userData['floorHeight'] as number ?? DEFAULT_FLOOR_HEIGHT)
                    );
                  },
                  `修改模型${label} ${stlName}`
                );
                historyManager.execute(cmd);
              },
            });

            /**
             * 底部高度属性项
             * 修改时直接更新 mesh.position.y，并通过 StlMoveCommand 入栈支持撤销/重做
             */
            const floorHeightItem: NumberPropertyItem = {
              id: 'floorHeight',
              type: 'number',
              label: '底部高度',
              unit: 'm',
              min: -10,
              max: 10,
              step: 0.01,
              value: currentFloorHeight,
              onChange: (newHeight: number): void => {
                /* 记录修改前的位置 */
                const beforePos: THREE.Vector3 = mesh.position.clone();
                /* 更新 Y 轴位置 */
                mesh.position.setY(newHeight);
                mesh.userData['floorHeight'] = newHeight;
                mesh.updateMatrixWorld(true);

                /* 通过 StlMoveCommand 入栈，支持撤销/重做 */
                const afterPos: THREE.Vector3 = mesh.position.clone();
                /* 先还原到修改前位置，再通过命令栈 execute 应用新位置
                 * CommandHistoryManager.execute() 会调用 cmd.execute() 将 Mesh 移动到 afterPos
                 */
                mesh.position.copy(beforePos);
                mesh.userData['floorHeight'] = beforePos.y;
                mesh.updateMatrixWorld(true);

                const cmd: StlMoveCommand = new StlMoveCommand(
                  mesh,
                  beforePos,
                  afterPos,
                  `修改底部高度 ${stlName}`
                );
                historyManager.execute(cmd);

                /* 刷新属性面板显示最新值 */
                panelCtx.panelManager.setPropertyGroups(
                  buildModelPropertyGroups(mesh.scale.clone(), newHeight)
                );
              },
            };

            return [
              {
                title: `📦 模型: ${stlName}`,
                expanded: true,
                items: [
                  makeSizeItem('x', '长（X）', currentSizeXmm, originalSizeX),
                  makeSizeItem('z', '宽（Z）', currentSizeZmm, originalSizeZ),
                  makeSizeItem('y', '高（Y）', currentSizeYmm, originalSizeY),
                  floorHeightItem,
                ],
              },
            ];
          };

          const initFloorHeight: number = (mesh.userData['floorHeight'] as number) ?? DEFAULT_FLOOR_HEIGHT;
          panelCtx.panelManager.setPropertyGroups(buildModelPropertyGroups(mesh.scale.clone(), initFloorHeight));
          return;
        }

        /* 其他未知类型 STL 模型：仅显示名称信息 */
        const infoGroup: PropertyGroup = {
          title: `📦 STL 模型: ${stlName}`,
          expanded: true,
          items: [],
        };
        panelCtx.panelManager.setPropertyGroups([infoGroup]);
      }
    );

    return unsubscribe;
  }, [selectionManager, panelCtx, refreshProperties, objectManager, buildPropertyGroups]);

  /* 纯逻辑组件，不渲染任何 UI */
  return null;
}
