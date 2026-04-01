// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PhoneNumberCard } from '@/components/dashboard/PhoneNumberCard';

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

describe('PhoneNumberCard', () => {
  it('renders the Begintake Number label', () => {
    renderWithProviders(<PhoneNumberCard />);
    expect(screen.getByText('Begintake Number')).toBeInTheDocument();
  });

  it('displays the updated intake-line subtitle', () => {
    renderWithProviders(<PhoneNumberCard />);
    expect(screen.getByText('Your always-on intake line')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    renderWithProviders(<PhoneNumberCard />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
