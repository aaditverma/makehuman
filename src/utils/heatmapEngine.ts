import type { GarmentType, FitPreference } from '../stores/bodyStore';

/** Garment coverage: which body height ranges does this garment cover? */
interface GarmentCoverage {
  regions: Array<{
    name: string;
    hMin: number;  // normalized height 0-1
    hMax: number;
    bodyMeasurement: string;  // key in estimated measurements
    garmentMeasurement: number;  // garment measurement in cm for this size
  }>;
}

/** Garment size chart */
interface GarmentSizeChart {
  label: string;
  type: 'top' | 'bottom';
  neckline?: 'round' | 'vneck' | 'collar';
  sleeveEnd?: number;  // normalized height where sleeve ends (lower = longer)
  sizes: Record<string, Record<string, number>>;
  coverage: { hMin: number; hMax: number };
}

const garments: Record<string, GarmentSizeChart> = {
  tee: {
    label: 'T-Shirt',
    type: 'top',
    neckline: 'round',
    sleeveEnd: 0.60,
    coverage: { hMin: 0.44, hMax: 0.82 },
    sizes: {
      'XS': { chest: 90, waist: 86, shoulder: 42, neck: 36, bicep: 30 },
      'S':  { chest: 96, waist: 92, shoulder: 44, neck: 37, bicep: 32 },
      'M':  { chest: 102, waist: 98, shoulder: 46, neck: 38, bicep: 34 },
      'L':  { chest: 108, waist: 104, shoulder: 48, neck: 39, bicep: 36 },
      'XL': { chest: 116, waist: 112, shoulder: 50, neck: 41, bicep: 38 },
      'XXL':{ chest: 124, waist: 120, shoulder: 52, neck: 43, bicep: 40 },
    },
  },
  oxford: {
    label: 'Oxford Shirt',
    type: 'top',
    neckline: 'collar',
    sleeveEnd: 0.48,  // long sleeves to wrist
    coverage: { hMin: 0.44, hMax: 0.82 },
    sizes: {
      'XS': { chest: 94, waist: 88, shoulder: 43, neck: 37, bicep: 31, wrist: 17 },
      'S':  { chest: 100, waist: 94, shoulder: 45, neck: 38, bicep: 33, wrist: 18 },
      'M':  { chest: 106, waist: 100, shoulder: 47, neck: 39, bicep: 35, wrist: 19 },
      'L':  { chest: 112, waist: 106, shoulder: 49, neck: 41, bicep: 37, wrist: 20 },
      'XL': { chest: 120, waist: 114, shoulder: 51, neck: 43, bicep: 39, wrist: 21 },
      'XXL':{ chest: 128, waist: 122, shoulder: 53, neck: 45, bicep: 41, wrist: 22 },
    },
  },
  'slim-jeans': {
    label: 'Slim Jeans',
    type: 'bottom',
    coverage: { hMin: 0.05, hMax: 0.58 },  // ankles to waist
    sizes: {
      '28': { waist: 74, hip: 92, thigh: 54, calf: 34, inseam: 76 },
      '30': { waist: 79, hip: 97, thigh: 56, calf: 36, inseam: 78 },
      '32': { waist: 84, hip: 102, thigh: 58, calf: 38, inseam: 80 },
      '34': { waist: 89, hip: 107, thigh: 61, calf: 40, inseam: 82 },
      '36': { waist: 94, hip: 112, thigh: 64, calf: 42, inseam: 84 },
      '38': { waist: 99, hip: 117, thigh: 67, calf: 44, inseam: 86 },
    },
  },
  'straight-jeans': {
    label: 'Straight Jeans',
    type: 'bottom',
    coverage: { hMin: 0.05, hMax: 0.58 },
    sizes: {
      '28': { waist: 76, hip: 94, thigh: 56, calf: 36, inseam: 76 },
      '30': { waist: 81, hip: 99, thigh: 58, calf: 38, inseam: 78 },
      '32': { waist: 86, hip: 104, thigh: 60, calf: 40, inseam: 80 },
      '34': { waist: 91, hip: 109, thigh: 63, calf: 42, inseam: 82 },
      '36': { waist: 96, hip: 114, thigh: 66, calf: 44, inseam: 84 },
      '38': { waist: 101, hip: 119, thigh: 69, calf: 46, inseam: 86 },
    },
  },
};

