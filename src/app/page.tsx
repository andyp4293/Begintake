'use client';

import { useSession, signOut } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { LogOut, Workflow } from 'lucide-react';
import Link from 'next/link';
import { PhoneNumberCard } from '@/components/dashboard/PhoneNumberCard';
import { RecentCallsList } from '@/components/dashboard/RecentCallsList';
import { UpcomingAppointments } from '@/components/dashboard/UpcomingAppointments';
import { FileUpload } from '@/components/dashboard/FileUpload';
import { LawyerList } from '@/components/dashboard/LawyerList';
import { TransferNumberCard } from '@/components/dashboard/TransferNumberCard';
import { FirmNameCard } from '@/components/dashboard/FirmNameCard';
import { AssistantNameCard } from '@/components/dashboard/AssistantNameCard';
import { BackupSummaryEmailCard } from '@/components/dashboard/BackupSummaryEmailCard';

export default function Dashboard() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="border-b border-zinc-900">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
              <Workflow className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">Begintake</h1>
              <p className="text-xs text-zinc-500">AI intake workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/flow-builder"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 hover:text-white hover:border-zinc-700 transition-colors"
            >
              <Workflow className="w-3 h-3" />
              Flow Builder
            </Link>
            <span className="text-sm text-zinc-400">{session.user?.name}</span>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="p-2 rounded-lg hover:bg-zinc-900 transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4 text-zinc-400" />
            </button>
          </div>
        </div>
      </header>

      {/* Dashboard Grid */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column - wide */}
          <div className="lg:col-span-2 space-y-6">
            <PhoneNumberCard />
            <FirmNameCard />
            <AssistantNameCard />
            <TransferNumberCard />
            <BackupSummaryEmailCard />
            <RecentCallsList />
            <UpcomingAppointments />
          </div>

          {/* Right column - sidebar */}
          <div className="space-y-6">
            <LawyerList />
            <FileUpload />
          </div>
        </div>
      </main>
    </div>
  );
}
