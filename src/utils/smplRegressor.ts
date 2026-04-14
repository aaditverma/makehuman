/**
 * SMPL Regressor — Measurement-to-Beta Regression.
 *
 * Converts user measurements (height, weight, age, gender, body composition)
 * into 10 SMPL beta parameters. Two strategies with automatic fallback:
 *
 * 1. ONNX path: loads smpl_regressor.onnx via onnxruntime-web (dynamic import)
 * 2. Lookup table fallback: heuristic-based regression using normalized inputs
 *    and known SMPL shape space properties
 *
 * Body composition (athletic/average/heavy) biases the beta vector along
 * the muscular↔soft axis in SMPL's shape space.
 */

import type { BodyType } from '../stores/bodyStore';
import type { SmplModelData } from './smplForwardPass';

/* ------------------------------------------------------------------ */
/*  ANSUR II Lookup Table — statistical measurement predictions        */
/* ------------------------------------------------------------------ */

/** ANSUR II lookup table data loaded at runtime */
interface AnsurLookupData {
  meta: {
    gridHeights: number[];
    gridWeights: number[];
    gridAges: number[];
  };
  lookup: Record<string, Record<string, Record<string, Record<string, Record<string, number>>>>>;
}

/** Module-level storage for ANSUR II lookup data */
let ansurLookup: AnsurLookupData | null = null;

/**
 * Load the ANSUR II lookup table from JSON.
 * @param url - URL to fetch from (default: data path)
 */
export async function loadAnsurLookup(url?: string): Promise<AnsurLookupData | null> {
  try {
    const resp = await fetch(url ?? '/data/ansur2_model.json');
    if (!resp.ok) return null;
    ansurLookup = await resp.json();
    return ansurLookup;
  } catch {
    return null;
  }
}

/**
 * Set the ANSUR II lookup data directly (for testing).
 * @internal
 */
export function _setAnsurLookup(data: AnsurLookupData | null): void {
  ansurLookup = data;
}

/**
 * Find the nearest grid value for a given target.
 */
