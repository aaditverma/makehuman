/**
 * Property-based tests for garmentDeformer.ts — Tasks 7.2, 7.3, 7.4
 *
 * Property 6: Barycentric garment deformation correctness
 * Property 7: Garment non-interpenetration (simplified)
 * Property 9: Binding map validation catches degenerate entries
 *
 * Uses fast-check for property-based testing.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  deformGarment,
  computeSmplNormals,
  validateBindingMap,
} from '../garmentDeformer';
import type { BindingMap, BindingEntry } from '../bindingMapCodec';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build a simple non-degenerate mesh with N triangles.
 * Each triangle is well-separated to avoid degeneracy.
 */
function buildSimpleMesh(faceCount: number) {
  const vertexCount = faceCount * 3;
  const vertices = new Float32Array(vertexCount * 3);
  const faces = new Uint16Array(faceCount * 3);

  for (let f = 0; f < faceCount; f++) {
    const base = f * 3;
    // Triangle in XY plane, offset by f in X
    const ox = f * 3;
    // V0
    vertices[base * 3] = ox;
    vertices[base * 3 + 1] = 0;
    vertices[base * 3 + 2] = 0;
    // V1
    vertices[(base + 1) * 3] = ox + 1;
    vertices[(base + 1) * 3 + 1] = 0;
    vertices[(base + 1) * 3 + 2] = 0;
    // V2
    vertices[(base + 2) * 3] = ox;
    vertices[(base + 2) * 3 + 1] = 1;
    vertices[(base + 2) * 3 + 2] = 0;

    faces[f * 3] = base;
    faces[f * 3 + 1] = base + 1;
    faces[f * 3 + 2] = base + 2;
  }

  return { vertices, faces, vertexCount };
}

/* ------------------------------------------------------------------ */
/*  Generators                                                         */
/* ------------------------------------------------------------------ */

/** Generate valid barycentric coordinates that sum to 1 */
const baryArb = fc
  .tuple(
    fc.double({ min: 0.01, max: 0.98, noNaN: true, noDefaultInfinity: true }),
    fc.double({ min: 0.01, max: 0.98, noNaN: true, noDefaultInfinity: true }),
  )
  .filter(([a, b]) => a + b < 0.99)
  .map(([a, b]) => ({ u: a, v: b, w: 1 - a - b }));

/* ------------------------------------------------------------------ */
/*  Property 6: Barycentric garment deformation correctness            */
/* ------------------------------------------------------------------ */

