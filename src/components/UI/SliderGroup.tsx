import { useState } from 'react';

interface SliderGroupProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function SliderGroup({ title, children, defaultOpen = true }: SliderGroupProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between py-2 px-3 bg-gray-800/30 hover:bg-gray-800/50 rounded-lg transition-colors mb-2"
      >
        <span className="text-sm font-medium text-white">{title}</span>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-2 space-y-1">
          {children}
        </div>
      )}
    </div>
  );
}
