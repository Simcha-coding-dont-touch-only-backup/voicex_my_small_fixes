import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildGatherFromNode, buildCollect, buildHangup, buildSay } from '../../teltech/teltech-builder.js';
import { ivrRuntime } from '../runtime.js';

/**
 * Build a word-by-word spell-out of a name for the TTS confirmation readback so
 * the caller can verify the transcribed spelling. Each word is announced, then
 * its letters are read one at a time, e.g. "Bob Raven" becomes
 * "Bob, B, O, B. Raven, R, A, V, E, N". Letters are separated by commas (which
 * TTS reads as short pauses) so the engine reads them individually instead of
 * pronouncing the word. Only the registration name intake uses this.
 */
function spellNameForReadback(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => {
      const letters = word
        .split('')
        .filter((char) => /[A-Za-z0-9]/.test(char))
        .map((char) => char.toUpperCase())
        .join(', ');
      return letters ? `${word}, ${letters}` : word;
    })
    .join('. ');
}

registerHandler('capture_name', async (ctx) => {
  const fieldTranscript = ctx.req.body.field_transcript;
  const fieldValue = ctx.req.body.field_value;
  const variables = ctx.req.body.variables || {};
  const name = fieldTranscript || fieldValue || variables.caller_name_text || variables.caller_name;

  // #region agent log
  // Real calls hit the deployed Vercel API, which cannot reach a localhost
  // ingest endpoint, so debug evidence is persisted to ivr_error_logs (read
  // back via Supabase MCP). Captures the exact raw payload TelTech POSTs for
  // the name recording so we can see whether the transcript itself is
  // truncated (TelTech recording onset / transcription) vs. our parsing.
  try {
    await supabaseAdmin.from('ivr_error_logs').insert({
      call_sid: ctx.callSid,
      error_type: 'debug_1d5707',
      error_detail: 'capture_name raw payload',
      node_key: ctx.node.node_key,
      raw_payload: {
        hypothesisId: 'A,B,C,D,E',
        field_transcript: fieldTranscript ?? null,
        field_value: fieldValue ?? null,
        field_id: ctx.req.body.field_id ?? null,
        field_type: ctx.req.body.field_type ?? null,
        recording_path: ctx.req.body.recording_path ?? (ctx.req.body as any).last_recording ?? null,
        var_caller_name: variables.caller_name ?? null,
        var_caller_name_text: variables.caller_name_text ?? null,
        chosen_name: name ?? null,
        body_keys: Object.keys(ctx.req.body || {}),
        variable_keys: Object.keys(variables || {}),
        event: (ctx.req.body as any).event ?? null,
        // Full dumps to find whether ANY field/variable holds the complete
        // multi-segment transcript (vs. only the last segment in field_transcript).
        full_variables: variables,
        full_body: ctx.req.body,
      },
    });
  } catch { /* never break the call on debug logging */ }
  // #endregion

  if (!name || name.trim().length < 2) {
    return {
      type: 'actions',
      response: buildCollect({
        type: 'recording',
        id: 'caller_name',
        prompt: 'Please say your full name after the beep, then press pound.',
        // Confirmation is handled by our own register_name_confirm step (with a
        // word-by-word spell-out), so TelTech's built-in readback is disabled.
        confirm: false,
        transcribe: true,
        retry: 3,
        maxDuration: 10,
        actionPath: '/api/ivr/voice/gather',
        sessionData: { call_sid: ctx.callSid, node_key: ctx.node.node_key },
      }),
    };
  }

  const trimmedName = name.trim();

  await ivrRuntime.updateSession(ctx.callSid, {
    state_data: { registration_name: trimmedName },
  });

  // Own the confirmation step so we can spell the name back word by word and
  // letter by letter, letting the caller verify the transcribed spelling.
  const confirmNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);
  const spelled = spellNameForReadback(trimmedName);
  // #region agent log
  try {
    await supabaseAdmin.from('ivr_error_logs').insert({
      call_sid: ctx.callSid,
      error_type: 'debug_1d5707',
      error_detail: 'capture_name spell-out readback',
      node_key: ctx.node.node_key,
      raw_payload: {
        hypothesisId: 'SPELL',
        trimmed_name: trimmedName,
        spelled_prompt: `${spelled}. Press 1 to confirm, or press 2 to re-enter.`,
        confirm_node_key: confirmNode?.node_key ?? null,
      },
    });
  } catch { /* never break the call on debug logging */ }
  // #endregion
  return {
    type: 'actions',
    response: buildGather({
      prompt: `${spelled}. Press 1 to confirm, or press 2 to re-enter.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 10,
      finishOnKey: '',
      sessionData: {
        call_sid: ctx.callSid,
        node_key: confirmNode?.node_key || 'register_name_confirm',
        name: trimmedName,
      },
    }),
  };
});

registerHandler('confirm_name', async (ctx) => {
  const digits = ctx.req.body.digits;
  const name = ctx.sessionData.name;

  // Only `1` confirms. `2` (or no input, e.g. a timeout) re-records the name.
  // Any other keypress — `#`, `0`, `3`-`9`, or a misfire like `1*2` — is
  // invalid here and must re-prompt rather than fall through to PIN entry.
  if (digits !== '1') {
    const isReRecord = digits === '2' || !digits;
    if (isReRecord) {
      const retryNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'retry');
      return {
        type: 'actions',
        response: buildCollect({
          type: 'recording',
          id: 'caller_name',
          prompt: 'Please say your full name after the beep, then press pound.',
          // Re-recorded names go back through register_name_confirm for our own
          // spell-out, so TelTech's built-in readback stays off here too.
          confirm: false,
          transcribe: true,
          retry: 3,
          maxDuration: 10,
          actionPath: '/api/ivr/voice/gather',
          sessionData: { call_sid: ctx.callSid, node_key: retryNode?.node_key || 'register_name' },
        }),
      };
    }

    // Invalid keypress: re-read the spelled-out name and ask again.
    const spelled = name ? spellNameForReadback(name) : '';
    return {
      type: 'actions',
      response: buildGather({
        prompt: `${spelled ? `${spelled}. ` : ''}Sorry, I didn't get that. Press 1 to confirm, or press 2 to re-enter.`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 10,
        finishOnKey: '',
        sessionData: { call_sid: ctx.callSid, node_key: ctx.node.node_key, name: name || '' },
      }),
    };
  }

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'confirmed');
  return {
    type: 'actions',
    response: buildGather({
      prompt: nextNode?.prompt_text || 'Please enter a 4 digit PIN that you will use to access your account.',
      actionPath: '/api/ivr/voice/gather',
      numDigits: 4,
      timeout: 15,
      finishOnKey: '',
      regex: '[0-9]+',
      sessionData: { call_sid: ctx.callSid, node_key: nextNode?.node_key || 'register_pin', name },
    }),
  };
});

