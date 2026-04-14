/**
 * Property-based tests for bodyStore — Task 9.3
 *
 * Property 10: User input preservation across engine switch
 *
 * Uses fast-check for property-based testing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { useBodyStore, defaultInputs } from '../../stores/bodyStore';
import type { UserInputs, BodyEngineType } from '../../stores/bodyStore';

/* ------------------------------------------------------------------ */
/*  Generators                                                         */
/* ------------------------------------------------------------------ */

const userInputsArb: fc.Arbitrary<UserInputs> = fc.record({
  heightCm: fc.double({ min: 140, max: 210, noNaN: true, noDefaultInfinity: true }),
  weightKg: fc.double({ min: 40, max: 150, noNaN: true, noDefaultInfinity: true }),
  age: fc.integer({ min: 18, max: 80 }),
  gender: fc.constantFrom('male' as const, 'female' as const),
  bodyType: fc.constantFrom('slim' as const, 'average' as const, 'athletic' as const, 'curvy' as const, 'heavy' as const),
  bodyComposition: fc.constantFrom('athletic' as const, 'average' as const, 'heavy' as const),
  bustCm: fc.option(fc.double({ min: 70, max: 140, noNaN: true, noDefaultInfinity: true }), { nil: null }),
  waistCm: fc.option(fc.double({ min: 55, max: 130, noNaN: true, noDefaultInfinity: true }), { nil: null }),
  hipCm: fc.option(fc.double({ min: 70, max: 140, noNaN: true, noDefaultInfinity: true }), { nil: null }),
  highHipCm: fc.option(fc.double({ min: 60, max: 130, noNaN: true, noDefaultInfinity: true }), { nil: null }),
  inseamCm: fc.option(fc.double({ min: 60, max: 100, noNaN: true, noDefaultInfinity: true }), { nil: null }),
});

/* ------------------------------------------------------------------ */
/*  Property 10: User input preservation across engine switch          */
/* ------------------------------------------------------------------ */

describe('Property 10: User input preservation across engine switch', () => {
  beforeEach(() => {
    useBodyStore.getState().reset();
  });

  /**
   * **Validates: Requirements 11.3, 12.7**
   *
   * For any set of user inputs, switching the body engine from one mode
   * to another SHALL preserve all input values in the store without modification.
   */
  it('preserves all user inputs when switching engine from smpl-refined to makehuman-only', () => {
    fc.assert(
      fc.property(userInputsArb, (inputs) => {
        const store = useBodyStore.getState();

        // Set inputs
        store.setInputs(inputs);

        // Verify inputs were set
        const before = { ...useBodyStore.getState().inputs };

        // Switch engine
        store.setBodyEngine('makehuman-only');

        // Verify inputs are preserved
        const after = useBodyStore.getState().inputs;

        expect(after.heightCm).toBe(before.heightCm);
        expect(after.weightKg).toBe(before.weightKg);
        expect(after.age).toBe(before.age);
        expect(after.gender).toBe(before.gender);
        expect(after.bodyType).toBe(before.bodyType);
        expect(after.bodyComposition).toBe(before.bodyComposition);
        expect(after.bustCm).toBe(before.bustCm);
        expect(after.waistCm).toBe(before.waistCm);
        expect(after.hipCm).toBe(before.hipCm);
        expect(after.highHipCm).toBe(before.highHipCm);
        expect(after.inseamCm).toBe(before.inseamCm);

        // Reset for next iteration
        useBodyStore.getState().reset();
      }),
      { numRuns: 100 },
    );
  });

  it('preserves all user inputs when switching engine from makehuman-only to smpl-refined', () => {
    fc.assert(
      fc.property(userInputsArb, (inputs) => {
        const store = useBodyStore.getState();

        // Start with makehuman-only
        store.setBodyEngine('makehuman-only');
        store.setInputs(inputs);

        const before = { ...useBodyStore.getState().inputs };

        // Switch to smpl-refined
        store.setBodyEngine('smpl-refined');

        const after = useBodyStore.getState().inputs;

        expect(after.heightCm).toBe(before.heightCm);
        expect(after.weightKg).toBe(before.weightKg);
        expect(after.age).toBe(before.age);
        expect(after.gender).toBe(before.gender);
        expect(after.bodyType).toBe(before.bodyType);
        expect(after.bodyComposition).toBe(before.bodyComposition);
        expect(after.bustCm).toBe(before.bustCm);
        expect(after.waistCm).toBe(before.waistCm);
        expect(after.hipCm).toBe(before.hipCm);
        expect(after.highHipCm).toBe(before.highHipCm);
        expect(after.inseamCm).toBe(before.inseamCm);

        // Reset for next iteration
        useBodyStore.getState().reset();
      }),
      { numRuns: 100 },
    );
  });
});
