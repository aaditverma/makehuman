import { useRef, useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useBodyStore } from '../stores/bodyStore';
import { inputsToMorphs, estimatedMeasurements } from '../utils/morphMapper';
import { computeHeatmap, fitScoreToColor } from '../utils/heatmapEngine';

const damp = (cur: number, tgt: number, spd: number, dt: number) =>
  cur + (tgt - cur) * (1 - Math.exp(-spd * dt));

useGLTF.preload('/models/human-male.glb');

const SMOOTH = 10;

export function BodyModel() {
  const groupRef = useRef<THREE.Group>(null!);
  const inputs = useBodyStore((s) => s.inputs);
  const morphOverrides = useBodyStore((s) => s.morphOverrides);
  const heatmapEnabled = useBodyStore((s) => s.heatmapEnabled);
  const garmentType = useBodyStore((s) => s.garmentType);
  const garmentSize = useBodyStore((s) => s.garmentSize);
  const fitPreference = useBodyStore((s) => s.fitPreference);
  const { scene } = useGLTF('/models/human-male.glb');

  const meshRef = useRef<THREE.Mesh | null>(null);
  const morphNamesRef = useRef<string[]>([]);
  const currentInfluences = useRef<number[]>([]);
  const targetInfluences = useRef<number[]>([]);
  const currentHeightScale = useRef(1);
  const targetHeightScale = useRef(1);
  const currentWidthScale = useRef(1);
  const targetWidthScale = useRef(1);
  const skinMaterialRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
  const heatmapMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const bodyHeightRange = useRef<{ min: number; max: number }>({ min: 0, max: 1.73 });

  const clonedScene = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    if (!groupRef.current) return;

    // Skin material with baked texture
    const textureLoader = new THREE.TextureLoader();
    const skinTex = textureLoader.load('/models/textures/skin_diffuse.png');
    skinTex.colorSpace = THREE.SRGBColorSpace;
    skinTex.flipY = false; // GLB convention

    const skinMaterial = new THREE.MeshPhysicalMaterial({
      map: skinTex,
      roughness: 0.65,
      metalness: 0.0,
      envMapIntensity: 0.3,
      flatShading: false,
      sheen: 0.15,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0.7, 0.5, 0.4),
      vertexColors: false,
    });
    skinMaterialRef.current = skinMaterial;

    // Heatmap material — uses vertex colors
    const heatmapMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: false,
    });
    heatmapMaterialRef.current = heatmapMat;

    let foundMesh: THREE.Mesh | null = null;

    clonedScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.material = skinMaterial;
        if (child.morphTargetDictionary && child.morphTargetInfluences) {
          foundMesh = child;
          const names = Object.keys(child.morphTargetDictionary);
          morphNamesRef.current = names;
          currentInfluences.current = new Array(names.length).fill(0);
          targetInfluences.current = new Array(names.length).fill(0);
          console.log(`[BodyModel] Morph targets: ${names.length}`, names);
        }
      }
    });

    meshRef.current = foundMesh;

    // Compute body height range for heatmap mapping
    if (foundMesh) {
      const geo = (foundMesh as THREE.Mesh).geometry as THREE.BufferGeometry;
      const pos = geo.attributes.position;
      let minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      bodyHeightRange.current = { min: minY, max: maxY };
    }

    // Position feet on ground
    const box = new THREE.Box3().setFromObject(clonedScene);
    clonedScene.position.set(
      -(box.min.x + box.max.x) / 2,
      -box.min.y,
      -(box.min.z + box.max.z) / 2,
    );

    groupRef.current.clear();
    groupRef.current.add(clonedScene);

    return () => { groupRef.current?.remove(clonedScene); };
  }, [clonedScene]);

  // Convert inputs → morph influences (or use overrides)
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh?.morphTargetDictionary) return;

    const morphs = morphOverrides ?? inputsToMorphs(inputs);
    morphNamesRef.current.forEach((name, i) => {
      targetInfluences.current[i] = morphs[name] ?? 0;
    });

    // Height scaling: scale Y for height, and slightly scale X/Z inversely
    // so a shorter person looks proportionally stockier, not just a shrunken version
    const heightRatio = inputs.heightCm / 175;
    // Inverse width compensation: shorter = slightly wider
    const widthCompensation = 1 + (1 - heightRatio) * 0.3;
    targetHeightScale.current = heightRatio;
    targetWidthScale.current = widthCompensation;
  }, [inputs, morphOverrides]);

  // Apply/remove heatmap
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    if (!heatmapEnabled || garmentType === 'none') {
      // Restore skin material
      if (skinMaterialRef.current) mesh.material = skinMaterialRef.current;
      return;
    }

    // Compute body measurements
    const measurements = estimatedMeasurements(inputs);
    const heatmap = computeHeatmap(garmentType, garmentSize, fitPreference, measurements);
    if (!heatmap) {
      if (skinMaterialRef.current) mesh.material = skinMaterialRef.current;
      return;
    }

    // Create vertex colors
    const geometry = mesh.geometry;
    const pos = geometry.attributes.position;
    const count = pos.count;
    const { min: hMin, max: hMax } = bodyHeightRange.current;
    const hRange = hMax - hMin;

    const colors = new Float32Array(count * 3);
    // Base skin color for uncovered areas
    const skinR = 0.62, skinG = 0.44, skinB = 0.35;

    for (let i = 0; i < count; i++) {
      const y = pos.getY(i);
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const normalizedH = hRange > 0 ? (y - hMin) / hRange : 0.5;
      const distFromCenter = Math.sqrt(x * x + z * z);

      const { covered, fitScore } = heatmap.getVertexFit(normalizedH, Math.abs(x), z, distFromCenter);

      if (covered) {
        const [r, g, b] = fitScoreToColor(fitScore);
        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      } else {
        colors[i * 3] = skinR;
        colors[i * 3 + 1] = skinG;
        colors[i * 3 + 2] = skinB;
      }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    if (heatmapMaterialRef.current) mesh.material = heatmapMaterialRef.current;
  }, [heatmapEnabled, garmentType, garmentSize, fitPreference, inputs]);

  // Smooth animation
  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh?.morphTargetInfluences) return;
    const dt = Math.min(delta, 0.05);

    // Smooth height and width scale
    currentHeightScale.current = damp(currentHeightScale.current, targetHeightScale.current, SMOOTH, dt);
    currentWidthScale.current = damp(currentWidthScale.current, targetWidthScale.current, SMOOTH, dt);
    const h = currentHeightScale.current;
    const w = currentWidthScale.current;
    groupRef.current.scale.set(w, h, w);

    for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
      const cur = currentInfluences.current[i] ?? 0;
      const tgt = targetInfluences.current[i] ?? 0;
      const next = damp(cur, tgt, SMOOTH, dt);
      currentInfluences.current[i] = next;
      // Cap individual morphs AND limit total combined influence
      const cappedNext = Math.min(next, 1.0);
      mesh.morphTargetInfluences[i] = cappedNext;
    }
  });

  return <group ref={groupRef} position={[0, 0, 0]} />;
}
