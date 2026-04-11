import type { BodyMeasurements } from '../../utils/bodyMetrics';
import type { FitRegion, FitTone } from '../../utils/fitAdvisor';

interface BodySilhouette2DProps {
  measurements: BodyMeasurements;
  regionTones?: Partial<Record<FitRegion, FitTone>>;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const mapRange = (
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
) => {
  const t = clamp((value - inMin) / (inMax - inMin), 0, 1);
  return outMin + (outMax - outMin) * t;
};

const toneColor: Record<FitTone, string> = {
  tight: '#ef4444',
  balanced: '#10b981',
  relaxed: '#38bdf8',
  loose: '#6366f1',
};

function toneFill(tone?: FitTone): string {
  if (!tone) return '#64748b';
  return toneColor[tone];
}

export function BodySilhouette2D({ measurements, regionTones = {} }: BodySilhouette2DProps) {
  const containerWidth = 320;
  const containerHeight = 420;
  const margin = 20;

  const centerX = margin + containerWidth * 0.25;
  const sideCenterX = margin + containerWidth * 0.75;

  const headRadius = 16;

  const shoulderHalf = mapRange(measurements.shoulderCm, 32, 65, 22, 38);
  const chestHalf = mapRange(measurements.chestCm, 70, 145, 20, 40);
  const waistHalf = mapRange(measurements.waistCm, 55, 140, 14, 34);
  const hipHalf = mapRange(measurements.hipCm, 75, 145, 18, 36);
  const thighHalf = mapRange(measurements.hipCm, 75, 145, 12, 26);
  const calfHalf = mapRange(measurements.calfCm, 28, 55, 8, 16);

  const shoulderY = headRadius * 2 + 12;
  const chestY = shoulderY + 36;
  const waistY = chestY + 42;
  const hipY = waistY + 38;
  const thighY = hipY + 48;
  const calfY = thighY + 42;
  const ankleY = calfY + 30;

  const torsoPath = [
    `M ${centerX - 6} ${shoulderY - headRadius}`,
    `Q ${centerX - shoulderHalf} ${shoulderY} ${centerX - chestHalf} ${chestY}`,
    `Q ${centerX - waistHalf} ${waistY} ${centerX - hipHalf} ${hipY}`,
    `Q ${centerX - 8} ${hipY + 12} ${centerX - 4} ${hipY + 20}`,
    `L ${centerX + 4} ${hipY + 20}`,
    `Q ${centerX + 8} ${hipY + 12} ${centerX + hipHalf} ${hipY}`,
    `Q ${centerX + waistHalf} ${waistY} ${centerX + chestHalf} ${chestY}`,
    `Q ${centerX + shoulderHalf} ${shoulderY} ${centerX + 6} ${shoulderY - headRadius}`,
    'Z',
  ].join(' ');

  const sidePath = [
    `M ${sideCenterX - 4} ${shoulderY - headRadius}`,
    `Q ${sideCenterX - 8} ${shoulderY - 4} ${sideCenterX - 12} ${shoulderY}`,
    `Q ${sideCenterX - 18} ${shoulderY + 6} ${sideCenterX - 20} ${chestY}`,
    `Q ${sideCenterX - 22} ${chestY + 12} ${sideCenterX - 20} ${waistY}`,
    `Q ${sideCenterX - 18} ${waistY + 10} ${sideCenterX - 14} ${hipY}`,
    `Q ${sideCenterX - 12} ${hipY + 8} ${sideCenterX - 8} ${hipY + 18}`,
    `L ${sideCenterX + 4} ${hipY + 18}`,
    `Q ${sideCenterX + 8} ${hipY + 12} ${sideCenterX + 12} ${thighY}`,
    `Q ${sideCenterX + 16} ${thighY + 10} ${sideCenterX + 18} ${calfY}`,
    `Q ${sideCenterX + 20} ${calfY + 8} ${sideCenterX + 22} ${ankleY}`,
    `L ${sideCenterX + 26} ${ankleY}`,
    `Q ${sideCenterX + 22} ${ankleY - 6} ${sideCenterX + 18} ${ankleY - 10}`,
    `L ${sideCenterX + 14} ${ankleY - 10}`,
    `Q ${sideCenterX + 10} ${ankleY - 14} ${sideCenterX + 8} ${calfY + 2}`,
    `Q ${sideCenterX + 6} ${calfY - 4} ${sideCenterX + 4} ${thighY}`,
    `Q ${sideCenterX + 2} ${thighY - 8} ${sideCenterX} ${hipY + 18}`,
    `Q ${sideCenterX - 4} ${hipY + 12} ${sideCenterX - 8} ${hipY}`,
    `Q ${sideCenterX - 10} ${hipY - 6} ${sideCenterX - 14} ${waistY}`,
    `Q ${sideCenterX - 16} ${waistY - 10} ${sideCenterX - 18} ${chestY}`,
    `Q ${sideCenterX - 20} ${chestY - 12} ${sideCenterX - 22} ${shoulderY}`,
    `Q ${sideCenterX - 24} ${shoulderY - 6} ${sideCenterX - 20} ${shoulderY - 4}`,
    `L ${sideCenterX - 16} ${shoulderY - 8}`,
    `Q ${sideCenterX - 12} ${shoulderY - 12} ${sideCenterX - 8} ${shoulderY - headRadius}`,
    'Z',
  ].join(' ');

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-2">
      <svg viewBox={`0 0 ${containerWidth + margin * 2} ${containerHeight + margin * 2}`} className="w-full h-[320px]">
        <defs>
          <linearGradient id="silhouetteFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#334155" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>
        </defs>

        <text x={margin + 12} y={margin - 6} fill="#9ca3af" fontSize="10">Front</text>
        <text x={margin + containerWidth * 0.5 + 12} y={margin - 6} fill="#9ca3af" fontSize="10">Side</text>

        <circle cx={centerX} cy={margin + headRadius} r={headRadius} fill="url(#silhouetteFill)" stroke="#475569" strokeWidth="1" />
        <circle cx={sideCenterX} cy={margin + headRadius} r={headRadius} fill="url(#silhouetteFill)" stroke="#475569" strokeWidth="1" />

        <g clipPath="url(#none)" opacity="0.26">
          <ellipse cx={centerX} cy={margin + chestY} rx={chestHalf * 0.9} ry="14" fill={toneFill(regionTones.chest)} />
          <ellipse cx={centerX} cy={margin + waistY} rx={waistHalf * 0.92} ry="12" fill={toneFill(regionTones.waist)} />
          <ellipse cx={centerX} cy={margin + hipY} rx={hipHalf * 0.94} ry="14" fill={toneFill(regionTones.hip)} />
          <ellipse cx={centerX} cy={margin + thighY} rx={thighHalf * 0.88} ry="10" fill={toneFill(regionTones.thigh)} />
          <ellipse cx={centerX} cy={margin + calfY} rx={calfHalf * 0.8} ry="8" fill={toneFill(regionTones.thigh)} opacity="0.18" />
        </g>

        <path d={torsoPath} fill="url(#silhouetteFill)" stroke="#64748b" strokeWidth="1.2" />

        <g clipPath="url(#none)" opacity="0.22">
          <ellipse cx={sideCenterX} cy={margin + chestY} rx="18" ry="12" fill={toneFill(regionTones.chest)} />
          <ellipse cx={sideCenterX} cy={margin + waistY} rx="16" ry="10" fill={toneFill(regionTones.waist)} />
          <ellipse cx={sideCenterX} cy={margin + hipY} rx="16" ry="12" fill={toneFill(regionTones.hip)} />
          <ellipse cx={sideCenterX} cy={margin + thighY} rx="14" ry="8" fill={toneFill(regionTones.thigh)} />
          <ellipse cx={sideCenterX} cy={margin + calfY} rx="10" ry="6" fill={toneFill(regionTones.thigh)} opacity="0.18" />
        </g>

        <path d={sidePath} fill="url(#silhouetteFill)" stroke="#64748b" strokeWidth="1.2" />

        <line x1={centerX + chestHalf + 6} y1={margin + chestY} x2={margin + containerWidth * 0.4} y2={margin + chestY} stroke="#64748b" strokeWidth="1" />
        <text x={margin + containerWidth * 0.4 + 6} y={margin + chestY + 4} fill="#cbd5e1" fontSize="9">Chest {measurements.chestCm}cm</text>

        <line x1={centerX + waistHalf + 6} y1={margin + waistY} x2={margin + containerWidth * 0.4} y2={margin + waistY} stroke="#64748b" strokeWidth="1" />
        <text x={margin + containerWidth * 0.4 + 6} y={margin + waistY + 4} fill="#cbd5e1" fontSize="9">Waist {measurements.waistCm}cm</text>

        <line x1={centerX + hipHalf + 6} y1={margin + hipY} x2={margin + containerWidth * 0.4} y2={margin + hipY} stroke="#64748b" strokeWidth="1" />
        <text x={margin + containerWidth * 0.4 + 6} y={margin + hipY + 4} fill="#cbd5e1" fontSize="9">Hip {measurements.hipCm}cm</text>
      </svg>

      <div className="mt-1 flex flex-wrap gap-1.5 text-[9px]">
        <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-200">Tight</span>
        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200">Balanced</span>
        <span className="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-200">Relaxed</span>
        <span className="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-200">Loose</span>
      </div>

      <div className="mt-1 grid grid-cols-2 gap-1 text-[9px] text-gray-400">
        <div>Height: {measurements.heightCm} cm</div>
        <div>Weight: {measurements.weightKg} kg</div>
      </div>
    </div>
  );
}