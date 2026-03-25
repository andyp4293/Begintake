// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PhoneNumberCard } from '@/components/dashboard/PhoneNumberCard';

// Mock clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe('PhoneNumberCard', () => {
  it('renders the phone number', () => {
    render(<PhoneNumberCard />);
    expect(screen.getByText(/855.*765.*4989/)).toBeInTheDocument();
  });

  it('displays AI Paralegal Line label', () => {
    render(<PhoneNumberCard />);
    expect(screen.getByText('AI Paralegal Line')).toBeInTheDocument();
  });

  it('displays VAPI-powered label', () => {
    render(<PhoneNumberCard />);
    expect(screen.getByText(/VAPI-powered/)).toBeInTheDocument();
  });

  it('copies number to clipboard on click', async () => {
    render(<PhoneNumberCard />);
    const copyButton = screen.getByTitle('Copy number');
    fireEvent.click(copyButton);
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
    });
  });
});
