/**
 * STL 模型注册表
 * 定义可用的 STL 模型列表，供左侧面板 CAD 模型分组展示
 */

/**
 * STL 模型定义接口
 */
export interface StlModelDef {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** STL 文件 URL（相对于 public 目录） */
  url: string;
  /** 模型分类（如 'wall'、'slab' 等） */
  category: string;
  /** 预览 emoji 图标（缩略图生成前的占位） */
  icon: string;
  /**
   * 窗台高度（仅 category='window' 时有效）
   * 表示窗户底部离地面的高度（米），布置时模型 Y 轴将偏移此值
   * 默认值：0.9m（标准窗台高度）
   */
  sillHeight?: number;
  /**
   * 门底高度（仅 category='door' 时有效）
   * 表示门底部离地面的高度（米），布置时模型 Y 轴将偏移此值
   * 默认值：0.05m（5cm 离地，避免与地面 Z-fighting）
   */
  doorBottomHeight?: number;
  /**
   * 是否自适应墙体厚度（仅 category='door' / category='window' 时有效）
   * 默认值：true。门窗吸附墙体后，局部 Z 轴厚度会自动同步为墙体厚度。
   */
  isAdaptiveThickness?: boolean;
  /**
   * 默认宽度（仅 category='door' / category='window' 时有效，单位：米）
   * 布置门窗模型时会按该值缩放局部 X 轴，并写入属性栏宽度初始值。
   */
  defaultWidth?: number;
  /**
   * 默认高度（仅 category='door' / category='window' 时有效，单位：米）
   * 布置门窗模型时会按该值缩放局部 Y 轴，并写入属性栏高度初始值。
   */
  defaultHeight?: number;
}

/**
 * 预置 STL 模型列表
 * 读取 public/models/ 目录下的 STL 文件
 */
/** 标准窗默认宽度（米），布置后作为属性栏宽度初始值 */
const DEFAULT_WINDOW_WIDTH_M: number = 1.5;

/** 标准窗默认高度（米），布置后作为属性栏高度初始值 */
const DEFAULT_WINDOW_HEIGHT_M: number = 1.5;

/** 标准门默认宽度（米），布置后作为属性栏宽度初始值 */
const DEFAULT_DOOR_WIDTH_M: number = 0.9;

/** 标准门默认高度（米），布置后作为属性栏高度初始值 */
const DEFAULT_DOOR_HEIGHT_M: number = 2.1;

export const STL_MODEL_LIST: StlModelDef[] = [
  {
    id: 'stl-matong',
    name: '马桶',
    url: '/models/马桶.stl',
    category: 'model',
    icon: '🚽',
  },
  {
    id: 'stl-washpool',
    name: '洗手池',
    url: '/models/洗手池.stl',
    category: 'model',
    icon: '🚪',
  },
  // {
  //   id: 'stl-window',
  //   name: '窗',
  //   url: '/models/窗.stl',
  //   category: 'window',
  //   icon: '🚪',
  //   /** 标准窗台高度 0.9m */
  //   sillHeight: 0.9,
  // },
  // {
  //   id: 'stl-door',
  //   name: '门',
  //   url: '/models/门.stl',
  //   category: 'door',
  //   icon: '🚪',
  //   doorBottomHeight: 0.05,
  // },
  {
    id: 'stl-baywindow',
    name: '飘窗',
    url: '/models/外飘窗.stl',
    category: 'window',
    icon: '🚪',
    /** 标准窗台高度 0.9m */
    sillHeight: 0.9,
    isAdaptiveThickness: false,
    defaultWidth: DEFAULT_WINDOW_WIDTH_M,
    defaultHeight: DEFAULT_WINDOW_HEIGHT_M,
  },
  {
    id: 'stl-doublebed',
    name: '双人床',
    url: '/models/双人床.stl',
    category: 'model',
    icon: '🚪',
  },
  {
    id: 'stl-doublewindow',
    name: '双扇平开窗',
    url: '/models/双扇平开窗.stl',
    category: 'window',
    icon: '🚪',
    /** 标准窗台高度 0.9m */
    sillHeight: 0.9,
    defaultWidth: DEFAULT_WINDOW_WIDTH_M,
    defaultHeight: DEFAULT_WINDOW_HEIGHT_M,
  },
  {
    id: 'stl-doublewindowwithgrid',
    name: '双扇推拉门带格栅',
    url: '/models/双扇推拉门带格栅.stl',
    category: 'door',
    icon: '🚪',
    /** 标准门底高度 0.05m */
    doorBottomHeight: 0.05,
    defaultWidth: DEFAULT_DOOR_WIDTH_M,
    defaultHeight: DEFAULT_DOOR_HEIGHT_M,
  },
  {
    id: 'stl-singledoor',
    name: '单扇平开门',
    url: '/models/单扇平开门.stl',
    category: 'door',
    icon: '🚪',
    doorBottomHeight: 0.05,
    defaultWidth: DEFAULT_DOOR_WIDTH_M,
    defaultHeight: DEFAULT_DOOR_HEIGHT_M,
  },
  {
    id: 'stl-doubleopendoor',
    name: '双开门',
    url: '/models/双开门.stl',
    category: 'door',
    icon: '🚪',
    doorBottomHeight: 0.05,
    defaultWidth: DEFAULT_DOOR_WIDTH_M,
    defaultHeight: DEFAULT_DOOR_HEIGHT_M,
  },
];