describe('Property 6: Barycentric garment deformation correctness', () => {
  /**
   * **Validates: Requirements 6.1, 6.4**
   *
   * For any SMPL vertices and binding entry with valid barycentric coords
   * on a non-degenerate triangle, the deformed garment vertex position
   * SHALL equal the barycentric interpolation of the triangle's vertex
   * positions plus the normal offset along the interpolated surface normal.
   */
  it('deformed position matches manual barycentric interpolation + normal offset', () => {
    const FACE_COUNT = 4;
    const { vertices, faces, vertexCount } = buildSimpleMesh(FACE_COUNT);
    const normals = new Float32Array(vertexCount * 3);
    computeSmplNormals(vertices, faces, normals);

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: FACE_COUNT - 1 }),
        baryArb,
        fc.double({ min: 0, max: 0.05, noNaN: true, noDefaultInfinity: true }),
        (faceIndex, bary, normalOffset) => {
          const bindingMap: BindingMap = {
            version: 1,
            vertexCount: 1,
            entries: [{
              faceIndex,
              baryU: bary.u,
              baryV: bary.v,
              baryW: bary.w,
              normalOffset,
            }],
          };

          const output = new Float32Array(3);
          deformGarment(bindingMap, vertices, normals, faces, output);

          // Manual computation
          const fi = faceIndex * 3;
          const vi0 = faces[fi], vi1 = faces[fi + 1], vi2 = faces[fi + 2];

          // Barycentric interpolation of position
          const px = bary.u * vertices[vi0 * 3] + bary.v * vertices[vi1 * 3] + bary.w * vertices[vi2 * 3];
          const py = bary.u * vertices[vi0 * 3 + 1] + bary.v * vertices[vi1 * 3 + 1] + bary.w * vertices[vi2 * 3 + 1];
          const pz = bary.u * vertices[vi0 * 3 + 2] + bary.v * vertices[vi1 * 3 + 2] + bary.w * vertices[vi2 * 3 + 2];

          // Barycentric interpolation of normal
          let inx = bary.u * normals[vi0 * 3] + bary.v * normals[vi1 * 3] + bary.w * normals[vi2 * 3];
          let iny = bary.u * normals[vi0 * 3 + 1] + bary.v * normals[vi1 * 3 + 1] + bary.w * normals[vi2 * 3 + 1];
          let inz = bary.u * normals[vi0 * 3 + 2] + bary.v * normals[vi1 * 3 + 2] + bary.w * normals[vi2 * 3 + 2];
          const nLen = Math.sqrt(inx * inx + iny * iny + inz * inz);
          if (nLen > 1e-10) {
            inx /= nLen; iny /= nLen; inz /= nLen;
          }

          const expectedX = px + normalOffset * inx;
          const expectedY = py + normalOffset * iny;
          const expectedZ = pz + normalOffset * inz;

          expect(output[0]).toBeCloseTo(expectedX, 4);
          expect(output[1]).toBeCloseTo(expectedY, 4);
          expect(output[2]).toBeCloseTo(expectedZ, 4);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Property 7: Garment non-interpenetration (simplified)              */
/* ------------------------------------------------------------------ */

describe('Property 7: Garment non-interpenetration (simplified)', () => {
  /**
   * **Validates: Requirements 6.6**
   *
   * For a simple test mesh, positive normal offset produces garment
   * vertices above the surface (positive signed distance along normal).
   */
  it('positive normal offset produces garment vertices above the surface', () => {
    const { vertices, faces, vertexCount } = buildSimpleMesh(2);
    const normals = new Float32Array(vertexCount * 3);
    computeSmplNormals(vertices, faces, normals);

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1 }),
        baryArb,
        fc.double({ min: 0.001, max: 0.1, noNaN: true, noDefaultInfinity: true }),
        (faceIndex, bary, normalOffset) => {
          const bindingMap: BindingMap = {
            version: 1,
            vertexCount: 1,
            entries: [{
              faceIndex,
              baryU: bary.u,
              baryV: bary.v,
              baryW: bary.w,
              normalOffset,
            }],
          };

          const output = new Float32Array(3);
          deformGarment(bindingMap, vertices, normals, faces, output);

          // Compute surface point (no offset)
          const fi = faceIndex * 3;
          const vi0 = faces[fi], vi1 = faces[fi + 1], vi2 = faces[fi + 2];
          const sx = bary.u * vertices[vi0 * 3] + bary.v * vertices[vi1 * 3] + bary.w * vertices[vi2 * 3];
          const sy = bary.u * vertices[vi0 * 3 + 1] + bary.v * vertices[vi1 * 3 + 1] + bary.w * vertices[vi2 * 3 + 1];
          const sz = bary.u * vertices[vi0 * 3 + 2] + bary.v * vertices[vi1 * 3 + 2] + bary.w * vertices[vi2 * 3 + 2];

          // Interpolated normal
          let inx = bary.u * normals[vi0 * 3] + bary.v * normals[vi1 * 3] + bary.w * normals[vi2 * 3];
          let iny = bary.u * normals[vi0 * 3 + 1] + bary.v * normals[vi1 * 3 + 1] + bary.w * normals[vi2 * 3 + 1];
          let inz = bary.u * normals[vi0 * 3 + 2] + bary.v * normals[vi1 * 3 + 2] + bary.w * normals[vi2 * 3 + 2];
          const nLen = Math.sqrt(inx * inx + iny * iny + inz * inz);
          if (nLen > 1e-10) { inx /= nLen; iny /= nLen; inz /= nLen; }

          // Signed distance: dot(garment - surface, normal) should be positive
          const dx = output[0] - sx;
          const dy = output[1] - sy;
          const dz = output[2] - sz;
          const signedDist = dx * inx + dy * iny + dz * inz;

          expect(signedDist).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Property 9: Binding map validation catches degenerate entries      */
/* ------------------------------------------------------------------ */

describe('Property 9: Binding map validation catches degenerate entries', () => {
  /**
   * **Validates: Requirements 5.5**
   *
   * For any BindingMap containing entries with degenerate triangles,
   * invalid barycentric coords, or out-of-bounds face indices,
   * the validation function SHALL report the invalid entries.
   */
  it('catches entries with negative barycentric coordinates', () => {
    const { vertices, faces } = buildSimpleMesh(2);

    fc.assert(
      fc.property(
        fc.double({ min: -1, max: -0.01, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (negCoord, posCoord) => {
          const bindingMap: BindingMap = {
            version: 1,
            vertexCount: 1,
            entries: [{
              faceIndex: 0,
              baryU: negCoord,
              baryV: posCoord,
              baryW: 1 - negCoord - posCoord,
              normalOffset: 0,
            }],
          };

          const result = validateBindingMap(bindingMap, vertices, faces);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.reason === 'invalid_barycentric')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('catches entries with barycentric coords not summing to 1', () => {
    const { vertices, faces } = buildSimpleMesh(2);

    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.5, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.5, max: 1, noNaN: true, noDefaultInfinity: true }),
        (u, v, w) => {
          // Ensure sum deviates from 1 by more than 0.001
          const sum = u + v + w;
          if (Math.abs(sum - 1.0) <= 0.001) return; // skip if accidentally valid

          const bindingMap: BindingMap = {
            version: 1,
            vertexCount: 1,
            entries: [{ faceIndex: 0, baryU: u, baryV: v, baryW: w, normalOffset: 0 }],
          };

          const result = validateBindingMap(bindingMap, vertices, faces);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.reason === 'invalid_barycentric')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('catches entries with out-of-bounds face index', () => {
    const { vertices, faces } = buildSimpleMesh(2);
    const faceCount = faces.length / 3;

    fc.assert(
      fc.property(
        fc.integer({ min: faceCount, max: faceCount + 10000 }),
        (badFaceIndex) => {
          const bindingMap: BindingMap = {
            version: 1,
            vertexCount: 1,
            entries: [{
              faceIndex: badFaceIndex,
              baryU: 0.33,
              baryV: 0.33,
              baryW: 0.34,
              normalOffset: 0,
            }],
          };

          const result = validateBindingMap(bindingMap, vertices, faces);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.reason === 'out_of_bounds_face')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('catches entries bound to degenerate triangles', () => {
    // Create a mesh with a degenerate triangle (all vertices at same point)
    const vertices = new Float32Array([
      0, 0, 0,  // V0
      0, 0, 0,  // V1 (same)
      0, 0, 0,  // V2 (same)
      1, 0, 0,  // V3 (for a valid triangle)
      0, 1, 0,  // V4
      0, 0, 1,  // V5
    ]);
    const faces = new Uint16Array([
      0, 1, 2,  // Face 0: degenerate
      3, 4, 5,  // Face 1: valid
    ]);

    fc.assert(
      fc.property(
        baryArb,
        (bary) => {
          const bindingMap: BindingMap = {
            version: 1,
            vertexCount: 1,
            entries: [{
              faceIndex: 0, // degenerate face
              baryU: bary.u,
              baryV: bary.v,
              baryW: bary.w,
              normalOffset: 0,
            }],
          };

          const result = validateBindingMap(bindingMap, vertices, faces);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.reason === 'degenerate_triangle')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