/** Ease targets per fit preference (cm of ease considered ideal) */
const easeTargets: Record<FitPreference, Record<string, [number, number]>> = {
  compression: { chest: [-2, 1], waist: [-2, 1], hip: [-1, 2], thigh: [-1, 2], shoulder: [0, 1], neck: [0, 1], bicep: [-1, 1], calf: [-1, 1], wrist: [0, 0.5], inseam: [-1, 1] },
  slim:        { chest: [2, 6], waist: [0, 4], hip: [2, 6], thigh: [1, 4], shoulder: [1, 3], neck: [1, 2], bicep: [1, 3], calf: [1, 3], wrist: [0.5, 1.5], inseam: [-1, 2] },
  regular:     { chest: [6, 11], waist: [4, 9], hip: [6, 11], thigh: [4, 8], shoulder: [2, 5], neck: [2, 4], bicep: [3, 6], calf: [3, 6], wrist: [1.5, 3], inseam: [0, 3] },
  relaxed:     { chest: [11, 17], waist: [9, 15], hip: [11, 18], thigh: [8, 14], shoulder: [4, 8], neck: [4, 7], bicep: [6, 10], calf: [6, 10], wrist: [3, 5], inseam: [2, 5] },
  oversized:   { chest: [17, 25], waist: [15, 22], hip: [18, 26], thigh: [14, 22], shoulder: [8, 14], neck: [7, 11], bicep: [10, 16], calf: [10, 16], wrist: [5, 8], inseam: [4, 8] },
};

/** Map body height regions to measurement names */
const heightToMeasurement: Array<{ hCenter: number; hWidth: number; measurement: string; measurementWeight: number }> = [
  { hCenter: 0.85, hWidth: 0.03, measurement: 'neck',     measurementWeight: 0.5 },
  { hCenter: 0.77, hWidth: 0.03, measurement: 'shoulder', measurementWeight: 0.9 },
  { hCenter: 0.68, hWidth: 0.05, measurement: 'chest',    measurementWeight: 1.0 },
  { hCenter: 0.62, hWidth: 0.04, measurement: 'bicep',    measurementWeight: 0.6 },
  { hCenter: 0.58, hWidth: 0.04, measurement: 'waist',    measurementWeight: 1.0 },
  { hCenter: 0.50, hWidth: 0.04, measurement: 'hip',      measurementWeight: 0.9 },
  { hCenter: 0.48, hWidth: 0.03, measurement: 'wrist',    measurementWeight: 0.4 },
  { hCenter: 0.36, hWidth: 0.06, measurement: 'thigh',    measurementWeight: 0.9 },
  { hCenter: 0.18, hWidth: 0.05, measurement: 'calf',     measurementWeight: 0.5 },
];

export interface BodyMeasurementsInput {
  bustCm: number;
  waistCm: number;
  hipCm: number;
  inseamCm: number;
  shoulderCm: number;
  neckCm: number;
  bicepCm: number;
  thighCm: number;
  calfCm: number;
  wristCm: number;
}

export interface HeatmapResult {
  getVertexFit(normalizedHeight: number, xAbs: number, yPos: number, distFromCenter: number, normalXAbs?: number, normalYAbs?: number): { covered: boolean; fitScore: number; edgeFade: number };
}

/**
 * Compute heatmap data for a garment on a body.
 * Returns a function that maps vertex height to fit score.
 */
