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

const mockCollapsedBranchingFlow = {
  name: 'Collapsed Branching Flow',
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
      config: { question: 'Shall we get started?', defaultCollapsed: true },
      sortOrder: 1,
    },
    {
      id: 'response-yes',
      type: 'response',
      label: "Yes, let's begin",
      config: { response: "Yes, let's begin" },
      sortOrder: 2,
    },
  ],
  edges: [
    { sourceNodeId: 'start-node', targetNodeId: 'question-node', label: null, condition: null, sortOrder: 0 },
    { sourceNodeId: 'question-node', targetNodeId: 'response-yes', label: null, condition: null, sortOrder: 0 },
  ],
};

const mockSharedMergeFlow = {
  name: 'Shared Merge Flow',
  nodes: [
    { id: 'start-node', type: 'start', label: 'Opening Greeting', config: { greeting: 'Hello there' }, sortOrder: 0 },
    { id: 'routing-node', type: 'question', label: 'Environmental - Matter Type', config: { note: 'Route the matter' }, sortOrder: 1 },
    { id: 'response-a', type: 'response', label: 'Contamination', config: { response: 'Contamination' }, sortOrder: 2 },
    { id: 'response-b', type: 'response', label: 'Regulatory', config: { response: 'Regulatory' }, sortOrder: 3 },
    { id: 'flag-a', type: 'action', label: 'Flag: Env - Contamination', config: { actionType: 'set_flag', flagName: 'env_matter', flagValue: 'Contamination' }, sortOrder: 4 },
    { id: 'flag-b', type: 'action', label: 'Flag: Env - Regulatory', config: { actionType: 'set_flag', flagName: 'env_matter', flagValue: 'Regulatory' }, sortOrder: 5 },
    { id: 'shared-question', type: 'question', label: 'Env M1. Your Role in This Matter', config: { question: 'Who are you in this matter?' }, sortOrder: 6 },
  ],
  edges: [
    { sourceNodeId: 'start-node', targetNodeId: 'routing-node', label: null, condition: null, sortOrder: 0 },
    { sourceNodeId: 'routing-node', targetNodeId: 'response-a', label: null, condition: null, sortOrder: 1 },
    { sourceNodeId: 'routing-node', targetNodeId: 'response-b', label: null, condition: null, sortOrder: 2 },
    { sourceNodeId: 'response-a', targetNodeId: 'flag-a', label: null, condition: null, sortOrder: 3 },
    { sourceNodeId: 'response-b', targetNodeId: 'flag-b', label: null, condition: null, sortOrder: 4 },
    { sourceNodeId: 'flag-a', targetNodeId: 'shared-question', label: null, condition: null, sortOrder: 5 },
    { sourceNodeId: 'flag-b', targetNodeId: 'shared-question', label: null, condition: null, sortOrder: 6 },
  ],
};

const mockGeneralTemplateFlow = {
  name: 'General Legal Intake - All Practice Areas',
  nodes: [
    {
      id: 'start-node',
      type: 'start',
      label: 'Opening Greeting',
      config: { greeting: 'Hello there' },
      sortOrder: 0,
    },
    {
      id: 'family-routing',
      type: 'question',
      label: 'Family Law - Matter Triage',
      config: { note: 'Route the family law matter', defaultCollapsed: true },
      sortOrder: 1,
    },
    {
      id: 'ip-routing',
      type: 'question',
      label: 'IP - Matter Type',
      config: { note: 'Route the IP matter', defaultCollapsed: true },
      sortOrder: 2,
    },
    {
      id: 'environmental-routing',
      type: 'question',
      label: 'Environmental - Matter Type',
      config: { note: 'Route the environmental matter', defaultCollapsed: true },
      sortOrder: 3,
    },
    {
      id: 'family-response',
      type: 'response',
      label: 'Custody or visitation of my children',
      config: { response: 'Custody or visitation of my children' },
      sortOrder: 4,
    },
  ],
  edges: [
    { sourceNodeId: 'start-node', targetNodeId: 'family-routing', label: null, condition: null, sortOrder: 0 },
    { sourceNodeId: 'start-node', targetNodeId: 'ip-routing', label: null, condition: null, sortOrder: 1 },
    { sourceNodeId: 'start-node', targetNodeId: 'environmental-routing', label: null, condition: null, sortOrder: 2 },
    { sourceNodeId: 'family-routing', targetNodeId: 'family-response', label: null, condition: null, sortOrder: 3 },
  ],
};

