import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  validateBrandSizeChart,
  parseBrandSizeChart,
  stringifyBrandSizeChart,
  getActiveSizeChart,
  REQUIRED_MEASUREMENTS,
} from '../sizeChartEngine';
import type { BrandSizeChart, SizeMeasurements } from '../sizeChartEngine';
import type { GarmentType } from '../../stores/bodyStore';
import { DEFAULT_SIZE_CHARTS } from '../../data/defaultSizeCharts';

// ── Helpers ─────────────────────────────────────────────────────────────────

const KNOWN_GARMENT_TYPES: GarmentType[] = ['tee', 'oxford', 'slim-jeans', 'straight-jeans'];

/** Build a full SizeMeasurements object with all required keys for a garment type. */
function buildRequiredMeasurements(
  garmentType: string,
  valueFn: () => number,
): SizeMeasurements {
  const keys = REQUIRED_MEASUREMENTS[garmentType] ?? [];
  const m: Record<string, number> = {};
  for (const k of keys) m[k] = valueFn();
  return m as SizeMeasurements;
}

// ── Generators ──────────────────────────────────────────────────────────────

/** Arbitrary positive finite number suitable for measurements (0.1 – 500). */
const arbPositiveMeasurement = fc.double({ min: 0.1, max: 500, noNaN: true, noDefaultInfinity: true });

/** Arbitrary known garment type. */
const arbGarmentType = fc.constantFrom(...KNOWN_GARMENT_TYPES);

/** Arbitrary non-empty brand string. */
const arbBrand = fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0);

/** Arbitrary size label (e.g. "S", "M", "32"). */
const arbSizeLabel = fc.string({ minLength: 1, maxLength: 5, unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('')) });

/** Generate a valid SizeMeasurements for a given garment type. */
function arbValidMeasurements(garmentType: GarmentType): fc.Arbitrary<SizeMeasurements> {
  const required = REQUIRED_MEASUREMENTS[garmentType] ?? [];
  return fc.tuple(...required.map(() => arbPositiveMeasurement)).map(vals => {
    const m: Record<string, number> = {};
    required.forEach((k, i) => { m[k] = vals[i]; });
    return m as SizeMeasurements;
  });
}

/** Generate a fully valid BrandSizeChart. */
const arbValidChart: fc.Arbitrary<BrandSizeChart> = arbGarmentType.chain(gt =>
  fc.tuple(
    arbBrand,
    fc.constant(gt),
    fc.array(
      fc.tuple(arbSizeLabel, arbValidMeasurements(gt)),
      { minLength: 1, maxLength: 6 },
    ),
  ).map(([brand, garmentType, entries]) => ({
    brand,
    garmentType,
    sizes: Object.fromEntries(entries),
  })),
);

// ── Property Tests ──────────────────────────────────────────────────────────