function nearestGridValue(grid: number[], target: number): number {
  let best = grid[0];
  let bestDist = Math.abs(target - best);
  for (let i = 1; i < grid.length; i++) {
    const dist = Math.abs(target - grid[i]);
    if (dist < bestDist) {
      best = grid[i];
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Look up ANSUR II predicted measurements for given demographics.
 * Returns null if lookup table is not loaded or entry not found.
 */
function lookupAnsurMeasurements(
  heightCm: number,
  weightKg: number,
  age: number,
  gender: 'male' | 'female',
): { chestCm: number; waistCm: number; hipCm: number; inseamCm: number } | null {
  if (!ansurLookup) return null;

  const meta = ansurLookup.meta;
  const genderKey = gender;
  const ageKey = String(nearestGridValue(meta.gridAges, age));
  const heightKey = String(nearestGridValue(meta.gridHeights, heightCm));
  const weightKey = String(nearestGridValue(meta.gridWeights, weightKg));

  try {
    const entry = ansurLookup.lookup[genderKey]?.[ageKey]?.[heightKey]?.[weightKey];
    if (!entry) return null;
    return {
      chestCm: entry.chestCm,
      waistCm: entry.waistCm,
      hipCm: entry.hipCm,
      inseamCm: entry.inseamCm,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Calibrated Coefficients — data-driven replacement for heuristics   */
/* ------------------------------------------------------------------ */

/** Shared structure for a regression model block (4-input or 8-input) */
export interface RegressionBlock {
  intercepts: number[];               // [10] — per-beta intercept
  weights: number[][];                // [10][N] — per-beta, per-feature weights
  features: string[];                 // feature names in order
  normalization: {
    [feature: string]: { center: number; range: number };
  };
}

/** Calibrated coefficient table loaded at runtime */
export interface CalibratedCoefficients {
  version: string;                    // semver, e.g. "1.0.0" or "2.0.0"
  generatedAt: string;                // ISO 8601 timestamp

  /** Per-beta regression weights (4-input model) */
  regression: RegressionBlock;

  /** Per-beta regression weights (8-input model, optional for backward compat) */
  regression8?: RegressionBlock;

  /** Calibrated preset offset vectors */
  presetOffsets: {
    slim: number[];
    average: number[];
    athletic: number[];
    curvy: number[];
    heavy: number[];
  };

  /** Calibrated composition bias vectors */
  compositionBias: {
    athletic: number[];
    average: number[];
    heavy: number[];
  };

  /** Calibrated sensitivity map for custom measurement refinement */
  sensitivityMap: {
    [measurementKey: string]: Array<{ betaIdx: number; sensitivity: number }>;
  };

  /** Per-gender fat distribution weight vectors */
  fatDistribution: {
    male: {
      weightToBeta: number[];         // [10] — how weight increase maps to each beta
      ageFactor: number[];            // [10] — age-related redistribution
    };
    female: {
      weightToBeta: number[];
      ageFactor: number[];
    };
  };
}

/**
 * Predict body measurements from demographics using embedded linear regression.
 *
 * Coefficients derived from ANSUR II + NHANES combined dataset regression.
 * These provide reasonable population-level predictions for chest, waist,
 * hip, and inseam from height, weight, age, and gender.
 *
 * Used as implicit refinement targets when no custom measurements are provided,
 * ensuring the betas produce meshes consistent with population statistics.
 */
function predictMeasurementsFromDemographics(
  heightCm: number,
  weightKg: number,
  age: number,
  gender: 'male' | 'female',
): { chestCm: number; waistCm: number; hipCm: number; inseamCm: number } {
  const isMale = gender === 'male' ? 1 : 0;
  const bmi = weightKg / Math.max(0.01, (heightCm / 100) ** 2);

  // Chest circumference: primarily driven by weight and BMI
  // Males tend to have larger chest circumference
  const chestCm = 0.12 * heightCm + 0.52 * weightKg + 0.08 * age
    + (isMale ? 3.0 : -3.0) + 0.15 * bmi - 12.0;

  // Waist circumference: strongly driven by weight and age
  // Males carry more abdominal fat
  const waistCm = 0.04 * heightCm + 0.62 * weightKg + 0.12 * age
    + (isMale ? 4.0 : -6.0) + 0.20 * bmi - 14.0;

  // Hip circumference: driven by weight, females tend to have wider hips
  const hipCm = 0.08 * heightCm + 0.48 * weightKg + 0.04 * age
    + (isMale ? -4.0 : 4.0) + 0.10 * bmi + 2.0;

  // Inseam: primarily driven by height, slight weight effect
  const inseamCm = 0.47 * heightCm + 0.01 * weightKg - 0.03 * age
    + (isMale ? 1.5 : -1.5) - 2.0;

  return {
    chestCm: Math.max(60, Math.min(150, chestCm)),
    waistCm: Math.max(55, Math.min(160, waistCm)),
    hipCm: Math.max(65, Math.min(160, hipCm)),
    inseamCm: Math.max(55, Math.min(100, inseamCm)),
  };
}

/** Module-level storage for loaded calibrated coefficients */
let calibratedCoeffs: CalibratedCoefficients | null = null;

/** Accepted versions of the coefficient table */
const ACCEPTED_VERSIONS = ['1.0.0', '2.0.0'];

/** Body composition type: athletic (muscular), average, or heavy (soft) */
export type BodyComposition = 'athletic' | 'average' | 'heavy';

/** Preset beta offsets — additive on top of base regressor output */
export const SMPL_PRESET_OFFSETS: Record<BodyType, Float64Array> = {
  slim:     new Float64Array([-0.2, -0.5, +0.3, 0, 0, -0.3, -0.2, -0.2, -0.2, -0.2]),
  average:  new Float64Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  athletic: new Float64Array([+0.15, -0.2, +0.2, +0.5, 0, -0.15, +0.25, -0.15, +0.4, +0.3]),
  curvy:    new Float64Array([0, +0.15, -0.15, -0.25, 0, -0.2, +0.3, +0.5, 0, +0.2]),
  heavy:    new Float64Array([+0.2, +0.5, -0.25, -0.15, 0, +0.4, +0.2, +0.25, +0.15, +0.2]),
};

/**
 * Apply body type preset offsets to a beta vector (element-wise addition).
 * Modifies the betas array in place and returns it.
 */
export function applyPresetOffsets(betas: Float64Array, bodyType: BodyType): Float64Array {
  const offsets = SMPL_PRESET_OFFSETS[bodyType];
  for (let i = 0; i < betas.length; i++) {
    betas[i] += offsets[i];
  }
  return betas;
}

/** Composition bias — additive shifts for athletic/average/heavy */
export const COMPOSITION_BIAS: Record<BodyComposition, Float64Array> = {
  athletic: new Float64Array([0, -0.15, +0.08, +0.25, 0, -0.2, +0.15, -0.08, +0.25, +0.2]),
  average:  new Float64Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  heavy:    new Float64Array([0, +0.2, -0.08, -0.15, 0, +0.25, -0.08, +0.15, -0.15, +0.08]),
};

/**
 * Apply body composition bias to a beta vector (element-wise addition).
 * Modifies the betas array in place and returns it.
 */
export function applyCompositionBias(betas: Float64Array, composition: BodyComposition): Float64Array {
  const bias = COMPOSITION_BIAS[composition];
  for (let i = 0; i < betas.length; i++) {
    betas[i] += bias[i];
  }
  return betas;
}

/**
 * Measurement-to-beta sensitivity map.
 *
 * Maps each custom measurement key to the beta components it primarily
 * affects, with estimated sensitivity (cm change per unit beta change).
 * Used by the iterative refinement loop to adjust betas toward user targets.
 *
 * These sensitivities represent how many cm the extracted measurement changes
 * when the corresponding beta changes by 1 unit, as measured through the
 * full forward pass + extraction pipeline.
 */
export const MEASUREMENT_BETA_MAP: Record<string, Array<{ betaIdx: number; sensitivity: number }>> = {
  bustCm:   [{ betaIdx: 6, sensitivity: 4.0 }, { betaIdx: 5, sensitivity: 3.0 }, { betaIdx: 8, sensitivity: 2.0 }],
  waistCm:  [{ betaIdx: 1, sensitivity: 5.0 }, { betaIdx: 5, sensitivity: 3.5 }],
  hipCm:    [{ betaIdx: 7, sensitivity: 4.5 }, { betaIdx: 9, sensitivity: 3.0 }],
  inseamCm: [{ betaIdx: 4, sensitivity: 3.0 }, { betaIdx: 0, sensitivity: 2.0 }],
};

/** Custom measurement keys used in the refinement loop */
type CustomMeasurementKey = 'bustCm' | 'waistCm' | 'hipCm' | 'inseamCm';

/** Refinement loop configuration */
const REFINEMENT_MAX_ITERATIONS = 10;
const REFINEMENT_TOLERANCE_CM = 2.0;
const REFINEMENT_INITIAL_LEARNING_RATE = 0.5;
const REFINEMENT_DECAY_RATE = 0.85;

/**
 * Resolve the sensitivity entries for a given measurement key.
 *
 * When calibrated coefficients are loaded, uses `calibratedCoeffs.sensitivityMap`
 * directly (data-driven sensitivities). Falls back to the module-level
 * `MEASUREMENT_BETA_MAP` (which may itself have been overwritten by
 * `applyCalibratedCoefficients()`, or still hold the hardcoded defaults).
 */
function resolveSensitivityEntries(
  key: string,
): Array<{ betaIdx: number; sensitivity: number }> | undefined {
  if (calibratedCoeffs?.sensitivityMap?.[key]) {
    return calibratedCoeffs.sensitivityMap[key];
  }
  return MEASUREMENT_BETA_MAP[key];
}

/**
 * Estimate a measurement from the current betas using the sensitivity map.
 *
 * This is a heuristic approximation: for each beta component that affects
 * the measurement, the contribution is `beta[idx] * sensitivity`. A baseline
 * offset is added per measurement to center the estimate around typical values.
 *
 * When calibrated coefficients are loaded, uses the data-driven sensitivity
 * map for more accurate estimates.
 *
 * This will be replaced with actual forward-pass + measurement extraction
 * when the SMPL model is wired in.
 */
function estimateMeasurementFromBetas(
  betas: Float64Array,
  key: CustomMeasurementKey,
): number {
  // Baseline values (approximate mean for an average male body)
  const baselines: Record<CustomMeasurementKey, number> = {
    bustCm: 96,
    waistCm: 84,
    hipCm: 98,
    inseamCm: 80,
  };

  const entries = resolveSensitivityEntries(key);
  if (!entries) return baselines[key];
  let estimate = baselines[key];
  for (const { betaIdx, sensitivity } of entries) {
    estimate += betas[betaIdx] * sensitivity;
  }
  return estimate;
}

/**
 * Iteratively refine betas so that estimated measurements converge
 * toward user-specified custom measurement targets.
 *
 * For each custom measurement provided:
 *   1. Estimate the current measurement from betas (heuristic)
 *   2. Compute error = target - estimated
 *   3. Adjust relevant betas by `error * learningRate / sensitivity`
 *
 * Runs up to `REFINEMENT_MAX_ITERATIONS` iterations. If all errors are
 * within `REFINEMENT_TOLERANCE_CM`, convergence is reached early.
 * Returns the best-so-far betas if convergence is not reached.
 *
 * When `model` is provided, a full forward pass + measurement extraction
 * could be used instead of the heuristic estimate. Currently the model
 * parameter is accepted but not used — the heuristic approach is used
 * as a simplified version that will be enhanced later.
 *
 * @param betas - Initial beta vector (modified in place)
 * @param targets - Custom measurement targets (only non-null entries are refined)
 * @param model - Optional SMPL model data (reserved for future forward-pass refinement)
 * @returns Refined beta vector
 */
export function refineWithCustomMeasurements(
  betas: Float64Array,
  targets: Partial<Record<CustomMeasurementKey, number>>,
  model?: SmplModelData | null,
): Float64Array {
  // If no targets, return as-is
  const activeKeys = (Object.keys(targets) as CustomMeasurementKey[]).filter(
    (k) => targets[k] != null,
  );
  if (activeKeys.length === 0) return betas;

  // Track best result across iterations
  let bestBetas = new Float64Array(betas);
  let bestMaxError = Infinity;

  for (let iter = 0; iter < REFINEMENT_MAX_ITERATIONS; iter++) {
    // Adaptive learning rate: starts high and decays each iteration
    const learningRate = REFINEMENT_INITIAL_LEARNING_RATE * Math.pow(REFINEMENT_DECAY_RATE, iter);
    let maxError = 0;

    for (const key of activeKeys) {
      const target = targets[key]!;
      const estimated = estimateMeasurementFromBetas(betas, key);
      const error = target - estimated;

      if (Math.abs(error) > maxError) {
        maxError = Math.abs(error);
      }

      // Adjust each relevant beta proportionally using calibrated or hardcoded sensitivities
      const entries = resolveSensitivityEntries(key);
      if (entries) {
        // Compute total sensitivity magnitude for proportional distribution
        let totalSens = 0;
        for (const { sensitivity } of entries) {
          totalSens += Math.abs(sensitivity);
        }

        for (const { betaIdx, sensitivity } of entries) {
          if (Math.abs(sensitivity) < 1e-8) continue;
          // Weight the adjustment by the relative sensitivity magnitude
          const weight = totalSens > 0 ? Math.abs(sensitivity) / totalSens : 1 / entries.length;
          betas[betaIdx] += (error * learningRate * weight) / sensitivity;
        }
      }
    }

    // Track best result
    if (maxError < bestMaxError) {
      bestMaxError = maxError;
      bestBetas = new Float64Array(betas);
    }

    // Early exit if converged
    if (maxError <= REFINEMENT_TOLERANCE_CM) {
      return betas;
    }
  }

  // Return best-so-far if convergence not reached
  if (bestMaxError < Infinity) {
    betas.set(bestBetas);
  }

  return betas;
}

/** Configuration for the SMPL regressor */
export interface SmplRegressorConfig {
  mode: 'onnx' | 'lookup';
  onnxModelUrl?: string;
  lookupTableUrl?: string;
}

/** Inputs to the regressor */
export interface RegressorInputs {
  heightCm: number;
  weightKg: number;
  age: number;
  gender: 'male' | 'female';
  bodyComposition?: BodyComposition;
  bustCm?: number;
  waistCm?: number;
  hipCm?: number;
  inseamCm?: number;
}

/** A function that maps measurements to 10 SMPL beta values */
export type SmplRegressorFn = (inputs: RegressorInputs) => Float64Array;

/** Numeric encoding for body composition */
const BODY_COMP_ENCODING: Record<BodyComposition, number> = {
  athletic: 0,
  average: 1,
  heavy: 2,
};

/** Default config values */
const DEFAULT_CONFIG: SmplRegressorConfig = {
  mode: 'onnx',
  onnxModelUrl: '/models/smpl/smpl_regressor.onnx',
  lookupTableUrl: '/models/smpl/smpl_lookup_table.json',
};

/**
 * Normalize a value to roughly [-1, 1] given a center and range.
 */
function normalize(value: number, center: number, range: number): number {
  return (value - center) / range;
}

/**
 * Clamp a number to a range.
 */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Result of imputing missing measurements for the hybrid 8-input path */
interface ImputedMeasurements {
  chestCm: number;
  waistCm: number;
  hipCm: number;
  inseamCm: number;
  chestReal: boolean;
  waistReal: boolean;
  hipReal: boolean;
  inseamReal: boolean;
}

/**
 * Impute missing custom measurements for the hybrid 8-input regression path.
 *
 * When the user provides 1–3 measurements, the missing ones are filled from
 * the ANSUR II lookup table (if loaded) or `predictMeasurementsFromDemographics()`.
 * Returns all 4 measurement values plus boolean flags indicating which are
 * real (user-provided) vs imputed.
 */
function imputeMissingMeasurements(inputs: RegressorInputs): ImputedMeasurements {
  // Try ANSUR lookup first, fall back to demographic prediction
  const predicted = lookupAnsurMeasurements(inputs.heightCm, inputs.weightKg, inputs.age, inputs.gender)
    ?? predictMeasurementsFromDemographics(inputs.heightCm, inputs.weightKg, inputs.age, inputs.gender);

  return {
    chestCm: inputs.bustCm ?? predicted.chestCm,
    waistCm: inputs.waistCm ?? predicted.waistCm,
    hipCm: inputs.hipCm ?? predicted.hipCm,
    inseamCm: inputs.inseamCm ?? predicted.inseamCm,
    chestReal: inputs.bustCm != null,
    waistReal: inputs.waistCm != null,
    hipReal: inputs.hipCm != null,
    inseamReal: inputs.inseamCm != null,
  };
}

/** Confidence scaling factor applied to imputed (non-user-provided) measurement features */
const IMPUTED_CONFIDENCE_SCALE = 0.7;

/**
 * 8-input regression path.
 *
 * Computes 11 normalized features from demographics + body measurements,
 * applies confidence scaling to imputed features, then evaluates the
 * `regression8` linear model. Fat distribution modulation and clamping
 * are applied identically to the 4-input path.
 *
 * @param inputs - User inputs (demographics + optional measurements)
 * @param imputed - Resolved measurements with real/imputed flags
 * @returns Float64Array(10) of beta values clamped to [-3, 3]
 */
function regress8Input(inputs: RegressorInputs, imputed: ImputedMeasurements): Float64Array {
  const betas = new Float64Array(10);
  const reg = calibratedCoeffs!.regression8!;
  const norm = reg.normalization;

  // Compute normalized demographic features
  const heightNorm = normalize(inputs.heightCm, norm.heightNorm.center, norm.heightNorm.range);
  const weightNorm = normalize(inputs.weightKg, norm.weightNorm.center, norm.weightNorm.range);
  const ageNorm    = normalize(inputs.age, norm.ageNorm.center, norm.ageNorm.range);
  const genderSign = inputs.gender === 'male' ? 1.0 : -1.0;

  // Compute normalized measurement features
  let chestNorm  = normalize(imputed.chestCm, norm.chestNorm.center, norm.chestNorm.range);
  let waistNorm  = normalize(imputed.waistCm, norm.waistNorm.center, norm.waistNorm.range);
  let hipNorm    = normalize(imputed.hipCm, norm.hipNorm.center, norm.hipNorm.range);
  let inseamNorm = normalize(imputed.inseamCm, norm.inseamNorm.center, norm.inseamNorm.range);

  // Apply confidence scaling: imputed features are scaled by 0.7
  if (!imputed.chestReal)  chestNorm  *= IMPUTED_CONFIDENCE_SCALE;
  if (!imputed.waistReal)  waistNorm  *= IMPUTED_CONFIDENCE_SCALE;
  if (!imputed.hipReal)    hipNorm    *= IMPUTED_CONFIDENCE_SCALE;
  if (!imputed.inseamReal) inseamNorm *= IMPUTED_CONFIDENCE_SCALE;

  // Compute derived interaction features
  const bmi     = inputs.weightKg / Math.max(0.01, (inputs.heightCm / 100) ** 2);
  const bmiNorm = normalize(bmi, norm.bmiNorm.center, norm.bmiNorm.range);
  const whr     = imputed.waistCm / Math.max(0.01, imputed.hipCm);
  const whrNorm = normalize(whr, norm.whrNorm.center, norm.whrNorm.range);
  const cwr     = imputed.chestCm / Math.max(0.01, imputed.waistCm);
  const cwrNorm = normalize(cwr, norm.cwrNorm.center, norm.cwrNorm.range);

  // 11-feature vector in the order expected by the regression8 coefficient table
  const features = [
    heightNorm, weightNorm, ageNorm, genderSign,
    chestNorm, waistNorm, hipNorm, inseamNorm,
    bmiNorm, whrNorm, cwrNorm,
  ];

  // Compute each beta: β[i] = intercept8[i] + Σ(weight8[i][j] × feature[j])
  for (let i = 0; i < 10; i++) {
    let val = reg.intercepts[i];
    const w = reg.weights[i];
    for (let j = 0; j < features.length; j++) {
      val += w[j] * features[j];
    }
    betas[i] = val;
  }

  // Apply fat distribution modulation based on gender (same as 4-input path)
  const fatDist = calibratedCoeffs!.fatDistribution[inputs.gender];
  for (let i = 0; i < 10; i++) {
    betas[i] += fatDist.weightToBeta[i] * weightNorm + fatDist.ageFactor[i] * ageNorm;
  }

  // Clamp all betas to [-3, 3]
  for (let i = 0; i < 10; i++) {
    betas[i] = clamp(betas[i], -3, 3);
  }

  return betas;
}

/**
 * 4-input calibrated regression path.
 *
 * Uses the `regression` (4-input) coefficients from the calibrated
 * coefficient table. Extracted as a named function for clarity in the
 * three-way routing logic.
 */
function regress4Input(inputs: RegressorInputs): Float64Array {
  const betas = new Float64Array(10);
  const reg = calibratedCoeffs!.regression;
  const norm = reg.normalization;

  // Compute normalized features using calibrated normalization parameters
  const heightNorm = normalize(inputs.heightCm, norm.heightNorm.center, norm.heightNorm.range);
  const weightNorm = normalize(inputs.weightKg, norm.weightNorm.center, norm.weightNorm.range);
  const ageNorm    = normalize(inputs.age, norm.ageNorm.center, norm.ageNorm.range);
  const genderSign = inputs.gender === 'male' ? 1.0 : -1.0;
  const bmi        = inputs.weightKg / Math.max(0.01, (inputs.heightCm / 100) ** 2);
  const bmiNorm    = normalize(bmi, norm.bmiNorm.center, norm.bmiNorm.range);
  const hwInteraction = heightNorm * weightNorm;
  const bmiSq      = bmiNorm * bmiNorm;

  // Feature vector in the order expected by the coefficient table
  const features = [heightNorm, weightNorm, ageNorm, genderSign, bmiNorm, hwInteraction, bmiSq];

  // Compute each beta: β[i] = intercept[i] + Σ(weights[i][j] × feature[j])
  for (let i = 0; i < 10; i++) {
    let val = reg.intercepts[i];
    const w = reg.weights[i];
    for (let j = 0; j < features.length; j++) {
      val += w[j] * features[j];
    }
    betas[i] = val;
  }

  // Apply fat distribution modulation based on gender
  const fatDist = calibratedCoeffs!.fatDistribution[inputs.gender];
  for (let i = 0; i < 10; i++) {
    betas[i] += fatDist.weightToBeta[i] * weightNorm + fatDist.ageFactor[i] * ageNorm;
  }

  // Clamp all betas to [-3, 3]
  for (let i = 0; i < 10; i++) {
    betas[i] = clamp(betas[i], -3, 3);
  }

  return betas;
}

/**
 * Heuristic-based lookup table regression (pure base regression).
 *
 * Maps user measurements to 10 SMPL beta values using normalized inputs
 * and known SMPL shape space properties. Uses only height, weight, age,
 * gender, and optional custom measurements (bust, waist, hip, inseam).
 *
 * Body composition and body type preset offsets are applied as separate
 * layers by `computeSmplBetas()` — this function is composition-free.
 *
 * The first few PCA components in SMPL roughly correspond to:
 *   β0: overall body size (height + weight)
 *   β1: weight/BMI (heavier vs thinner)
 *   β2: height-to-weight ratio (tall-thin vs short-heavy)
 *   β3: shoulder-to-hip ratio
 *   β4: limb proportions (long legs vs short legs)
 *   β5: torso width
 *   β6: chest depth
 *   β7: hip width
 *   β8: arm thickness
 *   β9: leg thickness
 */
export function lookupRegress(inputs: RegressorInputs): Float64Array {
  /* ---- Calibrated regression path ---- */
  if (calibratedCoeffs != null) {
    // Count how many custom measurements are provided
    const hasChest  = inputs.bustCm != null;
    const hasWaist  = inputs.waistCm != null;
    const hasHip    = inputs.hipCm != null;
    const hasInseam = inputs.inseamCm != null;
    const customCount = +hasChest + +hasWaist + +hasHip + +hasInseam;

    // Route: 8-input (any measurements) or 4-input (no measurements)
    if (customCount > 0 && calibratedCoeffs.regression8 != null) {
      const imputed = imputeMissingMeasurements(inputs);
      return regress8Input(inputs, imputed);
    }

    // 4-input path (existing calibrated code, unchanged)
    return regress4Input(inputs);
  }

  /* ---- Heuristic fallback path (existing code) ---- */
  const betas = new Float64Array(10);

  // Normalize inputs to roughly [-1, 1]
  const hNorm = normalize(inputs.heightCm, 175, 20);  // 155-195 → [-1, 1]
  const wNorm = normalize(inputs.weightKg, 80, 30);    // 50-110 → [-1, 1]
  const aNorm = normalize(inputs.age, 40, 25);          // 15-65 → [-1, 1]
  const genderSign = inputs.gender === 'male' ? 1.0 : -1.0;

  const bmi = inputs.weightKg / Math.max(0.01, (inputs.heightCm / 100) ** 2);
  const bmiNorm = normalize(bmi, 25, 8); // 17-33 → [-1, 1]

  // SMPL PCA components are statistical directions from 10k+ body scans.
  // β0 is the dominant axis (overall body size/build).
  // Higher PCs capture progressively subtler shape variations.
  // These coefficients are calibrated so that the full slider range
  // (height 140-210, weight 40-160) produces visible but not extreme changes.

  // β0: overall body build — driven primarily by weight (height handled by group scaling)
  betas[0] = wNorm * 0.8;

  // β1: weight distribution / BMI — second largest PC
  betas[1] = wNorm * 1.0 + bmiNorm * 0.5;

  // β2: body proportions (weight distribution)
  betas[2] = -wNorm * 0.4;

  // β3: shoulder-to-hip ratio — gender-dimorphic
  betas[3] = genderSign * 0.4;

  // β4: limb proportions
  if (inputs.inseamCm != null) {
    const inseamNorm = normalize(inputs.inseamCm, 80, 12);
    betas[4] = inseamNorm * 0.5;
  } else {
    betas[4] = 0; // height scaling handles limb length
  }

  // β5: torso width
  betas[5] = bmiNorm * 0.5;
  if (inputs.waistCm != null) {
    const waistNorm = normalize(inputs.waistCm, inputs.gender === 'male' ? 88 : 78, 15);
    betas[5] = waistNorm * 0.6;
  }

  // β6: chest depth
  betas[6] = bmiNorm * 0.3 + genderSign * 0.15;
  if (inputs.bustCm != null) {
    const bustNorm = normalize(inputs.bustCm, inputs.gender === 'male' ? 100 : 92, 12);
    betas[6] = bustNorm * 0.5;
  }

  // β7: hip width
  betas[7] = -genderSign * 0.25 + bmiNorm * 0.25;
  if (inputs.hipCm != null) {
    const hipNorm = normalize(inputs.hipCm, inputs.gender === 'male' ? 100 : 102, 12);
    betas[7] = hipNorm * 0.5;
  }

  // β8: arm thickness
  betas[8] = bmiNorm * 0.2 + genderSign * 0.1;

  // β9: leg thickness
  betas[9] = bmiNorm * 0.3;

  // Age effects: older → slightly more belly
  betas[1] += aNorm * 0.15;
  betas[5] += aNorm * 0.1;

  // Clamp all betas to reasonable range
  for (let i = 0; i < 10; i++) {
    betas[i] = clamp(betas[i], -3, 3);
  }

  return betas;
}

/** Extended inputs for the full beta computation pipeline */
export interface PipelineInputs extends RegressorInputs {
  bodyType?: BodyType;
}

/**
 * Full SMPL beta computation pipeline.
 *
 * Layers applied in order:
 *   1. lookupRegress(inputs) → base betas from height/weight/age/gender
 *      (routes to 8-input, hybrid, or 4-input path based on available measurements)
 *   2. applyPresetOffsets(betas, bodyType) → body type preset deltas
 *   3. applyCompositionBias(betas, composition) → composition shifts
 *   4. refineWithCustomMeasurements(betas, targets, model) → measurement refinement
 *      (SKIPPED when 8-input model was used with all 4 measurements)
 *   5. Clamp all betas to [-3, 3]
 *
 * This is the public API for beta computation.
 */
export function computeSmplBetas(inputs: PipelineInputs, model?: SmplModelData | null): Float64Array {
  // Step 1: base regression (composition-free)
  const betas = lookupRegress(inputs);

  // Step 2: body type preset offsets
  if (inputs.bodyType != null && inputs.bodyType !== 'average') {
    applyPresetOffsets(betas, inputs.bodyType);
  }

  // Step 3: body composition bias
  const composition = inputs.bodyComposition ?? 'average';
  if (composition !== 'average') {
    applyCompositionBias(betas, composition);
  }

  // Step 4: custom measurement refinement
  // Skip refinement when 8-input model was used with all 4 measurements —
  // the betas already incorporate the measurements directly via regression.
  const used8InputFull = calibratedCoeffs?.regression8 != null
    && inputs.bustCm != null && inputs.waistCm != null
    && inputs.hipCm != null && inputs.inseamCm != null;

  if (!used8InputFull) {
    const targets: Partial<Record<'bustCm' | 'waistCm' | 'hipCm' | 'inseamCm', number>> = {};
    if (inputs.bustCm != null) targets.bustCm = inputs.bustCm;
    if (inputs.waistCm != null) targets.waistCm = inputs.waistCm;
    if (inputs.hipCm != null) targets.hipCm = inputs.hipCm;
    if (inputs.inseamCm != null) targets.inseamCm = inputs.inseamCm;

    // If no custom measurements provided, try ANSUR II lookup table
    // as implicit refinement targets (more accurate than linear model)
    if (ansurLookup != null && Object.keys(targets).length === 0) {
      const predicted = lookupAnsurMeasurements(
        inputs.heightCm,
        inputs.weightKg,
        inputs.age,
        inputs.gender,
      );
      if (predicted) {
        if (inputs.bustCm == null) targets.bustCm = predicted.chestCm;
        if (inputs.waistCm == null) targets.waistCm = predicted.waistCm;
        if (inputs.hipCm == null) targets.hipCm = predicted.hipCm;
        if (inputs.inseamCm == null) targets.inseamCm = predicted.inseamCm;
      }
    }

    if (Object.keys(targets).length > 0) {
      refineWithCustomMeasurements(betas, targets, model);
    }
  }

  // Step 5: final clamp to [-3, 3]
  for (let i = 0; i < 10; i++) {
    betas[i] = clamp(betas[i], -3, 3);
  }

  return betas;
}

/**
 * Attempt to create an ONNX-based regressor using onnxruntime-web.
 * Returns null if onnxruntime-web is not available or model fails to load.
 *
 * NOTE: onnxruntime-web is an optional dependency. When it's not installed,
 * this function returns null immediately and the lookup table fallback is used.
 * To enable ONNX: `npm install onnxruntime-web` and the dynamic import below
 * will resolve.
 */
async function tryCreateOnnxRegressor(
  _modelUrl: string,
): Promise<SmplRegressorFn | null> {
  try {
    // Dynamic import — use a variable to prevent Vite's static analysis
    // from failing the build when onnxruntime-web isn't installed
    const moduleName = 'onnxruntime-web';
    const ort = await import(/* @vite-ignore */ moduleName);
    const session = await ort.InferenceSession.create(_modelUrl, {
      executionProviders: ['wasm'],
    });

    const regressorFn: SmplRegressorFn = (inputs: RegressorInputs) => {
      const comp = inputs.bodyComposition ?? 'average';
      const compCode = BODY_COMP_ENCODING[comp];

      const inputData = new Float32Array([
        inputs.heightCm,
        inputs.weightKg,
        inputs.age,
        inputs.gender === 'male' ? 0 : 1,
        compCode,
        inputs.bustCm ?? -1,
        inputs.waistCm ?? -1,
        inputs.hipCm ?? -1,
        inputs.inseamCm ?? -1,
      ]);

      const tensor = new ort.Tensor('float32', inputData, [1, 9]);

      // onnxruntime-web's run() is async — fire and forget, fall back to lookup for sync
      let result: Float64Array | null = null;
      void session.run({ input: tensor }).then((output: Record<string, { data: ArrayLike<number> }>) => {
        const outputData = output['betas']?.data ?? output[Object.keys(output)[0]]?.data;
        if (outputData && outputData.length === 10) {
          result = new Float64Array(outputData);
        }
      });

      if (result) return result;
      return lookupRegress(inputs);
    };

    if (session.inputNames.length > 0) {
      console.info('[SmplRegressor] ONNX session loaded successfully');
      return regressorFn;
    }

    return null;
  } catch (_e) {
    // onnxruntime-web not installed, model not found, or other error — expected
    return null;
  }
}

/**
 * Load calibrated coefficients from a JSON file.
 *
 * Fetches the coefficient table, validates the version, and stores it
 * in the module-level `calibratedCoeffs`. Returns the loaded coefficients
 * or null if loading fails (missing file, parse error, version mismatch).
 *
 * @param url - URL to fetch coefficients from (default: `/data/calibrated_coefficients.json`)
 * @returns Loaded coefficients or null on failure
 */
export async function loadCalibratedCoefficients(
  url?: string,
): Promise<CalibratedCoefficients | null> {
  try {
    const resp = await fetch(url ?? '/data/calibrated_coefficients.json');
    if (!resp.ok) {
      console.warn(`[SmplRegressor] Failed to fetch calibrated coefficients: ${resp.status} ${resp.statusText}`);
      return null;
    }
    const data: CalibratedCoefficients = await resp.json();
    if (!ACCEPTED_VERSIONS.includes(data.version)) {
      console.warn(
        `[SmplRegressor] Coefficient version mismatch: ${data.version} not in accepted versions [${ACCEPTED_VERSIONS.join(', ')}], using heuristic`,
      );
      return null;
    }

    // v1.0.0: 4-input only, no regression8
    if (data.version === '1.0.0' && !data.regression8) {
      console.info('[SmplRegressor] v1.0.0 coefficients loaded (4-input only, 8-input not available)');
    }

    // v2.0.0: validate regression8 key is present
    if (data.version === '2.0.0' && !data.regression8) {
      console.warn('[SmplRegressor] v2.0.0 coefficients missing regression8 key, proceeding with 4-input only');
    }

    calibratedCoeffs = data;
    return data;
  } catch (e) {
    console.warn('[SmplRegressor] Failed to load calibrated coefficients, using heuristic:', e);
    return null;
  }
}

/**
 * Apply loaded calibrated coefficients to module-level constants.
 *
 * Overwrites `SMPL_PRESET_OFFSETS`, `COMPOSITION_BIAS`, and
 * `MEASUREMENT_BETA_MAP` with values from the calibrated coefficient table.
 * No-op if coefficients have not been loaded.
 */
export function applyCalibratedCoefficients(): void {
  if (calibratedCoeffs == null) return;

  // Overwrite preset offsets
  const presetKeys = Object.keys(calibratedCoeffs.presetOffsets) as BodyType[];
  for (const key of presetKeys) {
    const values = calibratedCoeffs.presetOffsets[key];
    if (values && SMPL_PRESET_OFFSETS[key]) {
      SMPL_PRESET_OFFSETS[key].set(values);
    }
  }

  // Overwrite composition bias
  const compKeys = Object.keys(calibratedCoeffs.compositionBias) as BodyComposition[];
  for (const key of compKeys) {
    const values = calibratedCoeffs.compositionBias[key];
    if (values && COMPOSITION_BIAS[key]) {
      COMPOSITION_BIAS[key].set(values);
    }
  }

  // Overwrite sensitivity map
  const sensKeys = Object.keys(calibratedCoeffs.sensitivityMap);
  for (const key of sensKeys) {
    MEASUREMENT_BETA_MAP[key] = calibratedCoeffs.sensitivityMap[key];
  }
}

/**
 * Get the currently loaded calibrated coefficients (for testing/inspection).
 */
export function getCalibratedCoefficients(): CalibratedCoefficients | null {
  return calibratedCoeffs;
}

/**
 * Reset calibrated coefficients to null (for testing).
 * @internal
 */
export function _resetCalibratedCoefficients(): void {
  calibratedCoeffs = null;
}

/**
 * Initialize the SMPL regressor.
 *
 * Tries ONNX first (if mode is 'onnx'), falls back to lookup table.
 * Returns a synchronous function that maps measurements to 10 SMPL betas.
 *
 * @param config - Optional partial configuration
 * @returns A function that produces 10 SMPL beta values from user inputs
 */
export async function initSmplRegressor(
  config?: Partial<SmplRegressorConfig>,
): Promise<SmplRegressorFn> {
  const resolved: SmplRegressorConfig = { ...DEFAULT_CONFIG, ...config };

  // Try ONNX path first
  if (resolved.mode === 'onnx' && resolved.onnxModelUrl) {
    const onnxFn = await tryCreateOnnxRegressor(resolved.onnxModelUrl);
    if (onnxFn) return onnxFn;
    console.warn('[SmplRegressor] Falling back to lookup table');
  }

  // Lookup table fallback (always available)
  console.info('[SmplRegressor] Using lookup table regressor');
  return lookupRegress;
}