const mockLegacyGeneralTemplateFlow = {
  name: 'General Legal Intake - All Practice Areas',
  nodes: [
    {
      id: 'start-node',
      type: 'start',
      label: 'Opening Greeting',
      config: { greeting: 'Hello there' },
      sortOrder: 0,
    },
    {
      id: 'family-routing',
      type: 'question',
      label: 'Family Law - Matter Triage',
      config: { note: 'Route the family law matter' },
      sortOrder: 1,
    },
    {
      id: 'family-response',
      type: 'response',
      label: 'Custody or visitation of my children',
      config: { response: 'Custody or visitation of my children' },
      sortOrder: 2,
    },
  ],
  edges: [
    { sourceNodeId: 'start-node', targetNodeId: 'family-routing', label: null, condition: null, sortOrder: 0 },
    { sourceNodeId: 'family-routing', targetNodeId: 'family-response', label: null, condition: null, sortOrder: 1 },
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

  it('renders multi-branch questions as aligned row placements with response labels kept inside the cards', async () => {
    mockUseQuery.mockReturnValue({
      data: mockBranchingFlow,
      isLoading: false,
    });

    render(<FlowEditorPage />);

    const line = await screen.findByTestId('primary-branch-line-question-node');
    const yesPlacement = await screen.findByTestId('tree-node-placement-response-yes');
    const whatPlacement = await screen.findByTestId('tree-node-placement-response-what');
    const responseTitle = await screen.findByTestId('response-node-title-response-yes');
    const yesSubtree = document.getElementById('flow-subtree-response-yes');
    const whatSubtree = document.getElementById('flow-subtree-response-what');

    expect((yesPlacement as HTMLElement).style.top).toBe((whatPlacement as HTMLElement).style.top);
    expect(yesSubtree?.style.paddingTop).toBe('24px');
    expect(whatSubtree?.style.paddingTop).toBe('24px');
    expect(screen.queryByTestId('primary-branch-label-response-yes')).not.toBeInTheDocument();
    expect(line).toBeInTheDocument();
    expect(responseTitle.textContent).toBe("Yes, let's begin");
    expect((responseTitle as HTMLElement).className).toContain('text-xs');
  });

  it('extends the shared horizontal branch line across the rendered child cards', async () => {
    mockUseQuery.mockReturnValue({
      data: mockBranchingFlow,
      isLoading: false,
    });

    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
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
        expect(line.style.left).toBe('136.5px');
        expect(line.style.width).toBe('575px');
      });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('continues the parent bridge from the measured bottom of a rendered branch column', async () => {
    mockUseQuery.mockReturnValue({
      data: mockBranchingFlow,
      isLoading: false,
    });

    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('data-testid') === 'flow-board-content') return makeRect(0, 0, 1600, 1600);
      if (this.id === 'flow-subtree-question-node') return makeRect(200, 120, 272, 610);
      if (this.id === 'flow-subtree-start-node') return makeRect(200, 24, 272, 320);
      return makeRect(0, 0, 0, 0);
    });

    try {
      render(<FlowEditorPage />);

      await waitFor(() => {
        const bridge = screen.getByTestId('primary-branch-bridge-question-node') as HTMLElement;
        expect(bridge.style.top).toBe('730px');
        expect(bridge.style.height).toBe('102px');
      });
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('renders a dashed merge connector when multiple visible branches feed the same next node', async () => {
    mockUseQuery.mockReturnValue({
      data: mockSharedMergeFlow,
      isLoading: false,
    });

    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('data-testid') === 'flow-board-content') return makeRect(0, 0, 1600, 1800);
      if (this.id === 'flow-node-flag-a') return makeRect(120, 540, 272, 88);
      if (this.id === 'flow-node-flag-b') return makeRect(620, 540, 272, 88);
      if (this.id === 'flow-node-shared-question') return makeRect(120, 860, 272, 88);
      if (this.id === 'flow-subtree-flag-a') return makeRect(120, 540, 272, 460);
      if (this.id === 'flow-subtree-flag-b') return makeRect(620, 540, 272, 180);
      if (this.id === 'flow-subtree-shared-question') return makeRect(120, 860, 272, 220);
      return makeRect(0, 0, 0, 0);
    });

    try {
      render(<FlowEditorPage />);

      await waitFor(() => {
        expect(screen.getByTestId('merge-connector-line-shared-question')).toBeInTheDocument();
        expect(screen.getByTestId('merge-connector-source-flag-b-shared-question')).toBeInTheDocument();
        expect(screen.getByTestId('merge-connector-target-shared-question')).toBeInTheDocument();
        expect(screen.getByTestId('merge-connector-label-shared-question')).toHaveTextContent('Shared Next Step');
      });

      expect(screen.queryByText('Continues to:')).not.toBeInTheDocument();
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

  it('keeps legacy general intake branch questions collapsed by default on load', async () => {
    mockUseQuery.mockReturnValue({
      data: mockLegacyGeneralTemplateFlow,
      isLoading: false,
    });

    render(<FlowEditorPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('General Legal Intake - All Practice Areas')).toBeInTheDocument();
    });

    expect(screen.queryByText('Custody or visitation of my children')).not.toBeInTheDocument();
  });

  it('keeps an expanded node highlighted so it stays easy to track after opening', async () => {
    mockUseQuery.mockReturnValue({
      data: mockCollapsedBranchingFlow,
      isLoading: false,
    });

    render(<FlowEditorPage />);

    const questionNode = await waitFor(() => {
      const el = document.getElementById('flow-node-question-node');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });

    const expandButton = questionNode.querySelector('button');
    expect(expandButton).toBeTruthy();

    fireEvent.click(expandButton!);

    await waitFor(() => {
      expect(questionNode.getAttribute('data-highlighted')).toBe('true');
      expect(questionNode.style.outline).toContain('2px solid');
    });
  });

  it('keeps a collapsed node highlighted so it stays easy to track after closing', async () => {
    mockUseQuery.mockReturnValue({
      data: mockCollapsedBranchingFlow,
      isLoading: false,
    });

    render(<FlowEditorPage />);

    const questionNode = await waitFor(() => {
      const el = document.getElementById('flow-node-question-node');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });

    const expandButton = questionNode.querySelector('button');
    expect(expandButton).toBeTruthy();

    fireEvent.click(expandButton!);

    await waitFor(() => {
      expect(screen.getByTestId('response-node-title-response-yes')).toBeInTheDocument();
      expect(questionNode.getAttribute('data-highlighted')).toBe('true');
    });

    await new Promise((resolve) => setTimeout(resolve, 60));
    fireEvent.click(document.body);

    await waitFor(() => {
      expect(questionNode.getAttribute('data-highlighted')).toBeNull();
    });

    fireEvent.click(expandButton!);

    await waitFor(() => {
      expect(screen.queryByTestId('response-node-title-response-yes')).not.toBeInTheDocument();
      expect(questionNode.getAttribute('data-highlighted')).toBe('true');
      expect(questionNode.style.outline).toContain('2px solid');
    });
  });

  it('keeps general intake routing branches collapsed by default on first load', async () => {
    mockUseQuery.mockReturnValue({
      data: mockGeneralTemplateFlow,
      isLoading: false,
    });

    render(<FlowEditorPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('General Legal Intake - All Practice Areas')).toBeInTheDocument();
    });

    expect(screen.queryByText('Custody or visitation of my children')).not.toBeInTheDocument();
  });

});
