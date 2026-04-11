export function Lighting() {
  return (
    <>
      {/* Soft ambient — warm tone */}
      <ambientLight intensity={0.35} color="#f5e6d3" />

      {/* Key light — warm, front-right, soft shadows */}
      <directionalLight
        position={[4, 6, 5]}
        intensity={0.9}
        color="#fff5ee"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={20}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
        shadow-bias={-0.001}
      />

      {/* Fill light — cooler, front-left, softer */}
      <directionalLight
        position={[-4, 4, 4]}
        intensity={0.5}
        color="#e8eef5"
      />

      {/* Rim light — defines silhouette from behind */}
      <directionalLight
        position={[0, 3, -6]}
        intensity={0.4}
        color="#d4e0f0"
      />

      {/* Subtle warm bounce from below */}
      <directionalLight
        position={[0, -3, 2]}
        intensity={0.15}
        color="#f0d8c0"
      />
    </>
  );
}
