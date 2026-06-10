/**
 * ViewCube — 视图方向指示器
 * 显示在视口右上角的 CSS 3D 立方体，实时反映当前相机朝向
 * 支持点击面、边、角点切换到对应标准视图：
 * - 点击面：相机移动到面法向量方向
 * - 点击边：相机移动到两面法向量之和方向（45° 斜视角）
 * - 点击角点：相机移动到三面法向量之和方向（等轴测视角）
 */

import React, { useState, useCallback, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { useEngine } from '../hooks/useEngine';
import { useFrame } from '../hooks/useFrame';
import type { Engine } from '../../core/Engine';

/* ========== 常量 ========== */

/** 立方体尺寸（像素） */
const CUBE_SIZE: number = 70;

/** 立方体半尺寸 */
const HALF_SIZE: number = CUBE_SIZE / 2;

/** 边元素的宽度（像素） */
const EDGE_THICKNESS: number = 6;

/** 边元素的长度（像素，略短于面边长） */
const EDGE_LENGTH: number = CUBE_SIZE - EDGE_THICKNESS * 2;

/** 角点元素的尺寸（像素） */
const CORNER_SIZE: number = 8;

/* ========== 类型定义 ========== */

/**
 * 可点击元素的通用接口
 * 面、边、角点共享同一套点击逻辑
 */
interface CubeElement {
  /** 元素唯一标识 */
  name: string;
  /** 悬停提示文字 */
  title: string;
  /** CSS 3D 变换（定位到立方体上的对应位置） */
  transform: string;
  /** 对应的相机方向向量（未归一化，点击时会归一化） */
  cameraDir: [number, number, number];
    /** 可选：相机上方方向向量（用于避免万向锁，默认为 [0,1,0]） */
  cameraUp?: [number, number, number];
}

/** 面定义（扩展了背景色和标签） */
interface CubeFace extends CubeElement {
  /** 显示标签 */
  label: string;
  /** 面背景色 */
  bgColor: string;
}

/* ========== 面定义 ========== */

/** 六个面（Three.js 坐标系：Y 朝上，-Z 为正前方） */
const CUBE_FACES: CubeFace[] = [
  {
    name: 'front',
    label: '前',
    title: '切换到前视图',
    transform: `translateZ(${HALF_SIZE}px)`,
    bgColor: 'rgba(76, 135, 200, 0.85)',
    cameraDir: [0, 0, 1],
  },
  {
    name: 'back',
    label: '后',
    title: '切换到后视图',
    transform: `rotateY(180deg) translateZ(${HALF_SIZE}px)`,
    bgColor: 'rgba(76, 135, 200, 0.7)',
    cameraDir: [0, 0, -1],
  },
  {
    name: 'right',
    label: '右',
    title: '切换到右视图',
    transform: `rotateY(90deg) translateZ(${HALF_SIZE}px)`,
    bgColor: 'rgba(200, 76, 76, 0.85)',
    cameraDir: [1, 0, 0],
  },
  {
    name: 'left',
    label: '左',
    title: '切换到左视图',
    transform: `rotateY(-90deg) translateZ(${HALF_SIZE}px)`,
    bgColor: 'rgba(200, 76, 76, 0.7)',
    cameraDir: [-1, 0, 0],
  },
  {
    name: 'top',
    label: '顶',
    title: '切换到顶视图',
    transform: `rotateX(-90deg) translateZ(${HALF_SIZE}px)`,
    bgColor: 'rgba(76, 200, 76, 0.85)',
    cameraDir: [0, 1, 0],
    cameraUp: [0, 0, -1],
  },
  {
    name: 'bottom',
    label: '底',
    title: '切换到底视图',
    transform: `rotateX(90deg) translateZ(${HALF_SIZE}px)`,
    bgColor: 'rgba(76, 200, 76, 0.7)',
    cameraDir: [0, -1, 0],
    cameraUp: [0, 0, 1],
  },
];

/* ========== 边定义 ========== */

/**
 * 12 条边的定义
 * 每条边定位在两个相邻面的交线中点处
 * cameraDir 为两面法向量之和（点击时归一化）
 *
 * CSS 定位策略：
 * - 水平边（沿 X 轴）：宽 EDGE_LENGTH，高 EDGE_THICKNESS
 * - 垂直边（沿 Y 轴）：宽 EDGE_THICKNESS，高 EDGE_LENGTH
 * - 深度边（沿 Z 轴）：宽 EDGE_THICKNESS，高 EDGE_LENGTH，旋转 90deg
 *
 * 每条边放在对应面的边缘，通过 translateZ + translateX/Y 定位
 */
const CUBE_EDGES: CubeElement[] = [
  /* ===== 前面的 4 条边 ===== */
  {
    name: 'front-top',
    title: '前-顶边视图',
    /* 前面顶边：在前面顶部，沿 X 轴方向 */
    transform: `translateZ(${HALF_SIZE}px) translateY(-${HALF_SIZE}px)`,
    cameraDir: [0, 1, 1],
  },
  {
    name: 'front-bottom',
    title: '前-底边视图',
    transform: `translateZ(${HALF_SIZE}px) translateY(${HALF_SIZE}px)`,
    cameraDir: [0, -1, 1],
  },
  {
    name: 'front-right',
    title: '前-右边视图',
    transform: `translateZ(${HALF_SIZE}px) translateX(${HALF_SIZE}px)`,
    cameraDir: [1, 0, 1],
  },
  {
    name: 'front-left',
    title: '前-左边视图',
    transform: `translateZ(${HALF_SIZE}px) translateX(-${HALF_SIZE}px)`,
    cameraDir: [-1, 0, 1],
  },
  /* ===== 后面的 4 条边 ===== */
  {
    name: 'back-top',
    title: '后-顶边视图',
    transform: `rotateY(180deg) translateZ(${HALF_SIZE}px) translateY(-${HALF_SIZE}px)`,
    cameraDir: [0, 1, -1],
  },
  {
    name: 'back-bottom',
    title: '后-底边视图',
    transform: `rotateY(180deg) translateZ(${HALF_SIZE}px) translateY(${HALF_SIZE}px)`,
    cameraDir: [0, -1, -1],
  },
  {
    name: 'back-right',
    title: '后-右边视图',
    /* 后面的右边对应世界坐标的左边（因为后面翻转了） */
    transform: `rotateY(180deg) translateZ(${HALF_SIZE}px) translateX(${HALF_SIZE}px)`,
    cameraDir: [-1, 0, -1],
  },
  {
    name: 'back-left',
    title: '后-左边视图',
    transform: `rotateY(180deg) translateZ(${HALF_SIZE}px) translateX(-${HALF_SIZE}px)`,
    cameraDir: [1, 0, -1],
  },
  /* ===== 顶面的 4 条边（顶面已有前后左右，只需补充顶面自身的边） ===== */
  {
    name: 'top-right',
    title: '顶-右边视图',
    transform: `rotateX(-90deg) translateZ(${HALF_SIZE}px) translateX(${HALF_SIZE}px)`,
    cameraDir: [1, 1, 0],
  },
  {
    name: 'top-left',
    title: '顶-左边视图',
    transform: `rotateX(-90deg) translateZ(${HALF_SIZE}px) translateX(-${HALF_SIZE}px)`,
    cameraDir: [-1, 1, 0],
  },
  {
    name: 'bottom-right',
    title: '底-右边视图',
    transform: `rotateX(90deg) translateZ(${HALF_SIZE}px) translateX(${HALF_SIZE}px)`,
    cameraDir: [1, -1, 0],
  },
  {
    name: 'bottom-left',
    title: '底-左边视图',
    transform: `rotateX(90deg) translateZ(${HALF_SIZE}px) translateX(-${HALF_SIZE}px)`,
    cameraDir: [-1, -1, 0],
  },
];

/* ========== 角点定义 ========== */

/**
 * 8 个角点的定义
 * 每个角点定位在三个相邻面的交点处
 * cameraDir 为三面法向量之和（点击时归一化）
 */
const CUBE_CORNERS: CubeElement[] = [
  {
    name: 'front-top-right',
    title: '前-顶-右角视图',
    transform: `translateZ(${HALF_SIZE}px) translateX(${HALF_SIZE}px) translateY(-${HALF_SIZE}px)`,
    cameraDir: [1, 1, 1],
  },
  {
    name: 'front-top-left',
    title: '前-顶-左角视图',
    transform: `translateZ(${HALF_SIZE}px) translateX(-${HALF_SIZE}px) translateY(-${HALF_SIZE}px)`,
    cameraDir: [-1, 1, 1],
  },
  {
    name: 'front-bottom-right',
    title: '前-底-右角视图',
    transform: `translateZ(${HALF_SIZE}px) translateX(${HALF_SIZE}px) translateY(${HALF_SIZE}px)`,
    cameraDir: [1, -1, 1],
  },
  {
    name: 'front-bottom-left',
    title: '前-底-左角视图',
    transform: `translateZ(${HALF_SIZE}px) translateX(-${HALF_SIZE}px) translateY(${HALF_SIZE}px)`,
    cameraDir: [-1, -1, 1],
  },
  {
    name: 'back-top-right',
    title: '后-顶-右角视图',
    /* 后面翻转后，X 轴方向相反 */
    transform: `rotateY(180deg) translateZ(${HALF_SIZE}px) translateX(-${HALF_SIZE}px) translateY(-${HALF_SIZE}px)`,
    cameraDir: [1, 1, -1],
  },
  {
    name: 'back-top-left',
    title: '后-顶-左角视图',
    transform: `rotateY(180deg) translateZ(${HALF_SIZE}px) translateX(${HALF_SIZE}px) translateY(-${HALF_SIZE}px)`,
    cameraDir: [-1, 1, -1],
  },
  {
    name: 'back-bottom-right',
    title: '后-底-右角视图',
    transform: `rotateY(180deg) translateZ(${HALF_SIZE}px) translateX(-${HALF_SIZE}px) translateY(${HALF_SIZE}px)`,
    cameraDir: [1, -1, -1],
  },
  {
    name: 'back-bottom-left',
    title: '后-底-左角视图',
    transform: `rotateY(180deg) translateZ(${HALF_SIZE}px) translateX(${HALF_SIZE}px) translateY(${HALF_SIZE}px)`,
    cameraDir: [-1, -1, -1],
  },
];

/* ========== 样式 ========== */

/** 外层容器样式（固定在右上角） */
const containerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: CUBE_SIZE + 20,
  height: CUBE_SIZE + 20,
  perspective: 300,
  zIndex: 50,
  userSelect: 'none',
  pointerEvents: 'auto',
};

