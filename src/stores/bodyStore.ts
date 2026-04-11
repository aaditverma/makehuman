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

interface BodyStore {
  inputs: UserInputs;
  morphOverrides: Record<string, number> | null; // null = use computed, object = direct control
  setInput: <K extends keyof UserInputs>(key: K, value: UserInputs[K]) => void;
  setInputs: (partial: Partial<UserInputs>) => void;
  setMorphOverride: (name: string, value: number) => void;
  clearMorphOverrides: () => void;
  reset: () => void;
}

export const useBodyStore = create<BodyStore>((set) => ({
  inputs: { ...defaultInputs },
  morphOverrides: null,

  setInput: (key, value) =>
    set((s) => ({ inputs: { ...s.inputs, [key]: value } })),

  setInputs: (partial) =>
    set((s) => ({ inputs: { ...s.inputs, ...partial } })),

  setMorphOverride: (name, value) =>
    set((s) => ({
      morphOverrides: { ...(s.morphOverrides ?? {}), [name]: value },
    })),

  clearMorphOverrides: () => set({ morphOverrides: null }),

  reset: () => set({ inputs: { ...defaultInputs }, morphOverrides: null }),
}));
