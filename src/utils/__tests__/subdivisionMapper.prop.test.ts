/**
 * Property-based tests for subdivisionMapper.ts — Task 7
 *
 * Property 6: Subdivision Interpolation Preserves Base Vertices
 *   7.1 Barycentric weight sum
 *   7.2 Output finiteness
 *   7.3 Identity mapping
 *
 * Uses fast-check for property-based testing.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseSubdivisionMap,
  interpolateSubdivision,
  SubdivisionMap,
  SUBDIV_MAGIC,
  SUBDIV_HEADER_BYTES,
  SUBDIV_PER_VERTEX_BYTES,
} from '../subdivisionMapper';
import { SMPL_VERTEX_COUNT, SMPL_FACE_COUNT } from '../smplForwardPass';

/* ------------------------------------------------------------------ */
/*  Helpers: build synthetic subdivision map binaries                   */
/* ------------------------------------------------------------------ */

/**
 * Build a synthetic subdivision map binary buffer.
 * Each subdivided vertex gets a random face index and barycentric coords
 * that sum to 1.0.
 */
function buildSubdivBinary(
  subdivVertCount: number,
  faceIndices: number[],
  baryCoords: number[][],
): ArrayBuffer {
  const totalBytes = SUBDIV_HEADER_BYTES + subdivVertCount * SUBDIV_PER_VERTEX_BYTES;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);

  // Header
  view.setUint32(0, SUBDIV_MAGIC, true);
  view.setUint16(4, 1, true);           // version
  view.setUint16(6, 0, true);           // reserved
  view.setUint32(8, SMPL_VERTEX_COUNT, true);
  view.setUint32(12, subdivVertCount, true);

  // Per-vertex data
  let offset = SUBDIV_HEADER_BYTES;
  for (let i = 0; i < subdivVertCount; i++) {
    view.setUint32(offset, faceIndices[i], true);
    view.setFloat32(offset + 4, baryCoords[i][0], true);
    view.setFloat32(offset + 8, baryCoords[i][1], true);
    view.setFloat32(offset + 12, baryCoords[i][2], true);
    offset += SUBDIV_PER_VERTEX_BYTES;
  }

  return buffer;
}

/**
 * Build a SubdivisionMap directly (without binary round-trip) for
 * interpolation tests.
 */
function buildSubdivMap(
  subdivVertCount: number,
  faceIdxArr: number[],
  baryCoordsArr: number[][],
): SubdivisionMap {
  const faceIndices = new Uint32Array(faceIdxArr);
  const baryCoords = new Float32Array(subdivVertCount * 3);
  for (let i = 0; i < subdivVertCount; i++) {
    baryCoords[i * 3 + 0] = baryCoordsArr[i][0];
    baryCoords[i * 3 + 1] = baryCoordsArr[i][1];
    baryCoords[i * 3 + 2] = baryCoordsArr[i][2];
  }
  return {
    baseVertCount: SMPL_VERTEX_COUNT,
    subdivVertCount,
    faceIndices,
    baryCoords,
  };
}

/**
 * Generate random base vertex positions (SMPL_VERTEX_COUNT × 3).
 */
function arbBaseVertices(): fc.Arbitrary<Float32Array> {
  return fc
    .array(
      fc.double({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true }),
      { minLength: SMPL_VERTEX_COUNT * 3, maxLength: SMPL_VERTEX_COUNT * 3 },
    )
    .map((arr) => new Float32Array(arr));
}

/**
 * Generate valid barycentric coordinates that sum to 1.0.
 * Uses the Dirichlet trick: generate two uniform [0,1] values,
 * sort them, and take differences.
 */
function arbBaryCoords(): fc.Arbitrary<[number, number, number]> {
  return fc
    .tuple(
      fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
      fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
    )
    .map(([a, b]) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return [lo, hi - lo, 1.0 - hi] as [number, number, number];
    });
}

/** Build a simple face array where face i has vertices (i*3, i*3+1, i*3+2) mod SMPL_VERTEX_COUNT */
function buildSimpleFaces(): Uint16Array {
  const faces = new Uint16Array(SMPL_FACE_COUNT * 3);
  for (let i = 0; i < SMPL_FACE_COUNT * 3; i++) {
    faces[i] = i % SMPL_VERTEX_COUNT;
  }
  return faces;
}


/* ------------------------------------------------------------------ */
/*  7.1 [PBT] Barycentric weight sum                                   */
/* ------------------------------------------------------------------ */

