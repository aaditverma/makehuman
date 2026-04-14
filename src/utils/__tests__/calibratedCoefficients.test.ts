/**
 * Unit tests for calibrated coefficient loading and application (Task 1.4).
 *
 * Tests:
 * - Successful load with valid JSON
 * - Fallback on missing file, parse error, version mismatch
 * - applyCalibratedCoefficients() overwrites preset/composition/sensitivity constants
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadCalibratedCoefficients,
  applyCalibratedCoefficients,
  getCalibratedCoefficients,
  _resetCalibratedCoefficients,
  SMPL_PRESET_OFFSETS,
  COMPOSITION_BIAS,
  MEASUREMENT_BETA_MAP,
  refineWithCustomMeasurements,
} from '../smplRegressor';
import type { CalibratedCoefficients } from '../smplRegressor';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Build a minimal valid CalibratedCoefficients object for testing */
function makeValidCoefficients(overrides?: Partial<CalibratedCoefficients>): CalibratedCoefficients {
  return {
    version: '1.0.0',
    generatedAt: '2024-01-01T00:00:00Z',
    regression: {
      intercepts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      weights: Array.from({ length: 10 }, () => [0, 0, 0, 0, 0, 0, 0]),
      features: ['heightNorm', 'weightNorm', 'ageNorm', 'genderSign', 'bmiNorm', 'hwInteraction', 'bmiSq'],
      normalization: {
        heightNorm: { center: 175, range: 20 },
        weightNorm: { center: 80, range: 30 },
        ageNorm: { center: 40, range: 25 },
        bmiNorm: { center: 25, range: 8 },
      },
    },
    presetOffsets: {
      slim:     [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      average:  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      athletic: [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1],
      curvy:    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      heavy:    [0.3, 0.6, 0.9, 0.3, 0.6, 0.9, 0.3, 0.6, 0.9, 0.3],
    },
    compositionBias: {
      athletic: [0.1, -0.2, 0.3, 0.4, 0, -0.1, 0.2, -0.3, 0.4, 0.5],
      average:  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      heavy:    [-0.1, 0.3, -0.2, -0.1, 0, 0.4, -0.2, 0.3, -0.3, 0.1],
    },
    sensitivityMap: {
      bustCm:   [{ betaIdx: 6, sensitivity: 5.0 }, { betaIdx: 5, sensitivity: 4.0 }],
      waistCm:  [{ betaIdx: 1, sensitivity: 6.0 }],
      hipCm:    [{ betaIdx: 7, sensitivity: 5.5 }, { betaIdx: 9, sensitivity: 2.0 }],
      inseamCm: [{ betaIdx: 4, sensitivity: 3.5 }],
    },
    fatDistribution: {
      male:   { weightToBeta: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ageFactor: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      female: { weightToBeta: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ageFactor: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    },
    ...overrides,
  };
}

/* Save original values so we can restore after each test */
const originalPresetOffsets: Record<string, Float64Array> = {};
const originalCompositionBias: Record<string, Float64Array> = {};
let originalMeasurementBetaMap: Record<string, Array<{ betaIdx: number; sensitivity: number }>>;

beforeEach(() => {
  // Snapshot originals
  for (const key of Object.keys(SMPL_PRESET_OFFSETS)) {
    originalPresetOffsets[key] = new Float64Array(SMPL_PRESET_OFFSETS[key as keyof typeof SMPL_PRESET_OFFSETS]);
  }
  for (const key of Object.keys(COMPOSITION_BIAS)) {
    originalCompositionBias[key] = new Float64Array(COMPOSITION_BIAS[key as keyof typeof COMPOSITION_BIAS]);
  }
  originalMeasurementBetaMap = JSON.parse(JSON.stringify(MEASUREMENT_BETA_MAP));
});

afterEach(() => {
  // Restore originals
  for (const key of Object.keys(originalPresetOffsets)) {
    SMPL_PRESET_OFFSETS[key as keyof typeof SMPL_PRESET_OFFSETS].set(originalPresetOffsets[key]);
  }
  for (const key of Object.keys(originalCompositionBias)) {
    COMPOSITION_BIAS[key as keyof typeof COMPOSITION_BIAS].set(originalCompositionBias[key]);
  }
  for (const key of Object.keys(originalMeasurementBetaMap)) {
    MEASUREMENT_BETA_MAP[key] = originalMeasurementBetaMap[key];
  }
  _resetCalibratedCoefficients();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/*  loadCalibratedCoefficients tests                                   */
/* ------------------------------------------------------------------ */

describe('loadCalibratedCoefficients', () => {
  it('loads valid coefficients and stores them in module state', async () => {
    const validData = makeValidCoefficients();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(validData),
    }));

    const result = await loadCalibratedCoefficients();

    expect(result).not.toBeNull();
    expect(result!.version).toBe('1.0.0');
    expect(getCalibratedCoefficients()).toBe(result);
  });

  it('uses custom URL when provided', async () => {
    const validData = makeValidCoefficients();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(validData),
    });
    vi.stubGlobal('fetch', mockFetch);

    await loadCalibratedCoefficients('/custom/path.json');

    expect(mockFetch).toHaveBeenCalledWith('/custom/path.json');
  });

  it('returns null and logs warning on version mismatch', async () => {
    const badVersion = makeValidCoefficients({ version: '2.0.0' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(badVersion),
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadCalibratedCoefficients();

    expect(result).toBeNull();
    expect(getCalibratedCoefficients()).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('version mismatch'),
    );
  });

  it('returns null on fetch failure (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadCalibratedCoefficients();

    expect(result).toBeNull();
    expect(getCalibratedCoefficients()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null on HTTP error (404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadCalibratedCoefficients();

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch'),
    );
  });

  it('returns null on JSON parse error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadCalibratedCoefficients();

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });
});


