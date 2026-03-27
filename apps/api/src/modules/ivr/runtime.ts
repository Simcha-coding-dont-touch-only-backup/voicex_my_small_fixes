import { supabaseAdmin } from '../../lib/supabase.js';
import type { CallSession, IvrNode, IvrEdge, IvrFlowVersion } from '@voicex/shared';

class IvrRuntime {
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

  async getNode(flowVersionId: string, nodeKey: string): Promise<IvrNode | null> {
    const { data } = await supabaseAdmin
      .from('ivr_nodes')
      .select('*')
      .eq('flow_version_id', flowVersionId)
      .eq('node_key', nodeKey)
      .single();
    return data;
  }

  async getEdges(flowVersionId: string, sourceNodeId: string): Promise<IvrEdge[]> {
    const { data } = await supabaseAdmin
      .from('ivr_edges')
      .select('*')
      .eq('flow_version_id', flowVersionId)
      .eq('source_node_id', sourceNodeId)
      .order('priority', { ascending: true });
    return data || [];
  }
}

export const ivrRuntime = new IvrRuntime();
