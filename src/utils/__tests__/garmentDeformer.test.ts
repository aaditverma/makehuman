/**
 * Unit tests for garmentDeformer.ts — Task 7.1
 *
 * Covers:
 * - Barycentric interpolation correctness with known triangle
 * - Normal offset applied correctly
 * - Degenerate triangle fallback to nearest vertex
 * - computeSmplNormals produces unit-length normals
 * - validateBindingMap catches invalid entries
 */
import { describe, it, expect } from 'vitest';
import {
  deformGarment,
  computeSmplNormals,
  validateBindingMap,
} from '../garmentDeformer';
import type { BindingMap } from '../bindingMapCodec';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build a minimal SMPL-like mesh with known vertex positions.
 * 4 vertices forming 2 triangles:
 *   V0 = (0, 0, 0)
 *   V1 = (1, 0, 0)
 *   V2 = (0, 1, 0)
 *   V3 = (1, 1, 0)
 *
 * Face 0: V0, V1, V2
 * Face 1: V1, V3, V2
 */
function makeSimpleMesh() {
  const vertices = new Float32Array([
    0, 0, 0,  // V0
    1, 0, 0,  // V1
    0, 1, 0,  // V2
    1, 1, 0,  // V3
  ]);
  const faces = new Uint16Array([
    0, 1, 2,  // Face 0
    1, 3, 2,  // Face 1
  ]);
  return { vertices, faces };
}

function makeNormals(vertices: Float32Array, faces: Uint16Array): Float32Array {
  const normals = new Float32Array(vertices.length);
  computeSmplNormals(vertices, faces, normals);
  return normals;
}

