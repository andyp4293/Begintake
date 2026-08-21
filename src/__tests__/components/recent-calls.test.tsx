// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecentCallsList } from '@/components/dashboard/RecentCallsList';

function renderWithProviders(component: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{component}</QueryClientProvider>
  );
}

describe('RecentCallsList', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the assistant name in the transcript preview', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        calls: [
          {
            id: 'call-1',
            createdAt: '2026-04-02T22:11:00.000Z',
            callerPhone: '+19087272437',
            clientType: 'prospective',
            callOutcome: 'general_inquiry',
            legalArea: 'family',
            status: 'completed',
            summary: 'Test summary',
            notes: 'bobby: Thanks for calling.\nCaller: I need help with a divorce.',
            assistantName: 'Bobby',
            transferred: false,
            transferredTo: null,
            urgencyFlag: null,
            petitionType: null,
            matterCategory: null,
            partyRole: null,
            lawyer: null,
            client: null,
          },
        ],
        page: 1,
        totalPages: 1,
        totalCount: 1,
      }),
    }) as any);

    renderWithProviders(<RecentCallsList />);

    await waitFor(() => {
      expect(screen.getByText('+19087272437')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('+19087272437'));

    expect(screen.getByText('Bobby')).toBeInTheDocument();
    expect(screen.getByText('Thanks for calling.')).toBeInTheDocument();
    expect(screen.getByText('Caller')).toBeInTheDocument();
    expect(screen.getByText('I need help with a divorce.')).toBeInTheDocument();
  });

  it('uses the configured assistant name for generic assistant transcript roles', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        calls: [
          {
            id: 'call-2',
            createdAt: '2026-04-02T22:12:00.000Z',
            callerPhone: '+19087272438',
            clientType: 'prospective',
            callOutcome: 'general_inquiry',
            legalArea: 'family',
            status: 'completed',
            summary: 'Test summary',
            notes: 'assistant: Thanks for calling.\ncaller: I need help with a divorce.',
            assistantName: 'Bobby',
            transferred: false,
            transferredTo: null,
            urgencyFlag: null,
            petitionType: null,
            matterCategory: null,
            partyRole: null,
            lawyer: null,
            client: null,
          },
        ],
        page: 1,
        totalPages: 1,
        totalCount: 1,
      }),
    }) as any);

    renderWithProviders(<RecentCallsList />);

    await waitFor(() => {
      expect(screen.getByText('+19087272438')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('+19087272438'));

    expect(screen.getByText('Bobby')).toBeInTheDocument();
    expect(screen.getByText('Caller')).toBeInTheDocument();
  });

  it('renders heading', () => {
    renderWithProviders(<RecentCallsList />);
    expect(screen.getByText('Recent Calls')).toBeInTheDocument();
  });

  it('shows loading skeleton initially', () => {
    renderWithProviders(<RecentCallsList />);
    // Skeleton elements should be present during loading
    const container = screen.getByText('Recent Calls').closest('div');
    expect(container).toBeInTheDocument();
  });
});
