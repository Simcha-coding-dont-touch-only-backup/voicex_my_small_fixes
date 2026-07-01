import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { apiGet, apiPost, apiPatch, apiDelete, apiUpload } from '../lib/api';
import IvrNodeComponent from '../components/ivr/IvrNodeComponent';
import {
  Plus, Play, Copy, Save, X, ChevronDown,
  Trash2, ArrowLeft, Map, List, LayoutList, Check, Loader2, Pencil, PencilOff,
} from 'lucide-react';
import IvrRowView from '../components/ivr/IvrRowView';
import IvrListView from '../components/ivr/IvrListView';

interface IvrNodeData {
  id: string;
  node_key: string;
  node_type: string;
  handler_name: string | null;
  prompt_text: string | null;
  config: any;
  position_x: number;
  position_y: number;
  flow_version_id: string;
}

interface IvrEdgeData {
  id: string;
  source_node_id: string;
  target_node_id: string;
  condition_type: string;
  condition_value: string | null;
  priority: number;
  flow_version_id: string;
}

interface FlowVersion {
  id: string;
  version_number: number;
  status: string;
  published_at: string | null;
}

interface Flow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  ivr_flow_versions: FlowVersion[];
}

const nodeTypes = { ivrNode: IvrNodeComponent };

const EDGE_STYLE = { stroke: '#94a3b8', strokeWidth: 2 };
const SELECTED_EDGE_STYLE = { stroke: '#6366f1', strokeWidth: 2.5 };

function toRFNodes(nodes: IvrNodeData[]): RFNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: 'ivrNode',
    position: { x: n.position_x, y: n.position_y },
    data: {
      node_key: n.node_key,
      node_type: n.node_type,
      handler_name: n.handler_name,
      prompt_text: n.prompt_text,
      config: n.config,
      intents_count: n.config?.intents?.length || 0,
    },
  }));
}

function toRFEdges(edges: IvrEdgeData[]): RFEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
    label: e.condition_value || e.condition_type,
    style: EDGE_STYLE,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
    data: { condition_type: e.condition_type, condition_value: e.condition_value, priority: e.priority },
  }));
}

