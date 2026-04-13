import type { GarmentType } from '../stores/bodyStore';
import { DEFAULT_SIZE_CHARTS } from '../data/defaultSizeCharts';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface SizeMeasurements {
  chest?: number;
  waist?: number;
  hip?: number;
  shoulder?: number;
  neck?: number;
  bicep?: number;
  thigh?: number;
  calf?: number;
  inseam?: number;
  wrist?: number;
}

export interface BrandSizeChart {
  brand: string;
  garmentType: GarmentType;
  sizes: Record<string, SizeMeasurements>;
}

// ── Required measurements per garment type ──────────────────────────────────

export const REQUIRED_MEASUREMENTS: Record<string, string[]> = {
  tee:              ['chest', 'waist', 'shoulder'],
  oxford:           ['chest', 'waist', 'shoulder', 'neck'],
  'slim-jeans':     ['waist', 'hip', 'thigh', 'inseam'],
  'straight-jeans': ['waist', 'hip', 'thigh', 'inseam'],
};

const KNOWN_GARMENT_TYPES = new Set(Object.keys(REQUIRED_MEASUREMENTS));

// ── Validation ──────────────────────────────────────────────────────────────

export function validateBrandSizeChart(chart: BrandSizeChart): string[] {
  const errors: string[] = [];

  if (!chart.brand || typeof chart.brand !== 'string' || chart.brand.trim() === '') {
    errors.push('brand must be a non-empty string');
  }

  if (!KNOWN_GARMENT_TYPES.has(chart.garmentType)) {
    errors.push(`garmentType "${chart.garmentType}" is not a known garment type`);
  }

  const sizeKeys = Object.keys(chart.sizes ?? {});
  if (sizeKeys.length === 0) {
    errors.push('sizes must have at least one entry');
  }

  const required = KNOWN_GARMENT_TYPES.has(chart.garmentType)
    ? REQUIRED_MEASUREMENTS[chart.garmentType]
    : undefined;

  for (const sizeLabel of sizeKeys) {
    const measurements = chart.sizes[sizeLabel];

    if (required) {
      for (const key of required) {
        const val = measurements[key as keyof SizeMeasurements];
        if (val == null) {
          errors.push(`size "${sizeLabel}" is missing required measurement "${key}"`);
        }
      }
    }

    // Check all present values are positive finite numbers
    for (const [key, val] of Object.entries(measurements)) {
      if (val != null) {
        if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) {
          errors.push(`size "${sizeLabel}" measurement "${key}" must be a positive finite number, got ${val}`);
        }
      }
    }
  }

  return errors;
}

// ── Parsing & Serialization ─────────────────────────────────────────────────

export function parseBrandSizeChart(json: string): BrandSizeChart {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON string');
  }

  const chart = parsed as BrandSizeChart;
  const errors = validateBrandSizeChart(chart);
  if (errors.length > 0) {
    throw new Error(`Invalid BrandSizeChart: ${errors.join('; ')}`);
  }

  return chart;
}

export function stringifyBrandSizeChart(chart: BrandSizeChart): string {
  return JSON.stringify(chart);
}



// ── Active size chart resolution ────────────────────────────────────────────

export function getActiveSizeChart(
  garmentType: GarmentType,
  brandChart?: BrandSizeChart | null,
): Record<string, Record<string, number>> {
  // If a brand chart is provided, validate and use it if it matches the garment type
  if (brandChart && brandChart.garmentType === garmentType) {
    const errors = validateBrandSizeChart(brandChart);
    if (errors.length === 0) {
      // Convert SizeMeasurements to Record<string, number>
      const result: Record<string, Record<string, number>> = {};
      for (const [sizeLabel, measurements] of Object.entries(brandChart.sizes)) {
        const numericMap: Record<string, number> = {};
        for (const [key, val] of Object.entries(measurements)) {
          if (typeof val === 'number') {
            numericMap[key] = val;
          }
        }
        result[sizeLabel] = numericMap;
      }
      return result;
    }
  }

  // Fall back to default chart
  return DEFAULT_SIZE_CHARTS[garmentType] ?? {};
}
