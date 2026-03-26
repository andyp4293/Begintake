'use client';

import { Phone, Copy, Check, Loader2, PhoneOff } from 'lucide-react';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export function PhoneNumberCard() {
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ phoneNumber: string | null; provisioned: boolean }>({
    queryKey: ['phone-number'],
    queryFn: async () => {
      const res = await fetch('/api/phone/provision');
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const provisionMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/phone/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to provision');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['phone-number'] });
      toast.success('Phone number provisioned!');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleCopy = async () => {
    if (!data?.phoneNumber) return;
    await navigator.clipboard.writeText(data.phoneNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatNumber = (num: string) => {
    const digits = num.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return num;
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
          <Phone className="w-5 h-5 text-blue-500" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-zinc-400">AI Paralegal Line</h3>
          <p className="text-xs text-zinc-600">Available 24/7</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-2">
          <Loader2 className="w-4 h-4 text-zinc-600 animate-spin" />
          <span className="text-sm text-zinc-600">Loading...</span>
        </div>
      ) : data?.phoneNumber ? (
        <div className="flex items-center justify-between">
          <span className="text-2xl font-mono font-semibold text-white tracking-wide">
            {formatNumber(data.phoneNumber)}
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
      ) : (
        <div className="text-center py-4">
          <PhoneOff className="w-6 h-6 text-zinc-700 mx-auto mb-2" />
          <p className="text-sm text-zinc-500 mb-3">No phone number yet</p>
          <button
            onClick={() => provisionMutation.mutate()}
            disabled={provisionMutation.isPending}
            className="px-4 py-2 bg-blue-600 rounded-lg text-sm text-white font-medium hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {provisionMutation.isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Provisioning...
              </span>
            ) : (
              'Generate Phone Number'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