/** 立方体场景容器 */
const sceneStyle: React.CSSProperties = {
  width: CUBE_SIZE,
  height: CUBE_SIZE,
  margin: '10px auto',
  position: 'relative',
  transformStyle: 'preserve-3d',
  transition: 'transform 0.05s linear',
};

/** 面样式基础 */
const faceBaseStyle: React.CSSProperties = {
  position: 'absolute',
  width: CUBE_SIZE,
  height: CUBE_SIZE,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 13,
  fontWeight: 'bold',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  borderRadius: 4,
  cursor: 'pointer',
  backfaceVisibility: 'hidden',
  textShadow: '0 1px 2px rgba(0,0,0,0.5)',
};

/** 边样式基础（水平方向，宽 EDGE_LENGTH，高 EDGE_THICKNESS） */
const edgeBaseStyle: React.CSSProperties = {
  position: 'absolute',
  width: EDGE_LENGTH,
  height: EDGE_THICKNESS,
  /* 居中定位：left/top 偏移使元素中心对齐到原点 */
  left: EDGE_THICKNESS,
  top: (CUBE_SIZE - EDGE_THICKNESS) / 2,
  backgroundColor: 'rgba(255, 255, 255, 0)',
  border: '1px solid rgba(255, 255, 255, 0)',
  borderRadius: 2,
  cursor: 'pointer',
  backfaceVisibility: 'hidden',
  transition: 'background-color 0.15s, border-color 0.15s',
  zIndex: 10,
};

