import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildGatherFromNode, buildHangup } from '../../teltech/teltech-builder.js';
import { ivrRuntime } from '../runtime.js';

registerHandler('validate_pin', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;

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
      return { type: 'actions', response: buildHangup('Too many failed attempts. Please try again later. Goodbye.') };
    }

    await ivrRuntime.updateSession(ctx.callSid, { retry_count: retries });

    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Invalid PIN. Please enter your 4 digit PIN.',
        actionPath: '/api/ivr/voice/gather',
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
    return { type: 'actions', response: buildHangup('Account configuration error. Please contact support.') };
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
      return { type: 'actions', response: buildHangup('Too many failed attempts. Please try again later. Goodbye.') };
    }

    await ivrRuntime.updateSession(ctx.callSid, { retry_count: retries });

    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Incorrect PIN. Please try again.',
        actionPath: '/api/ivr/voice/gather',
        numDigits: 4,
        timeout: 10,
        finishOnKey: '',
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key },
      }),
    };
  }

  const session = await ivrRuntime.getSession(ctx.callSid);
  await supabaseAdmin.from('login_events').insert({
    user_id: userId,
    phone_number: session?.phone_number || '',
    success: true,
    failure_reason: null,
  });

  await ivrRuntime.updateSession(ctx.callSid, { current_node_key: 'main_menu', retry_count: 0 });

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'success');
  if (nextNode) {
    const intro = 'Please note, you can press star at any time to return to the previous menu. ';
    return {
      type: 'actions',
      response: buildGatherFromNode(
        nextNode,
        { call_sid: ctx.callSid, user_id: userId },
        { prompt: intro + (nextNode.prompt_text || '') }
      ),
    };
  }

  return { type: 'actions', response: buildHangup('System error. Please call again.') };
});
