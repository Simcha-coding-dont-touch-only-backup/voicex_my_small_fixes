import type { Request, Response } from 'express';
import { supabaseAdmin } from '../../../lib/supabase.js';

export async function handleErrorWebhook(req: Request, res: Response) {
  const {
    call_id,
    caller_id,
    error_type,
    error_detail,
  } = req.body;

  if (!call_id || !error_type) {
    console.error('Error webhook missing call_id or error_type:', req.body);
    res.sendStatus(200);
    return;
  }

  try {
    let userId: string | null = null;
    let userName: string | null = null;
    let nodeKey: string | null = null;
    let flowVersionId: string | null = null;
    let sessionData: Record<string, unknown> | null = null;

    const { data: session } = await supabaseAdmin
      .from('call_sessions')
      .select('user_id, current_node_key, flow_version_id, state_data')
      .eq('call_sid', call_id)
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (session) {
      userId = session.user_id;
      nodeKey = session.current_node_key;
      flowVersionId = session.flow_version_id;
      sessionData = session.state_data;

      if (userId) {
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('name')
          .eq('id', userId)
          .single();

        userName = user?.name || null;
      }
    }

    await supabaseAdmin.from('ivr_error_logs').insert({
      call_sid: call_id,
      error_type,
      error_detail: error_detail || null,
      caller_id: caller_id || null,
      user_id: userId,
      user_name: userName,
      node_key: nodeKey,
      flow_version_id: flowVersionId,
      session_data: sessionData,
      raw_payload: req.body,
    });

    console.log(`IVR error logged: ${error_type} for call ${call_id}${userName ? ` (user: ${userName})` : ''}`);
  } catch (err) {
    console.error('Failed to log IVR error:', err);
  }

  res.sendStatus(200);
}
