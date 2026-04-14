/**
 * Property-based tests for smplForwardPass.ts — Tasks 1.2, 1.3, 11.5
 *
 * Property 1: SMPL forward pass topology and coordinate invariant
 * Property 2 (existing): SMPL forward pass numerical equivalence (determinism + zero-beta identity)
 * Property 2 (mesh validity): Forward pass mesh validity — finite vertices, positive bounding box, bounded distance
 *
 * Uses fast-check for property-based testing.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseSmplBinary,
  computeSmplVertices,
  SMPL_MAGIC,
  SMPL_VERTEX_COUNT,
  SMPL_FACE_COUNT,
  SMPL_SHAPE_COUNT,
  SMPL_JOINT_COUNT,
  SMPL_HEADER_BYTES,
} from '../smplForwardPass';

/* ------------------------------------------------------------------ */
/*  Helper: build a valid SMPL binary buffer for testing               */
/* ------------------------------------------------------------------ */

const TEST_LANDMARKS = ['left_shoulder', 'right_shoulder', 'navel'];

function buildTestSmplBinary(): ArrayBuffer {
  const vertexCount = SMPL_VERTEX_COUNT;
  const faceCount = SMPL_FACE_COUNT;
  const shapeCount = SMPL_SHAPE_COUNT;
  const landmarkCount = TEST_LANDMARKS.length;

  const encoder = new TextEncoder();
  const nameBuffers = TEST_LANDMARKS.map(n => encoder.encode(n));
  let stringTableSize = 0;
  const nameOffsets: number[] = [];
  for (const buf of nameBuffers) {
    nameOffsets.push(stringTableSize);
    stringTableSize += buf.length + 1;
  }

  const templateFloats = vertexCount * 3;
  const blendFloats = shapeCount * vertexCount * 3;
  const faceElements = faceCount * 3;
  const jointFloats = SMPL_JOINT_COUNT * vertexCount;
  const landmarkPairElements = landmarkCount * 2;

  const totalBytes =
    SMPL_HEADER_BYTES +
    templateFloats * 4 +
    blendFloats * 4 +
    faceElements * 2 +
    jointFloats * 4 +
    landmarkPairElements * 2 +
    stringTableSize;

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  let offset = 0;

  view.setUint32(offset, SMPL_MAGIC, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, vertexCount, true); offset += 2;
  view.setUint16(offset, faceCount, true); offset += 2;
  view.setUint16(offset, shapeCount, true); offset += 2;
  view.setUint16(offset, landmarkCount, true); offset += 2;
  view.setUint16(offset, 0, true); offset += 2;

  // Template vertices: Y-up body shape
  for (let i = 0; i < vertexCount; i++) {
    const t = i / vertexCount;
    const x = Math.sin(t * Math.PI * 20) * 0.15;
    const y = t * 1.7;
    const z = Math.cos(t * Math.PI * 20) * 0.12;
    view.setFloat32(offset, x, true); offset += 4;
    view.setFloat32(offset, y, true); offset += 4;
    view.setFloat32(offset, z, true); offset += 4;
  }

  // Shape blend shapes: small perturbations
  for (let i = 0; i < blendFloats; i++) {
    view.setFloat32(offset, 0.001, true);
    offset += 4;
  }

  // Face indices
  for (let i = 0; i < faceElements; i++) {
    view.setUint16(offset, i % vertexCount, true);
    offset += 2;
  }

  // Joint regressor
  for (let i = 0; i < jointFloats; i++) {
    view.setFloat32(offset, 0, true);
    offset += 4;
  }

  // Landmark pairs
  const landmarkVertexIndices = [3011, 6470, 3500];
  for (let i = 0; i < landmarkCount; i++) {
    view.setUint16(offset, landmarkVertexIndices[i], true); offset += 2;
    view.setUint16(offset, nameOffsets[i], true); offset += 2;
  }

  // String table
  const strBytes = new Uint8Array(buffer, offset);
  let strOffset = 0;
  for (const buf of nameBuffers) {
    strBytes.set(buf, strOffset);
    strOffset += buf.length;
    strBytes[strOffset] = 0;
    strOffset += 1;
  }

  return buffer;
}

