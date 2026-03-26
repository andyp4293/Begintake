'use client';

import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { useState } from 'react';
import {
  Scale, Save, Zap, ArrowLeft, LayoutTemplate,
  Plus, Trash2, ChevronDown, ChevronRight,
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
  id: string;
  type: string;
  label: string;
  config: any;
  children: FlowNode[];
  edgeLabel?: string;
}

function generateId() {
  return `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function NodeEditor({
  node, depth, onUpdate, onDelete, onAddChild,
}: {
  node: FlowNode; depth: number;
  onUpdate: (id: string, updates: Partial<FlowNode>) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string, type: string, edgeLabel?: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
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
            {node.children.length > 0 ? (
              expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
            ) : <span className="w-3" />}
          </button>
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color, backgroundColor: `${color}15` }}>
            {NODE_LABELS[node.type]}
          </span>
          <input
            type="text" value={node.label}
            onChange={(e) => onUpdate(node.id, { label: e.target.value })}
            className="flex-1 bg-transparent text-xs text-white focus:outline-none border-b border-transparent focus:border-zinc-600 px-1"
          />
          <button onClick={() => setEditing(!editing)} className="text-[10px] text-zinc-500 hover:text-white px-1">
            {editing ? 'Done' : 'Edit'}
          </button>
          {node.type !== 'start' && (
            <button onClick={() => onDelete(node.id)} className="text-zinc-600 hover:text-red-400">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>

        {editing && (
          <div className="px-3 pb-3 space-y-2 border-t border-zinc-800 pt-2">
            {(node.type === 'start' || node.type === 'transfer') && (
              <textarea
                value={node.config?.greeting || node.config?.message || ''}
                onChange={(e) => {
                  const key = node.type === 'start' ? 'greeting' : 'message';
                  onUpdate(node.id, { config: { ...node.config, [key]: e.target.value } });
                }}
                rows={3} placeholder={node.type === 'start' ? 'Greeting message...' : 'Transfer message...'}
                className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none resize-none"
              />
            )}
            {node.type === 'question' && (
              <textarea
                value={node.config?.question || ''} placeholder="What to ask the caller..."
                onChange={(e) => onUpdate(node.id, { config: { ...node.config, question: e.target.value } })}
                rows={2}
                className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none resize-none"
              />
            )}
            {node.type === 'decision' && (
              <textarea
                value={node.config?.description || ''} placeholder="Routing logic description..."
                onChange={(e) => onUpdate(node.id, { config: { ...node.config, description: e.target.value } })}
                rows={2}
                className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none resize-none"
              />
            )}
            {node.type === 'action' && (
              <input
                type="text" value={node.config?.petitionType || node.config?.flagValue || ''}
                onChange={(e) => onUpdate(node.id, { config: { ...node.config, petitionType: e.target.value, flagValue: e.target.value, actionType: 'set_flag' } })}
                placeholder="e.g. V-Petition — new"
                className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none"
              />
            )}
            {node.type === 'collect_info' && (
              <input
                type="text"
                value={(node.config?.fields || []).map((f: any) => f.label || f.name).join(', ')}
                onChange={(e) => {
                  const fields = e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean).map((label: string) => ({
                    name: label.toLowerCase().replace(/\s+/g, '_'), label, type: 'text', required: true,
                  }));
                  onUpdate(node.id, { config: { ...node.config, fields } });
                }}
                placeholder="Full name, Phone, Email"
                className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none"
              />
            )}
            {node.type === 'end' && (
              <input
                type="text" value={node.config?.closingMessage || ''} placeholder="Closing message..."
                onChange={(e) => onUpdate(node.id, { config: { ...node.config, closingMessage: e.target.value } })}
                className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-white focus:outline-none"
              />
            )}
          </div>
        )}
      </div>

      {expanded && node.children.map((child) => (
        <NodeEditor key={child.id} node={child} depth={depth + 1} onUpdate={onUpdate} onDelete={onDelete} onAddChild={onAddChild} />
      ))}

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
          <input
            type="text" value={edgeLabel} onChange={(e) => setEdgeLabel(e.target.value)}
            placeholder="Branch label (optional)"
            className="w-full px-2 py-1 mb-2 bg-zinc-800 border border-zinc-700 rounded text-[10px] text-white focus:outline-none"
          />
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

function treeToFlat(root: FlowNode) {
  const nodes: any[] = [];
  const edges: any[] = [];
  let sortOrder = 0;
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

function flatToTree(nodes: any[], edges: any[]): FlowNode {
  const nodeMap = new Map<string, FlowNode>();
  for (const n of nodes) nodeMap.set(n.id, { id: n.id, type: n.type, label: n.label, config: n.config || {}, children: [] });
  const childIds = new Set<string>();
  for (const e of edges) {
    const parent = nodeMap.get(e.sourceNodeId);
    const child = nodeMap.get(e.targetNodeId);
    if (parent && child) { child.edgeLabel = e.label || undefined; parent.children.push(child); childIds.add(e.targetNodeId); }
  }
  const root = nodes.find((n: any) => !childIds.has(n.id));
  return root ? nodeMap.get(root.id)! : { id: generateId(), type: 'start', label: 'Start', config: {}, children: [] };
}

export default function FlowBuilderPage() {
  const { data: session, status } = useSession();
  const [flowName, setFlowName] = useState('New Intake Flow');
  const [flowId, setFlowId] = useState<string | null>(null);
  const [rootNode, setRootNode] = useState<FlowNode>({ id: generateId(), type: 'start', label: 'Opening', config: { greeting: '' }, children: [] });

  if (status === 'loading') return <div className="min-h-screen bg-black flex items-center justify-center"><div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>;
  if (!session) redirect('/login');

  const updateNode = (id: string, updates: Partial<FlowNode>) => {
    setRootNode((prev) => {
      const clone = JSON.parse(JSON.stringify(prev));
      function find(node: FlowNode): FlowNode | null { if (node.id === id) return node; for (const c of node.children) { const f = find(c); if (f) return f; } return null; }
      const target = find(clone);
      if (target) Object.assign(target, updates);
      return clone;
    });
  };

  const deleteNode = (id: string) => {
    setRootNode((prev) => {
      const clone = JSON.parse(JSON.stringify(prev));
      function rm(node: FlowNode) { node.children = node.children.filter((c) => c.id !== id); node.children.forEach(rm); }
      rm(clone);
      return clone;
    });
  };

  const addChild = (parentId: string, type: string, edgeLabel?: string) => {
    const newNode: FlowNode = { id: generateId(), type, label: NODE_LABELS[type], config: {}, children: [], edgeLabel };
    setRootNode((prev) => {
      const clone = JSON.parse(JSON.stringify(prev));
      function find(node: FlowNode): FlowNode | null { if (node.id === parentId) return node; for (const c of node.children) { const f = find(c); if (f) return f; } return null; }
      const parent = find(clone);
      if (parent) parent.children.push(newNode);
      return clone;
    });
  };

  const loadTemplate = async () => {
    try {
      const res = await fetch('/api/flows/templates', { method: 'POST' });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setFlowName(data.name); setFlowId(data.id);
      setRootNode(flatToTree(data.nodes, data.edges));
      toast.success('Template loaded');
    } catch { toast.error('Failed to load template'); }
  };

  const saveFlow = async () => {
    try {
      const { nodes, edges } = treeToFlat(rootNode);
      const method = flowId ? 'PUT' : 'POST';
      const url = flowId ? `/api/flows/${flowId}` : '/api/flows';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: flowName, nodes, edges }) });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setFlowId(data.id);
      toast.success('Flow saved');
    } catch { toast.error('Failed to save'); }
  };

  const activateFlow = async () => {
    if (!flowId) { toast.error('Save first'); return; }
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
          <Link href="/" className="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"><ArrowLeft className="w-4 h-4 text-zinc-400" /></Link>
          <Scale className="w-5 h-5 text-white" />
          <input type="text" value={flowName} onChange={(e) => setFlowName(e.target.value)}
            className="bg-transparent text-white font-semibold text-sm focus:outline-none border-b border-transparent focus:border-zinc-600 px-1" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadTemplate} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 hover:text-white transition-colors">
            <LayoutTemplate className="w-3 h-3" /> Load Template
          </button>
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
