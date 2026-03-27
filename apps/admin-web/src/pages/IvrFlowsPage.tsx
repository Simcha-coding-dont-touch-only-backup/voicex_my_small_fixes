import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../lib/api';
import { Plus, Play, Eye, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

export function IvrFlowsPage() {
  const [flows, setFlows] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [versionDetail, setVersionDetail] = useState<any>(null);

  const load = () => apiGet<any>('/ivr/flows').then((r) => setFlows(r.data || []));

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiPost('/ivr/flows', createForm);
    setShowCreate(false);
    setCreateForm({ name: '', description: '' });
    load();
  };

  const handlePublish = async (flowId: string, versionId: string) => {
    if (!confirm('Publish this version? It will become the active IVR flow.')) return;
    await apiPost(`/ivr/flows/${flowId}/versions/${versionId}/publish`, {});
    load();
  };

  const loadVersion = async (flowId: string, versionId: string) => {
    const res = await apiGet<any>(`/ivr/flows/${flowId}/versions/${versionId}`);
    setVersionDetail(res.data);
  };

  // --- Node management ---
  const [nodeForm, setNodeForm] = useState({
    node_key: '', node_type: 'menu', prompt_text: '', handler_name: '',
    input_type: 'dtmf speech', timeout: '5', intents_json: '[]',
  });

  const handleAddNode = async (flowVersionId: string) => {
    let intents = [];
    try { intents = JSON.parse(nodeForm.intents_json); } catch { /* empty */ }

    await apiPost('/ivr/nodes', {
      flow_version_id: flowVersionId,
      node_key: nodeForm.node_key,
      node_type: nodeForm.node_type,
      prompt_text: nodeForm.prompt_text,
      handler_name: nodeForm.handler_name || null,
      config: {
        input_type: nodeForm.input_type,
        timeout_seconds: parseInt(nodeForm.timeout),
        intents,
      },
    });

    setNodeForm({
      node_key: '', node_type: 'menu', prompt_text: '', handler_name: '',
      input_type: 'dtmf speech', timeout: '5', intents_json: '[]',
    });

    if (expanded) {
      const flow = flows.find((f) => f.ivr_flow_versions?.some((v: any) => v.id === flowVersionId));
      if (flow) loadVersion(flow.id, flowVersionId);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-800">IVR Flows</h2>
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
          <Plus size={16} /> New Flow
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-6 rounded-xl bg-white p-6 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-gray-600">Name</label>
              <input required value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-600">Description</label>
              <input value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm" />
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
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <h3 className="font-semibold text-gray-800">{flow.name}</h3>
                <p className="text-xs text-gray-400">{flow.description || 'No description'}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${flow.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {flow.is_active ? 'Active' : 'Inactive'}
                </span>
                <button onClick={() => {
                  if (expanded === flow.id) { setExpanded(null); setVersionDetail(null); }
                  else { setExpanded(flow.id); }
                }}>
                  {expanded === flow.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              </div>
            </div>

            {expanded === flow.id && (
              <div className="border-t px-6 pb-6 pt-4">
                <h4 className="mb-3 text-sm font-semibold text-gray-700">Versions</h4>
                <div className="space-y-2">
                  {flow.ivr_flow_versions?.map((ver: any) => (
                    <div key={ver.id} className="flex items-center justify-between rounded border px-4 py-2">
                      <div>
                        <span className="font-medium">v{ver.version_number}</span>
                        <span className={`ml-3 rounded-full px-2 py-0.5 text-xs ${
                          ver.status === 'published' ? 'bg-green-100 text-green-700' :
                          ver.status === 'draft' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>{ver.status}</span>
                        {ver.published_at && (
                          <span className="ml-2 text-xs text-gray-400">Published {new Date(ver.published_at).toLocaleString()}</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => loadVersion(flow.id, ver.id)}
                          className="rounded border px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">
                          <Eye size={14} />
                        </button>
                        {ver.status === 'draft' && (
                          <button onClick={() => handlePublish(flow.id, ver.id)}
                            className="flex items-center gap-1 rounded bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700">
                            <Play size={14} /> Publish
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {versionDetail && expanded === flow.id && (
                  <div className="mt-6">
                    <h4 className="mb-3 text-sm font-semibold text-gray-700">
                      Nodes (v{versionDetail.version?.version_number})
                    </h4>

                    {versionDetail.nodes?.length > 0 ? (
                      <div className="mb-4 space-y-2">
                        {versionDetail.nodes.map((node: any) => (
                          <div key={node.id} className="rounded border p-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="font-mono text-sm font-medium">{node.node_key}</span>
                                <span className="ml-2 rounded bg-gray-100 px-2 py-0.5 text-xs">{node.node_type}</span>
                              </div>
                              <button onClick={async () => {
                                await apiDelete(`/ivr/nodes/${node.id}`);
                                loadVersion(flow.id, versionDetail.version.id);
                              }} className="text-gray-400 hover:text-red-500">
                                <Trash2 size={14} />
                              </button>
                            </div>
                            {node.prompt_text && <p className="mt-1 text-xs text-gray-500">{node.prompt_text.slice(0, 120)}...</p>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mb-4 text-sm text-gray-400">No nodes yet</p>
                    )}

                    {versionDetail.version?.status === 'draft' && (
                      <div className="rounded border bg-gray-50 p-4">
                        <h5 className="mb-3 text-sm font-semibold text-gray-700">Add Node</h5>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          <input placeholder="Node Key" value={nodeForm.node_key}
                            onChange={(e) => setNodeForm({ ...nodeForm, node_key: e.target.value })}
                            className="rounded border px-3 py-2 text-sm" />
                          <select value={nodeForm.node_type}
                            onChange={(e) => setNodeForm({ ...nodeForm, node_type: e.target.value })}
                            className="rounded border px-3 py-2 text-sm">
                            <option value="menu">Menu</option>
                            <option value="input">Input</option>
                            <option value="action">Action</option>
                            <option value="branch">Branch</option>
                            <option value="entry">Entry</option>
                            <option value="hangup">Hangup</option>
                          </select>
                          <input placeholder="Handler Name" value={nodeForm.handler_name}
                            onChange={(e) => setNodeForm({ ...nodeForm, handler_name: e.target.value })}
                            className="rounded border px-3 py-2 text-sm" />
                          <textarea placeholder="Prompt Text" value={nodeForm.prompt_text}
                            onChange={(e) => setNodeForm({ ...nodeForm, prompt_text: e.target.value })}
                            className="rounded border px-3 py-2 text-sm sm:col-span-2 lg:col-span-3" rows={2} />
                          <textarea placeholder='Intents JSON (e.g. [{"name":"catalog","dtmf_key":"1","speech_phrases":["catalog"],"target_node_key":"catalog_input"}])'
                            value={nodeForm.intents_json}
                            onChange={(e) => setNodeForm({ ...nodeForm, intents_json: e.target.value })}
                            className="rounded border px-3 py-2 text-sm font-mono sm:col-span-2 lg:col-span-3" rows={3} />
                        </div>
                        <button onClick={() => handleAddNode(versionDetail.version.id)}
                          className="mt-3 rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700">
                          Add Node
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
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
