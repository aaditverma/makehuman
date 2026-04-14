import { useRef, useEffect, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useBodyStore } from '../stores/bodyStore';
import type { GarmentType } from '../stores/bodyStore';
import { deformGarment } from '../utils/garmentDeformer';
import { deserializeBindingMap } from '../utils/bindingMapCodec';
import type { BindingMap } from '../utils/bindingMapCodec';
import { resolveGarmentPaths } from '../utils/garmentRegistry';
import { bodyEngineEvents, MESH_UPDATED_EVENT } from '../utils/bodyEngine';
import type { BodyEngine } from '../utils/bodyEngine';

const damp = (cur: number, tgt: number, spd: number, dt: number) =>
  cur + (tgt - cur) * (1 - Math.exp(-spd * dt));

const SMOOTH = 10;

/** Heatmap blend factor: 0.7 heatmap + 0.3 fabric when heatmap enabled */
const HEATMAP_BLEND = 0.7;

/**
 * Create an opaque fabric material based on garment type.
 * Cotton for tee/oxford, denim for jeans. Double-sided, depth write enabled.
 */
function createGarmentMaterial(type: GarmentType): THREE.MeshPhysicalMaterial {
  const isDenim = type === 'slim-jeans' || type === 'straight-jeans';

  if (isDenim) {
    // Denim appearance: roughness 0.9, no sheen
    return new THREE.MeshPhysicalMaterial({
      color: 0x3b5998,
      roughness: 0.9,
      metalness: 0.0,
      side: THREE.DoubleSide,
      depthWrite: true,
      // Optional denim weave normal map would go here:
      // normalMap: denimNormalMap,
    });
  }

  // Cotton appearance for tee/oxford: roughness 0.8, slight sheen
  const isTee = type === 'tee';
  return new THREE.MeshPhysicalMaterial({
    color: isTee ? 0xddddee : 0xe8e0d8,
    roughness: 0.8,
    metalness: 0.0,
    sheen: isTee ? 0.05 : 0.15,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(1.0, 1.0, 1.0),
    side: THREE.DoubleSide,
    depthWrite: true,
    // Optional fabric normal map would go here:
    // normalMap: fabricNormalMap,
  });
}

/**
 * Create a heatmap-blended version of the garment material.
 * Blends vertex colors (heatmap) with fabric base at HEATMAP_BLEND ratio.
 */
function createHeatmapMaterial(type: GarmentType): THREE.MeshPhysicalMaterial {
  const baseMat = createGarmentMaterial(type);
  baseMat.vertexColors = true;
  // The vertex colors will be pre-blended: 0.7 heatmap + 0.3 white
  // so the material just needs to multiply with the base color
  baseMat.color.lerp(new THREE.Color(1, 1, 1), HEATMAP_BLEND);
  return baseMat;
}

