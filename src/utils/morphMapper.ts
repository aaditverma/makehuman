import type { UserInputs, Gender, BodyType, BodyComposition } from '../stores/bodyStore';
import type { ExtractedMeasurements } from './measurementExtractor';
import model from '../data/ansur2_model.json';
import profileData from '../data/bodyProfiles.json';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const lookup = (model as any).lookup;
const popStats = (model as any).populationStats;
const gridHeights: number[] = (model as any).meta.gridHeights;
const gridWeights: number[] = (model as any).meta.gridWeights;
const gridAges: number[] = (model as any).meta.gridAges;

/** Find the two nearest values in a sorted array for interpolation. */
function bracket(arr: number[], val: number): [number, number, number] {
  const clamped = Math.max(arr[0], Math.min(arr[arr.length - 1], val));
  for (let i = 0; i < arr.length - 1; i++) {
    if (clamped >= arr[i] && clamped <= arr[i + 1]) {
      const t = (clamped - arr[i]) / (arr[i + 1] - arr[i]);
      return [arr[i], arr[i + 1], t];
    }
  }
  return [arr[arr.length - 1], arr[arr.length - 1], 0];
}

/** Lookup a measurement from the grid with trilinear interpolation (height, weight, age). */
function lookupMeasurement(gender: Gender, height: number, weight: number, age: number, measurement: string): number {
  const gKey = gender === 'male' ? 'male' : 'female';
  const gData = lookup[gKey];
  if (!gData) return 0;

  const [h0, h1, ht] = bracket(gridHeights, height);
  const [w0, w1, wt] = bracket(gridWeights, weight);
  const [a0, a1, at] = bracket(gridAges, age);

  // Trilinear interpolation across height, weight, age
  function getVal(h: number, w: number, a: number): number {
    const entry = gData[String(a)]?.[String(h)]?.[String(w)];
    return entry?.[measurement] ?? 0;
  }

  // Interpolate along weight for each height+age corner
  const v000 = getVal(h0, w0, a0); const v001 = getVal(h0, w1, a0);
  const v010 = getVal(h1, w0, a0); const v011 = getVal(h1, w1, a0);
  const v100 = getVal(h0, w0, a1); const v101 = getVal(h0, w1, a1);
  const v110 = getVal(h1, w0, a1); const v111 = getVal(h1, w1, a1);

  const c00 = v000 + (v001 - v000) * wt;
  const c01 = v010 + (v011 - v010) * wt;
  const c10 = v100 + (v101 - v100) * wt;
  const c11 = v110 + (v111 - v110) * wt;

  const c0 = c00 + (c01 - c00) * ht;
  const c1 = c10 + (c11 - c10) * ht;

  return c0 + (c1 - c0) * at;
}

function getBodyTypeData(bodyType: BodyType) {
  return (profileData.bodyTypes as any)[bodyType];
}

/**
 * Body composition morph boosts for MakeHuman-only mode (no SMPL measurements).
 * Maps bodyComposition to existing morph modifiers.
 */
const BODY_COMPOSITION_BOOSTS: Record<BodyComposition, Record<string, number>> = {
  athletic: {
    Muscular: 0.3,
    WiderShoulders: 0.2,
    NarrowerWaist: 0.15,
    BiggerStomach: -0.2,
  },
  average: {},
  heavy: {
    Heavier: 0.2,
    BiggerStomach: 0.25,
    LoveHandles: 0.15,
    Muscular: -0.2,
  },
};

/**
 * Converts user inputs into morph target influences using the
 * gradient boosting lookup table trained on ANSUR II + NHANES.
 *
 * When smplMeasurements is provided, uses those values for chest/waist/hip/etc.
 * instead of the ANSUR II lookup table. The z-score computation and morph
 * mapping logic remain unchanged — only the input measurements change.
 *
 * In MakeHuman-only mode (no SMPL measurements), bodyComposition maps to
 * existing morph modifiers (athletic → Muscular/WiderShoulders, heavy → Heavier/BiggerStomach).
 */
