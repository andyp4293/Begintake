'use client';

import { Mail, Check, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export function BackupSummaryEmailCard() {
  const queryClient = useQueryClient();

  const { data } = useQuery<{ backupSummaryEmail: string }>({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const [email, setEmail] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (data?.backupSummaryEmail !== undefined) {
      setEmail(data.backupSummaryEmail);
    }
  }, [data?.backupSummaryEmail]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupSummaryEmail: email }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || 'Failed to save');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setHasChanges(false);
      toast.success('Backup summary recipient saved');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleChange = (value: string) => {
    setEmail(value);
    setHasChanges(value !== (data?.backupSummaryEmail || ''));
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center">
          <Mail className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-zinc-300">Backup Summary Recipient</h3>
          <p className="text-xs text-zinc-500">Always send a copy of every intake summary email to this address.</p>
        </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); if (hasChanges) saveMutation.mutate(); }} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          value={email}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="backup@example.com"
          className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
        />
        {hasChanges && (
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="px-3 py-2 bg-white rounded-lg text-sm text-black font-medium hover:bg-zinc-200 disabled:opacity-50 transition-colors self-end sm:self-auto"
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
