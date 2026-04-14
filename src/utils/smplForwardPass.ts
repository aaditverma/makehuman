/**
 * SMPL Forward Pass — Pure TypeScript implementation.
 *
 * Computes SMPL mesh vertex positions from shape parameters (betas).
 * Forward pass: V = T + Σ(βᵢ × Sᵢ)
 *   T = template vertices (6890×3, mean shape)
 *   βᵢ = shape coefficients (10 values)
 *   Sᵢ = shape blend shapes (10 PCA components, each 6890×3)
 *
 * Pose is fixed to neutral — no pose blend shapes or skinning needed.
 */

/** Expected constants for the SMPL model */
export const SMPL_MAGIC = 0x534D504C; // "SMPL" in ASCII
export const SMPL_VERTEX_COUNT = 6890;
export const SMPL_FACE_COUNT = 13776;
export const SMPL_SHAPE_COUNT = 10;
export const SMPL_JOINT_COUNT = 24;
export const SMPL_HEADER_BYTES = 16;

/** SMPL model data loaded from binary asset */
export interface SmplModelData {
  templateVertices: Float32Array;   // 6890 × 3 = 20,670 floats (mean shape)
  shapeBlendShapes: Float32Array;   // 10 × 6890 × 3 = 206,700 floats (PCA components)
  faceIndices: Uint16Array;         // 13,776 × 3 = 41,328 (triangle connectivity)
  jointRegressor: Float32Array;     // 24 × 6890 (sparse, for joint locations)
  landmarkVertexIndices: Map<string, number>; // anatomical name → vertex index
}

/**
 * Parse the 16-byte SMPL binary header.
 * Layout:
 *   magic:         uint32 (4 bytes) — 0x534D504C
 *   version:       uint16 (2 bytes)
 *   vertexCount:   uint16 (2 bytes) — 6890
 *   faceCount:     uint16 (2 bytes) — 13776
 *   shapeCount:    uint16 (2 bytes) — 10
 *   landmarkCount: uint16 (2 bytes)
 *   reserved:      uint16 (2 bytes)
 */
interface SmplHeader {
  magic: number;
  version: number;
  vertexCount: number;
  faceCount: number;
  shapeCount: number;
  landmarkCount: number;
}

function parseHeader(view: DataView): SmplHeader {
  return {
    magic: view.getUint32(0, true),
    version: view.getUint16(4, true),
    vertexCount: view.getUint16(6, true),
    faceCount: view.getUint16(8, true),
    shapeCount: view.getUint16(10, true),
    landmarkCount: view.getUint16(12, true),
  };
}

function validateHeader(header: SmplHeader): void {
  if (header.magic !== SMPL_MAGIC) {
    throw new Error(
      `Invalid SMPL file: expected magic 0x${SMPL_MAGIC.toString(16).toUpperCase()}, ` +
      `got 0x${header.magic.toString(16).toUpperCase()}`
    );
  }
  if (header.vertexCount !== SMPL_VERTEX_COUNT) {
    throw new Error(
      `Invalid SMPL file: expected ${SMPL_VERTEX_COUNT} vertices, got ${header.vertexCount}`
    );
  }
  if (header.faceCount !== SMPL_FACE_COUNT) {
    throw new Error(
      `Invalid SMPL file: expected ${SMPL_FACE_COUNT} faces, got ${header.faceCount}`
    );
  }
  if (header.shapeCount !== SMPL_SHAPE_COUNT) {
    throw new Error(
      `Invalid SMPL file: expected ${SMPL_SHAPE_COUNT} shape components, got ${header.shapeCount}`
    );
  }
}

/**
 * Load SMPL model from a binary asset file.
 *
 * Binary layout after 16-byte header:
 *   Template vertices:    Float32[vertexCount × 3]
 *   Shape blend shapes:   Float32[shapeCount × vertexCount × 3]
 *   Face indices:         Uint16[faceCount × 3]
 *   Joint regressor:      Float32[24 × vertexCount]
 *   Landmark indices:     Uint16[landmarkCount × 2] — (vertexIndex, nameStringOffset) pairs
 *   Landmark name strings: null-terminated UTF-8 strings
 */
export async function loadSmplModel(url: string): Promise<SmplModelData> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch SMPL model from ${url}: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  return parseSmplBinary(buffer);
}

/**
 * Parse an SMPL binary buffer into SmplModelData.
 * Exported for testing with synthetic buffers.
 */
