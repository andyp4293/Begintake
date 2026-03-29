'use client';

import { useSession } from 'next-auth/react';
import { redirect, useParams } from 'next/navigation';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Scale, Save, Zap, ArrowLeft, Plus, Trash2, ChevronDown, ChevronRight, Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { CustomSelect } from '@/components/ui/CustomSelect';

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

interface FNode { id: string; type: string; label: string; config: any; sortOrder: number; }
interface FEdge { sourceNodeId: string; targetNodeId: string; label: string | null; condition: string | null; sortOrder: number; }

function generateId() { return `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

// Walk primaryParents backwards from targetId to root, collecting IDs along the way.
// These are the nodes that need to be expanded to make the target visible.
function computePathToNode(targetId: string, primaryParents: Map<string, string>): string[] {
  const path: string[] = [];
  let current: string | undefined = targetId;
  while (current) {
    path.unshift(current);
    current = primaryParents.get(current);
  }
  return path;
}

// Pre-compute which parent "owns" each node for primary rendering.
// DFS from root: first parent to reach a node is its primary parent.
function computePrimaryParents(rootId: string, edges: FEdge[]): Map<string, string> {
  const primaryParent = new Map<string, string>();
  const childrenOf = new Map<string, FEdge[]>();
  for (const e of edges) {
    if (!childrenOf.has(e.sourceNodeId)) childrenOf.set(e.sourceNodeId, []);
    childrenOf.get(e.sourceNodeId)!.push(e);
  }
  const visited = new Set<string>();
  function dfs(nodeId: string) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    for (const edge of childrenOf.get(nodeId) || []) {
      if (!primaryParent.has(edge.targetNodeId)) {
        primaryParent.set(edge.targetNodeId, nodeId);
      }
      dfs(edge.targetNodeId);
    }
  }
  dfs(rootId);
  return primaryParent;
}

// ─── Node card component ──────────────────────────────────────────────────

function NodeCard({
  node, edges, allNodes, depth, parentId, primaryParents, confirm,
  expandedOverrides, onExpandPath,
  onUpdateNode, onDeleteNode, onAddChild, onLinkExisting, onDeleteEdge,
}: {
  node: FNode; edges: FEdge[]; allNodes: FNode[]; depth: number;
  parentId: string | null; primaryParents: Map<string, string>;
  confirm: (opts: { title?: string; message: string; confirmLabel?: string; destructive?: boolean }) => Promise<boolean>;
  expandedOverrides: Set<string>;
  onExpandPath: (targetId: string) => void;
  onUpdateNode: (id: string, updates: Partial<FNode>) => void;
  onDeleteNode: (id: string) => void;
  onAddChild: (parentId: string, type: string) => void;
  onLinkExisting: (parentId: string, targetId: string) => void;
  onDeleteEdge: (sourceId: string, targetId: string) => void;
}) {
  const [expanded, setExpanded] = useState(() => !node.config?.defaultCollapsed);
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

  // Compute the same size the input uses so we can cap content to that width on first render.
  // ch units here use text-xs (12px) to match the input's font — same as the size= attribute.
  const inputSize = Math.max(8, Math.min(62, node.label.length + 2));

  // Force-expanded when parent clicked "Continues to" and this node is on the path
  const displayExpanded = expandedOverrides.has(node.id) || expanded;
  const color = NODE_COLORS[node.type] || '#666';

  const childEdges = edges.filter((e) => e.sourceNodeId === node.id);
  const childItems = childEdges.flatMap((edge) => {
    const childNode = allNodes.find((n) => n.id === edge.targetNodeId);
    return childNode ? [{ edge, childNode }] : [];
  });
  const primaryChildItems = childItems.filter(({ childNode }) => primaryParents.get(childNode.id) === node.id);
  const linkedChildItems = childItems.filter(({ childNode }) => primaryParents.get(childNode.id) !== node.id);

  const isRoot = parentId === null;
  const isPrimary = isRoot || primaryParents.get(node.id) === parentId;

  if (!isPrimary) return null;

  return (
    <div className="flex w-full flex-col items-center">
      {/* Node card */}
      <div
        id={`flow-node-${node.id}`}
        className="w-fit min-w-[13rem] rounded-2xl border border-zinc-800/90 bg-zinc-900/95 shadow-[0_20px_45px_-30px_rgba(0,0,0,0.9)] backdrop-blur-sm"
        style={{ borderLeftColor: color, borderLeftWidth: 3 }}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <button onClick={() => setExpanded(!displayExpanded)} className="text-zinc-500 hover:text-white flex-shrink-0">
            {childEdges.length > 0 ? (displayExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : <span className="w-3" />}
          </button>
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0" style={{ color, backgroundColor: `${color}15` }}>
            {NODE_LABELS[node.type] ?? node.type}
          </span>
          <input type="text" value={node.label} onChange={(e) => onUpdateNode(node.id, { label: e.target.value })}
            maxLength={60}
            size={Math.max(8, Math.min(62, node.label.length + 2))}
            className="bg-transparent text-xs text-white focus:outline-none border-b border-transparent focus:border-zinc-600 px-1 min-w-0 shrink-0" />
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
        {!editing && (
          <div className="px-3 pb-2 space-y-1 overflow-hidden text-xs" style={{ maxWidth: `calc(${inputSize}ch + 11rem)` }}>
            <div ref={contentRef} className={contentExpanded ? '' : 'line-clamp-2'}>
              {(node.type === 'start' || node.type === 'transfer') && (node.config?.greeting || node.config?.message) && (
                <p className="text-[11px] text-zinc-300 italic leading-relaxed">{node.config?.greeting || node.config?.message}</p>
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
              {node.type === 'response' && (
                <>
                  {node.config?.response && (
                    <p className="text-[11px] font-medium" style={{ color: NODE_COLORS.response }}>"{node.config.response}"</p>
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
                        { value: 'attorney', label: 'Attorney (AI selects best match)' },
                        { value: 'paralegal', label: 'Paralegal / Reception (firm number)' },
                      ]}
                      onChange={(v) => onUpdateNode(node.id, { config: { ...node.config, transferTarget: v } })}
                    />
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-medium text-zinc-400 mb-1">
                    {node.type === 'start' ? 'Opening greeting' : 'Handoff message'}
                  </label>
                  <textarea value={node.config?.greeting || node.config?.message || ''}
                    onChange={(e) => { const key = node.type === 'start' ? 'greeting' : 'message'; onUpdateNode(node.id, { config: { ...node.config, [key]: e.target.value } }); }}
                    rows={3}
                    className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none resize-none" />
                  <p className="text-[9px] text-zinc-500 mt-1">Use <span className="font-mono text-zinc-400">{'{name}'}</span> for assistant name and <span className="font-mono text-zinc-400">{'{firm}'}</span> for firm name.</p>
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
                  onChange={(e) => onUpdateNode(node.id, { config: { ...node.config, response: e.target.value } })}
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
                  <p className="text-[10px] text-zinc-400">Sends an email summary to the matched attorney.</p>
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
        <div className="mt-2">
          <AddNodeMenu
            parentId={node.id} parentLabel={node.label} parentType={node.type}
            allNodes={allNodes} currentNodeId={node.id}
            onAdd={onAddChild} onLinkExisting={onLinkExisting}
          />
        </div>
      )}

      {/* Linked children */}
      {displayExpanded && linkedChildItems.length > 0 && (
        <div className="mt-5 flex flex-col items-center gap-3 px-4">
          <div className="h-4 w-px bg-gradient-to-b from-zinc-500/90 to-transparent" />
          <span className="text-[9px] font-semibold uppercase tracking-[0.28em] text-zinc-500">Linked Steps</span>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {linkedChildItems.map(({ edge, childNode }) => (
              <div key={`${edge.sourceNodeId}-${edge.targetNodeId}`} className="group/jump flex items-center gap-2 rounded-full border border-dashed border-zinc-700/80 bg-zinc-900/70 px-3 py-1.5">
                <Link2 className="w-3 h-3 text-zinc-600 shrink-0" />
                <span className="text-[10px] text-zinc-300">Continues to:</span>
                <button
                  onClick={() => {
                    // Expand all nodes on the path so the target is visible, then scroll
                    onExpandPath(childNode.id);
                    setTimeout(() => {
                      const el = document.getElementById(`flow-node-${childNode.id}`);
                      if (!el) return;
                      el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
                      // Clear any existing highlight
                      document.querySelectorAll('[data-highlighted]').forEach((n) => {
                        (n as HTMLElement).style.outline = '';
                        (n as HTMLElement).style.borderRadius = '';
                        (n as HTMLElement).style.boxShadow = '';
                        (n as HTMLElement).removeAttribute('data-highlighted');
                      });
                      // Apply persistent green highlight with glow
                      el.style.outline = '2px solid #22c55e';
                      el.style.borderRadius = '16px';
                      el.style.boxShadow = '0 0 0 4px rgba(34,197,94,0.2), 0 0 16px 4px rgba(34,197,94,0.25)';
                      el.setAttribute('data-highlighted', 'true');
                      // Dismiss on next click anywhere
                      setTimeout(() => {
                        document.addEventListener('click', function dismiss() {
                          el.style.outline = '';
                          el.style.borderRadius = '';
                          el.style.boxShadow = '';
                          el.removeAttribute('data-highlighted');
                          document.removeEventListener('click', dismiss);
                        }, { once: true });
                      }, 50);
                    }, 150);
                  }}
                  className="text-[10px] text-blue-400 hover:text-blue-300 font-medium truncate underline-offset-2 hover:underline transition-colors"
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

      {/* Primary children */}
      {displayExpanded && primaryChildItems.length > 0 && (
        <div className="mt-8 flex w-full flex-col items-center">
          <div className="h-8 w-[3px] rounded-full bg-gradient-to-b from-sky-100 via-sky-400/90 to-sky-500/10 shadow-[0_0_20px_rgba(56,189,248,0.45)]" />
          <div className="relative mx-auto w-fit max-w-full pt-4">
            {primaryChildItems.length > 1 && (
              <>
                <div className="pointer-events-none absolute inset-x-4 top-0 h-[3px] rounded-full bg-gradient-to-r from-sky-500/10 via-sky-300/90 to-sky-500/10 shadow-[0_0_22px_rgba(56,189,248,0.45)]" />
                <div className="pointer-events-none absolute left-1/2 top-0 h-3.5 w-3.5 -translate-x-1/2 -translate-y-[5px] rounded-full border border-sky-100/80 bg-sky-300 shadow-[0_0_22px_rgba(125,211,252,0.95)]" />
              </>
            )}
            <div
              className="grid items-start gap-x-6 gap-y-6 px-4 sm:gap-x-8 xl:gap-x-10"
              style={{ gridTemplateColumns: `repeat(${primaryChildItems.length}, minmax(15rem, 1fr))` }}
            >
              {primaryChildItems.map(({ edge, childNode }) => {
                const branchLabel = edge.label
                  || edge.condition
                  || (node.type === 'question' ? childNode.config?.response : null);

                return (
                  <div key={`${edge.sourceNodeId}-${edge.targetNodeId}`} className="relative flex min-w-[15rem] flex-col items-center pt-7">
                    <div className="pointer-events-none absolute left-1/2 top-0 h-7 w-[3px] -translate-x-1/2 rounded-full bg-gradient-to-b from-sky-100 via-sky-400/75 to-sky-500/5 shadow-[0_0_18px_rgba(56,189,248,0.42)]" />
                    <div className="pointer-events-none absolute left-1/2 top-6 h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-sky-100/70 bg-sky-300 shadow-[0_0_16px_rgba(125,211,252,0.85)]" />
                    {branchLabel && (
                      <div className="mb-3 inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border border-sky-300/25 bg-sky-400/10 px-3 py-1 text-[10px] font-medium text-sky-100 shadow-[0_8px_24px_-18px_rgba(56,189,248,0.85)]">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300" />
                        <span className="truncate">{branchLabel}</span>
                      </div>
                    )}
                    <NodeCard
                      node={childNode} edges={edges} allNodes={allNodes} depth={depth + 1}
                      parentId={node.id} primaryParents={primaryParents} confirm={confirm}
                      expandedOverrides={expandedOverrides} onExpandPath={onExpandPath}
                      onUpdateNode={onUpdateNode} onDeleteNode={onDeleteNode}
                      onAddChild={onAddChild} onLinkExisting={onLinkExisting} onDeleteEdge={onDeleteEdge}
                    />
                  </div>
                );
              })}
            </div>
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
    <div className="relative inline-block">
      <button onClick={() => { setOpen(!open); setShowLinkPicker(false); setLinkSearch(''); }}
        className="flex items-center gap-1 px-2 py-1 text-[10px] text-zinc-400 hover:text-white transition-colors">
        <Plus className="w-3 h-3" /> Add step under <span className="text-zinc-300 ml-0.5">{shortParent}</span>
      </button>
      {open && (
        <div className="absolute z-10 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg p-2 shadow-xl w-56">
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
  const [flowName, setFlowName] = useState('');
  const [nodes, setNodes] = useState<FNode[]>([]);
  const [edges, setEdges] = useState<FEdge[]>([]);
  const [expandedOverrides, setExpandedOverrides] = useState<Set<string>>(new Set());

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
      setFlowName(flow.name);
      setNodes(flow.nodes.map((n: any) => ({ id: n.id, type: n.type, label: n.label, config: n.config || {}, sortOrder: n.sortOrder })));
      setEdges(flow.edges.map((e: any) => ({ sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, label: e.label, condition: e.condition, sortOrder: e.sortOrder })));
    }
  }, [flow]);

  const incomingIds = new Set(edges.map((e) => e.targetNodeId));
  const rootNode = nodes.find((n) => !incomingIds.has(n.id)) || nodes[0];

  const primaryParents = useMemo(() => {
    if (!rootNode) return new Map<string, string>();
    return computePrimaryParents(rootNode.id, edges);
  }, [rootNode?.id, edges]);

  const expandPathToNode = useCallback((targetId: string) => {
    setExpandedOverrides(new Set(computePathToNode(targetId, primaryParents)));
  }, [primaryParents]);

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
      transfer: { message: "Thank you so much for sharing all of that with me. I now have everything the attorney will need. Please hold - I'm connecting you now." },
      end: { closingMessage: 'Thank you for calling! Have a wonderful day. Goodbye!' },
    };
    const newNode: FNode = { id: generateId(), type, label: NODE_LABELS[type] ?? type, config: defaultConfigs[type] || {}, sortOrder: nodes.length };
    setNodes((prev) => [...prev, newNode]);
    setEdges((prev) => [...prev, { sourceNodeId: parentId, targetNodeId: newNode.id, label: null, condition: null, sortOrder: prev.length }]);
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
          <Scale className="w-5 h-5 text-white" />
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

      <div className="flex">
        {/* ── Legend sidebar ── */}
        <aside className="w-56 shrink-0 sticky top-[53px] h-[calc(100vh-53px)] overflow-y-auto border-r border-zinc-800 px-4 py-6 space-y-5">
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
              desc: 'Aria asks the caller something. Add Response child nodes for each possible answer. Optionally collect specific values inline.',
            },
            {
              type: 'response',
              title: 'Response',
              desc: "Represents a specific answer the caller gives. Add one per option under a Question. From each Response you can continue to the next step, or link to any existing step.",
            },
            {
              type: 'action',
              title: 'Action',
              desc: 'Sets an internal flag or calls a tool behind the scenes. The caller never hears this. Use it to tag petition type, urgency, or other metadata passed to the attorney at transfer.',
            },
            {
              type: 'transfer',
              title: 'Transfer',
              desc: 'Hands the call off to an attorney. The AI summarises everything collected and connects the caller.',
            },
            {
              type: 'end',
              title: 'End Call',
              desc: 'Closes the call with a farewell message and hangs up. Use when no attorney handoff is needed.',
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
        <div className="flex-1 min-w-0 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_32%),linear-gradient(to_bottom,_rgba(24,24,27,0.92),_rgba(0,0,0,0.98))]">
          <div className="min-h-full px-6 py-8">
            <div className="mb-8 flex flex-col items-center gap-2 text-center">
              <span className="rounded-full border border-zinc-700/80 bg-zinc-900/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-400">
                Visual Map
              </span>
              <p className="max-w-2xl text-sm text-zinc-400">
                Primary branches now fan downward like a decision tree. Linked reuse paths stay visible as jump chips instead of pulling the whole flow sideways.
              </p>
            </div>
            <div className="inline-flex min-w-full justify-center">
              {rootNode && (
                <NodeCard
                  node={rootNode} edges={edges} allNodes={nodes} depth={0}
                  parentId={null} primaryParents={primaryParents} confirm={confirm}
                  expandedOverrides={expandedOverrides} onExpandPath={expandPathToNode}
                  onUpdateNode={updateNode} onDeleteNode={deleteNode}
                  onAddChild={addChild} onLinkExisting={linkExisting} onDeleteEdge={deleteEdge}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
