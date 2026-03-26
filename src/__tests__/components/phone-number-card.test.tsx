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
  it('renders the AI Paralegal Line label', () => {
    renderWithProviders(<PhoneNumberCard />);
    expect(screen.getByText('AI Paralegal Line')).toBeInTheDocument();
  });

  it('displays VAPI-powered label', () => {
    renderWithProviders(<PhoneNumberCard />);
    expect(screen.getByText(/Available 24\/7/)).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    renderWithProviders(<PhoneNumberCard />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
