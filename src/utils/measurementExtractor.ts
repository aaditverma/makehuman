/**
 * Measurement Extractor — Extract body measurements from SMPL mesh.
 *
 * Measures the SMPL mesh at anatomical cross-sections to produce refined
 * body measurements. These measurements are more accurate than ANSUR II
 * statistical predictions because they come from an actual 3D mesh shaped
 * by the user's inputs.
 *
 * Approach:
 * 1. Determine target Y-height for each measurement using landmark vertices
 *    (with fallback to normalized height fractions for SMPL body proportions)
 * 2. Find all vertices within a thin horizontal band at the target height
 * 3. Filter vertices for the appropriate body region (torso vs limb)
 * 4. Sort vertices by angle around the body center axis (Y-axis)
 * 5. Compute the perimeter of the resulting cross-section polygon
 * 6. Convert from model units (meters) to centimeters
 */

import type { SmplModelData } from './smplForwardPass';
import { SMPL_VERTEX_COUNT } from './smplForwardPass';

/** Extracted body measurements in centimeters */
export interface ExtractedMeasurements {
  chestCm: number;
  waistCm: number;
  hipCm: number;
  shoulderCm: number;
  neckCm: number;
  bicepCm: number;
  thighCm: number;
  calfCm: number;
  wristCm: number;
  inseamCm: number;
}

/**
 * Landmark names used to determine measurement heights.
 * These correspond to entries in SmplModelData.landmarkVertexIndices.
 */
const LANDMARK_NAMES = {
  chest: 'chest_center',
  waist: 'waist_center',
  hip: 'hip_center',
  neck: 'neck_base',
  leftShoulder: 'left_shoulder',
  rightShoulder: 'right_shoulder',
  leftKnee: 'left_knee',
  rightKnee: 'right_knee',
  leftAnkle: 'left_ankle',
  rightAnkle: 'right_ankle',
} as const;

/**
 * Fallback normalized height fractions for measurement planes.
 * These match the heatmapEngine height landmarks and represent
 * the fraction of total body height where each measurement is taken.
 * Used when landmark vertices are not available in the model.
 */
const HEIGHT_FRACTIONS: Record<string, number> = {
  neck: 0.85,
  shoulder: 0.77,
  chest: 0.68,
  bicep: 0.62,
  waist: 0.58,
  hip: 0.50,
  wrist: 0.48,
  thigh: 0.36,
  calf: 0.18,
};

/** Half-width of the horizontal band used to capture vertices at a given height */
const BAND_HALF_WIDTH = 0.015; // 1.5cm in model units (meters)

/** Maximum |x| for torso vertices — filters out arm vertices for torso circumferences */
const TORSO_X_LIMIT = 0.18; // meters

/**
 * Get the Y-coordinate of a named landmark vertex, or null if not found.
 */
function getLandmarkY(
  model: SmplModelData,
  vertices: Float32Array,
  landmarkName: string,
): number | null {
  const idx = model.landmarkVertexIndices.get(landmarkName);
  if (idx === undefined) return null;
  return vertices[idx * 3 + 1]; // Y component
}

/**
 * Compute the total body height from the mesh by finding min/max Y values.
 */
function computeBodyHeight(vertices: Float32Array): { minY: number; maxY: number; height: number } {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < vertices.length; i += 3) {
    const y = vertices[i];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minY, maxY, height: maxY - minY };
}

/**
 * Collect vertices within a horizontal band at the given Y-height.
 * Returns an array of {x, z} points.
 */
function collectBandVertices(
  vertices: Float32Array,
  targetY: number,
  halfWidth: number,
): Array<{ x: number; z: number }> {
  const points: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < SMPL_VERTEX_COUNT; i++) {
    const y = vertices[i * 3 + 1];
    if (Math.abs(y - targetY) <= halfWidth) {
      points.push({ x: vertices[i * 3], z: vertices[i * 3 + 2] });
    }
  }
  return points;
}

/**
 * Filter points to torso-only by excluding those with large |x| values.
 * This removes arm vertices from torso circumference measurements.
 */
function filterTorso(
  points: Array<{ x: number; z: number }>,
  xLimit: number,
): Array<{ x: number; z: number }> {
  return points.filter((p) => Math.abs(p.x) <= xLimit);
}