describe('Size Chart Engine — Property Tests', () => {
  /**
   * Property 1: Size chart validation correctness
   *
   * **Validates: Requirements 7.2, 7.6**
   *
   * For any BrandSizeChart object, validateBrandSizeChart() returns an empty
   * array iff all conditions are met (brand non-empty, garmentType known,
   * sizes has ≥1 entry, required measurements present, all values positive
   * finite). Non-empty otherwise.
   */
  describe('Property 1: Validation correctness', () => {
    it('returns empty errors for any valid BrandSizeChart', () => {
      fc.assert(
        fc.property(arbValidChart, (chart) => {
          const errors = validateBrandSizeChart(chart);
          expect(errors).toEqual([]);
        }),
        { numRuns: 100 },
      );
    });

    it('returns non-empty errors when brand is empty', () => {
      const arbEmptyBrand = arbGarmentType.chain(gt =>
        fc.tuple(
          fc.constant(gt),
          fc.array(
            fc.tuple(arbSizeLabel, arbValidMeasurements(gt)),
            { minLength: 1, maxLength: 3 },
          ),
        ).map(([garmentType, entries]) => ({
          brand: '',
          garmentType,
          sizes: Object.fromEntries(entries),
        })),
      );

      fc.assert(
        fc.property(arbEmptyBrand, (chart) => {
          const errors = validateBrandSizeChart(chart);
          expect(errors.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    it('returns non-empty errors when garmentType is unknown', () => {
      const arbUnknownType = fc.string({ minLength: 1, maxLength: 10 })
        .filter(s => !KNOWN_GARMENT_TYPES.includes(s as GarmentType) && s !== 'none');

      const arbInvalidTypeChart = arbUnknownType.chain(gt =>
        fc.tuple(
          arbBrand,
          fc.constant(gt as GarmentType),
          fc.dictionary(arbSizeLabel, fc.record({
            chest: arbPositiveMeasurement,
            waist: arbPositiveMeasurement,
            shoulder: arbPositiveMeasurement,
          }) as fc.Arbitrary<SizeMeasurements>, { minKeys: 1, maxKeys: 3 }),
        ).map(([brand, garmentType, sizes]) => ({
          brand,
          garmentType,
          sizes,
        })),
      );

      fc.assert(
        fc.property(arbInvalidTypeChart, (chart) => {
          const errors = validateBrandSizeChart(chart);
          expect(errors.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    it('returns non-empty errors when sizes is empty', () => {
      const arbEmptySizes = fc.tuple(arbBrand, arbGarmentType).map(([brand, garmentType]) => ({
        brand,
        garmentType,
        sizes: {} as Record<string, SizeMeasurements>,
      }));

      fc.assert(
        fc.property(arbEmptySizes, (chart) => {
          const errors = validateBrandSizeChart(chart);
          expect(errors.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    it('returns non-empty errors when a measurement is negative', () => {
      const arbNegativeVal = fc.double({ min: -1000, max: -0.001, noNaN: true, noDefaultInfinity: true });

      const arbChartWithNeg = arbGarmentType.chain(gt => {
        const required = REQUIRED_MEASUREMENTS[gt];
        // Build measurements where the first required key is negative
        return fc.tuple(
          arbBrand,
          fc.constant(gt),
          arbSizeLabel,
          arbNegativeVal,
          fc.tuple(...required.slice(1).map(() => arbPositiveMeasurement)),
        ).map(([brand, garmentType, label, negVal, restVals]) => {
          const m: Record<string, number> = {};
          m[required[0]] = negVal;
          required.slice(1).forEach((k, i) => { m[k] = restVals[i]; });
          return {
            brand,
            garmentType,
            sizes: { [label]: m as SizeMeasurements },
          };
        });
      });

      fc.assert(
        fc.property(arbChartWithNeg, (chart) => {
          const errors = validateBrandSizeChart(chart);
          expect(errors.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });

    it('returns non-empty errors when a required measurement is missing', () => {
      const arbChartMissingKey = arbGarmentType.chain(gt => {
        const required = REQUIRED_MEASUREMENTS[gt];
        // Omit the last required key
        const partial = required.slice(0, -1);
        return fc.tuple(
          arbBrand,
          fc.constant(gt),
          arbSizeLabel,
          fc.tuple(...partial.map(() => arbPositiveMeasurement)),
        ).map(([brand, garmentType, label, vals]) => {
          const m: Record<string, number> = {};
          partial.forEach((k, i) => { m[k] = vals[i]; });
          return {
            brand,
            garmentType,
            sizes: { [label]: m as SizeMeasurements },
          };
        });
      });

      fc.assert(
        fc.property(arbChartMissingKey, (chart) => {
          const errors = validateBrandSizeChart(chart);
          expect(errors.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 },
      );
    });
  });

  /**
   * Property 2: Serialization round-trip
   *
   * **Validates: Requirements 9.3, 9.4**
   *
   * For any valid BrandSizeChart, parseBrandSizeChart(stringifyBrandSizeChart(chart))
   * deep-equals the original chart.
   */
  describe('Property 2: Serialization round-trip', () => {
    it('parse(stringify(chart)) deep-equals original for any valid chart', () => {
      fc.assert(
        fc.property(arbValidChart, (chart) => {
          const json = stringifyBrandSizeChart(chart);
          const parsed = parseBrandSizeChart(json);
          expect(parsed).toEqual(chart);
        }),
        { numRuns: 100 },
      );
    });
  });
});

// ── Unit Tests ──────────────────────────────────────────────────────────────

describe('Size Chart Engine — Unit Tests', () => {
  const validChartObj: BrandSizeChart = {
    brand: 'TestBrand',
    garmentType: 'tee',
    sizes: {
      M: { chest: 100, waist: 96, shoulder: 45 },
    },
  };

  const validChartJson = JSON.stringify(validChartObj);

  // ── parseBrandSizeChart ─────────────────────────────────────────────────

  it('parseBrandSizeChart parses known valid JSON to expected object', () => {
    const result = parseBrandSizeChart(validChartJson);
    expect(result).toEqual(validChartObj);
  });

  it('parseBrandSizeChart throws on malformed JSON', () => {
    expect(() => parseBrandSizeChart('{invalid json')).toThrow();
  });

  // ── validateBrandSizeChart ──────────────────────────────────────────────

  it('validateBrandSizeChart rejects empty brand string', () => {
    const chart: BrandSizeChart = { ...validChartObj, brand: '' };
    const errors = validateBrandSizeChart(chart);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.toLowerCase().includes('brand'))).toBe(true);
  });

  it('validateBrandSizeChart rejects unknown garment type', () => {
    const chart: BrandSizeChart = { ...validChartObj, garmentType: 'poncho' as GarmentType };
    const errors = validateBrandSizeChart(chart);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.toLowerCase().includes('garment'))).toBe(true);
  });

  it('validateBrandSizeChart rejects missing required measurements', () => {
    const chart: BrandSizeChart = {
      brand: 'TestBrand',
      garmentType: 'oxford',
      sizes: {
        M: { chest: 100, waist: 96 } as SizeMeasurements, // missing shoulder, neck
      },
    };
    const errors = validateBrandSizeChart(chart);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('shoulder') || e.includes('neck'))).toBe(true);
  });

  it('validateBrandSizeChart rejects negative measurement values', () => {
    const chart: BrandSizeChart = {
      brand: 'TestBrand',
      garmentType: 'tee',
      sizes: { M: { chest: -5, waist: 96, shoulder: 45 } },
    };
    const errors = validateBrandSizeChart(chart);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('positive finite'))).toBe(true);
  });

  it('validateBrandSizeChart rejects NaN measurement values', () => {
    const chart: BrandSizeChart = {
      brand: 'TestBrand',
      garmentType: 'tee',
      sizes: { M: { chest: NaN, waist: 96, shoulder: 45 } },
    };
    const errors = validateBrandSizeChart(chart);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('validateBrandSizeChart rejects Infinity measurement values', () => {
    const chart: BrandSizeChart = {
      brand: 'TestBrand',
      garmentType: 'tee',
      sizes: { M: { chest: Infinity, waist: 96, shoulder: 45 } },
    };
    const errors = validateBrandSizeChart(chart);
    expect(errors.length).toBeGreaterThan(0);
  });

  // ── getActiveSizeChart ──────────────────────────────────────────────────

  it('getActiveSizeChart returns default when no brand chart provided', () => {
    const result = getActiveSizeChart('tee');
    expect(result).toEqual(DEFAULT_SIZE_CHARTS['tee']);
  });

  it('getActiveSizeChart returns brand data when valid chart provided', () => {
    const brandChart: BrandSizeChart = {
      brand: 'CustomBrand',
      garmentType: 'tee',
      sizes: {
        S: { chest: 88, waist: 84, shoulder: 41 },
      },
    };
    const result = getActiveSizeChart('tee', brandChart);
    expect(result).toEqual({ S: { chest: 88, waist: 84, shoulder: 41 } });
  });

  // ── stringifyBrandSizeChart ─────────────────────────────────────────────

  it('stringifyBrandSizeChart produces valid JSON', () => {
    const json = stringifyBrandSizeChart(validChartObj);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json)).toEqual(validChartObj);
  });
});

// ── Integration Tests: Size Chart + Heatmap Flow ────────────────────────────

import { computeHeatmap, type BodyMeasurementsInput } from '../heatmapEngine';

describe('Size Chart + Heatmap Integration', () => {
  const bodyMeasurements: BodyMeasurementsInput = {
    bustCm: 98,
    waistCm: 86,
    hipCm: 96,
    inseamCm: 80,
    shoulderCm: 45,
    neckCm: 38,
    bicepCm: 32,
    thighCm: 56,
    calfCm: 37,
    wristCm: 17,
  };

  it('computeHeatmap() with brand size chart override returns non-null HeatmapResult', () => {
    const brandChart: BrandSizeChart = {
      brand: 'TestBrand',
      garmentType: 'tee',
      sizes: {
        M: { chest: 104, waist: 100, shoulder: 47, neck: 39, bicep: 35 },
      },
    };
    const activeChart = getActiveSizeChart('tee', brandChart);
    const sizeOverride = activeChart['M'];
    const result = computeHeatmap('tee', 'M', 'regular', bodyMeasurements, sizeOverride);
    expect(result).not.toBeNull();
    // Verify getVertexFit works on a covered vertex
    const fit = result!.getVertexFit(0.68, 0.05, 0.02, 0.06);
    expect(fit.covered).toBe(true);
    expect(typeof fit.fitScore).toBe('number');
  });

  it('computeHeatmap() without override uses default chart (same behavior as before)', () => {
    const resultDefault = computeHeatmap('tee', 'M', 'regular', bodyMeasurements);
    expect(resultDefault).not.toBeNull();
    const fit = resultDefault!.getVertexFit(0.68, 0.05, 0.02, 0.06);
    expect(fit.covered).toBe(true);

    // Without override, should produce same result as passing null
    const resultNull = computeHeatmap('tee', 'M', 'regular', bodyMeasurements, null);
    expect(resultNull).not.toBeNull();
    const fitNull = resultNull!.getVertexFit(0.68, 0.05, 0.02, 0.06);
    expect(fitNull.fitScore).toBe(fit.fitScore);
  });

  it.each([
    ['tee', 'M'],
    ['oxford', 'M'],
    ['slim-jeans', '32'],
    ['straight-jeans', '32'],
  ] as const)('getActiveSizeChart() integration with computeHeatmap() for %s %s', (garmentType, size) => {
    const activeChart = getActiveSizeChart(garmentType as GarmentType);
    const sizeData = activeChart[size];
    expect(sizeData).toBeDefined();

    // Use the active chart data as override — should produce valid heatmap
    const result = computeHeatmap(garmentType as GarmentType, size, 'regular', bodyMeasurements, sizeData);
    expect(result).not.toBeNull();

    // Verify a vertex in the garment coverage area is covered
    const h = garmentType.includes('jeans') ? 0.36 : 0.68; // thigh for jeans, chest for tops
    const fit = result!.getVertexFit(h, 0.05, 0.02, 0.06);
    expect(fit.covered).toBe(true);
    expect(fit.fitScore).toBeGreaterThanOrEqual(-1);
    expect(fit.fitScore).toBeLessThanOrEqual(1);
  });
});
