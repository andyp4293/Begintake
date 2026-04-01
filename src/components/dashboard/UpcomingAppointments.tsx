'use client';

import { Calendar, Clock, ExternalLink, Loader2, Filter } from 'lucide-react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

interface Appointment {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  client: { name: string; phone: string };
  lawyer: { name: string };
}

interface AppointmentsResponse {
  appointments: Appointment[];
  nextCursor: string | null;
}

interface Lawyer {
  id: string;
  name: string;
}

export function UpcomingAppointments() {
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<'newest' | 'oldest'>('oldest');
  const [filterLawyer, setFilterLawyer] = useState('');

  const { data: lawyers } = useQuery<Lawyer[]>({
    queryKey: ['lawyers'],
    queryFn: async () => {
      const res = await fetch('/api/lawyers');
      if (!res.ok) return [];
      return res.json();
    },
  });

  const buildParams = () => {
    const params = new URLSearchParams();
    params.set('limit', '10');
    params.set('sort', sort === 'oldest' ? 'asc' : 'desc');
    if (filterLawyer) params.set('lawyerId', filterLawyer);
    return params.toString();
  };

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<AppointmentsResponse>({
    queryKey: ['appointments', sort, filterLawyer],
    queryFn: async ({ pageParam }) => {
      const params = buildParams();
      const cursorParam = pageParam ? `&cursor=${pageParam}` : '';
      const res = await fetch(`/api/appointments?${params}${cursorParam}`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const allAppointments = data?.pages.flatMap((p) => p.appointments) || [];

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-zinc-300">Consultations</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSort(sort === 'newest' ? 'oldest' : 'newest')}
            className="px-2 py-1 text-[10px] bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-400 hover:text-white transition-colors"
          >
            {sort === 'oldest' ? 'Soonest first' : 'Latest first'}
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-1.5 rounded-lg border transition-colors ${showFilters ? 'bg-zinc-700 border-zinc-600 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'}`}
          >
            <Filter className="w-3 h-3" />
          </button>
          <a
            href="https://calendar.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
          >
            <Calendar className="w-3 h-3" />
            Calendar
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {showFilters && lawyers && lawyers.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <select
            value={filterLawyer}
            onChange={(e) => setFilterLawyer(e.target.value)}
            className="px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300"
          >
            <option value="">All team members</option>
            {lawyers.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-20 bg-zinc-800/50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !allAppointments.length ? (
        <div className="text-center py-8">
          <Calendar className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
          <p className="text-zinc-500 text-sm">No consultations</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {allAppointments.map((apt) => {
              const start = new Date(apt.startTime);
              return (
                <div key={apt.id} className="bg-zinc-800/50 rounded-xl p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">{apt.client.name}</p>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        with {apt.lawyer.name}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      apt.status === 'scheduled'
                        ? 'bg-zinc-800 text-zinc-300'
                        : apt.status === 'completed'
                        ? 'bg-green-500/10 text-green-400'
                        : 'bg-zinc-700 text-zinc-400'
                    }`}>
                      {apt.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-3 text-xs text-zinc-400">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              );
            })}
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