export function inputsToMorphs(
  u: UserInputs,
  smplMeasurements?: ExtractedMeasurements | null,
): Record<string, number> {
  const g = u.gender;
  const bmi = u.weightKg / Math.max(0.01, (u.heightCm / 100) ** 2);
  const hasSmpl = smplMeasurements != null;

  // Predict measurements: use SMPL measurements when available, otherwise ANSUR II lookup
  const chest = hasSmpl
    ? smplMeasurements.chestCm
    : (u.bustCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'chestCm'));
  const waist = hasSmpl
    ? smplMeasurements.waistCm
    : (u.waistCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'waistCm'));
  const hip = hasSmpl
    ? smplMeasurements.hipCm
    : (u.hipCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'hipCm'));
  const shoulder = hasSmpl
    ? smplMeasurements.shoulderCm
    : lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'shoulderCm');
  const neck = hasSmpl
    ? smplMeasurements.neckCm
    : lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'neckCm');
  const bicep = hasSmpl
    ? smplMeasurements.bicepCm
    : lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'bicepCm');
  const thigh = hasSmpl
    ? smplMeasurements.thighCm
    : lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'thighCm');
  const calf = hasSmpl
    ? smplMeasurements.calfCm
    : lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'calfCm');
  const inseam = hasSmpl
    ? smplMeasurements.inseamCm
    : (u.inseamCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'inseamCm'));

  // Get population stats for Z-scores
  const gStats = popStats[g === 'male' ? 'male' : 'female'] ?? {};
  function zScore(val: number, key: string): number {
    const s = gStats[key];
    if (!s || !s.std || s.std === 0) return 0;
    return (val - s.mean) / s.std;
  }

  const chestZ = zScore(chest, 'chestCm');
  const waistZ = zScore(waist, 'waistCm');
  const hipZ = zScore(hip, 'hipCm');
  const shoulderZ = zScore(shoulder, 'shoulderCm');
  const neckZ = zScore(neck, 'neckCm');
  const bicepZ = zScore(bicep, 'bicepCm');
  const thighZ = zScore(thigh, 'thighCm');
  const calfZ = zScore(calf, 'calfCm');
  const inseamZ = zScore(inseam, 'inseamCm');
  const overallZ = (chestZ + waistZ + hipZ + thighZ) / 4;

  // Body type modifiers
  const btData = getBodyTypeData(u.bodyType);
  const responses = btData.morphResponses;
  function baseInfluence(name: string, scale: number): number {
    const resp = (responses as any)[name];
    return resp ? resp.maxInfluence * scale : 0;
  }

  const zToMorph = (z: number, scale: number = 0.5) => clamp01(z * scale);
  const zToMorphNeg = (z: number, scale: number = 0.5) => clamp01(-z * scale);

  const morphs: Record<string, number> = {
    Heavier: clamp01(overallZ * 0.35),
    Thinner: clamp01(-overallZ * 0.35),
    Muscular: baseInfluence('Muscular', 1.0),

    // Regional: max of data-driven OR body type (no stacking)
    WiderShoulders: Math.min(Math.max(zToMorph(shoulderZ, 0.5), baseInfluence('WiderShoulders', 0.5)), 1.0),
    WiderHips: Math.min(Math.max(zToMorph(hipZ, 0.5), baseInfluence('WiderHips', 0.5)), 1.0),
    BiggerChest: Math.min(Math.max(zToMorph(chestZ, 0.5), baseInfluence('BiggerChest', 0.4)), 1.0),
    BiggerStomach: Math.min(Math.max(zToMorph(waistZ, 0.5), baseInfluence('BiggerStomach', 0.4)), 1.0),
    WiderBack: Math.min(Math.max(zToMorph(chestZ, 0.4), baseInfluence('WiderBack', 0.4)), 1.0),
    DeeperChest: Math.min(Math.max(zToMorph(chestZ, 0.4), baseInfluence('DeeperChest', 0.4)), 1.0),
    NarrowerWaist: Math.min(Math.max(zToMorphNeg(waistZ, 0.4), baseInfluence('NarrowerWaist', 0.5)), 1.0),
    ThickerNeck: Math.min(Math.max(zToMorph(neckZ, 0.4), baseInfluence('ThickerNeck', 0.4)), 1.0),
    ThickerUpperArms: Math.min(Math.max(zToMorph(bicepZ, 0.5), baseInfluence('ThickerUpperArms', 0.4)), 1.0),
    ThickerThighs: Math.min(Math.max(zToMorph(thighZ, 0.5), baseInfluence('ThickerThighs', 0.4)), 1.0),
    ThickerCalves: Math.min(Math.max(zToMorph(calfZ, 0.4), baseInfluence('ThickerCalves', 0.4)), 1.0),

    LongerLegs: zToMorph(inseamZ, 0.3),
    LongerArms: 0,
    LongerTorso: zToMorphNeg(inseamZ, 0.3),

    // Fat deposits: BMI-driven only
    BellyPouch: clamp01((bmi - 28) / 10),
    LoveHandles: clamp01((bmi - 30) / 12),
    BackFat: clamp01((bmi - 32) / 12),
    UpperArmSag: clamp01((bmi - 30) / 15),
    DoubleChin: clamp01((bmi - 32) / 15),
    InnerThighFat: clamp01((bmi - 28) / 12),
  };

  // In MakeHuman-only mode (no SMPL measurements), apply body composition boosts.
  // When SMPL is active, body composition is already encoded in the beta vector,
  // so the SMPL measurements already reflect it — no additional boost needed.
  if (!hasSmpl) {
    const composition = u.bodyComposition ?? 'average';
    const boosts = BODY_COMPOSITION_BOOSTS[composition];
    for (const [key, boost] of Object.entries(boosts)) {
      morphs[key] = clamp01((morphs[key] ?? 0) + boost);
    }
  }

  return morphs;
}

