/**
 * generate-placeholders.js
 * Writes minimal valid GLB files for pipeline testing:
 *   character-a.glb        → blue box (initial character)
 *   character-b.glb        → orange sphere (discovered character)
 *   character-a-altered.glb → purple cone (transformed character)
 *
 * No dependencies — uses only Node.js built-ins and raw GLB binary construction.
 * Run: node scripts/generate-placeholders.js
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'assets', 'models');
mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// GLB builder
// ---------------------------------------------------------------------------

/**
 * Pack a GLTF scene (positions + optional indices + base colour) into a GLB buffer.
 * @param {Float32Array} positions  flat [x,y,z, ...] vertex positions
 * @param {Uint16Array|null} indices triangle indices (null = non-indexed)
 * @param {[number,number,number,number]} baseColorFactor  RGBA 0-1
 * @returns {Buffer}
 */
function buildGLB(positions, indices, baseColorFactor) {
  // ---- binary buffer -------------------------------------------------------
  // Layout: [positions][indices (if any)]
  const posBytes = positions.buffer.byteLength;
  const idxBytes = indices ? indices.buffer.byteLength : 0;

  // Align indices to 4-byte boundary after positions
  const idxOffset = Math.ceil(posBytes / 4) * 4;
  const binLength = idxOffset + idxBytes;
  const binPadded = Math.ceil(binLength / 4) * 4;

  const bin = Buffer.alloc(binPadded, 0);
  Buffer.from(positions.buffer).copy(bin, 0);
  if (indices) Buffer.from(indices.buffer).copy(bin, idxOffset);

  // ---- accessors & bufferViews ---------------------------------------------
  const vertexCount = positions.length / 3;

  // Compute POSITION min/max (required by GLTF spec)
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const bufferViews = [
    { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 }, // ARRAY_BUFFER
  ];
  const accessors = [
    {
      bufferView: 0,
      byteOffset: 0,
      componentType: 5126, // FLOAT
      count: vertexCount,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    },
  ];

  const primitiveAttribs = { POSITION: 0 };
  const primitive = { attributes: primitiveAttribs, mode: 4 /* TRIANGLES */ };

  if (indices) {
    bufferViews.push({
      buffer: 0,
      byteOffset: idxOffset,
      byteLength: idxBytes,
      target: 34963, // ELEMENT_ARRAY_BUFFER
    });
    accessors.push({
      bufferView: 1,
      byteOffset: 0,
      componentType: 5123, // UNSIGNED_SHORT
      count: indices.length,
      type: 'SCALAR',
    });
    primitive.indices = 1;
  }

  // ---- material ------------------------------------------------------------
  const material = {
    pbrMetallicRoughness: {
      baseColorFactor,
      metallicFactor: 0.0,
      roughnessFactor: 0.8,
    },
  };
  primitive.material = 0;

  // ---- GLTF JSON -----------------------------------------------------------
  const gltf = {
    asset: { version: '2.0', generator: 'ar-narrative-placeholder-gen' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [primitive] }],
    materials: [material],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binPadded }],
  };

  const jsonStr = JSON.stringify(gltf);
  // Pad JSON to 4-byte boundary with spaces
  const jsonPadLen = Math.ceil(jsonStr.length / 4) * 4;
  const jsonBuf = Buffer.alloc(jsonPadLen, 0x20); // 0x20 = space
  Buffer.from(jsonStr, 'utf8').copy(jsonBuf);

  // ---- assemble GLB --------------------------------------------------------
  const totalLength = 12 + 8 + jsonPadLen + 8 + binPadded;
  const glb = Buffer.alloc(totalLength);
  let offset = 0;

  // Header
  glb.writeUInt32LE(0x46546C67, offset); offset += 4; // magic 'glTF'
  glb.writeUInt32LE(2, offset);          offset += 4; // version
  glb.writeUInt32LE(totalLength, offset); offset += 4; // total length

  // JSON chunk
  glb.writeUInt32LE(jsonPadLen, offset);   offset += 4;
  glb.writeUInt32LE(0x4E4F534A, offset);   offset += 4; // 'JSON'
  jsonBuf.copy(glb, offset);               offset += jsonPadLen;

  // BIN chunk
  glb.writeUInt32LE(binPadded, offset);    offset += 4;
  glb.writeUInt32LE(0x004E4942, offset);   offset += 4; // 'BIN\0'
  bin.copy(glb, offset);

  return glb;
}

// ---------------------------------------------------------------------------
// Geometry generators
// ---------------------------------------------------------------------------