/**
 * Filter points to one side of the body (positive x = left side in SMPL).
 * Used for bilateral measurements like bicep, thigh, calf, wrist.
 */
function filterLeftSide(
  points: Array<{ x: number; z: number }>,
): Array<{ x: number; z: number }> {
  return points.filter((p) => p.x > 0.02); // left side only, small margin to avoid center
}

/**
 * Sort points by angle around the centroid and compute the perimeter
 * of the resulting polygon. Returns the perimeter in model units (meters).
 */
function computePerimeter(points: Array<{ x: number; z: number }>): number {
  if (points.length < 3) return 0;

  // Compute centroid
  let cx = 0;
  let cz = 0;
  for (const p of points) {
    cx += p.x;
    cz += p.z;
  }
  cx /= points.length;
  cz /= points.length;

  // Sort by angle around centroid
  const sorted = [...points].sort((a, b) => {
    const angleA = Math.atan2(a.z - cz, a.x - cx);
    const angleB = Math.atan2(b.z - cz, b.x - cx);
    return angleA - angleB;
  });

  // Sum distances between consecutive points (closed polygon)
  let perimeter = 0;
  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];
    const next = sorted[(i + 1) % sorted.length];
    const dx = next.x - curr.x;
    const dz = next.z - curr.z;
    perimeter += Math.sqrt(dx * dx + dz * dz);
  }

  return perimeter;
}

/**
 * Compute a circumference measurement at a given Y-height.
 * Collects vertices in a band, optionally filters to torso or one side,
 * sorts by angle, and computes perimeter.
 *
 * @param vertices - SMPL vertex positions (6890×3)
 * @param targetY - Y-height of the measurement plane
 * @param mode - 'torso' filters to low |x|, 'left' filters to left side, 'full' uses all
 * @returns circumference in centimeters
 */
function measureCircumference(
  vertices: Float32Array,
  targetY: number,
  mode: 'torso' | 'left' | 'full',
): number {
  let points = collectBandVertices(vertices, targetY, BAND_HALF_WIDTH);

  if (mode === 'torso') {
    points = filterTorso(points, TORSO_X_LIMIT);
  } else if (mode === 'left') {
    points = filterLeftSide(points);
  }

  const perimeterM = computePerimeter(points);
  // Convert meters to centimeters
  let circumferenceCm = perimeterM * 100;

  // For bilateral (left-side) measurements, the perimeter traces around
  // the cross-section of one limb, so no doubling needed
  return circumferenceCm;
}

/**
 * Resolve the Y-height for a measurement, using landmark if available,
 * otherwise falling back to a normalized height fraction.
 */
function resolveHeight(
  model: SmplModelData,
  vertices: Float32Array,
  landmarkName: string | undefined,
  fractionKey: string,
  bodyMinY: number,
  bodyHeight: number,
): number {
  if (landmarkName) {
    const y = getLandmarkY(model, vertices, landmarkName);
    if (y !== null) return y;
  }
  // Fallback: use normalized height fraction
  const fraction = HEIGHT_FRACTIONS[fractionKey] ?? 0.5;
  return bodyMinY + fraction * bodyHeight;
}

/**
 * Compute shoulder width as the distance between left and right shoulder
 * landmark vertices, converted to a "circumference-like" measurement.
 * Shoulder measurement in garment fitting is typically the across-shoulder
 * distance (not a circumference), so we compute it as 2× the half-span
 * plus a front-to-back depth estimate.
 */
function measureShoulder(
  model: SmplModelData,
  vertices: Float32Array,
  shoulderY: number,
): number {
  // Try to get shoulder landmarks directly
  const leftIdx = model.landmarkVertexIndices.get(LANDMARK_NAMES.leftShoulder);
  const rightIdx = model.landmarkVertexIndices.get(LANDMARK_NAMES.rightShoulder);

  if (leftIdx !== undefined && rightIdx !== undefined) {
    const lx = vertices[leftIdx * 3];
    const ly = vertices[leftIdx * 3 + 1];
    const lz = vertices[leftIdx * 3 + 2];
    const rx = vertices[rightIdx * 3];
    const ry = vertices[rightIdx * 3 + 1];
    const rz = vertices[rightIdx * 3 + 2];
    const dist = Math.sqrt(
      (lx - rx) ** 2 + (ly - ry) ** 2 + (lz - rz) ** 2,
    );
    // Shoulder measurement in garment sizing is the across-shoulder distance
    return dist * 100; // meters to cm
  }

  // Fallback: use circumference at shoulder height, scaled down
  // Shoulder "width" ≈ circumference × 0.45 (empirical ratio)
  const circ = measureCircumference(vertices, shoulderY, 'torso');
  return circ * 0.45;
}

