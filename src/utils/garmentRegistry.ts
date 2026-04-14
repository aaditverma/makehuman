/**
 * garmentRegistry.ts — Garment Template Registry
 *
 * Static registry of available garment templates with type, label, sizes,
 * GLB paths, and binding map paths. New garments are added by editing
 * the registry array — no application code changes needed.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */

import type { GarmentType } from '../stores/bodyStore';

/** Registry entry for a garment template */
export interface GarmentRegistryEntry {
  type: GarmentType;
  label: string;
  sizes: string[];
  getGlbPath: (size: string) => string;
  getBindingPath: (size: string) => string;
  /** Marked false at runtime if assets fail to load */
  available: boolean;
}

/**
 * Static garment registry — add new garments by appending to this array.
 * Each entry defines the garment type, display label, available sizes,
 * and path generators for GLB and binding map assets.
 */
export const garmentRegistry: GarmentRegistryEntry[] = [
  {
    type: 'tee',
    label: 'T-Shirt',
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    getGlbPath: (s) => `/models/garments/garment-tee-${s}.glb`,
    getBindingPath: (s) => `/models/garments/tee-${s}.binding.bin`,
    available: true,
  },
  {
    type: 'oxford',
    label: 'Oxford Shirt',
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
    getGlbPath: (s) => `/models/garments/garment-oxford-${s}.glb`,
    getBindingPath: (s) => `/models/garments/oxford-${s}.binding.bin`,
    available: true,
  },
  {
    type: 'slim-jeans',
    label: 'Slim Jeans',
    sizes: ['28', '30', '32', '34', '36', '38'],
    getGlbPath: (s) => `/models/garments/garment-slim-jeans-${s}.glb`,
    getBindingPath: (s) => `/models/garments/slim-jeans-${s}.binding.bin`,
    available: true,
  },
  {
    type: 'straight-jeans',
    label: 'Straight Jeans',
    sizes: ['28', '30', '32', '34', '36', '38'],
    getGlbPath: (s) => `/models/garments/garment-straight-jeans-${s}.glb`,
    getBindingPath: (s) => `/models/garments/straight-jeans-${s}.binding.bin`,
    available: true,
  },
];

/** Get a registry entry by garment type */
export function getRegistryEntry(type: GarmentType): GarmentRegistryEntry | undefined {
  return garmentRegistry.find((e) => e.type === type);
}

/** Get all available garment types and their sizes for UI display */
export function getAvailableGarments(): Array<{ type: GarmentType; label: string; sizes: string[] }> {
  return garmentRegistry
    .filter((e) => e.available)
    .map((e) => ({ type: e.type, label: e.label, sizes: e.sizes }));
}

/**
 * Resolve GLB and binding map paths for a garment type + size.
 * Returns null if the garment type is not found or not available.
 */
export function resolveGarmentPaths(
  type: GarmentType,
  size: string,
): { glbPath: string; bindingPath: string } | null {
  const entry = getRegistryEntry(type);
  if (!entry || !entry.available) return null;
  if (!entry.sizes.includes(size)) return null;
  return {
    glbPath: entry.getGlbPath(size),
    bindingPath: entry.getBindingPath(size),
  };
}

/**
 * Mark a garment type as unavailable after a load failure.
 * Logs a warning and prevents future load attempts.
 */
export function markGarmentUnavailable(type: GarmentType, reason: string): void {
  const entry = garmentRegistry.find((e) => e.type === type);
  if (entry) {
    entry.available = false;
    console.warn(`[GarmentRegistry] Marked '${type}' as unavailable: ${reason}`);
  }
}
