'use client';

import { Phone, Copy, Check } from 'lucide-react';
import { useState } from 'react';

export function PhoneNumberCard() {
  const [copied, setCopied] = useState(false);
  const phoneNumber = process.env.NEXT_PUBLIC_VAPI_PHONE || '+1 (855) 765-4989';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(phoneNumber.replace(/\D/g, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
          <Phone className="w-5 h-5 text-blue-500" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-zinc-400">AI Paralegal Line</h3>
          <p className="text-xs text-zinc-600">VAPI-powered 24/7</p>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-2xl font-mono font-semibold text-white tracking-wide">
          {phoneNumber}
        </span>
        <button
          onClick={handleCopy}
          className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
          title="Copy number"
        >
          {copied ? (
            <Check className="w-4 h-4 text-green-500" />
          ) : (
            <Copy className="w-4 h-4 text-zinc-500" />
          )}
        </button>
      </div>
    </div>
  );
}
