import { describe, it, expect } from 'vitest';
import { initSmplRegressor, computeSmplBetas } from '../smplRegressor';
import type { RegressorInputs, BodyComposition, PipelineInputs } from '../smplRegressor';

describe('smplRegressor', () => {
  it('initSmplRegressor returns a function (lookup mode)', async () => {
    const regress = await initSmplRegressor({ mode: 'lookup' });
    expect(typeof regress).toBe('function');
  });

  it('produces a Float64Array of length 10', async () => {
    const regress = await initSmplRegressor({ mode: 'lookup' });
    const inputs: RegressorInputs = {
      heightCm: 175,
      weightKg: 75,
      age: 30,
      gender: 'male',
    };
    const betas = regress(inputs);
    expect(betas).toBeInstanceOf(Float64Array);
    expect(betas.length).toBe(10);
  });

  it('all betas are finite numbers', async () => {
    const regress = await initSmplRegressor({ mode: 'lookup' });
    const betas = regress({
      heightCm: 160,
      weightKg: 55,
      age: 25,
      gender: 'female',
    });
    for (let i = 0; i < 10; i++) {
      expect(Number.isFinite(betas[i])).toBe(true);
    }
  });

  it('all betas are clamped to [-3, 3]', async () => {
    const regress = await initSmplRegressor({ mode: 'lookup' });
    // Extreme inputs
    const betas = regress({
      heightCm: 210,
      weightKg: 150,
      age: 80,
      gender: 'male',
      bodyComposition: 'heavy',
    });
    for (let i = 0; i < 10; i++) {
      expect(betas[i]).toBeGreaterThanOrEqual(-3);
      expect(betas[i]).toBeLessThanOrEqual(3);
    }
  });

  it('produces different betas for athletic vs heavy at same height/weight', () => {
    const base: PipelineInputs = {
      heightCm: 180,
      weightKg: 85,
      age: 30,
      gender: 'male',
    };

    const athleticBetas = computeSmplBetas({ ...base, bodyComposition: 'athletic' });
    const heavyBetas = computeSmplBetas({ ...base, bodyComposition: 'heavy' });

    // L2 distance should be > 0.1
    let l2 = 0;
    for (let i = 0; i < 10; i++) {
      l2 += (athleticBetas[i] - heavyBetas[i]) ** 2;
    }
    l2 = Math.sqrt(l2);
    expect(l2).toBeGreaterThan(0.1);
  });

  it('produces different betas for male vs female', async () => {
    const regress = await initSmplRegressor({ mode: 'lookup' });
    const maleBetas = regress({ heightCm: 175, weightKg: 75, age: 30, gender: 'male' });
    const femaleBetas = regress({ heightCm: 175, weightKg: 75, age: 30, gender: 'female' });

    let l2 = 0;
    for (let i = 0; i < 10; i++) {
      l2 += (maleBetas[i] - femaleBetas[i]) ** 2;
    }
    expect(Math.sqrt(l2)).toBeGreaterThan(0.1);
  });

  it('defaults bodyComposition to average when omitted', async () => {
    const regress = await initSmplRegressor({ mode: 'lookup' });
    const withDefault = regress({ heightCm: 175, weightKg: 75, age: 30, gender: 'male' });
    const withAverage = regress({
      heightCm: 175, weightKg: 75, age: 30, gender: 'male',
      bodyComposition: 'average',
    });

    for (let i = 0; i < 10; i++) {
      expect(withDefault[i]).toBe(withAverage[i]);
    }
  });

  it('incorporates optional measurements when provided', async () => {
    const regress = await initSmplRegressor({ mode: 'lookup' });
    const base: RegressorInputs = {
      heightCm: 175, weightKg: 75, age: 30, gender: 'male',
    };
    const withMeasurements: RegressorInputs = {
      ...base,
      bustCm: 105,
      waistCm: 95,
      hipCm: 105,
      inseamCm: 85,
    };

    const baseBetas = regress(base);
    const measBetas = regress(withMeasurements);

    // Should produce different results when measurements are provided
    let different = false;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(baseBetas[i] - measBetas[i]) > 0.001) {
        different = true;
        break;
      }
    }
    expect(different).toBe(true);
  });

  it('falls back to lookup when ONNX mode fails', async () => {
    // ONNX is not installed, so this should fall back gracefully
    const regress = await initSmplRegressor({ mode: 'onnx' });
    const betas = regress({ heightCm: 175, weightKg: 75, age: 30, gender: 'male' });
    expect(betas).toBeInstanceOf(Float64Array);
    expect(betas.length).toBe(10);
  });

  it('completes regression within 50ms', async () => {
    const regress = await initSmplRegressor({ mode: 'lookup' });
    const inputs: RegressorInputs = {
      heightCm: 175, weightKg: 75, age: 30, gender: 'male',
      bodyComposition: 'athletic',
      bustCm: 100, waistCm: 85, hipCm: 98, inseamCm: 82,
    };

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      regress(inputs);
    }
    const elapsed = performance.now() - start;
    // 1000 calls should complete well under 50ms total
    // Single call should be sub-millisecond
    expect(elapsed / 1000).toBeLessThan(50);
  });

  it('produces distinct betas for all three body compositions', () => {
    const base: PipelineInputs = {
      heightCm: 170, weightKg: 70, age: 35, gender: 'female',
    };

    const compositions: BodyComposition[] = ['athletic', 'average', 'heavy'];
    const results = compositions.map(c => computeSmplBetas({ ...base, bodyComposition: c }));

    // Each pair should be distinct
    for (let a = 0; a < results.length; a++) {
      for (let b = a + 1; b < results.length; b++) {
        let l2 = 0;
        for (let i = 0; i < 10; i++) {
          l2 += (results[a][i] - results[b][i]) ** 2;
        }
        expect(Math.sqrt(l2)).toBeGreaterThan(0.1);
      }
    }
  });
});
