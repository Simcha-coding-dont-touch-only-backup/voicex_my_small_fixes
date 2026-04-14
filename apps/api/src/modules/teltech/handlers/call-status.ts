import type { Request, Response } from 'express';
import { ivrRuntime } from '../../ivr/runtime.js';
import { supabaseAdmin } from '../../../lib/supabase.js';

export async function handleCallStatus(req: Request, res: Response) {
  const callId = req.body.call_id;

  if (!callId) {
    res.sendStatus(200);
    return;
  }

  try {
    await ivrRuntime.endSession(callId);
  } catch (err) {
    console.error('Failed to end session:', err);
  }

  try {
    const { data: session } = await supabaseAdmin
      .from('call_sessions')
      .select('user_id, phone_number, current_node_key, flow_version_id')
      .eq('call_sid', callId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let userName: string | null = null;
    if (session?.user_id) {
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('name')
        .eq('id', session.user_id)
        .single();
      userName = user?.name || null;
    }

    await supabaseAdmin.from('ivr_error_logs').insert({
      call_sid: callId,
      error_type: 'call_end',
      error_detail: `Call ended. Last node: ${session?.current_node_key || 'unknown'}`,
      caller_id: session?.phone_number || req.body.caller_id || null,
      user_id: session?.user_id || null,
      user_name: userName,
      node_key: session?.current_node_key || null,
      flow_version_id: session?.flow_version_id || null,
      session_data: { event: req.body.event || 'hangup' },
      raw_payload: req.body,
    });
  } catch (err) {
    console.error('Failed to log call end:', err);
  }

  res.sendStatus(200);
}
