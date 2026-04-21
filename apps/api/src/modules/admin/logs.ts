import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

export const logsRouter = Router();

const LOGS_SORTABLE_COLUMNS = ['created_at', 'error_type', 'user_id', 'id'];

logsRouter.get('/', async (req, res) => {
  const {
    page = '1',
    per_page = '25',
    error_type,
    user_id,
    date_from,
    date_to,
    sort_by = 'created_at',
    sort_dir = 'desc',
  } = req.query;

  const sortColumn = LOGS_SORTABLE_COLUMNS.includes(sort_by as string) ? (sort_by as string) : 'created_at';
  const sortAscending = sort_dir === 'asc';

  const perPage = parseInt(per_page as string);
  const currentPage = parseInt(page as string);
  const offset = (currentPage - 1) * perPage;

  let query = supabaseAdmin
    .from('ivr_error_logs')
    .select('*', { count: 'exact' });

  if (error_type) {
    query = query.eq('error_type', error_type as string);
  }
  if (user_id) {
    query = query.eq('user_id', user_id as string);
  }
  if (date_from) {
    query = query.gte('created_at', date_from as string);
  }
  if (date_to) {
    query = query.lte('created_at', `${date_to}T23:59:59.999Z`);
  }

  const { data, count, error } = await query
    .order(sortColumn, { ascending: sortAscending })
    .range(offset, offset + perPage - 1);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({
    success: true,
    data,
    total: count || 0,
    page: currentPage,
    per_page: perPage,
    total_pages: Math.ceil((count || 0) / perPage),
  });
});

logsRouter.get('/calls', async (req, res) => {
  const {
    page = '1',
    per_page = '25',
    date_from,
    date_to,
  } = req.query;

  const perPage = parseInt(per_page as string);
  const currentPage = parseInt(page as string);

  let query = supabaseAdmin
    .from('ivr_error_logs')
    .select('call_sid, caller_id, user_id, user_name, flow_version_id, created_at, node_key, error_type, error_detail, session_data');

  if (date_from) {
    query = query.gte('created_at', date_from as string);
  }
  if (date_to) {
    query = query.lte('created_at', `${date_to}T23:59:59.999Z`);
  }

  const { data, error } = await query.order('created_at', { ascending: true });

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  const callMap = new Map<string, any>();
  for (const row of data || []) {
    let call = callMap.get(row.call_sid);
    if (!call) {
      call = {
        call_sid: row.call_sid,
        caller_id: row.caller_id,
        user_id: row.user_id,
        user_name: row.user_name,
        flow_version_id: row.flow_version_id,
        first_step_at: row.created_at,
        last_step_at: row.created_at,
        step_count: 0,
        total_webhooks: 0,
        total_actions: 0,
        max_recursion_depth: 0,
        steps: [],
      };
      callMap.set(row.call_sid, call);
    }
    call.last_step_at = row.created_at;
    call.step_count++;

    const sd = row.session_data || {};
    const stepActions = sd.action_count || 0;
    const stepDepth = sd.recursion_depth || 0;

    call.total_webhooks++;
    call.total_actions += stepActions;
    if (stepDepth > call.max_recursion_depth) {
      call.max_recursion_depth = stepDepth;
    }

    call.steps.push({
      node: row.node_key,
      digits: sd.digits || null,
      time: row.created_at,
      action_count: stepActions,
      response_type: sd.response_type || null,
      recursion_depth: stepDepth,
    });
  }

  const callSids = Array.from(callMap.keys());
  const sessionMap = new Map<string, any>();
  if (callSids.length > 0) {
    const { data: sessions } = await supabaseAdmin
      .from('call_sessions')
      .select('call_sid, started_at, ended_at')
      .in('call_sid', callSids);
    for (const s of sessions || []) {
      sessionMap.set(s.call_sid, s);
    }
  }

  const CALL_INACTIVE_MS = 2 * 60 * 1000;
  const now = Date.now();

  const calls = Array.from(callMap.values()).map((call) => {
    const session = sessionMap.get(call.call_sid);
    const startedAt = session?.started_at || call.first_step_at;
    const lastStepMs = new Date(call.last_step_at).getTime();
    const callInactive = (now - lastStepMs) > CALL_INACTIVE_MS;
    const startMs = new Date(startedAt).getTime();

    return {
      ...call,
      started_at: startedAt,
      ended_at: call.last_step_at,
      has_ended: callInactive,
      duration_seconds: Math.round((lastStepMs - startMs) / 1000),
    };
  });

  calls.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

  const total = calls.length;
  const offset = (currentPage - 1) * perPage;
  const paged = calls.slice(offset, offset + perPage);

  res.json({
    success: true,
    data: paged,
    total,
    page: currentPage,
    per_page: perPage,
    total_pages: Math.ceil(total / perPage),
  });
});