export function GarmentShell({ bodyEngine }: { bodyEngine?: BodyEngine | null }) {
  const groupRef = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const morphNamesRef = useRef<string[]>([]);
  const currentInfluences = useRef<number[]>([]);
  const [loaded, setLoaded] = useState(false);
  const fabricMatRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
  const heatmapMatRef = useRef<THREE.MeshPhysicalMaterial | null>(null);

  // Binding map deformation refs
  const bindingMapRef = useRef<BindingMap | null>(null);
  const garmentPositionsRef = useRef<Float32Array | null>(null);
  const needsDeformRef = useRef(false);

  const garmentType = useBodyStore((s) => s.garmentType);
  const garmentSize = useBodyStore((s) => s.garmentSize);
  const garmentShellEnabled = useBodyStore((s) => s.garmentShellEnabled);
  const heatmapEnabled = useBodyStore((s) => s.heatmapEnabled);
  const inputs = useBodyStore((s) => s.inputs);
  const currentMorphInfluences = useBodyStore((s) => s.currentMorphInfluences);

  /** Flag deformation needed when body engine mesh updates */
  const onMeshUpdated = useCallback(() => {
    needsDeformRef.current = true;
  }, []);

  // Load GLB + optional binding map
  useEffect(() => {
    if (!garmentShellEnabled || garmentType === 'none') {
      if (groupRef.current) {
        while (groupRef.current.children.length > 0) {
          groupRef.current.remove(groupRef.current.children[0]);
        }
      }
      meshRef.current = null;
      bindingMapRef.current = null;
      garmentPositionsRef.current = null;
      setLoaded(false);
      return;
    }

    // Resolve paths from registry, fall back to legacy path
    const paths = resolveGarmentPaths(garmentType, garmentSize);
    const glbUrl = paths?.glbPath ?? `/models/garments/garment-${garmentType}-${garmentSize}.glb`;
    const bindingUrl = paths?.bindingPath ?? null;

    console.log(`[GarmentShell] Loading: ${glbUrl}`);

    // Try loading binding map in parallel (non-blocking)
    let bindingMap: BindingMap | null = null;
    const bindingPromise = bindingUrl
      ? fetch(bindingUrl)
          .then((r) => {
            if (!r.ok) throw new Error(`${r.status}`);
            return r.arrayBuffer();
          })
          .then((buf) => {
            bindingMap = deserializeBindingMap(buf);
            console.log(`[GarmentShell] Binding map loaded: ${bindingMap.vertexCount} vertices`);
          })
          .catch((e) => {
            console.warn(`[GarmentShell] Binding map not available, using morph-sync fallback:`, e);
            bindingMap = null;
          })
      : Promise.resolve();

    const loader = new GLTFLoader();
    loader.load(
      glbUrl,
      (gltf) => {
        console.log('[GarmentShell] GLB loaded successfully');

        let foundMesh: THREE.Mesh | null = null;
        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh && !foundMesh) {
            foundMesh = child;
          }
        });

        if (!foundMesh) {
          console.warn('[GarmentShell] No mesh found in GLB');
          return;
        }

        const mesh = foundMesh as THREE.Mesh;
        console.log(`[GarmentShell] Mesh: ${mesh.geometry.attributes.position.count} verts`);

        // Log vertex position range for debugging
        const pos = mesh.geometry.attributes.position;
        let minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i);
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        console.log(`[GarmentShell] Y range: ${minY.toFixed(4)} to ${maxY.toFixed(4)}`);

        // Check morph targets (for fallback morph-sync approach)
        if (mesh.morphTargetDictionary) {
          const names = Object.keys(mesh.morphTargetDictionary);
          morphNamesRef.current = names;
          currentInfluences.current = new Array(names.length).fill(0);
          console.log(`[GarmentShell] Morph targets: ${names.join(', ')}`);
        } else {
          morphNamesRef.current = [];
          currentInfluences.current = [];
        }

        // Apply opaque fabric material based on garment type
        const mat = createGarmentMaterial(garmentType);
        fabricMatRef.current = mat;
        heatmapMatRef.current = createHeatmapMaterial(garmentType);
        mesh.material = heatmapEnabled ? heatmapMatRef.current : mat;
        mesh.renderOrder = 10;

        // Wait for binding map to finish loading, then finalize
        bindingPromise.then(() => {
          bindingMapRef.current = bindingMap;
          if (bindingMap) {
            // Allocate output buffer for deformed positions
            garmentPositionsRef.current = new Float32Array(bindingMap.vertexCount * 3);
            // Trigger initial deformation
            needsDeformRef.current = true;
            console.log('[GarmentShell] Using binding map deformation');
          } else {
            garmentPositionsRef.current = null;
            console.log('[GarmentShell] Using morph-sync fallback');
          }
        });

        // Clear previous and add new
        if (groupRef.current) {
          while (groupRef.current.children.length > 0) {
            groupRef.current.remove(groupRef.current.children[0]);
          }
          groupRef.current.add(gltf.scene);
        }

        meshRef.current = mesh;
        setLoaded(true);
      },
      (progress) => {
        if (progress.total > 0) {
          console.log(`[GarmentShell] Loading: ${Math.round(progress.loaded / progress.total * 100)}%`);
        }
      },
      (error) => {
        console.warn(`[GarmentShell] Failed to load ${glbUrl}:`, error);
        setLoaded(false);
      },
    );

    return () => {
      if (groupRef.current) {
        while (groupRef.current.children.length > 0) {
          const child = groupRef.current.children[0];
          groupRef.current.remove(child);
        }
      }
      meshRef.current = null;
      bindingMapRef.current = null;
      garmentPositionsRef.current = null;
      setLoaded(false);
    };
  }, [garmentShellEnabled, garmentType, garmentSize]);

  // Toggle material based on heatmap state
  useEffect(() => {
    if (!loaded || !meshRef.current) return;
    meshRef.current.material = heatmapEnabled
      ? (heatmapMatRef.current ?? fabricMatRef.current!)
      : fabricMatRef.current!;
  }, [heatmapEnabled, loaded]);

  // Subscribe to body engine mesh-updated events for binding map deformation
  useEffect(() => {
    const handler = onMeshUpdated;
    bodyEngineEvents.addEventListener(MESH_UPDATED_EVENT, handler);
    return () => bodyEngineEvents.removeEventListener(MESH_UPDATED_EVENT, handler);
  }, [onMeshUpdated]);

  // Animation: binding map deformation OR morph-sync fallback
  useFrame((_, delta) => {
    if (!loaded || !meshRef.current) return;
    const mesh = meshRef.current;
    const dt = Math.min(delta, 0.05);

    // ── Binding map deformation path ──
    if (bindingMapRef.current && bodyEngine && garmentPositionsRef.current) {
      if (needsDeformRef.current) {
        needsDeformRef.current = false;
        const smplVerts = bodyEngine.getVertexPositions();
        const smplNormals = bodyEngine.getNormals();
        const smplFaces = bodyEngine.getFaces() as Uint16Array;

        deformGarment(
          bindingMapRef.current,
          smplVerts,
          smplNormals,
          smplFaces,
          garmentPositionsRef.current,
        );

        // Update garment BufferGeometry positions in place
        const posAttr = mesh.geometry.attributes.position;
        const outPos = garmentPositionsRef.current;
        for (let i = 0; i < bindingMapRef.current.vertexCount && i < posAttr.count; i++) {
          posAttr.setXYZ(i, outPos[i * 3], outPos[i * 3 + 1], outPos[i * 3 + 2]);
        }
        posAttr.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        mesh.geometry.computeBoundingSphere();
      }
      // No scale/morph sync needed — binding map handles positioning
      return;
    }

    // ── Morph-sync fallback path (existing behavior) ──
    if (!mesh.morphTargetInfluences || !mesh.morphTargetDictionary) return;

    // Scale to match body
    const heightRatio = inputs.heightCm / 175;
    const widthCompensation = 1 + (1 - heightRatio) * 0.3;
    groupRef.current.scale.set(widthCompensation, heightRatio, widthCompensation);

    // Sync morph influences toward body's current morph influences
    for (let i = 0; i < morphNamesRef.current.length; i++) {
      const name = morphNamesRef.current[i];
      const tgt = currentMorphInfluences[name] ?? 0;
      const cur = currentInfluences.current[i] ?? 0;
      const next = damp(cur, tgt, SMOOTH, dt);
      currentInfluences.current[i] = next;
      mesh.morphTargetInfluences[i] = Math.min(next, 1.0);
    }
  });

  if (!garmentShellEnabled) return null;

  return <group ref={groupRef} position={[0, 0, 0.01]} />;
}
