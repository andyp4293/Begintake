'use client';

import { useSession } from 'next-auth/react';
import { redirect, useParams } from 'next/navigation';
import { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Workflow, Save, Zap, ArrowLeft, Plus, Minus, Trash2, ChevronDown, ChevronRight, Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { CustomSelect } from '@/components/ui/CustomSelect';
import {
  CARD_WIDTH_PX,
  FALLBACK_LAYOUT,
  computePathToNode,
  computePrimaryParents,
  computeVisibleTreeMap,
  computeVisibleTreeLayouts,
  type FlowLayoutEdge as FEdge,
  type FlowLayoutNode as FNode,
  type TreeLayout,
  type VisibleTreeNodePlacement,
} from '@/lib/flow-tree-layout';
import {
  clampZoom,
  clampCameraToBoard,
  getCameraForPointFocus,
  getCameraForZoom,
  getCameraForNodeFocus,
  getCanvasMetrics,
  registerNonPassiveWheelListener,
} from '@/lib/flow-tree-canvas';

const NODE_COLORS: Record<string, string> = {
  start: '#22c55e', question: '#3b82f6', response: '#7c3aed',
  collect_info: '#a855f7', action: '#06b6d4',
  transfer: '#f97316', end: '#ef4444',
  // decision kept for backward compat with saved flows
  decision: '#f59e0b',
};
const NODE_LABELS: Record<string, string> = {
  start: 'Start', question: 'Question', response: 'Response',
  collect_info: 'Collect Info', action: 'Action', transfer: 'Transfer', end: 'End Call',
  // decision kept for backward compat
  decision: 'Question',
};

function generateId() { return `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

const CONNECTOR_COLOR = 'rgba(255, 255, 255, 0.88)';
const MERGE_CONNECTOR_COLOR = 'rgba(96, 165, 250, 0.96)';
const MERGE_CONNECTOR_GLOW = 'rgba(59, 130, 246, 0.28)';
const BOARD_PADDING_X_PX = 240;
const BOARD_PADDING_TOP_PX = 112;
const BOARD_PADDING_BOTTOM_PX = 180;
const ROOT_HEADER_HEIGHT_PX = 92;
const TREE_ROW_HEIGHT_PX = 360;
const TREE_FOOTER_HEIGHT_PX = 72;
const TREE_PARENT_BRIDGE_PX = 88;
const TREE_CONNECTOR_LINE_Y_PX = 20;
const TREE_CONNECTOR_ENDPOINT_TRIM_PX = 1;
const TREE_NODE_TOP_PX = 24;
const TREE_NODE_TOP_WITH_LABEL_PX = 72;
const TREE_BRANCH_LABEL_TOP_PX = 28;
const TREE_CHILD_STEM_HEIGHT_PX = 28;
const TREE_MERGE_RAIL_CLEARANCE_PX = 18;
const TREE_MERGE_RAIL_OFFSET_PX = 28;
const DEFAULT_ZOOM = 1;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.1;
const EXPANDED_SUBTREE_VIEWPORT_PADDING_PX = 96;
const EXPANDED_SUBTREE_NODE_ANCHOR_X_RATIO = 0.32;
const EXPANDED_SUBTREE_NODE_ANCHOR_Y_RATIO = 0.24;
const GENERAL_INTAKE_FLOW_NAMES = new Set([
  'General Legal Intake',
  'General Legal Intake - All Practice Areas',
]);
const GENERAL_INTAKE_SIGNATURE_LABELS = [
  'Family Law - Matter Triage',
  'IP - Matter Type',
  'Environmental - Matter Type',
];
const GENERAL_INTAKE_ALWAYS_EXPANDED_QUESTION_LABELS = new Set([
  'Q1. Shall we get started?',
  'Q1b. New or Existing Client?',
  'Q2. Caller Name',
  'Q3. Best Phone Number',
  'Q4. Self or On Behalf Of',
  "Q5. Tell Me What's Going On",
]);

function isGeneralIntakeFlow(flowName: string | undefined, flowNodes: FNode[]) {
  if (flowName && GENERAL_INTAKE_FLOW_NAMES.has(flowName)) return true;
  const nodeLabels = new Set(flowNodes.map((node) => node.label));
  return GENERAL_INTAKE_SIGNATURE_LABELS.every((label) => nodeLabels.has(label));
}

function applyGeneralIntakeCollapsedDefaults(flowName: string | undefined, flowNodes: FNode[]) {
  if (!isGeneralIntakeFlow(flowName, flowNodes)) return flowNodes;

  return flowNodes.map((node) => {
    if (node.type !== 'question') return node;
    if (GENERAL_INTAKE_ALWAYS_EXPANDED_QUESTION_LABELS.has(node.label)) return node;

    return {
      ...node,
      config: {
        ...node.config,
        defaultCollapsed: node.config?.defaultCollapsed ?? true,
      },
    };
  });
}

function getTreeRowTop(depth: number) {
  return ROOT_HEADER_HEIGHT_PX + (depth * TREE_ROW_HEIGHT_PX);
}

function getNodeStackTop(branchLabel: string | null) {
  return branchLabel ? TREE_NODE_TOP_WITH_LABEL_PX : TREE_NODE_TOP_PX;
}

// ─── Node card component ──────────────────────────────────────────────────

function NodeCard({
  node, edges, allNodes, branchLabel, primaryParents, confirm,
  mergedLinkedTargetIds,
  expandedNodeIds, expandedOverrides, showIncomingStem, showOutgoingStem, onToggleExpanded, onExpandPath, onFocusNode, onRevealToggledNode,
  onUpdateNode, onDeleteNode, onAddChild, onLinkExisting, onDeleteEdge,
}: {
  node: FNode; edges: FEdge[]; allNodes: FNode[];
  branchLabel: string | null; primaryParents: Map<string, string>;
  confirm: (opts: { title?: string; message: string; confirmLabel?: string; destructive?: boolean }) => Promise<boolean>;
  mergedLinkedTargetIds?: Set<string>;
  expandedNodeIds: Set<string>;
  expandedOverrides: Set<string>;
  showIncomingStem: boolean;
  showOutgoingStem: boolean;
  onToggleExpanded: (nodeId: string) => void;
  onExpandPath: (targetId: string) => void;
  onFocusNode: (targetId: string, behavior?: ScrollBehavior) => void;
  onRevealToggledNode: (targetId: string, expandedAfterToggle: boolean) => void;
  onUpdateNode: (id: string, updates: Partial<FNode>) => void;
  onDeleteNode: (id: string) => void;
  onAddChild: (parentId: string, type: string) => void;
  onLinkExisting: (parentId: string, targetId: string) => void;
  onDeleteEdge: (sourceId: string, targetId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [contentExpanded, setContentExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const check = () => setIsClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [node.config, contentExpanded]);

  const color = NODE_COLORS[node.type] || '#666';

  const childEdges = [...edges.filter((e) => e.sourceNodeId === node.id)].sort((a, b) => a.sortOrder - b.sortOrder);
  const childItems = childEdges.flatMap((edge) => {
    const childNode = allNodes.find((n) => n.id === edge.targetNodeId);
    return childNode ? [{ edge, childNode }] : [];
  });
  const primaryChildItems = childItems.filter(({ childNode }) => primaryParents.get(childNode.id) === node.id);
  const linkedChildItems = childItems.filter(({ childNode }) => (
    primaryParents.get(childNode.id) !== node.id
    && !mergedLinkedTargetIds?.has(childNode.id)
  ));

  const displayExpanded = expandedOverrides.has(node.id) || expandedNodeIds.has(node.id);

  const highlightNode = useCallback((targetId: string) => {
    const el = document.getElementById(`flow-node-${targetId}`);
    if (!el) return;

    document.querySelectorAll('[data-highlighted]').forEach((nodeEl) => {
      (nodeEl as HTMLElement).style.outline = '';
      (nodeEl as HTMLElement).style.borderRadius = '';
      (nodeEl as HTMLElement).style.boxShadow = '';
      (nodeEl as HTMLElement).removeAttribute('data-highlighted');
    });

    el.style.outline = '2px solid #22c55e';
    el.style.borderRadius = '16px';
    el.style.boxShadow = '0 0 0 4px rgba(34,197,94,0.2), 0 0 16px 4px rgba(34,197,94,0.25)';
    el.setAttribute('data-highlighted', 'true');

    setTimeout(() => {
      document.addEventListener('click', function dismiss() {
        el.style.outline = '';
        el.style.borderRadius = '';
        el.style.boxShadow = '';
        el.removeAttribute('data-highlighted');
        document.removeEventListener('click', dismiss);
      }, { once: true });
    }, 50);
  }, []);

  const focusAndHighlightNode = useCallback((targetId: string) => {
    onFocusNode(targetId, 'smooth');
    highlightNode(targetId);
  }, [highlightNode, onFocusNode]);

  return (
    <div
      id={`flow-subtree-${node.id}`}
      className="relative flex flex-col items-start"
      style={{
        width: `${CARD_WIDTH_PX}px`,
        paddingTop: `${branchLabel ? TREE_NODE_TOP_WITH_LABEL_PX : TREE_NODE_TOP_PX}px`,
      }}
    >
      {showIncomingStem && (
        <div
          className="pointer-events-none absolute w-px"
          style={{
            top: 0,
            left: '50%',
            height: `${branchLabel ? TREE_BRANCH_LABEL_TOP_PX : TREE_NODE_TOP_PX}px`,
            transform: 'translateX(-0.5px)',
            backgroundColor: CONNECTOR_COLOR,
          }}
        />
      )}
      {branchLabel && (
        <div
          data-testid={`primary-branch-label-${node.id}`}
          className="absolute left-0 flex w-full items-center justify-center"
          style={{ top: `${TREE_BRANCH_LABEL_TOP_PX}px` }}
        >
          <div
            data-overlap-audit="true"
            data-overlap-kind="branch-label"
            data-overlap-label={`Branch label: ${branchLabel}`}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-[10px] font-medium text-zinc-100"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-200" />
            <span className="truncate">{branchLabel}</span>
          </div>
        </div>
      )}
      <div className="flex w-full flex-col items-start">
        {/* Node card */}
        <div
          id={`flow-node-${node.id}`}
          data-overlap-audit="true"
          data-overlap-kind="node"
          data-overlap-label={node.label}
          className="rounded-2xl border border-zinc-800/90 bg-zinc-900/95 shadow-[0_20px_45px_-30px_rgba(0,0,0,0.9)]"
          style={{ width: `${CARD_WIDTH_PX}px`, maxWidth: `${CARD_WIDTH_PX}px`, borderLeftColor: color, borderLeftWidth: 3 }}
        >
          <div className="flex items-center gap-2 px-3 py-2">
            <button onClick={() => {
              if (childEdges.length === 0) return;
              const expandedAfterToggle = !displayExpanded;
              onToggleExpanded(node.id);
              highlightNode(node.id);
              onRevealToggledNode(node.id, expandedAfterToggle);
            }} className="text-zinc-500 hover:text-white flex-shrink-0">
              {childEdges.length > 0 ? (displayExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : <span className="w-3" />}
            </button>
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0" style={{ color, backgroundColor: `${color}15` }}>
              {NODE_LABELS[node.type] ?? node.type}
            </span>
            {node.type === 'response' ? (
              <div className="min-w-0 flex-1" />
            ) : (
              <input
                type="text"
                value={node.label}
                onChange={(e) => onUpdateNode(node.id, { label: e.target.value })}
                maxLength={60}
                className="min-w-0 flex-1 bg-transparent px-1 text-xs text-white focus:outline-none border-b border-transparent focus:border-zinc-600"
              />
            )}
            {childEdges.length > 0 && !displayExpanded && (
              <span className="text-[9px] text-zinc-400 flex-shrink-0">{childEdges.length} branch{childEdges.length > 1 ? 'es' : ''}</span>
            )}
            <button onClick={() => setEditing(!editing)} className="text-[10px] text-zinc-300 hover:text-white px-1 flex-shrink-0">{editing ? 'Done' : 'Edit'}</button>
            {node.type !== 'start' && (
              <button onClick={async () => {
                const ok = await confirm({ title: 'Delete Step', message: `Delete "${node.label}"? This will also remove any steps connected only to this one.`, confirmLabel: 'Delete', destructive: true });
                if (ok) onDeleteNode(node.id);
              }} className="text-zinc-600 hover:text-red-400 flex-shrink-0"><Trash2 className="w-3 h-3" /></button>
            )}
          </div>

          {/* Content preview */}
          {!editing && node.type === 'response' ? (
            <div className="px-3 pb-3">
              <p
                data-testid={`response-node-title-${node.id}`}
                className="text-xs font-medium leading-snug text-white break-words"
              >
                {node.label}
              </p>
            </div>
          ) : !editing && (
            <div className="px-3 pb-2 space-y-1 overflow-hidden text-xs">
              <div ref={contentRef} className={contentExpanded ? '' : 'line-clamp-2'}>
                {(node.type === 'start' || node.type === 'transfer') && (node.config?.greeting || node.config?.callbackMessage || node.config?.message) && (
                  <p className="text-[11px] text-zinc-300 italic leading-relaxed">{node.config?.greeting || node.config?.callbackMessage || node.config?.message}</p>
                )}
                {node.type === 'question' && (
                  <>
                    {!node.config?.question && !node.config?.note && (
                      <p className="text-[10px] text-red-400/80">Requires a verbatim question or AI guidance.</p>
                    )}
                    {node.config?.question && <p className="text-[11px] text-zinc-300 italic">"{node.config.question}"</p>}
                    {node.config?.note && <p className="text-[10px] text-amber-400 leading-relaxed">{node.config.note}</p>}
                    {node.config?.collectFields?.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        <span className="text-[9px] text-zinc-400 mr-0.5">Collect:</span>
                        {node.config.collectFields.map((f: any, i: number) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 bg-purple-900/20 border border-purple-900/30 rounded text-purple-400/70">{f.label || f.name}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {node.type === 'decision' && (node.config?.description || node.config?.note) && (
                  <p className="text-[11px] text-zinc-300 italic">"{node.config.description || node.config.note}"</p>
                )}
                {node.type === 'action' && (
                  <>
                    <p className="text-[10px] text-zinc-300">
                      {(!node.config?.actionType || node.config.actionType === 'set_flag') && (node.config?.flagValue || node.config?.petitionType) && (
                        <><span className="text-zinc-400">Set:</span> {node.config.flagName ? `${node.config.flagName} = ` : ''}{node.config.flagValue || node.config.petitionType}</>
                      )}
                      {node.config?.actionType === 'book_appointment' && <span className="text-zinc-400">Book Appointment</span>}
                      {node.config?.actionType === 'call_tool' && <><span className="text-zinc-400">Call tool:</span> {node.config.toolName}</>}
                      {node.config?.actionType === 'send_email' && <span className="text-zinc-400">Send Email</span>}
                    </p>
                    {node.config?.note && <p className="text-[10px] text-amber-400">{node.config.note}</p>}
                  </>
                )}
                {node.type === 'collect_info' && (
                  <>
                    {node.config?.question && <p className="text-[11px] text-zinc-300 italic">"{node.config.question}"</p>}
                    {node.config?.fields?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {node.config.fields.map((f: any, i: number) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-500">{f.label || f.name}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {node.type === 'end' && node.config?.closingMessage && (
                  <p className="text-[11px] text-zinc-300 italic">"{node.config.closingMessage}"</p>
                )}
              </div>
              {(isClamped || contentExpanded) && (
                <button
                  onClick={() => setContentExpanded(!contentExpanded)}
                  className="text-[9px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {contentExpanded ? '▲ show less' : '▼ show more'}
                </button>
              )}
            </div>
          )}

          {/* Config editor */}
          {editing && (
            <div className="px-3 pb-3 space-y-3 border-t border-zinc-800 pt-2">
            {(node.type === 'start' || node.type === 'transfer') && (
              <>
                {node.type === 'transfer' && (
                  <div>
                    <label className="block text-[10px] font-medium text-zinc-400 mb-1">Transfer to</label>
                    <CustomSelect
                      value={node.config?.transferTarget || 'attorney'}
                      options={[
                        { value: 'attorney', label: 'Best matched specialist' },
                        { value: 'paralegal', label: 'Front desk / operations line' },
                      ]}
                      onChange={(v) => onUpdateNode(node.id, { config: { ...node.config, transferTarget: v } })}
                    />
                  </div>
                )}
                {node.type === 'transfer' && (
                  <div>
                    <label className="block text-[10px] font-medium text-zinc-400 mb-1">Handoff mode</label>
                    <CustomSelect
                      value={node.config?.handoffMode || 'summary_only'}
                      options={[
                        { value: 'summary_only', label: 'Summary only (team follows up later)' },
                        { value: 'live_transfer', label: 'Live transfer (future option)' },
                      ]}
                      onChange={(v) => onUpdateNode(node.id, { config: { ...node.config, handoffMode: v } })}
                    />
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-medium text-zinc-400 mb-1">
                    {node.type === 'start'
                      ? 'Opening greeting'
                      : node.config?.handoffMode === 'live_transfer'
                        ? 'Live handoff message'
                        : 'Callback message'}
                  </label>
                  <textarea value={node.config?.greeting || node.config?.callbackMessage || node.config?.message || ''}
                    onChange={(e) => {
                      const key = node.type === 'start'
                        ? 'greeting'
                        : node.config?.handoffMode === 'live_transfer'
                          ? 'message'
                          : 'callbackMessage';
                      onUpdateNode(node.id, { config: { ...node.config, [key]: e.target.value } });
                    }}
                    rows={3}
                    className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none resize-none" />
                  <p className="text-[9px] text-zinc-500 mt-1">Use <span className="font-mono text-zinc-400">{'{name}'}</span> for assistant name and <span className="font-mono text-zinc-400">{'{firm}'}</span> for your organization name.</p>
                </div>
              </>
            )}
            {node.type === 'question' && (
              <>
                {!node.config?.question && !node.config?.note && (
                  <p className="text-[10px] text-red-400/80">At least one field is required.</p>
                )}
                <div>
                  <label className="block text-[10px] font-medium text-zinc-400 mb-1">Verbatim question <span className="text-zinc-600 font-normal">(exact words the AI says)</span></label>
                  <textarea value={node.config?.question || ''}
                    onChange={(e) => onUpdateNode(node.id, { config: { ...node.config, question: e.target.value } })}
                    rows={2} className={`w-full px-2 py-1 bg-zinc-800 rounded text-xs text-white focus:outline-none resize-none border ${!node.config?.question && !node.config?.note ? 'border-red-500/40' : 'border-zinc-700'}`} />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-amber-500/80 mb-1">AI guidance <span className="text-zinc-600 font-normal">(instructions for how to ask, not scripted)</span></label>
                  <textarea value={node.config?.note || ''}
                    onChange={(e) => onUpdateNode(node.id, { config: { ...node.config, note: e.target.value } })}
                    rows={2} className={`w-full px-2 py-1 bg-zinc-800 rounded text-[11px] text-amber-400 placeholder:text-zinc-600 focus:outline-none resize-none border ${!node.config?.question && !node.config?.note ? 'border-red-500/40' : 'border-zinc-700'}`} />
                </div>
                <p className="text-[9px] text-zinc-500">Add <span className="text-zinc-400">Response</span> child nodes below for each possible answer.</p>
                <div className="space-y-2 pt-2 border-t border-zinc-700/50">
                  <label className="text-[10px] font-medium text-zinc-400">Fields to collect <span className="text-zinc-600 font-normal">(optional — data to capture from this step)</span></label>
                  {(node.config?.collectFields || []).map((field: any, i: number) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="text" value={field.label || ''} placeholder="e.g. Full name, Best phone number…"
                        onChange={(e) => {
                          const cf = [...(node.config?.collectFields || [])];
                          cf[i] = { ...cf[i], label: e.target.value, name: e.target.value.toLowerCase().replace(/\s+/g, '_') };
                          onUpdateNode(node.id, { config: { ...node.config, collectFields: cf } });
                        }}
                        className="flex-1 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[11px] text-white focus:outline-none" />
                      <button onClick={() => {
                        const cf = (node.config?.collectFields || []).filter((_: any, j: number) => j !== i);
                        onUpdateNode(node.id, { config: { ...node.config, collectFields: cf } });
                      }} className="text-zinc-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  ))}
                  <button onClick={() => {
                    const cf = [...(node.config?.collectFields || []), { name: `field_${Date.now()}`, label: '', type: 'text', required: true }];
                    onUpdateNode(node.id, { config: { ...node.config, collectFields: cf } });
                  }} className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white transition-colors">
                    <Plus className="w-3 h-3" /> Add field to collect
                  </button>
                </div>
              </>
            )}
            {node.type === 'response' && (
              <div>
                <label className="block text-[10px] font-medium text-zinc-400 mb-1">Caller response label <span className="text-zinc-600 font-normal">(describe their intent, not exact words)</span></label>
                <input type="text" value={node.config?.response || ''}
                  onChange={(e) => onUpdateNode(node.id, { label: e.target.value, config: { ...node.config, response: e.target.value } })}
                  className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none" />
                <p className="text-[9px] text-zinc-500 mt-1">e.g. &ldquo;Wants to talk now&rdquo; — not &ldquo;Yes connect me please&rdquo;</p>
              </div>
            )}
            {node.type === 'decision' && (
              <div>
                <label className="block text-[10px] font-medium text-zinc-400 mb-1">Routing guidance</label>
                <textarea value={node.config?.description || node.config?.note || ''} placeholder="Question or routing guidance..."
                  onChange={(e) => onUpdateNode(node.id, { config: { ...node.config, description: e.target.value, note: e.target.value } })}
                  rows={2} className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none resize-none" />
              </div>
            )}
            {node.type === 'action' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-medium text-zinc-400 mb-1">Action type</label>
                  <CustomSelect
                    value={node.config?.actionType || 'set_flag'}
                    onChange={(v) => onUpdateNode(node.id, { config: { ...node.config, actionType: v } })}
                    options={[
                      { value: 'set_flag',          label: 'Set Flag' },
                      { value: 'book_appointment',  label: 'Book Appointment' },
                      { value: 'call_tool',         label: 'Call Tool' },
                      { value: 'send_email',        label: 'Send Email' },
                    ]}
                  />
                </div>
                {(!node.config?.actionType || node.config.actionType === 'set_flag') && (
                  <>
                    <div>
                      <label className="block text-[10px] font-medium text-zinc-400 mb-1">Flag name <span className="text-zinc-600 font-normal">(internal key)</span></label>
                      <input type="text" value={node.config?.flagName || ''}
                        onChange={(e) => onUpdateNode(node.id, { config: { ...node.config, flagName: e.target.value } })}
                        className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-zinc-400 mb-1">Flag value <span className="text-zinc-600 font-normal">(what it gets set to)</span></label>
                      <input type="text" value={node.config?.flagValue || node.config?.petitionType || ''}
                        onChange={(e) => onUpdateNode(node.id, { config: { ...node.config, flagValue: e.target.value, petitionType: e.target.value } })}
                        className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none" />
                    </div>
                  </>
                )}
                {node.config?.actionType === 'call_tool' && (
                  <div>
                    <label className="block text-[10px] font-medium text-zinc-400 mb-1">Tool name</label>
                    <input type="text" value={node.config?.toolName || ''}
                      onChange={(e) => onUpdateNode(node.id, { config: { ...node.config, toolName: e.target.value } })}
                      className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none" />
                  </div>
                )}
                {node.config?.actionType === 'book_appointment' && (
                  <p className="text-[10px] text-zinc-400">Calls the bookAppointment tool with collected caller data and confirms the date/time.</p>
                )}
                {node.config?.actionType === 'send_email' && (
                  <p className="text-[10px] text-zinc-400">Sends an email summary to the matched owner or specialist.</p>
                )}
                <div>
                  <label className="block text-[10px] font-medium text-zinc-400 mb-1">Internal note <span className="text-zinc-600 font-normal">(optional, not seen by AI)</span></label>
                  <textarea value={node.config?.note || ''}
                    rows={2}
                    onChange={(e) => onUpdateNode(node.id, { config: { ...node.config, note: e.target.value } })}
                    className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[11px] text-zinc-400 focus:outline-none focus:text-white resize-none" />
                </div>
              </div>
            )}
            {node.type === 'collect_info' && (
              <div className="space-y-2">
                <div>
                  <label className="block text-[10px] font-medium text-zinc-400 mb-1">Question to ask <span className="text-zinc-600 font-normal">(optional)</span></label>
                  <textarea value={node.config?.question || ''}
                    onChange={(e) => onUpdateNode(node.id, { config: { ...node.config, question: e.target.value } })}
                    rows={2} className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none resize-none" />
                </div>
                <label className="block text-[10px] font-medium text-zinc-400">Fields to collect</label>
                {(node.config?.fields || []).map((field: any, i: number) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="text" value={field.label || ''} placeholder="Field label"
                      onChange={(e) => {
                        const fields = [...(node.config?.fields || [])];
                        fields[i] = { ...fields[i], label: e.target.value, name: e.target.value.toLowerCase().replace(/\s+/g, '_') };
                        onUpdateNode(node.id, { config: { ...node.config, fields } });
                      }}
                      className="flex-1 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-[11px] text-white focus:outline-none" />
                    <button onClick={() => {
                      const fields = (node.config?.fields || []).filter((_: any, j: number) => j !== i);
                      onUpdateNode(node.id, { config: { ...node.config, fields } });
                    }} className="text-zinc-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
                <button onClick={() => {
                  const fields = [...(node.config?.fields || []), { name: `field_${Date.now()}`, label: '', type: 'text', required: true }];
                  onUpdateNode(node.id, { config: { ...node.config, fields } });
                }} className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white transition-colors">
                  <Plus className="w-3 h-3" /> Add field
                </button>
              </div>
            )}
            {node.type === 'end' && (
              <div>
                <label className="block text-[10px] font-medium text-zinc-400 mb-1">Closing message <span className="text-zinc-600 font-normal">(what the AI says before ending the call)</span></label>
                <input type="text" value={node.config?.closingMessage || ''}
                  onChange={(e) => onUpdateNode(node.id, { config: { ...node.config, closingMessage: e.target.value } })}
                  className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none" />
              </div>
            )}
            </div>
          )}
        </div>

        {/* Add child */}
        {displayExpanded && node.type !== 'end' && node.type !== 'transfer' && (
          <div className="mt-3 w-full px-2" style={{ maxWidth: `${CARD_WIDTH_PX}px` }}>
            <AddNodeMenu
              parentId={node.id} parentLabel={node.label} parentType={node.type}
              allNodes={allNodes} currentNodeId={node.id}
              onAdd={onAddChild} onLinkExisting={onLinkExisting}
            />
          </div>
        )}

        {/* Linked children */}
        {displayExpanded && linkedChildItems.length > 0 && (
          <div className="mt-8 flex w-full flex-col items-center gap-3 px-2" style={{ maxWidth: `${CARD_WIDTH_PX}px` }}>
            <div className="h-5 w-px bg-zinc-200" />
            <span className="text-[9px] font-semibold uppercase tracking-[0.28em] text-zinc-500">Linked Steps</span>
            <div className="flex w-full flex-col items-stretch gap-2">
              {linkedChildItems.map(({ edge, childNode }) => (
                <div
                  key={`${edge.sourceNodeId}-${edge.targetNodeId}`}
                  data-overlap-audit="true"
                  data-overlap-kind="linked-step"
                  data-overlap-label={`Linked step: ${childNode.label}`}
                  className="group/jump flex w-full items-center gap-2 rounded-2xl border border-dashed border-zinc-700/80 bg-zinc-900/70 px-3 py-2"
                >
                  <Link2 className="w-3 h-3 text-zinc-600 shrink-0" />
                  <span className="text-[10px] text-zinc-300 shrink-0">Continues to:</span>
                  <button
                    onClick={() => {
                      // Expand all nodes on the path so the target is visible, then scroll
                      onExpandPath(childNode.id);
                      setTimeout(() => {
                        focusAndHighlightNode(childNode.id);
                      }, 150);
                    }}
                    className="min-w-0 truncate text-left text-[10px] font-medium text-blue-400 underline-offset-2 transition-colors hover:text-blue-300 hover:underline"
                  >
                    {childNode.label}
                  </button>
                  <button onClick={async () => {
                    const ok = await confirm({ title: 'Remove Link', message: `Remove the link to "${childNode.label}"?`, confirmLabel: 'Remove', destructive: true });
                    if (ok) onDeleteEdge(edge.sourceNodeId, edge.targetNodeId);
                  }} className="text-zinc-700 hover:text-red-400 opacity-0 group-hover/jump:opacity-100 transition-opacity shrink-0">
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* End-of-flow indicator for terminal nodes */}
        {(node.type === 'end' || node.type === 'transfer') && (
          <div className="mt-4 mb-2 flex min-w-[14rem] items-center gap-3">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-zinc-700 to-transparent" />
            <div className="flex items-center gap-1.5 rounded-full border border-zinc-700/60 bg-zinc-900/80 px-2.5 py-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[9px] font-medium tracking-wide text-zinc-500 uppercase">
                {node.type === 'transfer' ? 'End of flow — transfers call' : 'End of flow'}
              </span>
            </div>
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-zinc-700 to-transparent" />
          </div>
        )}
        {showOutgoingStem && (
          <div className="pointer-events-none mt-6 flex w-full justify-center">
            <div className="w-px" style={{ height: `${TREE_CHILD_STEM_HEIGHT_PX}px`, backgroundColor: CONNECTOR_COLOR }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Add node menu ────────────────────────────────────────────────────────

function AddNodeMenu({ parentId, parentLabel, parentType, allNodes, currentNodeId, onAdd, onLinkExisting }: {
  parentId: string;
  parentLabel: string;
  parentType: string;
  allNodes: FNode[];
  currentNodeId: string;
  onAdd: (parentId: string, type: string) => void;
  onLinkExisting: (parentId: string, targetId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [showLinkPicker, setShowLinkPicker] = useState(false);

  const shortParent = parentLabel.length > 25 ? parentLabel.slice(0, 25) + '...' : parentLabel;

  // Questions can only branch via Response nodes
  const isQuestion = parentType === 'question';

  const linkableNodes = allNodes.filter((n) => n.id !== currentNodeId && n.type !== 'start');
  const filteredNodes = linkSearch
    ? linkableNodes.filter((n) => n.label.toLowerCase().includes(linkSearch.toLowerCase()))
    : linkableNodes;

  return (
    <div className="relative block w-full">
      <button onClick={() => { setOpen(!open); setShowLinkPicker(false); setLinkSearch(''); }}
        data-overlap-audit="true"
        data-overlap-kind="add-step"
        data-overlap-label={`Add step under ${parentLabel}`}
        className="flex w-full items-center gap-1 overflow-hidden px-2 py-1 text-left text-[10px] text-zinc-400 transition-colors hover:text-white">
        <Plus className="w-3 h-3 shrink-0" />
        <span className="block min-w-0 truncate">Add step under <span className="text-zinc-300 ml-0.5">{shortParent}</span></span>
      </button>
      {open && (
        <div className="absolute left-1/2 z-10 mt-1 w-56 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 p-2 shadow-xl">
          {!showLinkPicker ? (
            <>
              {isQuestion && (
                <p className="text-[9px] text-zinc-400 px-2 pb-1.5">Questions branch through Response nodes only.</p>
              )}
              {Object.entries(NODE_LABELS)
                .filter(([type]) => {
                  if (type === 'start' || type === 'collect_info' || type === 'decision') return false;
                  if (isQuestion) return type === 'response';
                  return true;
                })
                .map(([type, label]) => (
                  <button key={type} onClick={() => { onAdd(parentId, type); setOpen(false); }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 rounded transition-colors">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: NODE_COLORS[type] }} /> {label}
                  </button>
                ))}
              {!isQuestion && (
                <div className="border-t border-zinc-800 mt-1 pt-1">
                  <button onClick={() => setShowLinkPicker(true)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-zinc-300 hover:text-white hover:bg-zinc-800 rounded transition-colors">
                    <Link2 className="w-3 h-3" /> Link to existing step
                  </button>
                </div>
              )}
              <button onClick={() => setOpen(false)} className="w-full mt-1 text-[10px] text-zinc-400 hover:text-white py-1">Cancel</button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5 mb-2">
                <button onClick={() => setShowLinkPicker(false)} className="text-zinc-300 hover:text-white text-[10px]">← Back</button>
                <span className="text-[10px] text-zinc-300">Link to existing step</span>
              </div>
              <input type="text" value={linkSearch} onChange={(e) => setLinkSearch(e.target.value)}
                placeholder="Search steps..." autoFocus
                className="w-full px-2 py-1 mb-1 bg-zinc-800 border border-zinc-700 rounded text-[10px] text-white focus:outline-none" />
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {filteredNodes.length === 0 && (
                  <p className="text-[10px] text-zinc-400 px-2 py-1">No steps found</p>
                )}
                {filteredNodes.map((n) => (
                  <button key={n.id} onClick={() => { onLinkExisting(parentId, n.id); setOpen(false); setLinkSearch(''); }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-zinc-800 rounded transition-colors">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: NODE_COLORS[n.type] || '#666' }} />
                    <span className="text-[10px] text-zinc-300 truncate">{n.label}</span>
                    <span className="text-[9px] text-zinc-400 shrink-0 ml-auto">{NODE_LABELS[n.type] ?? n.type}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => setOpen(false)} className="w-full mt-1 text-[10px] text-zinc-400 hover:text-white py-1 border-t border-zinc-800 pt-1">Cancel</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────

export default function FlowEditorPage() {
  const { data: session, status } = useSession();
  const params = useParams();
  const confirm = useConfirm();
  const flowId = params.id as string;
  const canvasRef = useRef<HTMLDivElement>(null);
  const boardContentRef = useRef<HTMLDivElement>(null);
  const hasCenteredInitialViewRef = useRef(false);
  const panStateRef = useRef<{ pointerId: number; startX: number; startY: number; startCameraX: number; startCameraY: number } | null>(null);
  const canvasGeometryRef = useRef({
    viewportWidth: 0,
    viewportHeight: 0,
    contentOffsetX: 0,
    contentOffsetY: 0,
    scaledBoardWidth: 0,
    scaledBoardHeight: 0,
    zoom: DEFAULT_ZOOM,
  });
  const latestRevealRequestRef = useRef(0);
  const [flowName, setFlowName] = useState('');
  const [nodes, setNodes] = useState<FNode[]>([]);
  const [edges, setEdges] = useState<FEdge[]>([]);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const [expandedOverrides, setExpandedOverrides] = useState<Set<string>>(new Set());
  const [isPanningCanvas, setIsPanningCanvas] = useState(false);
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
  const [connectorStartYByNodeId, setConnectorStartYByNodeId] = useState<Map<string, number>>(new Map());
  const [subtreeBottomYByNodeId, setSubtreeBottomYByNodeId] = useState<Map<string, number>>(new Map());
  const [nodeFrameByNodeId, setNodeFrameByNodeId] = useState<Map<string, { left: number; right: number; top: number; bottom: number }>>(new Map());

  const { data: flow, isLoading } = useQuery({
    queryKey: ['flow', flowId],
    queryFn: async () => {
      const res = await fetch(`/api/flows/${flowId}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!flowId,
  });

  useEffect(() => {
    if (flow) {
      const nextNodes = applyGeneralIntakeCollapsedDefaults(
        flow.name,
        flow.nodes.map((n: any) => ({ id: n.id, type: n.type, label: n.label, config: n.config || {}, sortOrder: n.sortOrder })),
      );
      setFlowName(flow.name);
      setNodes(nextNodes);
      setEdges(flow.edges.map((e: any) => ({ sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, label: e.label, condition: e.condition, sortOrder: e.sortOrder })));
      setExpandedNodeIds(new Set(nextNodes.filter((n: FNode) => !n.config?.defaultCollapsed).map((n: FNode) => n.id)));
    }
  }, [flow]);

  const incomingIds = new Set(edges.map((e) => e.targetNodeId));
  const rootNode = nodes.find((n) => !incomingIds.has(n.id)) || nodes[0];
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const primaryParents = useMemo(() => {
    if (!rootNode) return new Map<string, string>();
    return computePrimaryParents(rootNode.id, edges);
  }, [rootNode?.id, edges]);

  const expandPathToNode = useCallback((targetId: string) => {
    const path = computePathToNode(targetId, primaryParents);
    setExpandedOverrides(new Set(path));
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      path.forEach((id) => next.add(id));
      return next;
    });
  }, [primaryParents]);

  const toggleExpanded = useCallback((nodeId: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const treeLayouts = useMemo(() => {
    if (!rootNode) return new Map<string, TreeLayout>();
    return computeVisibleTreeLayouts(rootNode.id, edges, primaryParents, expandedNodeIds, expandedOverrides);
  }, [rootNode?.id, edges, primaryParents, expandedNodeIds, expandedOverrides]);

  const visibleTree = useMemo(() => {
    if (!rootNode) {
      return {
        nodes: [] as VisibleTreeNodePlacement[],
        rows: new Map<number, VisibleTreeNodePlacement[]>(),
        maxDepth: 0,
      };
    }

    return computeVisibleTreeMap(rootNode.id, edges, primaryParents, treeLayouts, expandedNodeIds, expandedOverrides);
  }, [rootNode?.id, edges, primaryParents, treeLayouts, expandedNodeIds, expandedOverrides]);

  const visibleChildrenByParent = useMemo(() => {
    const childrenByParent = new Map<string, VisibleTreeNodePlacement[]>();

    for (const placement of visibleTree.nodes) {
      if (!placement.parentId) continue;
      if (!childrenByParent.has(placement.parentId)) childrenByParent.set(placement.parentId, []);
      childrenByParent.get(placement.parentId)!.push(placement);
    }

    for (const [parentId, placements] of childrenByParent) {
      childrenByParent.set(parentId, placements.sort(
        (a, b) => a.centerX - b.centerX || a.nodeId.localeCompare(b.nodeId),
      ));
    }

    return childrenByParent;
  }, [visibleTree]);

  const branchLabelByNodeId = useMemo(() => {
    const labels = new Map<string, string | null>();

    for (const placement of visibleTree.nodes) {
      if (!placement.parentId || !placement.incomingEdge) {
        labels.set(placement.nodeId, null);
        continue;
      }

      const node = nodeById.get(placement.nodeId);
      const parentNode = nodeById.get(placement.parentId);
      const branchLabel = node?.type === 'response'
        ? null
        : placement.incomingEdge.label
          || placement.incomingEdge.condition
          || (parentNode?.type === 'question' ? node?.config?.response ?? null : null);

      labels.set(placement.nodeId, branchLabel ?? null);
    }

    return labels;
  }, [nodeById, visibleTree]);

  const visiblePlacementByNodeId = useMemo(() => {
    return new Map(visibleTree.nodes.map((placement) => [placement.nodeId, placement]));
  }, [visibleTree]);

  const visibleMergeGroups = useMemo(() => {
    const groups = new Map<string, { targetPlacement: VisibleTreeNodePlacement; sourcePlacements: VisibleTreeNodePlacement[] }>();

    for (const edge of [...edges].sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (primaryParents.get(edge.targetNodeId) === edge.sourceNodeId) continue;
      const sourcePlacement = visiblePlacementByNodeId.get(edge.sourceNodeId);
      const targetPlacement = visiblePlacementByNodeId.get(edge.targetNodeId);
      if (!sourcePlacement || !targetPlacement) continue;

      if (!groups.has(edge.targetNodeId)) {
        groups.set(edge.targetNodeId, {
          targetPlacement,
          sourcePlacements: [],
        });
      }

      const group = groups.get(edge.targetNodeId)!;
      if (!group.sourcePlacements.some((placement) => placement.nodeId === sourcePlacement.nodeId)) {
        group.sourcePlacements.push(sourcePlacement);
      }
    }

    return [...groups.values()].map((group) => ({
      ...group,
      sourcePlacements: [...group.sourcePlacements].sort(
        (a, b) => a.centerX - b.centerX || a.nodeId.localeCompare(b.nodeId),
      ),
    }));
  }, [edges, primaryParents, visiblePlacementByNodeId]);

  const mergedLinkedTargetIdsBySource = useMemo(() => {
    const targetsBySource = new Map<string, Set<string>>();

    visibleMergeGroups.forEach((group) => {
      group.sourcePlacements.forEach((placement) => {
        if (!targetsBySource.has(placement.nodeId)) targetsBySource.set(placement.nodeId, new Set());
        targetsBySource.get(placement.nodeId)!.add(group.targetPlacement.nodeId);
      });
    });

    return targetsBySource;
  }, [visibleMergeGroups]);

  const rootLayout = rootNode ? (treeLayouts.get(rootNode.id) ?? FALLBACK_LAYOUT) : FALLBACK_LAYOUT;
  const boardContentHeight = rootNode
    ? getTreeRowTop(visibleTree.maxDepth + 1) + TREE_FOOTER_HEIGHT_PX
    : ROOT_HEADER_HEIGHT_PX + TREE_FOOTER_HEIGHT_PX;
  const boardContentWidth = Math.max(contentSize.width, rootLayout.width);
  const canvasMetrics = useMemo(() => getCanvasMetrics({
    viewportWidth: viewportSize.width,
    viewportHeight: viewportSize.height,
    contentWidth: boardContentWidth,
    contentHeight: Math.max(contentSize.height, boardContentHeight),
    paddingX: BOARD_PADDING_X_PX,
    paddingTop: BOARD_PADDING_TOP_PX,
    paddingBottom: BOARD_PADDING_BOTTOM_PX,
  }), [boardContentHeight, boardContentWidth, contentSize.height, viewportSize.height, viewportSize.width]);
  const {
    boardWidth,
    boardHeight,
    contentOffsetX,
    contentOffsetY,
  } = canvasMetrics;
  const scaledBoardWidth = boardWidth * zoom;
  const scaledBoardHeight = boardHeight * zoom;

  useEffect(() => {
    canvasGeometryRef.current = {
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height,
      contentOffsetX,
      contentOffsetY,
      scaledBoardWidth,
      scaledBoardHeight,
      zoom,
    };
  }, [contentOffsetX, contentOffsetY, scaledBoardHeight, scaledBoardWidth, viewportSize.height, viewportSize.width, zoom]);

  const clampCamera = useCallback((x: number, y: number) => {
    return clampCameraToBoard(
      { x, y },
      viewportSize.width,
      viewportSize.height,
      scaledBoardWidth,
      scaledBoardHeight,
    );
  }, [scaledBoardHeight, scaledBoardWidth, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    hasCenteredInitialViewRef.current = false;
    setZoom(DEFAULT_ZOOM);
    setCamera({ x: 0, y: 0 });
  }, [flowId]);

  useEffect(() => {
    const viewportEl = canvasRef.current;
    const contentEl = boardContentRef.current;
    if (!viewportEl || !contentEl) return;

    const updateMeasurements = () => {
      setViewportSize({ width: viewportEl.clientWidth, height: viewportEl.clientHeight });
      setContentSize({
        width: Math.max(contentEl.offsetWidth, contentEl.scrollWidth),
        height: Math.max(contentEl.offsetHeight, contentEl.scrollHeight),
      });
    };

    updateMeasurements();

    const ro = new ResizeObserver(updateMeasurements);
    ro.observe(viewportEl);
    ro.observe(contentEl);

    return () => ro.disconnect();
  }, [nodes.length, treeLayouts]);

  useLayoutEffect(() => {
    const contentEl = boardContentRef.current;
    if (!contentEl || !rootNode) return;

    let cancelled = false;
    const frameId = requestAnimationFrame(() => {
      if (cancelled) return;
      const contentRect = contentEl.getBoundingClientRect();
      const next = new Map<string, number>();
      const nextSubtreeBottoms = new Map<string, number>();
      const nextNodeFrames = new Map<string, { left: number; right: number; top: number; bottom: number }>();

      for (const placement of visibleTree.nodes) {
        const childPlacements = visibleChildrenByParent.get(placement.nodeId) || [];
        const nodeEl = document.getElementById(`flow-node-${placement.nodeId}`);
        if (nodeEl) {
          const nodeRect = nodeEl.getBoundingClientRect();
          nextNodeFrames.set(placement.nodeId, {
            left: (nodeRect.left - contentRect.left) / zoom,
            right: (nodeRect.right - contentRect.left) / zoom,
            top: (nodeRect.top - contentRect.top) / zoom,
            bottom: (nodeRect.bottom - contentRect.top) / zoom,
          });
        }

        const subtreeEl = document.getElementById(`flow-subtree-${placement.nodeId}`);
        if (subtreeEl) {
          const subtreeRect = subtreeEl.getBoundingClientRect();
          const subtreeBottom = Math.max((subtreeRect.bottom - contentRect.top) / zoom, getTreeRowTop(placement.depth));
          nextSubtreeBottoms.set(placement.nodeId, subtreeBottom);
          if (childPlacements.length > 0) next.set(placement.nodeId, subtreeBottom);
        }
      }

      setConnectorStartYByNodeId(next);
      setSubtreeBottomYByNodeId(nextSubtreeBottoms);
      setNodeFrameByNodeId(nextNodeFrames);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [rootNode, visibleTree, visibleChildrenByParent, zoom, expandedNodeIds, expandedOverrides, nodes, edges]);

  const focusNodeInCanvas = useCallback((targetId: string, _behavior: ScrollBehavior = 'smooth') => {
    const viewportEl = canvasRef.current;
    const contentEl = boardContentRef.current;
    const nodeEl = document.getElementById(`flow-node-${targetId}`);
    if (!viewportEl || !contentEl || !nodeEl || !viewportSize.width || !viewportSize.height) return;

    const contentRect = contentEl.getBoundingClientRect();
    const nodeRect = nodeEl.getBoundingClientRect();
    const nodeCenterX = (contentOffsetX * zoom) + (nodeRect.left - contentRect.left) + (nodeRect.width / 2);
    const nodeCenterY = (contentOffsetY * zoom) + (nodeRect.top - contentRect.top) + (nodeRect.height / 2);
    setCamera(getCameraForNodeFocus({
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height,
      nodeCenterX,
      nodeCenterY,
      boardWidth: scaledBoardWidth,
      boardHeight: scaledBoardHeight,
    }));
  }, [contentOffsetX, contentOffsetY, scaledBoardHeight, scaledBoardWidth, viewportSize.height, viewportSize.width, zoom]);

  const focusNodeAtCurrentMetrics = useCallback((targetId: string) => {
    const contentEl = boardContentRef.current;
    const nodeEl = document.getElementById(`flow-node-${targetId}`);
    const {
      viewportWidth,
      viewportHeight,
      contentOffsetX: latestContentOffsetX,
      contentOffsetY: latestContentOffsetY,
      scaledBoardWidth: latestScaledBoardWidth,
      scaledBoardHeight: latestScaledBoardHeight,
      zoom: latestZoom,
    } = canvasGeometryRef.current;

    if (!contentEl || !nodeEl || !viewportWidth || !viewportHeight) return;

    const contentRect = contentEl.getBoundingClientRect();
    const nodeRect = nodeEl.getBoundingClientRect();
    const nodeCenterX = (latestContentOffsetX * latestZoom) + (nodeRect.left - contentRect.left) + (nodeRect.width / 2);
    const nodeCenterY = (latestContentOffsetY * latestZoom) + (nodeRect.top - contentRect.top) + (nodeRect.height / 2);

    setCamera(getCameraForNodeFocus({
      viewportWidth,
      viewportHeight,
      nodeCenterX,
      nodeCenterY,
      boardWidth: latestScaledBoardWidth,
      boardHeight: latestScaledBoardHeight,
    }));
  }, []);

  const revealExpandedNodeAtCurrentMetrics = useCallback((targetId: string) => {
    const contentEl = boardContentRef.current;
    const nodeEl = document.getElementById(`flow-node-${targetId}`);
    const subtreeEl = document.getElementById(`flow-subtree-${targetId}`) ?? nodeEl;
    const {
      viewportWidth,
      viewportHeight,
      contentOffsetX: latestContentOffsetX,
      contentOffsetY: latestContentOffsetY,
      scaledBoardWidth: latestScaledBoardWidth,
      scaledBoardHeight: latestScaledBoardHeight,
      zoom: latestZoom,
    } = canvasGeometryRef.current;
    if (!contentEl || !nodeEl || !subtreeEl || !viewportWidth || !viewportHeight) return;

    const contentRect = contentEl.getBoundingClientRect();
    const nodeRect = nodeEl.getBoundingClientRect();
    const subtreeRect = subtreeEl.getBoundingClientRect();
    const subtreeFitsViewport = (
      subtreeRect.width + EXPANDED_SUBTREE_VIEWPORT_PADDING_PX <= viewportWidth
      && subtreeRect.height + EXPANDED_SUBTREE_VIEWPORT_PADDING_PX <= viewportHeight
    );

    const pointX = (latestContentOffsetX * latestZoom)
      + (subtreeFitsViewport ? (subtreeRect.left - contentRect.left) + (subtreeRect.width / 2) : (nodeRect.left - contentRect.left) + (nodeRect.width / 2));
    const pointY = (latestContentOffsetY * latestZoom)
      + (subtreeFitsViewport ? (subtreeRect.top - contentRect.top) + (subtreeRect.height / 2) : (nodeRect.top - contentRect.top) + (nodeRect.height / 2));

    setCamera(getCameraForPointFocus({
      viewportWidth,
      viewportHeight,
      pointX,
      pointY,
      boardWidth: latestScaledBoardWidth,
      boardHeight: latestScaledBoardHeight,
      anchorX: subtreeFitsViewport ? viewportWidth / 2 : Math.round(viewportWidth * EXPANDED_SUBTREE_NODE_ANCHOR_X_RATIO),
      anchorY: subtreeFitsViewport ? viewportHeight / 2 : Math.round(viewportHeight * EXPANDED_SUBTREE_NODE_ANCHOR_Y_RATIO),
    }));
  }, []);

  const revealToggledNodeInCanvas = useCallback((targetId: string, expandedAfterToggle: boolean) => {
    const requestId = latestRevealRequestRef.current + 1;
    latestRevealRequestRef.current = requestId;

    const runReveal = () => {
      if (latestRevealRequestRef.current !== requestId) return;
      if (expandedAfterToggle) {
        revealExpandedNodeAtCurrentMetrics(targetId);
        return;
      }
      focusNodeAtCurrentMetrics(targetId);
    };

    runReveal();
    [160, 420].forEach((delay) => {
      window.setTimeout(runReveal, delay);
    });
  }, [focusNodeAtCurrentMetrics, revealExpandedNodeAtCurrentMetrics]);

  useEffect(() => {
    if (!rootNode || hasCenteredInitialViewRef.current || !viewportSize.width || !viewportSize.height || !contentSize.width) return;

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        focusNodeInCanvas(rootNode.id);
        hasCenteredInitialViewRef.current = true;
      });
    });

    return () => cancelAnimationFrame(raf);
  }, [contentSize.width, contentSize.height, focusNodeInCanvas, rootNode?.id, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    setCamera((prev) => clampCamera(prev.x, prev.y));
  }, [clampCamera]);

  const endCanvasPan = useCallback((el?: HTMLDivElement | null) => {
    if (el && panStateRef.current) {
      try {
        el.releasePointerCapture(panStateRef.current.pointerId);
      } catch {}
    }
    panStateRef.current = null;
    setIsPanningCanvas(false);
    document.body.style.userSelect = '';
  }, []);

  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, select, a, label, [role="button"], [data-no-pan="true"]')) return;

    panStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startCameraX: camera.x,
      startCameraY: camera.y,
    };
    setIsPanningCanvas(true);
    document.body.style.userSelect = 'none';
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [camera.x, camera.y]);

  const handleCanvasPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const pan = panStateRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;

    const deltaX = e.clientX - pan.startX;
    const deltaY = e.clientY - pan.startY;
    setCamera(clampCamera(pan.startCameraX + deltaX, pan.startCameraY + deltaY));
    e.preventDefault();
  }, [clampCamera]);

  const handleCanvasPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const pan = panStateRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    endCanvasPan(e.currentTarget);
  }, [endCanvasPan]);

  const setZoomLevel = useCallback((nextZoomValue: number, anchor?: { x: number; y: number }) => {
    if (!viewportSize.width || !viewportSize.height) return;

    setZoom((currentZoom) => {
      const nextZoom = clampZoom(Number(nextZoomValue.toFixed(2)), MIN_ZOOM, MAX_ZOOM);
      if (nextZoom === currentZoom) return currentZoom;

      setCamera((currentCamera) => getCameraForZoom({
        camera: currentCamera,
        currentZoom,
        nextZoom,
        viewportWidth: viewportSize.width,
        viewportHeight: viewportSize.height,
        boardWidth,
        boardHeight,
        anchorX: anchor?.x,
        anchorY: anchor?.y,
      }));

      return nextZoom;
    });
  }, [boardHeight, boardWidth, viewportSize.height, viewportSize.width]);

  const handleCanvasWheel = useCallback((e: WheelEvent) => {
    if (!viewportSize.width || !viewportSize.height) return;
    e.preventDefault();

    if (e.ctrlKey) {
      const viewportRect = canvasRef.current?.getBoundingClientRect();
      const anchor = viewportRect
        ? { x: e.clientX - viewportRect.left, y: e.clientY - viewportRect.top }
        : { x: viewportSize.width / 2, y: viewportSize.height / 2 };
      const pinchFactor = Math.exp(-e.deltaY * 0.0035);
      setZoomLevel(zoom * pinchFactor, anchor);
      return;
    }

    setCamera((prev) => clampCamera(prev.x - e.deltaX, prev.y - e.deltaY));
  }, [clampCamera, setZoomLevel, viewportSize.height, viewportSize.width, zoom]);

  useEffect(() => {
    const viewportEl = canvasRef.current;
    if (!viewportEl) return;

    return registerNonPassiveWheelListener(viewportEl, handleCanvasWheel);
  }, [handleCanvasWheel]);

  const zoomIn = useCallback(() => {
    setZoomLevel(zoom + ZOOM_STEP);
  }, [setZoomLevel, zoom]);

  const zoomOut = useCallback(() => {
    setZoomLevel(zoom - ZOOM_STEP);
  }, [setZoomLevel, zoom]);

  const resetZoom = useCallback(() => {
    setZoomLevel(DEFAULT_ZOOM);
  }, [setZoomLevel]);

  useEffect(() => () => {
    document.body.style.userSelect = '';
  }, []);

  if (status === 'loading' || isLoading) return <div className="min-h-screen bg-black flex items-center justify-center"><div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>;
  if (!session) redirect('/login');
  if (!nodes.length) return <div className="min-h-screen bg-black flex items-center justify-center text-zinc-500">Flow not found</div>;

  const updateNode = (id: string, updates: Partial<FNode>) => {
    setNodes((prev) => prev.map((n) => n.id === id ? { ...n, ...updates } : n));
  };

  const deleteNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.sourceNodeId !== id && e.targetNodeId !== id));
  };

  const addChild = (parentId: string, type: string) => {
    const defaultConfigs: Record<string, any> = {
      question: { question: '', collectFields: [] },
      response: { response: '', instruction: '' },
      decision: { description: '' },
      collect_info: { fields: [{ name: 'field_1', label: '', type: 'text', required: true }] },
      action: { actionType: 'set_flag', flagName: '', flagValue: '' },
      transfer: {
        transferTarget: 'attorney',
        handoffMode: 'summary_only',
        callbackMessage: 'Thank you. I wrote down everything you shared with me today so I can pass this to the right lawyer for your case. They will review it and call you back at the best callback number I have for you.',
      },
      end: { closingMessage: 'Thank you for calling! Have a wonderful day. Goodbye!' },
    };
    const newNode: FNode = { id: generateId(), type, label: NODE_LABELS[type] ?? type, config: defaultConfigs[type] || {}, sortOrder: nodes.length };
    setNodes((prev) => [...prev, newNode]);
    setEdges((prev) => [...prev, { sourceNodeId: parentId, targetNodeId: newNode.id, label: null, condition: null, sortOrder: prev.length }]);
    setExpandedNodeIds((prev) => new Set([...prev, parentId, newNode.id]));
  };

  const linkExisting = (parentId: string, targetId: string) => {
    setEdges((prev) => [...prev, { sourceNodeId: parentId, targetNodeId: targetId, label: null, condition: null, sortOrder: prev.length }]);
  };

  const deleteEdge = (sourceId: string, targetId: string) => {
    setEdges((prev) => prev.filter((e) => !(e.sourceNodeId === sourceId && e.targetNodeId === targetId)));
  };

  const saveFlow = async () => {
    try {
      const res = await fetch(`/api/flows/${flowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: flowName, nodes, edges }),
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('Flow saved');
    } catch { toast.error('Failed to save'); }
  };

  const activateFlow = async () => {
    try {
      const res = await fetch(`/api/flows/${flowId}/activate`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      toast.success('Flow activated - calls will use this script');
    } catch { toast.error('Failed to activate'); }
  };

  return (
    <div className="min-h-screen bg-black">
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between sticky top-0 bg-black z-10">
        <div className="flex items-center gap-3">
          <Link href="/flow-builder" className="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"><ArrowLeft className="w-4 h-4 text-zinc-400" /></Link>
          <Workflow className="w-5 h-5 text-white" />
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <input type="text" value={flowName} maxLength={80}
              onChange={(e) => setFlowName(e.target.value)}
              className="bg-transparent text-white font-semibold text-sm focus:outline-none border-b border-transparent focus:border-zinc-600 px-1 w-full max-w-md" />
            <span className="text-[9px] text-zinc-400 shrink-0">{flowName.length}/80</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-400 mr-2">{nodes.length} nodes · {edges.length} edges</span>
          <button onClick={saveFlow} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 hover:text-white transition-colors">
            <Save className="w-3 h-3" /> Save
          </button>
          <button onClick={activateFlow} className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg text-xs text-black font-medium hover:bg-zinc-200 transition-colors">
            <Zap className="w-3 h-3" /> Activate
          </button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-53px)]">
        {/* ── Legend sidebar ── */}
        <aside className="w-56 shrink-0 h-full overflow-y-auto border-r border-zinc-800 px-4 py-6 space-y-5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-4">Node Types</p>

          {([
            {
              type: 'start',
              title: 'Start',
              desc: 'The opening greeting the AI says when a call begins. Every flow has exactly one.',
            },
            {
              type: 'question',
              title: 'Question',
              desc: 'The assistant asks the caller something. Add Response child nodes for each possible answer. Optionally collect specific values inline.',
            },
            {
              type: 'response',
              title: 'Response',
              desc: "Represents a specific answer the caller gives. Add one per option under a Question. From each Response you can continue to the next step, or link to any existing step.",
            },
            {
              type: 'action',
              title: 'Action',
              desc: 'Sets an internal flag or calls a tool behind the scenes. The caller never hears this. Use it to tag category, urgency, or other metadata passed to your team.',
            },
            {
              type: 'transfer',
              title: 'Transfer',
              desc: 'Hands the call off to a live teammate or marks the interaction for follow-up after intake is complete.',
            },
            {
              type: 'end',
              title: 'End Call',
              desc: 'Closes the call with a farewell message and hangs up. Use when no live handoff is needed.',
            },
          ] as { type: string; title: string; desc: string }[]).map(({ type, title, desc }) => (
            <div key={type} className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: NODE_COLORS[type] }} />
                <span className="text-[11px] font-semibold text-zinc-300">{title}</span>
              </div>
              <p className="text-[10px] text-zinc-300 leading-relaxed pl-3.5">{desc}</p>
            </div>
          ))}

          <div className="pt-4 border-t border-zinc-800 space-y-1">
            <div className="flex items-center gap-1.5 mb-1">
              <Link2 className="w-3 h-3 text-zinc-500" />
              <span className="text-[11px] font-semibold text-zinc-300">Link to existing</span>
            </div>
            <p className="text-[10px] text-zinc-300 leading-relaxed pl-3.5">Use "Link to existing step" in the Add menu to connect any node to an already-existing step without duplicating it. Shows as a dashed "Continues to" indicator.</p>
          </div>
        </aside>

        {/* ── Main flow document ── */}
        <div
          ref={canvasRef}
          data-testid="flow-canvas-viewport"
          className={`relative flex-1 min-w-0 overflow-hidden bg-black [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${isPanningCanvas ? 'cursor-grabbing' : 'cursor-grab'}`}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
          onPointerCancel={handleCanvasPointerUp}
        >
          <div
            className="absolute left-0 top-0"
            style={{
              width: `${scaledBoardWidth}px`,
              height: `${scaledBoardHeight}px`,
              transform: `translate3d(${camera.x}px, ${camera.y}px, 0)`,
              transition: isPanningCanvas ? 'none' : 'transform 240ms ease',
            }}
          >
            <div
              className="relative origin-top-left"
              style={{
                width: `${boardWidth}px`,
                height: `${boardHeight}px`,
                transform: `scale(${zoom})`,
              }}
            >
              <div
                ref={boardContentRef}
                data-testid="flow-board-content"
                className="relative"
                style={{
                  left: `${contentOffsetX}px`,
                  top: `${contentOffsetY}px`,
                  width: `${rootLayout.width}px`,
                  height: `${boardContentHeight}px`,
                }}
              >
                {rootNode && (
                  <div className="relative" style={{ width: `${rootLayout.width}px`, height: `${boardContentHeight}px` }}>
                    <div
                      className="absolute top-0 text-center"
                      style={{
                        left: `${rootLayout.center}px`,
                        width: `${Math.min(640, rootLayout.width)}px`,
                        maxWidth: 'calc(100vw - 8rem)',
                        transform: 'translateX(-50%)',
                      }}
                    >
                      <div className="flex flex-col items-center gap-2 text-center">
                        <span className="rounded-full border border-zinc-700/80 bg-zinc-900/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-400">
                          Visual Map
                        </span>
                        <p className="text-sm text-zinc-400">
                          Primary branches now fan downward like a decision tree. Linked reuse paths stay visible as jump chips instead of pulling the whole flow sideways.
                        </p>
                      </div>
                    </div>
                    <div className="pointer-events-none absolute inset-0">
                      {visibleTree.nodes.map((placement) => {
                        const childPlacements = visibleChildrenByParent.get(placement.nodeId) || [];
                        if (childPlacements.length === 0) return null;

                        const childRowTop = getTreeRowTop(childPlacements[0]!.depth);
                        const lineY = childRowTop + TREE_CONNECTOR_LINE_Y_PX;
                        const connectorStartY = Math.min(
                          connectorStartYByNodeId.get(placement.nodeId) ?? Math.max(childRowTop - TREE_PARENT_BRIDGE_PX, 0),
                          lineY,
                        );
                        const firstChildCenter = childPlacements[0]!.centerX;
                        const lastChildCenter = childPlacements[childPlacements.length - 1]!.centerX;

                        return (
                          <div key={`connector-${placement.nodeId}`}>
                            <div
                              data-testid={`primary-branch-bridge-${placement.nodeId}`}
                              className="absolute w-px"
                              style={{
                                left: `${placement.centerX}px`,
                                top: `${connectorStartY}px`,
                                height: `${Math.max(lineY - connectorStartY, 1)}px`,
                                transform: 'translateX(-0.5px)',
                                backgroundColor: CONNECTOR_COLOR,
                              }}
                            />
                            {childPlacements.length > 1 && (
                              <div
                                data-testid={`primary-branch-line-${placement.nodeId}`}
                                className="absolute h-px"
                                style={{
                                  top: `${lineY}px`,
                                  left: `${firstChildCenter + (TREE_CONNECTOR_ENDPOINT_TRIM_PX / 2)}px`,
                                  width: `${Math.max(lastChildCenter - firstChildCenter - TREE_CONNECTOR_ENDPOINT_TRIM_PX, 1)}px`,
                                  backgroundColor: CONNECTOR_COLOR,
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                      {visibleMergeGroups.map((group) => {
                        const targetFrame = nodeFrameByNodeId.get(group.targetPlacement.nodeId);
                        if (!targetFrame) return null;

                        const sourceFrames = group.sourcePlacements.flatMap((placement) => {
                          const frame = nodeFrameByNodeId.get(placement.nodeId);
                          if (!frame) return [];
                          return [{
                            nodeId: placement.nodeId,
                            centerX: (frame.left + frame.right) / 2,
                            startY: subtreeBottomYByNodeId.get(placement.nodeId) ?? frame.bottom,
                          }];
                        });

                        if (sourceFrames.length === 0) return null;

                        const maxSourceStartY = Math.max(...sourceFrames.map((frame) => frame.startY));
                        const targetCenterX = (targetFrame.left + targetFrame.right) / 2;
                        const minRailY = maxSourceStartY + TREE_MERGE_RAIL_CLEARANCE_PX;
                        const maxRailY = targetFrame.top - TREE_MERGE_RAIL_CLEARANCE_PX;
                        const railY = maxRailY <= minRailY
                          ? (maxSourceStartY + targetFrame.top) / 2
                          : Math.min(minRailY + TREE_MERGE_RAIL_OFFSET_PX, maxRailY);
                        const lineStartX = Math.min(targetCenterX, ...sourceFrames.map((frame) => frame.centerX));
                        const lineEndX = Math.max(targetCenterX, ...sourceFrames.map((frame) => frame.centerX));

                        return (
                          <div key={`merge-${group.targetPlacement.nodeId}`}>
                            {sourceFrames.map((frame) => (
                              <div key={`merge-source-${frame.nodeId}-${group.targetPlacement.nodeId}`}>
                                <div
                                  data-testid={`merge-connector-source-${frame.nodeId}-${group.targetPlacement.nodeId}`}
                                  className="absolute border-l-2 border-dashed"
                                  style={{
                                    left: `${frame.centerX}px`,
                                    top: `${frame.startY}px`,
                                    height: `${Math.max(railY - frame.startY, 1)}px`,
                                    transform: 'translateX(-1px)',
                                    borderColor: MERGE_CONNECTOR_COLOR,
                                    boxShadow: `0 0 0 1px ${MERGE_CONNECTOR_GLOW}`,
                                  }}
                                />
                                <div
                                  className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-300 bg-sky-400/80"
                                  style={{
                                    left: `${frame.centerX}px`,
                                    top: `${railY}px`,
                                    boxShadow: `0 0 0 4px ${MERGE_CONNECTOR_GLOW}`,
                                  }}
                                />
                              </div>
                            ))}
                            <div
                              data-testid={`merge-connector-line-${group.targetPlacement.nodeId}`}
                              className="absolute border-t-2 border-dashed"
                              style={{
                                left: `${lineStartX}px`,
                                top: `${railY}px`,
                                width: `${Math.max(lineEndX - lineStartX, 1)}px`,
                                borderColor: MERGE_CONNECTOR_COLOR,
                                boxShadow: `0 0 0 1px ${MERGE_CONNECTOR_GLOW}`,
                              }}
                            />
                            <div
                              data-testid={`merge-connector-label-${group.targetPlacement.nodeId}`}
                              className="absolute -translate-x-1/2 rounded-full border border-sky-300/70 bg-sky-500/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-100 shadow-[0_0_0_1px_rgba(96,165,250,0.14)]"
                              style={{
                                left: `${targetCenterX}px`,
                                top: `${railY - 32}px`,
                              }}
                            >
                              Shared Next Step
                            </div>
                            <div
                              data-testid={`merge-connector-target-${group.targetPlacement.nodeId}`}
                              className="absolute border-l-2 border-dashed"
                              style={{
                                left: `${targetCenterX}px`,
                                top: `${railY}px`,
                                height: `${Math.max(targetFrame.top - railY, 1)}px`,
                                transform: 'translateX(-1px)',
                                borderColor: MERGE_CONNECTOR_COLOR,
                                boxShadow: `0 0 0 1px ${MERGE_CONNECTOR_GLOW}`,
                              }}
                            />
                            <div
                              className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-200 bg-sky-400 shadow-[0_0_0_6px_rgba(59,130,246,0.16)]"
                              style={{
                                left: `${targetCenterX}px`,
                                top: `${railY}px`,
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                    {visibleTree.nodes.map((placement) => {
                      const node = nodeById.get(placement.nodeId);
                      if (!node) return null;

                      const branchLabel = branchLabelByNodeId.get(node.id) ?? null;
                      const hasVisibleChildren = (visibleChildrenByParent.get(node.id)?.length ?? 0) > 0;
                      const hasVisibleMergeChildren = (mergedLinkedTargetIdsBySource.get(node.id)?.size ?? 0) > 0;

                      return (
                        <div
                          key={node.id}
                          data-testid={`tree-node-placement-${node.id}`}
                          className="absolute"
                          style={{
                            left: `${placement.centerX - (CARD_WIDTH_PX / 2)}px`,
                            top: `${getTreeRowTop(placement.depth)}px`,
                            width: `${CARD_WIDTH_PX}px`,
                          }}
                        >
                          <NodeCard
                            node={node}
                            edges={edges}
                            allNodes={nodes}
                            branchLabel={branchLabel}
                            primaryParents={primaryParents}
                            confirm={confirm}
                            mergedLinkedTargetIds={mergedLinkedTargetIdsBySource.get(node.id)}
                            expandedNodeIds={expandedNodeIds}
                            expandedOverrides={expandedOverrides}
                            showIncomingStem={placement.depth > 0}
                            showOutgoingStem={hasVisibleChildren || hasVisibleMergeChildren}
                            onToggleExpanded={toggleExpanded}
                            onExpandPath={expandPathToNode}
                            onFocusNode={focusNodeInCanvas}
                            onRevealToggledNode={revealToggledNodeInCanvas}
                            onUpdateNode={updateNode}
                            onDeleteNode={deleteNode}
                            onAddChild={addChild}
                            onLinkExisting={linkExisting}
                            onDeleteEdge={deleteEdge}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div
            data-no-pan="true"
            className="absolute bottom-4 left-4 z-20 flex items-center gap-1 rounded-2xl border border-zinc-700/80 bg-zinc-950/90 p-1 shadow-[0_16px_36px_-18px_rgba(0,0,0,0.9)] backdrop-blur"
          >
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              aria-label="Zoom out"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={resetZoom}
              aria-label="Reset zoom"
              className="min-w-[4.5rem] rounded-xl px-3 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-white"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              aria-label="Zoom in"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
