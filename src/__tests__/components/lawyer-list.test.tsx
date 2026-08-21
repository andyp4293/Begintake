// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LawyerList } from '@/components/dashboard/LawyerList';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn(async () => true),
}));

function renderWithProviders(component: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{component}</QueryClientProvider>
  );
}

describe('LawyerList', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders heading', () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [],
    } as any);

    renderWithProviders(<LawyerList />);
    expect(screen.getByText('Routing Team')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}) as any);
    renderWithProviders(<LawyerList />);
    const container = screen.getByText('Routing Team').closest('div');
    expect(container).toBeInTheDocument();
  });

  it('shows edit and remove buttons for touch/mobile interaction', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/lawyers') {
        return {
          ok: true,
          json: async () => [
            {
              id: 'law-1',
              name: 'Sarah Chen',
              email: 'sarah@test.com',
              phone: '+15551234567',
              specialties: ['family'],
              available: true,
              availabilityStart: 9,
              availabilityEnd: 17,
            },
          ],
        } as any;
      }

      return {
        ok: true,
        json: async () => ({ calendarServiceEmail: null }),
      } as any;
    });

    renderWithProviders(<LawyerList />);

    expect(await screen.findByText('Sarah Chen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Sarah Chen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Sarah Chen' })).toBeInTheDocument();
  });

  it('opens the edit modal from the visible mobile action button', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/lawyers') {
        return {
          ok: true,
          json: async () => [
            {
              id: 'law-1',
              name: 'Sarah Chen',
              email: 'sarah@test.com',
              phone: '+15551234567',
              specialties: ['family'],
              available: true,
              availabilityStart: 9,
              availabilityEnd: 17,
            },
          ],
        } as any;
      }

      return {
        ok: true,
        json: async () => ({ calendarServiceEmail: null }),
      } as any;
    });

    renderWithProviders(<LawyerList />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sarah Chen' }));

    expect(await screen.findByText('Edit Team Member')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sarah Chen')).toBeInTheDocument();
    expect(screen.getByTestId('lawyer-form-modal').className).toContain('max-h-[92vh]');
  });

  it('shows the calendar sharing panel when a service account email exists', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/lawyers') {
        return {
          ok: true,
          json: async () => [],
        } as any;
      }

      return {
        ok: true,
        json: async () => ({ calendarServiceEmail: 'calendar@test.com' }),
      } as any;
    });

    renderWithProviders(<LawyerList />);

    expect(await screen.findByText('Google Calendar sharing')).toBeInTheDocument();
    expect(screen.getByText('calendar@test.com')).toBeInTheDocument();
  });
});
