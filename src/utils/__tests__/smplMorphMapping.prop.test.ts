/**
 * Property-based tests for SMPL morph target mapping — Tasks 2.2, 11.3, 11.4
 *
 * Property 1: Beta-to-influence mapping correctness
 * Property 13: Damping function convergence
 * Property 14: Morph influence sum invariant during transitions
 *
 * Uses fast-check for property-based testing.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

/* ------------------------------------------------------------------ */
/*  Pure function replicating BodyModel.tsx morph target mapping logic  */
/* ------------------------------------------------------------------ */

/**
 * Computes morph target influences from a beta vector and morph target names.
 * Replicates the SMPL branch of the useEffect in BodyModel.tsx.
 *
 * For each morph name:
 *   - Match against /^Beta(\d+)(Neg)?$/
 *   - If no match → influence = 0
 *   - If match and isNeg → influence = max(0, min(1, -beta[betaIdx] / 3.0))
 *   - If match and !isNeg → influence = max(0, min(1, beta[betaIdx] / 3.0))
 */
export function computeMorphInfluences(betas: number[], morphNames: string[]): number[] {
  const influences: number[] = new Array(morphNames.length);
  for (let idx = 0; idx < morphNames.length; idx++) {
    const name = morphNames[idx];
    const match = name.match(/^Beta(\d+)(Neg)?$/);
    if (!match) {
      influences[idx] = 0;
      continue;
    }

    const betaIdx = parseInt(match[1], 10);
    const isNeg = match[2] === 'Neg';
    const betaVal = betaIdx < betas.length ? betas[betaIdx] : 0;

    if (isNeg) {
      influences[idx] = Math.max(0, Math.min(1, -betaVal / 3.0));
    } else {
      influences[idx] = Math.max(0, Math.min(1, betaVal / 3.0));
    }
  }
  return influences;
}

/* ------------------------------------------------------------------ */
/*  Test constants                                                     */
/* ------------------------------------------------------------------ */

const NUM_BETAS = 10;

/** Standard morph names for a 10-beta model with paired targets */
const STANDARD_MORPH_NAMES: string[] = [
  ...Array.from({ length: NUM_BETAS }, (_, i) => `Beta${i}`),
  ...Array.from({ length: NUM_BETAS }, (_, i) => `Beta${i}Neg`),
];

/** Morph names including some non-matching entries */
const MIXED_MORPH_NAMES: string[] = [
  ...STANDARD_MORPH_NAMES,
  'SomeOtherMorph',
  'FacialExpression',
  'Basis',
];

/* ------------------------------------------------------------------ */
/*  Generators                                                         */
/* ------------------------------------------------------------------ */

/** Generate a 10-element beta vector with values in [-3, 3] */
const betaVectorArb = fc.array(
  fc.double({ min: -3, max: 3, noNaN: true, noDefaultInfinity: true }),
  { minLength: NUM_BETAS, maxLength: NUM_BETAS },
);

/* ------------------------------------------------------------------ */
/*  Property 1: Beta-to-influence mapping correctness                  */
/* ------------------------------------------------------------------ */

