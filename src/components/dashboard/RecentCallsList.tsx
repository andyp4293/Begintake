'use client';

import { PhoneIncoming, PhoneForwarded, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Loader2, Filter } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
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
  urgencyFlag: string | null;
  petitionType: string | null;
  matterCategory: string | null;
  partyRole: string | null;
  lawyer: { name: string } | null;
  client: { name: string } | null;
}

interface PagedResponse {
  calls: CallSession[];
  page: number;
  totalPages: number;
  totalCount: number;
}

function TranscriptView({ notes }: { notes: string }) {
  const [showFull, setShowFull] = useState(false);
  const lines = notes.split('\n').filter(Boolean);
  const preview = lines.slice(0, 4);
  const hasMore = lines.length > 4;

  return (
    <div className="mt-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Transcript</p>
      <div className="bg-zinc-800/50 rounded-lg p-3 space-y-1.5 max-h-64 overflow-y-auto">
        {(showFull ? lines : preview).map((line, i) => {
          const colonIdx = line.indexOf(':');
          if (colonIdx === -1) return <p key={i} className="text-xs text-zinc-400">{line}</p>;
          const role = line.slice(0, colonIdx).trim().toLowerCase();
          const content = line.slice(colonIdx + 1).trim();
          const isAi = role === 'assistant' || role === 'bot' || role === 'ai';
          return (
            <div key={i} className="flex gap-2">
              <span className={`text-[10px] font-medium mt-0.5 shrink-0 w-12 ${isAi ? 'text-blue-400' : 'text-green-400'}`}>
                {isAi ? 'AI' : 'Caller'}
              </span>
              <p className="text-xs text-zinc-300">{content}</p>
            </div>
          );
        })}
        {hasMore && !showFull && (
          <button onClick={() => setShowFull(true)} className="text-[10px] text-zinc-500 hover:text-white mt-1">
            Show full transcript ({lines.length} lines)...
          </button>
        )}
        {showFull && hasMore && (
          <button onClick={() => setShowFull(false)} className="text-[10px] text-zinc-500 hover:text-white mt-1">
            Collapse
          </button>
        )}
      </div>
    </div>
  );
}

export function RecentCallsList() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [filterClientType, setFilterClientType] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('');
  const [filterLegalArea, setFilterLegalArea] = useState('');
  const [page, setPage] = useState(1);
  const perPage = 5;

  const buildParams = () => {
    const params = new URLSearchParams();
    params.set('limit', String(perPage));
    params.set('page', String(page));
    params.set('sort', sort === 'oldest' ? 'oldest' : 'newest');
    if (filterClientType) params.set('clientType', filterClientType);
    if (filterOutcome) params.set('callOutcome', filterOutcome);
    if (filterLegalArea) params.set('legalArea', filterLegalArea);
    return params.toString();
  };

  const { data, isLoading } = useQuery<PagedResponse>({
    queryKey: ['calls', page, sort, filterClientType, filterOutcome, filterLegalArea],
    queryFn: async () => {
      const res = await fetch(`/api/calls?${buildParams()}`);
      if (!res.ok) throw new Error('Failed to fetch calls');
      return res.json();
    },
  });

  const calls = data?.calls || [];
  const totalPages = data?.totalPages || 1;
  const totalCount = data?.totalCount || 0;

  // Reset page when filters change
  const updateFilter = (setter: (v: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };

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
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-zinc-300">Recent Calls</h3>
          {totalCount > 0 && (
            <span className="text-[10px] text-zinc-600">{totalCount} total</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSort(sort === 'newest' ? 'oldest' : 'newest'); setPage(1); }}
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
          <select value={filterClientType} onChange={(e) => updateFilter(setFilterClientType, e.target.value)}
            className="px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300">
            <option value="">All types</option>
            <option value="current">Current client</option>
            <option value="prospective">Prospective</option>
          </select>
          <select value={filterOutcome} onChange={(e) => updateFilter(setFilterOutcome, e.target.value)}
            className="px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300">
            <option value="">All outcomes</option>
            <option value="consultation_scheduled">Scheduled</option>
            <option value="summary_sent">Summary sent</option>
            <option value="transferred">Transferred</option>
            <option value="general_inquiry">General inquiry</option>
          </select>
          <select value={filterLegalArea} onChange={(e) => updateFilter(setFilterLegalArea, e.target.value)}
            className="px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300">
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
      ) : !calls.length ? (
        <div className="text-center py-8">
          <PhoneIncoming className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
          <p className="text-zinc-500 text-sm">No calls yet</p>
        </div>
      ) : (
        <>
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
                    {(call.matterCategory || call.petitionType || call.urgencyFlag || call.partyRole) && (
                      <div className="mt-3 bg-zinc-800/50 rounded-lg p-3 space-y-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2">Intake Notes</p>
                        {call.callerPhone && (
                          <p className="text-xs text-zinc-400">Phone: <span className="text-zinc-300 font-mono">{call.callerPhone}</span></p>
                        )}
                        {call.partyRole && (
                          <p className="text-xs text-zinc-400">Party Role: <span className="text-zinc-300 capitalize">{call.partyRole}</span></p>
                        )}
                        {call.matterCategory && (
                          <p className="text-xs text-zinc-400">Matter: <span className="text-zinc-300">{call.matterCategory}</span></p>
                        )}
                        {call.petitionType && (
                          <p className="text-xs text-zinc-400">Petition Type: <span className="text-zinc-300">{call.petitionType}</span></p>
                        )}
                        {call.urgencyFlag && call.urgencyFlag !== 'standard' && (
                          <p className="text-xs">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              call.urgencyFlag === 'safety_first' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                            }`}>
                              {call.urgencyFlag === 'safety_first' ? 'URGENT - SAFETY' : 'URGENT'}
                            </span>
                          </p>
                        )}
                      </div>
                    )}

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

                    {call.notes && (
                      <TranscriptView notes={call.notes} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-800">
              <span className="text-[10px] text-zinc-600">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="px-2 py-1 text-[10px] bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors"
                >
                  First
                </button>
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                  className="p-1 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>

                {/* Page numbers */}
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`w-7 h-7 text-[10px] rounded-lg border transition-colors ${
                        pageNum === page
                          ? 'bg-white text-black border-white font-bold'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}

                <button
                  onClick={() => setPage(page + 1)}
                  disabled={page === totalPages}
                  className="p-1 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="px-2 py-1 text-[10px] bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-400 hover:text-white disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors"
                >
                  Last
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