/* ------------------------------------------------------------------ */
/*  applyCalibratedCoefficients tests                                  */
/* ------------------------------------------------------------------ */

describe('applyCalibratedCoefficients', () => {
  it('overwrites SMPL_PRESET_OFFSETS with calibrated values', async () => {
    const validData = makeValidCoefficients();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(validData),
    }));

    await loadCalibratedCoefficients();
    applyCalibratedCoefficients();

    for (const key of ['slim', 'average', 'athletic', 'curvy', 'heavy'] as const) {
      const expected = validData.presetOffsets[key];
      const actual = SMPL_PRESET_OFFSETS[key];
      for (let i = 0; i < 10; i++) {
        expect(actual[i]).toBe(expected[i]);
      }
    }
  });

  it('overwrites COMPOSITION_BIAS with calibrated values', async () => {
    const validData = makeValidCoefficients();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(validData),
    }));

    await loadCalibratedCoefficients();
    applyCalibratedCoefficients();

    for (const key of ['athletic', 'average', 'heavy'] as const) {
      const expected = validData.compositionBias[key];
      const actual = COMPOSITION_BIAS[key];
      for (let i = 0; i < 10; i++) {
        expect(actual[i]).toBe(expected[i]);
      }
    }
  });

  it('overwrites MEASUREMENT_BETA_MAP with calibrated sensitivity map', async () => {
    const validData = makeValidCoefficients();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(validData),
    }));

    await loadCalibratedCoefficients();
    applyCalibratedCoefficients();

    for (const key of Object.keys(validData.sensitivityMap)) {
      expect(MEASUREMENT_BETA_MAP[key]).toEqual(validData.sensitivityMap[key]);
    }
  });

  it('is a no-op when no coefficients are loaded', () => {
    // Ensure no coefficients loaded
    _resetCalibratedCoefficients();

    // Snapshot current values
    const slimBefore = new Float64Array(SMPL_PRESET_OFFSETS.slim);
    const athleticBiasBefore = new Float64Array(COMPOSITION_BIAS.athletic);
    const bustMapBefore = [...MEASUREMENT_BETA_MAP.bustCm];

    applyCalibratedCoefficients();

    // Nothing should have changed
    for (let i = 0; i < 10; i++) {
      expect(SMPL_PRESET_OFFSETS.slim[i]).toBe(slimBefore[i]);
      expect(COMPOSITION_BIAS.athletic[i]).toBe(athleticBiasBefore[i]);
    }
    expect(MEASUREMENT_BETA_MAP.bustCm).toEqual(bustMapBefore);
  });
});


/* ------------------------------------------------------------------ */
/*  Calibrated lookupRegress() tests (Task 2.2)                        */
/* ------------------------------------------------------------------ */

import { lookupRegress } from '../smplRegressor';
import type { RegressorInputs } from '../smplRegressor';

