'use client';

import { Mail, Check, Loader2, Users, ClipboardList } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

type SettingsPayload = {
  backupSummaryEmail: string;
  additionalSummaryEmails: string[];
  assumeNewClients: boolean;
};

function emailsToTextarea(emails: string[]): string {
  return emails.join('\n');
}

function normalizeTextareaEmails(value: string): string[] {
  return value
    .split(/[,\n]/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function BackupSummaryEmailCard() {
  const queryClient = useQueryClient();

  const { data } = useQuery<SettingsPayload>({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const [backupEmail, setBackupEmail] = useState('');
  const [additionalEmailsText, setAdditionalEmailsText] = useState('');
  const [assumeNewClients, setAssumeNewClients] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (!data) return;
    setBackupEmail(data.backupSummaryEmail || '');
    setAdditionalEmailsText(emailsToTextarea(data.additionalSummaryEmails || []));
    setAssumeNewClients(Boolean(data.assumeNewClients));
    setHasChanges(false);
  }, [data]);

  const baseline = useMemo(() => ({
    backupSummaryEmail: data?.backupSummaryEmail || '',
    additionalSummaryEmails: data?.additionalSummaryEmails || [],
    assumeNewClients: Boolean(data?.assumeNewClients),
  }), [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          backupSummaryEmail: backupEmail,
          additionalSummaryEmails: normalizeTextareaEmails(additionalEmailsText),
          assumeNewClients,
        }),
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
      toast.success('Intake operations settings saved');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const syncHasChanges = (next: {
    backupSummaryEmail?: string;
    additionalSummaryEmailsText?: string;
    assumeNewClients?: boolean;
  }) => {
    const nextBackup = next.backupSummaryEmail ?? backupEmail;
    const nextAdditional = normalizeTextareaEmails(next.additionalSummaryEmailsText ?? additionalEmailsText);
    const nextAssume = next.assumeNewClients ?? assumeNewClients;

    const baselineAdditional = baseline.additionalSummaryEmails;
    const changed =
      nextBackup !== baseline.backupSummaryEmail
      || nextAssume !== baseline.assumeNewClients
      || nextAdditional.length !== baselineAdditional.length
      || nextAdditional.some((email, index) => email !== baselineAdditional[index]);

    setHasChanges(changed);
  };

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-zinc-200">Firm Intake Operations</h3>
            <p className="text-xs text-zinc-500">
              Control who receives intake summaries and how this line treats new-client intake.
            </p>
          </div>
        </div>
        {hasChanges && (
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="px-3 py-2 bg-white rounded-lg text-sm text-black font-medium hover:bg-zinc-200 disabled:opacity-50 transition-colors"
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          </button>
        )}
      </div>

      <div className="space-y-6">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Mail className="w-4 h-4 text-zinc-400" />
            <h4 className="text-sm font-medium text-zinc-200">Intake Summary Distribution</h4>
          </div>
          <p className="text-xs text-zinc-500 mb-4">
            Every intake summary already goes to the matched attorney. Use this section to send a standing copy to your intake desk, lead paralegal, or firm operations team.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2">Primary Firm Copy</label>
              <input
                type="email"
                value={backupEmail}
                onChange={(e) => {
                  const value = e.target.value;
                  setBackupEmail(value);
                  syncHasChanges({ backupSummaryEmail: value });
                }}
                placeholder="intake@firm.com"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
              />
              <p className="mt-2 text-xs text-zinc-500">
                Best for one always-on firm inbox, like intake, office manager, or lead paralegal.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2">Additional Internal Recipients</label>
              <textarea
                value={additionalEmailsText}
                onChange={(e) => {
                  const value = e.target.value;
                  setAdditionalEmailsText(value);
                  syncHasChanges({ additionalSummaryEmailsText: value });
                }}
                placeholder={'operations@firm.com\nsupervising.paralegal@firm.com'}
                rows={4}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors resize-y"
              />
              <p className="mt-2 text-xs text-zinc-500">
                Add one email per line. These copies are sent in addition to the matched attorney and the primary firm copy.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-zinc-400" />
            <h4 className="text-sm font-medium text-zinc-200">Caller Routing Policy</h4>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={assumeNewClients}
              onChange={(e) => {
                const checked = e.target.checked;
                setAssumeNewClients(checked);
                syncHasChanges({ assumeNewClients: checked });
              }}
              className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-white focus:ring-zinc-500"
            />
            <div>
              <div className="text-sm text-zinc-200 font-medium">Assume all callers are new clients</div>
              <p className="text-xs text-zinc-500 mt-1">
                Skip the “new or existing client” question and keep callers on the new-client intake path. Useful for dedicated test lines or campaigns where every caller should be treated as new.
              </p>
            </div>
          </label>
        </div>
      </div>
    </section>
  );
}
