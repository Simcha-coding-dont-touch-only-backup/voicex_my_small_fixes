import { supabaseAdmin } from '../../lib/supabase.js';
import type { CallSession, IvrNode, IvrEdge, IvrFlowVersion } from '@voicex/shared';

interface CachedFlow {
  versionId: string;
  nodes: Map<string, IvrNode>;
  nodesByKey: Map<string, IvrNode>;
  edges: IvrEdge[];
  cachedAt: number;
}

const CACHE_TTL_MS = 60_000;

class IvrRuntime {
  private flowCache: CachedFlow | null = null;

  async createSession(
    callSid: string,
    phoneNumber: string,
    userId: string | null
  ): Promise<void> {
    const flowVersion = await this.getActiveFlowVersion();
    await supabaseAdmin.from('call_sessions').insert({
      call_sid: callSid,
      phone_number: phoneNumber,
      user_id: userId,
      flow_version_id: flowVersion?.id || null,
      current_node_key: 'entry',
      state_data: {},
      retry_count: 0,
    });
  }

  async endSession(callSid: string): Promise<void> {
    await supabaseAdmin
      .from('call_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('call_sid', callSid);
  }

  async getSession(callSid: string): Promise<CallSession | null> {
    const { data } = await supabaseAdmin
      .from('call_sessions')
      .select('*')
      .eq('call_sid', callSid)
      .is('ended_at', null)
      .single();
    return data;
  }

  async updateSession(
    callSid: string,
    updates: Partial<Pick<CallSession, 'current_node_key' | 'state_data' | 'retry_count' | 'user_id'>>
  ): Promise<void> {
    await supabaseAdmin
      .from('call_sessions')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('call_sid', callSid);
  }

  async getActiveFlowVersion(): Promise<IvrFlowVersion | null> {
    const { data } = await supabaseAdmin
      .from('ivr_flow_versions')
      .select('*, ivr_flows!inner(is_active)')
      .eq('status', 'published')
      .eq('ivr_flows.is_active', true)
      .order('published_at', { ascending: false })
      .limit(1)
      .single();
    return data;
  }

  async getNode(flowVersionId: string, nodeId: string): Promise<IvrNode | null> {
    const cached = await this.getCachedFlow(flowVersionId);
    if (cached) {
      return cached.nodes.get(nodeId) || null;
    }

    const { data } = await supabaseAdmin
      .from('ivr_nodes')
      .select('*')
      .eq('id', nodeId)
      .single();
    return data;
  }

  async getNodeByKey(flowVersionId: string, nodeKey: string): Promise<IvrNode | null> {
    const cached = await this.getCachedFlow(flowVersionId);
    if (cached) {
      return cached.nodesByKey.get(nodeKey) || null;
    }

    const { data } = await supabaseAdmin
      .from('ivr_nodes')
      .select('*')
      .eq('flow_version_id', flowVersionId)
      .eq('node_key', nodeKey)
      .single();
    return data;
  }

  async getEdges(flowVersionId: string, sourceNodeId: string): Promise<IvrEdge[]> {
    const cached = await this.getCachedFlow(flowVersionId);
    if (cached) {
      return cached.edges
        .filter((e) => e.source_node_id === sourceNodeId)
        .sort((a, b) => a.priority - b.priority);
    }

    const { data } = await supabaseAdmin
      .from('ivr_edges')
      .select('*')
      .eq('flow_version_id', flowVersionId)
      .eq('source_node_id', sourceNodeId)
      .order('priority', { ascending: true });
    return data || [];
  }

  async resolveNextNode(
    flowVersionId: string,
    currentNodeId: string,
    conditionValue: string | null
  ): Promise<IvrNode | null> {
    const edges = await this.getEdges(flowVersionId, currentNodeId);

    let matchedEdge: IvrEdge | undefined;

    if (conditionValue) {
      matchedEdge = edges.find(
        (e) =>
          (e.condition_type === 'match' || e.condition_type === 'intent') &&
          e.condition_value === conditionValue
      );
    }

    if (!matchedEdge) {
      matchedEdge = edges.find((e) => e.condition_type === 'default');
    }

    if (!matchedEdge) return null;

    const cached = await this.getCachedFlow(flowVersionId);
    if (cached) {
      return cached.nodes.get(matchedEdge.target_node_id) || null;
    }

    const { data } = await supabaseAdmin
      .from('ivr_nodes')
      .select('*')
      .eq('id', matchedEdge.target_node_id)
      .single();
    return data;
  }

  invalidateCache(): void {
    this.flowCache = null;
  }

  private async getCachedFlow(flowVersionId: string): Promise<CachedFlow | null> {
    if (
      this.flowCache &&
      this.flowCache.versionId === flowVersionId &&
      Date.now() - this.flowCache.cachedAt < CACHE_TTL_MS
    ) {
      return this.flowCache;
    }

    const { data: nodes } = await supabaseAdmin
      .from('ivr_nodes')
      .select('*')
      .eq('flow_version_id', flowVersionId);

    const { data: edges } = await supabaseAdmin
      .from('ivr_edges')
      .select('*')
      .eq('flow_version_id', flowVersionId);

    if (!nodes || !edges) return null;

    const nodesById = new Map<string, IvrNode>();
    const nodesByKey = new Map<string, IvrNode>();
    for (const node of nodes) {
      nodesById.set(node.id, node);
      nodesByKey.set(node.node_key, node);
    }

    this.flowCache = {
      versionId: flowVersionId,
      nodes: nodesById,
      nodesByKey,
      edges,
      cachedAt: Date.now(),
    };

    return this.flowCache;
  }
}

export const ivrRuntime = new IvrRuntime();
