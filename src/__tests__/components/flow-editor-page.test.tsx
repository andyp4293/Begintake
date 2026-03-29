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

const mockBranchingFlow = {
  name: 'Branching Flow',
  nodes: [
    {
      id: 'start-node',
      type: 'start',
      label: 'Opening Greeting',
      config: { greeting: 'Hello there' },
      sortOrder: 0,
    },
    {
      id: 'question-node',
      type: 'question',
      label: 'Q1. Shall we get started?',
      config: { question: 'Shall we get started?' },
      sortOrder: 1,
    },
    {
      id: 'response-yes',
      type: 'response',
      label: "Yes, let's begin",
      config: { response: "Yes, let's begin" },
      sortOrder: 2,
    },
    {
      id: 'response-what',
      type: 'response',
      label: 'What is this for?',
      config: { response: 'What is this for?' },
      sortOrder: 3,
    },
  ],
  edges: [
    { sourceNodeId: 'start-node', targetNodeId: 'question-node', label: null, condition: null, sortOrder: 0 },
    { sourceNodeId: 'question-node', targetNodeId: 'response-yes', label: null, condition: null, sortOrder: 0 },
    { sourceNodeId: 'question-node', targetNodeId: 'response-what', label: null, condition: null, sortOrder: 1 },
  ],
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

  it('starts child branch stems at the shared horizontal connector for multi-branch questions', async () => {
    mockUseQuery.mockReturnValue({
      data: mockBranchingFlow,
      isLoading: false,
    });

    render(<FlowEditorPage />);

    const yesStem = await screen.findByTestId('primary-branch-stem-question-node-response-yes');
    const whatStem = await screen.findByTestId('primary-branch-stem-question-node-response-what');

    expect((yesStem as HTMLElement).style.top).toBe('8px');
    expect((whatStem as HTMLElement).style.top).toBe('8px');
  });
});
