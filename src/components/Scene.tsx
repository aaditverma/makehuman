import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, Environment } from '@react-three/drei';
import { Lighting } from './Lighting';
import { Controls } from './Controls';
import { BodyModel } from './BodyModel';
import { GarmentShell } from './GarmentShell';

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial color="#666" />
    </mesh>
  );
}

export function Scene() {
  return (
    <Canvas
      shadows
      camera={{
        position: [0, 0.85, 3],
        fov: 45,
        near: 0.1,
        far: 100,
      }}
      style={{ background: 'linear-gradient(180deg, #3a3a5a 0%, #252535 50%, #1a1a28 100%)' }}
    >
      {/* Lighting setup */}
      <Lighting />

      {/* Soft environment lighting */}
      <Environment preset="studio" environmentIntensity={0.4} />

      {/* Camera controls */}
      <Controls />

      {/* Body model with loading fallback */}
      <Suspense fallback={<LoadingFallback />}>
        <BodyModel />
        <GarmentShell />
      </Suspense>

      {/* Ground grid for reference */}
      <Grid
        position={[0, 0, 0]}
        args={[10, 10]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#4a4a6a"
        sectionSize={2}
        sectionThickness={1}
        sectionColor="#6a6a8a"
        fadeDistance={15}
        fadeStrength={1}
        infiniteGrid
      />

      {/* Ground plane for shadows */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        receiveShadow
      >
        <planeGeometry args={[20, 20]} />
        <shadowMaterial transparent opacity={0.3} />
      </mesh>
    </Canvas>
  );
}