describe('lookupRegress — calibrated path', () => {
  /** Helper to load mock coefficients into module state */
  async function loadMockCoeffs(overrides?: Partial<CalibratedCoefficients>) {
    const data = makeValidCoefficients(overrides);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    }));
    await loadCalibratedCoefficients();
    return data;
  }

  const averageInputs: RegressorInputs = {
    heightCm: 175,
    weightKg: 80,
    age: 40,
    gender: 'male',
  };

  it('uses calibrated path when coefficients are loaded', async () => {
    // Set up coefficients with known intercepts and zero weights/fatDist
    // so the output should equal the intercepts exactly
    const intercepts = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    await loadMockCoeffs({
      regression: {
        intercepts,
        weights: Array.from({ length: 10 }, () => [0, 0, 0, 0, 0, 0, 0]),
        features: ['heightNorm', 'weightNorm', 'ageNorm', 'genderSign', 'bmiNorm', 'hwInteraction', 'bmiSq'],
        normalization: {
          heightNorm: { center: 175, range: 20 },
          weightNorm: { center: 80, range: 30 },
          ageNorm: { center: 40, range: 25 },
          bmiNorm: { center: 25, range: 8 },
        },
      },
    });

    const betas = lookupRegress(averageInputs);

    // With zero weights and zero fatDist, betas should equal intercepts
    for (let i = 0; i < 10; i++) {
      expect(betas[i]).toBeCloseTo(intercepts[i], 10);
    }
  });

  it('applies regression weights correctly', async () => {
    // Set intercepts to 0, one non-zero weight per beta on heightNorm (feature index 0)
    const weights = Array.from({ length: 10 }, (_, i) => {
      const w = [0, 0, 0, 0, 0, 0, 0];
      w[0] = (i + 1) * 0.1; // heightNorm weight
      return w;
    });

    await loadMockCoeffs({
      regression: {
        intercepts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        weights,
        features: ['heightNorm', 'weightNorm', 'ageNorm', 'genderSign', 'bmiNorm', 'hwInteraction', 'bmiSq'],
        normalization: {
          heightNorm: { center: 175, range: 20 },
          weightNorm: { center: 80, range: 30 },
          ageNorm: { center: 40, range: 25 },
          bmiNorm: { center: 25, range: 8 },
        },
      },
    });

    // Input height = 195 → heightNorm = (195 - 175) / 20 = 1.0
    const betas = lookupRegress({ ...averageInputs, heightCm: 195 });

    // β[i] = 0 + weights[i][0] * 1.0 = (i+1) * 0.1
    for (let i = 0; i < 10; i++) {
      expect(betas[i]).toBeCloseTo((i + 1) * 0.1, 5);
    }
  });

  it('applies fat distribution modulation', async () => {
    const maleWeightToBeta = [0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const maleAgeFactor    = [0, 0.3, 0, 0, 0, 0, 0, 0, 0, 0];

    await loadMockCoeffs({
      fatDistribution: {
        male:   { weightToBeta: maleWeightToBeta, ageFactor: maleAgeFactor },
        female: { weightToBeta: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ageFactor: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      },
    });

    // weightNorm = (110 - 80) / 30 = 1.0, ageNorm = (65 - 40) / 25 = 1.0
    const betas = lookupRegress({ heightCm: 175, weightKg: 110, age: 65, gender: 'male' });

    // β[0] should include fatDist contribution: 0.5 * 1.0 = 0.5
    expect(betas[0]).toBeCloseTo(0.5, 5);
    // β[1] should include ageFactor contribution: 0.3 * 1.0 = 0.3
    expect(betas[1]).toBeCloseTo(0.3, 5);
  });

  it('uses female fat distribution for female gender', async () => {
    const femaleWeightToBeta = [0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0];

    await loadMockCoeffs({
      fatDistribution: {
        male:   { weightToBeta: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ageFactor: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
        female: { weightToBeta: femaleWeightToBeta, ageFactor: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      },
    });

    // weightNorm = (110 - 80) / 30 = 1.0
    const betas = lookupRegress({ heightCm: 175, weightKg: 110, age: 40, gender: 'female' });

    // β[7] should include female fatDist: 0.8 * 1.0 = 0.8
    expect(betas[7]).toBeCloseTo(0.8, 5);
  });

  it('clamps betas to [-3, 3] for extreme inputs', async () => {
    // Set very large intercepts that would exceed [-3, 3]
    await loadMockCoeffs({
      regression: {
        intercepts: [5, -5, 10, -10, 4, -4, 8, -8, 3.5, -3.5],
        weights: Array.from({ length: 10 }, () => [0, 0, 0, 0, 0, 0, 0]),
        features: ['heightNorm', 'weightNorm', 'ageNorm', 'genderSign', 'bmiNorm', 'hwInteraction', 'bmiSq'],
        normalization: {
          heightNorm: { center: 175, range: 20 },
          weightNorm: { center: 80, range: 30 },
          ageNorm: { center: 40, range: 25 },
          bmiNorm: { center: 25, range: 8 },
        },
      },
    });

    const betas = lookupRegress(averageInputs);

    for (let i = 0; i < 10; i++) {
      expect(betas[i]).toBeGreaterThanOrEqual(-3);
      expect(betas[i]).toBeLessThanOrEqual(3);
    }
    // Verify specific clamping
    expect(betas[0]).toBe(3);   // 5 clamped to 3
    expect(betas[1]).toBe(-3);  // -5 clamped to -3
  });

  it('produces all finite numbers in [-3, 3] for valid inputs', async () => {
    await loadMockCoeffs();

    const inputs: RegressorInputs[] = [
      { heightCm: 140, weightKg: 40, age: 18, gender: 'male' },
      { heightCm: 210, weightKg: 160, age: 80, gender: 'female' },
      { heightCm: 175, weightKg: 80, age: 40, gender: 'male' },
    ];

    for (const input of inputs) {
      const betas = lookupRegress(input);
      expect(betas.length).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(Number.isFinite(betas[i])).toBe(true);
        expect(betas[i]).toBeGreaterThanOrEqual(-3);
        expect(betas[i]).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('lookupRegress — heuristic fallback', () => {
  it('produces identical output to heuristic when no coefficients loaded', () => {
    // Ensure no calibrated coefficients
    _resetCalibratedCoefficients();

    const inputs: RegressorInputs = {
      heightCm: 180,
      weightKg: 85,
      age: 35,
      gender: 'male',
    };

    // Call twice — both should use heuristic and produce identical results
    const betas1 = lookupRegress(inputs);
    const betas2 = lookupRegress(inputs);

    for (let i = 0; i < 10; i++) {
      expect(betas1[i]).toBe(betas2[i]);
    }

    // Verify it's actually computing something (not all zeros)
    let hasNonZero = false;
    for (let i = 0; i < 10; i++) {
      if (betas1[i] !== 0) { hasNonZero = true; break; }
    }
    expect(hasNonZero).toBe(true);
  });

  it('heuristic path handles optional measurements', () => {
    _resetCalibratedCoefficients();

    const base: RegressorInputs = { heightCm: 175, weightKg: 75, age: 30, gender: 'male' };
    const withMeasurements: RegressorInputs = {
      ...base,
      bustCm: 100,
      waistCm: 88,
      hipCm: 100,
      inseamCm: 82,
    };

    const baseBetas = lookupRegress(base);
    const measBetas = lookupRegress(withMeasurements);

    // Should differ when measurements are provided
    let different = false;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(baseBetas[i] - measBetas[i]) > 0.001) {
        different = true;
        break;
      }
    }
    expect(different).toBe(true);
  });
});


/* ------------------------------------------------------------------ */
/*  refineWithCustomMeasurements — calibrated sensitivity map (7.2)    */
/* ------------------------------------------------------------------ */

describe('refineWithCustomMeasurements — calibrated sensitivity map', () => {
  /** Helper to load mock coefficients into module state */
  async function loadMockCoeffs(overrides?: Partial<CalibratedCoefficients>) {
    const data = makeValidCoefficients(overrides);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    }));
    await loadCalibratedCoefficients();
    return data;
  }

  it('uses calibrated sensitivityMap when coefficients are loaded', async () => {
    // Load coefficients with a custom sensitivity map that maps waistCm to beta 3 only
    await loadMockCoeffs({
      sensitivityMap: {
        bustCm:   [{ betaIdx: 6, sensitivity: 5.0 }, { betaIdx: 5, sensitivity: 4.0 }],
        waistCm:  [{ betaIdx: 3, sensitivity: 10.0 }],  // Different from hardcoded (betaIdx 1, 5)
        hipCm:    [{ betaIdx: 7, sensitivity: 5.5 }],
        inseamCm: [{ betaIdx: 4, sensitivity: 3.5 }],
      },
    });

    const betas = new Float64Array(10); // all zeros
    refineWithCustomMeasurements(betas, { waistCm: 90 });

    // With calibrated map, waistCm maps to betaIdx 3 only.
    // The hardcoded map maps waistCm to betaIdx 1 and 5.
    // So beta[3] should be modified, and beta[1] and beta[5] should remain 0.
    expect(betas[3]).not.toBe(0); // calibrated sensitivity was used
    expect(betas[1]).toBe(0);     // hardcoded betaIdx 1 was NOT used
    expect(betas[5]).toBe(0);     // hardcoded betaIdx 5 was NOT used
  });

  it('falls back to hardcoded MEASUREMENT_BETA_MAP when no coefficients loaded', () => {
    _resetCalibratedCoefficients();

    const betas = new Float64Array(10);
    refineWithCustomMeasurements(betas, { waistCm: 90 });

    // Hardcoded map: waistCm → betaIdx 1 (sensitivity 5.0), betaIdx 5 (sensitivity 3.5)
    // So beta[1] and beta[5] should be modified
    expect(betas[1]).not.toBe(0);
    expect(betas[5]).not.toBe(0);
  });

  it('preserves convergence behavior with calibrated sensitivities', async () => {
    await loadMockCoeffs({
      sensitivityMap: {
        bustCm:   [{ betaIdx: 6, sensitivity: 4.0 }, { betaIdx: 5, sensitivity: 3.0 }],
        waistCm:  [{ betaIdx: 1, sensitivity: 5.0 }, { betaIdx: 5, sensitivity: 3.5 }],
        hipCm:    [{ betaIdx: 7, sensitivity: 4.5 }],
        inseamCm: [{ betaIdx: 4, sensitivity: 3.0 }],
      },
    });

    const betas = new Float64Array(10);
    refineWithCustomMeasurements(betas, { hipCm: 105 });

    // Hip baseline is 98, target is 105, error = 7.
    // With sensitivity 4.5 on betaIdx 7, refinement should adjust beta[7].
    // After convergence, the estimate should be close to the target.
    // estimate = 98 + betas[7] * 4.5 should be near 105
    const estimate = 98 + betas[7] * 4.5;
    expect(Math.abs(estimate - 105)).toBeLessThanOrEqual(3.0);
  });

  it('returns betas unchanged when targets are empty', async () => {
    await loadMockCoeffs();

    const betas = new Float64Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]);
    const original = new Float64Array(betas);
    refineWithCustomMeasurements(betas, {});

    for (let i = 0; i < 10; i++) {
      expect(betas[i]).toBe(original[i]);
    }
  });

  it('uses calibrated sensitivities without requiring applyCalibratedCoefficients()', async () => {
    // Load coefficients but do NOT call applyCalibratedCoefficients()
    // The refinement should still use calibrated values directly from calibratedCoeffs
    await loadMockCoeffs({
      sensitivityMap: {
        bustCm:   [{ betaIdx: 2, sensitivity: 8.0 }],  // Very different from hardcoded
        waistCm:  [{ betaIdx: 1, sensitivity: 5.0 }],
        hipCm:    [{ betaIdx: 7, sensitivity: 4.5 }],
        inseamCm: [{ betaIdx: 4, sensitivity: 3.5 }],
      },
    });
    // Note: NOT calling applyCalibratedCoefficients()

    const betas = new Float64Array(10);
    refineWithCustomMeasurements(betas, { bustCm: 104 });

    // Calibrated map: bustCm → betaIdx 2 only
    // Hardcoded map: bustCm → betaIdx 6, betaIdx 5
    // If calibrated is used, beta[2] should change, beta[6] and beta[5] should not
    expect(betas[2]).not.toBe(0);
    expect(betas[6]).toBe(0);
    expect(betas[5]).toBe(0);
  });
});


