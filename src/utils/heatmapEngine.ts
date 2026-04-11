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
    label: 'Round Neck Tee',
    type: 'top',
    neckline: 'round',
    sleeveEnd: 0.62,  // short sleeves end mid-upper-arm
    coverage: { hMin: 0.56, hMax: 0.78 },
    sizes: {
      'XS': { chest: 90, waist: 86, shoulder: 42 },
      'S':  { chest: 96, waist: 92, shoulder: 44 },
      'M':  { chest: 102, waist: 98, shoulder: 46 },
      'L':  { chest: 108, waist: 104, shoulder: 48 },
      'XL': { chest: 116, waist: 112, shoulder: 50 },
      'XXL':{ chest: 124, waist: 120, shoulder: 52 },
    },
  },
  'vneck-tee': {
    label: 'V-Neck Tee',
    type: 'top',
    neckline: 'vneck',
    sleeveEnd: 0.62,
    coverage: { hMin: 0.56, hMax: 0.78 },
    sizes: {
      'XS': { chest: 90, waist: 86, shoulder: 42 },
      'S':  { chest: 96, waist: 92, shoulder: 44 },
      'M':  { chest: 102, waist: 98, shoulder: 46 },
      'L':  { chest: 108, waist: 104, shoulder: 48 },
      'XL': { chest: 116, waist: 112, shoulder: 50 },
      'XXL':{ chest: 124, waist: 120, shoulder: 52 },
    },
  },
  oxford: {
    label: 'Oxford Shirt',
    type: 'top',
    neckline: 'collar',
    sleeveEnd: 0.48,  // long sleeves to wrist
    coverage: { hMin: 0.50, hMax: 0.80 },
    sizes: {
      'XS': { chest: 94, waist: 88, shoulder: 43 },
      'S':  { chest: 100, waist: 94, shoulder: 45 },
      'M':  { chest: 106, waist: 100, shoulder: 47 },
      'L':  { chest: 112, waist: 106, shoulder: 49 },
      'XL': { chest: 120, waist: 114, shoulder: 51 },
      'XXL':{ chest: 128, waist: 122, shoulder: 53 },
    },
  },
  'slim-jeans': {
    label: 'Slim Jeans',
    type: 'bottom',
    coverage: { hMin: 0.05, hMax: 0.58 },  // ankles to waist
    sizes: {
      '28': { waist: 74, hip: 92, thigh: 54 },
      '30': { waist: 79, hip: 97, thigh: 56 },
      '32': { waist: 84, hip: 102, thigh: 58 },
      '34': { waist: 89, hip: 107, thigh: 61 },
      '36': { waist: 94, hip: 112, thigh: 64 },
      '38': { waist: 99, hip: 117, thigh: 67 },
    },
  },
  'straight-jeans': {
    label: 'Straight Jeans',
    type: 'bottom',
    coverage: { hMin: 0.05, hMax: 0.58 },
    sizes: {
      '28': { waist: 76, hip: 94, thigh: 56 },
      '30': { waist: 81, hip: 99, thigh: 58 },
      '32': { waist: 86, hip: 104, thigh: 60 },
      '34': { waist: 91, hip: 109, thigh: 63 },
      '36': { waist: 96, hip: 114, thigh: 66 },
      '38': { waist: 101, hip: 119, thigh: 69 },
    },
  },
};

/** Ease targets per fit preference (cm of ease considered ideal) */
const easeTargets: Record<FitPreference, Record<string, [number, number]>> = {
  compression: { chest: [-2, 1], waist: [-2, 1], hip: [-1, 2], thigh: [-1, 2], shoulder: [0, 1] },
  slim:        { chest: [2, 6], waist: [0, 4], hip: [2, 6], thigh: [1, 4], shoulder: [1, 3] },
  regular:     { chest: [6, 11], waist: [4, 9], hip: [6, 11], thigh: [4, 8], shoulder: [2, 5] },
  relaxed:     { chest: [11, 17], waist: [9, 15], hip: [11, 18], thigh: [8, 14], shoulder: [4, 8] },
  oversized:   { chest: [17, 25], waist: [15, 22], hip: [18, 26], thigh: [14, 22], shoulder: [8, 14] },
};

