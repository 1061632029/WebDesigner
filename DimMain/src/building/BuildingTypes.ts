/**
 * 建筑对象类型定义
 * 可扩展的建筑对象数据模型，支持墙体、柱、门窗等
 * 所有渲染对象拥有全局唯一 ID
 */

import type { BufferGeometry } from 'three/webgpu';

/* ========== 基础类型 ========== */

/**
 * 2D 点（XZ 平面坐标，Y 为高度方向）
 */
export interface Point2D {
  /** 世界坐标 X */
  x: number;
  /** 世界坐标 Z */
  z: number;
}

/**
 * 材质类型枚举
 * 对应 Three.js 的 MeshStandardMaterial / MeshBasicMaterial / MeshPhysicalMaterial
 */
export type BuildingMaterialType = 'standard' | 'basic' | 'physical';
/**
 * 轴对齐包围盒（AABB）接口
 * 用于存储建筑对象的包围盒信息，支持选择/碰撞检测/布尔运算
 */
export interface BoundingBox {
  /** 包围盒最小点 */
  min: Point2D;
  /** 包围盒最大点 */
  max: Point2D;
  /** 包围盒中心点 */
  center: Point2D;
  /** 包围盒尺寸（宽 x，深 z，高 y） */
  size: {
    x: number;
    y: number;
    z: number;
  };
}

/**
 * 材质属性接口
 * 附加在每个建筑对象上，控制渲染外观
 */
export interface MaterialProperties {
  /** 颜色（十六进制，如 0xff4444） */
  color: number;
  /** 金属度 0~1（仅 standard / physical 有效） */
  metalness: number;
  /** 粗糙度 0~1（仅 standard / physical 有效） */
  roughness: number;
  /** 不透明度 0~1（小于 1 时自动启用透明） */
  opacity: number;
  /** 材质类型 */
  materialType: BuildingMaterialType;
}

/**
 * 建筑对象类别枚举
 * 新增对象类型时在此扩展
 */
export type BuildingCategory = 'wall' | 'column' | 'door' | 'window' | 'slab' | 'beam' | 'ceiling';

/**
 * 所有建筑对象的公共基类接口
 * 每个对象都拥有全局唯一 ID 和通用属性
 */
export interface BuildingObjectBase {
  /** 全局唯一标识符 */
  id: string;
  /** 对象类别 */
  category: BuildingCategory;
  /** 用户可见名称（如"墙体-1"） */
  name: string;
  /** 是否可见 */
  visible: boolean;
  /** 是否锁定（不可选择/编辑） */
  locked: boolean;
  /** 高度（米） */
  height: number;
  /** 底部标高 Y 偏移（米） */
  elevation: number;
  /** X 轴位置偏移（米，相对于布置位置的偏移量） */
  offsetX: number;
  /** Y 轴位置偏移（米，相对于布置位置的偏移量） */
  offsetY: number;
  /** Z 轴位置偏移（米，相对于布置位置的偏移量） */
  offsetZ: number;
  /** 材质属性（颜色、金属度、粗糙度等） */
  material: MaterialProperties;
  /** 轴对齐包围盒（AABB） */
  boundingBox: BoundingBox;
}

/* ========== 墙体类型 ========== */

/** 墙体子类型 */
export type WallSubType = 'straight' | 'arc' | 'rect';

/**
 * 墙体洞口数据
 * 描述在墙体侧面开凿的矩形洞口（门洞/窗洞）
 * 洞口位置由中心线参数 t 确定，尺寸由宽高决定
 */
export interface WallOpening {
  /** 洞口中心在墙中线上的参数 t（0=起点，1=终点） */
  centerT: number;
  /** 洞口宽度（沿墙方向，米） */
  width: number;
  /** 洞口高度（米） */
  height: number;
  /** 洞口底部标高（相对于墙体底部，米），门洞通常为 0，窗洞通常 > 0 */
  bottomElevation: number;
}

/**
 * 直墙数据
 * 由两点确定中心线，向两侧偏移 thickness/2 形成墙体
 */
