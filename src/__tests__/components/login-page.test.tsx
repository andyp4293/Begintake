// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock next-auth/react
const mockSignIn = vi.fn();
vi.mock('next-auth/react', () => ({
  signIn: (...args: any[]) => mockSignIn(...args),
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

import LoginPage from '@/app/login/page';

describe('LoginPage', () => {
  it('renders the app title', () => {
    render(<LoginPage />);
    expect(screen.getByText('AI Paralegal')).toBeInTheDocument();
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
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('bg-black');
  });

  it('renders email and password inputs', () => {
    render(<LoginPage />);
    expect(screen.getByPlaceholderText('Email address')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
  });

  it('renders sign in button', () => {
    render(<LoginPage />);
    expect(screen.getByText('Sign In')).toBeInTheDocument();
  });

  it('toggles to register mode', () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByText('Create one'));
    expect(screen.getByText('Create Account')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Full name')).toBeInTheDocument();
  });

  it('toggles back to sign in mode', () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByText('Create one'));
    fireEvent.click(screen.getByText('Sign in'));
    expect(screen.getByText('Sign In')).toBeInTheDocument();
  });
});
