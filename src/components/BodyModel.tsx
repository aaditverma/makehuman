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
  const skinMaterialRef = useRef<THREE.Material | null>(null);
  const heatmapMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const bodyHeightRange = useRef<{ min: number; max: number }>({ min: 0, max: 1.73 });

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

  // Morph influences
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh?.morphTargetDictionary) return;

    const morphs = morphOverrides ?? inputsToMorphs(inputs);
    morphNamesRef.current.forEach((name, i) => {
      targetInfluences.current[i] = morphs[name] ?? 0;
    });

    const heightRatio = inputs.heightCm / 175;
    const widthCompensation = 1 + (1 - heightRatio) * 0.3;
    targetHeightScale.current = heightRatio;
    targetWidthScale.current = widthCompensation;
  }, [inputs, morphOverrides]);

  // Heatmap
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    if (!heatmapEnabled || garmentType === 'none') {
      if (skinMaterialRef.current) mesh.material = skinMaterialRef.current;
      return;
    }

    const measurements = estimatedMeasurements(inputs);
    const heatmap = computeHeatmap(garmentType, garmentSize, fitPreference, measurements);
    if (!heatmap) {
      if (skinMaterialRef.current) mesh.material = skinMaterialRef.current;
      return;
    }

    const geometry = mesh.geometry;
    const pos = geometry.attributes.position;
    const count = pos.count;
    const { min: hMin, max: hMax } = bodyHeightRange.current;
    const hRange = hMax - hMin;

    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const y = pos.getY(i);
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const normalizedH = hRange > 0 ? (y - hMin) / hRange : 0.5;
      const distFromCenter = Math.sqrt(x * x + z * z);

      const { covered, fitScore, edgeFade } = heatmap.getVertexFit(normalizedH, Math.abs(x), z, distFromCenter);

      if (covered && edgeFade > 0.01) {
        const [r, g, b] = fitScoreToColor(fitScore);
        // Blend heatmap color with white based on edge fade
        colors[i * 3] = r * edgeFade + 1.0 * (1 - edgeFade);
        colors[i * 3 + 1] = g * edgeFade + 1.0 * (1 - edgeFade);
        colors[i * 3 + 2] = b * edgeFade + 1.0 * (1 - edgeFade);
      } else {
        colors[i * 3] = 1;
        colors[i * 3 + 1] = 1;
        colors[i * 3 + 2] = 1;
      }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Use skin material with vertex colors multiplied on top
    const skinMat = skinMaterialRef.current as THREE.MeshPhysicalMaterial;
    if (skinMat) {
      const heatmapSkinMat = skinMat.clone();
      heatmapSkinMat.vertexColors = true;
      mesh.material = heatmapSkinMat;
    }
  }, [heatmapEnabled, garmentType, garmentSize, fitPreference, inputs]);

  // Animation
  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh?.morphTargetInfluences) return;
    const dt = Math.min(delta, 0.05);

    currentHeightScale.current = damp(currentHeightScale.current, targetHeightScale.current, SMOOTH, dt);
    currentWidthScale.current = damp(currentWidthScale.current, targetWidthScale.current, SMOOTH, dt);
    groupRef.current.scale.set(currentWidthScale.current, currentHeightScale.current, currentWidthScale.current);

    for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
      const cur = currentInfluences.current[i] ?? 0;
      const tgt = targetInfluences.current[i] ?? 0;
      const next = damp(cur, tgt, SMOOTH, dt);
      currentInfluences.current[i] = next;
      mesh.morphTargetInfluences[i] = Math.min(next, 1.0);
    }
  });

  return <group ref={groupRef} position={[0, 0, 0]} />;
}
