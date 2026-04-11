import type { BodyMeasurements } from './bodyMetrics';

export type FitPreference = 'close' | 'regular' | 'relaxed';
export type FitTone = 'tight' | 'balanced' | 'relaxed' | 'loose';
export type FitRegion = 'chest' | 'waist' | 'hip' | 'thigh' | 'inseam';

export interface GarmentProfile {
  id: string;
  name: string;
  category: 'top' | 'bottom';
  sizes: Array<{
    size: string;
    chestCm?: number;
    waistCm?: number;
    hipCm?: number;
    thighCm?: number;
    inseamCm?: number;
  }>;
}

export interface RegionResult {
  region: FitRegion;
  easeCm: number;
  tone: FitTone;
  score: number;
}

export interface SizeRecommendation {
  size: string;
  score: number;
  confidence: number;
  overallTone: FitTone;
  narrative: string;
  regions: RegionResult[];
}

export interface BodyTypeExpression {
  label: string;
  detail: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const easeTargets: Record<FitPreference, Record<FitRegion, [number, number]>> = {
  close: {
    chest: [2, 6],
    waist: [0, 4],
    hip: [2, 6],
    thigh: [1, 4],
    inseam: [-1, 1],
  },
  regular: {
    chest: [6, 11],
    waist: [4, 9],
    hip: [6, 11],
    thigh: [4, 8],
    inseam: [-1.5, 1.5],
  },
  relaxed: {
    chest: [11, 17],
    waist: [9, 15],
    hip: [11, 18],
    thigh: [8, 14],
    inseam: [-2, 2],
  },
};

export const garmentProfiles: GarmentProfile[] = [
  {
    id: 'tee',
    name: 'Essential Tee',
    category: 'top',
    sizes: [
      { size: 'XS', chestCm: 90, waistCm: 86, hipCm: 90 },
      { size: 'S', chestCm: 96, waistCm: 92, hipCm: 96 },
      { size: 'M', chestCm: 102, waistCm: 98, hipCm: 102 },
      { size: 'L', chestCm: 108, waistCm: 104, hipCm: 108 },
      { size: 'XL', chestCm: 116, waistCm: 112, hipCm: 116 },
      { size: 'XXL', chestCm: 124, waistCm: 120, hipCm: 124 },
    ],
  },
  {
    id: 'oxford-shirt',
    name: 'Oxford Shirt',
    category: 'top',
    sizes: [
      { size: 'XS', chestCm: 94, waistCm: 88, hipCm: 94 },
      { size: 'S', chestCm: 100, waistCm: 94, hipCm: 100 },
      { size: 'M', chestCm: 106, waistCm: 100, hipCm: 106 },
      { size: 'L', chestCm: 112, waistCm: 106, hipCm: 112 },
      { size: 'XL', chestCm: 120, waistCm: 114, hipCm: 120 },
      { size: 'XXL', chestCm: 128, waistCm: 122, hipCm: 128 },
    ],
  },
  {
    id: 'denim',
    name: 'Straight Denim',
    category: 'bottom',
    sizes: [
      { size: '28', waistCm: 76, hipCm: 94, thighCm: 56, inseamCm: 76 },
      { size: '30', waistCm: 81, hipCm: 99, thighCm: 58, inseamCm: 78 },
      { size: '32', waistCm: 86, hipCm: 104, thighCm: 60, inseamCm: 80 },
      { size: '34', waistCm: 91, hipCm: 109, thighCm: 63, inseamCm: 82 },
      { size: '36', waistCm: 96, hipCm: 114, thighCm: 66, inseamCm: 84 },
      { size: '38', waistCm: 101, hipCm: 119, thighCm: 69, inseamCm: 86 },
    ],
  },
];

function classifyTone(region: FitRegion, easeCm: number, min: number, max: number): FitTone {
  if (region === 'inseam') {
    const absDiff = Math.abs(easeCm);
    if (absDiff <= 1) return 'balanced';
    if (absDiff <= 2) return 'relaxed';
    return 'loose';
  }

  if (easeCm < min - 2) return 'tight';
  if (easeCm <= max + 1.5) return 'balanced';
  if (easeCm <= max + 7) return 'relaxed';
  return 'loose';
}

function regionScore(region: FitRegion, easeCm: number, min: number, max: number): number {
  const center = (min + max) * 0.5;

  if (region === 'inseam') {
    return clamp(100 - Math.abs(easeCm) * 20, 0, 100);
  }

  if (easeCm < min) {
    return clamp(100 - (min - easeCm) * 10, 0, 100);
  }

  if (easeCm > max) {
    return clamp(100 - (easeCm - max) * 6, 0, 100);
  }

  return clamp(100 - Math.abs(easeCm - center) * 2, 0, 100);
}

function summarizeTone(regions: RegionResult[]): FitTone {
  const tightCount = regions.filter((r) => r.tone === 'tight').length;
  const looseCount = regions.filter((r) => r.tone === 'loose').length;
  const relaxedCount = regions.filter((r) => r.tone === 'relaxed').length;

  if (tightCount >= 2) return 'tight';
  if (looseCount >= 2) return 'loose';
  if (relaxedCount >= 2) return 'relaxed';
  return 'balanced';
}

function makeNarrative(size: string, tone: FitTone, garmentName: string): string {
  if (tone === 'tight') return `${garmentName} in ${size} reads close on key zones.`;
  if (tone === 'relaxed') return `${garmentName} in ${size} gives a roomy, easy drape.`;
  if (tone === 'loose') return `${garmentName} in ${size} is oversized for this body profile.`;
  return `${garmentName} in ${size} should feel balanced and true to size.`;
}

function getBodyValue(body: BodyMeasurements, region: FitRegion): number {
  if (region === 'chest') return body.chestCm;
  if (region === 'waist') return body.waistCm;
  if (region === 'hip') return body.hipCm;
  if (region === 'inseam') return body.inseamCm;

  const estimatedThigh = body.hipCm * 0.56;
  return estimatedThigh;
}

function getGarmentValue(size: GarmentProfile['sizes'][number], region: FitRegion): number | undefined {
  if (region === 'chest') return size.chestCm;
  if (region === 'waist') return size.waistCm;
  if (region === 'hip') return size.hipCm;
  if (region === 'thigh') return size.thighCm;
  return size.inseamCm;
}

export function recommendSizes(
  body: BodyMeasurements,
  garment: GarmentProfile,
  preference: FitPreference,
): SizeRecommendation[] {
  const trackedRegions: FitRegion[] = garment.category === 'top'
    ? ['chest', 'waist', 'hip']
    : ['waist', 'hip', 'thigh', 'inseam'];

  const recommendations = garment.sizes.map((size) => {
    const regions: RegionResult[] = trackedRegions.map((region) => {
      const bodyValue = getBodyValue(body, region);
      const garmentValue = getGarmentValue(size, region) ?? bodyValue;
      const easeCm = garmentValue - bodyValue;
      const [min, max] = easeTargets[preference][region];

      return {
        region,
        easeCm,
        tone: classifyTone(region, easeCm, min, max),
        score: regionScore(region, easeCm, min, max),
      };
    });

    const score = Math.round(regions.reduce((acc, region) => acc + region.score, 0) / regions.length);
    const overallTone = summarizeTone(regions);

    return {
      size: size.size,
      score,
      overallTone,
      confidence: 0,
      narrative: makeNarrative(size.size, overallTone, garment.name),
      regions,
    } satisfies SizeRecommendation;
  }).sort((a, b) => b.score - a.score);

  const topScore = recommendations[0]?.score ?? 0;
  const secondScore = recommendations[1]?.score ?? topScore;

  return recommendations.map((recommendation) => {
    const distanceFromTop = topScore - recommendation.score;
    const leadMargin = topScore - secondScore;
    const confidence = clamp(
      Math.round(recommendation.score * 0.7 + (leadMargin - distanceFromTop) * 1.8 + 18),
      5,
      97,
    );

    return {
      ...recommendation,
      confidence,
    };
  });
}

export function describeBodyType(body: BodyMeasurements): BodyTypeExpression {
  const chestToWaist = body.chestCm / Math.max(1, body.waistCm);
  const hipToWaist = body.hipCm / Math.max(1, body.waistCm);
  const chestToHip = body.chestCm / Math.max(1, body.hipCm);
  const heightM = body.heightCm / 100;
  const bmi = body.weightKg / Math.max(0.0001, heightM * heightM);

  if (chestToWaist >= 1.2 && chestToHip > 1.03) {
    return { label: 'Athletic V-shape', detail: 'Broader upper body with a tighter waist line.' };
  }

  if (hipToWaist >= 1.2 && chestToHip < 0.98) {
    return { label: 'Pear profile', detail: 'Lower body carries more volume than upper body.' };
  }

  if (Math.abs(chestToHip - 1) <= 0.05 && chestToWaist >= 1.16 && hipToWaist >= 1.16) {
    return { label: 'Hourglass profile', detail: 'Balanced upper/lower volume with defined waist.' };
  }

  if (bmi >= 30) {
    return { label: 'Rounded profile', detail: 'Softer silhouette with comfort-sensitive fit zones.' };
  }

  if (bmi < 20) {
    return { label: 'Lean profile', detail: 'Narrower frame that benefits from cleaner drape.' };
  }

  return { label: 'Balanced rectangle', detail: 'Even proportions through chest, waist, and hips.' };
}
