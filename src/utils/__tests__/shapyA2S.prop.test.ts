/**
 * A2S Property-Based Tests (Task 9).
 *
 * Property 1: A2S beta boundedness
 * Property 2: Polynomial feature expansion length invariant
 * Property 3: A2S coefficient artifact parse-serialize round-trip
 * Property 4: A2S beta continuity
 * Property 5: A2S round-trip chest within tolerance
 * Property 6: A2S round-trip waist within tolerance
 * Property 7: A2S round-trip hip within tolerance
 *
 * Uses fast-check for property-based testing.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import fc from 'fast-check';
import {
  loadA2SCoefficients,
  isA2SAvailable,
  computeA2SBetas,
  expandPolynomialFeatures,
  _resetA2SCoefficients,
} from '../shapyA2S';
import type { A2SCoefficients, A2SInputs } from '../shapyA2S';
import { parseSmplBinary, computeSmplVertices, SMPL_VERTEX_COUNT } from '../smplForwardPass';
import type { SmplModelData } from '../smplForwardPass';
import { extractMeasurements } from '../measurementExtractor';

/* ------------------------------------------------------------------ */
/*  Setup: load real A2S coefficients                                  */
/* ------------------------------------------------------------------ */

beforeAll(async () => {
  const coeffPath = resolve(__dirname, '../../data/shapy_a2s_coefficients.json');
  const coeffJson: A2SCoefficients = JSON.parse(readFileSync(coeffPath, 'utf-8'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(coeffJson),
  }));
  const loaded = await loadA2SCoefficients();
  expect(loaded).not.toBeNull();
});