/** 角点样式基础 */
const cornerBaseStyle: React.CSSProperties = {
  position: 'absolute',
  width: CORNER_SIZE,
  height: CORNER_SIZE,
  /* 居中定位 */
  left: (CUBE_SIZE - CORNER_SIZE) / 2,
  top: (CUBE_SIZE - CORNER_SIZE) / 2,
  backgroundColor: 'rgba(255, 255, 255, 0)',
  border: '1px solid rgba(255, 255, 255, 0)',
  borderRadius: '50%',
  cursor: 'pointer',
  backfaceVisibility: 'hidden',
  transition: 'background-color 0.15s, border-color 0.15s',
  zIndex: 20,
};

/* ========== 工具函数 ========== */

/**
 * 从相机的世界矩阵中提取旋转，生成 CSS 3D matrix3d 变换
 * 相机的视图矩阵（逆矩阵）的旋转部分用来旋转立方体
 */
function cameraRotationToCssTransform(camera: THREE.Camera): string {
  /* 获取相机的世界矩阵的逆（即视图矩阵） */
  const viewMatrix: THREE.Matrix4 = new THREE.Matrix4();
  viewMatrix.copy(camera.matrixWorldInverse);

  /* 提取 3x3 旋转部分（忽略平移）
   * Three.js elements 列优先：
   *   [0]  [4]  [8]   [12]
   *   [1]  [5]  [9]   [13]
   *   [2]  [6]  [10]  [14]
   *   [3]  [7]  [11]  [15]
   */
  const elements: Float32Array | number[] = viewMatrix.elements;
  const m00: number = elements[0] as number;
  const m01: number = elements[4] as number;
  const m02: number = elements[8] as number;
  const m10: number = elements[1] as number;
  const m11: number = elements[5] as number;
  const m12: number = elements[9] as number;
  const m20: number = elements[2] as number;
  const m21: number = elements[6] as number;
  const m22: number = elements[10] as number;

  /* 构建 CSS matrix3d（只有旋转，无平移） */
  return `matrix3d(${m00},${-m10},${m20},0,${m01},${-m11},${m21},0,${m02},${-m12},${m22},0,0,0,0,1)`;
}

