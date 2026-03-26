'use client';

import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Scale, Plus, Trash2, Zap, LayoutTemplate, Workflow, ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

interface Flow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  updatedAt: string;
}

export default function FlowListPage() {
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();

  const { data: flows, isLoading } = useQuery<Flow[]>({
    queryKey: ['flows'],
    queryFn: async () => {
      const res = await fetch('/api/flows');
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New Intake Flow',
          nodes: [{ type: 'start', label: 'Opening', config: { greeting: '' } }],
          edges: [],
        }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success('Flow created');
    },
  });

  const loadTemplateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/flows/templates', { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success('Anderson Bowman template loaded');
    },
    onError: () => toast.error('Failed to load template'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/flows/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success('Flow deleted');
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/flows/${id}/activate`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flows'] });
      toast.success('Flow activated');
    },
  });

  if (status === 'loading') return <div className="min-h-screen bg-black flex items-center justify-center"><div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>;
  if (!session) redirect('/login');

  return (
    <div className="min-h-screen bg-black">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors">
            <Scale className="w-5 h-5 text-white" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-white">Intake Flows</h1>
            <p className="text-xs text-zinc-500">Build and manage AI call scripts</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadTemplateMutation.mutate()}
            disabled={loadTemplateMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 hover:text-white transition-colors"
          >
            <LayoutTemplate className="w-3 h-3" />
            {loadTemplateMutation.isPending ? 'Loading...' : 'Add Template'}
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg text-xs text-black font-medium hover:bg-zinc-200 transition-colors"
          >
            <Plus className="w-3 h-3" />
            New Flow
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-zinc-900 rounded-xl animate-pulse" />)}
          </div>
        ) : !flows?.length ? (
          <div className="text-center py-16">
            <Workflow className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
            <h2 className="text-lg font-medium text-zinc-400 mb-2">No flows yet</h2>
            <p className="text-sm text-zinc-600 mb-6">Create a new flow or load the Anderson Bowman template to get started.</p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => loadTemplateMutation.mutate()}
                className="flex items-center gap-1.5 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-300 hover:text-white transition-colors"
              >
                <LayoutTemplate className="w-4 h-4" />
                Load Template
              </button>
              <button
                onClick={() => createMutation.mutate()}
                className="flex items-center gap-1.5 px-4 py-2 bg-white rounded-lg text-sm text-black font-medium hover:bg-zinc-200 transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Flow
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {flows.map((flow) => (
              <div
                key={flow.id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center justify-between group hover:border-zinc-700 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-white truncate">{flow.name}</h3>
                    {flow.isActive && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 font-medium">
                        Active
                      </span>
                    )}
                  </div>
                  {flow.description && (
                    <p className="text-xs text-zinc-500 mt-0.5 truncate">{flow.description}</p>
                  )}
                  <p className="text-[10px] text-zinc-600 mt-1">
                    Updated {new Date(flow.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </p>
                </div>

                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!flow.isActive && (
                    <button
                      onClick={() => activateMutation.mutate(flow.id)}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-400 hover:text-green-400 transition-colors"
                    >
                      <Zap className="w-3 h-3" /> Activate
                    </button>
                  )}
                  <Link
                    href={`/flow-builder/${flow.id}`}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors"
                  >
                    Edit <ArrowRight className="w-3 h-3" />
                  </Link>
                  <button
                    onClick={() => { if (confirm('Delete this flow?')) deleteMutation.mutate(flow.id); }}
                    className="p-1 text-zinc-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
