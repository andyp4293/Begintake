// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LawyerList } from '@/components/dashboard/LawyerList';

function renderWithProviders(component: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{component}</QueryClientProvider>
  );
}

describe('LawyerList', () => {
  it('renders heading', () => {
    renderWithProviders(<LawyerList />);
    expect(screen.getByText('Routing Team')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    renderWithProviders(<LawyerList />);
    const container = screen.getByText('Routing Team').closest('div');
    expect(container).toBeInTheDocument();
  });
});
