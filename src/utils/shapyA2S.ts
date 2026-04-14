/**
 * SHAPY A2S (Attributes-to-Shape) Polynomial Regression Module.
 *
 * Replicates SHAPY's internal A2S polynomial regression in pure TypeScript.
 * Loads extracted coefficient artifacts (weight matrix, bias vector,
 * normalization parameters) and computes SMPL betas via:
 *
 *   1. Normalize raw inputs: (input[i] - mean[i]) / std[i]
 *   2. Expand to polynomial features (degree 2, graded lexicographic order)
 *   3. Matrix multiply: betas[i] = Σ(weights[i][j] × features[j]) + bias[i]
 *   4. Clamp to [-3, 3]
 *
 * The coefficient artifact is independent from `calibrated_coefficients.json`
 * and is loaded separately via `loadA2SCoefficients()`.
 *
 * NOTE: The current polynomial feature expansion uses sklearn-style graded
 * lexicographic ordering (matching PolynomialFeatures(degree=2, include_bias=True)).
 * When real SHAPY coefficients are extracted, re-run Task 6 to verify the
 * expansion ordering matches SHAPY's actual implementation. If SHAPY uses a
 * different ordering or additional input features (e.g., gender, age), update
 * `expandPolynomialFeatures()`, `A2SInputs`, and `hasAllA2SInputs()` accordingly.
 */

import type { RegressorInputs } from './smplRegressor';

/* ------------------------------------------------------------------ */
/*  Interfaces                                                         */
/* ------------------------------------------------------------------ */

/** Metadata from the extracted coefficient artifact */
export interface A2SMetadata {
  extractedAt: string;
  shapyVersion: string;
  polynomialDegree: number;
  inputFeatures: string[];
  numInputFeatures: number;
  numExpandedFeatures: number;
  numBetas: number;
  notes?: string;
}

/** Input normalization parameters from SHAPY training */
export interface A2SNormalization {
  inputMean: number[];   // [numInputFeatures]
  inputStd: number[];    // [numInputFeatures]
}

/** Complete A2S coefficient artifact loaded from JSON */
export interface A2SCoefficients {
  metadata: A2SMetadata;
  normalization: A2SNormalization;
  weights: number[][];          // [numBetas][numExpandedFeatures]
  bias: number[];               // [numBetas]
  polynomialOrder: string[];    // human-readable feature names
}

/** Inputs to the A2S computation — matches SHAPY's expected inputs */
export interface A2SInputs {
  heightCm: number;
  chestCm: number;
  waistCm: number;
  hipCm: number;
}

/* ------------------------------------------------------------------ */
/*  Module-level state                                                 */
/* ------------------------------------------------------------------ */

/** Module-level storage for loaded A2S coefficients */
let a2sCoefficients: A2SCoefficients | null = null;

/* ------------------------------------------------------------------ */
/*  Loading and availability                                           */
/* ------------------------------------------------------------------ */

/**
 * Load A2S coefficients from JSON artifact.
 *
 * Fetches the coefficient file, validates metadata consistency, and
 * stores in module-level variable. Returns the loaded coefficients
 * or null if loading fails.
 *
 * @param url - URL to fetch from (default: `/data/shapy_a2s_coefficients.json`)
 * @returns Loaded coefficients or null on failure
 */