export function IvrFlowsPage() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [selectedFlow, setSelectedFlow] = useState<Flow | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<FlowVersion | null>(null);
  const [rawNodes, setRawNodes] = useState<IvrNodeData[]>([]);
  const [rawEdges, setRawEdges] = useState<IvrEdgeData[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([] as RFNode[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([] as RFEdge[]);
  const [selectedNode, setSelectedNode] = useState<IvrNodeData | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<IvrEdgeData | null>(null);
  const [handlerNames, setHandlerNames] = useState<string[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [showAddNode, setShowAddNode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'map' | 'rows' | 'list'>('rows');
  const positionsDirty = useRef(false);
  const [panelWidth, setPanelWidth] = useState(320);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = containerRect.right - ev.clientX;
      setPanelWidth(Math.max(200, Math.min(newWidth, containerRect.width - 300)));
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const isDraft = selectedVersion?.status === 'draft';
  const isPublished = selectedVersion?.status === 'published';
  const [editing, setEditing] = useState(false);
  const canEdit = isDraft || editing;

  const loadFlows = useCallback(async () => {
    try {
      const res = await apiGet<any>('/ivr/flows');
      setFlows(res.data || []);
    } catch (err) {
      console.error('Failed to load IVR flows:', err);
    }
  }, []);

  const loadHandlers = useCallback(async () => {
    try {
      const res = await apiGet<any>('/ivr/handlers');
      setHandlerNames(res.data || []);
    } catch (err) {
      console.error('Failed to load handlers:', err);
    }
  }, []);

  useEffect(() => {
    loadFlows();
    loadHandlers();
  }, [loadFlows, loadHandlers]);

  const loadVersion = useCallback(async (flow: Flow, version: FlowVersion) => {
    setSelectedFlow(flow);
    setSelectedVersion(version);
    setSelectedNode(null);
    setSelectedEdge(null);
    setEditing(false);

    const res = await apiGet<any>(`/ivr/flows/${flow.id}/versions/${version.id}`);
    const vNodes: IvrNodeData[] = res.data.nodes || [];
    const vEdges: IvrEdgeData[] = res.data.edges || [];
    setRawNodes(vNodes);
    setRawEdges(vEdges);
    setNodes(toRFNodes(vNodes));
    setEdges(toRFEdges(vEdges));
  }, [setNodes, setEdges]);

  const onNodeClick = useCallback((_: any, node: RFNode) => {
    const raw = rawNodes.find((n) => n.id === node.id);
    setSelectedNode(raw || null);
    setSelectedEdge(null);
  }, [rawNodes]);

  const onEdgeClick = useCallback((_: any, edge: RFEdge) => {
    const raw = rawEdges.find((e) => e.id === edge.id);
    setSelectedEdge(raw || null);
    setSelectedNode(null);

    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        style: e.id === edge.id ? SELECTED_EDGE_STYLE : EDGE_STYLE,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: e.id === edge.id ? '#6366f1' : '#94a3b8',
        },
      }))
    );
  }, [rawEdges, setEdges]);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        style: EDGE_STYLE,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
      }))
    );
  }, [setEdges]);

  const invalidateRuntimeCache = useCallback(async () => {
    if (!selectedFlow || !selectedVersion) return;
    await apiPost(`/ivr/flows/${selectedFlow.id}/versions/${selectedVersion.id}/invalidate-cache`, {});
  }, [selectedFlow, selectedVersion]);

  const onConnect = useCallback(async (connection: Connection) => {
    if (!selectedVersion || !canEdit) return;
    const res = await apiPost<any>('/ivr/edges', {
      flow_version_id: selectedVersion.id,
      source_node_id: connection.source,
      target_node_id: connection.target,
      condition_type: 'default',
      condition_value: null,
      priority: 0,
    });
    if (res.data) {
      const newEdge: IvrEdgeData = res.data;
      setRawEdges((prev) => [...prev, newEdge]);
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: newEdge.id,
            label: 'default',
            style: EDGE_STYLE,
            markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
            data: { condition_type: 'default', condition_value: null, priority: 0 },
          },
          eds
        )
      );
      if (isPublished && editing) await invalidateRuntimeCache();
    }
  }, [selectedVersion, canEdit, isPublished, editing, invalidateRuntimeCache, setEdges]);

  const onNodeDragStop = useCallback((_: any, node: RFNode) => {
    setRawNodes((prev) =>
      prev.map((n) =>
        n.id === node.id ? { ...n, position_x: node.position.x, position_y: node.position.y } : n
      )
    );
    positionsDirty.current = true;
  }, []);

  const savePositions = useCallback(async () => {
    if (!positionsDirty.current) return;
    setSaving(true);
    const positions = rawNodes.map((n) => ({
      id: n.id,
      position_x: n.position_x,
      position_y: n.position_y,
    }));
    await apiPatch('/ivr/nodes/batch/positions', { positions });
    positionsDirty.current = false;
    setSaving(false);
  }, [rawNodes]);

  const handleCreateFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiPost('/ivr/flows', createForm);
    setShowCreate(false);
    setCreateForm({ name: '', description: '' });
    loadFlows();
  };

  const handlePublish = async () => {
    if (!selectedFlow || !selectedVersion) return;
    if (!confirm('Publish this version? It will become the active IVR flow for all calls.')) return;
    await apiPost(`/ivr/flows/${selectedFlow.id}/versions/${selectedVersion.id}/publish`, {});
    setSelectedVersion({ ...selectedVersion, status: 'published', published_at: new Date().toISOString() });
    loadFlows();
  };

  const handleClone = async () => {
    if (!selectedFlow || !selectedVersion) return;
    const res = await apiPost<any>(`/ivr/flows/${selectedFlow.id}/versions/${selectedVersion.id}/clone`, {});
    if (res.data) {
      await loadFlows();
      const updatedFlows = await apiGet<any>('/ivr/flows');
      const flow = (updatedFlows.data || []).find((f: Flow) => f.id === selectedFlow.id);
      if (flow) {
        const newVer = flow.ivr_flow_versions.find((v: FlowVersion) => v.id === res.data.id);
        if (newVer) loadVersion(flow, newVer);
      }
    }
  };

  const handleDeleteEdge = async () => {
    if (!selectedEdge) return;
    await apiDelete(`/ivr/edges/${selectedEdge.id}`);
    setRawEdges((prev) => prev.filter((e) => e.id !== selectedEdge.id));
    setEdges((eds) => eds.filter((e) => e.id !== selectedEdge.id));
    setSelectedEdge(null);
    if (isPublished && editing) await invalidateRuntimeCache();
  };

  const handleDeleteNode = async (nodeId: string) => {
    await apiDelete(`/ivr/nodes/${nodeId}`);
    setRawNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setRawEdges((prev) => prev.filter((e) => e.source_node_id !== nodeId && e.target_node_id !== nodeId));
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedNode(null);
    if (isPublished && editing) await invalidateRuntimeCache();
  };

  const handleUpdateNode = async (nodeId: string, updates: Partial<IvrNodeData>) => {
    const res = await apiPatch<any>(`/ivr/nodes/${nodeId}`, updates);
    if (res.data) {
      setRawNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, ...res.data } : n)));
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  node_key: res.data.node_key,
                  node_type: res.data.node_type,
                  handler_name: res.data.handler_name,
                  prompt_text: res.data.prompt_text,
                  config: res.data.config,
                  intents_count: res.data.config?.intents?.length || 0,
                },
              }
            : n
        )
      );
      setSelectedNode(res.data);
      if (isPublished && editing) await invalidateRuntimeCache();
    }
  };

  const handleUpdateEdge = async (edgeId: string, updates: Partial<IvrEdgeData>) => {
    const res = await apiPatch<any>(`/ivr/edges/${edgeId}`, updates);
    if (res.data) {
      setRawEdges((prev) => prev.map((e) => (e.id === edgeId ? { ...e, ...res.data } : e)));
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edgeId
            ? {
                ...e,
                label: res.data.condition_value || res.data.condition_type,
                data: { condition_type: res.data.condition_type, condition_value: res.data.condition_value, priority: res.data.priority },
              }
            : e
        )
      );
      setSelectedEdge(res.data);
      if (isPublished && editing) await invalidateRuntimeCache();
    }
  };

  const handleAddNode = async (nodeData: Partial<IvrNodeData>) => {
    if (!selectedVersion) return;
    const res = await apiPost<any>('/ivr/nodes', {
      flow_version_id: selectedVersion.id,
      ...nodeData,
    });
    if (res.data) {
      setRawNodes((prev) => [...prev, res.data]);
      setNodes((nds) => [...nds, ...toRFNodes([res.data])]);
      setShowAddNode(false);
      if (isPublished && editing) await invalidateRuntimeCache();
    }
  };

  // Flow list view
  if (!selectedFlow || !selectedVersion) {
    return (
      <div>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-800">IVR Flows</h2>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
          >
            <Plus size={16} /> New Flow
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreateFlow} className="mb-6 rounded-xl bg-white p-6 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-gray-600">Name</label>
                <input
                  required
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-600">Description</label>
                <input
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  className="mt-1 w-full rounded border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="submit" className="rounded bg-indigo-600 px-4 py-2 text-sm text-white">Create</button>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded border px-4 py-2 text-sm">Cancel</button>
            </div>
          </form>
        )}

        <div className="space-y-4">
          {flows.map((flow) => (
            <div key={flow.id} className="rounded-xl bg-white shadow-sm">
              <div className="px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-800">{flow.name}</h3>
                    <p className="text-xs text-gray-400">{flow.description || 'No description'}</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      flow.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {flow.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="space-y-2">
                  {flow.ivr_flow_versions
                    ?.sort((a, b) => b.version_number - a.version_number)
                    .map((ver) => (
                      <div key={ver.id} className="flex items-center justify-between rounded border px-4 py-2">
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-sm">v{ver.version_number}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              ver.status === 'published'
                                ? 'bg-green-100 text-green-700'
                                : ver.status === 'draft'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {ver.status}
                          </span>
                        </div>
                        <button
                          onClick={() => loadVersion(flow, ver)}
                          className="rounded bg-indigo-600 px-3 py-1 text-xs text-white hover:bg-indigo-700"
                        >
                          View
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          ))}

          {flows.length === 0 && (
            <div className="rounded-xl bg-white py-12 text-center text-gray-400 shadow-sm">
              No IVR flows yet. Create one to get started.
            </div>
          )}
        </div>
      </div>
    );
  }

  // Flow editor view
  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      {/* Toolbar */}
      <div className="flex items-center justify-between bg-white rounded-t-xl border px-4 py-2 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setSelectedFlow(null);
              setSelectedVersion(null);
            }}
            className="rounded p-1 hover:bg-gray-100"
          >
            <ArrowLeft size={18} />
          </button>
          <span className="font-semibold text-gray-800">{selectedFlow.name}</span>
          <span className="text-sm text-gray-500">v{selectedVersion.version_number}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              isPublished && editing
                ? 'bg-amber-100 text-amber-700'
                : selectedVersion.status === 'published'
                ? 'bg-green-100 text-green-700'
                : selectedVersion.status === 'draft'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {isPublished && editing ? 'editing live' : selectedVersion.status}
          </span>

          <div className="flex items-center rounded-lg border p-0.5 ml-3">
            <button
              onClick={() => setViewMode('map')}
              className={`rounded p-1.5 transition-colors ${viewMode === 'map' ? 'bg-indigo-100 text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
              title="Map View"
            >
              <Map size={16} />
            </button>
            <button
              onClick={() => setViewMode('rows')}
              className={`rounded p-1.5 transition-colors ${viewMode === 'rows' ? 'bg-indigo-100 text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
              title="Row View"
            >
              <List size={16} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`rounded p-1.5 transition-colors ${viewMode === 'list' ? 'bg-indigo-100 text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
              title="List View"
            >
              <LayoutList size={16} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isPublished && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-100"
            >
              <Pencil size={14} /> Edit Live Version
            </button>
          )}
          {isPublished && editing && (
            <button
              onClick={() => setEditing(false)}
              className="flex items-center gap-1 rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              <PencilOff size={14} /> Stop Editing
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => setShowAddNode(true)}
              className="flex items-center gap-1 rounded border px-3 py-1.5 text-xs hover:bg-gray-50"
            >
              <Plus size={14} /> Add Node
            </button>
          )}
          {viewMode === 'map' && (
            <button
              onClick={savePositions}
              disabled={saving}
              className="flex items-center gap-1 rounded border px-3 py-1.5 text-xs hover:bg-gray-50"
            >
              <Save size={14} /> {saving ? 'Saving...' : 'Save Layout'}
            </button>
          )}
          <button
            onClick={handleClone}
            className="flex items-center gap-1 rounded border px-3 py-1.5 text-xs hover:bg-gray-50"
          >
            <Copy size={14} /> Clone as Draft
          </button>
          {isDraft && (
            <button
              onClick={handlePublish}
              className="flex items-center gap-1 rounded bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700"
            >
              <Play size={14} /> Publish
            </button>
          )}
        </div>
      </div>

      <div ref={containerRef} className="flex flex-1 border-x border-b rounded-b-xl overflow-hidden">
        {/* Canvas / Row View */}
        <div className="flex-1 min-w-0">
          {viewMode === 'map' ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={canEdit ? onNodesChange : undefined}
              onEdgesChange={canEdit ? onEdgesChange : undefined}
              onConnect={canEdit ? onConnect : undefined}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onPaneClick={onPaneClick}
              onNodeDragStop={canEdit ? onNodeDragStop : undefined}
              nodesDraggable={canEdit}
              nodesConnectable={canEdit}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              defaultEdgeOptions={{
                style: EDGE_STYLE,
                markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
              }}
            >
              <Controls />
              <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
              <MiniMap
                nodeStrokeWidth={3}
                pannable
                zoomable
                className="!bg-gray-50"
              />
            </ReactFlow>
          ) : viewMode === 'rows' ? (
            <IvrRowView
              nodes={rawNodes}
              edges={rawEdges}
              selectedNodeId={selectedNode?.id ?? null}
              selectedEdgeId={selectedEdge?.id ?? null}
              onNodeClick={(nodeId) => {
                const raw = rawNodes.find((n) => n.id === nodeId);
                setSelectedNode(raw || null);
                setSelectedEdge(null);
              }}
              onEdgeClick={(edgeId) => {
                const raw = rawEdges.find((e) => e.id === edgeId);
                setSelectedEdge(raw || null);
                setSelectedNode(null);
              }}
            />
          ) : (
            <IvrListView
              nodes={rawNodes}
              selectedNodeId={selectedNode?.id ?? null}
              onNodeClick={(nodeId) => {
                const raw = rawNodes.find((n) => n.id === nodeId);
                setSelectedNode(raw || null);
                setSelectedEdge(null);
              }}
            />
          )}
        </div>

        {/* Draggable divider + Right Panel */}
        {(selectedNode || selectedEdge) && (
          <>
            <div
              onMouseDown={handleDragStart}
              className="w-1 cursor-col-resize bg-gray-200 hover:bg-indigo-400 active:bg-indigo-500 transition-colors shrink-0"
            />
            <div className="bg-white overflow-y-auto shrink-0" style={{ width: panelWidth }}>
              {selectedNode && (
                <NodeEditPanel
                  node={selectedNode}
                  handlerNames={handlerNames}
                  canEdit={canEdit}
                  onUpdate={handleUpdateNode}
                  onDelete={handleDeleteNode}
                  onClose={() => setSelectedNode(null)}
                />
              )}
              {selectedEdge && (
                <EdgeEditPanel
                  edge={selectedEdge}
                  canEdit={canEdit}
                  nodes={rawNodes}
                  onUpdate={handleUpdateEdge}
                  onDelete={handleDeleteEdge}
                  onClose={() => setSelectedEdge(null)}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Add Node Modal */}
      {showAddNode && canEdit && (
        <AddNodeModal
          handlerNames={handlerNames}
          onAdd={handleAddNode}
          onClose={() => setShowAddNode(false)}
        />
      )}
    </div>
  );
}

function NodeEditPanel({
  node,
  handlerNames,
  canEdit,
  onUpdate,
  onDelete,
  onClose,
}: {
  node: IvrNodeData;
  handlerNames: string[];
  canEdit: boolean;
  onUpdate: (id: string, updates: Partial<IvrNodeData>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const initialForm = (n: IvrNodeData) => ({
    node_key: n.node_key,
    node_type: n.node_type,
    handler_name: n.handler_name || '',
    prompt_text: n.prompt_text || '',
    input_type: n.config?.input_type || 'dtmf_speech',
    timeout: String(n.config?.timeout_seconds || 10),
    num_digits: String(n.config?.num_digits || ''),
    finish_on_key: n.config?.finish_on_key || '',
    ignore_bare_terminator: n.config?.ignore_bare_terminator || false,
    speech_hints: (n.config?.speech_hints || []).join(', '),
    prompt_audio_url: n.config?.prompt_audio_url || '',
    prompt_audio_path: n.config?.prompt_audio_path || '',
    intents_json: JSON.stringify(n.config?.intents || [], null, 2),
  });

  const [form, setForm] = useState(() => initialForm(node));
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setForm(initialForm(node));
    setSaveStatus('idle');
    setConfirmRemove(false);
  }, [node]);

  const persist = async (f: typeof form) => {
    let intents = [];
    try { intents = JSON.parse(f.intents_json); } catch { /* keep existing */ }

    setSaveStatus('saving');
    try {
      await onUpdate(node.id, {
        node_key: f.node_key,
        node_type: f.node_type,
        handler_name: f.handler_name || null,
        prompt_text: f.prompt_text,
        config: {
          input_type: f.input_type,
          timeout_seconds: parseInt(f.timeout) || 10,
          num_digits: f.num_digits ? parseInt(f.num_digits) : undefined,
          finish_on_key: f.finish_on_key || undefined,
          ignore_bare_terminator: f.ignore_bare_terminator ?? undefined,
          speech_hints: f.speech_hints ? f.speech_hints.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
          prompt_audio_url: f.prompt_audio_url || undefined,
          prompt_audio_path: f.prompt_audio_path || undefined,
          intents,
        },
      } as any);
      setSaveStatus('saved');
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const handleSave = () => persist(form);

  // Upload a prompt recording, then persist immediately so it takes effect.
  const handleAudioFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file later
    if (!file) return;

    setUploading(true);
    try {
      const res = await apiUpload<{ data: { url: string; path: string } }>(
        `/ivr/nodes/${node.id}/audio`,
        file,
      );
      const next = { ...form, prompt_audio_url: res.data.url, prompt_audio_path: res.data.path };
      setForm(next);
      await persist(next);
    } catch (err) {
      alert(`Upload failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setUploading(false);
    }
  };

  // Remove the recording: clear the reference and save first (so nothing points
  // at it), then best-effort delete the stored file.
  const handleAudioRemove = async () => {
    setConfirmRemove(false);
    const path = form.prompt_audio_path;
    const next = { ...form, prompt_audio_url: '', prompt_audio_path: '' };
    setForm(next);
    await persist(next);
    if (path) {
      try {
        await apiDelete(`/ivr/nodes/${node.id}/audio?path=${encodeURIComponent(path)}`);
      } catch { /* orphaned file is harmless; ignore */ }
    }
  };

  const audioFileName = form.prompt_audio_path ? form.prompt_audio_path.split('/').pop() : '';

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">Node Properties</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
      </div>

      <div className="space-y-3">
        <Field label="Key">
          <input disabled={!canEdit} value={form.node_key} onChange={(e) => setForm({ ...form, node_key: e.target.value })}
            className="w-full rounded border px-2 py-1.5 text-sm font-mono" />
        </Field>

        <Field label="Type">
          <select disabled={!canEdit} value={form.node_type} onChange={(e) => setForm({ ...form, node_type: e.target.value })}
            className="w-full rounded border px-2 py-1.5 text-sm">
            {['entry', 'menu', 'input', 'action', 'branch', 'hangup', 'submenu', 'transfer'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>

        <Field label="Handler">
          <select disabled={!canEdit} value={form.handler_name} onChange={(e) => setForm({ ...form, handler_name: e.target.value })}
            className="w-full rounded border px-2 py-1.5 text-sm">
            <option value="">(none)</option>
            {handlerNames.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </Field>

        <Field label="Prompt Text">
          <textarea disabled={!canEdit} value={form.prompt_text} onChange={(e) => setForm({ ...form, prompt_text: e.target.value })}
            className="w-full rounded border px-2 py-1.5 text-sm" rows={4} />
        </Field>

        <Field label="Recording">
          <input ref={fileInputRef} type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/ogg,.mp3,.wav,.m4a,.ogg"
            className="hidden" onChange={handleAudioFile} />
          {form.prompt_audio_url ? (
            <div className="flex items-center gap-2 text-sm">
              <button type="button" title="Listen" onClick={() => { void new Audio(form.prompt_audio_url).play(); }}
                className="text-indigo-600 hover:text-indigo-700 shrink-0">
                <Play size={16} />
              </button>
              <span className="text-gray-700 truncate flex-1">{audioFileName}</span>
              {canEdit && (
                <button type="button" title="Remove" disabled={uploading} onClick={() => setConfirmRemove(true)}
                  className="text-gray-400 hover:text-red-600 shrink-0 disabled:opacity-50">
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ) : (
            canEdit && (
              <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={16} />}
                {uploading ? 'Uploading...' : 'Upload a file'}
              </button>
            )
          )}
        </Field>

        <Field label="Input Type">
          <select disabled={!canEdit} value={form.input_type} onChange={(e) => setForm({ ...form, input_type: e.target.value })}
            className="w-full rounded border px-2 py-1.5 text-sm">
            <option value="dtmf">DTMF</option>
            <option value="speech">Speech</option>
            <option value="dtmf_speech">DTMF + Speech</option>
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Timeout (s)">
            <input disabled={!canEdit} type="number" value={form.timeout} onChange={(e) => setForm({ ...form, timeout: e.target.value })}
              className="w-full rounded border px-2 py-1.5 text-sm" />
          </Field>
          <Field label="Num Digits">
            <input disabled={!canEdit} type="number" value={form.num_digits} onChange={(e) => setForm({ ...form, num_digits: e.target.value })}
              className="w-full rounded border px-2 py-1.5 text-sm" />
          </Field>
        </div>

        <Field label="Finish On Key">
          <input disabled={!canEdit} value={form.finish_on_key} onChange={(e) => setForm({ ...form, finish_on_key: e.target.value })}
            className="w-full rounded border px-2 py-1.5 text-sm" placeholder="# or empty" />
        </Field>

        {['menu', 'submenu', 'branch'].includes(form.node_type) && (
          <Field label="Ignore Bare #">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={form.ignore_bare_terminator}
                onChange={(e) => setForm({ ...form, ignore_bare_terminator: e.target.checked })}
              />
              Ignore a lone # (stops the menu re-prompt / doubling)
            </label>
          </Field>
        )}

        <Field label="Speech Hints (comma-separated)">
          <input disabled={!canEdit} value={form.speech_hints} onChange={(e) => setForm({ ...form, speech_hints: e.target.value })}
            className="w-full rounded border px-2 py-1.5 text-sm" />
        </Field>

        <Field label="Intents (JSON)">
          <textarea disabled={!canEdit} value={form.intents_json} onChange={(e) => setForm({ ...form, intents_json: e.target.value })}
            className="w-full rounded border px-2 py-1.5 text-sm font-mono" rows={6} />
        </Field>

        {canEdit && (
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className={`flex-1 rounded px-3 py-2 text-sm text-white flex items-center justify-center gap-1.5 transition-colors ${
                saveStatus === 'saved'
                  ? 'bg-green-600'
                  : saveStatus === 'error'
                    ? 'bg-red-600'
                    : 'bg-indigo-600 hover:bg-indigo-700'
              } disabled:opacity-60`}
            >
              {saveStatus === 'saving' && <Loader2 size={14} className="animate-spin" />}
              {saveStatus === 'saved' && <Check size={14} />}
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : saveStatus === 'error' ? 'Failed to save' : 'Save Node'}
            </button>
            <button onClick={() => { if (confirm('Delete this node?')) onDelete(node.id); }}
              className="rounded border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      {confirmRemove && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-[380px]">
            <h4 className="font-semibold text-gray-900 mb-2">Delete recording?</h4>
            <p className="text-sm text-gray-600 mb-5">
              This will permanently remove the recording{audioFileName ? ` "${audioFileName}"` : ''} from this node. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmRemove(false)}
                className="rounded border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleAudioRemove}
                className="rounded bg-red-600 px-4 py-1.5 text-sm text-white hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EdgeEditPanel({
  edge,
  canEdit,
  nodes,
  onUpdate,
  onDelete,
  onClose,
}: {
  edge: IvrEdgeData;
  canEdit: boolean;
  nodes: IvrNodeData[];
  onUpdate: (id: string, updates: Partial<IvrEdgeData>) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    condition_type: edge.condition_type,
    condition_value: edge.condition_value || '',
    priority: String(edge.priority),
  });

  useEffect(() => {
    setForm({
      condition_type: edge.condition_type,
      condition_value: edge.condition_value || '',
      priority: String(edge.priority),
    });
  }, [edge]);

  const sourceName = nodes.find((n) => n.id === edge.source_node_id)?.node_key || '?';
  const targetName = nodes.find((n) => n.id === edge.target_node_id)?.node_key || '?';

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">Edge Properties</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
      </div>

      <div className="mb-3 rounded bg-gray-50 p-2 text-xs text-gray-600">
        <span className="font-mono">{sourceName}</span> → <span className="font-mono">{targetName}</span>
      </div>

      <div className="space-y-3">
        <Field label="Condition Type">
          <select disabled={!canEdit} value={form.condition_type} onChange={(e) => setForm({ ...form, condition_type: e.target.value })}
            className="w-full rounded border px-2 py-1.5 text-sm">
            {['intent', 'default', 'timeout', 'error', 'match'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>

        <Field label="Condition Value">
          <input disabled={!canEdit} value={form.condition_value} onChange={(e) => setForm({ ...form, condition_value: e.target.value })}
            className="w-full rounded border px-2 py-1.5 text-sm font-mono" placeholder="e.g. catalog, confirmed" />
        </Field>

        <Field label="Priority">
          <input disabled={!canEdit} type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
            className="w-full rounded border px-2 py-1.5 text-sm" />
        </Field>

        {canEdit && (
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => onUpdate(edge.id, {
                condition_type: form.condition_type,
                condition_value: form.condition_value || null,
                priority: parseInt(form.priority) || 0,
              })}
              className="flex-1 rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
            >
              Save Edge
            </button>
            <button onClick={() => { if (confirm('Delete this edge?')) onDelete(); }}
              className="rounded border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AddNodeModal({
  handlerNames,
  onAdd,
  onClose,
}: {
  handlerNames: string[];
  onAdd: (data: any) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    node_key: '',
    node_type: 'menu',
    handler_name: '',
    prompt_text: '',
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-800">Add Node</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        <div className="space-y-3">
          <Field label="Node Key">
            <input value={form.node_key} onChange={(e) => setForm({ ...form, node_key: e.target.value })}
              className="w-full rounded border px-3 py-2 text-sm" placeholder="e.g. my_new_step" />
          </Field>

          <Field label="Type">
            <select value={form.node_type} onChange={(e) => setForm({ ...form, node_type: e.target.value })}
              className="w-full rounded border px-3 py-2 text-sm">
              {['entry', 'menu', 'input', 'action', 'branch', 'hangup', 'submenu', 'transfer'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>

          <Field label="Handler">
            <select value={form.handler_name} onChange={(e) => setForm({ ...form, handler_name: e.target.value })}
              className="w-full rounded border px-3 py-2 text-sm">
              <option value="">(none)</option>
              {handlerNames.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </Field>

          <Field label="Prompt Text">
            <textarea value={form.prompt_text} onChange={(e) => setForm({ ...form, prompt_text: e.target.value })}
              className="w-full rounded border px-3 py-2 text-sm" rows={3} />
          </Field>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={() =>
              onAdd({
                node_key: form.node_key,
                node_type: form.node_type,
                handler_name: form.handler_name || null,
                prompt_text: form.prompt_text,
                config: {},
                position_x: 300 + Math.random() * 200,
                position_y: 300 + Math.random() * 200,
              })
            }
            disabled={!form.node_key}
            className="flex-1 rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Add Node
          </button>
          <button onClick={onClose} className="rounded border px-4 py-2 text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-500 mb-1 block">{label}</label>
      {children}
    </div>
  );
}
