import { useRef, useEffect, useMemo, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useBodyStore } from '../stores/bodyStore';
import { inputsToMorphs, estimatedMeasurements } from '../utils/morphMapper';
import { computeHeatmap, computeHeatmapSmpl, fitScoreToColor } from '../utils/heatmapEngine';
import { buildAdjacency, smoothColors, type AdjacencyMap } from '../utils/smoothingEngine';
import { initializeEngine } from '../utils/engineInit';
import { SmplEngine, MakeHumanEngine } from '../utils/bodyEngine';
import type { BodyEngine } from '../utils/bodyEngine';
import type { ExtractedMeasurements } from '../utils/measurementExtractor';

const damp = (cur: number, tgt: number, spd: number, dt: number) =>
  cur + (tgt - cur) * (1 - Math.exp(-spd * dt));

useGLTF.preload('/models/human-male.glb');
useGLTF.preload('/models/human-smpl.glb');

const SMOOTH = 10;

export function BodyModel() {
  const groupRef = useRef<THREE.Group>(null!);
  const inputs = useBodyStore((s) => s.inputs);
  const morphOverrides = useBodyStore((s) => s.morphOverrides);
  const heatmapEnabled = useBodyStore((s) => s.heatmapEnabled);
  const garmentType = useBodyStore((s) => s.garmentType);
  const garmentSize = useBodyStore((s) => s.garmentSize);
  const fitPreference = useBodyStore((s) => s.fitPreference);
  const bodyEngineType = useBodyStore((s) => s.bodyEngine);
  
  // Load both models — use the one matching the active engine
  const mhGltf = useGLTF('/models/human-male.glb');
  const smplGltf = useGLTF('/models/human-smpl.glb');
  const scene = bodyEngineType === 'smpl-refined' ? smplGltf.scene : mhGltf.scene;

  const meshRef = useRef<THREE.Mesh | null>(null);
  const morphNamesRef = useRef<string[]>([]);
  const currentInfluences = useRef<number[]>([]);
  const targetInfluences = useRef<number[]>([]);
  const currentHeightScale = useRef(1);
  const targetHeightScale = useRef(1);
  const currentWidthScale = useRef(1);
  const targetWidthScale = useRef(1);
  const skinMaterialRef = useRef<THREE.Material | null>(null);
  const heatmapMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const bodyHeightRange = useRef<{ min: number; max: number }>({ min: 0, max: 1.73 });
  const adjacencyRef = useRef<AdjacencyMap | null>(null);

  // Ground tracking — base mesh min Y stored once on setup
  const baseMeshMinY = useRef(0);

  // SMPL refinement state
  const [bodyEngine, setBodyEngine] = useState<BodyEngine | null>(null);
  const smplMeasurementsRef = useRef<ExtractedMeasurements | null>(null);

  // Initialize body engine on mount or engine type change
  useEffect(() => {
    let cancelled = false;

    async function initEngine() {
      try {
        const result = await initializeEngine(bodyEngineType);
        if (!cancelled) {
          // If MakeHuman engine, attach geometry when mesh is available
          if (result.engine instanceof MakeHumanEngine && meshRef.current) {
            result.engine.setGeometry(meshRef.current.geometry);
          }
          setBodyEngine(result.engine);
          console.log(`[BodyModel] Engine initialized: ${result.level}`);
        }
      } catch (e) {
        console.warn('[BodyModel] Engine init failed, using MakeHuman fallback:', e);
        if (!cancelled) {
          const fallback = new MakeHumanEngine();
          if (meshRef.current) fallback.setGeometry(meshRef.current.geometry);
          setBodyEngine(fallback);
        }
      }
    }

    initEngine();
    return () => { cancelled = true; };
  }, [bodyEngineType]);

  // Run SMPL refinement when inputs change (if SMPL engine available)
  useEffect(() => {
    if (!bodyEngine) {
      smplMeasurementsRef.current = null;
      useBodyStore.getState().setSmplMeasurements(null);
      return;
    }

    // Update the body engine with current inputs (including bodyComposition)
    bodyEngine.update(inputs);

    // Extract refined measurements if SMPL engine
    if (bodyEngine instanceof SmplEngine) {
      smplMeasurementsRef.current = bodyEngine.lastMeasurements;
      useBodyStore.getState().setSmplMeasurements(bodyEngine.lastMeasurements);
    } else {
      smplMeasurementsRef.current = null;
      useBodyStore.getState().setSmplMeasurements(null);
    }
  }, [bodyEngine, inputs]);

  const clonedScene = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    if (!groupRef.current) return;

    let foundMesh: THREE.Mesh | null = null;

    clonedScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;

        // Use the GLB material (has skin texture) — enhance it
        const existingMat = child.material as THREE.MeshStandardMaterial;
        if (existingMat && existingMat.map) {
          const skinMat = new THREE.MeshPhysicalMaterial({
            map: existingMat.map,
            normalMap: existingMat.normalMap,
            roughness: 0.6,
            metalness: 0.0,
            envMapIntensity: 0.4,
            sheen: 0.12,
            sheenRoughness: 0.5,
            sheenColor: new THREE.Color(0.7, 0.5, 0.4),
          });
          child.material = skinMat;
          skinMaterialRef.current = skinMat;
        }

        if (child.morphTargetDictionary && child.morphTargetInfluences) {
          foundMesh = child;
          const names = Object.keys(child.morphTargetDictionary);
          morphNamesRef.current = names;
          currentInfluences.current = new Array(names.length).fill(0);
          targetInfluences.current = new Array(names.length).fill(0);
        }
      }
    });

    meshRef.current = foundMesh;

    // Clear adjacency cache — mesh topology changed (different engine = different vertex/face count)
    adjacencyRef.current = null;

    // Heatmap material
    heatmapMaterialRef.current = new THREE.MeshBasicMaterial({ vertexColors: true });

    // Body height range
    if (foundMesh) {
      const geo = (foundMesh as THREE.Mesh).geometry as THREE.BufferGeometry;
      const pos = geo.attributes.position;
      let minY = Infinity, maxY = -Infinity;
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      console.log('[BodyModel] Vertex ranges:', {
        x: `${minX.toFixed(3)} to ${maxX.toFixed(3)} (${(maxX-minX).toFixed(3)})`,
        y: `${minY.toFixed(3)} to ${maxY.toFixed(3)} (${(maxY-minY).toFixed(3)})`,
        z: `${minZ.toFixed(3)} to ${maxZ.toFixed(3)} (${(maxZ-minZ).toFixed(3)})`,
      });
      bodyHeightRange.current = { min: minY, max: maxY };
    }

    // Position feet on ground — center X/Z, plant feet at Y=0
    const box = new THREE.Box3().setFromObject(clonedScene);
    baseMeshMinY.current = box.min.y;
    clonedScene.position.set(
      -(box.min.x + box.max.x) / 2,
      -box.min.y,
      -(box.min.z + box.max.z) / 2,
    );

    groupRef.current.clear();
    groupRef.current.add(clonedScene);

    return () => { groupRef.current?.remove(clonedScene); };
  }, [clonedScene]);

  // Morph influences — SMPL betas or MakeHuman morphs depending on engine
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh?.morphTargetDictionary) return;

    if (bodyEngineType === 'smpl-refined' && bodyEngine instanceof SmplEngine) {
      // SMPL mode: drive Beta0-Beta9 morph targets directly from regressor
      const betas = bodyEngine.currentBetas;
      morphNamesRef.current.forEach((name, idx) => {
        const match = name.match(/^Beta(\d+)(Neg)?$/);
        if (!match) { targetInfluences.current[idx] = 0; return; }

        const betaIdx = parseInt(match[1], 10);
        const isNeg = match[2] === 'Neg';
        const betaVal = betaIdx < betas.length ? betas[betaIdx] : 0;

        if (isNeg) {
          targetInfluences.current[idx] = Math.max(0, Math.min(1, -betaVal / 3.0));
        } else {
          targetInfluences.current[idx] = Math.max(0, Math.min(1, betaVal / 3.0));
        }
      });

      // SMPL: use group-level height scaling (same as MakeHuman) for clean height changes.
      // Beta-based height (β0) changes proportions unnaturally.
      const heightRatio = inputs.heightCm / 175;
      const widthCompensation = 1 + (1 - heightRatio) * 0.15; // less aggressive than MakeHuman
      targetHeightScale.current = heightRatio;
      targetWidthScale.current = widthCompensation;
    } else {
      // MakeHuman mode: use existing morph mapper
      const smplMeas = smplMeasurementsRef.current;
      const morphs = morphOverrides ?? inputsToMorphs(inputs, smplMeas);
      morphNamesRef.current.forEach((name, i) => {
        targetInfluences.current[i] = morphs[name] ?? 0;
      });

      // MakeHuman: apply group-level height scaling + width compensation
      const heightRatio = inputs.heightCm / 175;
      const widthCompensation = 1 + (1 - heightRatio) * 0.3;
      targetHeightScale.current = heightRatio;
      targetWidthScale.current = widthCompensation;
    }
  }, [inputs, morphOverrides, bodyEngine, bodyEngineType]);

  // Heatmap — use SMPL landmark-based coverage when SMPL engine active
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // No heatmap: show skin
    if (!heatmapEnabled) {
      if (skinMaterialRef.current) mesh.material = skinMaterialRef.current;
      return;
    }

    // Use SMPL-refined measurements when available
    const smplMeas = smplMeasurementsRef.current;
    const measurements = estimatedMeasurements(inputs, smplMeas);

    // Use SMPL landmark-based heatmap when body engine is available and is SMPL
    let heatmap;
    if (bodyEngine && bodyEngine instanceof SmplEngine) {
      heatmap = computeHeatmapSmpl(garmentType, garmentSize, fitPreference, measurements, bodyEngine);
    } else {
      heatmap = computeHeatmap(garmentType, garmentSize, fitPreference, measurements);
    }

    if (!heatmap) {
      if (skinMaterialRef.current) mesh.material = skinMaterialRef.current;
      return;
    }

    const geometry = mesh.geometry;
    const pos = geometry.attributes.position;
    const nor = geometry.attributes.normal;
    const count = pos.count;
    const { min: hMin, max: hMax } = bodyHeightRange.current;
    const hRange = hMax - hMin;

    const colors = new Float32Array(count * 3);
    const coverageMask: boolean[] = new Array(count);

    for (let i = 0; i < count; i++) {
      const y = pos.getY(i);
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const normalizedH = hRange > 0 ? (y - hMin) / hRange : 0.5;
      const distFromCenter = Math.sqrt(x * x + z * z);
      const normalXAbs = nor ? Math.abs(nor.getX(i)) : 0;
      const normalYAbs = nor ? Math.abs(nor.getY(i)) : 0;

      const { covered, fitScore, edgeFade } = heatmap.getVertexFit(normalizedH, Math.abs(x), z, distFromCenter, normalXAbs, normalYAbs);

      if (covered && edgeFade > 0.01) {
        const [r, g, b] = fitScoreToColor(fitScore);
        // Blend heatmap color with white based on edge fade
        colors[i * 3] = r * edgeFade + 1.0 * (1 - edgeFade);
        colors[i * 3 + 1] = g * edgeFade + 1.0 * (1 - edgeFade);
        colors[i * 3 + 2] = b * edgeFade + 1.0 * (1 - edgeFade);
        coverageMask[i] = true;
      } else {
        colors[i * 3] = 1;
        colors[i * 3 + 1] = 1;
        colors[i * 3 + 2] = 1;
        coverageMask[i] = false;
      }
    }

    // Build adjacency map on first render, cache in ref
    if (geometry.index && !adjacencyRef.current) {
      adjacencyRef.current = buildAdjacency(
        geometry.index.array as Uint16Array | Uint32Array,
        count,
      );
    }

    // Apply smoothing if adjacency is available
    const smoothedColors = adjacencyRef.current
      ? smoothColors(colors, coverageMask, adjacencyRef.current, { iterations: 2, weight: 0.5 })
      : colors;

    geometry.setAttribute('color', new THREE.BufferAttribute(smoothedColors, 3));

    // Use skin material with vertex colors multiplied on top
    const skinMat = skinMaterialRef.current as THREE.MeshPhysicalMaterial;
    if (skinMat) {
      const heatmapSkinMat = skinMat.clone();
      heatmapSkinMat.vertexColors = true;
      mesh.material = heatmapSkinMat;
    }
  }, [heatmapEnabled, garmentType, garmentSize, fitPreference, inputs, bodyEngine]);

  // Animation
  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh?.morphTargetInfluences) return;
    const dt = Math.min(delta, 0.05);

    currentHeightScale.current = damp(currentHeightScale.current, targetHeightScale.current, SMOOTH, dt);
    currentWidthScale.current = damp(currentWidthScale.current, targetWidthScale.current, SMOOTH, dt);
    groupRef.current.scale.set(currentWidthScale.current, currentHeightScale.current, currentWidthScale.current);

    // Ground anchoring: the group scales from origin (0,0,0).
    // clonedScene.position.y offsets the mesh so feet sit at local Y=0.
    // When scaleY != 1, that offset gets scaled too, but so do the vertices,
    // so feet remain at world Y=0. No per-frame correction needed.

    for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
      const cur = currentInfluences.current[i] ?? 0;
      const tgt = targetInfluences.current[i] ?? 0;
      const next = damp(cur, tgt, SMOOTH, dt);
      currentInfluences.current[i] = next;
      mesh.morphTargetInfluences[i] = Math.min(next, 1.0);
    }

    // Expose current morph influences to store for GarmentShell sync
    const influences: Record<string, number> = {};
    for (let i = 0; i < morphNamesRef.current.length; i++) {
      influences[morphNamesRef.current[i]] = currentInfluences.current[i] ?? 0;
    }
    useBodyStore.getState().setCurrentMorphInfluences(influences);
  });

  return <group ref={groupRef} position={[0, 0, 0]} />;
}