logsRouter.get('/checkout', async (req, res) => {
  const {
    page = '1',
    per_page = '25',
    date_from,
    date_to,
  } = req.query;

  const perPage = parseInt(per_page as string);
  const currentPage = parseInt(page as string);

  let query = supabaseAdmin
    .from('checkout_events')
    .select('id, call_sid, user_id, order_id, event_type, severity, details, created_at');

  if (date_from) {
    query = query.gte('created_at', date_from as string);
  }
  if (date_to) {
    query = query.lte('created_at', `${date_to}T23:59:59.999Z`);
  }

  const { data: events, error } = await query.order('created_at', { ascending: true });

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  // Pull caller_id and user info from ivr_error_logs (one query for all sids)
  // and call_sessions for accurate started_at.
  const callSids = Array.from(new Set((events ?? []).map((e) => e.call_sid)));

  const callerById = new Map<string, { caller_id: string | null; user_name: string | null }>();
  if (callSids.length > 0) {
    const { data: errorLogs } = await supabaseAdmin
      .from('ivr_error_logs')
      .select('call_sid, caller_id, user_name')
      .in('call_sid', callSids)
      .limit(callSids.length * 50);
    for (const row of errorLogs ?? []) {
      if (!callerById.has(row.call_sid)) {
        callerById.set(row.call_sid, { caller_id: row.caller_id, user_name: row.user_name });
      }
    }
  }

  const sessionMap = new Map<string, any>();
  if (callSids.length > 0) {
    const { data: sessions } = await supabaseAdmin
      .from('call_sessions')
      .select('call_sid, started_at, ended_at')
      .in('call_sid', callSids);
    for (const s of sessions ?? []) {
      sessionMap.set(s.call_sid, s);
    }
  }

  // Group events by call_sid into a timeline.
  const callMap = new Map<string, any>();
  for (const ev of events ?? []) {
    let call = callMap.get(ev.call_sid);
    if (!call) {
      const callerInfo = callerById.get(ev.call_sid);
      call = {
        call_sid: ev.call_sid,
        caller_id: callerInfo?.caller_id ?? null,
        user_name: callerInfo?.user_name ?? null,
        user_id: ev.user_id,
        order_id: null as string | null,
        first_event_at: ev.created_at,
        last_event_at: ev.created_at,
        event_count: 0,
        error_count: 0,
        warn_count: 0,
        outcome: 'in_progress' as
          | 'in_progress'
          | 'order_completed'
          | 'order_failed'
          | 'cancelled'
          | 'cart_review_needed',
        events: [] as any[],
      };
      callMap.set(ev.call_sid, call);
    }
    call.last_event_at = ev.created_at;
    call.event_count++;
    if (ev.severity === 'error') call.error_count++;
    if (ev.severity === 'warn') call.warn_count++;
    if (ev.order_id) call.order_id = ev.order_id;

    // Outcome classification (latest meaningful event wins).
    if (ev.event_type === 'order_completed') call.outcome = 'order_completed';
    else if (ev.event_type === 'order_failed') call.outcome = 'order_failed';
    else if (ev.event_type === 'checkout_cancelled' && call.outcome === 'in_progress') call.outcome = 'cancelled';

    call.events.push({
      id: ev.id,
      event_type: ev.event_type,
      severity: ev.severity,
      details: ev.details,
      created_at: ev.created_at,
    });
  }

  const calls = Array.from(callMap.values()).map((call) => {
    const session = sessionMap.get(call.call_sid);
    const startedAt = session?.started_at || call.first_event_at;
    return {
      ...call,
      started_at: startedAt,
      ended_at: session?.ended_at || call.last_event_at,
    };
  });

  // Newest first.
  calls.sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );

  const total = calls.length;
  const offset = (currentPage - 1) * perPage;
  const paged = calls.slice(offset, offset + perPage);

  res.json({
    success: true,
    data: paged,
    total,
    page: currentPage,
    per_page: perPage,
    total_pages: Math.ceil(total / perPage),
  });
});

