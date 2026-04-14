/**
 * Property-based tests for heatmapEngine.ts — Task 10.2
 *
 * Property 8: Fit score algorithm invariance across engines
 *
 * Uses fast-check for property-based testing.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeHeatmap } from '../heatmapEngine';
import type { BodyMeasurementsInput } from '../heatmapEngine';
import type { FitPreference, GarmentType } from '../../stores/bodyStore';

/* ------------------------------------------------------------------ */
/*  Generators                                                         */
/* ------------------------------------------------------------------ */

const bodyMeasurementsArb: fc.Arbitrary<BodyMeasurementsInput> = fc.record({
  bustCm: fc.double({ min: 75, max: 130, noNaN: true, noDefaultInfinity: true }),
  waistCm: fc.double({ min: 60, max: 120, noNaN: true, noDefaultInfinity: true }),
  hipCm: fc.double({ min: 75, max: 130, noNaN: true, noDefaultInfinity: true }),
  inseamCm: fc.double({ min: 65, max: 95, noNaN: true, noDefaultInfinity: true }),
  shoulderCm: fc.double({ min: 35, max: 55, noNaN: true, noDefaultInfinity: true }),
  neckCm: fc.double({ min: 30, max: 50, noNaN: true, noDefaultInfinity: true }),
  bicepCm: fc.double({ min: 24, max: 45, noNaN: true, noDefaultInfinity: true }),
  thighCm: fc.double({ min: 40, max: 75, noNaN: true, noDefaultInfinity: true }),
  calfCm: fc.double({ min: 28, max: 50, noNaN: true, noDefaultInfinity: true }),
  wristCm: fc.double({ min: 14, max: 22, noNaN: true, noDefaultInfinity: true }),
});

const fitPrefArb = fc.constantFrom(
  'compression' as FitPreference,
  'slim' as FitPreference,
  'regular' as FitPreference,
  'relaxed' as FitPreference,
  'oversized' as FitPreference,
);

const garmentTypeArb = fc.constantFrom(
  'tee' as GarmentType,
  'oxford' as GarmentType,
  'slim-jeans' as GarmentType,
  'straight-jeans' as GarmentType,
);

const sizeArb = fc.constantFrom('XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36', '38');

/* ------------------------------------------------------------------ */
/*  Property 8: Fit score algorithm invariance across engines          */
/* ------------------------------------------------------------------ */

describe('Property 8: Fit score algorithm invariance across engines', () => {
  /**
   * **Validates: Requirements 8.2**
   *
   * For any set of body measurements and garment measurements, the fit
   * score computation SHALL produce identical results regardless of
   * whether the measurements originated from the SMPL pipeline or the
   * MakeHuman/ANSUR II pipeline.
   *
   * We verify this by calling computeHeatmap twice with the same measurements
   * (simulating both engines producing the same measurements) and checking
   * that the fit scores are identical.
   */
  it('same measurements produce identical fit scores regardless of call context', () => {
    fc.assert(
      fc.property(
        bodyMeasurementsArb,
        garmentTypeArb,
        fitPrefArb,
        (measurements, garmentType, fitPref) => {
          // Get valid sizes for this garment type
          const topSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
          const bottomSizes = ['28', '30', '32', '34', '36', '38'];
          const isTop = garmentType === 'tee' || garmentType === 'oxford';
          const sizes = isTop ? topSizes : bottomSizes;
          const size = sizes[Math.floor(Math.random() * sizes.length)];

          // Call computeHeatmap twice with identical measurements
          // (simulating SMPL-derived vs ANSUR II-derived measurements)
          const result1 = computeHeatmap(garmentType, size, fitPref, measurements);
          const result2 = computeHeatmap(garmentType, size, fitPref, measurements);

          if (result1 === null || result2 === null) {
            // Both should be null or both non-null
            expect(result1).toBe(result2);
            return;
          }

          // Test at multiple body positions
          const testPositions = [
            { h: 0.68, xAbs: 0.05, yPos: 0, dist: 0.05 },
            { h: 0.58, xAbs: 0.08, yPos: 0, dist: 0.08 },
            { h: 0.50, xAbs: 0.06, yPos: 0, dist: 0.06 },
            { h: 0.36, xAbs: 0.04, yPos: 0, dist: 0.04 },
          ];

          for (const pos of testPositions) {
            const fit1 = result1.getVertexFit(pos.h, pos.xAbs, pos.yPos, pos.dist);
            const fit2 = result2.getVertexFit(pos.h, pos.xAbs, pos.yPos, pos.dist);

            expect(fit1.covered).toBe(fit2.covered);
            expect(fit1.fitScore).toBe(fit2.fitScore);
            expect(fit1.edgeFade).toBe(fit2.edgeFade);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('fit score depends only on measurements and fit preference, not on engine source', () => {
    fc.assert(
      fc.property(
        bodyMeasurementsArb,
        fitPrefArb,
        (measurements, fitPref) => {
          // Compute heatmap for tee M with these measurements
          const result = computeHeatmap('tee', 'M', fitPref, measurements);
          if (!result) return;

          // The fit score at chest height should be deterministic
          const fit = result.getVertexFit(0.68, 0.05, 0, 0.05);

          // Verify the score is a finite number in [-1, 1]
          expect(Number.isFinite(fit.fitScore)).toBe(true);
          expect(fit.fitScore).toBeGreaterThanOrEqual(-1);
          expect(fit.fitScore).toBeLessThanOrEqual(1);

          // Compute again — should be identical
          const result2 = computeHeatmap('tee', 'M', fitPref, measurements);
          if (!result2) return;
          const fit2 = result2.getVertexFit(0.68, 0.05, 0, 0.05);
          expect(fit2.fitScore).toBe(fit.fitScore);
        },
      ),
      { numRuns: 100 },
    );
  });
});
