// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackupSummaryEmailCard } from '@/components/dashboard/BackupSummaryEmailCard';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderWithProviders(component: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>{component}</QueryClientProvider>
  );
}

describe('BackupSummaryEmailCard', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the backup summary recipient heading', () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ backupSummaryEmail: '' }),
    } as any);

    renderWithProviders(<BackupSummaryEmailCard />);

    expect(screen.getByText('Backup Summary Recipient')).toBeInTheDocument();
  });

  it('loads the saved backup email into the input', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ backupSummaryEmail: 'backup@test.com' }),
    } as any);

    renderWithProviders(<BackupSummaryEmailCard />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('backup@test.com')).toBeInTheDocument();
    });
  });

  it('saves the updated backup email', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ backupSummaryEmail: '' }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ backupSummaryEmail: 'always@test.com' }),
      } as any);

    renderWithProviders(<BackupSummaryEmailCard />);

    const input = await screen.findByPlaceholderText('backup@example.com');
    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('');
    });
    fireEvent.change(input, { target: { value: 'always@test.com' } });

    const saveButton = await screen.findByRole('button');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/settings',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ backupSummaryEmail: 'always@test.com' }),
        })
      );
    });
  });
});
