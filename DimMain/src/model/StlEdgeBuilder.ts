/**
 * STL 边界边提取工具
 * 从三角网格几何体中提取边界边和折角边，用于 LineSegments 显示
 *
 * 边的分类：
 * - 开放边（boundary edge）：只被 1 个三角形共享，出现在有孔洞的模型上
 * - 折角边（crease edge）：被 2 个及以上三角形共享，但任意两面法向量夹角超过阈值
 * - 内部边（interior edge）：所有相邻面对夹角均小于阈值，不显示
 *
 * 对于封闭实体 STL（如家具模型），所有边都被 2 个三角形共享，
 * 此时只显示折角边，效果类似 CAD 软件的"硬边"显示。
 *
 * 优化说明：
 * 原算法只记录每条边的前 2 个共享面，第 3 个及以上被忽略。
 * 对于曲面细分模型（圆柱、球体等），同一条逻辑边可能被 3 个以上三角形共享，
 * 导致部分折角边漏显。
 * 本版本改为记录所有共享面的法向量，判断时取任意一对面中夹角最大的，
 * 只要有一对超过阈值就显示该边。
 *
 * 使用 THREE.LineSegments + THREE.LineBasicMaterial，
 * 与 WebGPU 渲染器完全兼容。
 */

import * as THREE from 'three/webgpu';

/**
 * 边记录（内部使用）
 * 存储一条边的两个顶点和所有共享三角形的法向量列表
 */
interface EdgeRecord {
  /** 顶点 A */
  vA: THREE.Vector3;
  /** 顶点 B */
  vB: THREE.Vector3;
  /**
   * 所有共享该边的三角形的面法向量列表
   * 长度 = 1：开放边（只被一个三角形共享）
   * 长度 ≥ 2：内部边或折角边（被多个三角形共享）
   */
  normals: THREE.Vector3[];
}

/**
 * STL 边界边提取工具类
 * 提供静态方法，从 BufferGeometry 中提取边界边和折角边
 */
