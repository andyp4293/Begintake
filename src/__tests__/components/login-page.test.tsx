// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockSignIn = vi.fn();
vi.mock('next-auth/react', () => ({
  signIn: (...args: any[]) => mockSignIn(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

import LoginPage from '@/app/login/page';

describe('LoginPage', () => {
  it('renders the app title', () => {
    render(<LoginPage />);
    expect(screen.getByText('Begintake')).toBeInTheDocument();
  });

  it('renders sign in description', () => {
    render(<LoginPage />);
    expect(screen.getByText(/Sign in to/)).toBeInTheDocument();
  });

  it('renders Google sign in button', () => {
    render(<LoginPage />);
    expect(screen.getByText('Continue with Google')).toBeInTheDocument();
  });

  it('calls signIn with google provider on click', () => {
    render(<LoginPage />);
    const button = screen.getByText('Continue with Google');
    fireEvent.click(button);
    expect(mockSignIn).toHaveBeenCalledWith('google', { callbackUrl: '/' });
  });

  it('has dark background', () => {
    const { container } = render(<LoginPage />);
    const wrapper = container.querySelector('.bg-black');
    expect(wrapper).toBeInTheDocument();
  });
});