describe('Property 7.1: Barycentric weight sum', () => {
  /**
   * **Validates: Requirements 7.1**
   *
   * For random base vertex positions and a synthetic subdivision map,
   * verify all barycentric weight triples sum to 1.0 within 1e-5.
   */
  it('all barycentric weight triples in a parsed subdivision map sum to 1.0 within 1e-5', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.array(arbBaryCoords(), { minLength: 1, maxLength: 200 }),
        (subdivCount, baryArr) => {
          const count = Math.min(subdivCount, baryArr.length);
          const faceIdxArr = Array.from({ length: count }, (_, i) => i % SMPL_FACE_COUNT);
          const baryCoordsArr = baryArr.slice(0, count);

          const buffer = buildSubdivBinary(count, faceIdxArr, baryCoordsArr);
          const map = parseSubdivisionMap(buffer);

          for (let i = 0; i < map.subdivVertCount; i++) {
            const b0 = map.baryCoords[i * 3 + 0];
            const b1 = map.baryCoords[i * 3 + 1];
            const b2 = map.baryCoords[i * 3 + 2];
            const sum = b0 + b1 + b2;
            expect(Math.abs(sum - 1.0)).toBeLessThan(1e-5);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
}, 30000);

/* ------------------------------------------------------------------ */
/*  7.2 [PBT] Output finiteness                                       */
/* ------------------------------------------------------------------ */

describe('Property 7.2: Output finiteness', () => {
  /**
   * **Validates: Requirements 7.1**
   *
   * For random base vertex positions, verify all interpolated subdivided
   * vertex coordinates are finite numbers.
   */
  it('all interpolated vertex coordinates are finite for random base positions', () => {
    const baseFaces = buildSimpleFaces();

    fc.assert(
      fc.property(
        arbBaseVertices(),
        fc.array(arbBaryCoords(), { minLength: 1, maxLength: 100 }),
        (baseVertices, baryArr) => {
          const count = baryArr.length;
          const faceIdxArr = Array.from({ length: count }, (_, i) => i % SMPL_FACE_COUNT);

          const map = buildSubdivMap(count, faceIdxArr, baryArr);
          const output = new Float32Array(count * 3);

          interpolateSubdivision(baseVertices, baseFaces, map, output);

          for (let i = 0; i < output.length; i++) {
            if (!Number.isFinite(output[i])) {
              expect.fail(`Output[${i}] is not finite: ${output[i]}`);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
}, 30000);

/* ------------------------------------------------------------------ */
/*  7.3 [PBT] Identity mapping                                        */
/* ------------------------------------------------------------------ */

describe('Property 7.3: Identity mapping', () => {
  /**
   * **Validates: Requirements 7.1, 7.3**
   *
   * When a subdivided vertex has barycoords (1,0,0) pointing to face
   * vertex 0, the interpolated position equals that base vertex position
   * exactly.
   */
  it('barycoords (1,0,0) produces exact base vertex position for vertex 0 of the face', () => {
    const baseFaces = buildSimpleFaces();

    fc.assert(
      fc.property(
        arbBaseVertices(),
        fc.array(
          fc.integer({ min: 0, max: SMPL_FACE_COUNT - 1 }),
          { minLength: 1, maxLength: 100 },
        ),
        (baseVertices, faceIdxArr) => {
          const count = faceIdxArr.length;
          // All barycoords are (1, 0, 0) — identity mapping to vertex 0 of each face
          const baryCoordsArr = Array.from({ length: count }, () => [1, 0, 0] as [number, number, number]);

          const map = buildSubdivMap(count, faceIdxArr, baryCoordsArr);
          const output = new Float32Array(count * 3);

          interpolateSubdivision(baseVertices, baseFaces, map, output);

          for (let i = 0; i < count; i++) {
            const faceIdx = faceIdxArr[i];
            const v0 = baseFaces[faceIdx * 3 + 0];

            // The interpolated position should exactly equal baseVertices[v0].
            // We compare with === (not Object.is) to treat +0 and -0 as equal,
            // since 1.0 * (-0) + 0 * x + 0 * y = +0 in IEEE 754.
            expect(output[i * 3 + 0] === baseVertices[v0 * 3 + 0]).toBe(true);
            expect(output[i * 3 + 1] === baseVertices[v0 * 3 + 1]).toBe(true);
            expect(output[i * 3 + 2] === baseVertices[v0 * 3 + 2]).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
}, 30000);