function vecLength(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('garmentDeformer', () => {
  describe('computeSmplNormals', () => {
    it('produces unit-length normals for a flat quad', () => {
      const { vertices, faces } = makeSimpleMesh();
      const normals = new Float32Array(vertices.length);
      computeSmplNormals(vertices, faces, normals);

      const vertexCount = vertices.length / 3;
      for (let v = 0; v < vertexCount; v++) {
        const vx3 = v * 3;
        const len = vecLength(normals[vx3], normals[vx3 + 1], normals[vx3 + 2]);
        expect(len).toBeCloseTo(1.0, 5);
      }
    });

    it('produces normals pointing in +Z for XY-plane triangles', () => {
      const { vertices, faces } = makeSimpleMesh();
      const normals = new Float32Array(vertices.length);
      computeSmplNormals(vertices, faces, normals);

      // All vertices lie in the XY plane, so normals should point in +Z or -Z
      // With CCW winding (0,1,2) in XY plane, cross product gives +Z
      const vertexCount = vertices.length / 3;
      for (let v = 0; v < vertexCount; v++) {
        const vx3 = v * 3;
        expect(Math.abs(normals[vx3])).toBeLessThan(0.001);     // nx ≈ 0
        expect(Math.abs(normals[vx3 + 1])).toBeLessThan(0.001); // ny ≈ 0
        expect(Math.abs(normals[vx3 + 2])).toBeCloseTo(1.0, 3); // nz ≈ ±1
      }
    });

    it('handles a single triangle', () => {
      const vertices = new Float32Array([
        0, 0, 0,
        2, 0, 0,
        0, 2, 0,
      ]);
      const faces = new Uint16Array([0, 1, 2]);
      const normals = new Float32Array(9);
      computeSmplNormals(vertices, faces, normals);

      for (let v = 0; v < 3; v++) {
        const len = vecLength(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]);
        expect(len).toBeCloseTo(1.0, 5);
      }
    });
  });

  describe('deformGarment — barycentric interpolation', () => {
    it('interpolates position correctly at triangle center', () => {
      const { vertices, faces } = makeSimpleMesh();
      const normals = makeNormals(vertices, faces);

      // Bind one garment vertex to face 0 at centroid (1/3, 1/3, 1/3)
      const bindingMap: BindingMap = {
        version: 1,
        vertexCount: 1,
        entries: [{
          faceIndex: 0,
          baryU: 1 / 3,
          baryV: 1 / 3,
          baryW: 1 / 3,
          normalOffset: 0,
        }],
      };

      const output = new Float32Array(3);
      deformGarment(bindingMap, vertices, normals, faces, output);

      // Centroid of V0(0,0,0), V1(1,0,0), V2(0,1,0) = (1/3, 1/3, 0)
      expect(output[0]).toBeCloseTo(1 / 3, 4);
      expect(output[1]).toBeCloseTo(1 / 3, 4);
      expect(output[2]).toBeCloseTo(0, 4);
    });

    it('interpolates position correctly at a vertex', () => {
      const { vertices, faces } = makeSimpleMesh();
      const normals = makeNormals(vertices, faces);

      // Bind at V1 (baryU=0, baryV=1, baryW=0)
      const bindingMap: BindingMap = {
        version: 1,
        vertexCount: 1,
        entries: [{
          faceIndex: 0,
          baryU: 0,
          baryV: 1,
          baryW: 0,
          normalOffset: 0,
        }],
      };

      const output = new Float32Array(3);
      deformGarment(bindingMap, vertices, normals, faces, output);

      // Should be at V1 = (1, 0, 0)
      expect(output[0]).toBeCloseTo(1, 4);
      expect(output[1]).toBeCloseTo(0, 4);
      expect(output[2]).toBeCloseTo(0, 4);
    });

    it('interpolates position correctly at edge midpoint', () => {
      const { vertices, faces } = makeSimpleMesh();
      const normals = makeNormals(vertices, faces);

      // Midpoint of V0-V1 edge: baryU=0.5, baryV=0.5, baryW=0
      const bindingMap: BindingMap = {
        version: 1,
        vertexCount: 1,
        entries: [{
          faceIndex: 0,
          baryU: 0.5,
          baryV: 0.5,
          baryW: 0,
          normalOffset: 0,
        }],
      };

      const output = new Float32Array(3);
      deformGarment(bindingMap, vertices, normals, faces, output);

      // Midpoint of V0(0,0,0) and V1(1,0,0) = (0.5, 0, 0)
      expect(output[0]).toBeCloseTo(0.5, 4);
      expect(output[1]).toBeCloseTo(0, 4);
      expect(output[2]).toBeCloseTo(0, 4);
    });
  });

  describe('deformGarment — normal offset', () => {
    it('offsets position along interpolated normal', () => {
      const { vertices, faces } = makeSimpleMesh();
      const normals = makeNormals(vertices, faces);

      const normalOffset = 0.01;
      const bindingMap: BindingMap = {
        version: 1,
        vertexCount: 1,
        entries: [{
          faceIndex: 0,
          baryU: 1 / 3,
          baryV: 1 / 3,
          baryW: 1 / 3,
          normalOffset,
        }],
      };

      const output = new Float32Array(3);
      deformGarment(bindingMap, vertices, normals, faces, output);

      // Centroid = (1/3, 1/3, 0), normal is +Z for XY plane
      // So offset should add normalOffset in Z direction
      expect(output[0]).toBeCloseTo(1 / 3, 4);
      expect(output[1]).toBeCloseTo(1 / 3, 4);
      expect(output[2]).toBeCloseTo(normalOffset, 4);
    });

    it('zero normal offset produces position on the surface', () => {
      const { vertices, faces } = makeSimpleMesh();
      const normals = makeNormals(vertices, faces);

      const bindingMap: BindingMap = {
        version: 1,
        vertexCount: 1,
        entries: [{
          faceIndex: 0,
          baryU: 0.5,
          baryV: 0.3,
          baryW: 0.2,
          normalOffset: 0,
        }],
      };

      const output = new Float32Array(3);
      deformGarment(bindingMap, vertices, normals, faces, output);

      // P = 0.5*V0 + 0.3*V1 + 0.2*V2 = 0.5*(0,0,0) + 0.3*(1,0,0) + 0.2*(0,1,0) = (0.3, 0.2, 0)
      expect(output[0]).toBeCloseTo(0.3, 4);
      expect(output[1]).toBeCloseTo(0.2, 4);
      expect(output[2]).toBeCloseTo(0, 4);
    });
  });

  describe('deformGarment — degenerate triangle fallback', () => {
    it('falls back to nearest vertex for degenerate (zero-area) triangle', () => {
      // Create a degenerate triangle: all three vertices at the same point
      const vertices = new Float32Array([
        1, 2, 3,  // V0
        1, 2, 3,  // V1 (same as V0)
        1, 2, 3,  // V2 (same as V0)
      ]);
      const faces = new Uint16Array([0, 1, 2]);
      const normals = new Float32Array(9);
      // Manually set normals since computeSmplNormals would give zero for degenerate
      // Set V0 normal to (0, 0, 1)
      normals[0] = 0; normals[1] = 0; normals[2] = 1;
      normals[3] = 0; normals[4] = 0; normals[5] = 1;
      normals[6] = 0; normals[7] = 0; normals[8] = 1;

      const normalOffset = 0.005;
      const bindingMap: BindingMap = {
        version: 1,
        vertexCount: 1,
        entries: [{
          faceIndex: 0,
          baryU: 0.6,  // Largest weight → V0 is nearest
          baryV: 0.3,
          baryW: 0.1,
          normalOffset,
        }],
      };

      const output = new Float32Array(3);
      deformGarment(bindingMap, vertices, normals, faces, output);

      // Should use V0 (largest baryU) + normalOffset * normal
      expect(output[0]).toBeCloseTo(1, 4);
      expect(output[1]).toBeCloseTo(2, 4);
      expect(output[2]).toBeCloseTo(3 + normalOffset, 4);
    });

    it('selects vertex with largest barycentric weight in fallback', () => {
      // Degenerate triangle with distinct vertex positions for testing
      const vertices = new Float32Array([
        0, 0, 0,    // V0
        0, 0, 0.0000001,  // V1 (nearly same as V0 — degenerate)
        0, 0, 0,    // V2
      ]);
      const faces = new Uint16Array([0, 1, 2]);
      const normals = new Float32Array(9);
      normals[0] = 0; normals[1] = 1; normals[2] = 0; // V0 normal
      normals[3] = 0; normals[4] = 1; normals[5] = 0; // V1 normal
      normals[6] = 0; normals[7] = 1; normals[8] = 0; // V2 normal

      // baryV is largest → should pick V1
      const bindingMap: BindingMap = {
        version: 1,
        vertexCount: 1,
        entries: [{
          faceIndex: 0,
          baryU: 0.1,
          baryV: 0.7,
          baryW: 0.2,
          normalOffset: 0.01,
        }],
      };

      const output = new Float32Array(3);
      deformGarment(bindingMap, vertices, normals, faces, output);

      // V1 position + offset along V1 normal (0,1,0)
      expect(output[0]).toBeCloseTo(0, 4);
      expect(output[1]).toBeCloseTo(0.01, 4);
    });
  });

  describe('deformGarment — out-of-bounds face index', () => {
    it('skips vertices with out-of-bounds face index', () => {
      const { vertices, faces } = makeSimpleMesh();
      const normals = makeNormals(vertices, faces);

      const bindingMap: BindingMap = {
        version: 1,
        vertexCount: 1,
        entries: [{
          faceIndex: 999, // way out of bounds
          baryU: 0.33,
          baryV: 0.33,
          baryW: 0.34,
          normalOffset: 0,
        }],
      };

      const output = new Float32Array(3);
      output[0] = -999; output[1] = -999; output[2] = -999;
      deformGarment(bindingMap, vertices, normals, faces, output);

      // Should be unchanged (skipped)
      expect(output[0]).toBe(-999);
      expect(output[1]).toBe(-999);
      expect(output[2]).toBe(-999);
    });
  });

  describe('validateBindingMap', () => {
    it('returns valid for a correct binding map', () => {
      const { vertices, faces } = makeSimpleMesh();

      const bindingMap: BindingMap = {
        version: 1,
        vertexCount: 1,
        entries: [{
          faceIndex: 0,
          baryU: 0.5,
          baryV: 0.3,
          baryW: 0.2,
          normalOffset: 0.005,
        }],
      };

      const result = validateBindingMap(bindingMap, vertices, faces);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('catches out-of-bounds face index', () => {
      const { vertices, faces } = makeSimpleMesh();

      const bindingMap: BindingMap = {
        version: 1,
        vertexCount: 1,
        entries: [{
          faceIndex: 100,
          baryU: 0.33,
          baryV: 0.33,
          baryW: 0.34,
          normalOffset: 0,
        }],
      };

      const result = validateBindingMap(bindingMap, vertices, faces);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].reason).toBe('out_of_bounds_face');
    });

    it('catches negative barycentric coordinates', () => {
      const { vertices, faces } = makeSimpleMesh();

      const bindingMap: BindingMap = {
        version: 1,
        vertexCount: 1,
        entries: [{
          faceIndex: 0,
          baryU: -0.1,
          baryV: 0.6,
          baryW: 0.5,
          normalOffset: 0,
        }],
      };

      const result = validateBindingMap(bindingMap, vertices, faces);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.reason === 'invalid_barycentric')).toBe(true);
    });

    it('catches barycentric coords that do not sum to 1', () => {
      const { vertices, faces } = makeSimpleMesh();

      const bindingMap: BindingMap = {
        version: 1,
        vertexCount: 1,
        entries: [{
          faceIndex: 0,
          baryU: 0.5,
          baryV: 0.5,
          baryW: 0.5, // sum = 1.5
          normalOffset: 0,
        }],
      };

      const result = validateBindingMap(bindingMap, vertices, faces);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.reason === 'invalid_barycentric')).toBe(true);
    });

    it('catches degenerate triangles', () => {
      // All three vertices at the same point → zero area
      const vertices = new Float32Array([
        1, 1, 1,
        1, 1, 1,
        1, 1, 1,
        2, 2, 2, // extra vertex
      ]);
      const faces = new Uint16Array([0, 1, 2]);

      const bindingMap: BindingMap = {
        version: 1,
        vertexCount: 1,
        entries: [{
          faceIndex: 0,
          baryU: 0.33,
          baryV: 0.33,
          baryW: 0.34,
          normalOffset: 0,
        }],
      };

      const result = validateBindingMap(bindingMap, vertices, faces);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.reason === 'degenerate_triangle')).toBe(true);
    });

    it('reports multiple errors for multiple invalid entries', () => {
      const { vertices, faces } = makeSimpleMesh();

      const bindingMap: BindingMap = {
        version: 1,
        vertexCount: 3,
        entries: [
          { faceIndex: 999, baryU: 0.33, baryV: 0.33, baryW: 0.34, normalOffset: 0 },
          { faceIndex: 0, baryU: -0.1, baryV: 0.6, baryW: 0.5, normalOffset: 0 },
          { faceIndex: 0, baryU: 0.5, baryV: 0.3, baryW: 0.2, normalOffset: 0 }, // valid
        ],
      };

      const result = validateBindingMap(bindingMap, vertices, faces);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it('accepts barycentric coords within tolerance of 1.0', () => {
      const { vertices, faces } = makeSimpleMesh();

      const bindingMap: BindingMap = {
        version: 1,
        vertexCount: 1,
        entries: [{
          faceIndex: 0,
          baryU: 0.334,
          baryV: 0.333,
          baryW: 0.3335, // sum = 1.0005, within 0.001 tolerance
          normalOffset: 0,
        }],
      };

      const result = validateBindingMap(bindingMap, vertices, faces);
      // Should not flag as invalid barycentric (within tolerance)
      const baryErrors = result.errors.filter(e => e.reason === 'invalid_barycentric');
      expect(baryErrors).toHaveLength(0);
    });
  });
});
