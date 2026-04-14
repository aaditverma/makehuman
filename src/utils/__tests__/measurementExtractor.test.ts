/**
 * Unit tests for measurementExtractor.ts — Task 4.2
 *
 * Verifies that extractMeasurements produces reasonable values on a
 * reference SMPL mesh (zero betas = template mesh).
 * Chest, waist, and hip should fall within human range (60–140 cm).
 *
 * Requirements: 2.5
 */
import { describe, it, expect } from 'vitest';
import { extractMeasurements } from '../measurementExtractor';
import {
  SMPL_MAGIC,
  SMPL_VERTEX_COUNT,
  SMPL_FACE_COUNT,
  SMPL_SHAPE_COUNT,
  SMPL_JOINT_COUNT,
  SMPL_HEADER_BYTES,
  parseSmplBinary,
  computeSmplVertices,
  type SmplModelData,
} from '../smplForwardPass';

/* ------------------------------------------------------------------ */
/*  Helper: build a humanoid SMPL binary with realistic vertex layout  */
/* ------------------------------------------------------------------ */

/**
 * Landmark definitions matching the measurement extractor's expectations.
 * Vertex indices are chosen to be well within the 6890-vertex range.
 * Heights (Y) are set to realistic values for a ~1.75m body.
 */
const LANDMARKS: Record<string, { vertexIndex: number; y: number }> = {
  chest_center:    { vertexIndex: 3076, y: 1.19 },   // ~68% of 1.75m
  waist_center:    { vertexIndex: 3504, y: 1.015 },   // ~58% of 1.75m
  hip_center:      { vertexIndex: 1769, y: 0.875 },   // ~50% of 1.75m
  neck_base:       { vertexIndex: 3068, y: 1.49 },    // ~85% of 1.75m
  left_shoulder:   { vertexIndex: 3011, y: 1.35 },    // ~77% of 1.75m
  right_shoulder:  { vertexIndex: 6470, y: 1.35 },
  left_knee:       { vertexIndex: 1085, y: 0.49 },
  right_knee:      { vertexIndex: 4530, y: 0.49 },
  left_ankle:      { vertexIndex: 3327, y: 0.07 },
  right_ankle:     { vertexIndex: 6728, y: 0.07 },
};

const LANDMARK_NAMES = Object.keys(LANDMARKS);

/**
 * Place vertices in an elliptical cross-section at a given Y height.
 * This simulates a torso/limb slice through the body.
 *
 * @param vertices - output Float32Array (6890×3)
 * @param startIdx - first vertex index to write
 * @param count - number of vertices in the ring
 * @param y - Y height
 * @param radiusX - half-width (left-right)
 * @param radiusZ - half-depth (front-back)
 */
function placeEllipseRing(
  vertices: Float32Array,
  startIdx: number,
  count: number,
  y: number,
  radiusX: number,
  radiusZ: number,
): void {
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    const idx = (startIdx + i) * 3;
    if (startIdx + i >= SMPL_VERTEX_COUNT) break;
    vertices[idx]     = radiusX * Math.cos(angle); // X
    vertices[idx + 1] = y;                          // Y
    vertices[idx + 2] = radiusZ * Math.sin(angle); // Z
  }
}

/**
 * Place vertices in a half-ellipse on the left side (x > 0) for limb measurements.
 * The measurement extractor filters left-side vertices for bilateral measurements.
 */
function placeLeftLimbRing(
  vertices: Float32Array,
  startIdx: number,
  count: number,
  y: number,
  radius: number,
  xCenter: number,
): void {
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    const idx = (startIdx + i) * 3;
    if (startIdx + i >= SMPL_VERTEX_COUNT) break;
    vertices[idx]     = xCenter + radius * Math.cos(angle); // X (offset to left side)
    vertices[idx + 1] = y;                                   // Y
    vertices[idx + 2] = radius * Math.sin(angle);            // Z
  }
}

/**
 * Build a synthetic SMPL binary with humanoid vertex positions.
 * The template mesh has vertices arranged in elliptical cross-sections
 * at anatomical heights, simulating a ~1.75m average male body.
 */
