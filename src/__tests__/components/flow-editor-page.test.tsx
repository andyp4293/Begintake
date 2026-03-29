// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockUseSession = vi.fn();
const mockUseQuery = vi.fn();
const mockRedirect = vi.fn();
const mockConfirm = vi.fn(async () => true);

vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'flow-test-id' }),
  redirect: (...args: any[]) => mockRedirect(...args),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/ui/ConfirmDialog', () => ({
  useConfirm: () => mockConfirm,
}));

import FlowEditorPage from '@/app/flow-builder/[id]/page';

const mockFlow = {
  name: 'Immediate Flow',
  nodes: [
    {
      id: 'root-node',
      type: 'start',
      label: 'Opening Greeting',
      config: { greeting: 'Hello there' },
      sortOrder: 0,
    },
  ],
  edges: [],
};

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserverMock,
    configurable: true,
  });

  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  });

  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 0),
    configurable: true,
  });

  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    value: (id: number) => window.clearTimeout(id),
    configurable: true,
  });
});

describe('FlowEditorPage', () => {
  beforeEach(() => {
    mockRedirect.mockReset();
    mockUseSession.mockReturnValue({
      data: { user: { id: 'user-1', email: 'test@example.com' } },
      status: 'authenticated',
    });
    mockUseQuery.mockReturnValue({
      data: mockFlow,
      isLoading: false,
    });
  });

  it('renders an already-loaded flow without a hook order crash', async () => {
    render(<FlowEditorPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Immediate Flow')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Opening Greeting')).toBeInTheDocument();
    });

    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
