import { useMemo, useState } from 'react';
import { useBodyStore, type Gender, type BodyType, type GarmentType, type FitPreference } from '../../stores/bodyStore';
import { estimatedMeasurements } from '../../utils/morphMapper';
import { getGarmentOptions } from '../../utils/heatmapEngine';

const bodyTypes: { value: BodyType; label: string }[] = [
  { value: 'slim', label: 'Slim' },
  { value: 'average', label: 'Average' },
  { value: 'athletic', label: 'Athletic' },
  { value: 'curvy', label: 'Curvy' },
  { value: 'heavy', label: 'Heavy' },
];

export function ControlPanel() {
  const { inputs, setInput, reset } = useBodyStore();
  const { heatmapEnabled, setHeatmapEnabled, garmentType, setGarmentType, garmentSize, setGarmentSize, fitPreference, setFitPreference } = useBodyStore();
  const estimated = useMemo(() => estimatedMeasurements(inputs), [inputs]);
  const garmentOptions = useMemo(() => getGarmentOptions(), []);

  return (
    <div className="w-80 h-full bg-gray-900/95 border-l border-gray-700 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <h1 className="text-xl font-bold text-white mb-1">Body Profile</h1>
        <p className="text-xs text-gray-400">Enter your details to shape the avatar</p>
      </div>

      {/* Heatmap Controls */}
      <div className="p-4 border-b border-gray-700 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-300">Fit Heatmap</h2>
          <button
            onClick={() => setHeatmapEnabled(!heatmapEnabled)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              heatmapEnabled
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {heatmapEnabled ? 'ON' : 'OFF'}
          </button>
        </div>

        {heatmapEnabled && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-300">
                Garment
                <select
                  value={garmentType}
                  onChange={(e) => {
                    const newType = e.target.value as GarmentType;
                    setGarmentType(newType);
                    // Auto-select first size of new garment
                    const newGarment = garmentOptions.find((g) => g.id === newType);
                    if (newGarment && newGarment.sizes.length > 0) {
                      const midIdx = Math.floor(newGarment.sizes.length / 2);
                      setGarmentSize(newGarment.sizes[midIdx]);
                    }
                  }}
                  className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-gray-100"
                >
                  {garmentOptions.map((g) => (
                    <option key={g.id} value={g.id}>{g.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-gray-300">
                Size
                <select
                  value={garmentSize}
                  onChange={(e) => setGarmentSize(e.target.value)}
                  className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-gray-100"
                >
                  {(garmentOptions.find((g) => g.id === garmentType)?.sizes ?? []).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="text-xs text-gray-300">
              Fit Style
              <select
                value={fitPreference}
                onChange={(e) => setFitPreference(e.target.value as FitPreference)}
                className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-2 py-1.5 text-xs text-gray-100"
              >
                <option value="compression">Compression fit</option>
                <option value="slim">Slim fit</option>
                <option value="regular">Regular fit</option>
                <option value="relaxed">Relaxed fit</option>
                <option value="oversized">Oversized fit</option>
              </select>
            </label>
            <div className="flex gap-2 text-[9px]">
              <span className="px-1.5 py-0.5 rounded bg-red-500/30 text-red-200">Tight</span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/30 text-emerald-200">Balanced</span>
              <span className="px-1.5 py-0.5 rounded bg-blue-500/30 text-blue-200">Loose</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Basic Info */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-300">Basic Info</h2>

          {/* Gender */}
          <div className="flex gap-2">
            {(['male', 'female'] as Gender[]).map((g) => (
              <button
                key={g}
                onClick={() => setInput('gender', g)}
                className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors capitalize ${
                  inputs.gender === g
                    ? 'bg-cyan-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {g}
              </button>
            ))}
          </div>

          {/* Height */}
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-xs text-gray-300">Height</label>
              <span className="text-xs text-gray-400 tabular-nums">{inputs.heightCm} cm</span>
            </div>
            <input
              type="range" min={140} max={210} step={1}
              value={inputs.heightCm}
              onChange={(e) => setInput('heightCm', Number(e.target.value))}
              className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
          </div>

          {/* Weight */}
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-xs text-gray-300">Weight</label>
              <span className="text-xs text-gray-400 tabular-nums">{inputs.weightKg} kg</span>
            </div>
            <input
              type="range" min={40} max={160} step={1}
              value={inputs.weightKg}
              onChange={(e) => setInput('weightKg', Number(e.target.value))}
              className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
          </div>

          {/* Age */}
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-xs text-gray-300">Age</label>
              <span className="text-xs text-gray-400 tabular-nums">{inputs.age}</span>
            </div>
            <input
              type="range" min={14} max={80} step={1}
              value={inputs.age}
              onChange={(e) => setInput('age', Number(e.target.value))}
              className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
          </div>
        </section>

        {/* Body Type */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-300">Body Type</h2>
          <div className="flex flex-wrap gap-2">
            {bodyTypes.map((bt) => (
              <button
                key={bt.value}
                onClick={() => setInput('bodyType', bt.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  inputs.bodyType === bt.value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/40'
                }`}
              >
                {bt.label}
              </button>
            ))}
          </div>
        </section>

        {/* Custom Measurements (optional) */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-300">Custom Measurements</h2>
          <p className="text-[11px] text-gray-500">Optional — leave blank to auto-estimate from your basic info</p>

          <MeasurementInput
            label="Bust / Chest"
            value={inputs.bustCm}
            estimated={estimated.bustCm}
            onChange={(v) => setInput('bustCm', v)}
            min={65} max={145}
          />
          <MeasurementInput
            label="Waist"
            value={inputs.waistCm}
            estimated={estimated.waistCm}
            onChange={(v) => setInput('waistCm', v)}
            min={50} max={140}
          />
          <MeasurementInput
            label="Hip"
            value={inputs.hipCm}
            estimated={estimated.hipCm}
            onChange={(v) => setInput('hipCm', v)}
            min={70} max={145}
          />
          <MeasurementInput
            label="High Hip"
            value={inputs.highHipCm}
            estimated={estimated.highHipCm}
            onChange={(v) => setInput('highHipCm', v)}
            min={65} max={140}
          />
          <MeasurementInput
            label="Inseam"
            value={inputs.inseamCm}
            estimated={estimated.inseamCm}
            onChange={(v) => setInput('inseamCm', v)}
            min={55} max={105}
          />
        </section>

        {/* Estimated summary */}
        <section className="rounded-lg bg-gray-800/60 border border-gray-700 p-3 space-y-1">
          <h2 className="text-xs font-medium text-gray-300 mb-2">Estimated Profile</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <span className="text-gray-400">BMI</span>
            <span className="text-gray-200 text-right tabular-nums">{estimated.bmi}</span>
            <span className="text-gray-400">Bust/Chest</span>
            <span className="text-gray-200 text-right tabular-nums">{estimated.bustCm} cm</span>
            <span className="text-gray-400">Waist</span>
            <span className="text-gray-200 text-right tabular-nums">{estimated.waistCm} cm</span>
            <span className="text-gray-400">Hip</span>
            <span className="text-gray-200 text-right tabular-nums">{estimated.hipCm} cm</span>
            <span className="text-gray-400">Inseam</span>
            <span className="text-gray-200 text-right tabular-nums">{estimated.inseamCm} cm</span>
          </div>
        </section>

        {/* Direct Morph Controls */}
        <MorphSliders />
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700">
        <button
          onClick={reset}
          className="w-full py-2 px-4 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Reset to Default
        </button>
      </div>
    </div>
  );
}

const MORPH_NAMES = [
  'Heavier', 'Thinner', 'Muscular',
  'WiderShoulders', 'WiderHips', 'BiggerChest', 'BiggerStomach',
  'LongerLegs', 'LongerArms', 'ThickerNeck',
  'ThickerUpperArms', 'ThickerThighs', 'ThickerCalves',
  'LongerTorso', 'WiderBack', 'DeeperChest', 'NarrowerWaist',
  'BellyPouch', 'LoveHandles', 'BackFat',
  'UpperArmSag', 'DoubleChin', 'InnerThighFat',
];

function MorphSliders() {
  const { morphOverrides, setMorphOverride, clearMorphOverrides } = useBodyStore();
  const [open, setOpen] = useState(false);

  return (
    <section className="space-y-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full text-sm font-medium text-gray-300"
      >
        <span>Direct Morph Controls</span>
        <span className="text-xs text-gray-500">{open ? '▼' : '▶'}</span>
      </button>

      {open && (
        <div className="space-y-2">
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => {
                MORPH_NAMES.forEach((n) => setMorphOverride(n, 0));
              }}
              className="text-xs px-2 py-1 rounded bg-cyan-600/20 text-cyan-300 hover:bg-cyan-600/40 transition-colors"
            >
              Enable manual
            </button>
            <button
              onClick={clearMorphOverrides}
              className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
            >
              Use auto
            </button>
          </div>

          <p className="text-[10px] text-gray-500">
            {morphOverrides ? 'Manual mode — sliders control morphs directly' : 'Auto mode — morphs driven by body inputs'}
          </p>

          {MORPH_NAMES.map((name) => (
            <div key={name}>
              <div className="flex justify-between mb-0.5">
                <label className="text-[11px] text-gray-400">{name}</label>
                <span className="text-[11px] text-gray-500 tabular-nums">
                  {((morphOverrides?.[name] ?? 0) * 100).toFixed(0)}%
                </span>
              </div>
              <input
                type="range" min={0} max={100} step={1}
                value={Math.round((morphOverrides?.[name] ?? 0) * 100)}
                onChange={(e) => setMorphOverride(name, Number(e.target.value) / 100)}
                disabled={!morphOverrides}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-500 disabled:opacity-30"
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Input for an optional measurement — shows estimated value as placeholder */
function MeasurementInput({
  label, value, estimated, onChange, min, max,
}: {
  label: string;
  value: number | null;
  estimated: number;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
}) {
  const [useInches, setUseInches] = useState(false);

  const cmToIn = (cm: number) => Math.round(cm / 2.54 * 10) / 10;
  const inToCm = (inches: number) => Math.round(inches * 2.54 * 10) / 10;

  const displayValue = value !== null && useInches ? cmToIn(value) : value;
  const displayEstimated = useInches ? cmToIn(estimated) : estimated;
  const displayMin = useInches ? cmToIn(min) : min;
  const displayMax = useInches ? cmToIn(max) : max;

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-300 w-20 shrink-0">{label}</label>
      <div className="flex-1 flex items-center gap-1">
        <input
          type="number"
          step={useInches ? 0.1 : 1}
          value={displayValue ?? ''}
          placeholder={`~${displayEstimated}`}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              onChange(null);
            } else {
              const n = Number(raw);
              if (Number.isFinite(n)) {
                onChange(useInches ? inToCm(n) : n);
              }
            }
          }}
          onBlur={(e) => {
            const raw = e.target.value;
            if (raw === '') return;
            const n = Number(raw);
            if (Number.isFinite(n)) {
              const cm = useInches ? inToCm(n) : n;
              onChange(Math.min(max, Math.max(min, cm)));
            }
          }}
          className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 placeholder-gray-600"
        />
        <button
          onClick={() => setUseInches(!useInches)}
          className="text-[11px] text-gray-400 hover:text-cyan-300 w-6 text-center transition-colors"
          title="Toggle cm / in"
        >
          {useInches ? 'in' : 'cm'}
        </button>
        {value !== null && (
          <button
            onClick={() => onChange(null)}
            className="text-[10px] text-gray-500 hover:text-gray-300"
            title="Clear and use estimate"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