registerHandler('capture_pin', async (ctx) => {
  const digits = ctx.req.body.digits;
  const name = ctx.sessionData.name;

  if (!digits || digits.length !== 4) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'The PIN must be exactly 4 digits. Please try again.',
        actionPath: '/api/ivr/voice/gather',
        numDigits: 4,
        timeout: 15,
        finishOnKey: '',
        regex: '[0-9]+',
        sessionData: { call_sid: ctx.callSid, node_key: ctx.node.node_key, name },
      }),
    };
  }

  const spelled = digits.split('').join(', ');
  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

  return {
    type: 'actions',
    response: buildGather({
      prompt: `Your PIN is: ${spelled}. Press 1 to confirm, or press 2 to re-enter.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 10,
      finishOnKey: '',
      sessionData: {
        call_sid: ctx.callSid,
        node_key: nextNode?.node_key || 'register_pin_confirm',
        name,
        pin: digits,
      },
    }),
  };
});

registerHandler('confirm_pin_register', async (ctx) => {
  const digits = ctx.req.body.digits;
  const name = ctx.sessionData.name;
  const pin = ctx.sessionData.pin;

  if (digits === '2' || !digits) {
    const retryNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'retry');
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter a 4 digit PIN.',
        actionPath: '/api/ivr/voice/gather',
        numDigits: 4,
        timeout: 15,
        finishOnKey: '',
        regex: '[0-9]+',
        sessionData: { call_sid: ctx.callSid, node_key: retryNode?.node_key || 'register_pin', name },
      }),
    };
  }

  try {
    const session = await ivrRuntime.getSession(ctx.callSid);
    const phoneNumber = session?.phone_number || ctx.req.body.caller_id || '';
    const pinHash = await bcrypt.hash(pin, 10);

    const { data: user } = await supabaseAdmin
      .from('users')
      .insert({ name, status: 'active', is_whitelisted: false })
      .select()
      .single();

    if (!user) throw new Error('Failed to create user');

    await supabaseAdmin.from('user_phones').insert({
      user_id: user.id,
      phone_number: phoneNumber,
      is_primary: true,
    });

    await supabaseAdmin.from('user_pins').insert({
      user_id: user.id,
      pin_hash: pinHash,
    });

    await ivrRuntime.updateSession(ctx.callSid, {
      user_id: user.id,
      current_node_key: 'subscriptions_alerts_announce',
      retry_count: 0,
    });
    await ivrRuntime.clearMenuStack(ctx.callSid);
    (ctx.req as any)._suppressStackPush = true;

    // New users have no alerts; the inbox handler will fall straight through to
    // the main menu (kept here for parity with the PIN success path).
    return {
      type: 'actions',
      response: buildSay('', '/api/ivr/voice/gather', {
        call_sid: ctx.callSid,
        user_id: user.id,
        node_key: 'subscriptions_alerts_announce',
      }),
    };
  } catch (error) {
    console.error('Registration error:', error);
    return { type: 'actions', response: buildHangup('We had trouble creating your account. Please try again later.') };
  }
});
