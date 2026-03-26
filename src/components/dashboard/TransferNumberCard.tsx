'use client';

import { PhoneForwarded, Check, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export function TransferNumberCard() {
  const queryClient = useQueryClient();

  const { data } = useQuery<{ transferPhoneNumber: string }>({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const [phone, setPhone] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (data?.transferPhoneNumber !== undefined) {
      setPhone(data.transferPhoneNumber);
    }
  }, [data?.transferPhoneNumber]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transferPhoneNumber: phone }),
      });
      if (!res.ok) throw new Error('Failed to save');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setHasChanges(false);
      toast.success('Transfer number saved');
    },
    onError: () => {
      toast.error('Failed to save');
    },
  });

  const handleChange = (value: string) => {
    setPhone(value);
    setHasChanges(value !== (data?.transferPhoneNumber || ''));
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center">
          <PhoneForwarded className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-zinc-300">Transfer Number</h3>
          <p className="text-xs text-zinc-500">Where to forward calls to a real paralegal</p>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          type="tel"
          value={phone}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="(555) 123-4567"
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors font-mono"
        />
        {hasChanges && (
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="px-3 py-2 bg-white text-black rounded-lg text-sm text-white font-medium hover:bg-zinc-200 disabled:opacity-50 transition-colors"
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
