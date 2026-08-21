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

  it('renders the firm intake operations heading', () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ backupSummaryEmail: '', additionalSummaryEmails: [], assumeNewClients: false }),
    } as any);

    renderWithProviders(<BackupSummaryEmailCard />);

    expect(screen.getByText('Firm Intake Operations')).toBeInTheDocument();
    expect(screen.getByText('Intake Summary Distribution')).toBeInTheDocument();
  });

  it('loads the saved summary distribution settings', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        backupSummaryEmail: 'backup@test.com',
        additionalSummaryEmails: ['ops@test.com', 'paralegal@test.com'],
        assumeNewClients: true,
      }),
    } as any);

    const { container } = renderWithProviders(<BackupSummaryEmailCard />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('intake@firm.com')).toHaveValue('backup@test.com');
      expect(container.querySelector('textarea')).toHaveValue('ops@test.com\nparalegal@test.com');
      expect(screen.getByRole('checkbox')).toBeChecked();
    });
  });

  it('saves the updated distribution list and assume-new-clients toggle', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ backupSummaryEmail: '', additionalSummaryEmails: [], assumeNewClients: false }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          backupSummaryEmail: 'intake@test.com',
          additionalSummaryEmails: ['ops@test.com', 'paralegal@test.com'],
          assumeNewClients: true,
        }),
      } as any);

    const { container } = renderWithProviders(<BackupSummaryEmailCard />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('intake@firm.com')).toHaveValue('');
      expect(container.querySelector('textarea')).toHaveValue('');
      expect(screen.getByRole('checkbox')).not.toBeChecked();
    });

    const primaryInput = await screen.findByPlaceholderText('intake@firm.com');
    fireEvent.change(primaryInput, { target: { value: 'intake@test.com' } });

    const additionalTextarea = container.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(additionalTextarea).not.toBeNull();
    if (!additionalTextarea) throw new Error('Expected additional recipients textarea');
    fireEvent.change(additionalTextarea, { target: { value: 'ops@test.com\nparalegal@test.com' } });

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(primaryInput).toHaveValue('intake@test.com');
      expect(additionalTextarea).toHaveValue('ops@test.com\nparalegal@test.com');
      expect(checkbox).toBeChecked();
    });

    const saveButton = await screen.findByRole('button');
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/settings',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            backupSummaryEmail: 'intake@test.com',
            additionalSummaryEmails: ['ops@test.com', 'paralegal@test.com'],
            assumeNewClients: true,
          }),
        })
      );
    });
  });
});
