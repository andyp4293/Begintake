'use client';

import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { useState, useCallback, useRef } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  BackgroundVariant,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Scale, Save, Play, ArrowLeft, Zap, LayoutTemplate } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';

// Node type colors
const NODE_COLORS: Record<string, string> = {
  start: '#22c55e',
  question: '#3b82f6',
  collect_info: '#a855f7',
  decision: '#f59e0b',
  action: '#06b6d4',
  transfer: '#f97316',
  end: '#ef4444',
};

const NODE_LABELS: Record<string, string> = {
  start: 'Start',
  question: 'Question',
  collect_info: 'Collect Info',
  decision: 'Decision',
  action: 'Action',
  transfer: 'Transfer',
  end: 'End Call',
};

// Custom node component
function FlowNodeComponent({ data, type }: { data: any; type?: string }) {
  const color = NODE_COLORS[type || 'start'] || '#666';
  return (
    <div
      className="bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 min-w-[180px] max-w-[250px] shadow-lg"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
          {NODE_LABELS[type || ''] || type}
        </span>
      </div>
      <p className="text-xs text-zinc-300 truncate">{data.label}</p>
      {data.config?.question && (
        <p className="text-[10px] text-zinc-500 mt-1 truncate">"{data.config.question}"</p>
      )}
      {data.config?.fields && (
        <p className="text-[10px] text-zinc-500 mt-1">{data.config.fields.length} field(s)</p>
      )}
    </div>
  );
}

const nodeTypes = {
  start: FlowNodeComponent,
  question: FlowNodeComponent,
  collect_info: FlowNodeComponent,
  decision: FlowNodeComponent,
  action: FlowNodeComponent,
  transfer: FlowNodeComponent,
  end: FlowNodeComponent,
};

