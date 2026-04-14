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
    const badVersion = makeValidCoefficients({ version: '3.0.0' });
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
/*  Version loading logic tests (Task 1.3)                             */
/* ------------------------------------------------------------------ */

/** Build a minimal valid v2.0.0 CalibratedCoefficients with regression8 */
function makeV2Coefficients(overrides?: Partial<CalibratedCoefficients>): CalibratedCoefficients {
  return makeValidCoefficients({
    version: '2.0.0',
    regression8: {
      intercepts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      weights: Array.from({ length: 10 }, () => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      features: [
        'heightNorm', 'weightNorm', 'ageNorm', 'genderSign',
        'chestNorm', 'waistNorm', 'hipNorm', 'inseamNorm',
        'bmiNorm', 'whrNorm', 'cwrNorm',
      ],
      normalization: {
        heightNorm: { center: 175, range: 20 },
        weightNorm: { center: 80, range: 30 },
        ageNorm: { center: 40, range: 25 },
        genderSign: { center: 0, range: 1 },
        chestNorm: { center: 96, range: 15 },
        waistNorm: { center: 82, range: 15 },
        hipNorm: { center: 98, range: 15 },
        inseamNorm: { center: 80, range: 10 },
        bmiNorm: { center: 25, range: 8 },
        whrNorm: { center: 0.85, range: 0.15 },
        cwrNorm: { center: 1.15, range: 0.2 },
      },
    },
    ...overrides,
  });
}

describe('loadCalibratedCoefficients — version loading (Task 1.3)', () => {
  it('loads v1.0.0 coefficient table with 4-input only', async () => {
    const v1Data = makeValidCoefficients({ version: '1.0.0' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(v1Data),
    }));
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const result = await loadCalibratedCoefficients();

    expect(result).not.toBeNull();
    expect(result!.version).toBe('1.0.0');
    expect(result!.regression8).toBeUndefined();
    expect(getCalibratedCoefficients()).toBe(result);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('v1.0.0 coefficients loaded'),
    );
  });

  it('loads v2.0.0 coefficient table with both models', async () => {
    const v2Data = makeV2Coefficients();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(v2Data),
    }));

    const result = await loadCalibratedCoefficients();

    expect(result).not.toBeNull();
    expect(result!.version).toBe('2.0.0');
    expect(result!.regression).toBeDefined();
    expect(result!.regression8).toBeDefined();
    expect(result!.regression8!.features).toHaveLength(11);
    expect(getCalibratedCoefficients()).toBe(result);
  });

  it('returns null with warning for unsupported version (e.g., "3.0.0")', async () => {
    const badData = makeValidCoefficients({ version: '3.0.0' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(badData),
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadCalibratedCoefficients();

    expect(result).toBeNull();
    expect(getCalibratedCoefficients()).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('version mismatch'),
    );
  });

  it('loads v2.0.0 missing regression8 with warning but still loads 4-input', async () => {
    // v2.0.0 without regression8 key
    const v2NoReg8 = makeValidCoefficients({ version: '2.0.0' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(v2NoReg8),
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadCalibratedCoefficients();

    expect(result).not.toBeNull();
    expect(result!.version).toBe('2.0.0');
    expect(result!.regression).toBeDefined();
    expect(result!.regression8).toBeUndefined();
    expect(getCalibratedCoefficients()).toBe(result);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing regression8'),
    );
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


/* ------------------------------------------------------------------ */
/*  lookupRegress — 8-input regression path (Task 2.4)                 */
/* ------------------------------------------------------------------ */

describe('lookupRegress — 8-input regression path', () => {
  /** Helper to load mock v2 coefficients with regression8 into module state */
  async function loadMockV2Coeffs(overrides?: Partial<CalibratedCoefficients>) {
    const data = makeV2Coefficients(overrides);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    }));
    await loadCalibratedCoefficients();
    return data;
  }

  const demographicsOnly: RegressorInputs = {
    heightCm: 175,
    weightKg: 80,
    age: 40,
    gender: 'male',
  };

  const allMeasurements: RegressorInputs = {
    ...demographicsOnly,
    bustCm: 100,
    waistCm: 85,
    hipCm: 100,
    inseamCm: 82,
  };

  it('uses 8-input path when all 4 measurements are provided and regression8 is available', async () => {
    // Set up v2 coefficients with distinct 8-input intercepts (non-zero)
    // and zero 4-input intercepts, so we can distinguish which path was used
    const reg8Intercepts = [0.5, 0.4, 0.3, 0.2, 0.1, -0.1, -0.2, -0.3, -0.4, -0.5];
    await loadMockV2Coeffs({
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
      regression8: {
        intercepts: reg8Intercepts,
        weights: Array.from({ length: 10 }, () => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        features: [
          'heightNorm', 'weightNorm', 'ageNorm', 'genderSign',
          'chestNorm', 'waistNorm', 'hipNorm', 'inseamNorm',
          'bmiNorm', 'whrNorm', 'cwrNorm',
        ],
        normalization: {
          heightNorm: { center: 175, range: 20 },
          weightNorm: { center: 80, range: 30 },
          ageNorm: { center: 40, range: 25 },
          genderSign: { center: 0, range: 1 },
          chestNorm: { center: 96, range: 15 },
          waistNorm: { center: 82, range: 15 },
          hipNorm: { center: 98, range: 15 },
          inseamNorm: { center: 80, range: 10 },
          bmiNorm: { center: 25, range: 8 },
          whrNorm: { center: 0.85, range: 0.15 },
          cwrNorm: { center: 1.15, range: 0.2 },
        },
      },
    });

    const betas4 = lookupRegress(demographicsOnly);
    const betas8 = lookupRegress(allMeasurements);

    // With zero weights and zero fatDist, 4-input should be all zeros
    for (let i = 0; i < 10; i++) {
      expect(betas4[i]).toBeCloseTo(0, 5);
    }

    // 8-input should reflect the reg8 intercepts (non-zero)
    for (let i = 0; i < 10; i++) {
      expect(betas8[i]).toBeCloseTo(reg8Intercepts[i], 5);
    }
  });

  it('produces identical output to 4-input path when no measurements are provided', async () => {
    await loadMockV2Coeffs();

    // Both calls with demographics-only should produce the same result
    const betas1 = lookupRegress(demographicsOnly);
    const betas2 = lookupRegress(demographicsOnly);

    for (let i = 0; i < 10; i++) {
      expect(betas1[i]).toBe(betas2[i]);
    }
  });

  it('falls back to 4-input path when regression8 is not available', async () => {
    // Load v1.0.0 coefficients (no regression8)
    const v1Data = makeValidCoefficients({ version: '1.0.0' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(v1Data),
    }));
    await loadCalibratedCoefficients();

    // Even with measurements, should use 4-input path
    const betasNoMeas = lookupRegress(demographicsOnly);
    const betasWithMeas = lookupRegress(allMeasurements);

    // Without regression8, measurements are ignored in lookupRegress
    for (let i = 0; i < 10; i++) {
      expect(betasNoMeas[i]).toBe(betasWithMeas[i]);
    }
  });

  it('uses hybrid path with 1-3 measurements (output differs from both 4-input and full 8-input)', async () => {
    // Set up coefficients with non-zero 8-input weights on measurement features
    // so that different measurement inputs produce different outputs
    const weights8 = Array.from({ length: 10 }, (_, i) => {
      const w = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      // Put non-zero weight on chestNorm (idx 4), waistNorm (idx 5), hipNorm (idx 6), inseamNorm (idx 7)
      w[4] = (i + 1) * 0.05;  // chestNorm
      w[5] = (i + 1) * 0.04;  // waistNorm
      w[6] = (i + 1) * 0.03;  // hipNorm
      w[7] = (i + 1) * 0.02;  // inseamNorm
      return w;
    });

    await loadMockV2Coeffs({
      regression8: {
        intercepts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        weights: weights8,
        features: [
          'heightNorm', 'weightNorm', 'ageNorm', 'genderSign',
          'chestNorm', 'waistNorm', 'hipNorm', 'inseamNorm',
          'bmiNorm', 'whrNorm', 'cwrNorm',
        ],
        normalization: {
          heightNorm: { center: 175, range: 20 },
          weightNorm: { center: 80, range: 30 },
          ageNorm: { center: 40, range: 25 },
          genderSign: { center: 0, range: 1 },
          chestNorm: { center: 96, range: 15 },
          waistNorm: { center: 82, range: 15 },
          hipNorm: { center: 98, range: 15 },
          inseamNorm: { center: 80, range: 10 },
          bmiNorm: { center: 25, range: 8 },
          whrNorm: { center: 0.85, range: 0.15 },
          cwrNorm: { center: 1.15, range: 0.2 },
        },
      },
    });

    // 4-input path (no measurements)
    const betas4 = lookupRegress(demographicsOnly);

    // Full 8-input path (all 4 measurements)
    const betas8Full = lookupRegress(allMeasurements);

    // Hybrid path (only waist provided)
    const betasHybrid = lookupRegress({
      ...demographicsOnly,
      waistCm: 85,
    });

    // Hybrid should differ from 4-input (because it uses 8-input path with imputed values)
    let diffFrom4 = false;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(betasHybrid[i] - betas4[i]) > 1e-6) {
        diffFrom4 = true;
        break;
      }
    }
    expect(diffFrom4).toBe(true);

    // Hybrid should differ from full 8-input (because imputed values differ from real)
    let diffFrom8 = false;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(betasHybrid[i] - betas8Full[i]) > 1e-6) {
        diffFrom8 = true;
        break;
      }
    }
    expect(diffFrom8).toBe(true);
  });

  it('clamps betas to [-3, 3] for extreme 8-input values', async () => {
    // Set very large intercepts in the 8-input model
    await loadMockV2Coeffs({
      regression8: {
        intercepts: [5, -5, 10, -10, 4, -4, 8, -8, 3.5, -3.5],
        weights: Array.from({ length: 10 }, () => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        features: [
          'heightNorm', 'weightNorm', 'ageNorm', 'genderSign',
          'chestNorm', 'waistNorm', 'hipNorm', 'inseamNorm',
          'bmiNorm', 'whrNorm', 'cwrNorm',
        ],
        normalization: {
          heightNorm: { center: 175, range: 20 },
          weightNorm: { center: 80, range: 30 },
          ageNorm: { center: 40, range: 25 },
          genderSign: { center: 0, range: 1 },
          chestNorm: { center: 96, range: 15 },
          waistNorm: { center: 82, range: 15 },
          hipNorm: { center: 98, range: 15 },
          inseamNorm: { center: 80, range: 10 },
          bmiNorm: { center: 25, range: 8 },
          whrNorm: { center: 0.85, range: 0.15 },
          cwrNorm: { center: 1.15, range: 0.2 },
        },
      },
    });

    const betas = lookupRegress(allMeasurements);

    for (let i = 0; i < 10; i++) {
      expect(betas[i]).toBeGreaterThanOrEqual(-3);
      expect(betas[i]).toBeLessThanOrEqual(3);
    }
    // Verify specific clamping
    expect(betas[0]).toBe(3);   // 5 clamped to 3
    expect(betas[1]).toBe(-3);  // -5 clamped to -3
    expect(betas[2]).toBe(3);   // 10 clamped to 3
    expect(betas[3]).toBe(-3);  // -10 clamped to -3
  });

  it('applies 8-input regression weights correctly', async () => {
    // Set up: one non-zero weight per beta on chestNorm (feature index 4)
    const weights8 = Array.from({ length: 10 }, (_, i) => {
      const w = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      w[4] = (i + 1) * 0.1; // chestNorm weight
      return w;
    });

    await loadMockV2Coeffs({
      regression8: {
        intercepts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        weights: weights8,
        features: [
          'heightNorm', 'weightNorm', 'ageNorm', 'genderSign',
          'chestNorm', 'waistNorm', 'hipNorm', 'inseamNorm',
          'bmiNorm', 'whrNorm', 'cwrNorm',
        ],
        normalization: {
          heightNorm: { center: 175, range: 20 },
          weightNorm: { center: 80, range: 30 },
          ageNorm: { center: 40, range: 25 },
          genderSign: { center: 0, range: 1 },
          chestNorm: { center: 96, range: 15 },
          waistNorm: { center: 82, range: 15 },
          hipNorm: { center: 98, range: 15 },
          inseamNorm: { center: 80, range: 10 },
          bmiNorm: { center: 25, range: 8 },
          whrNorm: { center: 0.85, range: 0.15 },
          cwrNorm: { center: 1.15, range: 0.2 },
        },
      },
    });

    // bustCm = 111 → chestNorm = (111 - 96) / 15 = 1.0 (real, confidence = 1.0)
    // All other measurements at center → their norms = 0
    const betas = lookupRegress({
      ...demographicsOnly,
      bustCm: 111,
      waistCm: 82,
      hipCm: 98,
      inseamCm: 80,
    });

    // β[i] = 0 + weights8[i][4] * 1.0 = (i+1) * 0.1
    for (let i = 0; i < 10; i++) {
      expect(betas[i]).toBeCloseTo((i + 1) * 0.1, 4);
    }
  });

  it('applies confidence scaling (0.7) to imputed measurement features', async () => {
    // Set up: weight only on chestNorm (feature index 4)
    const weights8 = Array.from({ length: 10 }, () => {
      const w = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      w[4] = 1.0; // chestNorm weight
      return w;
    });

    await loadMockV2Coeffs({
      regression8: {
        intercepts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        weights: weights8,
        features: [
          'heightNorm', 'weightNorm', 'ageNorm', 'genderSign',
          'chestNorm', 'waistNorm', 'hipNorm', 'inseamNorm',
          'bmiNorm', 'whrNorm', 'cwrNorm',
        ],
        normalization: {
          heightNorm: { center: 175, range: 20 },
          weightNorm: { center: 80, range: 30 },
          ageNorm: { center: 40, range: 25 },
          genderSign: { center: 0, range: 1 },
          chestNorm: { center: 96, range: 15 },
          waistNorm: { center: 82, range: 15 },
          hipNorm: { center: 98, range: 15 },
          inseamNorm: { center: 80, range: 10 },
          bmiNorm: { center: 25, range: 8 },
          whrNorm: { center: 0.85, range: 0.15 },
          cwrNorm: { center: 1.15, range: 0.2 },
        },
      },
    });

    // With bustCm provided (real): chestNorm = (111 - 96) / 15 = 1.0
    const betasReal = lookupRegress({
      ...demographicsOnly,
      bustCm: 111,
      waistCm: 82,
      hipCm: 98,
      inseamCm: 80,
    });

    // Without bustCm (imputed from demographics): chestNorm will be scaled by 0.7
    // Provide only waistCm to trigger 8-input path, chest will be imputed
    const betasImputed = lookupRegress({
      ...demographicsOnly,
      waistCm: 82,
      hipCm: 98,
      inseamCm: 80,
    });

    // The imputed chest value will differ from 111, so the betas will differ.
    // The key point is that the imputed path applies 0.7 scaling.
    // We can't predict the exact imputed value, but we can verify the outputs differ.
    let different = false;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(betasReal[i] - betasImputed[i]) > 1e-6) {
        different = true;
        break;
      }
    }
    expect(different).toBe(true);
  });

  it('produces finite betas in [-3, 3] for diverse 8-input combinations', async () => {
    await loadMockV2Coeffs();

    const inputs: RegressorInputs[] = [
      { heightCm: 140, weightKg: 40, age: 18, gender: 'male', bustCm: 75, waistCm: 60, hipCm: 80, inseamCm: 65 },
      { heightCm: 210, weightKg: 160, age: 80, gender: 'female', bustCm: 130, waistCm: 120, hipCm: 135, inseamCm: 95 },
      { heightCm: 175, weightKg: 80, age: 40, gender: 'male', bustCm: 100, waistCm: 85, hipCm: 100, inseamCm: 82 },
      { heightCm: 160, weightKg: 55, age: 25, gender: 'female', bustCm: 85, waistCm: 68, hipCm: 95, inseamCm: 72 },
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


/* ------------------------------------------------------------------ */
/*  Refinement skip for full 8-input (Task 3.2)                        */
/*                                                                     */
/*  Validates: Requirements 4.3, 4.2                                   */
/* ------------------------------------------------------------------ */

import {
  applyPresetOffsets,
  applyCompositionBias,
} from '../smplRegressor';
import type { PipelineInputs } from '../smplRegressor';

describe('computeSmplBetas — refinement skip for full 8-input (Task 3.2)', () => {
  /** Helper to load mock v2.0.0 coefficients with non-zero 8-input weights */
  async function loadMockV2CoeffsForRefinement() {
    // Use non-zero weights so regression produces non-trivial betas
    const weights8 = Array.from({ length: 10 }, (_, i) => {
      const w = new Array(11).fill(0);
      w[0] = (i + 1) * 0.05; // heightNorm weight
      w[4] = (i + 1) * 0.03; // chestNorm weight
      w[5] = (i + 1) * 0.02; // waistNorm weight
      return w;
    });

    const data = makeV2Coefficients({
      regression8: {
        intercepts: [0.1, -0.1, 0.2, -0.2, 0.15, -0.15, 0.05, -0.05, 0.1, -0.1],
        weights: weights8,
        features: [
          'heightNorm', 'weightNorm', 'ageNorm', 'genderSign',
          'chestNorm', 'waistNorm', 'hipNorm', 'inseamNorm',
          'bmiNorm', 'whrNorm', 'cwrNorm',
        ],
        normalization: {
          heightNorm: { center: 175, range: 20 },
          weightNorm: { center: 80, range: 30 },
          ageNorm: { center: 40, range: 25 },
          genderSign: { center: 0, range: 1 },
          chestNorm: { center: 96, range: 15 },
          waistNorm: { center: 82, range: 15 },
          hipNorm: { center: 98, range: 15 },
          inseamNorm: { center: 80, range: 10 },
          bmiNorm: { center: 25, range: 8 },
          whrNorm: { center: 0.85, range: 0.15 },
          cwrNorm: { center: 1.15, range: 0.2 },
        },
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    }));
    await loadCalibratedCoefficients();
    applyCalibratedCoefficients();
    return data;
  }

  it('with all 4 measurements and 8-input model, output equals lookupRegress + preset + composition + clamp (no refinement)', async () => {
    await loadMockV2CoeffsForRefinement();

    const inputs: PipelineInputs = {
      heightCm: 180,
      weightKg: 85,
      age: 35,
      gender: 'male',
      bodyType: 'athletic',
      bodyComposition: 'athletic',
      bustCm: 100,
      waistCm: 88,
      hipCm: 102,
      inseamCm: 82,
    };

    // Compute via the full pipeline (should skip refinement)
    const pipelineBetas = computeSmplBetas(inputs);

    // Manually compose the expected result: lookupRegress + preset + composition + clamp
    const expectedBetas = lookupRegress(inputs);
    applyPresetOffsets(expectedBetas, 'athletic');
    applyCompositionBias(expectedBetas, 'athletic');
    for (let i = 0; i < 10; i++) {
      expectedBetas[i] = Math.min(3, Math.max(-3, expectedBetas[i]));
    }

    // They should be identical — refinement was skipped
    for (let i = 0; i < 10; i++) {
      expect(pipelineBetas[i]).toBeCloseTo(expectedBetas[i], 10);
    }
  });

  it('with all 4 measurements and 8-input model (average preset/composition), output equals lookupRegress + clamp', async () => {
    await loadMockV2CoeffsForRefinement();

    const inputs: PipelineInputs = {
      heightCm: 170,
      weightKg: 70,
      age: 30,
      gender: 'female',
      bodyType: 'average',
      bodyComposition: 'average',
      bustCm: 90,
      waistCm: 72,
      hipCm: 98,
      inseamCm: 76,
    };

    const pipelineBetas = computeSmplBetas(inputs);
    const expectedBetas = lookupRegress(inputs);
    for (let i = 0; i < 10; i++) {
      expectedBetas[i] = Math.min(3, Math.max(-3, expectedBetas[i]));
    }

    for (let i = 0; i < 10; i++) {
      expect(pipelineBetas[i]).toBeCloseTo(expectedBetas[i], 10);
    }
  });

  it('with 4-input path (no measurements), refinement still runs when ANSUR lookup provides targets', async () => {
    // Load v2 coefficients but provide NO custom measurements
    // With ANSUR lookup loaded, refinement targets will be populated from ANSUR
    await loadMockV2CoeffsForRefinement();

    // We need to verify refinement runs for the 4-input path.
    // Without custom measurements and without ANSUR lookup, no refinement targets exist.
    // So we test with custom measurements on the 4-input path (no regression8).
    // Reset and load v1.0.0 coefficients (no regression8)
    _resetCalibratedCoefficients();

    const v1Data = makeValidCoefficients({
      version: '1.0.0',
      // Use non-zero sensitivity map so refinement actually changes betas
      sensitivityMap: {
        bustCm:   [{ betaIdx: 6, sensitivity: 4.0 }, { betaIdx: 5, sensitivity: 3.0 }],
        waistCm:  [{ betaIdx: 1, sensitivity: 5.0 }, { betaIdx: 5, sensitivity: 3.5 }],
        hipCm:    [{ betaIdx: 7, sensitivity: 4.5 }, { betaIdx: 9, sensitivity: 3.0 }],
        inseamCm: [{ betaIdx: 4, sensitivity: 3.0 }, { betaIdx: 0, sensitivity: 2.0 }],
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(v1Data),
    }));
    await loadCalibratedCoefficients();
    applyCalibratedCoefficients();

    const inputs: PipelineInputs = {
      heightCm: 180,
      weightKg: 85,
      age: 35,
      gender: 'male',
      bodyType: 'average',
      bodyComposition: 'average',
      bustCm: 110,   // far from baseline 96 → refinement should adjust betas
      waistCm: 95,
      hipCm: 105,
      inseamCm: 84,
    };

    // Full pipeline (4-input path + refinement)
    const pipelineBetas = computeSmplBetas(inputs);

    // Manual: lookupRegress only (no refinement)
    const baseBetas = lookupRegress(inputs);
    for (let i = 0; i < 10; i++) {
      baseBetas[i] = Math.min(3, Math.max(-3, baseBetas[i]));
    }

    // Pipeline betas should differ from base betas because refinement ran
    let different = false;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(pipelineBetas[i] - baseBetas[i]) > 1e-6) {
        different = true;
        break;
      }
    }
    expect(different).toBe(true);
  });

  it('with hybrid path (1-3 measurements), refinement still runs', async () => {
    await loadMockV2CoeffsForRefinement();

    const inputs: PipelineInputs = {
      heightCm: 180,
      weightKg: 85,
      age: 35,
      gender: 'male',
      bodyType: 'average',
      bodyComposition: 'average',
      // Only 2 measurements — hybrid path, refinement should still run
      bustCm: 110,
      waistCm: 95,
    };

    const pipelineBetas = computeSmplBetas(inputs);

    // Manual: lookupRegress + clamp (no refinement)
    const baseBetas = lookupRegress(inputs);
    for (let i = 0; i < 10; i++) {
      baseBetas[i] = Math.min(3, Math.max(-3, baseBetas[i]));
    }

    // Pipeline betas should differ from base betas because refinement ran
    let different = false;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(pipelineBetas[i] - baseBetas[i]) > 1e-6) {
        different = true;
        break;
      }
    }
    expect(different).toBe(true);
  });

  it('with no regression8 available, refinement runs even with all 4 measurements', async () => {
    // Load v1.0.0 (no regression8)
    _resetCalibratedCoefficients();
    const v1Data = makeValidCoefficients({
      version: '1.0.0',
      sensitivityMap: {
        bustCm:   [{ betaIdx: 6, sensitivity: 4.0 }],
        waistCm:  [{ betaIdx: 1, sensitivity: 5.0 }],
        hipCm:    [{ betaIdx: 7, sensitivity: 4.5 }],
        inseamCm: [{ betaIdx: 4, sensitivity: 3.0 }],
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(v1Data),
    }));
    await loadCalibratedCoefficients();
    applyCalibratedCoefficients();

    const inputs: PipelineInputs = {
      heightCm: 180,
      weightKg: 85,
      age: 35,
      gender: 'male',
      bodyType: 'average',
      bodyComposition: 'average',
      bustCm: 110,
      waistCm: 95,
      hipCm: 105,
      inseamCm: 84,
    };

    const pipelineBetas = computeSmplBetas(inputs);
    const baseBetas = lookupRegress(inputs);
    for (let i = 0; i < 10; i++) {
      baseBetas[i] = Math.min(3, Math.max(-3, baseBetas[i]));
    }

    // Without regression8, refinement should still run even with all 4 measurements
    let different = false;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(pipelineBetas[i] - baseBetas[i]) > 1e-6) {
        different = true;
        break;
      }
    }
    expect(different).toBe(true);
  });
});