export async function loadA2SCoefficients(url?: string): Promise<A2SCoefficients | null> {
  try {
    const resp = await fetch(url ?? '/data/shapy_a2s_coefficients.json');
    if (!resp.ok) {
      console.warn(`[A2S] Failed to fetch A2S coefficients: ${resp.status} ${resp.statusText}`);
      return null;
    }
    const data: A2SCoefficients = await resp.json();

    // Validate metadata consistency
    if (!data.metadata || !data.normalization || !data.weights || !data.bias) {
      console.warn('[A2S] Malformed A2S coefficient artifact: missing required fields');
      return null;
    }

    const { metadata, normalization, weights, bias } = data;

    if (metadata.numBetas < 1 || metadata.numBetas > 300) {
      console.warn(`[A2S] Invalid numBetas: ${metadata.numBetas}`);
      return null;
    }

    if (metadata.polynomialDegree < 1 || metadata.polynomialDegree > 5) {
      console.warn(`[A2S] Invalid polynomialDegree: ${metadata.polynomialDegree}`);
      return null;
    }

    if (normalization.inputMean.length !== metadata.numInputFeatures) {
      console.warn(`[A2S] inputMean length (${normalization.inputMean.length}) does not match numInputFeatures (${metadata.numInputFeatures})`);
      return null;
    }

    if (normalization.inputStd.length !== metadata.numInputFeatures) {
      console.warn(`[A2S] inputStd length (${normalization.inputStd.length}) does not match numInputFeatures (${metadata.numInputFeatures})`);
      return null;
    }

    if (weights.length !== metadata.numBetas) {
      console.warn(`[A2S] weights rows (${weights.length}) does not match numBetas (${metadata.numBetas})`);
      return null;
    }

    if (weights[0].length !== metadata.numExpandedFeatures) {
      console.warn(`[A2S] weights columns (${weights[0].length}) does not match numExpandedFeatures (${metadata.numExpandedFeatures})`);
      return null;
    }

    if (bias.length !== metadata.numBetas) {
      console.warn(`[A2S] bias length (${bias.length}) does not match numBetas (${metadata.numBetas})`);
      return null;
    }

    a2sCoefficients = data;
    console.info(`[A2S] A2S coefficients loaded: ${metadata.numInputFeatures} inputs, degree ${metadata.polynomialDegree}, ${metadata.numExpandedFeatures} expanded features, ${metadata.numBetas} betas`);
    return data;
  } catch (e) {
    console.warn('[A2S] Failed to load A2S coefficients:', e);
    return null;
  }
}

/** Check if A2S coefficients are loaded and available */
export function isA2SAvailable(): boolean {
  return a2sCoefficients !== null;
}

/**
 * Check if the given regressor inputs satisfy all A2S required fields.
 *
 * A2S requires: heightCm, bustCm (mapped to chestCm), waistCm, hipCm.
 * All must be non-null.
 */
export function hasAllA2SInputs(inputs: RegressorInputs): boolean {
  return (
    inputs.heightCm != null &&
    inputs.bustCm != null &&
    inputs.waistCm != null &&
    inputs.hipCm != null
  );
}

/**
 * Reset A2S coefficients to null (for testing).
 * @internal
 */
export function _resetA2SCoefficients(): void {
  a2sCoefficients = null;
}

/**
 * Get the currently loaded A2S coefficients (for testing/inspection).
 */
export function getA2SCoefficients(): A2SCoefficients | null {
  return a2sCoefficients;
}

/* ------------------------------------------------------------------ */
/*  Polynomial feature expansion                                       */
/* ------------------------------------------------------------------ */

/**
 * Expand a normalized input vector into polynomial features.
 *
 * Replicates sklearn's `PolynomialFeatures` with graded lexicographic order.
 * For degree 2 with K inputs, produces:
 *   [1, x₁, x₂, ..., xₖ, x₁², x₁x₂, x₁x₃, ..., xₖ²]
 *
 * Total features: 1 + K + K*(K+1)/2 for degree 2.
 *
 * @param normalizedInputs - Normalized input vector of length K
 * @param degree - Polynomial degree (typically 2)
 * @returns Expanded feature vector
 */
