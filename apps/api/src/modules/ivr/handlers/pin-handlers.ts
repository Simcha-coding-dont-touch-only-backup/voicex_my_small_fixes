import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildHangup } from '../../twilio/twiml-builder.js';
import { ivrRuntime } from '../runtime.js';

registerHandler('validate_pin', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.Digits;

  if (!digits || digits.length !== 4) {
    const session = await ivrRuntime.getSession(ctx.callSid);
    const retries = (session?.retry_count || 0) + 1;

    if (retries >= (ctx.node.config.max_retries || 3)) {
      await supabaseAdmin.from('login_events').insert({
        user_id: userId,
        phone_number: session?.phone_number || '',
        success: false,
        failure_reason: 'max_retries_exceeded',
      });
      return { type: 'twiml', twiml: buildHangup('Too many failed attempts. Please try again later. Goodbye.') };
    }

    await ivrRuntime.updateSession(ctx.callSid, { retry_count: retries });

    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'Invalid PIN. Please enter your 4 digit PIN.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        numDigits: 4,
        timeout: 10,
        finishOnKey: '',
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key },
      }),
    };
  }

  const { data: pinRecord } = await supabaseAdmin
    .from('user_pins')
    .select('pin_hash')
    .eq('user_id', userId)
    .single();

  if (!pinRecord) {
    return { type: 'twiml', twiml: buildHangup('Account configuration error. Please contact support.') };
  }

  const isValid = await bcrypt.compare(digits, pinRecord.pin_hash);

  if (!isValid) {
    const session = await ivrRuntime.getSession(ctx.callSid);
    const retries = (session?.retry_count || 0) + 1;

    if (retries >= (ctx.node.config.max_retries || 3)) {
      await supabaseAdmin.from('login_events').insert({
        user_id: userId,
        phone_number: session?.phone_number || '',
        success: false,
        failure_reason: 'wrong_pin_max_retries',
      });
      return { type: 'twiml', twiml: buildHangup('Too many failed attempts. Please try again later. Goodbye.') };
    }

    await ivrRuntime.updateSession(ctx.callSid, { retry_count: retries });

    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'Incorrect PIN. Please try again.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        numDigits: 4,
        timeout: 10,
        finishOnKey: '',
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key },
      }),
    };
  }

  await supabaseAdmin.from('login_events').insert({
    user_id: userId,
    phone_number: ctx.req.body.From || '',
    success: true,
    failure_reason: null,
  });

  await ivrRuntime.updateSession(ctx.callSid, { current_node_key: 'main_menu', retry_count: 0 });

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'success');
  if (nextNode) {
    const intents = nextNode.config.intents || [];
    const hints = intents.flatMap((i: any) => i.speech_phrases);
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: nextNode.prompt_text || 'Main Menu.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf speech',
        timeout: 8,
        hints,
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: nextNode.node_key },
      }),
    };
  }

  return { type: 'twiml', twiml: buildHangup('System error. Please call again.') };
});