export function computeHeatmap(
  garmentType: GarmentType,
  size: string,
  fitPref: FitPreference,
  bodyMeasurements: BodyMeasurementsInput,
  sizeChartOverride?: Record<string, number> | null,
): HeatmapResult | null {
  if (garmentType === 'none') return null;

  const garment = garments[garmentType];
  if (!garment) return null;

  const sizeData = sizeChartOverride ?? garment.sizes[size];
  if (!sizeData) return null;

  // Map body measurements to garment measurement names
  const bodyMap: Record<string, number> = {
    chest: bodyMeasurements.bustCm,
    waist: bodyMeasurements.waistCm,
    hip: bodyMeasurements.hipCm,
    thigh: bodyMeasurements.thighCm,       // was: hipCm * 0.56
    shoulder: bodyMeasurements.shoulderCm,  // was: bustCm * 0.45
    neck: bodyMeasurements.neckCm,
    bicep: bodyMeasurements.bicepCm,
    calf: bodyMeasurements.calfCm,
    wrist: bodyMeasurements.wristCm,
    inseam: bodyMeasurements.inseamCm,
  };

  // Compute ease and fit score for each measurement the garment has
  const regionFits: Array<{ hCenter: number; hWidth: number; fitScore: number; measurementWeight: number }> = [];

  for (const region of heightToMeasurement) {
    const garmentVal = sizeData[region.measurement];
    const bodyVal = bodyMap[region.measurement];
    if (garmentVal == null || bodyVal == null) continue;

    const ease = garmentVal - bodyVal;
    const [idealMin, idealMax] = easeTargets[fitPref][region.measurement] ?? [4, 10];
    const idealCenter = (idealMin + idealMax) / 2;
    const idealRange = (idealMax - idealMin) / 2;

    // fitScore: 0 = perfect, negative = tight, positive = loose
    let fitScore: number;
    if (ease < idealMin) {
      fitScore = -(idealMin - ease) / Math.max(1, idealRange * 2);  // tight
    } else if (ease > idealMax) {
      fitScore = (ease - idealMax) / Math.max(1, idealRange * 2);   // loose
    } else {
      fitScore = (ease - idealCenter) / Math.max(1, idealRange) * 0.3;  // within range, slight bias
    }

    fitScore = Math.max(-1, Math.min(1, fitScore));
    regionFits.push({ hCenter: region.hCenter, hWidth: region.hWidth, fitScore, measurementWeight: region.measurementWeight });
  }

  const { hMin, hMax } = garment.coverage;

  // Garment shape parameters
  const isTop = garment.type === 'top';

  return {
    getVertexFit(h: number, xAbs: number, yPos: number, distFromCenter: number, normalXAbs: number = 0, normalYAbs: number = 0) {
      // --- Garment shape coverage ---
      if (isTop) {
        // Coverage: between hem and top
        if (h < hMin) return { covered: false, fitScore: 0, edgeFade: 0 };
        if (h > 0.83) return { covered: false, fitScore: 0, edgeFade: 0 };

        // Neckline cutout — small area at top center
        const neckline = garment.neckline ?? 'round';
        if (neckline === 'round') {
          if (h > 0.78 && distFromCenter < 0.06) return { covered: false, fitScore: 0, edgeFade: 0 };
        } else if (neckline === 'vneck') {
          if (h > 0.78 && distFromCenter < 0.06) return { covered: false, fitScore: 0, edgeFade: 0 };
          if (h > 0.73 && h < 0.80 && distFromCenter < 0.04 && yPos > 0) return { covered: false, fitScore: 0, edgeFade: 0 };
        } else {
          if (h > 0.80 && distFromCenter < 0.05) return { covered: false, fitScore: 0, edgeFade: 0 };
        }

        // Hands: exclude hand vertices
        if (distFromCenter > 0.22 && h < 0.52) return { covered: false, fitScore: 0, edgeFade: 0 };

        // Sleeve cutoff: arm vertices below sleeveEnd are uncovered
        // Three-signal arm detection to avoid catching side torso:
        // armScore combines normal direction + X position
        // Side torso: normalXAbs ~0.4-0.6, xAbs ~0.10-0.15 → score ~0.7-1.1
        // Actual arms: normalXAbs ~0.7-1.0, xAbs ~0.15-0.35 → score ~1.2-2.0
        const sleeveEnd = garment.sleeveEnd;
        if (sleeveEnd != null && h < sleeveEnd) {
          const armScore = normalXAbs + xAbs * 3;
          if (armScore > 1.3) {
            // Clear arm — uncovered (unchanged)
            return { covered: false, fitScore: 0, edgeFade: 0 };
          } else if (armScore >= 1.0 && normalYAbs <= 0.25) {
            // Gray zone arm — uncovered
            return { covered: false, fitScore: 0, edgeFade: 0 };
          }
          // Gray zone side torso (armScore 1.0-1.3, normalYAbs > 0.25) → covered (falls through)
          // Deep torso (armScore < 1.0) → covered (falls through)
        }
      } else {
        // Jeans / pants shape:
        // Above waist: not covered
        if (h > hMax) return { covered: false, fitScore: 0, edgeFade: 0 };
        // Below ankles
        if (h < 0.04) return { covered: false, fitScore: 0, edgeFade: 0 };
        // Hands only: far from center AND at hand height AND arm-like normals
        // Use armScore to avoid catching side hip/thigh vertices
        if (distFromCenter > 0.22 && h > 0.35 && h < 0.55) {
          const armScore = normalXAbs + xAbs * 3;
          if (armScore > 1.0) {
            return { covered: false, fitScore: 0, edgeFade: 0 };
          }
        }
      }

      // Blend fit scores from nearby regions using Gaussian weights
      let totalWeight = 0;
      let weightedScore = 0;
      for (const rf of regionFits) {
        const dist = Math.abs(h - rf.hCenter);
        const gaussianW = Math.exp(-(dist * dist) / (2 * rf.hWidth * rf.hWidth));
        const w = gaussianW * rf.measurementWeight;
        totalWeight += w;
        weightedScore += w * rf.fitScore;
      }

      const fitScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

      // Edge fade: how close to garment boundary (0 = at edge, 1 = well inside)
      let edgeFade = 1.0;
      if (isTop) {
        // Fade near hem
        const effectiveHMin = hMin;
        const hemDist = (h - effectiveHMin) / 0.015;
        if (hemDist < 1) edgeFade = Math.min(edgeFade, Math.max(0, hemDist));
        // Fade near neckline
        const neckDist = (0.82 - h) / 0.015;
        if (neckDist < 1 && h > 0.75) edgeFade = Math.min(edgeFade, Math.max(0, neckDist));
        // Fade near sleeve end — for arm vertices (clear arm + gray zone arm)
        const sleeveEnd = garment.sleeveEnd ?? 0.62;
        const armScore = normalXAbs + xAbs * 3;
        const isArm = armScore > 1.3 || (armScore >= 1.0 && normalYAbs <= 0.25);
        if (isArm) {
          const sleeveDist = (h - sleeveEnd) / 0.015;
          if (sleeveDist < 1) edgeFade = Math.min(edgeFade, Math.max(0, sleeveDist));
        }
      } else {
        // Fade near waistband
        const waistDist = (hMax - h) / 0.02;
        if (waistDist < 1) edgeFade = Math.min(edgeFade, Math.max(0, waistDist));
        // Fade near ankles
        const ankleDist = (h - 0.04) / 0.02;
        if (ankleDist < 1) edgeFade = Math.min(edgeFade, Math.max(0, ankleDist));
        // Fade near hand exclusion boundary for side vertices
        if (distFromCenter > 0.18 && h > 0.35 && h < 0.55) {
          const sideDist = (0.22 - distFromCenter) / 0.04;
          if (sideDist < 1 && sideDist >= 0) edgeFade = Math.min(edgeFade, Math.max(0, sideDist));
        }
      }

      return { covered: true, fitScore, edgeFade };
    },
  };
}

/** Convert fit score to RGB color. -1=red(tight), 0=green(balanced), +1=blue(loose) */
export function fitScoreToColor(score: number): [number, number, number] {
  if (score < -0.1) {
    // Tight: red
    const t = Math.min(1, (-score - 0.1) / 0.9);
    return [0.9 + t * 0.1, 0.3 * (1 - t), 0.2 * (1 - t)];
  }
  if (score > 0.1) {
    // Loose: blue
    const t = Math.min(1, (score - 0.1) / 0.9);
    return [0.2 * (1 - t), 0.4 * (1 - t), 0.7 + t * 0.3];
  }
  // Balanced: green
  const t = Math.abs(score) / 0.1;
  return [0.2 + t * 0.3, 0.75 - t * 0.1, 0.3 + t * 0.1];
}

export function getGarmentOptions() {
  return Object.entries(garments).map(([id, g]) => ({
    id,
    label: g.label,
    type: g.type,
    sizes: Object.keys(g.sizes),
  }));
}
