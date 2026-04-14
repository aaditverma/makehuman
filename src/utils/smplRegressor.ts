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
 */
export const MEASUREMENT_BETA_MAP: Record<string, Array<{ betaIdx: number; sensitivity: number }>> = {
  bustCm:   [{ betaIdx: 6, sensitivity: 4.0 }, { betaIdx: 5, sensitivity: 3.0 }],
  waistCm:  [{ betaIdx: 1, sensitivity: 5.0 }, { betaIdx: 5, sensitivity: 3.5 }],
  hipCm:    [{ betaIdx: 7, sensitivity: 4.5 }],
  inseamCm: [{ betaIdx: 4, sensitivity: 3.0 }],
};

/** Custom measurement keys used in the refinement loop */
type CustomMeasurementKey = 'bustCm' | 'waistCm' | 'hipCm' | 'inseamCm';

/** Refinement loop configuration */
const REFINEMENT_MAX_ITERATIONS = 5;
const REFINEMENT_TOLERANCE_CM = 3.0;
const REFINEMENT_LEARNING_RATE = 0.3;

/**
 * Estimate a measurement from the current betas using the sensitivity map.
 *
 * This is a heuristic approximation: for each beta component that affects
 * the measurement, the contribution is `beta[idx] * sensitivity`. A baseline
 * offset is added per measurement to center the estimate around typical values.
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

  const entries = MEASUREMENT_BETA_MAP[key];
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
  // If no model and no targets, return as-is
  const activeKeys = (Object.keys(targets) as CustomMeasurementKey[]).filter(
    (k) => targets[k] != null,
  );
  if (activeKeys.length === 0) return betas;

  // Track best result across iterations
  let bestBetas = new Float64Array(betas);
  let bestMaxError = Infinity;

  for (let iter = 0; iter < REFINEMENT_MAX_ITERATIONS; iter++) {
    let maxError = 0;

    for (const key of activeKeys) {
      const target = targets[key]!;
      const estimated = estimateMeasurementFromBetas(betas, key);
      const error = target - estimated;

      if (Math.abs(error) > maxError) {
        maxError = Math.abs(error);
      }

      // Adjust each relevant beta proportionally
      const entries = MEASUREMENT_BETA_MAP[key];
      for (const { betaIdx, sensitivity } of entries) {
        betas[betaIdx] += (error * REFINEMENT_LEARNING_RATE) / sensitivity;
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
 *   2. applyPresetOffsets(betas, bodyType) → body type preset deltas
 *   3. applyCompositionBias(betas, composition) → composition shifts
 *   4. refineWithCustomMeasurements(betas, targets, model) → measurement refinement
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
  const targets: Partial<Record<'bustCm' | 'waistCm' | 'hipCm' | 'inseamCm', number>> = {};
  if (inputs.bustCm != null) targets.bustCm = inputs.bustCm;
  if (inputs.waistCm != null) targets.waistCm = inputs.waistCm;
  if (inputs.hipCm != null) targets.hipCm = inputs.hipCm;
  if (inputs.inseamCm != null) targets.inseamCm = inputs.inseamCm;

  if (Object.keys(targets).length > 0) {
    refineWithCustomMeasurements(betas, targets, model);
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
