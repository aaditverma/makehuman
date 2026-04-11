import type { UserInputs, Gender, BodyType } from '../stores/bodyStore';
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
 * Converts user inputs into morph target influences using the
 * gradient boosting lookup table trained on ANSUR II + NHANES.
 */
export function inputsToMorphs(u: UserInputs): Record<string, number> {
  const g = u.gender;
  const bmi = u.weightKg / Math.max(0.01, (u.heightCm / 100) ** 2);

  // Predict measurements from the lookup table
  const chest = u.bustCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'chestCm');
  const waist = u.waistCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'waistCm');
  const hip = u.hipCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'hipCm');
  const shoulder = lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'shoulderCm');
  const neck = lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'neckCm');
  const bicep = lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'bicepCm');
  const thigh = lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'thighCm');
  const calf = lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'calfCm');
  const inseam = u.inseamCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'inseamCm');

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

  return {
    Heavier: clamp01(overallZ * 0.35),
    Thinner: clamp01(-overallZ * 0.35),
    Muscular: baseInfluence('Muscular', 1.0),
    WiderShoulders: Math.min(zToMorph(shoulderZ, 0.5) + baseInfluence('WiderShoulders', 0.4), 1.0),
    WiderHips: Math.min(zToMorph(hipZ, 0.5) + baseInfluence('WiderHips', 0.4), 1.0),
    BiggerChest: Math.min(zToMorph(chestZ, 0.5) + baseInfluence('BiggerChest', 0.3), 1.0),
    BiggerStomach: Math.min(zToMorph(waistZ, 0.5) + baseInfluence('BiggerStomach', 0.3), 1.0),
    WiderBack: Math.min(zToMorph(chestZ, 0.4) + baseInfluence('WiderBack', 0.3), 1.0),
    DeeperChest: Math.min(zToMorph(chestZ, 0.4) + baseInfluence('DeeperChest', 0.3), 1.0),
    NarrowerWaist: Math.min(zToMorphNeg(waistZ, 0.4) + baseInfluence('NarrowerWaist', 0.4), 1.0),
    ThickerNeck: Math.min(zToMorph(neckZ, 0.4) + baseInfluence('ThickerNeck', 0.3), 1.0),
    ThickerUpperArms: Math.min(zToMorph(bicepZ, 0.5) + baseInfluence('ThickerUpperArms', 0.3), 1.0),
    ThickerThighs: Math.min(zToMorph(thighZ, 0.5) + baseInfluence('ThickerThighs', 0.3), 1.0),
    ThickerCalves: Math.min(zToMorph(calfZ, 0.4) + baseInfluence('ThickerCalves', 0.3), 1.0),
    LongerLegs: zToMorph(inseamZ, 0.3),
    LongerArms: 0,
    LongerTorso: zToMorphNeg(inseamZ, 0.3),

    // Fat deposit morphs — activate progressively at higher BMIs
    BellyPouch: clamp01((bmi - 28) / 10),       // starts at BMI 28, full at 38
    LoveHandles: clamp01((bmi - 30) / 12),       // starts at BMI 30
    BackFat: clamp01((bmi - 32) / 12),            // starts at BMI 32
    UpperArmSag: clamp01((bmi - 30) / 15),        // subtle, starts at BMI 30
    DoubleChin: clamp01((bmi - 32) / 15),         // starts at BMI 32
    InnerThighFat: clamp01((bmi - 28) / 12),      // starts at BMI 28
  };
}

/**
 * Returns estimated measurements using the gradient boosting lookup table.
 */
export function estimatedMeasurements(u: UserInputs) {
  const g = u.gender;
  const bmi = u.weightKg / Math.max(0.01, (u.heightCm / 100) ** 2);

  const waist = u.waistCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'waistCm');
  const hip = u.hipCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'hipCm');

  return {
    bustCm: Math.round(u.bustCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'chestCm')),
    waistCm: Math.round(waist),
    hipCm: Math.round(hip),
    highHipCm: Math.round(u.highHipCm ?? (waist * 0.4 + hip * 0.6)),
    inseamCm: Math.round(u.inseamCm ?? lookupMeasurement(g, u.heightCm, u.weightKg, u.age, 'inseamCm')),
    bmi: Math.round(bmi * 10) / 10,
  };
}