export function parseSmplBinary(buffer: ArrayBuffer): SmplModelData {
  const view = new DataView(buffer);

  if (buffer.byteLength < SMPL_HEADER_BYTES) {
    throw new Error(
      `Invalid SMPL file: buffer too small for header (${buffer.byteLength} bytes, need ${SMPL_HEADER_BYTES})`
    );
  }

  const header = parseHeader(view);
  validateHeader(header);

  const { vertexCount, faceCount, shapeCount, landmarkCount } = header;

  // Compute section byte offsets
  let offset = SMPL_HEADER_BYTES;

  const templateFloats = vertexCount * 3;
  const templateBytes = templateFloats * 4;
  const blendFloats = shapeCount * vertexCount * 3;
  const blendBytes = blendFloats * 4;
  const faceElements = faceCount * 3;
  const faceBytes = faceElements * 2;
  const jointFloats = SMPL_JOINT_COUNT * vertexCount;
  const jointBytes = jointFloats * 4;
  const landmarkPairElements = landmarkCount * 2;
  const landmarkPairBytes = landmarkPairElements * 2;

  const expectedMinSize = SMPL_HEADER_BYTES + templateBytes + blendBytes + faceBytes + jointBytes + landmarkPairBytes;
  if (buffer.byteLength < expectedMinSize) {
    throw new Error(
      `Invalid SMPL file: buffer too small (${buffer.byteLength} bytes, need at least ${expectedMinSize})`
    );
  }

  // Template vertices
  const templateVertices = new Float32Array(buffer, offset, templateFloats);
  offset += templateBytes;

  // Shape blend shapes
  const shapeBlendShapes = new Float32Array(buffer, offset, blendFloats);
  offset += blendBytes;

  // Face indices
  const faceIndices = new Uint16Array(buffer, offset, faceElements);
  offset += faceBytes;

  // Joint regressor
  const jointRegressor = new Float32Array(buffer, offset, jointFloats);
  offset += jointBytes;

  // Landmark indices — (vertexIndex, nameStringOffset) pairs
  const landmarkPairs = new Uint16Array(buffer, offset, landmarkPairElements);
  offset += landmarkPairBytes;

  // Landmark name strings — null-terminated UTF-8 after the pairs
  const stringTableStart = offset;
  const stringBytes = new Uint8Array(buffer, stringTableStart);
  const decoder = new TextDecoder('utf-8');

  const landmarkVertexIndices = new Map<string, number>();
  for (let i = 0; i < landmarkCount; i++) {
    const vertexIndex = landmarkPairs[i * 2];
    const nameOffset = landmarkPairs[i * 2 + 1];

    // Find null terminator
    let end = nameOffset;
    while (end < stringBytes.length && stringBytes[end] !== 0) {
      end++;
    }
    const name = decoder.decode(stringBytes.subarray(nameOffset, end));
    landmarkVertexIndices.set(name, vertexIndex);
  }

  return {
    templateVertices,
    shapeBlendShapes,
    faceIndices,
    jointRegressor,
    landmarkVertexIndices,
  };
}

/**
 * Compute SMPL mesh vertices from beta parameters.
 *
 * V = T + Σ(βᵢ × Sᵢ)
 *
 * Modifies outputVertices in place for zero-allocation updates.
 * Pose is fixed to neutral (no pose blend shapes or skinning).
 *
 * @param model - Loaded SMPL model data
 * @param betas - 10 shape coefficients (Float64Array)
 * @param outputVertices - Pre-allocated Float32Array of length 6890×3, written in place
 */
export function computeSmplVertices(
  model: SmplModelData,
  betas: Float64Array,
  outputVertices: Float32Array,
): void {
  const vertCount = SMPL_VERTEX_COUNT;
  const floatCount = vertCount * 3;

  // Start with template vertices
  outputVertices.set(model.templateVertices);

  // Accumulate shape blend shapes: V += βᵢ × Sᵢ
  const shapes = model.shapeBlendShapes;
  for (let i = 0; i < SMPL_SHAPE_COUNT; i++) {
    const beta = betas[i];
    if (beta === 0) continue; // skip zero contributions

    const shapeOffset = i * floatCount;
    for (let j = 0; j < floatCount; j++) {
      outputVertices[j] += beta * shapes[shapeOffset + j];
    }
  }
}

/**
 * Get a named landmark position from computed vertices.
 *
 * @param model - Loaded SMPL model data (contains landmark map)
 * @param vertices - Computed vertex positions (6890×3 Float32Array)
 * @param landmarkName - Anatomical landmark name (e.g. "left_shoulder")
 * @returns [x, y, z] position tuple, or null if landmark not found
 */
export function getSmplLandmark(
  model: SmplModelData,
  vertices: Float32Array,
  landmarkName: string,
): [number, number, number] | null {
  const vertexIndex = model.landmarkVertexIndices.get(landmarkName);
  if (vertexIndex === undefined) return null;

  const base = vertexIndex * 3;
  return [vertices[base], vertices[base + 1], vertices[base + 2]];
}
