/**
 * Property-based tests for smplRegressor.ts — Tasks 3.2, 3.3
 *
 * Property 3: Regressor output dimensionality
 * Property 11: Body composition produces distinct shapes
 *
 * Uses fast-check for property-based testing.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { initSmplRegressor } from '../smplRegressor';
import type { RegressorInputs, BodyComposition } from '../smplRegressor';

/* ------------------------------------------------------------------ */
/*  Shared regressor (lookup mode — always available)                  */
/* ------------------------------------------------------------------ */

let regress: (inputs: RegressorInputs) => Float64Array;

beforeAll(async () => {
  regress = await initSmplRegressor({ mode: 'lookup' });
});

/* ------------------------------------------------------------------ */
/*  Generators                                                         */
/* ------------------------------------------------------------------ */

const validInputsArb = fc.record({
  heightCm: fc.double({ min: 140, max: 210, noNaN: true, noDefaultInfinity: true }),
  weightKg: fc.double({ min: 40, max: 150, noNaN: true, noDefaultInfinity: true }),
  age: fc.integer({ min: 18, max: 80 }),
  gender: fc.constantFrom('male' as const, 'female' as const),
  bodyComposition: fc.constantFrom('athletic' as const, 'average' as const, 'heavy' as const),
});

/* ------------------------------------------------------------------ */
/*  Property 3: Regressor output dimensionality                        */
/* ------------------------------------------------------------------ */

describe('Property 3: Regressor output dimensionality', () => {
  /**
   * **Validates: Requirements 2.1**
   *
   * For any valid user input, the SMPL regressor SHALL produce exactly
   * a 10-element beta vector with all components being finite numbers.
   */
  it('produces Float64Array(10) with all finite values for random valid inputs', () => {
    fc.assert(
      fc.property(validInputsArb, (inputs) => {
        const betas = regress(inputs);

        expect(betas).toBeInstanceOf(Float64Array);
        expect(betas.length).toBe(10);

        for (let i = 0; i < 10; i++) {
          expect(Number.isFinite(betas[i])).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('all betas are clamped to [-3, 3] for random valid inputs', () => {
    fc.assert(
      fc.property(validInputsArb, (inputs) => {
        const betas = regress(inputs);

        for (let i = 0; i < 10; i++) {
          expect(betas[i]).toBeGreaterThanOrEqual(-3);
          expect(betas[i]).toBeLessThanOrEqual(3);
        }
      }),
      { numRuns: 100 },
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Property 11: Body composition produces distinct shapes             */
/* ------------------------------------------------------------------ */

describe('Property 11: Body composition produces distinct shapes', () => {
  /**
   * **Validates: Requirements 12.3, 12.4**
   *
   * For any valid user input, the SMPL regressor SHALL produce different
   * beta vectors for bodyComposition='athletic' vs bodyComposition='heavy'.
   * The L2 distance between the two beta vectors SHALL be > 0.1.
   */
  it('athletic vs heavy produces L2 distance > 0.1 for random valid inputs', () => {
    fc.assert(
      fc.property(
        fc.record({
          heightCm: fc.double({ min: 140, max: 210, noNaN: true, noDefaultInfinity: true }),
          weightKg: fc.double({ min: 40, max: 150, noNaN: true, noDefaultInfinity: true }),
          age: fc.integer({ min: 18, max: 80 }),
          gender: fc.constantFrom('male' as const, 'female' as const),
        }),
        (base) => {
          const athleticBetas = regress({ ...base, bodyComposition: 'athletic' });
          const heavyBetas = regress({ ...base, bodyComposition: 'heavy' });

          let l2Sq = 0;
          for (let i = 0; i < 10; i++) {
            l2Sq += (athleticBetas[i] - heavyBetas[i]) ** 2;
          }
          const l2 = Math.sqrt(l2Sq);

          expect(l2).toBeGreaterThan(0.1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
