/**
 * Unit tests for the SHAPY A2S TypeScript module (Task 1.4).
 *
 * Tests:
 * - expandPolynomialFeatures() with known inputs
 * - computeA2SBetas() with mock coefficients and known inputs
 * - isA2SAvailable() returns false before loading, true after
 * - hasAllA2SInputs() with complete and incomplete inputs
 * - Clamping behavior for extreme inputs
 * - Loading invalid/malformed coefficient artifact returns null
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadA2SCoefficients,
  isA2SAvailable,
  hasAllA2SInputs,
  computeA2SBetas,
  expandPolynomialFeatures,
  _resetA2SCoefficients,
  getA2SCoefficients,
} from '../shapyA2S';
import type { A2SCoefficients, A2SInputs } from '../shapyA2S';
import type { RegressorInputs } from '../smplRegressor';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Build a minimal valid A2SCoefficients object for testing */
function makeValidA2SCoefficients(overrides?: Partial<A2SCoefficients>): A2SCoefficients {
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
    weights: Array.from({ length: 10 }, () => Array.from({ length: 15 }, () => 0)),
    bias: Array.from({ length: 10 }, () => 0),
    polynomialOrder: [
      '1', 'x0', 'x1', 'x2', 'x3',
      'x0^2', 'x0*x1', 'x0*x2', 'x0*x3',
      'x1^2', 'x1*x2', 'x1*x3',
      'x2^2', 'x2*x3',
      'x3^2',
    ],
    ...overrides,
  };
}

/** Helper to mock fetch and load A2S coefficients */
async function loadMockA2S(overrides?: Partial<A2SCoefficients>): Promise<A2SCoefficients> {
  const data = makeValidA2SCoefficients(overrides);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  }));
  const result = await loadA2SCoefficients();
  expect(result).not.toBeNull();
  return data;
}

beforeEach(() => {
  _resetA2SCoefficients();
});

