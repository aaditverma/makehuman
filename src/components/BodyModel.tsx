import { useRef, useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useBodyStore } from '../stores/bodyStore';
import { inputsToMorphs } from '../utils/morphMapper';

const damp = (cur: number, tgt: number, spd: number, dt: number) =>
  cur + (tgt - cur) * (1 - Math.exp(-spd * dt));

useGLTF.preload('/models/human-male.glb');

const SMOOTH = 10;

export function BodyModel() {
  const groupRef = useRef<THREE.Group>(null!);
  const inputs = useBodyStore((s) => s.inputs);
  const morphOverrides = useBodyStore((s) => s.morphOverrides);
  const { scene } = useGLTF('/models/human-male.glb');

  const meshRef = useRef<THREE.Mesh | null>(null);
  const morphNamesRef = useRef<string[]>([]);
  const currentInfluences = useRef<number[]>([]);
  const targetInfluences = useRef<number[]>([]);
  const currentHeightScale = useRef(1);
  const targetHeightScale = useRef(1);
  const currentWidthScale = useRef(1);
  const targetWidthScale = useRef(1);

  const clonedScene = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    if (!groupRef.current) return;

    // Clean skin material — no texture, just well-tuned PBR
    const skinMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0.62, 0.44, 0.35),
      roughness: 0.7,
      metalness: 0.0,
      envMapIntensity: 0.3,
      flatShading: false,
      sheen: 0.15,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0.7, 0.5, 0.4),
      clearcoat: 0.02,
      clearcoatRoughness: 0.6,
    });

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