/* ------------------------------------------------------------------ */
/*  End-to-end calibrated pipeline tests (Task 7.3)                    */
/*                                                                     */
/*  These tests load the REAL calibrated_coefficients.json and verify  */
/*  the full pipeline produces correct results.                        */
/*  Validates: Requirements 4.6, 4.7, 4.8, 12.1                       */
/* ------------------------------------------------------------------ */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { computeSmplBetas } from '../smplRegressor';

/** Load the real calibrated coefficients JSON from disk */
function loadRealCoefficients(): CalibratedCoefficients {
  const jsonPath = resolve(__dirname, '../../data/calibrated_coefficients.json');
  const raw = readFileSync(jsonPath, 'utf-8');
  return JSON.parse(raw) as CalibratedCoefficients;
}

/** Helper: mock fetch to return the real coefficients, then load them */
async function loadRealCoeffsViaFetch(): Promise<CalibratedCoefficients> {
  const realData = loadRealCoefficients();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(realData),
  }));
  const result = await loadCalibratedCoefficients();
  expect(result).not.toBeNull();
  applyCalibratedCoefficients();
  return realData;
}

/** Compute L2 distance between two Float64Arrays */
function l2Distance(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

describe('End-to-end calibrated pipeline — computeSmplBetas with real coefficients', () => {
  beforeEach(async () => {
    await loadRealCoeffsViaFetch();
  });

  /**
   * Validates: Requirement 12.1, 3.4
   *
   * With real calibrated coefficients loaded, computeSmplBetas() must
   * produce finite betas in [-3, 3] for a variety of valid inputs.
   */
  it('produces finite betas in [-3, 3] for diverse inputs', () => {
    const inputs = [
      { heightCm: 155, weightKg: 50, age: 20, gender: 'male' as const },
      { heightCm: 175, weightKg: 80, age: 40, gender: 'male' as const },
      { heightCm: 195, weightKg: 120, age: 60, gender: 'male' as const },
      { heightCm: 150, weightKg: 45, age: 18, gender: 'female' as const },
      { heightCm: 170, weightKg: 70, age: 35, gender: 'female' as const },
      { heightCm: 185, weightKg: 110, age: 75, gender: 'female' as const },
      { heightCm: 140, weightKg: 40, age: 18, gender: 'male' as const },
      { heightCm: 210, weightKg: 160, age: 80, gender: 'female' as const },
    ];

    for (const input of inputs) {
      const betas = computeSmplBetas({ ...input, bodyType: 'average', bodyComposition: 'average' });
      expect(betas).toBeInstanceOf(Float64Array);
      expect(betas.length).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(Number.isFinite(betas[i])).toBe(true);
        expect(betas[i]).toBeGreaterThanOrEqual(-3);
        expect(betas[i]).toBeLessThanOrEqual(3);
      }
    }
  });

  it('produces finite betas in [-3, 3] for all preset + composition combos', () => {
    const presets = ['slim', 'average', 'athletic', 'curvy', 'heavy'] as const;
    const compositions = ['athletic', 'average', 'heavy'] as const;
    const base = { heightCm: 175, weightKg: 80, age: 35, gender: 'male' as const };

    for (const bodyType of presets) {
      for (const bodyComposition of compositions) {
        const betas = computeSmplBetas({ ...base, bodyType, bodyComposition });
        expect(betas.length).toBe(10);
        for (let i = 0; i < 10; i++) {
          expect(Number.isFinite(betas[i])).toBe(true);
          expect(betas[i]).toBeGreaterThanOrEqual(-3);
          expect(betas[i]).toBeLessThanOrEqual(3);
        }
      }
    }
  });
});

