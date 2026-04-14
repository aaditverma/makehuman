/**
 * ANSUR II Round-Trip Validation Test Suite — Task 8.1
 *
 * Validates the full calibrated pipeline:
 *   input measurements → computeSmplBetas() → computeSmplVertices() →
 *   extractMeasurements() → compare with ANSUR ground truth
 *
 * Loads the real SMPL model binary and real calibrated coefficients.
 * Samples 100 ANSUR II subjects across BMI 18–35, both genders.
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseSmplBinary, computeSmplVertices, SMPL_VERTEX_COUNT } from '../smplForwardPass';
import type { SmplModelData } from '../smplForwardPass';
import { extractMeasurements } from '../measurementExtractor';
import {
  computeSmplBetas,
  loadCalibratedCoefficients,
  applyCalibratedCoefficients,
  _resetCalibratedCoefficients,
} from '../smplRegressor';
import type { CalibratedCoefficients } from '../smplRegressor';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AnsurSubject {
  id: string;
  gender: 'male' | 'female';
  age: number;
  heightCm: number;
  weightKg: number;
  bmi: number;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  inseamCm: number;
}

interface MeasurementStats {
  meanError: number;
  medianError: number;
  p90Error: number;
  within3cm: number; // percentage
  within5cm: number; // percentage
}

/* ------------------------------------------------------------------ */
/*  CSV Parsing                                                        */
/* ------------------------------------------------------------------ */

function parseAnsurCsv(csvPath: string, gender: 'male' | 'female'): AnsurSubject[] {
  const raw = readFileSync(csvPath, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  // Normalize header to lowercase for consistent lookup
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());

  const col = (name: string): number => {
    const idx = header.indexOf(name);
    if (idx === -1) throw new Error(`Column "${name}" not found in ${csvPath}. Available: ${header.slice(0, 20).join(', ')}...`);
    return idx;
  };

  const idCol = col('subjectid');
  const ageCol = col('age');
  const statureCol = col('stature');
  const weightCol = col('weightkg');
  const chestCol = col('chestcircumference');
  const waistCol = col('waistcircumference');
  const hipCol = col('buttockcircumference');
  const crotchCol = col('crotchheight');

  const subjects: AnsurSubject[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split(',');
    if (fields.length < header.length) continue;

    const statureMm = parseFloat(fields[statureCol]);
    const weightHg = parseFloat(fields[weightCol]);
    const age = parseInt(fields[ageCol], 10);
    const chestMm = parseFloat(fields[chestCol]);
    const waistMm = parseFloat(fields[waistCol]);
    const hipMm = parseFloat(fields[hipCol]);
    const crotchMm = parseFloat(fields[crotchCol]);

    if ([statureMm, weightHg, age, chestMm, waistMm, hipMm, crotchMm].some(Number.isNaN)) {
      continue;
    }

    // ANSUR II: stature in mm, weightkg in tenths of kg (hectograms)
    const heightCm = statureMm / 10;
    const weightKg = weightHg / 10;
    const bmi = weightKg / ((heightCm / 100) ** 2);

    subjects.push({
      id: fields[idCol],
      gender,
      age,
      heightCm,
      weightKg,
      bmi,
      chestCm: chestMm / 10,
      waistCm: waistMm / 10,
      hipCm: hipMm / 10,
      inseamCm: crotchMm / 10,
    });
  }

  return subjects;
}

/* ------------------------------------------------------------------ */
/*  Sampling: 100 subjects across BMI 18–35, both genders              */
/* ------------------------------------------------------------------ */

function sampleSubjects(males: AnsurSubject[], females: AnsurSubject[], count: number): AnsurSubject[] {
  // Filter to BMI 18–35
  const validMales = males.filter((s) => s.bmi >= 18 && s.bmi <= 35);
  const validFemales = females.filter((s) => s.bmi >= 18 && s.bmi <= 35);

  // Sort by BMI to get even spread
  validMales.sort((a, b) => a.bmi - b.bmi);
  validFemales.sort((a, b) => a.bmi - b.bmi);

  const halfCount = Math.floor(count / 2);
  const maleCount = halfCount;
  const femaleCount = count - halfCount;

  // Evenly sample across BMI range using stride
  const sampleEvenly = (arr: AnsurSubject[], n: number): AnsurSubject[] => {
    if (arr.length <= n) return arr;
    const stride = arr.length / n;
    const result: AnsurSubject[] = [];
    for (let i = 0; i < n; i++) {
      result.push(arr[Math.floor(i * stride)]);
    }
    return result;
  };

  return [...sampleEvenly(validMales, maleCount), ...sampleEvenly(validFemales, femaleCount)];
}

