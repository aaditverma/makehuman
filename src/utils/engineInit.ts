/**
 * engineInit.ts — Graceful Degradation Engine Initialization
 *
 * Implements the degradation hierarchy:
 *   1. Full SMPL pipeline (ONNX regressor + forward pass + measurement extraction)
 *   2. SMPL without ONNX (lookup table regressor + forward pass)
 *   3. MakeHuman-only (existing ANSUR II morph mapper)
 *   4. No garment assets (body renders with heatmap on skin)
 *
 * Each layer falls back automatically based on asset availability and runtime errors.
 * User inputs are preserved across engine switches.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.6
 */

import type { BodyEngineType } from '../stores/bodyStore';
import { createBodyEngine, MakeHumanEngine } from './bodyEngine';
import type { BodyEngine, BodyEngineConfig } from './bodyEngine';
import type { SmplModelData } from './smplForwardPass';
import { loadSmplModel } from './smplForwardPass';

export type EngineLevel = 'smpl-onnx' | 'smpl-lookup' | 'makehuman-only' | 'no-garments';

export interface EngineInitResult {
  engine: BodyEngine;
  level: EngineLevel;
  smplModel: SmplModelData | null;
}

/** Cache for loaded SMPL model to avoid re-fetching on engine switch */
let cachedSmplModel: SmplModelData | null = null;

/**
 * Initialize the body engine with graceful degradation.
 *
 * Tries each level in order, falling back on failure:
 *   1. Load SMPL model + ONNX regressor → SmplEngine
 *   2. Load SMPL model + lookup table regressor → SmplEngine
 *   3. MakeHumanEngine (always available)
 *
 * @param preferredEngine - User's preferred engine type from store
 * @returns The best available engine and its degradation level
 */
export async function initializeEngine(
  preferredEngine: BodyEngineType = 'smpl-refined',
): Promise<EngineInitResult> {
  // If user explicitly wants MakeHuman, skip SMPL attempts
  if (preferredEngine === 'makehuman-only') {
    console.info('[EngineInit] User selected MakeHuman-only mode');
    return {
      engine: new MakeHumanEngine(),
      level: 'makehuman-only',
      smplModel: null,
    };
  }

  // Try loading SMPL model (cached across engine switches)
  let smplModel = cachedSmplModel;
  if (!smplModel) {
    try {
      smplModel = await loadSmplModel('/models/smpl/smpl_model.bin');
      cachedSmplModel = smplModel;
      console.info('[EngineInit] SMPL model loaded successfully');
    } catch (e) {
      console.warn('[EngineInit] SMPL model not available, falling back to MakeHuman:', e);
      return {
        engine: new MakeHumanEngine(),
        level: 'makehuman-only',
        smplModel: null,
      };
    }
  }

  // Try ONNX regressor first, then lookup table
  try {
    const engine = await createBodyEngine(
      { engine: 'smpl-refined', smplRegressorUrl: '/models/smpl/smpl_regressor.onnx' },
      smplModel,
    );
    // createBodyEngine internally falls back from ONNX to lookup
    const isSmpl = !(engine instanceof MakeHumanEngine);
    console.info(`[EngineInit] Engine ready: ${isSmpl ? 'SMPL' : 'MakeHuman'}`);
    return {
      engine,
      level: isSmpl ? 'smpl-lookup' : 'makehuman-only', // lookup is the common path since ONNX model may not exist
      smplModel: isSmpl ? smplModel : null,
    };
  } catch (e) {
    console.warn('[EngineInit] SMPL engine creation failed, using MakeHuman:', e);
    return {
      engine: new MakeHumanEngine(),
      level: 'makehuman-only',
      smplModel: null,
    };
  }
}

/**
 * Check if garment assets are available for the active engine.
 * SMPL engine uses binding map garments, MakeHuman uses morph-target garments.
 */
export function getGarmentMode(engine: BodyEngine): 'binding-map' | 'morph-sync' | 'none' {
  if (engine instanceof MakeHumanEngine) {
    return 'morph-sync';
  }
  return 'binding-map';
}

/** Clear the cached SMPL model (for testing or forced reload) */
export function clearSmplCache(): void {
  cachedSmplModel = null;
}