/**
 * 将方向向量归一化
 * @param dir - 原始方向向量（可能未归一化）
 * @returns 归一化后的 THREE.Vector3
 */
function normalizeDir(dir: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
}

/* ========== 子组件 ========== */

/** 边元素 Props */
interface EdgeElementProps {
  edge: CubeElement;
  onViewClick: (dir: [number, number, number]) => void;
}

/**
 * 边元素组件
 * hover 时显示高亮，点击切换视角
 */
function EdgeElement(props: EdgeElementProps): React.ReactElement {
  const { edge, onViewClick } = props;
  const [hovered, setHovered] = useState<boolean>(false);

  return (
    <div
      style={{
        ...edgeBaseStyle,
        transform: edge.transform,
        backgroundColor: hovered ? 'rgba(255, 220, 100, 0.6)' : 'rgba(255, 255, 255, 0)',
        borderColor: hovered ? 'rgba(255, 220, 100, 0.9)' : 'rgba(255, 255, 255, 0)',
      }}
      title={edge.title}
      onMouseEnter={(): void => setHovered(true)}
      onMouseLeave={(): void => setHovered(false)}
      onClick={(e: React.MouseEvent): void => {
        e.stopPropagation();
        onViewClick(edge.cameraDir);
      }}
    />
  );
}

/** 角点元素 Props */
interface CornerElementProps {
  corner: CubeElement;
  onViewClick: (dir: [number, number, number]) => void;
}

/**
 * 角点元素组件
 * hover 时显示高亮，点击切换视角
 */
function CornerElement(props: CornerElementProps): React.ReactElement {
  const { corner, onViewClick } = props;
  const [hovered, setHovered] = useState<boolean>(false);

  return (
    <div
      style={{
        ...cornerBaseStyle,
        transform: corner.transform,
        backgroundColor: hovered ? 'rgba(255, 180, 50, 0.8)' : 'rgba(255, 255, 255, 0)',
        borderColor: hovered ? 'rgba(255, 180, 50, 1.0)' : 'rgba(255, 255, 255, 0)',
      }}
      title={corner.title}
      onMouseEnter={(): void => setHovered(true)}
      onMouseLeave={(): void => setHovered(false)}
      onClick={(e: React.MouseEvent): void => {
        e.stopPropagation();
        onViewClick(corner.cameraDir);
      }}
    />
  );
}