logsRouter.delete('/:id', async (req, res) => {
  const { error } = await supabaseAdmin
    .from('ivr_error_logs')
    .delete()
    .eq('id', req.params.id);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true });
});

// Preview the blast radius of a delete BEFORE the user confirms.
// Returns the actual underlying-row counts that will be removed for the
// given set of call_sids (or step row ids), so the confirm dialog in the UI
// can show an accurate "Delete N rows across M calls?" message instead of
// just showing the number of grouped rows the user clicked.
logsRouter.post('/delete-preview', async (req, res) => {
  const { call_sids, ids } = req.body;

  if (call_sids !== undefined) {
    const sanitized = sanitizeCallSids(call_sids);
    if (!sanitized.ok) {
      res.status(400).json({ success: false, error: sanitized.reason });
      return;
    }
    const sids = sanitized.sids;

    const [{ count: stepCount, error: stepErr }, { count: sessionCount, error: sessionErr }, { count: checkoutCount, error: checkoutErr }] = await Promise.all([
      supabaseAdmin.from('ivr_error_logs').select('id', { count: 'exact', head: true }).in('call_sid', sids),
      supabaseAdmin.from('call_sessions').select('id', { count: 'exact', head: true }).in('call_sid', sids),
      supabaseAdmin.from('checkout_events').select('id', { count: 'exact', head: true }).in('call_sid', sids),
    ]);

    const err = stepErr || sessionErr || checkoutErr;
    if (err) {
      res.status(500).json({ success: false, error: err.message });
      return;
    }

    res.json({
      success: true,
      call_count: sids.length,
      step_rows: stepCount || 0,
      session_rows: sessionCount || 0,
      checkout_event_rows: checkoutCount || 0,
    });
    return;
  }

  if (Array.isArray(ids) && ids.length > 0) {
    res.json({ success: true, step_rows: ids.length, call_count: 0, session_rows: 0, checkout_event_rows: 0 });
    return;
  }

  res.status(400).json({ success: false, error: 'ids or call_sids array is required' });
});

// Strict validator for the call_sid array coming in from the client.
// Rejects empty strings, non-strings, the literal string "undefined" etc.
// Existing call_sids are UUIDs (gen_random_uuid()) or other non-empty strings
// like 'unknown' that we treat as text. We require non-empty trimmed strings
// of reasonable length.
function sanitizeCallSids(input: unknown): { ok: true; sids: string[] } | { ok: false; reason: string } {
  if (!Array.isArray(input)) {
    return { ok: false, reason: 'call_sids must be an array' };
  }
  const cleaned: string[] = [];
  for (const v of input) {
    if (typeof v !== 'string') {
      return { ok: false, reason: `call_sids contained a non-string value: ${JSON.stringify(v)}` };
    }
    const trimmed = v.trim();
    if (!trimmed) {
      return { ok: false, reason: 'call_sids contained an empty string' };
    }
    if (trimmed.length > 200) {
      return { ok: false, reason: 'call_sids contained an unreasonably long value' };
    }
    cleaned.push(trimmed);
  }
  // De-dupe so the count matches what the user thinks they're deleting.
  const unique = Array.from(new Set(cleaned));
  if (unique.length === 0) {
    return { ok: false, reason: 'call_sids was empty after de-duplication' };
  }
  return { ok: true, sids: unique };
}