afterEach(() => {
  _resetA2SCoefficients();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/*  expandPolynomialFeatures tests                                     */
/* ------------------------------------------------------------------ */

describe('expandPolynomialFeatures', () => {
  it('expands [1, 2] with degree 2 to [1, 1, 2, 1, 2, 4]', () => {
    const result = expandPolynomialFeatures([1, 2], 2);
    expect(result).toEqual([1, 1, 2, 1, 2, 4]);
  });

  it('expands [3] with degree 2 to [1, 3, 9]', () => {
    const result = expandPolynomialFeatures([3], 2);
    expect(result).toEqual([1, 3, 9]);
  });

  it('expands [1, 2, 3] with degree 2 correctly', () => {
    // [1, x1, x2, x3, x1^2, x1*x2, x1*x3, x2^2, x2*x3, x3^2]
    const result = expandPolynomialFeatures([1, 2, 3], 2);
    expect(result).toEqual([1, 1, 2, 3, 1, 2, 3, 4, 6, 9]);
  });

  it('returns correct length for degree 2: 1 + K + K*(K+1)/2', () => {
    for (let K = 1; K <= 6; K++) {
      const inputs = Array.from({ length: K }, (_, i) => i + 1);
      const result = expandPolynomialFeatures(inputs, 2);
      const expectedLength = 1 + K + (K * (K + 1)) / 2;
      expect(result.length).toBe(expectedLength);
    }
  });

  it('expands with degree 1 to [1, x1, x2, ...]', () => {
    const result = expandPolynomialFeatures([5, 10], 1);
    expect(result).toEqual([1, 5, 10]);
  });

  it('handles empty input vector', () => {
    const result = expandPolynomialFeatures([], 2);
    expect(result).toEqual([1]);
  });

  it('first element is always 1 (bias term)', () => {
    const result = expandPolynomialFeatures([42, 99, -7], 2);
    expect(result[0]).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/*  isA2SAvailable tests                                               */
/* ------------------------------------------------------------------ */

describe('isA2SAvailable', () => {
  it('returns false before loading', () => {
    expect(isA2SAvailable()).toBe(false);
  });

  it('returns true after successful loading', async () => {
    await loadMockA2S();
    expect(isA2SAvailable()).toBe(true);
  });

  it('returns false after reset', async () => {
    await loadMockA2S();
    _resetA2SCoefficients();
    expect(isA2SAvailable()).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  hasAllA2SInputs tests                                              */
/* ------------------------------------------------------------------ */

describe('hasAllA2SInputs', () => {
  it('returns true when all required fields are present', () => {
    const inputs: RegressorInputs = {
      heightCm: 175,
      weightKg: 80,
      age: 30,
      gender: 'male',
      bustCm: 100,
      waistCm: 85,
      hipCm: 100,
    };
    expect(hasAllA2SInputs(inputs)).toBe(true);
  });

  it('returns false when bustCm is missing', () => {
    const inputs: RegressorInputs = {
      heightCm: 175,
      weightKg: 80,
      age: 30,
      gender: 'male',
      waistCm: 85,
      hipCm: 100,
    };
    expect(hasAllA2SInputs(inputs)).toBe(false);
  });

  it('returns false when waistCm is missing', () => {
    const inputs: RegressorInputs = {
      heightCm: 175,
      weightKg: 80,
      age: 30,
      gender: 'male',
      bustCm: 100,
      hipCm: 100,
    };
    expect(hasAllA2SInputs(inputs)).toBe(false);
  });

  it('returns false when hipCm is missing', () => {
    const inputs: RegressorInputs = {
      heightCm: 175,
      weightKg: 80,
      age: 30,
      gender: 'male',
      bustCm: 100,
      waistCm: 85,
    };
    expect(hasAllA2SInputs(inputs)).toBe(false);
  });

  it('returns false when no custom measurements provided', () => {
    const inputs: RegressorInputs = {
      heightCm: 175,
      weightKg: 80,
      age: 30,
      gender: 'male',
    };
    expect(hasAllA2SInputs(inputs)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  loadA2SCoefficients tests                                          */
/* ------------------------------------------------------------------ */

describe('loadA2SCoefficients', () => {
  it('loads valid coefficients and stores them', async () => {
    const data = makeValidA2SCoefficients();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    }));

    const result = await loadA2SCoefficients();
    expect(result).not.toBeNull();
    expect(result!.metadata.polynomialDegree).toBe(2);
    expect(getA2SCoefficients()).toBe(result);
  });

  it('uses custom URL when provided', async () => {
    const data = makeValidA2SCoefficients();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    });
    vi.stubGlobal('fetch', mockFetch);

    await loadA2SCoefficients('/custom/a2s.json');
    expect(mockFetch).toHaveBeenCalledWith('/custom/a2s.json');
  });

  it('returns null on fetch failure (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadA2SCoefficients();
    expect(result).toBeNull();
    expect(getA2SCoefficients()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null on HTTP error (404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadA2SCoefficients();
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null when metadata is missing', async () => {
    const data = { normalization: {}, weights: [], bias: [] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadA2SCoefficients();
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null when weights rows mismatch numBetas', async () => {
    const data = makeValidA2SCoefficients();
    data.weights = data.weights.slice(0, 5); // only 5 rows instead of 10
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadA2SCoefficients();
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null when inputMean length mismatches numInputFeatures', async () => {
    const data = makeValidA2SCoefficients();
    data.normalization.inputMean = [170.0, 95.0]; // only 2 instead of 4
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadA2SCoefficients();
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns null when polynomialDegree is out of range', async () => {
    const data = makeValidA2SCoefficients();
    data.metadata.polynomialDegree = 10;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadA2SCoefficients();
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/*  computeA2SBetas tests                                              */
/* ------------------------------------------------------------------ */

describe('computeA2SBetas', () => {
  it('throws when coefficients are not loaded', () => {
    expect(() => computeA2SBetas({
      heightCm: 175, chestCm: 95, waistCm: 80, hipCm: 100,
    })).toThrow('A2S coefficients not loaded');
  });

  it('returns Float64Array(10) with all zeros for zero weights and bias', async () => {
    await loadMockA2S();

    const betas = computeA2SBetas({
      heightCm: 175, chestCm: 95, waistCm: 80, hipCm: 100,
    });

    expect(betas).toBeInstanceOf(Float64Array);
    expect(betas.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      expect(betas[i]).toBe(0);
    }
  });

  it('returns bias values when weights are zero', async () => {
    const biasValues = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    await loadMockA2S({ bias: biasValues });

    const betas = computeA2SBetas({
      heightCm: 175, chestCm: 95, waistCm: 80, hipCm: 100,
    });

    for (let i = 0; i < 10; i++) {
      expect(betas[i]).toBeCloseTo(biasValues[i], 10);
    }
  });

  it('computes correct betas with known weights', async () => {
    // Set up: inputs at mean values → normalized to [0, 0, 0, 0]
    // Polynomial features: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    // So betas[i] = weights[i][0] * 1 + bias[i]
    const weights = Array.from({ length: 10 }, (_, i) => {
      const w = Array.from({ length: 15 }, () => 0);
      w[0] = (i + 1) * 0.1; // weight for bias feature (constant 1)
      return w;
    });

    await loadMockA2S({ weights });

    const betas = computeA2SBetas({
      heightCm: 170, chestCm: 95, waistCm: 80, hipCm: 100,
    });

    for (let i = 0; i < 10; i++) {
      expect(betas[i]).toBeCloseTo((i + 1) * 0.1, 5);
    }
  });

  it('normalizes inputs correctly', async () => {
    // Set weight on the first linear feature (x0 = height) for beta 0
    const weights = Array.from({ length: 10 }, () => Array.from({ length: 15 }, () => 0));
    weights[0][1] = 1.0; // weight for x0 (height)

    await loadMockA2S({ weights });

    // height = 180, mean = 170, std = 10 → normalized = (180 - 170) / 10 = 1.0
    const betas = computeA2SBetas({
      heightCm: 180, chestCm: 95, waistCm: 80, hipCm: 100,
    });

    expect(betas[0]).toBeCloseTo(1.0, 5);
  });

  it('clamps betas to [-3, 3] for extreme values', async () => {
    // Set very large bias values
    const bias = [5, -5, 10, -10, 4, -4, 8, -8, 3.5, -3.5];
    await loadMockA2S({ bias });

    const betas = computeA2SBetas({
      heightCm: 170, chestCm: 95, waistCm: 80, hipCm: 100,
    });

    for (let i = 0; i < 10; i++) {
      expect(betas[i]).toBeGreaterThanOrEqual(-3);
      expect(betas[i]).toBeLessThanOrEqual(3);
    }
    expect(betas[0]).toBe(3);
    expect(betas[1]).toBe(-3);
  });

  it('produces all finite numbers for valid inputs', async () => {
    // Use non-zero weights to exercise the full computation
    const weights = Array.from({ length: 10 }, () =>
      Array.from({ length: 15 }, () => (Math.random() - 0.5) * 0.1),
    );
    await loadMockA2S({ weights });

    const inputs: A2SInputs[] = [
      { heightCm: 150, chestCm: 80, waistCm: 65, hipCm: 85 },
      { heightCm: 200, chestCm: 125, waistCm: 115, hipCm: 130 },
      { heightCm: 175, chestCm: 95, waistCm: 80, hipCm: 100 },
    ];

    for (const input of inputs) {
      const betas = computeA2SBetas(input);
      expect(betas.length).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(Number.isFinite(betas[i])).toBe(true);
        expect(betas[i]).toBeGreaterThanOrEqual(-3);
        expect(betas[i]).toBeLessThanOrEqual(3);
      }
    }
  });

  it('handles zero std by producing 0 for that normalized input', async () => {
    const data = makeValidA2SCoefficients();
    data.normalization.inputStd[0] = 0; // zero std for height
    const weights = Array.from({ length: 10 }, () => Array.from({ length: 15 }, () => 0));
    weights[0][1] = 1.0; // weight for x0 (height)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    }));
    await loadA2SCoefficients();

    const betas = computeA2SBetas({
      heightCm: 999, chestCm: 95, waistCm: 80, hipCm: 100,
    });

    // With zero std, normalized height should be 0, so beta[0] = 0
    expect(betas[0]).toBe(0);
  });
});