function buildHumanoidSmplBinary(): ArrayBuffer {
  const vertexCount = SMPL_VERTEX_COUNT;
  const faceCount = SMPL_FACE_COUNT;
  const shapeCount = SMPL_SHAPE_COUNT;
  const landmarkCount = LANDMARK_NAMES.length;

  // Build string table
  const encoder = new TextEncoder();
  const nameBuffers = LANDMARK_NAMES.map(n => encoder.encode(n));
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

  // --- Template vertices: build a humanoid body ---
  const templateOffset = offset;
  const templateArr = new Float32Array(buffer, templateOffset, templateFloats);

  // Initialize all vertices to a default scattered position (spread vertically)
  for (let i = 0; i < vertexCount; i++) {
    templateArr[i * 3]     = 0;                                    // X = 0
    templateArr[i * 3 + 1] = (i / vertexCount) * 1.75;            // Y spread 0–1.75m
    templateArr[i * 3 + 2] = 0;                                    // Z = 0
  }

  // Set landmark vertices to their correct Y positions
  for (const [name, info] of Object.entries(LANDMARKS)) {
    const idx = info.vertexIndex;
    templateArr[idx * 3 + 1] = info.y;
  }

  // Place shoulder landmarks at correct X positions for shoulder width measurement
  // Average male shoulder width ~45cm → each shoulder at ±0.225m from center
  const lsIdx = LANDMARKS.left_shoulder.vertexIndex;
  templateArr[lsIdx * 3]     =  0.225; // left shoulder X
  templateArr[lsIdx * 3 + 1] = LANDMARKS.left_shoulder.y;
  templateArr[lsIdx * 3 + 2] = 0;

  const rsIdx = LANDMARKS.right_shoulder.vertexIndex;
  templateArr[rsIdx * 3]     = -0.225; // right shoulder X
  templateArr[rsIdx * 3 + 1] = LANDMARKS.right_shoulder.y;
  templateArr[rsIdx * 3 + 2] = 0;

  // Place elliptical rings of vertices at key anatomical heights.
  // The measurement extractor collects vertices in a ±1.5cm band at each height.
  // We use ~60 vertices per ring for reasonable perimeter approximation.
  const RING_SIZE = 60;

  // Chest ring: ~96cm circumference → semi-axes ~0.16m (X) × 0.13m (Z)
  // Circumference of ellipse ≈ π(a+b) ≈ π(0.16+0.13) ≈ 0.91m = 91cm
  placeEllipseRing(templateArr, 0, RING_SIZE, LANDMARKS.chest_center.y, 0.16, 0.13);

  // Waist ring: ~82cm circumference → semi-axes ~0.14m × 0.11m
  // ≈ π(0.14+0.11) ≈ 0.785m = 78.5cm
  placeEllipseRing(templateArr, 100, RING_SIZE, LANDMARKS.waist_center.y, 0.14, 0.11);

  // Hip ring: ~96cm circumference → semi-axes ~0.16m × 0.13m
  placeEllipseRing(templateArr, 200, RING_SIZE, LANDMARKS.hip_center.y, 0.16, 0.13);

  // Neck ring: ~38cm circumference → semi-axes ~0.065m × 0.055m
  // ≈ π(0.065+0.055) ≈ 0.377m = 37.7cm
  placeEllipseRing(templateArr, 300, RING_SIZE, LANDMARKS.neck_base.y, 0.065, 0.055);

  // Left bicep ring: ~32cm circumference → radius ~0.05m, centered at x=0.15
  placeLeftLimbRing(templateArr, 400, RING_SIZE, 1.085, 0.05, 0.15);

  // Left thigh ring: ~55cm circumference → radius ~0.088m, centered at x=0.10
  placeLeftLimbRing(templateArr, 500, RING_SIZE, 0.63, 0.088, 0.10);

  // Left calf ring: ~37cm circumference → radius ~0.059m, centered at x=0.06
  placeLeftLimbRing(templateArr, 600, RING_SIZE, 0.315, 0.059, 0.06);

  // Left wrist ring: ~17cm circumference → radius ~0.027m, centered at x=0.25
  placeLeftLimbRing(templateArr, 700, RING_SIZE, 0.84, 0.027, 0.25);

  // Place some vertices at feet (Y≈0) and top of head (Y≈1.75) for body height
  for (let i = 760; i < 780; i++) {
    templateArr[i * 3]     = 0;
    templateArr[i * 3 + 1] = 0;     // feet at Y=0
    templateArr[i * 3 + 2] = 0;
  }
  for (let i = 780; i < 800; i++) {
    templateArr[i * 3]     = 0;
    templateArr[i * 3 + 1] = 1.75;  // top of head
    templateArr[i * 3 + 2] = 0;
  }

  offset += templateFloats * 4;

  // Shape blend shapes — all zeros (zero betas = template mesh)
  offset += blendFloats * 4;

  // Face indices — sequential (mod vertexCount)
  for (let i = 0; i < faceElements; i++) {
    view.setUint16(offset, i % vertexCount, true);
    offset += 2;
  }

  // Joint regressor — zeros
  offset += jointFloats * 4;

  // Landmark pairs
  for (let i = 0; i < landmarkCount; i++) {
    const name = LANDMARK_NAMES[i];
    const info = LANDMARKS[name];
    view.setUint16(offset, info.vertexIndex, true); offset += 2;
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
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('measurementExtractor', () => {
  let model: SmplModelData;
  let vertices: Float32Array;

  beforeAll(() => {
    const buffer = buildHumanoidSmplBinary();
    model = parseSmplBinary(buffer);
    // Zero betas → template mesh
    vertices = new Float32Array(SMPL_VERTEX_COUNT * 3);
    const betas = new Float64Array(SMPL_SHAPE_COUNT);
    computeSmplVertices(model, betas, vertices);
  });

  it('returns an object with all expected measurement fields', () => {
    const m = extractMeasurements(model, vertices);

    expect(m).toHaveProperty('chestCm');
    expect(m).toHaveProperty('waistCm');
    expect(m).toHaveProperty('hipCm');
    expect(m).toHaveProperty('shoulderCm');
    expect(m).toHaveProperty('neckCm');
    expect(m).toHaveProperty('bicepCm');
    expect(m).toHaveProperty('thighCm');
    expect(m).toHaveProperty('calfCm');
    expect(m).toHaveProperty('wristCm');
    expect(m).toHaveProperty('inseamCm');
  });

  it('produces all finite, positive measurements', () => {
    const m = extractMeasurements(model, vertices);

    for (const [key, value] of Object.entries(m)) {
      expect(value, `${key} should be finite`).toSatisfy(Number.isFinite);
      expect(value, `${key} should be positive`).toBeGreaterThan(0);
    }
  });

  it('chest circumference is in human range (60–140 cm)', () => {
    const m = extractMeasurements(model, vertices);
    expect(m.chestCm).toBeGreaterThanOrEqual(60);
    expect(m.chestCm).toBeLessThanOrEqual(140);
  });

  it('waist circumference is in human range (60–140 cm)', () => {
    const m = extractMeasurements(model, vertices);
    expect(m.waistCm).toBeGreaterThanOrEqual(60);
    expect(m.waistCm).toBeLessThanOrEqual(140);
  });

  it('hip circumference is in human range (60–140 cm)', () => {
    const m = extractMeasurements(model, vertices);
    expect(m.hipCm).toBeGreaterThanOrEqual(60);
    expect(m.hipCm).toBeLessThanOrEqual(140);
  });

  it('neck circumference is in plausible range (25–55 cm)', () => {
    const m = extractMeasurements(model, vertices);
    expect(m.neckCm).toBeGreaterThanOrEqual(25);
    expect(m.neckCm).toBeLessThanOrEqual(55);
  });

  it('shoulder width is in plausible range (30–60 cm)', () => {
    const m = extractMeasurements(model, vertices);
    expect(m.shoulderCm).toBeGreaterThanOrEqual(30);
    expect(m.shoulderCm).toBeLessThanOrEqual(60);
  });

  it('bicep circumference is in plausible range (20–55 cm)', () => {
    const m = extractMeasurements(model, vertices);
    expect(m.bicepCm).toBeGreaterThanOrEqual(20);
    expect(m.bicepCm).toBeLessThanOrEqual(55);
  });

  it('thigh circumference is in plausible range (35–80 cm)', () => {
    const m = extractMeasurements(model, vertices);
    expect(m.thighCm).toBeGreaterThanOrEqual(35);
    expect(m.thighCm).toBeLessThanOrEqual(80);
  });

  it('calf circumference is in plausible range (25–55 cm)', () => {
    const m = extractMeasurements(model, vertices);
    expect(m.calfCm).toBeGreaterThanOrEqual(25);
    expect(m.calfCm).toBeLessThanOrEqual(55);
  });

  it('inseam is in plausible range (60–95 cm)', () => {
    const m = extractMeasurements(model, vertices);
    expect(m.inseamCm).toBeGreaterThanOrEqual(60);
    expect(m.inseamCm).toBeLessThanOrEqual(95);
  });

  it('chest >= waist for an average male body', () => {
    const m = extractMeasurements(model, vertices);
    expect(m.chestCm).toBeGreaterThanOrEqual(m.waistCm);
  });

  it('hip >= waist for an average male body', () => {
    const m = extractMeasurements(model, vertices);
    expect(m.hipCm).toBeGreaterThanOrEqual(m.waistCm);
  });

  it('thigh > calf for an average body', () => {
    const m = extractMeasurements(model, vertices);
    expect(m.thighCm).toBeGreaterThan(m.calfCm);
  });
});