/* ------------------------------------------------------------------ */
/*  Shared model for property tests                                    */
/* ------------------------------------------------------------------ */

const testBuffer = buildTestSmplBinary();
const testModel = parseSmplBinary(testBuffer);
// Pre-allocate output buffers to avoid repeated allocation
const output = new Float32Array(SMPL_VERTEX_COUNT * 3);

/* ------------------------------------------------------------------ */
/*  Property 1: SMPL forward pass topology and coordinate invariant    */
/* ------------------------------------------------------------------ */

describe('Property 1: SMPL forward pass topology and coordinate invariant', () => {
  /**
   * **Validates: Requirements 1.2, 1.6**
   *
   * For any SMPL beta vector with components in [-3, 3], the forward pass
   * SHALL produce exactly 6,890 vertices and 13,776 triangular faces,
   * with vertex positions in Y-up convention (feet near Y=0, centroid near X=0/Z=0).
   */
  it('produces correct vertex/face counts and Y-up coordinates for random betas', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -3, max: 3, noNaN: true, noDefaultInfinity: true }), { minLength: 10, maxLength: 10 }),
        (betaArr) => {
          const betas = new Float64Array(betaArr);
          computeSmplVertices(testModel, betas, output);

          // Vertex count: output has 6890 * 3 floats
          if (output.length !== SMPL_VERTEX_COUNT * 3) return false;

          // Face count: model has 13776 * 3 indices
          if (testModel.faceIndices.length !== SMPL_FACE_COUNT * 3) return false;

          // All vertices should be finite + compute stats in one pass
          let minY = Infinity, maxY = -Infinity;
          let sumX = 0, sumZ = 0;
          for (let i = 0; i < SMPL_VERTEX_COUNT; i++) {
            const x = output[i * 3];
            const y = output[i * 3 + 1];
            const z = output[i * 3 + 2];
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            sumX += x;
            sumZ += z;
          }

          const centroidX = sumX / SMPL_VERTEX_COUNT;
          const centroidZ = sumZ / SMPL_VERTEX_COUNT;

          // Feet near Y=0 (within 1m given small blend shapes)
          if (Math.abs(minY) >= 1.0) return false;
          // Centroid near X=0 and Z=0
          if (Math.abs(centroidX) >= 1.0) return false;
          if (Math.abs(centroidZ) >= 1.0) return false;

          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
}, 30000);

/* ------------------------------------------------------------------ */
/*  Property 2: SMPL forward pass numerical equivalence                */
/* ------------------------------------------------------------------ */

describe('Property 2: SMPL forward pass numerical equivalence (determinism + zero-beta identity)', () => {
  /**
   * **Validates: Requirements 3.3**
   *
   * Since we don't have Python reference outputs yet, we verify:
   * 1. Zero-beta produces template mesh exactly
   * 2. The forward pass is deterministic (same betas → same output)
   */
  it('zero-beta produces template mesh exactly', () => {
    const betas = new Float64Array(SMPL_SHAPE_COUNT);
    const out = new Float32Array(SMPL_VERTEX_COUNT * 3);
    computeSmplVertices(testModel, betas, out);

    for (let i = 0; i < out.length; i++) {
      if (out[i] !== testModel.templateVertices[i]) {
        expect(out[i]).toBe(testModel.templateVertices[i]);
      }
    }
  });

  it('forward pass is deterministic: same betas produce identical output', () => {
    const out1 = new Float32Array(SMPL_VERTEX_COUNT * 3);
    const out2 = new Float32Array(SMPL_VERTEX_COUNT * 3);

    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -3, max: 3, noNaN: true, noDefaultInfinity: true }), { minLength: 10, maxLength: 10 }),
        (betaArr) => {
          const betas = new Float64Array(betaArr);
          computeSmplVertices(testModel, betas, out1);
          computeSmplVertices(testModel, betas, out2);

          // Compare using typed array — fast path
          for (let i = 0; i < out1.length; i++) {
            if (out1[i] !== out2[i]) return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });
}, 30000);


/* ------------------------------------------------------------------ */
/*  Property 2: Forward pass mesh validity                             */
/* ------------------------------------------------------------------ */

