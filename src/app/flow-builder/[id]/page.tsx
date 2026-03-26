'use client';

import { useSession } from 'next-auth/react';
import { redirect, useParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Scale, Save, Zap, ArrowLeft, Plus, Trash2, ChevronDown, ChevronRight,
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

interface FlowNode {
  id: string; type: string; label: string; config: any; children: FlowNode[]; edgeLabel?: string;
}

function generateId() { return `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function flatToTree(nodes: any[], edges: any[]): FlowNode {
  const nodeMap = new Map<string, FlowNode>();
  for (const n of nodes) nodeMap.set(n.id, { id: n.id, type: n.type, label: n.label, config: n.config || {}, children: [] });
  const childIds = new Set<string>();
  const addedChildren = new Set<string>(); // prevent duplicate children
  for (const e of edges) {
    const parent = nodeMap.get(e.sourceNodeId);
    const child = nodeMap.get(e.targetNodeId);
    const key = `${e.sourceNodeId}->${e.targetNodeId}`;
    if (parent && child && !addedChildren.has(key)) {
      child.edgeLabel = e.label || undefined;
      parent.children.push(child);
      childIds.add(e.targetNodeId);
      addedChildren.add(key);
    }
  }
  const root = nodes.find((n: any) => !childIds.has(n.id));
  return root ? nodeMap.get(root.id)! : { id: generateId(), type: 'start', label: 'Start', config: {}, children: [] };
}

function treeToFlat(root: FlowNode) {
  const nodes: any[] = []; const edges: any[] = []; let sortOrder = 0;
  function walk(node: FlowNode, depth: number) {
    nodes.push({ id: node.id, type: node.type, label: node.label, positionX: depth * 200, positionY: sortOrder * 150, config: node.config, sortOrder: sortOrder++ });
    for (const child of node.children) {
      edges.push({ sourceNodeId: node.id, targetNodeId: child.id, label: child.edgeLabel || null, condition: null, sortOrder: edges.length });
      walk(child, depth + 1);
    }
  }
  walk(root, 0);
  return { nodes, edges };
}

function NodeEditor({ node, depth, onUpdate, onDelete, onAddChild }: {
  node: FlowNode; depth: number;
  onUpdate: (id: string, updates: Partial<FlowNode>) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string, type: string, edgeLabel?: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [editing, setEditing] = useState(false);
  const color = NODE_COLORS[node.type] || '#666';

  return (
    <div className={depth > 0 ? 'ml-6 border-l border-zinc-800 pl-4' : ''}>
      {node.edgeLabel && depth > 0 && (
        <div className="flex items-center gap-2 mb-1">
          <div className="w-4 h-px bg-zinc-700" />
          <span className="text-[10px] text-zinc-500 italic">{node.edgeLabel}</span>
        </div>
      )}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg mb-2 overflow-hidden" style={{ borderLeftColor: color, borderLeftWidth: 3 }}>
        <div className="flex items-center gap-2 px-3 py-2">
          <button onClick={() => setExpanded(!expanded)} className="text-zinc-500 hover:text-white">
            {node.children.length > 0 ? (expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : <span className="w-3" />}
          </button>
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color, backgroundColor: `${color}15` }}>
            {NODE_LABELS[node.type]}
          </span>
          <input type="text" value={node.label} onChange={(e) => onUpdate(node.id, { label: e.target.value })}
            className="flex-1 bg-transparent text-xs text-white focus:outline-none border-b border-transparent focus:border-zinc-600 px-1" />
          <button onClick={() => setEditing(!editing)} className="text-[10px] text-zinc-500 hover:text-white px-1">{editing ? 'Done' : 'Edit'}</button>
          {node.type !== 'start' && <button onClick={() => onDelete(node.id)} className="text-zinc-600 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>}
        </div>
        {editing && (
          <div className="px-3 pb-3 space-y-2 border-t border-zinc-800 pt-2">
            {(node.type === 'start' || node.type === 'transfer') && <textarea value={node.config?.greeting || node.config?.message || ''} onChange={(e) => { const key = node.type === 'start' ? 'greeting' : 'message'; onUpdate(node.id, { config: { ...node.config, [key]: e.target.value } }); }} rows={3} placeholder={node.type === 'start' ? 'Greeting...' : 'Transfer message...'} className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none resize-none" />}
            {node.type === 'question' && <textarea value={node.config?.question || ''} placeholder="What to ask..." onChange={(e) => onUpdate(node.id, { config: { ...node.config, question: e.target.value } })} rows={2} className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none resize-none" />}
            {node.type === 'decision' && <textarea value={node.config?.description || ''} placeholder="Routing logic..." onChange={(e) => onUpdate(node.id, { config: { ...node.config, description: e.target.value } })} rows={2} className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none resize-none" />}
            {node.type === 'action' && <input type="text" value={node.config?.petitionType || node.config?.flagValue || ''} onChange={(e) => onUpdate(node.id, { config: { ...node.config, petitionType: e.target.value, flagValue: e.target.value, actionType: 'set_flag' } })} placeholder="e.g. V-Petition — new" className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none" />}
            {node.type === 'collect_info' && <input type="text" value={(node.config?.fields || []).map((f: any) => f.label || f.name).join(', ')} onChange={(e) => { const fields = e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean).map((label: string) => ({ name: label.toLowerCase().replace(/\s+/g, '_'), label, type: 'text', required: true })); onUpdate(node.id, { config: { ...node.config, fields } }); }} placeholder="Full name, Phone, Email" className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none" />}
            {node.type === 'end' && <input type="text" value={node.config?.closingMessage || ''} placeholder="Closing message..." onChange={(e) => onUpdate(node.id, { config: { ...node.config, closingMessage: e.target.value } })} className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none" />}
          </div>
        )}
      </div>
      {expanded && node.children.map((child) => <NodeEditor key={child.id} node={child} depth={depth + 1} onUpdate={onUpdate} onDelete={onDelete} onAddChild={onAddChild} />)}
      {expanded && (
        <div className={`${depth > 0 ? 'ml-6 pl-4' : ''} mb-2`}>
          <AddNodeMenu parentId={node.id} onAdd={onAddChild} />
        </div>
      )}
    </div>
  );
}

function AddNodeMenu({ parentId, onAdd }: { parentId: string; onAdd: (parentId: string, type: string, edgeLabel?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [edgeLabel, setEdgeLabel] = useState('');
  return (
    <div className="relative inline-block">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 px-2 py-1 text-[10px] text-zinc-600 hover:text-zinc-300 transition-colors">
        <Plus className="w-3 h-3" /> Add step
      </button>
      {open && (
        <div className="absolute z-10 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg p-2 shadow-xl w-52">
          <input type="text" value={edgeLabel} onChange={(e) => setEdgeLabel(e.target.value)} placeholder="Branch label (optional)"
            className="w-full px-2 py-1 mb-2 bg-zinc-800 border border-zinc-700 rounded text-[10px] text-white focus:outline-none" />
          {Object.entries(NODE_LABELS).map(([type, label]) => (
            <button key={type} onClick={() => { onAdd(parentId, type, edgeLabel || undefined); setOpen(false); setEdgeLabel(''); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 rounded transition-colors">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_COLORS[type] }} /> {label}
            </button>
          ))}
          <button onClick={() => setOpen(false)} className="w-full mt-1 text-[10px] text-zinc-600 hover:text-white py-1">Cancel</button>
        </div>
      )}
    </div>
  );
}

export default function FlowEditorPage() {
  const { data: session, status } = useSession();
  const params = useParams();
  const flowId = params.id as string;
  const [flowName, setFlowName] = useState('');
  const [rootNode, setRootNode] = useState<FlowNode | null>(null);

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
      setRootNode(flatToTree(flow.nodes, flow.edges));
    }
  }, [flow]);

  if (status === 'loading' || isLoading) return <div className="min-h-screen bg-black flex items-center justify-center"><div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>;
  if (!session) redirect('/login');
  if (!rootNode) return <div className="min-h-screen bg-black flex items-center justify-center text-zinc-500">Flow not found</div>;

  const updateNode = (id: string, updates: Partial<FlowNode>) => {
    setRootNode((prev) => {
      if (!prev) return prev;
      const clone = JSON.parse(JSON.stringify(prev));
      function find(node: FlowNode): FlowNode | null { if (node.id === id) return node; for (const c of node.children) { const f = find(c); if (f) return f; } return null; }
      const target = find(clone);
      if (target) Object.assign(target, updates);
      return clone;
    });
  };

  const deleteNode = (id: string) => {
    setRootNode((prev) => {
      if (!prev) return prev;
      const clone = JSON.parse(JSON.stringify(prev));
      function rm(node: FlowNode) { node.children = node.children.filter((c) => c.id !== id); node.children.forEach(rm); }
      rm(clone);
      return clone;
    });
  };

  const addChild = (parentId: string, type: string, edgeLabel?: string) => {
    const newNode: FlowNode = { id: generateId(), type, label: NODE_LABELS[type], config: {}, children: [], edgeLabel };
    setRootNode((prev) => {
      if (!prev) return prev;
      const clone = JSON.parse(JSON.stringify(prev));
      function find(node: FlowNode): FlowNode | null { if (node.id === parentId) return node; for (const c of node.children) { const f = find(c); if (f) return f; } return null; }
      const parent = find(clone);
      if (parent) parent.children.push(newNode);
      return clone;
    });
  };

  const saveFlow = async () => {
    try {
      const { nodes, edges } = treeToFlat(rootNode);
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
          <button onClick={saveFlow} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 hover:text-white transition-colors">
            <Save className="w-3 h-3" /> Save
          </button>
          <button onClick={activateFlow} className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg text-xs text-black font-medium hover:bg-zinc-200 transition-colors">
            <Zap className="w-3 h-3" /> Activate
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <NodeEditor node={rootNode} depth={0} onUpdate={updateNode} onDelete={deleteNode} onAddChild={addChild} />
      </main>
    </div>
  );
}
