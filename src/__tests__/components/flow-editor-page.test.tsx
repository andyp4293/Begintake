// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

function makeRect(left: number, top: number, width: number, height: number) {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

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

  it('keeps child branch stems flush with the shared horizontal connector for multi-branch questions', async () => {
    mockUseQuery.mockReturnValue({
      data: mockBranchingFlow,
      isLoading: false,
    });

    render(<FlowEditorPage />);

    const line = await screen.findByTestId('primary-branch-line-question-node');
    const responseTitle = await screen.findByTestId('response-node-title-response-yes');
    const yesStem = await screen.findByTestId('primary-branch-stem-question-node-response-yes');
    const whatStem = await screen.findByTestId('primary-branch-stem-question-node-response-what');

    expect((line as HTMLElement).className).toContain('top-8');
    expect(screen.queryByTestId('primary-branch-label-question-node-response-yes')).not.toBeInTheDocument();
    expect(responseTitle.textContent).toBe("Yes, let's begin");
    expect((yesStem as HTMLElement).style.top).toBe('8px');
    expect((whatStem as HTMLElement).style.top).toBe('8px');
  });

  it('extends the shared horizontal branch line across the rendered child cards', async () => {
    mockUseQuery.mockReturnValue({
      data: mockBranchingFlow,
      isLoading: false,
    });

    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.id === 'flow-node-response-yes') return makeRect(130, 220, 272, 88);
      if (this.id === 'flow-node-response-what') return makeRect(930, 220, 272, 88);

      if (this.getAttribute('data-testid') === 'primary-branch-row-question-node') {
        return makeRect(100, 180, 1200, 240);
      }

      return makeRect(0, 0, 0, 0);
    });

    try {
      render(<FlowEditorPage />);

      await waitFor(() => {
        const line = screen.getByTestId('primary-branch-line-question-node') as HTMLElement;
        expect(line.style.left).toBe('30px');
        expect(line.style.width).toBe('1072px');
      });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('zooms in from the trackpad pinch wheel path and updates the overlay control', async () => {
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
    const clientHeightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);

    try {
      render(<FlowEditorPage />);

      const viewport = await screen.findByTestId('flow-canvas-viewport');
      const resetZoomButton = screen.getByRole('button', { name: 'Reset zoom' });

      fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -40, clientX: 400, clientY: 300 });

      await waitFor(() => {
        expect(resetZoomButton.textContent).toBe('115%');
      });
    } finally {
      clientWidthSpy.mockRestore();
      clientHeightSpy.mockRestore();
    }
  });

});