/** Unit cube centred at origin, scaled to given size. */
function makeBox(w = 0.5, h = 0.5, d = 0.5) {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  // 24 vertices (4 per face) for correct flat normals
  // Faces: +Z, -Z, +X, -X, +Y, -Y
  const pos = new Float32Array([
    // +Z face
    -hw, -hh,  hd,  hw, -hh,  hd,  hw,  hh,  hd, -hw,  hh,  hd,
    // -Z face
     hw, -hh, -hd, -hw, -hh, -hd, -hw,  hh, -hd,  hw,  hh, -hd,
    // +X face
     hw, -hh,  hd,  hw, -hh, -hd,  hw,  hh, -hd,  hw,  hh,  hd,
    // -X face
    -hw, -hh, -hd, -hw, -hh,  hd, -hw,  hh,  hd, -hw,  hh, -hd,
    // +Y face
    -hw,  hh,  hd,  hw,  hh,  hd,  hw,  hh, -hd, -hw,  hh, -hd,
    // -Y face
    -hw, -hh, -hd,  hw, -hh, -hd,  hw, -hh,  hd, -hw, -hh,  hd,
  ]);
  const idx = new Uint16Array([
     0,  1,  2,   0,  2,  3,
     4,  5,  6,   4,  6,  7,
     8,  9, 10,   8, 10, 11,
    12, 13, 14,  12, 14, 15,
    16, 17, 18,  16, 18, 19,
    20, 21, 22,  20, 22, 23,
  ]);
  return { positions: pos, indices: idx };
}

/** UV sphere. rings = latitude bands, segments = longitude slices. */
function makeSphere(radius = 0.4, rings = 10, segments = 16) {
  const verts = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (Math.PI * r) / rings; // 0 → π
    for (let s = 0; s <= segments; s++) {
      const theta = (2 * Math.PI * s) / segments;
      verts.push(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
      );
    }
  }
  const pos = new Float32Array(verts);

  const idxArr = [];
  const w = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * w + s;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      idxArr.push(a, c, b, b, c, d);
    }
  }
  return { positions: pos, indices: new Uint16Array(idxArr) };
}

/** Cone: apex at top, base circle at bottom. */
function makeCone(radius = 0.35, height = 0.9, segments = 16) {
  const verts = [];
  const idxArr = [];

  const apex = [0, height / 2, 0];
  const baseY = -height / 2;

  // Side triangles: apex → base edge → next base edge
  for (let s = 0; s < segments; s++) {
    const t0 = (2 * Math.PI * s) / segments;
    const t1 = (2 * Math.PI * (s + 1)) / segments;
    const i = verts.length / 3;
    verts.push(...apex);
    verts.push(radius * Math.cos(t0), baseY, radius * Math.sin(t0));
    verts.push(radius * Math.cos(t1), baseY, radius * Math.sin(t1));
    idxArr.push(i, i + 1, i + 2);
  }

  // Base cap: fan from centre
  const baseCenter = verts.length / 3;
  verts.push(0, baseY, 0);
  const fanStart = verts.length / 3;
  for (let s = 0; s <= segments; s++) {
    const t = (2 * Math.PI * s) / segments;
    verts.push(radius * Math.cos(t), baseY, radius * Math.sin(t));
  }
  for (let s = 0; s < segments; s++) {
    idxArr.push(baseCenter, fanStart + s + 1, fanStart + s);
  }

  return { positions: new Float32Array(verts), indices: new Uint16Array(idxArr) };
}

// ---------------------------------------------------------------------------
// Generate files
// ---------------------------------------------------------------------------

const models = [
  {
    file: 'character-a.glb',
    label: 'BOX (character-a)',
    geo: makeBox(0.5, 0.8, 0.5),
    color: [0.2, 0.4, 0.9, 1.0], // blue
  },
  {
    file: 'character-b.glb',
    label: 'SPHERE (character-b)',
    geo: makeSphere(0.4, 12, 20),
    color: [0.9, 0.5, 0.1, 1.0], // orange
  },
  {
    file: 'character-a-altered.glb',
    label: 'CONE (character-a-altered)',
    geo: makeCone(0.35, 0.9, 20),
    color: [0.6, 0.1, 0.8, 1.0], // purple
  },
];

for (const { file, label, geo, color } of models) {
  const glb = buildGLB(geo.positions, geo.indices, color);
  const outPath = join(OUT_DIR, file);
  writeFileSync(outPath, glb);
  console.log(`✓ ${label} → ${outPath} (${glb.length} bytes)`);
}

console.log('\nAll placeholder models written to assets/models/');