describe('End-to-end calibrated pipeline — preset switching (Req 4.8)', () => {
  beforeEach(async () => {
    await loadRealCoeffsViaFetch();
  });

  /**
   * Validates: Requirement 4.8
   *
   * L2 distance between Athletic and Heavy preset beta vectors
   * SHALL be at least 0.8 at the same height/weight.
   */
  it('Athletic vs Heavy preset produces L2 distance ≥ 0.8', () => {
    const testCases = [
      { heightCm: 175, weightKg: 80, age: 30, gender: 'male' as const },
      { heightCm: 165, weightKg: 65, age: 25, gender: 'female' as const },
      { heightCm: 185, weightKg: 95, age: 45, gender: 'male' as const },
    ];

    for (const base of testCases) {
      const athleticBetas = computeSmplBetas({
        ...base,
        bodyType: 'athletic',
        bodyComposition: 'average',
      });
      const heavyBetas = computeSmplBetas({
        ...base,
        bodyType: 'heavy',
        bodyComposition: 'average',
      });

      const dist = l2Distance(athleticBetas, heavyBetas);
      expect(dist).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('Athletic vs Heavy composition produces L2 distance ≥ 0.8', () => {
    const testCases = [
      { heightCm: 175, weightKg: 80, age: 30, gender: 'male' as const },
      { heightCm: 165, weightKg: 65, age: 25, gender: 'female' as const },
      { heightCm: 185, weightKg: 95, age: 45, gender: 'male' as const },
    ];

    for (const base of testCases) {
      const athleticBetas = computeSmplBetas({
        ...base,
        bodyType: 'average',
        bodyComposition: 'athletic',
      });
      const heavyBetas = computeSmplBetas({
        ...base,
        bodyType: 'average',
        bodyComposition: 'heavy',
      });

      const dist = l2Distance(athleticBetas, heavyBetas);
      expect(dist).toBeGreaterThanOrEqual(0.8);
    }
  });
});

describe('End-to-end calibrated pipeline — composition differences (Req 4.6, 4.7)', () => {
  beforeEach(async () => {
    await loadRealCoeffsViaFetch();
  });

  /**
   * Validates: Requirement 4.6
   *
   * Athletic composition should produce measurably different betas from Average,
   * affecting multiple beta components (whole-body transformation).
   */
  it('Athletic vs Average composition affects ≥ 6 beta components', () => {
    const base = { heightCm: 175, weightKg: 80, age: 30, gender: 'male' as const };

    const averageBetas = computeSmplBetas({
      ...base,
      bodyType: 'average',
      bodyComposition: 'average',
    });
    const athleticBetas = computeSmplBetas({
      ...base,
      bodyType: 'average',
      bodyComposition: 'athletic',
    });

    let changedComponents = 0;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(athleticBetas[i] - averageBetas[i]) > 0.01) {
        changedComponents++;
      }
    }
    expect(changedComponents).toBeGreaterThanOrEqual(6);
  });

  /**
   * Validates: Requirement 4.7
   *
   * Heavy composition should produce measurably different betas from Average,
   * with β1 (weight/BMI) increasing by at least 0.4 units.
   */
  it('Heavy vs Average composition increases β1 by at least 0.4', () => {
    const base = { heightCm: 175, weightKg: 80, age: 30, gender: 'male' as const };

    const averageBetas = computeSmplBetas({
      ...base,
      bodyType: 'average',
      bodyComposition: 'average',
    });
    const heavyBetas = computeSmplBetas({
      ...base,
      bodyType: 'average',
      bodyComposition: 'heavy',
    });

    const beta1Increase = heavyBetas[1] - averageBetas[1];
    expect(beta1Increase).toBeGreaterThanOrEqual(0.4);
  });

  it('Heavy vs Average composition affects ≥ 6 beta components', () => {
    const base = { heightCm: 175, weightKg: 80, age: 30, gender: 'male' as const };

    const averageBetas = computeSmplBetas({
      ...base,
      bodyType: 'average',
      bodyComposition: 'average',
    });
    const heavyBetas = computeSmplBetas({
      ...base,
      bodyType: 'average',
      bodyComposition: 'heavy',
    });

    let changedComponents = 0;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(heavyBetas[i] - averageBetas[i]) > 0.01) {
        changedComponents++;
      }
    }
    expect(changedComponents).toBeGreaterThanOrEqual(6);
  });

  /**
   * Validates: Requirement 4.6, 4.7
   *
   * Athletic and Heavy compositions should shift betas in opposite directions
   * for key body shape components, producing visually distinct shapes.
   */
  it('Athletic and Heavy shift β1 (weight/BMI) in opposite directions from Average', () => {
    const base = { heightCm: 175, weightKg: 80, age: 30, gender: 'male' as const };

    const averageBetas = computeSmplBetas({
      ...base,
      bodyType: 'average',
      bodyComposition: 'average',
    });
    const athleticBetas = computeSmplBetas({
      ...base,
      bodyType: 'average',
      bodyComposition: 'athletic',
    });
    const heavyBetas = computeSmplBetas({
      ...base,
      bodyType: 'average',
      bodyComposition: 'heavy',
    });

    // Athletic should decrease β1 (leaner), Heavy should increase β1 (heavier)
    const athleticDelta = athleticBetas[1] - averageBetas[1];
    const heavyDelta = heavyBetas[1] - averageBetas[1];
    expect(athleticDelta).toBeLessThan(0);
    expect(heavyDelta).toBeGreaterThan(0);
  });
});
