import { useMemo, useState } from 'react';
import { useBodyStore } from '../../stores/bodyStore';
import { estimateMeasurements } from '../../utils/bodyMetrics';
import {
  describeBodyType,
  garmentProfiles,
  recommendSizes,
  type FitPreference,
  type FitRegion,
  type FitTone,
} from '../../utils/fitAdvisor';
import { BodySilhouette2D } from './BodySilhouette2D';

const toneBadge: Record<FitTone, string> = {
  tight: 'bg-red-500/20 text-red-200 border-red-400/30',
  balanced: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/30',
  relaxed: 'bg-sky-500/20 text-sky-200 border-sky-400/30',
  loose: 'bg-indigo-500/20 text-indigo-200 border-indigo-400/30',
};

const regionLabels: Record<FitRegion, string> = {
  chest: 'Chest',
  waist: 'Waist',
  hip: 'Hip',
  thigh: 'Thigh',
  inseam: 'Inseam',
};

export function FitAdvisorPanel() {
  const parameters = useBodyStore((state) => state.parameters);
  const measurements = useMemo(() => estimateMeasurements(parameters), [parameters]);
  const bodyType = useMemo(() => describeBodyType(measurements), [measurements]);

  const [garmentId, setGarmentId] = useState(garmentProfiles[0].id);
  const [preference, setPreference] = useState<FitPreference>('regular');

  const garment = useMemo(
    () => garmentProfiles.find((item) => item.id === garmentId) ?? garmentProfiles[0],
    [garmentId],
  );

  const recommendations = useMemo(
    () => recommendSizes(measurements, garment, preference),
    [measurements, garment, preference],
  );

  const primary = recommendations[0];
  const regionTones = useMemo(() => {
    const map: Partial<Record<FitRegion, FitTone>> = {};
    primary?.regions.forEach((region) => {
      map[region.region] = region.tone;
    });
    return map;
  }, [primary]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-300">
          Garment
          <select
            value={garmentId}
            onChange={(event) => setGarmentId(event.target.value)}
            className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-100"
          >
            {garmentProfiles.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>

        <label className="text-xs text-gray-300">
          Fit Intent
          <select
            value={preference}
            onChange={(event) => setPreference(event.target.value as FitPreference)}
            className="mt-1 w-full rounded bg-gray-800 border border-gray-700 px-2 py-1 text-xs text-gray-100"
          >
            <option value="close">Close fit</option>
            <option value="regular">Regular fit</option>
            <option value="relaxed">Relaxed fit</option>
          </select>
        </label>
      </div>

      <div className="rounded-md border border-gray-800 bg-gray-950/70 px-2 py-2">
        <div className="text-xs text-gray-200 font-medium">Body expression: {bodyType.label}</div>
        <div className="text-[11px] text-gray-400 mt-0.5">{bodyType.detail}</div>
      </div>

      {primary && (
        <div className="rounded-md border border-cyan-500/25 bg-cyan-500/10 px-2 py-2">
          <div className="flex items-center justify-between">
            <div className="text-xs text-cyan-100">Recommended size: {primary.size}</div>
            <div className="text-[11px] text-cyan-200">Confidence {primary.confidence}%</div>
          </div>
          <div className="text-[11px] text-cyan-200/90 mt-1">{primary.narrative}</div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {recommendations.slice(0, 3).map((item) => (
          <div
            key={item.size}
            className={`px-2 py-1 rounded border text-[11px] ${item.size === primary?.size ? 'border-cyan-400/40 bg-cyan-500/20 text-cyan-100' : 'border-gray-700 text-gray-300 bg-gray-800/50'}`}
          >
            {item.size} ({item.confidence}%)
          </div>
        ))}
      </div>

      <BodySilhouette2D measurements={measurements} regionTones={regionTones} />

      {primary && (
        <div className="space-y-1.5">
          {primary.regions.map((region) => (
            <div key={region.region} className="flex items-center justify-between text-[11px]">
              <span className="text-gray-300">{regionLabels[region.region]}</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Ease {region.easeCm > 0 ? '+' : ''}{Math.round(region.easeCm)} cm</span>
                <span className={`px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wide ${toneBadge[region.tone]}`}>
                  {region.tone}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
