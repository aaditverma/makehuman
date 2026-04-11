interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  displayMin?: number;
  displayMax?: number;
  unit?: string;
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  displayMin,
  displayMax,
  unit = '',
}: SliderProps) {
  // Convert internal 0-1 value to display value
  const displayValue = displayMin !== undefined && displayMax !== undefined
    ? Math.round(displayMin + (displayMax - displayMin) * value)
    : Math.round(value * 100);

  const displayLabel = displayMin !== undefined && displayMax !== undefined
    ? `${displayValue}${unit}`
    : `${displayValue}%`;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    onChange(newValue);
  };

  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <label className="text-sm text-gray-300">{label}</label>
        <span className="text-xs text-gray-400 font-mono bg-gray-800/50 px-2 py-0.5 rounded">
          {displayLabel}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        className="w-full cursor-pointer"
      />
    </div>
  );
}
