import { Scene } from './components/Scene';
import { ControlPanel } from './components/UI/ControlPanel';

function App() {
  return (
    <div className="flex h-screen w-screen">
      {/* 3D Viewport */}
      <div className="flex-1 relative">
        <Scene />

        {/* Instructions overlay */}
        <div className="absolute bottom-4 left-4 text-xs text-gray-400 bg-gray-900/70 px-3 py-2 rounded-lg">
          <span className="text-gray-300">Controls:</span> Left-click drag to rotate, scroll to zoom, right-click drag to pan
        </div>
      </div>

      {/* Control Panel */}
      <ControlPanel />
    </div>
  );
}

export default App;