export default function FlowBuilderPage() {
  const { data: session, status } = useSession();
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const [selectedNode, setSelectedNode] = useState<(Node & { data: any }) | null>(null);
  const [flowName, setFlowName] = useState('New Intake Flow');
  const [flowId, setFlowId] = useState<string | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) redirect('/login');

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds: any) => addEdge(params, eds));
    },
    [setEdges]
  );

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node);
  }, []);

  const addNodeToCanvas = (type: string) => {
    const id = `node-${Date.now()}`;
    const newNode: Node = {
      id,
      type,
      position: { x: 250 + Math.random() * 200, y: 100 + nodes.length * 120 },
      data: {
        label: NODE_LABELS[type] || type,
        config: type === 'start' ? { greeting: '' } :
          type === 'question' ? { question: '', options: [] } :
          type === 'collect_info' ? { fields: [] } :
          type === 'decision' ? { description: '' } :
          type === 'action' ? { actionType: 'set_flag' } :
          type === 'transfer' ? { message: '' } :
          { closingMessage: '' },
      },
    };
    setNodes((nds) => [...nds, newNode]);
  };

  const loadTemplate = async () => {
    try {
      const res = await fetch('/api/flows/templates', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to load template');
      const data = await res.json();

      // Convert to React Flow format
      const rfNodes: Node[] = data.nodes.map((n: any) => ({
        id: n.id,
        type: n.type,
        position: { x: n.positionX, y: n.positionY },
        data: { label: n.label, config: n.config },
      }));

      const rfEdges: Edge[] = data.edges.map((e: any) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        label: e.label || undefined,
        animated: true,
        style: { stroke: '#555' },
      }));

      setNodes(rfNodes);
      setEdges(rfEdges);
      setFlowName(data.name);
      setFlowId(data.id);
      toast.success('Template loaded');
    } catch {
      toast.error('Failed to load template');
    }
  };

  const saveFlow = async () => {
    try {
      const flowNodes = nodes.map((n) => ({
        id: n.id,
        type: n.type || 'start',
        label: n.data.label,
        positionX: n.position.x,
        positionY: n.position.y,
        config: n.data.config || {},
      }));

      const flowEdges = edges.map((e, i) => ({
        id: e.id,
        sourceNodeId: e.source,
        targetNodeId: e.target,
        label: typeof e.label === 'string' ? e.label : null,
        condition: null,
        sortOrder: i,
      }));

      const method = flowId ? 'PUT' : 'POST';
      const url = flowId ? `/api/flows/${flowId}` : '/api/flows';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: flowName, nodes: flowNodes, edges: flowEdges }),
      });

      if (!res.ok) throw new Error('Failed to save');
      const data = await res.json();
      setFlowId(data.id);
      toast.success('Flow saved');
    } catch {
      toast.error('Failed to save flow');
    }
  };

  const activateFlow = async () => {
    if (!flowId) {
      toast.error('Save the flow first');
      return;
    }
    try {
      const res = await fetch(`/api/flows/${flowId}/activate`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to activate');
      toast.success('Flow activated — calls will now use this script');
    } catch {
      toast.error('Failed to activate flow');
    }
  };

  return (
    <div className="h-screen bg-black flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/" className="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors">
            <ArrowLeft className="w-4 h-4 text-zinc-400" />
          </Link>
          <Scale className="w-5 h-5 text-white" />
          <input
            type="text"
            value={flowName}
            onChange={(e) => setFlowName(e.target.value)}
            className="bg-transparent text-white font-semibold text-sm focus:outline-none border-b border-transparent focus:border-zinc-600 px-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 hover:text-white transition-colors"
          >
            <LayoutTemplate className="w-3 h-3" />
            Load Template
          </button>
          <button
            onClick={saveFlow}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-300 hover:text-white transition-colors"
          >
            <Save className="w-3 h-3" />
            Save
          </button>
          <button
            onClick={activateFlow}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg text-xs text-black font-medium hover:bg-zinc-200 transition-colors"
          >
            <Zap className="w-3 h-3" />
            Activate
          </button>
        </div>
      </header>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Node Palette */}
        <div className="w-48 border-r border-zinc-800 p-3 space-y-2 shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-3">Add Nodes</p>
          {Object.entries(NODE_LABELS).map(([type, label]) => (
            <button
              key={type}
              onClick={() => addNodeToCanvas(type)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 hover:border-zinc-600 hover:text-white transition-colors"
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: NODE_COLORS[type] }} />
              {label}
            </button>
          ))}
        </div>

        {/* Canvas */}
        <div className="flex-1" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            className="bg-zinc-950"
            defaultEdgeOptions={{ animated: true, style: { stroke: '#555' } }}
          >
            <Controls className="!bg-zinc-800 !border-zinc-700 !text-white [&>button]:!bg-zinc-800 [&>button]:!border-zinc-700 [&>button]:!text-white [&>button:hover]:!bg-zinc-700" />
            <Background variant={BackgroundVariant.Dots} color="#333" gap={20} />
          </ReactFlow>
        </div>

        {/* Config Panel */}
        {selectedNode && (
          <div className="w-72 border-l border-zinc-800 p-4 overflow-y-auto shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white">Node Config</h3>
              <button onClick={() => setSelectedNode(null)} className="text-xs text-zinc-500 hover:text-white">
                Close
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Type</label>
                <p className="text-xs text-zinc-300 capitalize">{selectedNode.type}</p>
              </div>

              <div>
                <label className="block text-[10px] font-medium text-zinc-500 mb-1">Label</label>
                <input
                  type="text"
                  value={selectedNode.data.label as string}
                  onChange={(e) => {
                    setNodes((nds) =>
                      nds.map((n) =>
                        n.id === selectedNode.id
                          ? { ...n, data: { ...n.data, label: e.target.value } }
                          : n
                      )
                    );
                    setSelectedNode({ ...selectedNode, data: { ...selectedNode.data, label: e.target.value } });
                  }}
                  className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-zinc-500"
                />
              </div>

              {(selectedNode.type === 'start' || selectedNode.type === 'transfer') && (
                <div>
                  <label className="block text-[10px] font-medium text-zinc-500 mb-1">
                    {selectedNode.type === 'start' ? 'Greeting' : 'Transfer Message'}
                  </label>
                  <textarea
                    value={selectedNode.data.config?.greeting || selectedNode.data.config?.message || ''}
                    onChange={(e) => {
                      const key = selectedNode.type === 'start' ? 'greeting' : 'message';
                      const newConfig = { ...selectedNode.data.config, [key]: e.target.value };
                      setNodes((nds) =>
                        nds.map((n) =>
                          n.id === selectedNode.id
                            ? { ...n, data: { ...n.data, config: newConfig } }
                            : n
                        )
                      );
                      setSelectedNode({ ...selectedNode, data: { ...selectedNode.data, config: newConfig } });
                    }}
                    rows={4}
                    className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-zinc-500 resize-none"
                  />
                </div>
              )}

              {selectedNode.type === 'question' && (
                <div>
                  <label className="block text-[10px] font-medium text-zinc-500 mb-1">Question</label>
                  <textarea
                    value={selectedNode.data.config?.question || ''}
                    onChange={(e) => {
                      const newConfig = { ...selectedNode.data.config, question: e.target.value };
                      setNodes((nds) =>
                        nds.map((n) =>
                          n.id === selectedNode.id
                            ? { ...n, data: { ...n.data, config: newConfig } }
                            : n
                        )
                      );
                      setSelectedNode({ ...selectedNode, data: { ...selectedNode.data, config: newConfig } });
                    }}
                    rows={3}
                    className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-zinc-500 resize-none"
                  />
                </div>
              )}

              {selectedNode.type === 'action' && (
                <div>
                  <label className="block text-[10px] font-medium text-zinc-500 mb-1">Petition Type</label>
                  <input
                    type="text"
                    value={selectedNode.data.config?.petitionType || ''}
                    onChange={(e) => {
                      const newConfig = { ...selectedNode.data.config, petitionType: e.target.value };
                      setNodes((nds) =>
                        nds.map((n) =>
                          n.id === selectedNode.id
                            ? { ...n, data: { ...n.data, config: newConfig } }
                            : n
                        )
                      );
                      setSelectedNode({ ...selectedNode, data: { ...selectedNode.data, config: newConfig } });
                    }}
                    placeholder="e.g. V-Petition — new"
                    className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-zinc-500"
                  />
                </div>
              )}

              {selectedNode.type === 'end' && (
                <div>
                  <label className="block text-[10px] font-medium text-zinc-500 mb-1">Closing Message</label>
                  <textarea
                    value={selectedNode.data.config?.closingMessage || ''}
                    onChange={(e) => {
                      const newConfig = { ...selectedNode.data.config, closingMessage: e.target.value };
                      setNodes((nds) =>
                        nds.map((n) =>
                          n.id === selectedNode.id
                            ? { ...n, data: { ...n.data, config: newConfig } }
                            : n
                        )
                      );
                      setSelectedNode({ ...selectedNode, data: { ...selectedNode.data, config: newConfig } });
                    }}
                    rows={2}
                    className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-white focus:outline-none focus:border-zinc-500 resize-none"
                  />
                </div>
              )}

              <button
                onClick={() => {
                  setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
                  setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
                  setSelectedNode(null);
                }}
                className="w-full mt-4 px-3 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Delete Node
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