/**
 * Compute inseam as the vertical distance from crotch height to ankle height.
 * Crotch height is estimated as the hip height minus a small offset,
 * or from the lowest point where left and right legs separate.
 */
function measureInseam(
  model: SmplModelData,
  vertices: Float32Array,
  hipY: number,
  bodyMinY: number,
  bodyHeight: number,
): number {
  // Try to get ankle landmark
  const ankleIdx = model.landmarkVertexIndices.get(LANDMARK_NAMES.leftAnkle);
  let ankleY: number;
  if (ankleIdx !== undefined) {
    ankleY = vertices[ankleIdx * 3 + 1];
  } else {
    // Fallback: ankle at ~5% of body height
    ankleY = bodyMinY + 0.05 * bodyHeight;
  }

  // Crotch height: slightly below hip center
  // In SMPL, the crotch is roughly at 45% of body height
  const crotchY = bodyMinY + 0.45 * bodyHeight;

  // Inseam = crotch to ankle (vertical distance)
  const inseamM = Math.abs(crotchY - ankleY);
  return inseamM * 100; // meters to cm
}

/**
 * Extract body measurements from SMPL mesh vertices by computing
 * circumferences at known anatomical heights.
 * Uses the SMPL landmark map to identify cross-section planes.
 *
 * @param model - Loaded SMPL model data (contains landmark map)
 * @param vertices - Computed vertex positions (6890×3 Float32Array)
 * @returns Extracted measurements in centimeters
 */
export function extractMeasurements(
  model: SmplModelData,
  vertices: Float32Array,
): ExtractedMeasurements {
  const { minY, height: bodyHeight } = computeBodyHeight(vertices);

  // Resolve Y-heights for each measurement
  const chestY = resolveHeight(model, vertices, LANDMARK_NAMES.chest, 'chest', minY, bodyHeight);
  const waistY = resolveHeight(model, vertices, LANDMARK_NAMES.waist, 'waist', minY, bodyHeight);
  const hipY = resolveHeight(model, vertices, LANDMARK_NAMES.hip, 'hip', minY, bodyHeight);
  const neckY = resolveHeight(model, vertices, LANDMARK_NAMES.neck, 'neck', minY, bodyHeight);
  const shoulderY = resolveHeight(model, vertices, LANDMARK_NAMES.leftShoulder, 'shoulder', minY, bodyHeight);

  // Bicep: midway between shoulder and elbow, use left side
  // Approximate as shoulder height - 15% of body height
  const bicepY = resolveHeight(model, vertices, undefined, 'bicep', minY, bodyHeight);

  // Thigh: just below hip, use left side
  const thighY = resolveHeight(model, vertices, undefined, 'thigh', minY, bodyHeight);

  // Calf: midway between knee and ankle, use left side
  const calfY = resolveHeight(model, vertices, undefined, 'calf', minY, bodyHeight);

  // Wrist: use left side
  const wristY = resolveHeight(model, vertices, undefined, 'wrist', minY, bodyHeight);

  // Compute circumferences
  const chestCm = measureCircumference(vertices, chestY, 'torso');
  const waistCm = measureCircumference(vertices, waistY, 'torso');
  const hipCm = measureCircumference(vertices, hipY, 'torso');
  const neckCm = measureCircumference(vertices, neckY, 'full');
  const bicepCm = measureCircumference(vertices, bicepY, 'left');
  const thighCm = measureCircumference(vertices, thighY, 'left');
  const calfCm = measureCircumference(vertices, calfY, 'left');
  const wristCm = measureCircumference(vertices, wristY, 'left');

  // Shoulder: special handling (distance, not circumference)
  const shoulderCm = measureShoulder(model, vertices, shoulderY);

  // Inseam: vertical distance
  const inseamCm = measureInseam(model, vertices, hipY, minY, bodyHeight);

  return {
    chestCm,
    waistCm,
    hipCm,
    shoulderCm,
    neckCm,
    bicepCm,
    thighCm,
    calfCm,
    wristCm,
    inseamCm,
  };
}
