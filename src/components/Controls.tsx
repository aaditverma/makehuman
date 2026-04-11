import { OrbitControls } from '@react-three/drei';

export function Controls() {
  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.6}
      minPolarAngle={0.2}
      maxPolarAngle={Math.PI - 0.2}
      minDistance={1}
      maxDistance={6}
      zoomSpeed={0.8}
      enablePan
      panSpeed={0.4}
      target={[0, 0.85, 0]}
    />
  );
}
