import { useRef, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useBodyStore } from '../stores/bodyStore';

const damp = (cur: number, tgt: number, spd: number, dt: number) =>
  cur + (tgt - cur) * (1 - Math.exp(-spd * dt));

const SMOOTH = 10;

export function GarmentShell() {
  const groupRef = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const morphNamesRef = useRef<string[]>([]);
  const currentInfluences = useRef<number[]>([]);
  const [loaded, setLoaded] = useState(false);

  const garmentType = useBodyStore((s) => s.garmentType);
  const garmentSize = useBodyStore((s) => s.garmentSize);
  const garmentShellEnabled = useBodyStore((s) => s.garmentShellEnabled);
  const inputs = useBodyStore((s) => s.inputs);
  const currentMorphInfluences = useBodyStore((s) => s.currentMorphInfluences);

  // Load GLB manually with explicit error handling
  useEffect(() => {
    if (!garmentShellEnabled || garmentType === 'none') {
      // Clear any existing garment mesh
      if (groupRef.current) {
        while (groupRef.current.children.length > 0) {
          groupRef.current.remove(groupRef.current.children[0]);
        }
      }
      meshRef.current = null;
      setLoaded(false);
      return;
    }

    const url = `/models/garments/garment-${garmentType}-${garmentSize}.glb`;
    console.log(`[GarmentShell] Loading: ${url}`);

    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        console.log('[GarmentShell] GLB loaded successfully');

        // Find the mesh in the loaded scene
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

        // Check morph targets
        if (mesh.morphTargetDictionary) {
          const names = Object.keys(mesh.morphTargetDictionary);
          morphNamesRef.current = names;
          currentInfluences.current = new Array(names.length).fill(0);
          console.log(`[GarmentShell] Morph targets: ${names.join(', ')}`);
        }

        // Apply semi-transparent material
        const mat = new THREE.MeshPhysicalMaterial({
          color: 0xaaaacc,
          opacity: 0.7,
          transparent: true,
          side: THREE.DoubleSide,
          roughness: 0.8,
          depthWrite: false,
        });
        mesh.material = mat;
        mesh.renderOrder = 10;

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
        console.warn(`[GarmentShell] Failed to load ${url}:`, error);
        setLoaded(false);
      },
    );

    return () => {
      // Cleanup on unmount or garment change
      if (groupRef.current) {
        while (groupRef.current.children.length > 0) {
          const child = groupRef.current.children[0];
          groupRef.current.remove(child);
        }
      }
      meshRef.current = null;
      setLoaded(false);
    };
  }, [garmentShellEnabled, garmentType, garmentSize]);

  // Animation: sync morph influences + scale
  useFrame((_, delta) => {
    if (!loaded || !meshRef.current) return;
    const mesh = meshRef.current;
    if (!mesh.morphTargetInfluences || !mesh.morphTargetDictionary) return;
    const dt = Math.min(delta, 0.05);

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