export interface EstimatedMeasurements {
  bustCm: number;
  waistCm: number;
  hipCm: number;
  highHipCm: number;
  inseamCm: number;
  shoulderCm: number;
  neckCm: number;
  bicepCm: number;
  thighCm: number;
  calfCm: number;
  wristCm: number;
  bmi: number;
}

/**
 * Returns estimated measurements using the gradient boosting lookup table,
 * or SMPL-extracted measurements when available.
 */
export function estimatedMeasurements(
  u: UserInputs,
  smplMeasurements?: ExtractedMeasurements | null,
): EstimatedMeasurements {
  const g = u.gender;
  const bmi = u.weightKg / Math.max(0.01, (u.heightCm / 100) ** 2);

  // When SMPL measurements are available, prefer them over ANSUR II lookup
  if (smplMeasurements != null) {
    const waist = smplMeasurements.waistCm;
    const hip = smplMeasurements.hipCm;
    return {
      bustCm: Math.round(smplMeasurements.chestCm),
      waistCm: Math.round(waist),
      hipCm: Math.round(hip),
      highHipCm: Math.round(u.highHipCm ?? (waist * 0.4 + hip * 0.6)),
      inseamCm: Math.round(smplMeasurements.inseamCm),
      shoulderCm: Math.round(smplMeasurements.shoulderCm),
      neckCm: Math.round(smplMeasurements.neckCm),
      bicepCm: Math.round(smplMeasurements.bicepCm),
      thighCm: Math.round(smplMeasurements.thighCm),
      calfCm: Math.round(smplMeasurements.calfCm),
      wristCm: Math.round(smplMeasurements.wristCm),
      bmi: Math.round(bmi * 10) / 10,
    };
  }

  const waist = u.waistCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'waistCm');
  const hip = u.hipCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'hipCm');

  return {
    bustCm: Math.round(u.bustCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'chestCm')),
    waistCm: Math.round(waist),
    hipCm: Math.round(hip),
    highHipCm: Math.round(u.highHipCm ?? (waist * 0.4 + hip * 0.6)),
    inseamCm: Math.round(u.inseamCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'inseamCm')),
    shoulderCm: Math.round(lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'shoulderCm')),
    neckCm: Math.round(lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'neckCm')),
    bicepCm: Math.round(lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'bicepCm')),
    thighCm: Math.round(lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'thighCm')),
    calfCm: Math.round(lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'calfCm')),
    wristCm: Math.round(lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'wristCm')),
    bmi: Math.round(bmi * 10) / 10,
  };
}
