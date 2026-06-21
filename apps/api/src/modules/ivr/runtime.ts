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
const MENU_STACK_MAX = 10;

/**
 * Key under `call_sessions.state_data` that holds transient sensitive data
 * (raw card fields mid-entry). Centralized so log/error paths can redact it.
 */
export const SECURE_STATE_KEY = 'secure';

/** Strip the secure sub-object from a state_data blob before logging it. */
export function redactSecureState(
  stateData: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!stateData || typeof stateData !== 'object') return stateData ?? null;
  if (!(SECURE_STATE_KEY in stateData)) return stateData;
  const next = { ...stateData };
  delete next[SECURE_STATE_KEY];
  return next;
}

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

  /**
   * Read transient sensitive fields (raw card number / expiry / CVV mid-entry)
   * that are kept server-side in `state_data.secure` instead of being passed
   * through the telephony provider's action-URL query string. This keeps PAN /
   * CVV out of URLs, request logs, and the provider's own logs. The data is
   * wiped via `clearSecureData` as soon as it's tokenized.
   */
  async getSecureData(callSid: string): Promise<Record<string, string>> {
    const session = await this.getSession(callSid);
    const stateData = (session?.state_data || {}) as Record<string, unknown>;
    const secure = stateData[SECURE_STATE_KEY];
    return secure && typeof secure === 'object'
      ? { ...(secure as Record<string, string>) }
      : {};
  }

  /** Merge sensitive fields into `state_data.secure`. */
  async setSecureData(callSid: string, partial: Record<string, string>): Promise<void> {
    const session = await this.getSession(callSid);
    if (!session) return;
    const stateData = (session.state_data || {}) as Record<string, unknown>;
    const existing =
      stateData[SECURE_STATE_KEY] && typeof stateData[SECURE_STATE_KEY] === 'object'
        ? (stateData[SECURE_STATE_KEY] as Record<string, string>)
        : {};
    await this.updateSession(callSid, {
      state_data: { ...stateData, [SECURE_STATE_KEY]: { ...existing, ...partial } },
    });
  }

  /** Remove all sensitive fields from the session (call after tokenization). */
  async clearSecureData(callSid: string): Promise<void> {
    const session = await this.getSession(callSid);
    if (!session) return;
    const stateData = (session.state_data || {}) as Record<string, unknown>;
    if (!(SECURE_STATE_KEY in stateData)) return;
    const next = { ...stateData };
    delete next[SECURE_STATE_KEY];
    await this.updateSession(callSid, { state_data: next });
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

  async popMenuStack(callSid: string): Promise<string | null> {
    const session = await this.getSession(callSid);
    if (!session) return null;
    const stateData = (session.state_data || {}) as Record<string, unknown>;
    const stack = Array.isArray(stateData.menu_stack)
      ? [...(stateData.menu_stack as string[])]
      : [];

    if (stack.length === 0) return null;

    const prev = stack.pop() ?? null;
    // The caller is now parked at the popped menu, so keep `current_menu` in
    // sync. This stops the subsequent re-render of that menu from treating it
    // as a brand-new visit and re-pushing onto the stack.
    const next: Record<string, unknown> = { ...stateData, menu_stack: stack };
    if (prev === null) delete next.current_menu;
    else next.current_menu = prev;
    await this.updateSession(callSid, { state_data: next });
    return prev;
  }

  async clearMenuStack(callSid: string): Promise<void> {
    const session = await this.getSession(callSid);
    if (!session) return;
    const stateData = (session.state_data || {}) as Record<string, unknown>;
    const hasStack = Array.isArray(stateData.menu_stack) && stateData.menu_stack.length > 0;
    const hasCurrent = stateData.current_menu !== undefined;
    if (!hasStack && !hasCurrent) return;
    const next: Record<string, unknown> = { ...stateData, menu_stack: [] };
    delete next.current_menu;
    await this.updateSession(callSid, { state_data: next });
  }

  /**
   * Record that the caller is now parked at `nodeKey` (a gather/collect menu).
   * `current_menu` is the interactive menu the caller's next keypress routes to
   * — distinct from the transient selection/announce nodes input passes through.
   * If this is a move to a *different* menu than the one they were last parked
   * at, the previous menu is pushed onto the back stack so `*` returns there.
   * Done as a single read-modify-write so the stack and pointer stay in sync.
   */
  async recordMenuVisit(callSid: string, nodeKey: string): Promise<void> {
    const session = await this.getSession(callSid);
    if (!session) return;
    const stateData = (session.state_data || {}) as Record<string, unknown>;
    const current = typeof stateData.current_menu === 'string' ? stateData.current_menu : null;

    // Re-render of the same menu (invalid input, retries): nothing changed.
    if (current === nodeKey) return;

    const stack = Array.isArray(stateData.menu_stack)
      ? (stateData.menu_stack as string[])
      : [];

    let nextStack = stack;
    const existingIdx = stack.lastIndexOf(nodeKey);
    if (existingIdx !== -1) {
      // The caller is back at a menu already on the stack (returned via an
      // in-menu option rather than `*`). Unwind to it instead of growing the
      // stack, so the next `*` goes one level further back, not in circles.
      nextStack = stack.slice(0, existingIdx);
    } else if (current && stack[stack.length - 1] !== current) {
      // Moving forward into a brand-new menu: remember the one we're leaving.
      nextStack = [...stack, current].slice(-MENU_STACK_MAX);
    }

    await this.updateSession(callSid, {
      state_data: { ...stateData, menu_stack: nextStack, current_menu: nodeKey },
    });
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
