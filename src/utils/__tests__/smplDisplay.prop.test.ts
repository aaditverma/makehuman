/**
 * Property-based tests for smplDisplay.ts — Task 9.3
 *
 * Property 11: Display rule for custom vs extracted measurements
 *
 * Uses fast-check for property-based testing.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolveDisplayMeasurement } from '../smplDisplay';

/* ------------------------------------------------------------------ */
/*  Property 11: Display rule for custom vs extracted measurements     */
/* ------------------------------------------------------------------ */

describe('Property 11: Display rule for custom vs extracted measurements', () => {
  /**
   * **Validates: Requirements 6.4**
   *
   * For any custom measurement C and extracted measurement E where
   * |C - E| > 3cm, the displayed value SHALL equal Math.round(E)
   * (the SMPL-extracted value), not C.
   */
  it('when |custom - extracted| > 3, displayed value equals rounded extracted', () => {
    fc.assert(
      fc.property(
        // custom measurement in realistic range
        fc.double({ min: 50, max: 150, noNaN: true, noDefaultInfinity: true }),
        // smpl-extracted measurement in realistic range
        fc.double({ min: 50, max: 150, noNaN: true, noDefaultInfinity: true }),
        // estimated value (from estimatedMeasurements, could be anything)
        fc.double({ min: 50, max: 150, noNaN: true, noDefaultInfinity: true }),
        (custom, extracted, estimated) => {
          // Pre-condition: |custom - extracted| > 3
          fc.pre(Math.abs(custom - extracted) > 3);

          const displayed = resolveDisplayMeasurement(custom, estimated, extracted);
          expect(displayed).toBe(Math.round(extracted));
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * When |custom - extracted| <= 3, the displayed value should be the
   * estimated value (which already incorporates SMPL measurements).
   */
  it('when |custom - extracted| <= 3, displayed value equals estimated', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 150, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 50, max: 150, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 50, max: 150, noNaN: true, noDefaultInfinity: true }),
        (custom, extracted, estimated) => {
          fc.pre(Math.abs(custom - extracted) <= 3);

          const displayed = resolveDisplayMeasurement(custom, estimated, extracted);
          expect(displayed).toBe(estimated);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * When custom is null, the displayed value should always be the estimated
   * value regardless of extracted.
   */
  it('when custom is null, displayed value equals estimated', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 50, max: 150, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 50, max: 150, noNaN: true, noDefaultInfinity: true }),
        (estimated, extracted) => {
          const displayed = resolveDisplayMeasurement(null, estimated, extracted);
          expect(displayed).toBe(estimated);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * When smplExtracted is null (MakeHuman mode), the displayed value
   * should always be the estimated value.
   */
  it('when smplExtracted is null, displayed value equals estimated', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.double({ min: 50, max: 150, noNaN: true, noDefaultInfinity: true }),
        ),
        fc.double({ min: 50, max: 150, noNaN: true, noDefaultInfinity: true }),
        (custom, estimated) => {
          const displayed = resolveDisplayMeasurement(custom, estimated, null);
          expect(displayed).toBe(estimated);
        },
      ),
      { numRuns: 100 },
    );
  });
});
