'use client';

import { Calendar, Clock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

interface Appointment {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  client: { name: string; phone: string };
  lawyer: { name: string };
}

export function UpcomingAppointments() {
  const { data: appointments, isLoading } = useQuery<Appointment[]>({
    queryKey: ['appointments'],
    queryFn: async () => {
      const res = await fetch('/api/appointments');
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
      <h3 className="text-sm font-medium text-zinc-300 mb-4">Upcoming Consultations</h3>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-20 bg-zinc-800/50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !appointments?.length ? (
        <div className="text-center py-8">
          <Calendar className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
          <p className="text-zinc-500 text-sm">No upcoming consultations</p>
        </div>
      ) : (
        <div className="space-y-2">
          {appointments.map((apt) => {
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
                      : 'bg-zinc-700 text-zinc-300'
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
      )}
    </div>
  );
}
