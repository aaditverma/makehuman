/**
 * Default size chart data for all garment types.
 *
 * Mapping: garmentType → sizeLabel → measurementKey → value (cm).
 *
 * This is the single source of truth consumed by sizeChartEngine.ts.
 * heatmapEngine.ts still keeps its own inline copy for now (will be
 * migrated in a later task).
 */
export const DEFAULT_SIZE_CHARTS: Record<string, Record<string, Record<string, number>>> = {
  tee: {
    'XS': { chest: 90, waist: 86, shoulder: 42, neck: 36, bicep: 30 },
    'S':  { chest: 96, waist: 92, shoulder: 44, neck: 37, bicep: 32 },
    'M':  { chest: 102, waist: 98, shoulder: 46, neck: 38, bicep: 34 },
    'L':  { chest: 108, waist: 104, shoulder: 48, neck: 39, bicep: 36 },
    'XL': { chest: 116, waist: 112, shoulder: 50, neck: 41, bicep: 38 },
    'XXL': { chest: 124, waist: 120, shoulder: 52, neck: 43, bicep: 40 },
  },
  oxford: {
    'XS': { chest: 94, waist: 88, shoulder: 43, neck: 37, bicep: 31, wrist: 17 },
    'S':  { chest: 100, waist: 94, shoulder: 45, neck: 38, bicep: 33, wrist: 18 },
    'M':  { chest: 106, waist: 100, shoulder: 47, neck: 39, bicep: 35, wrist: 19 },
    'L':  { chest: 112, waist: 106, shoulder: 49, neck: 41, bicep: 37, wrist: 20 },
    'XL': { chest: 120, waist: 114, shoulder: 51, neck: 43, bicep: 39, wrist: 21 },
    'XXL': { chest: 128, waist: 122, shoulder: 53, neck: 45, bicep: 41, wrist: 22 },
  },
  'slim-jeans': {
    '28': { waist: 74, hip: 92, thigh: 54, calf: 34, inseam: 76 },
    '30': { waist: 79, hip: 97, thigh: 56, calf: 36, inseam: 78 },
    '32': { waist: 84, hip: 102, thigh: 58, calf: 38, inseam: 80 },
    '34': { waist: 89, hip: 107, thigh: 61, calf: 40, inseam: 82 },
    '36': { waist: 94, hip: 112, thigh: 64, calf: 42, inseam: 84 },
    '38': { waist: 99, hip: 117, thigh: 67, calf: 44, inseam: 86 },
  },
  'straight-jeans': {
    '28': { waist: 76, hip: 94, thigh: 56, calf: 36, inseam: 76 },
    '30': { waist: 81, hip: 99, thigh: 58, calf: 38, inseam: 78 },
    '32': { waist: 86, hip: 104, thigh: 60, calf: 40, inseam: 80 },
    '34': { waist: 91, hip: 109, thigh: 63, calf: 42, inseam: 82 },
    '36': { waist: 96, hip: 114, thigh: 66, calf: 44, inseam: 84 },
    '38': { waist: 101, hip: 119, thigh: 69, calf: 46, inseam: 86 },
  },
};
