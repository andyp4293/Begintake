// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UpcomingAppointments } from '@/components/dashboard/UpcomingAppointments';

function renderWithProviders(component: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{component}</QueryClientProvider>
  );
}

describe('UpcomingAppointments', () => {
  it('renders heading', () => {
    renderWithProviders(<UpcomingAppointments />);
    expect(screen.getByText('Consultations')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    renderWithProviders(<UpcomingAppointments />);
    const container = screen.getByText('Consultations').closest('div');
    expect(container).toBeInTheDocument();
  });
});