export function expandPolynomialFeatures(
  normalizedInputs: number[],
  degree: number,
): number[] {
  const K = normalizedInputs.length;

  if (degree === 1) {
    // [1, x₁, x₂, ..., xₖ]
    return [1, ...normalizedInputs];
  }

  if (degree === 2) {
    // [1, x₁, x₂, ..., xₖ, x₁², x₁x₂, ..., xₖ²]
    const features: number[] = [1];

    // Degree 1 terms
    for (let i = 0; i < K; i++) {
      features.push(normalizedInputs[i]);
    }

    // Degree 2 terms (graded lexicographic order)
    for (let i = 0; i < K; i++) {
      for (let j = i; j < K; j++) {
        features.push(normalizedInputs[i] * normalizedInputs[j]);
      }
    }

    return features;
  }

  // General case for degree >= 3 (recursive approach)
  // Start with bias term
  const features: number[] = [1];

  // Degree 1 terms
  for (let i = 0; i < K; i++) {
    features.push(normalizedInputs[i]);
  }

  // Degree 2 terms
  for (let i = 0; i < K; i++) {
    for (let j = i; j < K; j++) {
      features.push(normalizedInputs[i] * normalizedInputs[j]);
    }
  }

  // Degree 3 terms
  if (degree >= 3) {
    for (let i = 0; i < K; i++) {
      for (let j = i; j < K; j++) {
        for (let k = j; k < K; k++) {
          features.push(normalizedInputs[i] * normalizedInputs[j] * normalizedInputs[k]);
        }
      }
    }
  }

  return features;
}

/* ------------------------------------------------------------------ */
/*  A2S beta computation                                               */
/* ------------------------------------------------------------------ */

/**
 * Clamp a number to a range.
 */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Compute SMPL betas using SHAPY's A2S polynomial regression.
 *
 * Steps:
 *   1. Extract raw input vector from A2SInputs in the order specified
 *      by `coefficients.metadata.inputFeatures`
 *   2. Normalize: (input[i] - mean[i]) / std[i]
 *   3. Expand to polynomial features
 *   4. Matrix multiply: betas[i] = Σ(weights[i][j] × features[j]) + bias[i]
 *   5. Clamp all betas to [-3, 3]
 *
 * @param inputs - A2S inputs (height, chest, waist, hip)
 * @returns Float64Array(10) of SMPL beta parameters
 * @throws Error if A2S coefficients are not loaded
 */
export function computeA2SBetas(inputs: A2SInputs): Float64Array {
  if (a2sCoefficients === null) {
    throw new Error('[A2S] Cannot compute betas: A2S coefficients not loaded');
  }

  const { metadata, normalization, weights, bias } = a2sCoefficients;

  // Step 1: Extract raw input vector in the order specified by inputFeatures
  const inputMap: Record<string, number> = {
    height: inputs.heightCm,
    chest: inputs.chestCm,
    waist: inputs.waistCm,
    hips: inputs.hipCm,
    hip: inputs.hipCm,
    heightCm: inputs.heightCm,
    chestCm: inputs.chestCm,
    waistCm: inputs.waistCm,
    hipCm: inputs.hipCm,
  };

  const rawInputs: number[] = [];
  for (const featureName of metadata.inputFeatures) {
    const value = inputMap[featureName];
    if (value === undefined) {
      throw new Error(`[A2S] Unknown input feature: ${featureName}`);
    }
    rawInputs.push(value);
  }

  // Step 2: Normalize
  const normalizedInputs: number[] = [];
  for (let i = 0; i < rawInputs.length; i++) {
    const std = normalization.inputStd[i];
    if (Math.abs(std) < 1e-10) {
      normalizedInputs.push(0);
    } else {
      normalizedInputs.push((rawInputs[i] - normalization.inputMean[i]) / std);
    }
  }

  // Step 3: Expand to polynomial features
  const features = expandPolynomialFeatures(normalizedInputs, metadata.polynomialDegree);

  // Step 4: Matrix multiply
  const numBetas = metadata.numBetas;
  const betas = new Float64Array(numBetas);
  for (let i = 0; i < numBetas; i++) {
    let val = bias[i];
    const w = weights[i];
    for (let j = 0; j < features.length; j++) {
      val += w[j] * features[j];
    }
    betas[i] = val;
  }

  // Step 5: Clamp to [-3, 3]
  for (let i = 0; i < numBetas; i++) {
    betas[i] = clamp(betas[i], -3, 3);
  }

  return betas;
}
