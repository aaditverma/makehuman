/**
 * Unit tests for smplForwardPass.ts — Task 1.1
 *
 * Tests: binary parser, forward pass computation, landmark helper.
 */
import { describe, it, expect } from 'vitest';
import {
  parseSmplBinary,
  computeSmplVertices,
  getSmplLandmark,
  SMPL_MAGIC,
  SMPL_VERTEX_COUNT,
  SMPL_FACE_COUNT,
  SMPL_SHAPE_COUNT,
  SMPL_JOINT_COUNT,
  SMPL_HEADER_BYTES,
  type SmplModelData,
} from '../smplForwardPass';

/* ------------------------------------------------------------------ */
/*  Helper: build a valid SMPL binary buffer for testing               */
/* ------------------------------------------------------------------ */

/** Landmark names used in test fixtures */
const TEST_LANDMARKS = ['left_shoulder', 'right_shoulder', 'navel'];

function buildTestSmplBinary(opts?: {
  magic?: number;
  vertexCount?: number;
  faceCount?: number;
  shapeCount?: number;
  templateFill?: number;
  shapeFill?: number;
}): ArrayBuffer {
  const magic = opts?.magic ?? SMPL_MAGIC;
  const vertexCount = opts?.vertexCount ?? SMPL_VERTEX_COUNT;
  const faceCount = opts?.faceCount ?? SMPL_FACE_COUNT;
  const shapeCount = opts?.shapeCount ?? SMPL_SHAPE_COUNT;
  const landmarkCount = TEST_LANDMARKS.length;

  // Build string table
  const encoder = new TextEncoder();
  const nameBuffers = TEST_LANDMARKS.map(n => encoder.encode(n));
  // Each name + null terminator
  let stringTableSize = 0;
  const nameOffsets: number[] = [];
  for (const buf of nameBuffers) {
    nameOffsets.push(stringTableSize);
    stringTableSize += buf.length + 1; // +1 for null terminator
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
  view.setUint32(offset, magic, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2; // version
  view.setUint16(offset, vertexCount, true); offset += 2;
  view.setUint16(offset, faceCount, true); offset += 2;
  view.setUint16(offset, shapeCount, true); offset += 2;
  view.setUint16(offset, landmarkCount, true); offset += 2;
  view.setUint16(offset, 0, true); offset += 2; // reserved

  // Template vertices — fill with a known value
  const templateFill = opts?.templateFill ?? 0.5;
  for (let i = 0; i < templateFloats; i++) {
    view.setFloat32(offset, templateFill, true);
    offset += 4;
  }

  // Shape blend shapes — fill with a known value
  const shapeFill = opts?.shapeFill ?? 0.1;
  for (let i = 0; i < blendFloats; i++) {
    view.setFloat32(offset, shapeFill, true);
    offset += 4;
  }

  // Face indices — fill with sequential values (mod vertexCount)
  for (let i = 0; i < faceElements; i++) {
    view.setUint16(offset, i % vertexCount, true);
    offset += 2;
  }

  // Joint regressor — fill with zeros
  for (let i = 0; i < jointFloats; i++) {
    view.setFloat32(offset, 0, true);
    offset += 4;
  }

  // Landmark pairs — (vertexIndex, nameStringOffset)
  const landmarkVertexIndices = [3011, 6470, 3500]; // left_shoulder, right_shoulder, navel
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
    strBytes[strOffset] = 0; // null terminator
    strOffset += 1;
  }

  return buffer;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('smplForwardPass', () => {
  describe('parseSmplBinary', () => {
    it('parses a valid binary and returns correct SmplModelData', () => {
      const buffer = buildTestSmplBinary();
      const model = parseSmplBinary(buffer);

      expect(model.templateVertices).toBeInstanceOf(Float32Array);
      expect(model.templateVertices.length).toBe(SMPL_VERTEX_COUNT * 3);

      expect(model.shapeBlendShapes).toBeInstanceOf(Float32Array);
      expect(model.shapeBlendShapes.length).toBe(SMPL_SHAPE_COUNT * SMPL_VERTEX_COUNT * 3);

      expect(model.shapeCount).toBe(SMPL_SHAPE_COUNT);

      expect(model.faceIndices).toBeInstanceOf(Uint16Array);
      expect(model.faceIndices.length).toBe(SMPL_FACE_COUNT * 3);

      expect(model.jointRegressor).toBeInstanceOf(Float32Array);
      expect(model.jointRegressor.length).toBe(SMPL_JOINT_COUNT * SMPL_VERTEX_COUNT);

      expect(model.landmarkVertexIndices.size).toBe(3);
      expect(model.landmarkVertexIndices.get('left_shoulder')).toBe(3011);
      expect(model.landmarkVertexIndices.get('right_shoulder')).toBe(6470);
      expect(model.landmarkVertexIndices.get('navel')).toBe(3500);
    });

    it('rejects binary with wrong magic number', () => {
      const buffer = buildTestSmplBinary({ magic: 0xDEADBEEF });
      expect(() => parseSmplBinary(buffer)).toThrow(/magic/i);
    });

    it('rejects binary with wrong vertex count', () => {
      // We can't easily change vertexCount without changing buffer size,
      // but we can write a wrong value in the header
      const buffer = buildTestSmplBinary();
      const view = new DataView(buffer);
      view.setUint16(6, 1000, true); // wrong vertexCount
      expect(() => parseSmplBinary(buffer)).toThrow(/vertices/i);
    });

    it('rejects binary with wrong face count', () => {
      const buffer = buildTestSmplBinary();
      const view = new DataView(buffer);
      view.setUint16(8, 999, true); // wrong faceCount
      expect(() => parseSmplBinary(buffer)).toThrow(/faces/i);
    });

    it('rejects binary with shapeCount outside valid range', () => {
      const buffer = buildTestSmplBinary();
      const view = new DataView(buffer);
      view.setUint16(10, 0, true); // shapeCount = 0, below valid range [1, 300]
      expect(() => parseSmplBinary(buffer)).toThrow(/shapeCount/i);
    });

    it('rejects truncated binary (too small for header)', () => {
      const buffer = new ArrayBuffer(8);
      expect(() => parseSmplBinary(buffer)).toThrow(/too small/i);
    });

    it('rejects truncated binary (header ok but body too small)', () => {
      // Build a valid header but truncate the body
      const buffer = new ArrayBuffer(SMPL_HEADER_BYTES + 100);
      const view = new DataView(buffer);
      view.setUint32(0, SMPL_MAGIC, true);
      view.setUint16(4, 1, true);
      view.setUint16(6, SMPL_VERTEX_COUNT, true);
      view.setUint16(8, SMPL_FACE_COUNT, true);
      view.setUint16(10, SMPL_SHAPE_COUNT, true);
      view.setUint16(12, 0, true); // 0 landmarks
      view.setUint16(14, 0, true);
      expect(() => parseSmplBinary(buffer)).toThrow(/too small/i);
    });
  });

  describe('computeSmplVertices', () => {
    it('with zero betas produces template mesh', () => {
      const buffer = buildTestSmplBinary({ templateFill: 1.0, shapeFill: 0.5 });
      const model = parseSmplBinary(buffer);
      const output = new Float32Array(SMPL_VERTEX_COUNT * 3);
      const betas = new Float64Array(SMPL_SHAPE_COUNT); // all zeros

      computeSmplVertices(model, betas, output);

      // Output should equal template vertices exactly
      for (let i = 0; i < output.length; i++) {
        expect(output[i]).toBeCloseTo(1.0, 5);
      }
    });

    it('applies shape blend shapes correctly', () => {
      const buffer = buildTestSmplBinary({ templateFill: 0.0, shapeFill: 1.0 });
      const model = parseSmplBinary(buffer);
      const output = new Float32Array(SMPL_VERTEX_COUNT * 3);

      // Set beta[0] = 2.0, rest = 0
      const betas = new Float64Array(SMPL_SHAPE_COUNT);
      betas[0] = 2.0;

      computeSmplVertices(model, betas, output);

      // V = T(0) + 2.0 * S[0](1.0) = 2.0 for all components
      for (let i = 0; i < output.length; i++) {
        expect(output[i]).toBeCloseTo(2.0, 5);
      }
    });

    it('accumulates multiple shape components', () => {
      const buffer = buildTestSmplBinary({ templateFill: 0.0, shapeFill: 1.0 });
      const model = parseSmplBinary(buffer);
      const output = new Float32Array(SMPL_VERTEX_COUNT * 3);

      // Set all betas to 1.0 → V = 0 + 10 * 1.0 = 10.0
      const betas = new Float64Array(SMPL_SHAPE_COUNT);
      betas.fill(1.0);

      computeSmplVertices(model, betas, output);

      for (let i = 0; i < output.length; i++) {
        expect(output[i]).toBeCloseTo(10.0, 4);
      }
    });

    it('writes output in place without allocation', () => {
      const buffer = buildTestSmplBinary({ templateFill: 1.0 });
      const model = parseSmplBinary(buffer);
      const output = new Float32Array(SMPL_VERTEX_COUNT * 3);
      output.fill(999); // pre-fill with garbage

      const betas = new Float64Array(SMPL_SHAPE_COUNT);
      computeSmplVertices(model, betas, output);

      // Should be overwritten with template values
      expect(output[0]).toBeCloseTo(1.0, 5);
    });
  });

  describe('getSmplLandmark', () => {
    let model: SmplModelData;
    let vertices: Float32Array;

    beforeAll(() => {
      const buffer = buildTestSmplBinary({ templateFill: 0.0 });
      model = parseSmplBinary(buffer);
      vertices = new Float32Array(SMPL_VERTEX_COUNT * 3);

      // Set specific vertex positions for landmarks
      // left_shoulder at index 3011 → [1.0, 2.0, 3.0]
      vertices[3011 * 3] = 1.0;
      vertices[3011 * 3 + 1] = 2.0;
      vertices[3011 * 3 + 2] = 3.0;

      // navel at index 3500 → [4.0, 5.0, 6.0]
      vertices[3500 * 3] = 4.0;
      vertices[3500 * 3 + 1] = 5.0;
      vertices[3500 * 3 + 2] = 6.0;
    });

    it('returns correct position for known landmark', () => {
      const pos = getSmplLandmark(model, vertices, 'left_shoulder');
      expect(pos).toEqual([1.0, 2.0, 3.0]);
    });

    it('returns correct position for another landmark', () => {
      const pos = getSmplLandmark(model, vertices, 'navel');
      expect(pos).toEqual([4.0, 5.0, 6.0]);
    });

    it('returns null for unknown landmark', () => {
      const pos = getSmplLandmark(model, vertices, 'nonexistent_landmark');
      expect(pos).toBeNull();
    });
  });
});
