'use client';

import { PhoneIncoming, PhoneForwarded, ChevronDown, ChevronUp, Loader2, Filter } from 'lucide-react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';

interface CallSession {
  id: string;
  createdAt: string;
  callerPhone: string | null;
  clientType: string | null;
  callOutcome: string | null;
  legalArea: string | null;
  status: string;
  summary: string | null;
  notes: string | null;
  transferred: boolean;
  transferredTo: string | null;
  lawyer: { name: string } | null;
  client: { name: string } | null;
}

interface CallsResponse {
  calls: CallSession[];
  nextCursor: string | null;
}

export function RecentCallsList() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [filterClientType, setFilterClientType] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('');
  const [filterLegalArea, setFilterLegalArea] = useState('');

  const buildParams = () => {
    const params = new URLSearchParams();
    params.set('limit', '10');
    params.set('sort', sort === 'oldest' ? 'oldest' : 'newest');
    if (filterClientType) params.set('clientType', filterClientType);
    if (filterOutcome) params.set('callOutcome', filterOutcome);
    if (filterLegalArea) params.set('legalArea', filterLegalArea);
    return params.toString();
  };

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<CallsResponse>({
    queryKey: ['calls', sort, filterClientType, filterOutcome, filterLegalArea],
    queryFn: async ({ pageParam }) => {
      const params = buildParams();
      const cursorParam = pageParam ? `&cursor=${pageParam}` : '';
      const res = await fetch(`/api/calls?${params}${cursorParam}`);
      if (!res.ok) throw new Error('Failed to fetch calls');
      return res.json();
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const allCalls = data?.pages.flatMap((p) => p.calls) || [];

  const statusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'completed': return 'bg-zinc-500';
      case 'transferred': return 'bg-white';
      default: return 'bg-zinc-700';
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-zinc-300">Recent Calls</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSort(sort === 'newest' ? 'oldest' : 'newest')}
            className="px-2 py-1 text-[10px] bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors"
          >
            {sort === 'newest' ? 'Newest first' : 'Oldest first'}
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-1.5 rounded-lg border transition-colors ${showFilters ? 'bg-zinc-700 border-zinc-600 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'}`}
          >
            <Filter className="w-3 h-3" />
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-2 mb-4">
          <select
            value={filterClientType}
            onChange={(e) => setFilterClientType(e.target.value)}
            className="px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300"
          >
            <option value="">All types</option>
            <option value="current">Current client</option>
            <option value="prospective">Prospective</option>
          </select>
          <select
            value={filterOutcome}
            onChange={(e) => setFilterOutcome(e.target.value)}
            className="px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300"
          >
            <option value="">All outcomes</option>
            <option value="consultation_scheduled">Scheduled</option>
            <option value="summary_sent">Summary sent</option>
            <option value="transferred">Transferred</option>
            <option value="general_inquiry">General inquiry</option>
          </select>
          <select
            value={filterLegalArea}
            onChange={(e) => setFilterLegalArea(e.target.value)}
            className="px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300"
          >
            <option value="">All areas</option>
            <option value="family">Family</option>
            <option value="criminal">Criminal</option>
            <option value="immigration">Immigration</option>
            <option value="personal_injury">Personal Injury</option>
            <option value="corporate">Corporate</option>
          </select>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-zinc-800/50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !allCalls.length ? (
        <div className="text-center py-8">
          <PhoneIncoming className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
          <p className="text-zinc-500 text-sm">No calls yet</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {allCalls.map((call) => (
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
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {call.clientType && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium">
                            {call.clientType === 'current' ? 'Current Client' : 'Prospective'}
                          </span>
                        )}
                        {call.callOutcome && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium">
                            {call.callOutcome === 'consultation_scheduled' ? 'Scheduled'
                              : call.callOutcome === 'summary_sent' ? 'Summary Sent'
                              : call.callOutcome === 'transferred' ? 'Transferred'
                              : call.callOutcome}
                          </span>
                        )}
                        {call.legalArea && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-medium capitalize">
                            {call.legalArea.replace('_', ' ')}
                          </span>
                        )}
                        {!call.clientType && !call.callOutcome && (
                          <span className={`w-1.5 h-1.5 rounded-full ${statusColor(call.status)}`} />
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
                    {call.transferred && call.transferredTo && (
                      <p className="text-xs text-zinc-400 mt-2">
                        Transferred to: <span className="text-zinc-300 font-mono">{call.transferredTo}</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {hasNextPage && (
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="w-full mt-4 py-2 text-xs text-zinc-400 hover:text-white bg-zinc-800/50 rounded-lg transition-colors"
            >
              {isFetchingNextPage ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading...
                </span>
              ) : (
                'Load more'
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
}