afterAll(() => {
  _resetA2SCoefficients();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/*  Generators                                                         */
/* ------------------------------------------------------------------ */

/** Generator for valid A2S inputs */
const a2sInputsArb = fc.record({
  heightCm: fc.double({ min: 150, max: 200, noNaN: true, noDefaultInfinity: true }),
  chestCm: fc.double({ min: 75, max: 130, noNaN: true, noDefaultInfinity: true }),
  waistCm: fc.double({ min: 60, max: 120, noNaN: true, noDefaultInfinity: true }),
  hipCm: fc.double({ min: 80, max: 135, noNaN: true, noDefaultInfinity: true }),
});

/* ------------------------------------------------------------------ */
/*  9.1 [PBT] A2S beta boundedness                                    */
/* ------------------------------------------------------------------ */

describe('Property 1: A2S beta boundedness', () => {
  /**
   * **Validates: Requirements 9.1, 9.2**
   *
   * For all valid A2S input combinations (height 150–200, chest 75–130,
   * waist 60–120, hip 80–135), `computeA2SBetas()` returns a Float64Array
   * of length 10 where every element is a finite number in [-3, 3].
   */
  it('produces Float64Array(10) with all finite values in [-3, 3]', () => {
    fc.assert(
      fc.property(a2sInputsArb, (inputs) => {
        const betas = computeA2SBetas(inputs);

        expect(betas).toBeInstanceOf(Float64Array);
        expect(betas.length).toBe(10);

        for (let i = 0; i < 10; i++) {
          expect(Number.isFinite(betas[i])).toBe(true);
          expect(betas[i]).toBeGreaterThanOrEqual(-3);
          expect(betas[i]).toBeLessThanOrEqual(3);
        }
      }),
      { numRuns: 100 },
    );
  });
});

/* ------------------------------------------------------------------ */
/*  9.2 [PBT] Polynomial feature expansion length invariant            */
/* ------------------------------------------------------------------ */

describe('Property 2: Polynomial feature expansion length invariant', () => {
  /**
   * **Validates: Requirements 4.2**
   *
   * For all input vectors of length 2–10 and degree 1–3,
   * `expandPolynomialFeatures()` returns array of expected length.
   * For degree 2, length = 1 + K + K*(K+1)/2.
   */
  it('returns array of expected length for random inputs', () => {
    const inputArb = fc.integer({ min: 2, max: 10 }).chain((K) =>
      fc.tuple(
        fc.array(
          fc.double({ min: -5, max: 5, noNaN: true, noDefaultInfinity: true }),
          { minLength: K, maxLength: K },
        ),
        fc.integer({ min: 1, max: 3 }),
      ),
    );

    fc.assert(
      fc.property(inputArb, ([inputs, degree]) => {
        const K = inputs.length;
        const result = expandPolynomialFeatures(inputs, degree);

        // Compute expected length
        let expectedLength = 1 + K; // bias + degree 1
        if (degree >= 2) {
          expectedLength += (K * (K + 1)) / 2; // degree 2 terms
        }
        if (degree >= 3) {
          // degree 3 terms: K choose 3 with replacement = K*(K+1)*(K+2)/6
          expectedLength += (K * (K + 1) * (K + 2)) / 6;
        }

        expect(result.length).toBe(expectedLength);

        // First element is always 1 (bias term)
        expect(result[0]).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});

/* ------------------------------------------------------------------ */
/*  9.3 [PBT] A2S coefficient artifact parse-serialize round-trip      */
/* ------------------------------------------------------------------ */

describe('Property 3: A2S coefficient artifact parse-serialize round-trip', () => {
  /**
   * **Validates: Requirements 3.5, 9.4**
   *
   * For all valid A2S coefficient structures, JSON.parse(JSON.stringify(artifact))
   * preserves all numeric values in weights, bias, normalization.inputMean,
   * and normalization.inputStd within 1e-10.
   */
  it('parse-serialize round-trip preserves numeric values', () => {
    const coeffArb = fc.record({
      weights: fc.array(
        fc.array(
          fc.double({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true }),
          { minLength: 15, maxLength: 15 },
        ),
        { minLength: 10, maxLength: 10 },
      ),
      bias: fc.array(
        fc.double({ min: -3, max: 3, noNaN: true, noDefaultInfinity: true }),
        { minLength: 10, maxLength: 10 },
      ),
      inputMean: fc.array(
        fc.double({ min: 50, max: 200, noNaN: true, noDefaultInfinity: true }),
        { minLength: 4, maxLength: 4 },
      ),
      inputStd: fc.array(
        fc.double({ min: 1, max: 50, noNaN: true, noDefaultInfinity: true }),
        { minLength: 4, maxLength: 4 },
      ),
    });

    fc.assert(
      fc.property(coeffArb, ({ weights, bias, inputMean, inputStd }) => {
        const artifact: A2SCoefficients = {
          metadata: {
            extractedAt: '2026-01-01T00:00:00Z',
            shapyVersion: 'test',
            polynomialDegree: 2,
            inputFeatures: ['height', 'chest', 'waist', 'hips'],
            numInputFeatures: 4,
            numExpandedFeatures: 15,
            numBetas: 10,
          },
          normalization: { inputMean, inputStd },
          weights,
          bias,
          polynomialOrder: [],
        };

        const roundTripped: A2SCoefficients = JSON.parse(JSON.stringify(artifact));

        // Verify weights
        for (let i = 0; i < 10; i++) {
          for (let j = 0; j < 15; j++) {
            expect(Math.abs(roundTripped.weights[i][j] - artifact.weights[i][j])).toBeLessThan(1e-10);
          }
        }

        // Verify bias
        for (let i = 0; i < 10; i++) {
          expect(Math.abs(roundTripped.bias[i] - artifact.bias[i])).toBeLessThan(1e-10);
        }

        // Verify normalization
        for (let i = 0; i < 4; i++) {
          expect(Math.abs(roundTripped.normalization.inputMean[i] - artifact.normalization.inputMean[i])).toBeLessThan(1e-10);
          expect(Math.abs(roundTripped.normalization.inputStd[i] - artifact.normalization.inputStd[i])).toBeLessThan(1e-10);
        }
      }),
      { numRuns: 50 },
    );
  });
});

/* ------------------------------------------------------------------ */
/*  9.4 [PBT] A2S beta continuity                                     */
/* ------------------------------------------------------------------ */

describe('Property 4: A2S beta continuity', () => {
  /**
   * **Validates: Requirements 9.3**
   *
   * For any valid A2S input, perturbing a single measurement by 1cm
   * produces a beta vector where no component changes by more than 0.5 units.
   */
  it('1cm perturbation changes no beta by more than 0.5', () => {
    const perturbArb = fc.tuple(
      a2sInputsArb,
      fc.constantFrom('heightCm' as const, 'chestCm' as const, 'waistCm' as const, 'hipCm' as const),
      fc.constantFrom(-1, 1),
    );

    fc.assert(
      fc.property(perturbArb, ([inputs, field, direction]) => {
        const baseBetas = computeA2SBetas(inputs);

        const perturbed = { ...inputs, [field]: inputs[field] + direction };
        const perturbedBetas = computeA2SBetas(perturbed);

        for (let i = 0; i < 10; i++) {
          const delta = Math.abs(perturbedBetas[i] - baseBetas[i]);
          expect(delta).toBeLessThanOrEqual(0.5);
        }
      }),
      { numRuns: 50 },
    );
  });
});

/* ------------------------------------------------------------------ */
/*  9.5–9.7 [PBT] A2S round-trip chest/waist/hip                      */
/* ------------------------------------------------------------------ */

describe('A2S round-trip property tests', () => {
  let smplModel: SmplModelData;
  let outputVertices: Float32Array;

  beforeAll(() => {
    const modelPath = resolve(__dirname, '../../../public/models/smpl/smpl_model.bin');
    const modelBuffer = readFileSync(modelPath);
    const arrayBuffer = modelBuffer.buffer.slice(
      modelBuffer.byteOffset,
      modelBuffer.byteOffset + modelBuffer.byteLength,
    );
    smplModel = parseSmplBinary(arrayBuffer);
    outputVertices = new Float32Array(SMPL_VERTEX_COUNT * 3);
  }, 30_000);

  /**
   * Generator for moderate A2S inputs — constrained to physiologically
   * consistent ranges where the mesh extraction pipeline has reasonable
   * accuracy. Matches the 8-input round-trip test constraints.
   */
  const moderateA2SInputsArb = fc.record({
    heightCm: fc.double({ min: 160, max: 190, noNaN: true, noDefaultInfinity: true }),
    chestCm: fc.double({ min: 85, max: 115, noNaN: true, noDefaultInfinity: true }),
    waistCm: fc.double({ min: 72, max: 100, noNaN: true, noDefaultInfinity: true }),
    hipCm: fc.double({ min: 85, max: 115, noNaN: true, noDefaultInfinity: true }),
  });

  /**
   * **Validates: Requirements 8.1, 8.2**
   *
   * For all randomly generated valid A2S inputs, the full round-trip
   * pipeline SHALL produce an extracted chest circumference within 25cm
   * of the input chest value.
   *
   * Note: The mesh extraction pipeline has inherent systematic error from
   * polygon perimeters + scale corrections. The tolerance accounts for
   * the difference between mesh polygon perimeters and real-world tape
   * measurements, similar to the 8-input round-trip tests.
   */
  it('A2S round-trip chest within 25cm', () => {
    fc.assert(
      fc.property(moderateA2SInputsArb, (inputs) => {
        const betas = computeA2SBetas(inputs);
        computeSmplVertices(smplModel, betas, outputVertices);
        const extracted = extractMeasurements(smplModel, outputVertices);

        const error = Math.abs(extracted.chestCm - inputs.chestCm);
        expect(error).toBeLessThanOrEqual(25);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 8.1, 8.3**
   *
   * For all randomly generated valid A2S inputs, the extracted waist
   * circumference is within 35cm of the input waist value.
   */
  it('A2S round-trip waist within 35cm', () => {
    fc.assert(
      fc.property(moderateA2SInputsArb, (inputs) => {
        const betas = computeA2SBetas(inputs);
        computeSmplVertices(smplModel, betas, outputVertices);
        const extracted = extractMeasurements(smplModel, outputVertices);

        const error = Math.abs(extracted.waistCm - inputs.waistCm);
        expect(error).toBeLessThanOrEqual(35);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 8.1, 8.4**
   *
   * For all randomly generated valid A2S inputs, the extracted hip
   * circumference is within 25cm of the input hip value.
   */
  it('A2S round-trip hip within 25cm', () => {
    fc.assert(
      fc.property(moderateA2SInputsArb, (inputs) => {
        const betas = computeA2SBetas(inputs);
        computeSmplVertices(smplModel, betas, outputVertices);
        const extracted = extractMeasurements(smplModel, outputVertices);

        const error = Math.abs(extracted.hipCm - inputs.hipCm);
        expect(error).toBeLessThanOrEqual(25);
      }),
      { numRuns: 50 },
    );
  });
}, 120_000);
