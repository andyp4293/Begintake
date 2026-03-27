'use client';

import { User, Briefcase, Plus, Pencil, Trash2, X, Check } from 'lucide-react';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { toast } from 'sonner';

interface Lawyer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  specialties: string[];
  available: boolean;
  availabilityStart: number;
  availabilityEnd: number;
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const ampm = i < 12 ? 'AM' : 'PM';
  const h = i === 0 ? 12 : i > 12 ? i - 12 : i;
  return { value: i, label: `${h}:00 ${ampm}` };
});

const SPECIALTY_OPTIONS = [
  'Family', 'Criminal', 'Immigration', 'Personal Injury', 'Corporate',
  'Real Estate', 'Employment', 'Bankruptcy', 'Tax', 'Estate Planning',
  'Intellectual Property', 'Civil Rights', 'Environmental',
];

function LawyerFormModal({
  lawyer,
  onClose,
}: {
  lawyer?: Lawyer | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEditing = !!lawyer;

  const [name, setName] = useState(lawyer?.name || '');
  const [email, setEmail] = useState(lawyer?.email || '');
  const [phone, setPhone] = useState(lawyer?.phone || '');
  const [specialties, setSpecialties] = useState<string[]>(lawyer?.specialties || []);
  const [available, setAvailable] = useState(lawyer?.available ?? true);
  const [availabilityStart, setAvailabilityStart] = useState(lawyer?.availabilityStart ?? 9);
  const [availabilityEnd, setAvailabilityEnd] = useState(lawyer?.availabilityEnd ?? 17);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { name, email, phone, specialties, available, availabilityStart, availabilityEnd };
      const url = isEditing ? `/api/lawyers/${lawyer.id}` : '/api/lawyers';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lawyers'] });
      toast.success(isEditing ? 'Attorney updated' : 'Attorney added');
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const toggleSpecialty = (s: string) => {
    setSpecialties((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800">
          <h2 className="text-base font-semibold text-white">
            {isEditing ? 'Edit Attorney' : 'Add Attorney'}
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-800 transition-colors">
            <X className="w-4 h-4 text-zinc-400" />
          </button>
        </div>

        {/* Form */}
        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sarah Chen"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="sarah@lawfirm.com"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </div>

          {/* Specialties */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">Specialties</label>
            <div className="flex flex-wrap gap-1.5">
              {SPECIALTY_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSpecialty(s.toLowerCase())}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                    specialties.includes(s.toLowerCase())
                      ? 'bg-zinc-700 text-zinc-300 border border-zinc-600'
                      : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Available */}
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-zinc-400">Available for calls</label>
            <button
              type="button"
              onClick={() => setAvailable(!available)}
              className={`w-10 h-5 rounded-full transition-colors relative ${
                available ? 'bg-green-500' : 'bg-zinc-700'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  available ? 'left-5' : 'left-0.5'
                }`}
              />
            </button>
          </div>

          {/* Call hours */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-2">Call hours</label>
            <div className="flex items-center gap-2">
              <CustomSelect
                value={String(availabilityStart)}
                options={HOUR_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
                onChange={(v) => setAvailabilityStart(Number(v))}
                className="flex-1"
              />
              <span className="text-zinc-500 text-xs shrink-0">to</span>
              <CustomSelect
                value={String(availabilityEnd)}
                options={HOUR_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
                onChange={(v) => setAvailabilityEnd(Number(v))}
                className="flex-1"
              />
            </div>
            <p className="text-[10px] text-zinc-600 mt-1">Calls will only be transferred to this attorney during these hours.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!name || !email || saveMutation.isPending}
            className="flex-1 px-4 py-2 bg-white rounded-lg text-sm text-black font-medium hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saveMutation.isPending ? 'Saving...' : isEditing ? 'Update' : 'Add Attorney'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LawyerList() {
  const [showForm, setShowForm] = useState(false);
  const [editingLawyer, setEditingLawyer] = useState<Lawyer | null>(null);
  const queryClient = useQueryClient();
  const confirmDialog = useConfirm();

  const { data: lawyers, isLoading } = useQuery<Lawyer[]>({
    queryKey: ['lawyers'],
    queryFn: async () => {
      const res = await fetch('/api/lawyers');
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/lawyers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lawyers'] });
      toast.success('Attorney removed');
    },
    onError: () => {
      toast.error('Failed to remove attorney');
    },
  });

  const handleEdit = (lawyer: Lawyer) => {
    setEditingLawyer(lawyer);
    setShowForm(true);
  };

  const handleDelete = async (lawyer: Lawyer) => {
    const ok = await confirmDialog({ title: 'Remove Attorney', message: `Remove ${lawyer.name} from the team? This cannot be undone.`, confirmLabel: 'Remove', destructive: true });
    if (ok) deleteMutation.mutate(lawyer.id);
  };

  const handleClose = () => {
    setShowForm(false);
    setEditingLawyer(null);
  };

  return (
    <>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-zinc-300">Attorneys</h3>
          <button
            onClick={() => { setEditingLawyer(null); setShowForm(true); }}
            className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-zinc-800/50 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : !lawyers?.length ? (
          <div className="text-center py-8">
            <Briefcase className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
            <p className="text-zinc-500 text-sm">No attorneys yet</p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-3 text-xs text-white hover:text-zinc-300"
            >
              Add your first attorney
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {lawyers.map((lawyer) => (
              <div
                key={lawyer.id}
                className="group flex items-center gap-3 p-3 bg-zinc-800/50 rounded-xl hover:bg-zinc-800 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-zinc-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white">{lawyer.name}</p>
                    <span className={`w-2 h-2 rounded-full ${
                      lawyer.available ? 'bg-green-500' : 'bg-zinc-600'
                    }`} />
                  </div>
                  <p className="text-xs text-zinc-400 truncate">
                    {lawyer.specialties.length
                      ? lawyer.specialties.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' · ')
                      : lawyer.email}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleEdit(lawyer)}
                    className="p-1.5 rounded-lg hover:bg-zinc-700 transition-colors"
                    title="Edit"
                  >
                    <Pencil className="w-3 h-3 text-zinc-400" />
                  </button>
                  <button
                    onClick={() => handleDelete(lawyer)}
                    className="p-1.5 rounded-lg hover:bg-zinc-700 transition-colors"
                    title="Remove"
                  >
                    <Trash2 className="w-3 h-3 text-zinc-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <LawyerFormModal
          lawyer={editingLawyer}
          onClose={handleClose}
        />
      )}
    </>
  );
}
