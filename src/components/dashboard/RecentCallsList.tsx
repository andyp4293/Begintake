'use client';

import { PhoneIncoming, PhoneForwarded, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

interface CallSession {
  id: string;
  createdAt: string;
  callerPhone: string | null;
  clientType: string | null;
  status: string;
  summary: string | null;
  notes: string | null;
  transferred: boolean;
  lawyer: { name: string } | null;
  client: { name: string } | null;
}

export function RecentCallsList() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: calls, isLoading } = useQuery<CallSession[]>({
    queryKey: ['calls'],
    queryFn: async () => {
      const res = await fetch('/api/calls');
      if (!res.ok) throw new Error('Failed to fetch calls');
      return res.json();
    },
  });

  const statusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'completed': return 'bg-zinc-600';
      case 'transferred': return 'bg-white';
      default: return 'bg-zinc-700';
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
      <h3 className="text-sm font-medium text-zinc-300 mb-4">Recent Calls</h3>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-zinc-800/50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !calls?.length ? (
        <div className="text-center py-8">
          <PhoneIncoming className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
          <p className="text-zinc-500 text-sm">No calls yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {calls.map((call) => (
            <div key={call.id} className="bg-zinc-800/50 rounded-xl">
              <button
                onClick={() => setExpandedId(expandedId === call.id ? null : call.id)}
                className="w-full flex items-center justify-between p-4 text-left"
              >
                <div className="flex items-center gap-3">
                  {call.transferred ? (
                    <PhoneForwarded className="w-4 h-4 text-zinc-300" />
                  ) : (
                    <PhoneIncoming className="w-4 h-4 text-zinc-400" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-white">
                      {call.client?.name || call.callerPhone || 'Unknown'}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${statusColor(call.status)}`} />
                      <span className="text-xs text-zinc-400 capitalize">{call.status}</span>
                      {call.clientType && (
                        <span className="text-xs text-zinc-500">
                          · {call.clientType === 'current' ? 'Current' : 'Prospective'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">
                    {new Date(call.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                    {new Date(call.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  {expandedId === call.id ? (
                    <ChevronUp className="w-4 h-4 text-zinc-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-zinc-500" />
                  )}
                </div>
              </button>

              {expandedId === call.id && (
                <div className="px-4 pb-4 border-t border-zinc-700/50">
                  {call.summary && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-zinc-400 mb-1">Summary</p>
                      <p className="text-sm text-zinc-300">{call.summary}</p>
                    </div>
                  )}
                  {call.lawyer && (
                    <p className="text-xs text-zinc-400 mt-2">
                      Assigned to: <span className="text-zinc-300">{call.lawyer.name}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
