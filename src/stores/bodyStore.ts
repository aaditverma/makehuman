import { create } from 'zustand';
import type { BrandSizeChart } from '../utils/sizeChartEngine';
import type { ExtractedMeasurements } from '../utils/measurementExtractor';

export type Gender = 'male' | 'female';
export type BodyType = 'slim' | 'average' | 'athletic' | 'curvy' | 'heavy';
export type BodyComposition = 'athletic' | 'average' | 'heavy';
export type BodyEngineType = 'smpl-refined' | 'makehuman-only';

export interface UserInputs {
  heightCm: number;
  weightKg: number;
  age: number;
  gender: Gender;
  bodyType: BodyType;
  bodyComposition: BodyComposition;

  bustCm: number | null;
  waistCm: number | null;
  hipCm: number | null;
  highHipCm: number | null;
  inseamCm: number | null;
}

export const defaultInputs: UserInputs = {
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

export type FitPreference = 'compression' | 'slim' | 'regular' | 'relaxed' | 'oversized';
export type GarmentType = 'tee' | 'oxford' | 'slim-jeans' | 'straight-jeans' | 'none';

interface BodyStore {
  inputs: UserInputs;
  bodyEngine: BodyEngineType;
  morphOverrides: Record<string, number> | null;
  heatmapEnabled: boolean;
  garmentShellEnabled: boolean;
  garmentType: GarmentType;
  garmentSize: string;
  fitPreference: FitPreference;
  brandSizeChart: BrandSizeChart | null;
  currentMorphInfluences: Record<string, number>;
  smplMeasurements: ExtractedMeasurements | null;
  setInput: <K extends keyof UserInputs>(key: K, value: UserInputs[K]) => void;
  setInputs: (partial: Partial<UserInputs>) => void;
  setBodyComposition: (v: BodyComposition) => void;
  setBodyEngine: (v: BodyEngineType) => void;
  setMorphOverride: (name: string, value: number) => void;
  clearMorphOverrides: () => void;
  setHeatmapEnabled: (v: boolean) => void;
  setGarmentShellEnabled: (v: boolean) => void;
  setGarmentType: (v: GarmentType) => void;
  setGarmentSize: (v: string) => void;
  setFitPreference: (v: FitPreference) => void;
  setBrandSizeChart: (chart: BrandSizeChart | null) => void;
  setCurrentMorphInfluences: (influences: Record<string, number>) => void;
  setSmplMeasurements: (m: ExtractedMeasurements | null) => void;
  reset: () => void;
}

export const useBodyStore = create<BodyStore>((set) => ({
  inputs: { ...defaultInputs },
  bodyEngine: 'smpl-refined' as BodyEngineType,
  morphOverrides: null,
  heatmapEnabled: false,
  garmentShellEnabled: false,
  garmentType: 'tee',
  garmentSize: 'M',
  fitPreference: 'regular',
  brandSizeChart: null,
  currentMorphInfluences: {},
  smplMeasurements: null,

  setInput: (key, value) =>
    set((s) => ({ inputs: { ...s.inputs, [key]: value } })),

  setInputs: (partial) =>
    set((s) => ({ inputs: { ...s.inputs, ...partial } })),

  setBodyComposition: (v) =>
    set((s) => ({ inputs: { ...s.inputs, bodyComposition: v } })),

  setBodyEngine: (v) => set({ bodyEngine: v }),

  setMorphOverride: (name, value) =>
    set((s) => ({
      morphOverrides: { ...(s.morphOverrides ?? {}), [name]: value },
    })),

  clearMorphOverrides: () => set({ morphOverrides: null }),
  setHeatmapEnabled: (v) => set({ heatmapEnabled: v }),
  setGarmentShellEnabled: (v) => set({ garmentShellEnabled: v }),
  setGarmentType: (v) => set({ garmentType: v }),
  setGarmentSize: (v) => set({ garmentSize: v }),
  setFitPreference: (v) => set({ fitPreference: v }),
  setBrandSizeChart: (chart) => set({ brandSizeChart: chart }),
  setCurrentMorphInfluences: (influences) => set({ currentMorphInfluences: influences }),
  setSmplMeasurements: (m) => set({ smplMeasurements: m }),

  reset: () => set({ inputs: { ...defaultInputs }, bodyEngine: 'smpl-refined' as BodyEngineType, morphOverrides: null, heatmapEnabled: false, brandSizeChart: null, currentMorphInfluences: {}, smplMeasurements: null }),
}));