export interface StraightWallData extends BuildingObjectBase {
  category: 'wall';
  subType: 'straight';
  /** 中心线起点 */
  start: Point2D;
  /** 中心线终点 */
  end: Point2D;
  /** 墙体厚度（米） */
  thickness: number;
  /** 墙体洞口列表（门洞/窗洞），可选 */
  openings?: WallOpening[];
  /**
   * 关联的天花板 ID
   * 有值时墙高由天花板 bottomOffset 决定，不可手动修改
   * null 表示未绑定天花板，墙高使用默认值
   */
  ceilingId: string | null;
  /**
   * 关联的楼板 ID
   * null 表示未绑定楼板
   */
  slabId: string | null;
}

/**
 * 弧形墙数据
 * 由起点、终点、弧度因子确定弧形中心线
 */
export interface ArcWallData extends BuildingObjectBase {
  category: 'wall';
  subType: 'arc';
  /** 弧线起点 */
  start: Point2D;
  /** 弧线终点 */
  end: Point2D;
  /** 弧度因子（0=直线，正值=左凸，负值=右凸，DXF/DWG 标准） */
  bulge: number;
  /** 弧线分段数（越大越圆滑） */
  segments: number;
  /** 墙体厚度（米） */
  thickness: number;
}

/**
 * 矩形墙数据
 * 由对角两点确定矩形，自动生成四面首尾相连的直墙
 */
export interface RectWallData extends BuildingObjectBase {
  category: 'wall';
  subType: 'rect';
  /** 矩形对角点 1 */
  corner1: Point2D;
  /** 矩形对角点 2 */
  corner2: Point2D;
  /** 生成的四面子墙 ID */
  childWallIds: [string, string, string, string];
  /** 墙体厚度（米） */
  thickness: number;
}

/** 墙体数据联合类型 */
export type WallData = StraightWallData | ArcWallData | RectWallData;

/* ========== 柱子类型（扩展预留） ========== */

/** 柱子截面形状 */
export type ColumnShape = 'round' | 'square' | 'rectangular';

/**
 * 柱子数据
 */
export interface ColumnData extends BuildingObjectBase {
  category: 'column';
  /** 截面形状 */
  shape: ColumnShape;
  /** 柱子中心位置 */
  center: Point2D;
  /** X 方向尺寸（米） */
  width: number;
  /** Z 方向尺寸（米） */
  depth: number;
  /** 绕 Y 轴旋转角度（弧度） */
  rotation: number;
}

/* ========== 楼板类型 ========== */

/**
 * 楼板数据
 * 由封闭墙体围合的多边形轮廓向下挤压生成
 */
export interface SlabData extends BuildingObjectBase {
  category: 'slab';
  /** 楼板轮廓（XZ 平面多边形顶点，按顺序闭合，单位：米） */
  outline: Point2D[];
  /** 楼板厚度（米），默认 0.1（100mm），向下拉伸，修改厚度不影响顶面高度 */
  slabThickness: number;
  /**
   * 楼板顶面高度偏移（米），默认 0m
   * 楼板顶面 Y = topOffset，地面为 0m
   * 修改此值会整体移动楼板位置，不影响厚度
   */
  topOffset: number;
}

/* ========== 天花板类型 ========== */

/**
 * 天花板数据
 * 由封闭墙体围合的多边形外边界轮廓向上挤压生成
 * 天花板底面贴合墙体顶部（bottomOffset = 墙高）
 */
export interface CeilingData extends BuildingObjectBase {
  category: 'ceiling';
  /** 天花板轮廓（XZ 平面多边形顶点，外边界，单位：米） */
  outline: Point2D[];
  /** 天花板厚度（米），默认 0.2（200mm），向上挤压 */
  ceilingThickness: number;
  /**
   * 天花板底面高度（米），默认 3.0m（= 墙高）
   * 天花板底面 Y = bottomOffset
   * 天花板顶面 Y = bottomOffset + ceilingThickness
   */
  bottomOffset: number;
  /**
   * 关联的墙体 ID 列表（围合该天花板的墙体）
   * 修改 bottomOffset 时，这些墙体的 height 会同步更新
   */
  wallIds: string[];
}

/* ========== 梁类型 ========== */

/** 梁位置基准类型 */
export type BeamPlacementReference = 'floor' | 'ceiling';

/**
 * 梁构件数据
 * 由两点确定中心线，长度随线式布置点间距自动计算，不允许手动编辑。
 */
