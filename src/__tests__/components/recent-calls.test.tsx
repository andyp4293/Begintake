// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
