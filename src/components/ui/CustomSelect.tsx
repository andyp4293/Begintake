'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export function CustomSelect({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none hover:border-zinc-500 transition-colors"
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown className="w-3 h-3 text-zinc-400 shrink-0 ml-2" />
      </button>
      {open && (
        <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                opt.value === value ? 'bg-zinc-700 text-white font-medium' : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