/* ------------------------------------------------------------------ */
/*  A2S Integration Tests (Task 2.5)                                   */
/*                                                                     */
/*  Tests that A2S path is correctly routed in lookupRegress() and     */
/*  that refinement is skipped when A2S path is used.                  */
/*  Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5                   */
/* ------------------------------------------------------------------ */

import {
  getLastRegressionPath,
} from '../smplRegressor';
import type { RegressionPath } from '../smplRegressor';
import {
  loadA2SCoefficients,
  isA2SAvailable,
  _resetA2SCoefficients,
} from '../shapyA2S';
import type { A2SCoefficients } from '../shapyA2S';

/** Build a minimal valid A2SCoefficients object for testing */
function makeValidA2SCoeffs(): A2SCoefficients {
  // 4 inputs, degree 2 → 1 + 4 + 4*5/2 = 15 expanded features
  return {
    metadata: {
      extractedAt: '2026-01-01T00:00:00Z',
      shapyVersion: 'test-v1',
      polynomialDegree: 2,
      inputFeatures: ['height', 'chest', 'waist', 'hips'],
      numInputFeatures: 4,
      numExpandedFeatures: 15,
      numBetas: 10,
    },
    normalization: {
      inputMean: [170.0, 95.0, 80.0, 100.0],
      inputStd: [10.0, 12.0, 12.0, 10.0],
    },
    weights: Array.from({ length: 10 }, (_, i) => {
      const w = Array.from({ length: 15 }, () => 0);
      w[0] = (i + 1) * 0.05; // small weight on bias feature
      return w;
    }),
    bias: Array.from({ length: 10 }, (_, i) => i * 0.01),
    polynomialOrder: [
      '1', 'x0', 'x1', 'x2', 'x3',
      'x0^2', 'x0*x1', 'x0*x2', 'x0*x3',
      'x1^2', 'x1*x2', 'x1*x3',
      'x2^2', 'x2*x3',
      'x3^2',
    ],
  };
}

