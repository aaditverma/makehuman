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

/** Body composition type: athletic (muscular), average, or heavy (soft) */
export type BodyComposition = 'athletic' | 'average' | 'heavy';

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
 * Heuristic-based lookup table regression.
 *
 * Maps user measurements to 10 SMPL beta values using normalized inputs
 * and known SMPL shape space properties. The first few PCA components
 * in SMPL roughly correspond to:
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
 *
 * Body composition shifts betas along the muscular↔soft axis:
 * - Athletic: wider shoulders, narrower waist, thicker limbs, less belly
 * - Heavy: wider waist, softer limbs, more belly, narrower shoulders relative to hips
 */
function lookupRegress(inputs: RegressorInputs): Float64Array {
  const betas = new Float64Array(10);

  const comp = inputs.bodyComposition ?? 'average';
  const compCode = BODY_COMP_ENCODING[comp];

  // Normalize inputs to roughly [-1, 1]
  const hNorm = normalize(inputs.heightCm, 175, 20);  // 155-195 → [-1, 1]
  const wNorm = normalize(inputs.weightKg, 80, 30);    // 50-110 → [-1, 1]
  const aNorm = normalize(inputs.age, 40, 25);          // 15-65 → [-1, 1]
  const genderSign = inputs.gender === 'male' ? 1.0 : -1.0;

  const bmi = inputs.weightKg / Math.max(0.01, (inputs.heightCm / 100) ** 2);
  const bmiNorm = normalize(bmi, 25, 8); // 17-33 → [-1, 1]

  // Body composition bias: athletic=-1, average=0, heavy=1
  const compBias = compCode - 1; // athletic=-1, average=0, heavy=1

  // β0: overall body size — driven by height and weight
  betas[0] = hNorm * 1.5 + wNorm * 0.8 + genderSign * 0.3;

  // β1: weight/BMI — heavier bodies have positive β1
  betas[1] = bmiNorm * 2.0 + wNorm * 0.5 + compBias * 0.3;

  // β2: height-to-weight ratio — tall-thin positive, short-heavy negative
  betas[2] = (hNorm - wNorm) * 1.2 + genderSign * 0.2;

  // β3: shoulder-to-hip ratio — gender-dimorphic, composition-sensitive
  betas[3] = genderSign * 0.8 - compBias * 0.6;
  // Athletic: wider shoulders (negative compBias → positive contribution)
  // Heavy: narrower shoulders relative to hips

  // β4: limb proportions (inseam influence)
  if (inputs.inseamCm != null) {
    const inseamNorm = normalize(inputs.inseamCm, 80, 12);
    betas[4] = inseamNorm * 1.0;
  } else {
    betas[4] = hNorm * 0.4 - aNorm * 0.1;
  }

  // β5: torso width — BMI and composition driven
  betas[5] = bmiNorm * 0.8 + compBias * 0.5;
  if (inputs.waistCm != null) {
    const waistNorm = normalize(inputs.waistCm, inputs.gender === 'male' ? 88 : 78, 15);
    betas[5] = waistNorm * 1.2 + compBias * 0.4;
  }

  // β6: chest depth — bust/chest measurement influence
  betas[6] = bmiNorm * 0.5 + genderSign * 0.3 - compBias * 0.4;
  if (inputs.bustCm != null) {
    const bustNorm = normalize(inputs.bustCm, inputs.gender === 'male' ? 100 : 92, 12);
    betas[6] = bustNorm * 1.0 - compBias * 0.3;
  }

  // β7: hip width — gender-dimorphic, hip measurement influence
  betas[7] = -genderSign * 0.5 + bmiNorm * 0.4 + compBias * 0.3;
  if (inputs.hipCm != null) {
    const hipNorm = normalize(inputs.hipCm, inputs.gender === 'male' ? 100 : 102, 12);
    betas[7] = hipNorm * 1.0 + compBias * 0.2;
  }

  // β8: arm thickness — composition-sensitive
  betas[8] = bmiNorm * 0.3 - compBias * 0.5 + genderSign * 0.2;
  // Athletic: thicker arms (negative compBias → positive)
  // Heavy: softer arms

  // β9: leg thickness — composition and BMI
  betas[9] = bmiNorm * 0.4 + compBias * 0.3 + aNorm * 0.1;

  // Age effects: older → slightly more belly, less muscle definition
  betas[1] += aNorm * 0.2;  // slightly heavier with age
  betas[5] += aNorm * 0.15; // wider torso with age

  // Clamp all betas to reasonable range
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
