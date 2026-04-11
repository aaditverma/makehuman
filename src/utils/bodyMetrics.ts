import type { BodyParameters } from '../stores/bodyStore';

export interface BodyMeasurements {
  heightCm: number;
  weightKg: number;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  inseamCm: number;
  shoulderCm: number;
  neckCm: number;
  bicepCm: number;
  calfCm: number;
}

export const defaultMeasurements: BodyMeasurements = {
  heightCm: 172,
  weightKg: 72,
  chestCm: 98,
  waistCm: 82,
  hipCm: 98,
  inseamCm: 79,
  shoulderCm: 45,
  neckCm: 37,
  bicepCm: 33,
  calfCm: 37,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (min: number, max: number, t: number) => min + (max - min) * t;
const norm = (value: number, min: number, max: number) => clamp01((value - min) / (max - min));

const blend = (...items: Array<[number, number]>) => {
  const weighted = items.reduce((acc, [value, weight]) => acc + value * weight, 0);
  const total = items.reduce((acc, [, weight]) => acc + weight, 0);
  return total === 0 ? 0.5 : clamp01(weighted / total);
};

export function estimateMeasurements(parameters: BodyParameters): BodyMeasurements {
  const heightCm = Math.round(lerp(150, 200, parameters.height));
  const baseWeight = lerp(50, 120, parameters.weight);
  const heightWeightOffset = lerp(-6, 6, parameters.height);
  const muscleOffset = lerp(-3, 8, parameters.muscleDefinition);

  const weightKg = Math.round(baseWeight + heightWeightOffset + muscleOffset);
  const chestCm = Math.round(lerp(80, 130, blend([parameters.chest, 0.55], [parameters.shoulders, 0.25], [parameters.muscleDefinition, 0.2])));
  const waistCm = Math.round(lerp(60, 125, blend([parameters.waist, 0.5], [parameters.stomach, 0.35], [parameters.weight, 0.15])));
  const hipCm = Math.round(lerp(80, 130, blend([parameters.hipWidth, 0.55], [parameters.thigh, 0.25], [parameters.stomach, 0.2])));
  const inseamCm = Math.round(heightCm * lerp(0.42, 0.5, parameters.legLength));
  const shoulderCm = Math.round(lerp(36, 58, blend([parameters.shoulders, 0.65], [parameters.chest, 0.2], [parameters.weight, 0.15])));
  const neckCm = Math.round(lerp(30, 48, blend([parameters.neck, 0.55], [parameters.weight, 0.25], [parameters.muscleDefinition, 0.2])));
  const bicepCm = Math.round(lerp(24, 48, blend([parameters.upperArm, 0.6], [parameters.muscleDefinition, 0.25], [parameters.weight, 0.15])));
  const calfCm = Math.round(lerp(28, 50, blend([parameters.calf, 0.6], [parameters.muscleDefinition, 0.2], [parameters.weight, 0.2])));

  return {
    heightCm,
    weightKg,
    chestCm,
    waistCm,
    hipCm,
    inseamCm,
    shoulderCm,
    neckCm,
    bicepCm,
    calfCm,
  };
}

export function fitParametersFromMeasurements(measurements: BodyMeasurements): Partial<BodyParameters> {
  const height = norm(measurements.heightCm, 150, 200);
  const weightBase = norm(measurements.weightKg, 50, 120);
  const chestRaw = norm(measurements.chestCm, 80, 130);
  const waistRaw = norm(measurements.waistCm, 60, 125);
  const hipRaw = norm(measurements.hipCm, 80, 130);
  const inseamRatio = clamp01(measurements.inseamCm / Math.max(1, measurements.heightCm));
  const shoulderRaw = norm(measurements.shoulderCm, 36, 58);
  const neckRaw = norm(measurements.neckCm, 30, 48);
  const bicepRaw = norm(measurements.bicepCm, 24, 48);
  const calfRaw = norm(measurements.calfCm, 28, 50);

  const heightMeters = measurements.heightCm / 100;
  const bmi = measurements.weightKg / Math.max(0.0001, heightMeters * heightMeters);
  const adiposity = norm(bmi, 18, 36);

  const muscleDefinition = blend(
    [chestRaw - waistRaw + 0.5, 0.45],
    [bicepRaw, 0.3],
    [1 - adiposity, 0.25],
  );

  const weight = blend([weightBase, 0.55], [adiposity, 0.3], [(waistRaw + hipRaw) * 0.5, 0.15]);
  const chest = blend([chestRaw, 0.65], [shoulderRaw, 0.2], [muscleDefinition, 0.15]);
  const waist = blend([waistRaw, 0.7], [adiposity, 0.2], [1 - muscleDefinition, 0.1]);
  const stomach = blend([waistRaw, 0.5], [adiposity, 0.4], [weight, 0.1]);
  const shoulders = blend([shoulderRaw, 0.7], [chestRaw, 0.2], [muscleDefinition, 0.1]);

  const legLength = norm(inseamRatio, 0.42, 0.5);
  const armLength = blend([shoulderRaw, 0.35], [height, 0.35], [legLength, 0.3]);
  const upperArm = blend([bicepRaw, 0.65], [muscleDefinition, 0.2], [weight, 0.15]);
  const forearm = blend([upperArm * 0.92, 0.65], [bicepRaw * 0.8, 0.2], [muscleDefinition, 0.15]);
  const wrist = blend([forearm * 0.7, 0.8], [weight, 0.2]);

  const thigh = blend([hipRaw, 0.5], [weight, 0.3], [muscleDefinition, 0.2]);
  const calf = blend([calfRaw, 0.65], [thigh * 0.7, 0.2], [muscleDefinition, 0.15]);
  const hipWidth = blend([hipRaw, 0.7], [waistRaw, 0.2], [thigh, 0.1]);

  return {
    height,
    weight,
    chest,
    waist,
    stomach,
    shoulders,
    armLength,
    upperArm,
    forearm,
    wrist,
    legLength,
    thigh,
    calf,
    hipWidth,
    neck: blend([neckRaw, 0.75], [muscleDefinition, 0.15], [weight, 0.1]),
    muscleDefinition,
  };
}