describe('Property 2: Forward pass mesh validity', () => {
  /**
   * **Validates: Requirements 1.4**
   *
   * For any 10-element beta vector in [-3, 3], verify the forward pass produces:
   * - All finite vertices (no NaN or Infinity)
   * - Positive bounding box volume (maxY - minY > 0.5m)
   * - No vertex more than 3m from the origin
   */
  it('produces finite vertices, positive bounding box height, and bounded distance from origin', () => {
    const out = new Float32Array(SMPL_VERTEX_COUNT * 3);

    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -3, max: 3, noNaN: true, noDefaultInfinity: true }), { minLength: 10, maxLength: 10 }),
        (betaArr) => {
          const betas = new Float64Array(betaArr);
          computeSmplVertices(testModel, betas, out);

          let minY = Infinity, maxY = -Infinity;

          for (let i = 0; i < SMPL_VERTEX_COUNT; i++) {
            const x = out[i * 3];
            const y = out[i * 3 + 1];
            const z = out[i * 3 + 2];

            // All vertices must be finite
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
              expect.fail(`Vertex ${i} has non-finite values: (${x}, ${y}, ${z})`);
            }

            // No vertex more than 3m from origin
            const dist = Math.sqrt(x * x + y * y + z * z);
            if (dist > 3.0) {
              expect.fail(`Vertex ${i} is ${dist.toFixed(3)}m from origin, exceeds 3m limit`);
            }

            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }

          // Bounding box height must be > 0.5m
          const height = maxY - minY;
          if (height <= 0.5) {
            expect.fail(`Bounding box height ${height.toFixed(3)}m is <= 0.5m`);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
}, 30000);


/* ------------------------------------------------------------------ */
/*  Helper: build a valid SMPL binary with configurable shapeCount     */
/* ------------------------------------------------------------------ */

/**
 * Build a synthetic SMPL binary with a given shapeCount.
 * Template vertices and blend shapes are filled with deterministic values
 * derived from indices so that manual verification is possible.
 */
function buildTestSmplBinaryN(shapeCount: number, opts?: {
  templateFill?: (idx: number) => number;
  shapeFill?: (shapeIdx: number, floatIdx: number) => number;
}): ArrayBuffer {
  const vertexCount = SMPL_VERTEX_COUNT;
  const faceCount = SMPL_FACE_COUNT;
  const landmarkCount = TEST_LANDMARKS.length;

  const encoder = new TextEncoder();
  const nameBuffers = TEST_LANDMARKS.map(n => encoder.encode(n));
  let stringTableSize = 0;
  const nameOffsets: number[] = [];
  for (const buf of nameBuffers) {
    nameOffsets.push(stringTableSize);
    stringTableSize += buf.length + 1;
  }

  const templateFloats = vertexCount * 3;
  const blendFloats = shapeCount * vertexCount * 3;
  const faceElements = faceCount * 3;
  const jointFloats = SMPL_JOINT_COUNT * vertexCount;
  const landmarkPairElements = landmarkCount * 2;

  const totalBytes =
    SMPL_HEADER_BYTES +
    templateFloats * 4 +
    blendFloats * 4 +
    faceElements * 2 +
    jointFloats * 4 +
    landmarkPairElements * 2 +
    stringTableSize;

  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  let offset = 0;

  // Header
  view.setUint32(offset, SMPL_MAGIC, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, vertexCount, true); offset += 2;
  view.setUint16(offset, faceCount, true); offset += 2;
  view.setUint16(offset, shapeCount, true); offset += 2;
  view.setUint16(offset, landmarkCount, true); offset += 2;
  view.setUint16(offset, 0, true); offset += 2;

  // Template vertices
  const tFill = opts?.templateFill ?? (() => 0.5);
  for (let i = 0; i < templateFloats; i++) {
    view.setFloat32(offset, tFill(i), true);
    offset += 4;
  }

  // Shape blend shapes
  const sFill = opts?.shapeFill ?? (() => 0.001);
  for (let s = 0; s < shapeCount; s++) {
    for (let j = 0; j < vertexCount * 3; j++) {
      view.setFloat32(offset, sFill(s, j), true);
      offset += 4;
    }
  }

  // Face indices
  for (let i = 0; i < faceElements; i++) {
    view.setUint16(offset, i % vertexCount, true);
    offset += 2;
  }

  // Joint regressor
  for (let i = 0; i < jointFloats; i++) {
    view.setFloat32(offset, 0, true);
    offset += 4;
  }

  // Landmark pairs
  const landmarkVertexIndices = [3011, 6470, 3500];
  for (let i = 0; i < landmarkCount; i++) {
    view.setUint16(offset, landmarkVertexIndices[i], true); offset += 2;
    view.setUint16(offset, nameOffsets[i], true); offset += 2;
  }

  // String table
  const strBytes = new Uint8Array(buffer, offset);
  let strOffset = 0;
  for (const buf of nameBuffers) {
    strBytes.set(buf, strOffset);
    strOffset += buf.length;
    strBytes[strOffset] = 0;
    strOffset += 1;
  }

  return buffer;
}

