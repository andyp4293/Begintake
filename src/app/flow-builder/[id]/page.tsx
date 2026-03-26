'use client';

import { useSession } from 'next-auth/react';
import { redirect, useParams } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Scale, Save, Zap, ArrowLeft, Plus, Trash2, ChevronDown, ChevronRight, Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

const NODE_COLORS: Record<string, string> = {
  start: '#22c55e', question: '#3b82f6', collect_info: '#a855f7',
  decision: '#f59e0b', action: '#06b6d4', transfer: '#f97316', end: '#ef4444',
};
const NODE_LABELS: Record<string, string> = {
  start: 'Start', question: 'Question', collect_info: 'Collect Info',
  decision: 'Decision', action: 'Action', transfer: 'Transfer', end: 'End Call',
};

interface FNode { id: string; type: string; label: string; config: any; sortOrder: number; }
interface FEdge { sourceNodeId: string; targetNodeId: string; label: string | null; condition: string | null; sortOrder: number; }

function generateId() { return `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

// ─── Node card component ──────────────────────────────────────────────────

function NodeCard({
  node, edges, allNodes, depth, rendered, onUpdateNode, onDeleteNode, onAddChild, onLinkExisting, onDeleteEdge,
}: {
  node: FNode; edges: FEdge[]; allNodes: FNode[]; depth: number; rendered: Set<string>;
  onUpdateNode: (id: string, updates: Partial<FNode>) => void;
  onDeleteNode: (id: string) => void;
  onAddChild: (parentId: string, type: string, edgeLabel?: string) => void;
  onLinkExisting: (parentId: string, targetId: string, edgeLabel?: string) => void;
  onDeleteEdge: (sourceId: string, targetId: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 3);
  const [editing, setEditing] = useState(false);
  const color = NODE_COLORS[node.type] || '#666';

  // Children of this node
  const childEdges = edges.filter((e) => e.sourceNodeId === node.id);
  const isFirstRender = !rendered.has(node.id);
  rendered.add(node.id);

  // If this node was already rendered elsewhere, show a merge reference
  if (!isFirstRender) {
    return (
      <div className={depth > 0 ? 'ml-6 border-l border-zinc-800/50 pl-4' : ''}>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/50 border border-zinc-800/50 border-dashed rounded-lg mb-2"
          style={{ borderLeftColor: `${color}60`, borderLeftWidth: 3 }}>
          <Link2 className="w-3 h-3 text-zinc-600" />
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: `${color}99` }}>
            {NODE_LABELS[node.type]}
          </span>
          <span className="text-[10px] text-zinc-500">
            → merges to: <span className="text-zinc-400">{node.label}</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={depth > 0 ? 'ml-6 border-l border-zinc-800 pl-4' : ''}>
      {/* Node card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg mb-2 overflow-hidden" style={{ borderLeftColor: color, borderLeftWidth: 3 }}>
        <div className="flex items-center gap-2 px-3 py-2">
          <button onClick={() => setExpanded(!expanded)} className="text-zinc-500 hover:text-white">
            {childEdges.length > 0 ? (expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : <span className="w-3" />}
          </button>
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color, backgroundColor: `${color}15` }}>
            {NODE_LABELS[node.type]}
          </span>
          <input type="text" value={node.label} onChange={(e) => onUpdateNode(node.id, { label: e.target.value })}
            className="flex-1 bg-transparent text-xs text-white focus:outline-none border-b border-transparent focus:border-zinc-600 px-1" />
          {childEdges.length > 0 && !expanded && (
            <span className="text-[9px] text-zinc-600">{childEdges.length} branch{childEdges.length > 1 ? 'es' : ''}</span>
          )}
          <button onClick={() => setEditing(!editing)} className="text-[10px] text-zinc-500 hover:text-white px-1">{editing ? 'Done' : 'Edit'}</button>
          {node.type !== 'start' && <button onClick={() => onDeleteNode(node.id)} className="text-zinc-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>}
        </div>

        {/* Config editor */}
        {editing && (
          <div className="px-3 pb-3 space-y-2 border-t border-zinc-800 pt-2">
            {(node.type === 'start' || node.type === 'transfer') && (
              <textarea value={node.config?.greeting || node.config?.message || ''}
                onChange={(e) => { const key = node.type === 'start' ? 'greeting' : 'message'; onUpdateNode(node.id, { config: { ...node.config, [key]: e.target.value } }); }}
                rows={3} placeholder={node.type === 'start' ? 'Greeting...' : 'Transfer message...'}
                className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none resize-none" />
            )}
            {node.type === 'question' && (
              <>
                <textarea value={node.config?.question || ''} placeholder="What to ask..."
                  onChange={(e) => onUpdateNode(node.id, { config: { ...node.config, question: e.target.value } })}
                  rows={2} className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none resize-none" />
                {node.config?.options?.length > 0 && (
                  <div className="space-y-1">
                    <label className="text-[10px] text-zinc-500">Options:</label>
                    {node.config.options.map((opt: any, i: number) => (
                      <div key={i} className="text-[10px] text-zinc-400 pl-2">• {opt.label}</div>
                    ))}
                  </div>
                )}
              </>
            )}
            {node.type === 'decision' && (
              <textarea value={node.config?.description || ''} placeholder="Routing logic..."
                onChange={(e) => onUpdateNode(node.id, { config: { ...node.config, description: e.target.value } })}
                rows={2} className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none resize-none" />
            )}
            {node.type === 'action' && (
              <input type="text" value={node.config?.petitionType || node.config?.flagValue || ''}
                onChange={(e) => onUpdateNode(node.id, { config: { ...node.config, petitionType: e.target.value, flagValue: e.target.value, actionType: 'set_flag' } })}
                placeholder="e.g. V-Petition — new" className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none" />
            )}
            {node.type === 'collect_info' && (
              <input type="text" value={(node.config?.fields || []).map((f: any) => f.label || f.name).join(', ')}
                onChange={(e) => { const fields = e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean).map((label: string) => ({ name: label.toLowerCase().replace(/\s+/g, '_'), label, type: 'text', required: true })); onUpdateNode(node.id, { config: { ...node.config, fields } }); }}
                placeholder="Full name, Phone, Email" className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none" />
            )}
            {node.type === 'end' && (
              <input type="text" value={node.config?.closingMessage || ''} placeholder="Closing message..."
                onChange={(e) => onUpdateNode(node.id, { config: { ...node.config, closingMessage: e.target.value } })}
                className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none" />
            )}
          </div>
        )}
      </div>

      {/* Children */}
      {expanded && childEdges.map((edge) => {
        const childNode = allNodes.find((n) => n.id === edge.targetNodeId);
        if (!childNode) return null;
        return (
          <div key={`${edge.sourceNodeId}-${edge.targetNodeId}-${edge.label}`}>
            {/* Edge label */}
            {edge.label && (
              <div className="ml-6 pl-4 flex items-center gap-2 mb-1">
                <div className="w-4 h-px bg-zinc-700" />
                <span className="text-[10px] text-zinc-500 italic">{edge.label}</span>
                <button onClick={() => onDeleteEdge(edge.sourceNodeId, edge.targetNodeId)}
                  className="text-zinc-700 hover:text-red-400 opacity-0 hover:opacity-100 transition-opacity">
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            )}
            <NodeCard
              node={childNode} edges={edges} allNodes={allNodes} depth={depth + 1}
              rendered={rendered} onUpdateNode={onUpdateNode} onDeleteNode={onDeleteNode}
              onAddChild={onAddChild} onLinkExisting={onLinkExisting} onDeleteEdge={onDeleteEdge}
            />
          </div>
        );
      })}

      {/* Add child */}
      {expanded && (
        <div className={`${depth > 0 ? 'ml-6 pl-4' : ''} mb-2`}>
          <AddNodeMenu parentId={node.id} allNodes={allNodes} edges={edges}
            onAdd={onAddChild} onLink={onLinkExisting} />
        </div>
      )}
    </div>
  );
}

// ─── Add node menu with "link to existing" option ─────────────────────────

function AddNodeMenu({ parentId, allNodes, edges, onAdd, onLink }: {
  parentId: string; allNodes: FNode[]; edges: FEdge[];
  onAdd: (parentId: string, type: string, edgeLabel?: string) => void;
  onLink: (parentId: string, targetId: string, edgeLabel?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'new' | 'link'>('new');
  const [edgeLabel, setEdgeLabel] = useState('');

  // Nodes that aren't already children of this parent
  const existingChildIds = new Set(edges.filter((e) => e.sourceNodeId === parentId).map((e) => e.targetNodeId));
  const linkableNodes = allNodes.filter((n) => n.id !== parentId && !existingChildIds.has(n.id));

  return (
    <div className="relative inline-block">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 px-2 py-1 text-[10px] text-zinc-600 hover:text-zinc-300 transition-colors">
        <Plus className="w-3 h-3" /> Add step
      </button>
      {open && (
        <div className="absolute z-10 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg p-2 shadow-xl w-60">
          {/* Mode tabs */}
          <div className="flex gap-1 mb-2">
            <button onClick={() => setMode('new')}
              className={`flex-1 text-[10px] py-1 rounded ${mode === 'new' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'}`}>
              New Step
            </button>
            <button onClick={() => setMode('link')}
              className={`flex-1 text-[10px] py-1 rounded ${mode === 'link' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'}`}>
              <Link2 className="w-3 h-3 inline mr-1" />Link Existing
            </button>
          </div>

          <input type="text" value={edgeLabel} onChange={(e) => setEdgeLabel(e.target.value)} placeholder="Branch label (optional)"
            className="w-full px-2 py-1 mb-2 bg-zinc-800 border border-zinc-700 rounded text-[10px] text-white focus:outline-none" />

          {mode === 'new' ? (
            Object.entries(NODE_LABELS).map(([type, label]) => (
              <button key={type} onClick={() => { onAdd(parentId, type, edgeLabel || undefined); setOpen(false); setEdgeLabel(''); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 rounded transition-colors">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_COLORS[type] }} /> {label}
              </button>
            ))
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {linkableNodes.length === 0 ? (
                <p className="text-[10px] text-zinc-600 px-2 py-2">No nodes to link to</p>
              ) : (
                linkableNodes.map((n) => (
                  <button key={n.id} onClick={() => { onLink(parentId, n.id, edgeLabel || undefined); setOpen(false); setEdgeLabel(''); }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 rounded transition-colors">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_COLORS[n.type] }} />
                    <span className="truncate">{n.label}</span>
                  </button>
                ))
              )}
            </div>
          )}
          <button onClick={() => setOpen(false)} className="w-full mt-1 text-[10px] text-zinc-600 hover:text-white py-1">Cancel</button>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────

export default function FlowEditorPage() {
  const { data: session, status } = useSession();
  const params = useParams();
  const flowId = params.id as string;
  const [flowName, setFlowName] = useState('');
  const [nodes, setNodes] = useState<FNode[]>([]);
  const [edges, setEdges] = useState<FEdge[]>([]);

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

  if (status === 'loading' || isLoading) return <div className="min-h-screen bg-black flex items-center justify-center"><div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>;
  if (!session) redirect('/login');
  if (!nodes.length) return <div className="min-h-screen bg-black flex items-center justify-center text-zinc-500">Flow not found</div>;

  // Find root node (no incoming edges)
  const childIds = new Set(edges.map((e) => e.targetNodeId));
  const rootNode = nodes.find((n) => !childIds.has(n.id)) || nodes[0];

  const updateNode = (id: string, updates: Partial<FNode>) => {
    setNodes((prev) => prev.map((n) => n.id === id ? { ...n, ...updates } : n));
  };

  const deleteNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.sourceNodeId !== id && e.targetNodeId !== id));
  };

  const addChild = (parentId: string, type: string, edgeLabel?: string) => {
    const newNode: FNode = { id: generateId(), type, label: NODE_LABELS[type], config: {}, sortOrder: nodes.length };
    setNodes((prev) => [...prev, newNode]);
    setEdges((prev) => [...prev, { sourceNodeId: parentId, targetNodeId: newNode.id, label: edgeLabel || null, condition: null, sortOrder: prev.length }]);
  };

  const linkExisting = (parentId: string, targetId: string, edgeLabel?: string) => {
    // Don't add duplicate edge
    if (edges.some((e) => e.sourceNodeId === parentId && e.targetNodeId === targetId)) return;
    setEdges((prev) => [...prev, { sourceNodeId: parentId, targetNodeId: targetId, label: edgeLabel || null, condition: null, sortOrder: prev.length }]);
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
      toast.success('Flow activated — calls will use this script');
    } catch { toast.error('Failed to activate'); }
  };

  // Each render pass tracks which nodes have been rendered to detect merge points
  const rendered = new Set<string>();

  return (
    <div className="min-h-screen bg-black">
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between sticky top-0 bg-black z-10">
        <div className="flex items-center gap-3">
          <Link href="/flow-builder" className="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"><ArrowLeft className="w-4 h-4 text-zinc-400" /></Link>
          <Scale className="w-5 h-5 text-white" />
          <input type="text" value={flowName} onChange={(e) => setFlowName(e.target.value)}
            className="bg-transparent text-white font-semibold text-sm focus:outline-none border-b border-transparent focus:border-zinc-600 px-1" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-600 mr-2">{nodes.length} nodes · {edges.length} edges</span>
          <button onClick={saveFlow} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 hover:text-white transition-colors">
            <Save className="w-3 h-3" /> Save
          </button>
          <button onClick={activateFlow} className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg text-xs text-black font-medium hover:bg-zinc-200 transition-colors">
            <Zap className="w-3 h-3" /> Activate
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <NodeCard
          node={rootNode} edges={edges} allNodes={nodes} depth={0} rendered={rendered}
          onUpdateNode={updateNode} onDeleteNode={deleteNode} onAddChild={addChild}
          onLinkExisting={linkExisting} onDeleteEdge={deleteEdge}
        />
      </main>
    </div>
  );
}
