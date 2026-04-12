import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { computeHeatmap } from '../heatmapEngine';
import type { BodyMeasurementsInput } from '../heatmapEngine';

/**
 * Bug Condition Exploration Test: Gray Zone Side Torso Vertices Missing Coverage
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2
 *
 * The bug: vertices at the armpit/flank boundary with armScore in [1.0, 1.3]
 * are anatomically side torso but may be incorrectly excluded from T-shirt
 * heatmap coverage. The current code uses a single armScore > 1.3 threshold
 * and has no normalYAbs signal to disambiguate gray zone vertices.
 *
 * This test generates random vertices satisfying the bug condition and asserts
 * they should be covered (expected behavior). On unfixed code, this test is
 * expected to FAIL, confirming the bug exists.
 */

const bodyMeasurements: BodyMeasurementsInput = {
  bustCm: 96,
  waistCm: 82,
  hipCm: 98,
  inseamCm: 80,
  shoulderCm: 44,
  neckCm: 38,
  bicepCm: 32,
  thighCm: 55,
  calfCm: 37,
  wristCm: 17,
};

describe('Side Torso Gap - Bug Condition Exploration', () => {
  it('Property 1: Gray zone side-torso vertices (armScore 1.0-1.3, normalYAbs > 0.25) should be covered by T-shirt heatmap', () => {
    /**
     * **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2**
     */
    const heatmap = computeHeatmap('tee', 'M', 'regular', bodyMeasurements);
    expect(heatmap).not.toBeNull();

    // Generator for gray zone side-torso vertices
    const grayZoneSideTorsoVertex = fc
      .record({
        normalXAbs: fc.double({ min: 0.4, max: 0.8, noNaN: true }),
        xAbs: fc.double({ min: 0.08, max: 0.20, noNaN: true }),
      })
      .filter(({ normalXAbs, xAbs }) => {
        const armScore = normalXAbs + xAbs * 3;
        return armScore >= 1.0 && armScore <= 1.3;
      })
      .chain(({ normalXAbs, xAbs }) =>
        fc.record({
          normalXAbs: fc.constant(normalXAbs),
          xAbs: fc.constant(xAbs),
          // normalYAbs in (0.25, 0.7] — armpit/flank concavity signal
          normalYAbs: fc.double({ min: 0.26, max: 0.7, noNaN: true }),
          // h in [0.44, 0.59] — below sleeveEnd=0.60, within tee coverage
          h: fc.double({ min: 0.44, max: 0.59, noNaN: true }),
          // yPos (z-position) — plausible range
          yPos: fc.double({ min: -0.15, max: 0.15, noNaN: true }),
          // distFromCenter — plausible for side torso (not hands)
          distFromCenter: fc.double({ min: 0.05, max: 0.18, noNaN: true }),
        }),
      );

    fc.assert(
      fc.property(grayZoneSideTorsoVertex, (vertex) => {
        const { h, xAbs, yPos, distFromCenter, normalXAbs, normalYAbs } = vertex;

        // Call with 6-parameter signature including normalYAbs for gray zone disambiguation
        const result = heatmap!.getVertexFit(h, xAbs, yPos, distFromCenter, normalXAbs, normalYAbs);

        // Gray zone side-torso vertices should be covered
        expect(result.covered).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});


/**
 * Preservation Property Tests: Non-Gray-Zone Vertex Behavior Unchanged
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 *
 * These tests capture the baseline behavior of the UNFIXED code for vertices
 * outside the gray zone. They must PASS on unfixed code and continue to pass
 * after the fix is applied, confirming no regressions.
 */
describe('Side Torso Gap - Preservation Properties', () => {
  it('Property 2a: Deep torso vertices (armScore < 1.0) within tee coverage are covered', () => {
    /**
     * **Validates: Requirements 3.2**
     *
     * Vertices with armScore < 1.0 are clearly torso. For a tee garment,
     * these should always be covered when within the coverage height range
     * and not in neckline/hand exclusion zones.
     */
    const heatmap = computeHeatmap('tee', 'M', 'regular', bodyMeasurements);
    expect(heatmap).not.toBeNull();

    const deepTorsoVertex = fc
      .record({
        normalXAbs: fc.double({ min: 0.0, max: 0.5, noNaN: true }),
        xAbs: fc.double({ min: 0.0, max: 0.12, noNaN: true }),
      })
      .filter(({ normalXAbs, xAbs }) => {
        const armScore = normalXAbs + xAbs * 3;
        return armScore < 1.0;
      })
      .chain(({ normalXAbs, xAbs }) =>
        fc.record({
          normalXAbs: fc.constant(normalXAbs),
          xAbs: fc.constant(xAbs),
          // h within tee coverage, away from neckline edge
          h: fc.double({ min: 0.46, max: 0.75, noNaN: true }),
          yPos: fc.double({ min: -0.15, max: 0.15, noNaN: true }),
          // distFromCenter: not in hand zone, not in neckline cutout
          distFromCenter: fc.double({ min: 0.07, max: 0.18, noNaN: true }),
        }),
      );

    fc.assert(
      fc.property(deepTorsoVertex, (vertex) => {
        const { h, xAbs, yPos, distFromCenter, normalXAbs } = vertex;
        const result = heatmap!.getVertexFit(h, xAbs, yPos, distFromCenter, normalXAbs);
        expect(result.covered).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('Property 2b: Clear arm vertices (armScore > 1.3) below sleeveEnd are uncovered for tee', () => {
    /**
     * **Validates: Requirements 3.1, 3.6**
     *
     * Vertices with armScore > 1.3 below sleeveEnd (0.60) are actual arm
     * vertices and must be excluded from T-shirt coverage.
     */
    const heatmap = computeHeatmap('tee', 'M', 'regular', bodyMeasurements);
    expect(heatmap).not.toBeNull();

    const clearArmVertex = fc
      .record({
        normalXAbs: fc.double({ min: 0.7, max: 1.0, noNaN: true }),
        xAbs: fc.double({ min: 0.15, max: 0.35, noNaN: true }),
      })
      .filter(({ normalXAbs, xAbs }) => {
        const armScore = normalXAbs + xAbs * 3;
        return armScore > 1.3;
      })
      .chain(({ normalXAbs, xAbs }) =>
        fc.record({
          normalXAbs: fc.constant(normalXAbs),
          xAbs: fc.constant(xAbs),
          // h below sleeveEnd (0.60), within tee coverage range
          h: fc.double({ min: 0.44, max: 0.59, noNaN: true }),
          yPos: fc.double({ min: -0.15, max: 0.15, noNaN: true }),
          distFromCenter: fc.double({ min: 0.05, max: 0.20, noNaN: true }),
        }),
      );

    fc.assert(
      fc.property(clearArmVertex, (vertex) => {
        const { h, xAbs, yPos, distFromCenter, normalXAbs } = vertex;
        const result = heatmap!.getVertexFit(h, xAbs, yPos, distFromCenter, normalXAbs);
        expect(result.covered).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('Property 2c: Jeans coverage is completely unaffected by arm detection', () => {
    /**
     * **Validates: Requirements 3.4**
     *
     * Jeans are bottom garments with no sleeveEnd. Arm detection logic
     * (armScore, normalXAbs) should have zero effect on jeans coverage.
     * Any vertex within jeans coverage range should be covered regardless
     * of arm-like normalXAbs values.
     */
    const heatmapSlim = computeHeatmap('slim-jeans', '32', 'regular', bodyMeasurements);
    expect(heatmapSlim).not.toBeNull();

    const jeansVertex = fc.record({
      // normalXAbs: full range including arm-like values
      normalXAbs: fc.double({ min: 0.0, max: 1.0, noNaN: true }),
      xAbs: fc.double({ min: 0.0, max: 0.20, noNaN: true }),
      // h within jeans coverage (0.05 to 0.58), away from edges
      h: fc.double({ min: 0.06, max: 0.34, noNaN: true }),
      yPos: fc.double({ min: -0.15, max: 0.15, noNaN: true }),
      // distFromCenter: not in hand exclusion zone
      distFromCenter: fc.double({ min: 0.02, max: 0.18, noNaN: true }),
    });

    fc.assert(
      fc.property(jeansVertex, (vertex) => {
        const { h, xAbs, yPos, distFromCenter, normalXAbs } = vertex;
        const result = heatmapSlim!.getVertexFit(h, xAbs, yPos, distFromCenter, normalXAbs);
        // Jeans vertices in the leg region should always be covered
        expect(result.covered).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('Property 2d: Oxford shirt coverage unchanged for vertices within coverage range', () => {
    /**
     * **Validates: Requirements 3.3, 3.5**
     *
     * Oxford shirt has sleeveEnd=0.48 (long sleeves). Vertices within the
     * torso coverage range that are not in arm/hand/neckline exclusion zones
     * should be covered. This tests that the oxford shirt behavior is stable.
     */
    const heatmap = computeHeatmap('oxford', 'M', 'regular', bodyMeasurements);
    expect(heatmap).not.toBeNull();

    const oxfordTorsoVertex = fc
      .record({
        // Moderate normalXAbs — torso-like values
        normalXAbs: fc.double({ min: 0.0, max: 0.5, noNaN: true }),
        xAbs: fc.double({ min: 0.0, max: 0.12, noNaN: true }),
      })
      .filter(({ normalXAbs, xAbs }) => {
        const armScore = normalXAbs + xAbs * 3;
        return armScore < 1.0;
      })
      .chain(({ normalXAbs, xAbs }) =>
        fc.record({
          normalXAbs: fc.constant(normalXAbs),
          xAbs: fc.constant(xAbs),
          // h within oxford coverage, away from neckline
          h: fc.double({ min: 0.46, max: 0.75, noNaN: true }),
          yPos: fc.double({ min: -0.15, max: 0.15, noNaN: true }),
          distFromCenter: fc.double({ min: 0.07, max: 0.18, noNaN: true }),
        }),
      );

    fc.assert(
      fc.property(oxfordTorsoVertex, (vertex) => {
        const { h, xAbs, yPos, distFromCenter, normalXAbs } = vertex;
        const result = heatmap!.getVertexFit(h, xAbs, yPos, distFromCenter, normalXAbs);
        expect(result.covered).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
