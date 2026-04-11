import { create } from 'zustand';

export type Gender = 'male' | 'female';
export type BodyType = 'slim' | 'average' | 'athletic' | 'curvy' | 'heavy';

export interface UserInputs {
  heightCm: number;
  weightKg: number;
  age: number;
  gender: Gender;
  bodyType: BodyType;

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
  bustCm: null,
  waistCm: null,
  hipCm: null,
  highHipCm: null,
  inseamCm: null,
};

export type FitPreference = 'compression' | 'slim' | 'regular' | 'relaxed' | 'oversized';
export type GarmentType = 'tee' | 'vneck-tee' | 'oxford' | 'slim-jeans' | 'straight-jeans' | 'none';

interface BodyStore {
  inputs: UserInputs;
  morphOverrides: Record<string, number> | null;
  heatmapEnabled: boolean;
  garmentType: GarmentType;
  garmentSize: string;
  fitPreference: FitPreference;
  setInput: <K extends keyof UserInputs>(key: K, value: UserInputs[K]) => void;
  setInputs: (partial: Partial<UserInputs>) => void;
  setMorphOverride: (name: string, value: number) => void;
  clearMorphOverrides: () => void;
  setHeatmapEnabled: (v: boolean) => void;
  setGarmentType: (v: GarmentType) => void;
  setGarmentSize: (v: string) => void;
  setFitPreference: (v: FitPreference) => void;
  reset: () => void;
}

export const useBodyStore = create<BodyStore>((set) => ({
  inputs: { ...defaultInputs },
  morphOverrides: null,
  heatmapEnabled: false,
  garmentType: 'tee',
  garmentSize: 'M',
  fitPreference: 'regular',

  setInput: (key, value) =>
    set((s) => ({ inputs: { ...s.inputs, [key]: value } })),

  setInputs: (partial) =>
    set((s) => ({ inputs: { ...s.inputs, ...partial } })),

  setMorphOverride: (name, value) =>
    set((s) => ({
      morphOverrides: { ...(s.morphOverrides ?? {}), [name]: value },
    })),

  clearMorphOverrides: () => set({ morphOverrides: null }),
  setHeatmapEnabled: (v) => set({ heatmapEnabled: v }),
  setGarmentType: (v) => set({ garmentType: v }),
  setGarmentSize: (v) => set({ garmentSize: v }),
  setFitPreference: (v) => set({ fitPreference: v }),

  reset: () => set({ inputs: { ...defaultInputs }, morphOverrides: null, heatmapEnabled: false }),
}));