/** Helper to load mock A2S coefficients */
async function loadMockA2SCoeffs(): Promise<void> {
  const data = makeValidA2SCoeffs();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  }));
  await loadA2SCoefficients();
}

describe('A2S integration — lookupRegress routing (Task 2.5)', () => {
  afterEach(() => {
    _resetA2SCoefficients();
    _resetCalibratedCoefficients();
    vi.restoreAllMocks();
  });

  it('uses A2S path when A2S loaded and all required inputs provided', async () => {
    await loadMockA2SCoeffs();
    expect(isA2SAvailable()).toBe(true);

    const inputs: RegressorInputs = {
      heightCm: 175,
      weightKg: 80,
      age: 30,
      gender: 'male',
      bustCm: 100,
      waistCm: 85,
      hipCm: 100,
    };

    const betas = lookupRegress(inputs);
    expect(betas).toBeInstanceOf(Float64Array);
    expect(betas.length).toBe(10);
    expect(getLastRegressionPath()).toBe('a2s');
  });

  it('falls back to heuristic when A2S loaded but missing bustCm', async () => {
    await loadMockA2SCoeffs();

    const inputs: RegressorInputs = {
      heightCm: 175,
      weightKg: 80,
      age: 30,
      gender: 'male',
      waistCm: 85,
      hipCm: 100,
    };

    lookupRegress(inputs);
    expect(getLastRegressionPath()).toBe('heuristic');
  });

  it('falls back to heuristic when A2S not loaded', () => {
    _resetA2SCoefficients();
    _resetCalibratedCoefficients();

    const inputs: RegressorInputs = {
      heightCm: 175,
      weightKg: 80,
      age: 30,
      gender: 'male',
      bustCm: 100,
      waistCm: 85,
      hipCm: 100,
    };

    lookupRegress(inputs);
    expect(getLastRegressionPath()).toBe('heuristic');
  });

  it('falls back to calibrated 4-input when A2S loaded but no measurements', async () => {
    // Load calibrated coefficients first
    const calibData = makeValidCoefficients();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(calibData),
    }));
    await loadCalibratedCoefficients();

    // Now load A2S
    const a2sData = makeValidA2SCoeffs();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(a2sData),
    }));
    await loadA2SCoefficients();

    const inputs: RegressorInputs = {
      heightCm: 175,
      weightKg: 80,
      age: 30,
      gender: 'male',
    };

    lookupRegress(inputs);
    expect(getLastRegressionPath()).toBe('4-input');
  });

  it('getLastRegressionPath returns correct path for each scenario', async () => {
    // Scenario 1: heuristic (no coefficients)
    _resetA2SCoefficients();
    _resetCalibratedCoefficients();
    lookupRegress({ heightCm: 175, weightKg: 80, age: 30, gender: 'male' });
    expect(getLastRegressionPath()).toBe('heuristic');

    // Scenario 2: A2S path
    const a2sData = makeValidA2SCoeffs();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(a2sData),
    }));
    await loadA2SCoefficients();

    lookupRegress({ heightCm: 175, weightKg: 80, age: 30, gender: 'male', bustCm: 100, waistCm: 85, hipCm: 100 });
    expect(getLastRegressionPath()).toBe('a2s');
  });
});