export interface BeamData extends BuildingObjectBase {
  category: 'beam';
  /** 梁中心线起点 */
  start: Point2D;
  /** 梁中心线终点 */
  end: Point2D;
  /** 梁宽度（米），表示 XZ 平面上垂直于布置方向的截面长度 */
  width: number;
  /** 梁长度（米），由 start/end 自动计算并随布置点变化 */
  length: number;
  /** 梁位置基准：地面或顶面 */
  placementReference: BeamPlacementReference;
  /** 离地面距离（米），placementReference=floor 时生效 */
  distanceFromFloor: number;
  /** 离顶面距离（米），placementReference=ceiling 时生效 */
  distanceFromCeiling: number;
}

/* ========== 统一联合类型 ========== */

/**
 * 所有建筑对象的联合类型
 * 新增对象类型时在此扩展
 */
export type BuildingObject = WallData | ColumnData | SlabData | CeilingData | BeamData;

/* ========== 默认参数 ========== */

/** 楼板默认参数 */
export const SLAB_DEFAULTS = {
  /** 默认楼板厚度（米，对应 100mm） */
  slabThickness: 0.1,
  /** 默认楼板顶面高度偏移（米），默认楼板顶面 Y = 0 */
  topOffset: 0,
} as const;

/** 墙体默认参数 */
export const WALL_DEFAULTS = {
  /** 默认墙体高度（米，对应 2800mm） */
  height: 2.8,
  /** 默认墙体厚度（米，对应 240mm） */
  thickness: 0.1,
  /** 默认底部标高 */
  elevation: 0,
  /** 弧形墙默认分段数 */
  arcSegments: 32,
} as const;

/** 天花板默认参数 */
export const CEILING_DEFAULTS = {
  /**
   * 天花板底面默认高度（米）
   * 与 WALL_DEFAULTS.height 保持一致（2.8m），确保天花板底面贴合墙顶，无高度间隙
   */
  bottomOffset: WALL_DEFAULTS.height,
  /** 默认天花板厚度（米，对应 100mm），向上挤压 */
  ceilingThickness: 0.1,
} as const;

/** 梁默认参数 */
export const BEAM_DEFAULTS = {
  /** 默认梁高度（米，对应 300mm） */
  height: 0.3,
  /** 默认梁宽度（米，对应 200mm） */
  width: 0.2,
  /** 默认离地面距离（米） */
  distanceFromFloor: 2.5,
  /** 默认离顶面距离（米） */
  distanceFromCeiling: 0,
  /** 默认顶面高度（米），用于按顶面距离换算梁底标高 */
  ceilingReferenceHeight: CEILING_DEFAULTS.bottomOffset,
} as const;

/** @deprecated 拼写错误，请使用 CEILING_DEFAULTS */
export const CELLING_DEFAULTS = CEILING_DEFAULTS;

/** 各类别默认颜色（十六进制）
 * 素描灰阶风格：各类别使用不同层次的灰色，形成手绘素描感
 * 天花板最亮（0xf0f0f0）→ 墙体（0xe8e8e8）→ 楼板（0xd4d4d4）→ 梁/柱（0xcccccc）
 */
export const CATEGORY_COLORS: Record<BuildingCategory, number> = {
  /** 墙体：浅灰白，主体构件 */
  wall: 0xe8e8e8,
  /** 柱子：中浅灰 */
  column: 0xcccccc,
  /** 门：中灰（与 STL 模型一致） */
  door: 0xc8c8c8,
  /** 窗：中灰（与 STL 模型一致） */
  window: 0xc8c8c8,
  /** 楼板：中浅灰，略深于墙体 */
  slab: 0xd4d4d4,
  /** 梁：中灰 */
  beam: 0xcccccc,
  /** 天花板：接近白，顶面最亮 */
  ceiling: 0xf0f0f0,
};

/** 全局默认材质属性（素描灰阶风格：高粗糙度、无金属感） */
export const MATERIAL_DEFAULTS: MaterialProperties = {
  color: 0xe8e8e8,
  metalness: 0.0,
  roughness: 0.9,
  opacity: 1.0,
  materialType: 'standard',
};

/**
 * 根据对象类别获取默认材质属性
 * @param category - 建筑对象类别
 * @returns 带有类别预设颜色的材质属性
 */
