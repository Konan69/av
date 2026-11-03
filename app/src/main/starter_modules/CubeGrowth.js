/*
@nwWrld name: CubeGrowth
@nwWrld category: 3D
@nwWrld imports: BaseThreeJsModule, THREE, Noise
*/

const FACE_ROTATIONS = [
  [0, 0],
  [90, 0],
  [180, 0],
  [-90, 0],
  [90, 90],
  [90, -90],
];

const CUBE_VERTICES = [
  [-0.5, -0.5, -0.5],
  [0.5, -0.5, -0.5],
  [0.5, 0.5, -0.5],
  [-0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5],
  [0.5, -0.5, 0.5],
  [0.5, 0.5, 0.5],
  [-0.5, 0.5, 0.5],
];

const CUBE_EDGES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const hashSeed = (input) => {
  const text = String(input || "");
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
};

const createRng = (seedValue) => {
  let state = seedValue >>> 0 || 1;
  return {
    next() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    },
    range(min, max) {
      return min + (max - min) * this.next();
    },
  };
};

const disposeMaterial = (material) => {
  if (!material) return;
  if (Array.isArray(material)) {
    material.forEach((entry) => entry && entry.dispose && entry.dispose());
    return;
  }
  if (material.dispose) material.dispose();
};

const clearThreeGroup = (group) => {
  if (!group) return;
  group.traverse((child) => {
    if (child === group) return;
    if (child.geometry && child.geometry.dispose) child.geometry.dispose();
    disposeMaterial(child.material);
  });
  group.clear();
};

class CubeGrowth extends BaseThreeJsModule {
  static methods = [
    ...BaseThreeJsModule.methods,
    {
      name: "regenerate",
      executeOnLoad: false,
      options: [{ name: "seed", defaultVal: "", type: "text" }],
    },
  ];

  constructor(container) {
    super(container);
    if (!THREE || !Noise) return;

    this.name = CubeGrowth.name;
    this.customGroup = new THREE.Group();
    this.occluderMesh = null;
    this.edgeLines = null;
    this.seedValue = "";
    this.rng = null;
    this.noise = null;
    this.maxBoxes = 1600;

    this.regenerate = this.regenerate.bind(this);

    this.init();
  }

  init() {
    if (this.destroyed) return;

    this.regenerate();
  }

  regenerate({ seed = "" } = {}) {
    if (this.destroyed) return;

    this.seedValue =
      typeof seed === "string" && seed.trim()
        ? seed.trim()
        : Math.floor(Math.random() * 1e9).toString(36);

    const rngSeed = hashSeed(this.seedValue);
    this.rng = createRng(rngSeed);
    this.noise = new Noise(this.rng.next());

    clearThreeGroup(this.customGroup);

    const cubes = this.buildCubes();
    this.centerCubes(cubes);
    this.normalizeCubeScale(cubes);
    const matrices = cubes.map((cube) => cube.matrix);
    this.buildInstancedOccluders(matrices);
    this.buildEdgeLines(matrices);

    if (!this.model) this.setModel(this.customGroup);

    this.modelBoundingBox = new THREE.Box3().setFromObject(this.customGroup);
    this.modelCenter = new THREE.Vector3(0, 0, 0);
    const size = this.modelBoundingBox.getSize(new THREE.Vector3());
    this.modelSize = Math.max(size.x, size.y, size.z);
    this.configureCamera();
    this.controls.target.copy(this.modelCenter);
    this.controls.update();
    this.render();
  }