/* ------------------------------------------------------------------ */
/*  Property: Binary parse round-trip — shapeCount preserved           */
/* ------------------------------------------------------------------ */

describe('Property: Binary parse round-trip — shapeCount preserved', () => {
  /**
   * **Validates: Requirements 1.2, 2.1, 3.1**
   *
   * For all N in [1, 50], constructing a synthetic SMPL binary with
   * shapeCount = N and parsing it via parseSmplBinary() produces a
   * SmplModelData where model.shapeCount === N and
   * model.shapeBlendShapes.length === N × 6890 × 3.
   */
  it('parsed model has correct shapeCount and blend shape array length for random N', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        (n) => {
          const buffer = buildTestSmplBinaryN(n);
          const model = parseSmplBinary(buffer);

          expect(model.shapeCount).toBe(n);
          expect(model.shapeBlendShapes.length).toBe(n * SMPL_VERTEX_COUNT * 3);
        },
      ),
      { numRuns: 50 },
    );
  });
}, 60000);

/* ------------------------------------------------------------------ */
/*  Property: Forward pass min(betas, shapeCount)                      */
/* ------------------------------------------------------------------ */

describe('Property: Forward pass min(betas, shapeCount)', () => {
  /**
   * **Validates: Requirements 3.2, 3.5, 3.6**
   *
   * For random N-PC model and M-length betas, verify output matches
   * manual T + Σ(βᵢ × Sᵢ) for i = 0..min(N,M)-1.
   */
  it('output matches manual computation for random N-PC model and M-length betas', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        fc.array(fc.double({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true }), { minLength: 1, maxLength: 50 }),
        (shapeCountN, _betaLenHint, betaArr) => {
          // Use a small vertex subset for speed — we use the full model but verify a sample
          const templateVal = 1.0;
          const shapeVal = 0.01;
          const buffer = buildTestSmplBinaryN(shapeCountN, {
            templateFill: () => templateVal,
            shapeFill: (s, _j) => shapeVal * (s + 1), // each shape has a distinct scale
          });
          const model = parseSmplBinary(buffer);

          const M = betaArr.length;
          const betas = new Float64Array(M);
          betas.set(betaArr);

          const out = new Float32Array(SMPL_VERTEX_COUNT * 3);
          computeSmplVertices(model, betas, out);

          // Manual computation: T + Σ(βᵢ × Sᵢ) for i = 0..min(N,M)-1
          const numShapes = Math.min(shapeCountN, M);
          const floatCount = SMPL_VERTEX_COUNT * 3;

          // Check a sample of vertices (first 10, last 10, middle 10)
          const sampleIndices = [
            ...Array.from({ length: 10 }, (_, i) => i),
            ...Array.from({ length: 10 }, (_, i) => Math.floor(floatCount / 2) + i),
            ...Array.from({ length: 10 }, (_, i) => floatCount - 10 + i),
          ];

          for (const j of sampleIndices) {
            let expected = templateVal; // T[j]
            for (let i = 0; i < numShapes; i++) {
              expected += betas[i] * shapeVal * (i + 1); // βᵢ × Sᵢ[j]
            }
            // Float32 precision: compare with tolerance
            expect(out[j]).toBeCloseTo(expected, 3);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
}, 60000);

/* ------------------------------------------------------------------ */
/*  Property: Backward compatibility — 10-PC identity                  */
/* ------------------------------------------------------------------ */

describe('Property: Backward compatibility — 10-PC identity', () => {
  /**
   * **Validates: Requirements 10.1, 10.2**
   *
   * For random 10-element betas with a 10-PC model, verify the new
   * generalized code produces identical output (within 1e-6) to the
   * reference implementation (hardcoded 10-shape loop).
   */
  it('10-PC model produces identical output to reference implementation', () => {
    // Build a 10-PC model with deterministic but non-trivial data
    const buffer = buildTestSmplBinaryN(10, {
      templateFill: (idx) => Math.sin(idx * 0.1) * 0.5,
      shapeFill: (s, j) => Math.cos((s * 1000 + j) * 0.01) * 0.002,
    });
    const model = parseSmplBinary(buffer);

    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -3, max: 3, noNaN: true, noDefaultInfinity: true }), { minLength: 10, maxLength: 10 }),
        (betaArr) => {
          const betas = new Float64Array(betaArr);
          const floatCount = SMPL_VERTEX_COUNT * 3;

          // New implementation
          const outNew = new Float32Array(floatCount);
          computeSmplVertices(model, betas, outNew);

          // Reference implementation (hardcoded 10-shape loop)
          const outRef = new Float32Array(floatCount);
          outRef.set(model.templateVertices);
          const shapes = model.shapeBlendShapes;
          for (let i = 0; i < 10; i++) {
            const beta = betas[i];
            if (beta === 0) continue;
            const shapeOffset = i * floatCount;
            for (let j = 0; j < floatCount; j++) {
              outRef[j] += beta * shapes[shapeOffset + j];
            }
          }

          // Compare within 1e-6
          for (let j = 0; j < floatCount; j++) {
            if (Math.abs(outNew[j] - outRef[j]) > 1e-6) {
              expect.fail(
                `Vertex float ${j}: new=${outNew[j]}, ref=${outRef[j]}, diff=${Math.abs(outNew[j] - outRef[j])}`,
              );
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });
}, 60000);

/* ------------------------------------------------------------------ */
/*  Property: validateHeader accepts [1, 300], rejects 0 and 301+      */
/* ------------------------------------------------------------------ */

describe('Property: validateHeader accepts [1, 300], rejects 0 and 301+', () => {
  /**
   * **Validates: Requirements 3.4**
   *
   * For all shapeCount values in [1, 300], parseSmplBinary does not throw
   * on the shapeCount validation. For shapeCount = 0 or shapeCount > 300,
   * parseSmplBinary throws an error.
   */
  it('accepts shapeCount in [1, 300]', () => {
    // Test boundaries and a random sample within [1, 50] to keep allocation reasonable
    // (shapeCount=300 would allocate ~25 MB per binary)
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        (n) => {
          const buffer = buildTestSmplBinaryN(n);
          // Should not throw
          const model = parseSmplBinary(buffer);
          expect(model.shapeCount).toBe(n);
        },
      ),
      { numRuns: 30 },
    );

    // Explicitly test boundary values near 300 with minimal data
    for (const n of [1, 100, 200, 300]) {
      const buffer = buildTestSmplBinaryN(n);
      const model = parseSmplBinary(buffer);
      expect(model.shapeCount).toBe(n);
    }
  });

  it('rejects shapeCount = 0', () => {
    // Build a binary with shapeCount=1 (valid data size), then patch header to 0
    const buffer = buildTestSmplBinaryN(1);
    const view = new DataView(buffer);
    view.setUint16(10, 0, true); // shapeCount = 0
    expect(() => parseSmplBinary(buffer)).toThrow(/shapeCount/i);
  });

  it('rejects shapeCount > 300', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 301, max: 65535 }),
        (n) => {
          // Build a binary with shapeCount=1 (small valid data), then patch header
          const buffer = buildTestSmplBinaryN(1);
          const view = new DataView(buffer);
          view.setUint16(10, n, true);
          // Should throw because shapeCount > 300 (and also buffer too small)
          expect(() => parseSmplBinary(buffer)).toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });
}, 60000);