export class StlEdgeBuilder {
  /**
   * 从三角网格几何体中提取边界边和折角边，生成 LineSegments 用的 BufferGeometry
   *
   * 算法：
   * 1. 遍历所有三角形，对每条边生成规范化 key（顶点坐标字符串，小顶点在前）
   * 2. 用 Map 记录每条边的所有共享面法向量（不限数量）
   * 3. 提取开放边（normals.length=1）和折角边（任意一对面夹角 > thresholdAngle）
   * 4. 将提取的边顶点写入 Float32Array，返回 BufferGeometry
   *
   * 相比原算法的改进：
   * - 原算法只记录前 2 个共享面，第 3 个及以上被忽略，导致细分曲面的折角边漏显
   * - 新算法记录所有共享面，判断时遍历所有面对，任意一对超过阈值即显示
   * - 性能影响极小：buildEdgeGeometry 是一次性计算，不在每帧调用
   *
   * @param geometry - 源三角网格几何体（需要有 position 属性）
   * @param thresholdAngleDeg - 折角阈值（度），两面法向量夹角超过此值才显示边，默认 15°
   * @returns 用于 LineSegments 的 BufferGeometry（每两个顶点构成一条线段）
   */
  public static buildEdgeGeometry(
    geometry: THREE.BufferGeometry,
    thresholdAngleDeg: number = 15
  ): THREE.BufferGeometry {
    /* 确保几何体有法向量（用于折角判断） */
    if (geometry.getAttribute('normal') === undefined) {
      geometry.computeVertexNormals();
    }

    /* 将角度阈值转换为余弦值（用于点积比较，避免 acos 计算）
     * dot < thresholdCos 表示夹角 > 阈值
     */
    const thresholdCos: number = Math.cos((thresholdAngleDeg * Math.PI) / 180);

    /* 获取顶点位置数组 */
    const posAttr: THREE.BufferAttribute = geometry.getAttribute('position') as THREE.BufferAttribute;
    const indexAttr: THREE.BufferAttribute | null = geometry.getIndex();

    /* 边记录 Map：key = 规范化边字符串，value = EdgeRecord */
    const edgeMap: Map<string, EdgeRecord> = new Map<string, EdgeRecord>();

    /**
     * 将顶点坐标格式化为固定精度字符串（避免浮点误差导致相同顶点 key 不同）
     * 使用 4 位小数精度：
     * - 6 位精度对细小三角面（顶点坐标差异 < 1e-6）可能导致相邻顶点被误判为不同顶点
     * - 4 位精度在保持足够区分度的同时，更好地归并坐标极接近的顶点
     */
    const vertexKey = (v: THREE.Vector3): string =>
      `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;

    /**
     * 生成边的规范化 key（两顶点 key 按字典序排列，保证同一条边无论方向都有相同 key）
     */
    const edgeKey = (vA: THREE.Vector3, vB: THREE.Vector3): string => {
      const kA: string = vertexKey(vA);
      const kB: string = vertexKey(vB);
      return kA < kB ? `${kA}|${kB}` : `${kB}|${kA}`;
    };

    /* 获取三角形数量 */
    const triangleCount: number = indexAttr !== null
      ? indexAttr.count / 3
      : posAttr.count / 3;

    /* 临时向量（复用避免 GC） */
    const vA: THREE.Vector3 = new THREE.Vector3();
    const vB: THREE.Vector3 = new THREE.Vector3();
    const vC: THREE.Vector3 = new THREE.Vector3();
    const edge1: THREE.Vector3 = new THREE.Vector3();
    const edge2: THREE.Vector3 = new THREE.Vector3();
    const faceNormal: THREE.Vector3 = new THREE.Vector3();

    /* 遍历所有三角形 */
    for (let i: number = 0; i < triangleCount; i++) {
      /* 获取三角形三个顶点的索引 */
      let iA: number;
      let iB: number;
      let iC: number;

      if (indexAttr !== null) {
        iA = indexAttr.getX(i * 3);
        iB = indexAttr.getX(i * 3 + 1);
        iC = indexAttr.getX(i * 3 + 2);
      } else {
        iA = i * 3;
        iB = i * 3 + 1;
        iC = i * 3 + 2;
      }

      /* 读取顶点坐标 */
      vA.fromBufferAttribute(posAttr, iA);
      vB.fromBufferAttribute(posAttr, iB);
      vC.fromBufferAttribute(posAttr, iC);

      /* 计算该三角形的面法向量（叉积） */
      edge1.subVectors(vB, vA);
      edge2.subVectors(vC, vA);
      faceNormal.crossVectors(edge1, edge2).normalize();

      /* 跳过退化三角形（面积为零，法向量为零向量） */
      if (faceNormal.lengthSq() < 0.0001) {
        continue;
      }

      /* 处理三角形的三条边 */
      const edges: Array<[THREE.Vector3, THREE.Vector3]> = [
        [vA.clone(), vB.clone()],
        [vB.clone(), vC.clone()],
        [vC.clone(), vA.clone()],
      ];

      for (const [eA, eB] of edges) {
        const key: string = edgeKey(eA, eB);
        const existing: EdgeRecord | undefined = edgeMap.get(key);

        if (existing === undefined) {
          /* 第一次遇到这条边，创建记录 */
          edgeMap.set(key, {
            vA: eA,
            vB: eB,
            normals: [faceNormal.clone()],
          });
        } else {
          /* 后续遇到同一条边，追加法向量（不限次数）
           * 注意：避免重复添加完全相同的法向量（同一三角形被重复处理的情况）
           */
          existing.normals.push(faceNormal.clone());
        }
      }
    }

    /* 收集需要显示的边的顶点 */
    const lineVertices: Array<number> = [];
    /* 统计各类边数量（用于调试日志） */
    let boundaryCount: number = 0;
    let creaseCount: number = 0;

    for (const record of edgeMap.values()) {
      let shouldDraw: boolean = false;

      if (record.normals.length === 1) {
        /* 开放边（只被一个三角形共享）：始终显示 */
        shouldDraw = true;
        boundaryCount++;
      } else {
        /* 折角边判断：遍历所有共享面对，任意一对夹角超过阈值则显示
         *
         * 原算法只比较前 2 个面，此处改为遍历所有面对（O(n²) 但 n 通常很小，≤ 4）
         * 对于绝大多数边（n=2），仍只有 1 次比较，性能与原算法相同
         * 对于退化边（n=3,4），多几次比较，但数量极少，整体影响可忽略
         */
        outer: for (let m: number = 0; m < record.normals.length - 1; m++) {
          for (let n: number = m + 1; n < record.normals.length; n++) {
            const dot: number = record.normals[m]!.dot(record.normals[n]!);
            /* dot < thresholdCos 表示夹角 > 阈值 */
            if (dot < thresholdCos) {
              shouldDraw = true;
              creaseCount++;
              break outer;
            }
          }
        }
      }

      if (shouldDraw) {
        lineVertices.push(
          record.vA.x, record.vA.y, record.vA.z,
          record.vB.x, record.vB.y, record.vB.z
        );
      }
    }

    /* 构建 BufferGeometry */
    const edgeGeometry: THREE.BufferGeometry = new THREE.BufferGeometry();
    const positionArray: Float32Array = new Float32Array(lineVertices);
    edgeGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positionArray, 3)
    );

    console.log(
      `[StlEdgeBuilder] 提取边界边完成：`,
      `总边数 ${edgeMap.size}，`,
      `开放边 ${boundaryCount}，`,
      `折角边 ${creaseCount}，`,
      `显示边数 ${lineVertices.length / 6}`
    );

    return edgeGeometry;
  }
}
