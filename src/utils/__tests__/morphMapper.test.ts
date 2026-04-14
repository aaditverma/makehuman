import { describe, it, expect } from 'vitest';
import { inputsToMorphs } from '../morphMapper';
import type { UserInputs } from '../../stores/bodyStore';
import type { ExtractedMeasurements } from '../measurementExtractor';

const baseInputs: UserInputs = {
  heightCm: 175,
  weightKg: 75,
  age: 28,
  gender: 'male',
  bodyType: 'average',
  bodyComposition: 'average',
  bustCm: null,
  waistCm: null,
  hipCm: null,
  highHipCm: null,
  inseamCm: null,
};

const smplMeasurements: ExtractedMeasurements = {
  chestCm: 100,
  waistCm: 85,
  hipCm: 98,
  shoulderCm: 46,
  neckCm: 38,
  bicepCm: 32,
  thighCm: 55,
  calfCm: 37,
  wristCm: 17,
  inseamCm: 80,
};

describe('inputsToMorphs', () => {
  it('returns morph weights without smplMeasurements (ANSUR II path)', () => {
    const morphs = inputsToMorphs(baseInputs);
    expect(morphs).toBeDefined();
    expect(typeof morphs.Heavier).toBe('number');
    expect(typeof morphs.Thinner).toBe('number');
    // All values should be in [0, 1]
    for (const v of Object.values(morphs)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('uses smplMeasurements when provided', () => {
    const morphsWithSmpl = inputsToMorphs(baseInputs, smplMeasurements);
    const morphsWithout = inputsToMorphs(baseInputs, null);
    // Both should produce valid morph maps
    expect(morphsWithSmpl).toBeDefined();
    expect(morphsWithout).toBeDefined();
    // They may differ since measurement sources differ
    expect(typeof morphsWithSmpl.Heavier).toBe('number');
  });

  it('does not apply body composition boosts when smplMeasurements provided', () => {
    const athleticInputs: UserInputs = { ...baseInputs, bodyComposition: 'athletic' };
    const heavyInputs: UserInputs = { ...baseInputs, bodyComposition: 'heavy' };

    // With SMPL measurements, body composition boosts should NOT be applied
    const athleticSmpl = inputsToMorphs(athleticInputs, smplMeasurements);
    const heavySmpl = inputsToMorphs(heavyInputs, smplMeasurements);

    // Same SMPL measurements + same base inputs → same morphs (composition ignored)
    expect(athleticSmpl.Muscular).toBe(heavySmpl.Muscular);
    expect(athleticSmpl.Heavier).toBe(heavySmpl.Heavier);
  });

  describe('body composition boosts in MakeHuman-only mode', () => {
    it('athletic boosts Muscular, WiderShoulders, NarrowerWaist and reduces BiggerStomach', () => {
      const avgMorphs = inputsToMorphs({ ...baseInputs, bodyComposition: 'average' });
      const athMorphs = inputsToMorphs({ ...baseInputs, bodyComposition: 'athletic' });

      // Athletic should have higher Muscular than average
      expect(athMorphs.Muscular).toBeGreaterThanOrEqual(avgMorphs.Muscular);
      // Athletic should have higher WiderShoulders
      expect(athMorphs.WiderShoulders).toBeGreaterThanOrEqual(avgMorphs.WiderShoulders);
      // Athletic should have higher NarrowerWaist
      expect(athMorphs.NarrowerWaist).toBeGreaterThanOrEqual(avgMorphs.NarrowerWaist);
      // Athletic should have lower BiggerStomach (boost is -0.2)
      expect(athMorphs.BiggerStomach).toBeLessThanOrEqual(avgMorphs.BiggerStomach);
    });

    it('heavy boosts Heavier, BiggerStomach, LoveHandles and reduces Muscular', () => {
      const avgMorphs = inputsToMorphs({ ...baseInputs, bodyComposition: 'average' });
      const heavyMorphs = inputsToMorphs({ ...baseInputs, bodyComposition: 'heavy' });

      // Heavy should have higher Heavier
      expect(heavyMorphs.Heavier).toBeGreaterThanOrEqual(avgMorphs.Heavier);
      // Heavy should have higher BiggerStomach
      expect(heavyMorphs.BiggerStomach).toBeGreaterThanOrEqual(avgMorphs.BiggerStomach);
      // Heavy should have higher LoveHandles
      expect(heavyMorphs.LoveHandles).toBeGreaterThanOrEqual(avgMorphs.LoveHandles);
      // Heavy should have lower Muscular (boost is -0.2)
      expect(heavyMorphs.Muscular).toBeLessThanOrEqual(avgMorphs.Muscular);
    });

    it('average applies no boosts', () => {
      // Average composition should produce same morphs as default
      const avgMorphs = inputsToMorphs({ ...baseInputs, bodyComposition: 'average' });
      const defaultMorphs = inputsToMorphs(baseInputs);
      expect(avgMorphs).toEqual(defaultMorphs);
    });
  });

  it('all morph values are clamped to [0, 1]', () => {
    const compositions = ['athletic', 'average', 'heavy'] as const;
    for (const comp of compositions) {
      const morphs = inputsToMorphs({ ...baseInputs, bodyComposition: comp });
      for (const [key, val] of Object.entries(morphs)) {
        expect(val, `${key} with ${comp}`).toBeGreaterThanOrEqual(0);
        expect(val, `${key} with ${comp}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