describe('Property 1: Beta-to-influence mapping correctness', () => {
  /**
   * **Validates: Requirements 1.2, 1.3**
   *
   * For any 10-element beta vector with values in [-3, 3], the morph target
   * influence mapping SHALL assign correct values to positive and negative
   * targets, and exactly one of each pair is non-zero when beta[i] != 0.
   */

  it('for each beta component, at most one of (Beta{i}, Beta{i}Neg) has non-zero influence; exactly one when beta[i]/3 is representable as non-zero', () => {
    fc.assert(
      fc.property(betaVectorArb, (betas) => {
        const influences = computeMorphInfluences(betas, STANDARD_MORPH_NAMES);

        for (let i = 0; i < NUM_BETAS; i++) {
          const posInfluence = influences[i];                  // Beta{i}
          const negInfluence = influences[NUM_BETAS + i];      // Beta{i}Neg

          // Both should never be non-zero simultaneously
          expect(posInfluence > 0 && negInfluence > 0).toBe(false);

          // When the beta magnitude is large enough that division by 3 is non-zero,
          // exactly one should be active
          if (Math.abs(betas[i]) / 3.0 > 0) {
            const posNonZero = posInfluence > 0;
            const negNonZero = negInfluence > 0;
            expect(posNonZero !== negNonZero).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('when beta[i] >= 0: Beta{i} influence = beta[i]/3 clamped [0,1], Beta{i}Neg = 0', () => {
    fc.assert(
      fc.property(betaVectorArb, (betas) => {
        const influences = computeMorphInfluences(betas, STANDARD_MORPH_NAMES);

        for (let i = 0; i < NUM_BETAS; i++) {
          if (betas[i] >= 0) {
            const expected = Math.max(0, Math.min(1, betas[i] / 3.0));
            expect(influences[i]).toBeCloseTo(expected, 10);
            expect(influences[NUM_BETAS + i]).toBe(0);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('when beta[i] < 0: Beta{i}Neg influence = abs(beta[i])/3 clamped [0,1], Beta{i} = 0', () => {
    fc.assert(
      fc.property(betaVectorArb, (betas) => {
        const influences = computeMorphInfluences(betas, STANDARD_MORPH_NAMES);

        for (let i = 0; i < NUM_BETAS; i++) {
          if (betas[i] < 0) {
            const expected = Math.max(0, Math.min(1, Math.abs(betas[i]) / 3.0));
            expect(influences[NUM_BETAS + i]).toBeCloseTo(expected, 10);
            expect(influences[i]).toBe(0);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('all influences are in [0, 1]', () => {
    fc.assert(
      fc.property(betaVectorArb, (betas) => {
        const influences = computeMorphInfluences(betas, STANDARD_MORPH_NAMES);

        for (let idx = 0; idx < influences.length; idx++) {
          expect(influences[idx]).toBeGreaterThanOrEqual(0);
          expect(influences[idx]).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('non-matching morph names get influence 0', () => {
    fc.assert(
      fc.property(betaVectorArb, (betas) => {
        const influences = computeMorphInfluences(betas, MIXED_MORPH_NAMES);

        // The last 3 entries are non-matching names
        const nonMatchingStart = STANDARD_MORPH_NAMES.length;
        for (let idx = nonMatchingStart; idx < MIXED_MORPH_NAMES.length; idx++) {
          expect(influences[idx]).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });
}, 30000);


/* ------------------------------------------------------------------ */
/*  Pure damp function (replicating BodyModel.tsx)                     */
/* ------------------------------------------------------------------ */

/**
 * Exponential damping function: moves `cur` toward `tgt` by a fraction
 * determined by `spd` and `dt`.
 *
 * damp(cur, tgt, spd, dt) = cur + (tgt - cur) * (1 - exp(-spd * dt))
 */
function damp(cur: number, tgt: number, spd: number, dt: number): number {
  return cur + (tgt - cur) * (1 - Math.exp(-spd * dt));
}

/* ------------------------------------------------------------------ */
/*  Property 13: Damping function convergence                          */
/* ------------------------------------------------------------------ */

describe('Property 13: Damping function convergence', () => {
  /**
   * **Validates: Requirements 8.1**
   *
   * For any current value, target value, speed > 0, and deltaTime in (0, 0.05],
   * damp() returns a value strictly between cur and tgt when cur ≠ tgt,
   * and equal to tgt when cur = tgt.
   */

  it('returns value strictly between cur and tgt when cur ≠ tgt', () => {
    // We filter out subnormal differences (|cur - tgt| < 1e-10) because the
    // damping step underflows to 0 in IEEE 754 when the gap is that tiny.
    // The property is meaningful for differences the renderer can actually display.
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1e-6, max: 0.05, noNaN: true, noDefaultInfinity: true }),
        (cur, tgt, spd, dt) => {
          // Skip subnormal / near-zero differences that underflow in IEEE 754
          fc.pre(Math.abs(cur - tgt) > 1e-10);

          const result = damp(cur, tgt, spd, dt);

          if (cur < tgt) {
            expect(result).toBeGreaterThan(cur);
            expect(result).toBeLessThan(tgt);
          } else {
            expect(result).toBeLessThan(cur);
            expect(result).toBeGreaterThan(tgt);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns exactly tgt when cur = tgt', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.01, max: 100, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1e-6, max: 0.05, noNaN: true, noDefaultInfinity: true }),
        (val, spd, dt) => {
          const result = damp(val, val, spd, dt);
          // Use === which treats +0 and -0 as equal
          expect(result === val).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
}, 30000);

/* ------------------------------------------------------------------ */
/*  Property 14: Morph influence sum invariant during transitions       */
/* ------------------------------------------------------------------ */

describe('Property 14: Morph influence sum invariant during transitions', () => {
  /**
   * **Validates: Requirements 8.3**
   *
   * For any beta component transitioning from positive to negative (or vice versa),
   * at every animation frame the sum influence(Beta{i}) + influence(Beta{i}Neg) <= 1.0,
   * preventing double-deformation artifacts.
   */

  const SMOOTH = 10;

  it('influence sum for each pair stays <= 1.0 during positive-to-negative transition', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9 }),                                                    // beta index
        fc.double({ min: 0.1, max: 3, noNaN: true, noDefaultInfinity: true }),             // start beta (positive)
        fc.double({ min: -3, max: -0.1, noNaN: true, noDefaultInfinity: true }),           // end beta (negative)
        fc.integer({ min: 10, max: 60 }),                                                   // number of frames
        (betaIdx, startBeta, endBeta, numFrames) => {
          // Simulate a transition: start with positive beta, end with negative beta
          // The target influences change instantly, but current influences are damped

          // Initial state: positive beta active
          let currentPos = Math.max(0, Math.min(1, startBeta / 3.0));
          let currentNeg = 0;

          // Target state: negative beta active
          const targetPos = 0;
          const targetNeg = Math.max(0, Math.min(1, Math.abs(endBeta) / 3.0));

          const dt = 1 / 60; // ~16.67ms per frame, under 50ms cap

          for (let frame = 0; frame < numFrames; frame++) {
            currentPos = damp(currentPos, targetPos, SMOOTH, dt);
            currentNeg = damp(currentNeg, targetNeg, SMOOTH, dt);

            // Clamp to [0, 1] as BodyModel does
            const clampedPos = Math.max(0, Math.min(1, currentPos));
            const clampedNeg = Math.max(0, Math.min(1, currentNeg));

            const sum = clampedPos + clampedNeg;
            expect(sum).toBeLessThanOrEqual(1.0 + 1e-10); // small epsilon for floating point
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('influence sum for each pair stays <= 1.0 during negative-to-positive transition', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9 }),
        fc.double({ min: -3, max: -0.1, noNaN: true, noDefaultInfinity: true }),           // start beta (negative)
        fc.double({ min: 0.1, max: 3, noNaN: true, noDefaultInfinity: true }),             // end beta (positive)
        fc.integer({ min: 10, max: 60 }),
        (betaIdx, startBeta, endBeta, numFrames) => {
          // Initial state: negative beta active
          let currentPos = 0;
          let currentNeg = Math.max(0, Math.min(1, Math.abs(startBeta) / 3.0));

          // Target state: positive beta active
          const targetPos = Math.max(0, Math.min(1, endBeta / 3.0));
          const targetNeg = 0;

          const dt = 1 / 60;

          for (let frame = 0; frame < numFrames; frame++) {
            currentPos = damp(currentPos, targetPos, SMOOTH, dt);
            currentNeg = damp(currentNeg, targetNeg, SMOOTH, dt);

            const clampedPos = Math.max(0, Math.min(1, currentPos));
            const clampedNeg = Math.max(0, Math.min(1, currentNeg));

            const sum = clampedPos + clampedNeg;
            expect(sum).toBeLessThanOrEqual(1.0 + 1e-10);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
}, 30000);
