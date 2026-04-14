/**
 * Body Engine Abstraction Layer
 *
 * Provides a unified interface over the body model system so that
 * heatmap, garment deformation, and UI code does not depend on
 * whether SMPL or MakeHuman is the active engine.
 *
 * - SmplEngine: hidden shape oracle using smplForwardPass + smplRegressor + measurementExtractor
 * - MakeHumanEngine: delegates to existing morph target system (inputsToMorphs)
 */

import * as THREE from 'three';
import type { UserInputs } from '../stores/bodyStore';
import type { SmplModelData } from './smplForwardPass';
import { computeSmplVertices, getSmplLandmark, SMPL_VERTEX_COUNT } from './smplForwardPass';
import type { SmplRegressorFn, RegressorInputs, PipelineInputs } from './smplRegressor';
import { initSmplRegressor, computeSmplBetas } from './smplRegressor';
import type { ExtractedMeasurements } from './measurementExtractor';
import { extractMeasurements } from './measurementExtractor';
import { computeSmplNormals } from './garmentDeformer';

// ── Event bus for mesh-updated notifications ────────────────────────

/** Global event target for body engine mesh-updated events */
export const bodyEngineEvents = new EventTarget();

/** Event name dispatched after each update() call */
export const MESH_UPDATED_EVENT = 'mesh-updated';

// ── BodyEngine interface ────────────────────────────────────────────

/** Abstraction over the body model system (Requirement 4.1) */
export interface BodyEngine {
  getVertexPositions(): Float32Array;
  getNormals(): Float32Array;
  getFaces(): Uint16Array | Uint32Array;
  getVertexCount(): number;
  getLandmark(name: string): THREE.Vector3;
  update(inputs: UserInputs): void;
}

// ── SMPL Engine ─────────────────────────────────────────────────────

/**
 * SMPL-based body engine.
 *
 * Uses the SMPL forward pass as a hidden shape oracle:
 * user inputs → regressor → betas → forward pass → vertices.
 * Also extracts refined measurements from the SMPL mesh.
 */
export class SmplEngine implements BodyEngine {
  private model: SmplModelData;
  private regressor: SmplRegressorFn;
  private vertices: Float32Array;
  private normals: Float32Array;
  private betas: Float64Array;
  private _lastMeasurements: ExtractedMeasurements | null = null;

  constructor(model: SmplModelData, regressor: SmplRegressorFn) {
    this.model = model;
    this.regressor = regressor;
    this.vertices = new Float32Array(SMPL_VERTEX_COUNT * 3);
    this.normals = new Float32Array(SMPL_VERTEX_COUNT * 3);
    this.betas = new Float64Array(10);

    // Initialize with template mesh
    this.vertices.set(model.templateVertices);
    computeSmplNormals(this.vertices, model.faceIndices, this.normals);
  }

  getVertexPositions(): Float32Array {
    return this.vertices;
  }

  getNormals(): Float32Array {
    return this.normals;
  }

  getFaces(): Uint16Array {
    return this.model.faceIndices;
  }

  getVertexCount(): number {
    return SMPL_VERTEX_COUNT;
  }

  getLandmark(name: string): THREE.Vector3 {
    const pos = getSmplLandmark(this.model, this.vertices, name);
    if (pos) return new THREE.Vector3(pos[0], pos[1], pos[2]);
    return new THREE.Vector3(0, 0, 0);
  }

  update(inputs: UserInputs): void {
    // Build pipeline inputs from UserInputs (includes bodyType for preset offsets)
    const pipelineInputs: PipelineInputs = {
      heightCm: inputs.heightCm,
      weightKg: inputs.weightKg,
      age: inputs.age,
      gender: inputs.gender,
      bodyComposition: inputs.bodyComposition ?? 'average',
      bodyType: inputs.bodyType,
      bustCm: inputs.bustCm ?? undefined,
      waistCm: inputs.waistCm ?? undefined,
      hipCm: inputs.hipCm ?? undefined,
      inseamCm: inputs.inseamCm ?? undefined,
    };

    // Layered pipeline: base → preset offsets → composition bias → refinement → clamp
    this.betas = computeSmplBetas(pipelineInputs, this.model);

    // Forward pass: betas → vertex positions
    computeSmplVertices(this.model, this.betas, this.vertices);

    // Recompute normals
    computeSmplNormals(this.vertices, this.model.faceIndices, this.normals);

    // Extract refined measurements (cached for consumers)
    this._lastMeasurements = extractMeasurements(this.model, this.vertices);

    // Emit mesh-updated event
    bodyEngineEvents.dispatchEvent(new Event(MESH_UPDATED_EVENT));
  }