/** Map body height regions to measurement names */
const heightToMeasurement: Array<{ hCenter: number; hWidth: number; measurement: string }> = [
  { hCenter: 0.77, hWidth: 0.03, measurement: 'shoulder' },
  { hCenter: 0.68, hWidth: 0.05, measurement: 'chest' },
  { hCenter: 0.58, hWidth: 0.04, measurement: 'waist' },
  { hCenter: 0.50, hWidth: 0.04, measurement: 'hip' },
  { hCenter: 0.36, hWidth: 0.06, measurement: 'thigh' },
];

export interface HeatmapResult {
  /** For each vertex: check if covered by garment and get fit score */
  getVertexFit(normalizedHeight: number, xAbs: number, yPos: number, distFromCenter: number): { covered: boolean; fitScore: number };
}

/**
 * Compute heatmap data for a garment on a body.
 * Returns a function that maps vertex height to fit score.
 */
export function computeHeatmap(
  garmentType: GarmentType,
  size: string,
  fitPref: FitPreference,
  bodyMeasurements: { bustCm: number; waistCm: number; hipCm: number; inseamCm: number },
): HeatmapResult | null {
  if (garmentType === 'none') return null;

  const garment = garments[garmentType];
  if (!garment) return null;

  const sizeData = garment.sizes[size];
  if (!sizeData) return null;

  // Map body measurements to garment measurement names
  const bodyMap: Record<string, number> = {
    chest: bodyMeasurements.bustCm,
    waist: bodyMeasurements.waistCm,
    hip: bodyMeasurements.hipCm,
    thigh: bodyMeasurements.hipCm * 0.56,  // estimate thigh from hip
    shoulder: bodyMeasurements.bustCm * 0.45,  // estimate shoulder from chest
  };

  // Compute ease and fit score for each measurement the garment has
  const regionFits: Array<{ hCenter: number; hWidth: number; fitScore: number }> = [];

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
    regionFits.push({ hCenter: region.hCenter, hWidth: region.hWidth, fitScore });
  }

  const { hMin, hMax } = garment.coverage;

  // Garment shape parameters
  const isTop = garment.type === 'top';

  return {
    getVertexFit(h: number, xAbs: number, yPos: number, distFromCenter: number) {
      // --- Garment shape coverage ---
      if (isTop) {
        // Head: never covered
        if (h > 0.83) return { covered: false, fitScore: 0 };
        // Below hem
        if (h < hMin) return { covered: false, fitScore: 0 };

        // Neckline cutout
        const neckline = garment.neckline ?? 'round';
        if (neckline === 'round') {
          if (h > 0.78 && distFromCenter < 0.06) return { covered: false, fitScore: 0 };
        } else if (neckline === 'vneck') {
          if (h > 0.78 && distFromCenter < 0.06) return { covered: false, fitScore: 0 };
          // V extends down on front only
          if (h > 0.73 && h < 0.80 && distFromCenter < 0.04 && yPos > 0) return { covered: false, fitScore: 0 };
        } else {
          if (h > 0.80 && distFromCenter < 0.05) return { covered: false, fitScore: 0 };
        }

        // Sleeve logic: only for arm vertices (far from torso center)
        const sleeveEnd = garment.sleeveEnd ?? 0.62;
        const isFarFromTorso = distFromCenter > 0.16;
        if (isFarFromTorso) {
          // This is an arm/hand vertex
          if (h < sleeveEnd) return { covered: false, fitScore: 0 };  // below sleeve end
          if (h < 0.50) return { covered: false, fitScore: 0 };  // hands always uncovered
        }
      } else {
        // Jeans / pants shape:
        // Above waist: not covered
        if (h > hMax) return { covered: false, fitScore: 0 };
        // Below ankles
        if (h < 0.04) return { covered: false, fitScore: 0 };
        // Hands only: far from center AND at hand height (h 0.35-0.52)
        if (distFromCenter > 0.22 && h > 0.35 && h < 0.55) return { covered: false, fitScore: 0 };
      }

      // Blend fit scores from nearby regions using Gaussian weights
      let totalWeight = 0;
      let weightedScore = 0;
      for (const rf of regionFits) {
        const dist = Math.abs(h - rf.hCenter);
        const w = Math.exp(-(dist * dist) / (2 * rf.hWidth * rf.hWidth));
        totalWeight += w;
        weightedScore += w * rf.fitScore;
      }

      const fitScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
      return { covered: true, fitScore };
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
