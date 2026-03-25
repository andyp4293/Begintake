'use client';

import { User, Briefcase } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

interface Lawyer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  specialties: string[];
  available: boolean;
}

export function LawyerList() {
  const { data: lawyers, isLoading } = useQuery<Lawyer[]>({
    queryKey: ['lawyers'],
    queryFn: async () => {
      const res = await fetch('/api/lawyers');
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
      <h3 className="text-sm font-medium text-zinc-400 mb-4">Attorneys</h3>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-zinc-800/50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : !lawyers?.length ? (
        <div className="text-center py-8">
          <Briefcase className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
          <p className="text-zinc-600 text-sm">No attorneys configured</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lawyers.map((lawyer) => (
            <div key={lawyer.id} className="flex items-center gap-3 p-3 bg-zinc-800/50 rounded-xl">
              <div className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center flex-shrink-0">
                <User className="w-4 h-4 text-zinc-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white">{lawyer.name}</p>
                  <span className={`w-2 h-2 rounded-full ${
                    lawyer.available ? 'bg-green-500' : 'bg-zinc-600'
                  }`} />
                </div>
                <p className="text-xs text-zinc-500 truncate">
                  {lawyer.specialties.join(' · ')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