  /** Access the last extracted measurements (available after update()) */
  get lastMeasurements(): ExtractedMeasurements | null {
    return this._lastMeasurements;
  }

  /** Access the current beta vector */
  get currentBetas(): Float64Array {
    return this.betas;
  }
}

// ── MakeHuman Engine ────────────────────────────────────────────────

/**
 * MakeHuman engine wrapper.
 *
 * Delegates to the existing morph target system. Vertex data comes from
 * the Three.js BufferGeometry of the loaded MakeHuman GLB mesh.
 * This engine does not own the mesh — it reads from a provided geometry ref.
 *
 * When no geometry is attached (e.g. before GLB loads), returns empty arrays.
 */
export class MakeHumanEngine implements BodyEngine {
  private geometry: THREE.BufferGeometry | null = null;

  /** Attach the MakeHuman mesh geometry (call after GLB loads) */
  setGeometry(geo: THREE.BufferGeometry): void {
    this.geometry = geo;
  }

  getVertexPositions(): Float32Array {
    if (!this.geometry) return new Float32Array(0);
    const attr = this.geometry.attributes.position;
    return attr.array as Float32Array;
  }

  getNormals(): Float32Array {
    if (!this.geometry) return new Float32Array(0);
    const attr = this.geometry.attributes.normal;
    return attr ? (attr.array as Float32Array) : new Float32Array(0);
  }

  getFaces(): Uint16Array | Uint32Array {
    if (!this.geometry?.index) return new Uint16Array(0);
    return this.geometry.index.array as Uint16Array | Uint32Array;
  }

  getVertexCount(): number {
    if (!this.geometry) return 0;
    return this.geometry.attributes.position.count;
  }

  getLandmark(name: string): THREE.Vector3 {
    // MakeHuman doesn't have a landmark map — return origin as fallback.
    // Heatmap uses normalized height heuristics in MakeHuman mode.
    void name;
    return new THREE.Vector3(0, 0, 0);
  }

  update(_inputs: UserInputs): void {
    // MakeHuman morph targets are driven by BodyModel.tsx via inputsToMorphs.
    // This wrapper just emits the event so subscribers (garment deformer, heatmap)
    // know the mesh changed.
    bodyEngineEvents.dispatchEvent(new Event(MESH_UPDATED_EVENT));
  }
}

// ── Engine factory ──────────────────────────────────────────────────

export interface BodyEngineConfig {
  engine: 'smpl-refined' | 'makehuman-only';
  smplModelUrl: string;
  smplRegressorUrl: string;
}

const DEFAULT_CONFIG: BodyEngineConfig = {
  engine: 'smpl-refined',
  smplModelUrl: '/models/smpl/smpl_model.bin',
  smplRegressorUrl: '/models/smpl/smpl_regressor.onnx',
};

/**
 * Create a body engine based on config and asset availability.
 *
 * - If engine is 'smpl-refined' and SMPL model + regressor load successfully → SmplEngine
 * - Otherwise → MakeHumanEngine (graceful fallback)
 */
export async function createBodyEngine(
  config?: Partial<BodyEngineConfig>,
  smplModel?: SmplModelData,
): Promise<BodyEngine> {
  const resolved = { ...DEFAULT_CONFIG, ...config };

  if (resolved.engine === 'smpl-refined' && smplModel) {
    try {
      const regressor = await initSmplRegressor({ mode: 'lookup' });
      return new SmplEngine(smplModel, regressor);
    } catch (e) {
      console.warn('[BodyEngine] SMPL engine init failed, falling back to MakeHuman:', e);
    }
  }

  // Fallback: MakeHuman engine
  console.info('[BodyEngine] Using MakeHuman engine');
  return new MakeHumanEngine();
}
