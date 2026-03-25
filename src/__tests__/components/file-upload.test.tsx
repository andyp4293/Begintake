// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FileUpload } from '@/components/dashboard/FileUpload';

// Mock sonner
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

describe('FileUpload', () => {
  it('renders heading', () => {
    renderWithProviders(<FileUpload />);
    expect(screen.getByText('Documents')).toBeInTheDocument();
  });

  it('renders drag and drop area', () => {
    renderWithProviders(<FileUpload />);
    expect(screen.getByText(/Drag & drop/)).toBeInTheDocument();
  });

  it('renders browse button', () => {
    renderWithProviders(<FileUpload />);
    expect(screen.getByText('browse')).toBeInTheDocument();
  });

  it('has a file input', () => {
    renderWithProviders(<FileUpload />);
    const input = document.querySelector('input[type="file"]');
    expect(input).toBeInTheDocument();
  });

  it('file input accepts multiple files', () => {
    renderWithProviders(<FileUpload />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input?.multiple).toBe(true);
  });
});