logsRouter.post('/bulk-delete', async (req, res) => {
  const { ids, call_sids, expected_step_rows } = req.body;

  if (call_sids !== undefined) {
    const sanitized = sanitizeCallSids(call_sids);
    if (!sanitized.ok) {
      console.warn('[logs.bulk-delete] rejected request:', sanitized.reason, { received: call_sids });
      res.status(400).json({ success: false, error: sanitized.reason });
      return;
    }
    const sids = sanitized.sids;

    // Hard cap so an accidental "select all + huge filter" can't nuke the
    // entire table. The UI is paginated to 25, so a normal flow stays well
    // under this. If you genuinely need to delete more, do it in batches.
    const MAX_CALLS_PER_DELETE = 100;
    if (sids.length > MAX_CALLS_PER_DELETE) {
      res.status(400).json({
        success: false,
        error: `Refusing to delete more than ${MAX_CALLS_PER_DELETE} calls in one request (received ${sids.length}). Delete in smaller batches.`,
      });
      return;
    }

    // Resolve the actual row IDs that match the requested call_sids BEFORE
    // deleting. This way the DELETE statement filters on the primary-key `id`
    // column with a known, finite list — eliminating any possibility of the
    // .in('call_sid', ...) clause matching unintended rows because of a
    // malformed value, encoding issue, or supabase-js edge case.
    const [
      { data: stepRows, error: stepFetchErr },
      { data: sessionRows, error: sessionFetchErr },
      { data: checkoutRows, error: checkoutFetchErr },
    ] = await Promise.all([
      supabaseAdmin.from('ivr_error_logs').select('id, call_sid').in('call_sid', sids),
      supabaseAdmin.from('call_sessions').select('id, call_sid').in('call_sid', sids),
      supabaseAdmin.from('checkout_events').select('id, call_sid').in('call_sid', sids),
    ]);

    const fetchErr = stepFetchErr || sessionFetchErr || checkoutFetchErr;
    if (fetchErr) {
      res.status(500).json({ success: false, error: fetchErr.message });
      return;
    }

    // Defensive: filter ids client-side too, on the chance the .in() filter
    // returned anything outside the allowed sid set (it shouldn't, but belt
    // and suspenders).
    const sidSet = new Set(sids);
    const stepIds = (stepRows || []).filter((r) => sidSet.has(r.call_sid)).map((r) => r.id);
    const sessionIds = (sessionRows || []).filter((r) => sidSet.has(r.call_sid)).map((r) => r.id);
    const checkoutIds = (checkoutRows || []).filter((r) => sidSet.has(r.call_sid)).map((r) => r.id);

    // If the caller supplied an expected_step_rows count (from /delete-preview),
    // verify it still matches. If new rows were added between the user clicking
    // "delete" and us actually running the delete, abort and ask them to retry.
    // This prevents "expected to delete 50, ended up deleting 5000" surprises
    // from racy preview/confirm/delete flows.
    if (typeof expected_step_rows === 'number' && expected_step_rows !== stepIds.length) {
      console.warn('[logs.bulk-delete] expected_step_rows mismatch', {
        expected: expected_step_rows,
        actual: stepIds.length,
        sids,
      });
      res.status(409).json({
        success: false,
        error: `Row count changed since you confirmed (expected ${expected_step_rows}, found ${stepIds.length}). Refresh and try again.`,
      });
      return;
    }

    console.info('[logs.bulk-delete] starting delete', {
      requested_sids: sids.length,
      step_rows: stepIds.length,
      session_rows: sessionIds.length,
      checkout_rows: checkoutIds.length,
    });

    // Delete strictly by primary-key id list. Skip any table that has nothing
    // to delete (an empty .in() can be ambiguous in some clients).
    const deletes: Promise<{ error: any }>[] = [];
    if (stepIds.length > 0) {
      deletes.push(supabaseAdmin.from('ivr_error_logs').delete().in('id', stepIds));
    }
    if (sessionIds.length > 0) {
      deletes.push(supabaseAdmin.from('call_sessions').delete().in('id', sessionIds));
    }
    if (checkoutIds.length > 0) {
      deletes.push(supabaseAdmin.from('checkout_events').delete().in('id', checkoutIds));
    }

    const results = await Promise.all(deletes);
    const delErr = results.find((r) => r.error)?.error;
    if (delErr) {
      res.status(500).json({ success: false, error: delErr.message });
      return;
    }

    console.info('[logs.bulk-delete] delete finished', {
      deleted_call_sids: sids.length,
      deleted_step_rows: stepIds.length,
      deleted_session_rows: sessionIds.length,
      deleted_checkout_event_rows: checkoutIds.length,
    });

    res.json({
      success: true,
      deleted_call_sids: sids.length,
      deleted_step_rows: stepIds.length,
      deleted_session_rows: sessionIds.length,
      deleted_checkout_event_rows: checkoutIds.length,
    });
    return;
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ success: false, error: 'ids or call_sids array is required' });
    return;
  }

  // Validate every id is a non-empty string before going to the DB.
  const cleanIds: string[] = [];
  for (const v of ids) {
    if (typeof v !== 'string' || !v.trim()) {
      res.status(400).json({ success: false, error: 'ids contained an invalid value' });
      return;
    }
    cleanIds.push(v.trim());
  }

  const { error } = await supabaseAdmin
    .from('ivr_error_logs')
    .delete()
    .in('id', cleanIds);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({ success: true, deleted: cleanIds.length });
});
