'use client';

import { Building2, Check, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export function FirmNameCard() {
  const queryClient = useQueryClient();

  const { data } = useQuery<{ firmName: string }>({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const [name, setName] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (data?.firmName !== undefined) {
      setName(data.firmName);
    }
  }, [data?.firmName]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firmName: name }),
      });
      if (!res.ok) throw new Error('Failed to save');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setHasChanges(false);
      toast.success('Firm name saved');
    },
    onError: () => {
      toast.error('Failed to save');
    },
  });

  const handleChange = (value: string) => {
    setName(value);
    setHasChanges(value !== (data?.firmName || ''));
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center">
          <Building2 className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-zinc-300">Firm Name</h3>
          <p className="text-xs text-zinc-500">Used as {'{firm}'} in flow scripts — e.g. &quot;Thank you for calling {'{firm}'}&quot;</p>
        </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); if (hasChanges) saveMutation.mutate(); }} className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="e.g. Anderson Bowman PLLC"
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
        />
        {hasChanges && (
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="px-3 py-2 bg-white rounded-lg text-sm text-black font-medium hover:bg-zinc-200 disabled:opacity-50 transition-colors"
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
          </button>
        )}
      </form>
    </div>
  );
}
