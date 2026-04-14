import type { Request, Response } from 'express';
import { ivrRuntime } from '../../ivr/runtime.js';
import { supabaseAdmin } from '../../../lib/supabase.js';

export async function handleCallStatus(req: Request, res: Response) {
  const callId = req.body?.call_id || req.query?.call_id;

  // Always write a log entry so we can confirm this endpoint was reached
  try {
    const { data: session } = callId
      ? await supabaseAdmin
          .from('call_sessions')
          .select('user_id, phone_number, current_node_key, flow_version_id')
          .eq('call_sid', callId as string)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

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
      call_sid: (callId as string) || 'unknown',
      error_type: 'call_end',
      error_detail: `Call ended. Last node: ${session?.current_node_key || 'unknown'}`,
      caller_id: session?.phone_number || req.body?.caller_id || null,
      user_id: session?.user_id || null,
      user_name: userName,
      node_key: session?.current_node_key || null,
      flow_version_id: session?.flow_version_id || null,
      session_data: {
        event: req.body?.event || 'hangup',
        body_keys: req.body ? Object.keys(req.body) : [],
        query_keys: Object.keys(req.query),
        content_type: req.headers['content-type'] || 'none',
      },
      raw_payload: req.body || { empty: true, query: req.query },
    });
  } catch (err) {
    console.error('Failed to log call end:', err);
  }

  if (callId) {
    try {
      await ivrRuntime.endSession(callId as string);
    } catch (err) {
      console.error('Failed to end session:', err);
    }
  }

  res.sendStatus(200);
}