/* ------------------------------------------------------------------ */
/*  Statistics helpers                                                  */
/* ------------------------------------------------------------------ */

function computeStats(errors: number[]): MeasurementStats {
  if (errors.length === 0) {
    return { meanError: 0, medianError: 0, p90Error: 0, within3cm: 0, within5cm: 0 };
  }

  const sorted = [...errors].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  const p90Idx = Math.min(Math.floor(sorted.length * 0.9), sorted.length - 1);
  const p90 = sorted[p90Idx];
  const within3 = (sorted.filter((e) => e <= 3).length / sorted.length) * 100;
  const within5 = (sorted.filter((e) => e <= 5).length / sorted.length) * 100;

  return { meanError: mean, medianError: median, p90Error: p90, within3cm: within3, within5cm: within5 };
}

/* ------------------------------------------------------------------ */
/*  Test Suite                                                         */
/* ------------------------------------------------------------------ */

describe('ANSUR II Round-Trip Validation', () => {
  let smplModel: SmplModelData;
  let subjects: AnsurSubject[];
  let outputVertices: Float32Array;

  // Per-subject round-trip errors
  const chestErrors: number[] = [];
  const waistErrors: number[] = [];
  const hipErrors: number[] = [];
  const inseamErrors: number[] = [];

  beforeAll(async () => {
    // 1. Load SMPL model binary
    const modelPath = resolve(__dirname, '../../../public/models/smpl/smpl_model.bin');
    const modelBuffer = readFileSync(modelPath);
    const arrayBuffer = modelBuffer.buffer.slice(
      modelBuffer.byteOffset,
      modelBuffer.byteOffset + modelBuffer.byteLength,
    );
    smplModel = parseSmplBinary(arrayBuffer);

    // 2. Load calibrated coefficients (mock fetch to return real JSON)
    const coeffPath = resolve(__dirname, '../../data/calibrated_coefficients.json');
    const coeffJson = JSON.parse(readFileSync(coeffPath, 'utf-8')) as CalibratedCoefficients;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(coeffJson),
    }));
    await loadCalibratedCoefficients();
    applyCalibratedCoefficients();

    // 3. Load ANSUR II data
    const maleCsvPath = resolve(__dirname, '../../data/ansur2_male.csv');
    const femaleCsvPath = resolve(__dirname, '../../data/ansur2_female.csv');
    const males = parseAnsurCsv(maleCsvPath, 'male');
    const females = parseAnsurCsv(femaleCsvPath, 'female');

    // 4. Sample 100 subjects across BMI 18–35
    subjects = sampleSubjects(males, females, 100);

    // 5. Pre-allocate output buffer
    outputVertices = new Float32Array(SMPL_VERTEX_COUNT * 3);

    // 6. Run round-trip for each subject
    for (const subject of subjects) {
      const betas = computeSmplBetas({
        heightCm: subject.heightCm,
        weightKg: subject.weightKg,
        age: subject.age,
        gender: subject.gender,
        bodyType: 'average',
        bodyComposition: 'average',
      });

      computeSmplVertices(smplModel, betas, outputVertices);
      const extracted = extractMeasurements(smplModel, outputVertices);

      chestErrors.push(Math.abs(extracted.chestCm - subject.chestCm));
      waistErrors.push(Math.abs(extracted.waistCm - subject.waistCm));
      hipErrors.push(Math.abs(extracted.hipCm - subject.hipCm));
      inseamErrors.push(Math.abs(extracted.inseamCm - subject.inseamCm));
    }

    // 7. Print summary report
    const chestStats = computeStats(chestErrors);
    const waistStats = computeStats(waistErrors);
    const hipStats = computeStats(hipErrors);
    const inseamStats = computeStats(inseamErrors);

    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║         ANSUR II Round-Trip Validation Summary Report       ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Subjects tested: ${subjects.length.toString().padStart(4)}                                       ║`);
    console.log(`║  Males: ${subjects.filter((s) => s.gender === 'male').length}, Females: ${subjects.filter((s) => s.gender === 'female').length}                                    ║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  Measurement  │  Mean  │ Median │  P90   │ ≤3cm  │ ≤5cm   ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');

    const fmtRow = (name: string, s: MeasurementStats) =>
      `║  ${name.padEnd(12)} │ ${s.meanError.toFixed(1).padStart(5)}  │ ${s.medianError.toFixed(1).padStart(5)}  │ ${s.p90Error.toFixed(1).padStart(5)}  │ ${s.within3cm.toFixed(0).padStart(4)}% │ ${s.within5cm.toFixed(0).padStart(4)}%  ║`;

    console.log(fmtRow('Chest', chestStats));
    console.log(fmtRow('Waist', waistStats));
    console.log(fmtRow('Hip', hipStats));
    console.log(fmtRow('Inseam', inseamStats));
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
  }, 120_000); // 2 minute timeout for loading + processing

  afterAll(() => {
    _resetCalibratedCoefficients();
    vi.restoreAllMocks();
  });

  /**
   * Validates: Requirement 5.1
   * At least 100 subjects sampled from ANSUR II.
   */
  it('samples at least 100 ANSUR II subjects', () => {
    expect(subjects.length).toBeGreaterThanOrEqual(100);
  });

  /**
   * Validates: Requirement 5.2
   * Chest/waist/hip round-trip error < 5cm for ≥ 80% of subjects.
   */
  it('chest round-trip error < 5cm for ≥ 80% of subjects', () => {
    const within5 = chestErrors.filter((e) => e < 5).length;
    const pct = (within5 / chestErrors.length) * 100;
    expect(pct).toBeGreaterThanOrEqual(80);
  });

  it('waist round-trip error < 5cm for ≥ 80% of subjects', () => {
    const within5 = waistErrors.filter((e) => e < 5).length;
    const pct = (within5 / waistErrors.length) * 100;
    expect(pct).toBeGreaterThanOrEqual(80);
  });

  it('hip round-trip error < 5cm for ≥ 80% of subjects', () => {
    const within5 = hipErrors.filter((e) => e < 5).length;
    const pct = (within5 / hipErrors.length) * 100;
    expect(pct).toBeGreaterThanOrEqual(80);
  });

  /**
   * Validates: Requirement 5.3
   * Inseam round-trip error < 5cm for ≥ 80% of subjects.
   */
  it('inseam round-trip error < 5cm for ≥ 80% of subjects', () => {
    const within5 = inseamErrors.filter((e) => e < 5).length;
    const pct = (within5 / inseamErrors.length) * 100;
    expect(pct).toBeGreaterThanOrEqual(80);
  });

  /**
   * Validates: Requirement 5.6
   * Flag measurements where > 20% of subjects exceed 5cm error.
   */
  it('flags measurements needing further calibration if > 20% exceed 5cm', () => {
    const measurements = [
      { name: 'chest', errors: chestErrors },
      { name: 'waist', errors: waistErrors },
      { name: 'hip', errors: hipErrors },
      { name: 'inseam', errors: inseamErrors },
    ];

    const flagged: string[] = [];
    for (const m of measurements) {
      const exceed5 = m.errors.filter((e) => e >= 5).length;
      const pct = (exceed5 / m.errors.length) * 100;
      if (pct > 20) {
        flagged.push(`${m.name} (${pct.toFixed(1)}% exceed 5cm)`);
      }
    }

    if (flagged.length > 0) {
      console.warn(`\n⚠️  Measurements needing further calibration: ${flagged.join(', ')}\n`);
    }

    // This test always passes — it's informational.
    // The actual threshold assertions are in the tests above.
    expect(true).toBe(true);
  });
}, 180_000); // 3 minute timeout for the entire describe block