  buildCubes() {
    const root = new THREE.Matrix4()
      .makeRotationX(this.rng.range(-Math.PI, Math.PI))
      .multiply(new THREE.Matrix4().makeRotationY(this.rng.range(-Math.PI, Math.PI)));

    const cubes = [];
    const columns = 2;
    const offset = 0.5 * columns - 0.5;

    FACE_ROTATIONS.forEach(([rxDeg, ryDeg]) => {
      const face = root.clone();
      face.multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(ryDeg)));
      face.multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(rxDeg)));
      face.multiply(new THREE.Matrix4().makeTranslation(-offset, -0.5 * columns, -offset));

      for (let ix = 0; ix < columns; ix++) {
        for (let iy = 0; iy < columns; iy++) {
          const cell = face.clone().multiply(new THREE.Matrix4().makeTranslation(ix, 0, iy));
          const width = this.rng.range(0.95, 1.0);
          const height = 0.2;
          const maxLevel = Math.floor(this.rng.range(4, 6));
          this.buildUnit(cubes, cell, width, height, 1, maxLevel);
        }
      }
    });

    return cubes;
  }

  buildUnit(cubes, matrix, width, height, level, maxLevel) {
    if (level >= maxLevel || cubes.length >= this.maxBoxes) return;

    const center = matrix
      .clone()
      .multiply(new THREE.Matrix4().makeTranslation(0, -0.5 * height, 0));
    const cube = center.clone().multiply(new THREE.Matrix4().makeScale(width, height, width));
    cubes.push({ matrix: cube, width, height, level });

    const childBase = matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, -height, 0));

    for (let i = 0; i < 4; i++) {
      if (cubes.length >= this.maxBoxes) return;

      const width2 = width * 0.5 * this.rng.range(0.9, 1);
      const noiseHeight = this.rnoise(this.rng.range(0, 10));
      if (noiseHeight <= 0) continue;

      const height2 = height * this.rng.range(0.1, 1.2) * noiseHeight;
      if (height2 <= 0.01) continue;

      const dx = width * 0.5 * (Math.floor(i / 2) - 0.5);
      const dz = width * 0.5 * ((i & 1) - 0.5);
      let nextMaxLevel = maxLevel + Math.floor(this.rng.range(-1, 1.1));
      if (nextMaxLevel < level + 1) nextMaxLevel = level + 1;

      const child = childBase.clone().multiply(new THREE.Matrix4().makeTranslation(dx, 0, dz));
      this.buildUnit(cubes, child, width2, height2, level + 1, nextMaxLevel);
    }
  }

  centerCubes(cubes) {
    if (!Array.isArray(cubes) || cubes.length === 0) return;

    const center = new THREE.Vector3();
    let totalWeight = 0;

    cubes.forEach((cube) => {
      const matrix = cube?.matrix;
      const width = Number(cube?.width) || 0;
      const level = Number(cube?.level) || 1;
      if (!matrix) return;

      const weight = Math.max((width * width) / level, 0.0001);
      center.x += matrix.elements[12] * weight;
      center.y += matrix.elements[13] * weight;
      center.z += matrix.elements[14] * weight;
      totalWeight += weight;
    });

    if (!totalWeight) return;

    center.multiplyScalar(1 / totalWeight);
    const offset = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);

    cubes.forEach((cube) => {
      cube.matrix.premultiply(offset);
    });
  }

  normalizeCubeScale(cubes) {
    if (!Array.isArray(cubes) || cubes.length === 0) return;

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    cubes.forEach((cube) => {
      const e = cube?.matrix?.elements;
      if (!e) return;
      if (e[12] < minX) minX = e[12];
      if (e[12] > maxX) maxX = e[12];
      if (e[13] < minY) minY = e[13];
      if (e[13] > maxY) maxY = e[13];
      if (e[14] < minZ) minZ = e[14];
      if (e[14] > maxZ) maxZ = e[14];
    });

    const maxExtent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    if (maxExtent < 0.0001) return;

    const TARGET_EXTENT = 3.5;
    const factor = TARGET_EXTENT / maxExtent;
    const scaleM = new THREE.Matrix4().makeScale(factor, factor, factor);

    cubes.forEach((cube) => {
      cube.matrix.premultiply(scaleM);
    });
  }

  rnoise(x) {
    const base = this.noise ? 0.5 + 0.5 * this.noise.perlin2(x, 0) : 0.5;
    return clamp(base * 5 - 0.2, 0, 1);
  }

  buildInstancedOccluders(matrices) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0x000000 });
    material.colorWrite = false;
    material.depthWrite = true;
    material.depthTest = true;

    this.occluderMesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    this.occluderMesh.frustumCulled = false;

    matrices.forEach((matrix, index) => {
      this.occluderMesh.setMatrixAt(index, matrix);
    });

    this.occluderMesh.instanceMatrix.needsUpdate = true;
    this.customGroup.add(this.occluderMesh);
  }

  buildEdgeLines(matrices) {
    const positions = new Float32Array(matrices.length * CUBE_EDGES.length * 6);
    const transformed = new Float32Array(8 * 3);
    let cursor = 0;

    matrices.forEach((matrix) => {
      CUBE_VERTICES.forEach(([x, y, z], index) => {
        const offset = index * 3;
        this.transformPoint(transformed, offset, matrix, x, y, z);
      });

      CUBE_EDGES.forEach(([a, b]) => {
        const aIndex = a * 3;
        const bIndex = b * 3;

        positions[cursor++] = transformed[aIndex];
        positions[cursor++] = transformed[aIndex + 1];
        positions[cursor++] = transformed[aIndex + 2];
        positions[cursor++] = transformed[bIndex];
        positions[cursor++] = transformed[bIndex + 1];
        positions[cursor++] = transformed[bIndex + 2];
      });
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthTest: true,
      depthWrite: false,
    });

    this.edgeLines = new THREE.LineSegments(geometry, material);
    this.edgeLines.frustumCulled = false;
    this.customGroup.add(this.edgeLines);
  }

  transformPoint(out, offset, matrix, x, y, z) {
    const elements = matrix.elements;
    out[offset] = elements[0] * x + elements[4] * y + elements[8] * z + elements[12];
    out[offset + 1] = elements[1] * x + elements[5] * y + elements[9] * z + elements[13];
    out[offset + 2] = elements[2] * x + elements[6] * y + elements[10] * z + elements[14];
  }

  destroy() {
    if (this.destroyed) return;
    clearThreeGroup(this.customGroup);
    this.occluderMesh = null;
    this.edgeLines = null;
    this.rng = null;
    this.noise = null;
    super.destroy();
  }
}

export default CubeGrowth;