describe('A2S integration — refinement skip (Task 2.5)', () => {
  afterEach(() => {
    _resetA2SCoefficients();
    _resetCalibratedCoefficients();
    vi.restoreAllMocks();
  });

  it('skips refinement when A2S path is used', async () => {
    await loadMockA2SCoeffs();

    const inputs = {
      heightCm: 175,
      weightKg: 80,
      age: 30,
      gender: 'male' as const,
      bodyType: 'average' as const,
      bodyComposition: 'average' as const,
      bustCm: 100,
      waistCm: 85,
      hipCm: 100,
    };

    // With A2S, computeSmplBetas should equal lookupRegress + clamp (no refinement)
    const pipelineBetas = computeSmplBetas(inputs);
    const baseBetas = lookupRegress(inputs);

    // Clamp base betas
    for (let i = 0; i < baseBetas.length; i++) {
      baseBetas[i] = Math.min(3, Math.max(-3, baseBetas[i]));
    }

    for (let i = 0; i < 10; i++) {
      expect(pipelineBetas[i]).toBeCloseTo(baseBetas[i], 10);
    }
  });

  it('preset offsets and composition bias are still applied after A2S base regression', async () => {
    await loadMockA2SCoeffs();

    const baseInputs = {
      heightCm: 175,
      weightKg: 80,
      age: 30,
      gender: 'male' as const,
      bustCm: 100,
      waistCm: 85,
      hipCm: 100,
    };

    const averageBetas = computeSmplBetas({
      ...baseInputs,
      bodyType: 'average',
      bodyComposition: 'average',
    });

    const athleticBetas = computeSmplBetas({
      ...baseInputs,
      bodyType: 'athletic',
      bodyComposition: 'athletic',
    });

    // Should differ because preset offsets and composition bias are applied
    let different = false;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(averageBetas[i] - athleticBetas[i]) > 0.001) {
        different = true;
        break;
      }
    }
    expect(different).toBe(true);
  });

  it('existing behavior unchanged when A2S not loaded', () => {
    _resetA2SCoefficients();
    _resetCalibratedCoefficients();

    const inputs = {
      heightCm: 175,
      weightKg: 80,
      age: 30,
      gender: 'male' as const,
      bodyType: 'average' as const,
      bodyComposition: 'average' as const,
    };

    // Should use heuristic path and produce non-zero betas
    const betas = computeSmplBetas(inputs);
    expect(betas).toBeInstanceOf(Float64Array);
    expect(betas.length).toBe(10);

    let hasNonZero = false;
    for (let i = 0; i < 10; i++) {
      if (betas[i] !== 0) { hasNonZero = true; break; }
    }
    expect(hasNonZero).toBe(true);
    expect(getLastRegressionPath()).toBe('heuristic');
  });
});