/* ========== 主组件 ========== */

/**
 * ViewCube 组件
 * 实时同步相机旋转，展示 CSS 3D 立方体
 * 支持点击面/边/角点切换到对应标准视图
 */
export function ViewCube(): React.ReactElement {
  const engine: Engine = useEngine();
  const [cssTransform, setCssTransform] = useState<string>('');
  const lastTransformRef: React.MutableRefObject<string> = useRef<string>('');

  /* 每帧读取相机旋转并更新 CSS 变换 */
  useFrame((): void => {
    const camera: THREE.Camera = engine.cameraManager.getActiveCamera();
    const newTransform: string = cameraRotationToCssTransform(camera);

    /* 仅在变换发生变化时更新状态，避免不必要的 React 重渲染 */
    if (newTransform !== lastTransformRef.current) {
      lastTransformRef.current = newTransform;
      setCssTransform(newTransform);
    }
  });

  /**
   * 统一的视角切换处理函数
   * 将方向向量归一化后，计算新相机位置并平滑过渡
   * @param dir - 相机方向向量（从目标点指向相机，未归一化）
   */
  // const handleViewClick: (dir: [number, number, number]) => void = useCallback(
  //   (dir: [number, number, number]): void => {
  const handleViewClick: (dir: [number, number, number], cameraUp?: [number, number, number]) => void = useCallback(
    (dir: [number, number, number], cameraUp?: [number, number, number]): void => {
      const camera: THREE.Camera = engine.cameraManager.getActiveCamera();
      const orbitControls = engine.cameraManager.getOrbitControls();

      if (orbitControls === null) {
        return;
      }

      /* 通过底层 OrbitControls 的 target 获取当前目标点 */
      const controls = orbitControls.getControls();
      const target: THREE.Vector3 = controls.target.clone();
      const currentPos: THREE.Vector3 = camera.position.clone();
      const distance: number = currentPos.distanceTo(target);

      /* 归一化方向向量，计算新的相机位置 = 目标点 + 方向 * 距离 */
      const normalizedDir: THREE.Vector3 = normalizeDir(dir);
      const newPos: THREE.Vector3 = new THREE.Vector3(
        target.x + normalizedDir.x * distance,
        target.y + normalizedDir.y * distance,
        target.z + normalizedDir.z * distance
      );

      // /* 顶视图和底视图（纯 Y 轴方向）需要略微偏移避免万向锁 */
      // if (dir[0] === 0 && dir[2] === 0) {
      //   newPos.x = target.x + 0.001;
      //   newPos.z = target.z + 0.001;
      // }
       /* 设置相机上方方向（避免万向锁） */
      if (cameraUp !== undefined) {
        camera.up.set(cameraUp[0], cameraUp[1], cameraUp[2]);
      }

      /* 使用平滑过渡切换视角（400ms） */
      orbitControls.transitionTo(newPos, target, 400).catch((): void => {
        /* 过渡被新操作打断，静默忽略 */
      });
    },
    [engine]
  );

  return (
    <div style={containerStyle}>
      <div
        style={{
          ...sceneStyle,
          transform: cssTransform,
        }}
      >
        {/* ===== 六个面 ===== */}
        {CUBE_FACES.map((face: CubeFace): React.ReactElement => (
          <div
            key={face.name}
            style={{
              ...faceBaseStyle,
              transform: face.transform,
              backgroundColor: face.bgColor,
            }}
            onClick={(): void => handleViewClick(face.cameraDir)}
            title={face.title}
          >
            <span style={{ display: 'inline-block', transform: 'scaleY(-1)' }}>
              {face.label}
            </span>
          </div>
        ))}

        {/* ===== 12 条边 ===== */}
        {CUBE_EDGES.map((edge: CubeElement): React.ReactElement => (
          <EdgeElement
            key={edge.name}
            edge={edge}
            onViewClick={handleViewClick}
          />
        ))}

        {/* ===== 8 个角点 ===== */}
        {CUBE_CORNERS.map((corner: CubeElement): React.ReactElement => (
          <CornerElement
            key={corner.name}
            corner={corner}
            onViewClick={handleViewClick}
          />
        ))}
      </div>
    </div>
  );
}