export function getDefaultMaterial(category: BuildingCategory): MaterialProperties {
  return {
    ...MATERIAL_DEFAULTS,
    color: CATEGORY_COLORS[category],
  };
}

/* ========== 几何构建器接口 ========== */

/**
 * 几何构建器接口
 * 每种建筑对象类别需实现此接口，将数据转换为 Three.js BufferGeometry
 */
export interface IGeometryBuilder {
  /**
   * 根据建筑对象数据生成几何体
   * @param data - 建筑对象数据
   * @returns Three.js BufferGeometry
   */
  build(data: BuildingObject): BufferGeometry;
}

/* ========== 墙体连接拓扑 ========== */

/** 墙体端点类型（起点或终点） */
export type WallEndpoint = 'start' | 'end';

/**
 * 墙体连接记录
 * 表示某面墙的某个端点连接到了一个共享节点
 */
export interface WallConnection {
  /** 墙体 ID */
  wallId: string;
  /** 该墙体连接的端点（起点或终点） */
  endpoint: WallEndpoint;
}

/**
 * 墙体连接节点（Joint）
 * 多面墙可以共享同一个节点，实现端点吸附和拓扑管理
 */
export interface WallJoint {
  /** 节点唯一 ID */
  id: string;
  /** 节点在世界坐标中的位置（XZ 平面） */
  position: Point2D;
  /** 连接到此节点的所有墙体端点列表 */
  connections: Array<WallConnection>;
}

/** 吸附检测结果 */
export interface SnapResult {
  /** 是否吸附到已有端点 */
  snapped: boolean;
  /** 吸附后的坐标（若吸附则为节点坐标，否则为原始坐标） */
  position: Point2D;
  /** 吸附到的节点 ID（未吸附时为 null） */
  jointId: string | null;
}

/** 吸附阈值（米），鼠标在此距离内自动吸附到最近端点 */
export const SNAP_THRESHOLD: number = 0.15;

/**
 * 单端斜切参数
 * 描述墙体某一端面的斜切偏移量
 * 前侧（+法线方向）和后侧（-法线方向）角点各自沿墙体方向缩进不同距离，
 * 使端面形成斜切平面，与对方墙侧面完美共面
 */
export interface MiterEndParams {
  /**
   * 前侧角点偏移量（沿 +法线 方向的角点，即靠近对方墙外侧的角点）
   * 正值 = 向内缩短（端点向墙体内部移动）
   */
  frontOffset: number;
  /**
   * 后侧角点偏移量（沿 -法线 方向的角点，即靠近对方墙内侧的角点）
   * 正值 = 向内缩短（端点向墙体内部移动）
   */
  backOffset: number;
}

/**
 * Miter（斜切）偏移参数
 * 用于两墙交汇处的几何裁切对齐
 * 每个端点的前侧和后侧角点分别偏移不同距离，形成斜切端面
 */
export interface MiterParams {
  /** 起点端的斜切参数（前侧/后侧角点各自的偏移量） */
  start: MiterEndParams;
  /** 终点端的斜切参数（前侧/后侧角点各自的偏移量） */
  end: MiterEndParams;
}

/**
 * 墙体差集矩形参数
 * 描述需要从当前墙体 XZ 截面中减去的矩形区域
 * 用于 T 形连接时，次墙端面与主墙侧面共面后，主墙需要开洞
 */
export interface WallSubtractionRect {
  /**
   * 矩形中心点（XZ 平面）
   * 通常为次墙端点在主墙中心线上的投影点
   */
  centerX: number;
  centerZ: number;
  /**
   * 矩形沿主墙方向的半宽（= 次墙厚度 / 2）
   */
  halfWidth: number;
  /**
   * 矩形沿主墙法线方向的半深（= 主墙厚度 / 2，贯穿整个主墙厚度）
   */
  halfDepth: number;
  /**
   * 主墙方向单位向量（XZ 平面）
   * 用于将矩形旋转到主墙坐标系
   */
  wallDirX: number;
  wallDirZ: number;
}

/* ========== 绘制工具相关 ========== */

/** 绘制工具模式 */
export type DrawToolMode = 'none' | 'straight-wall' | 'arc-wall' | 'rect-wall' | 'beam';

/** 绘制工具状态 */
export type DrawToolState = 'idle' | 'picking-start' | 'picking-end' | 'picking-bulge' | 'preview';
