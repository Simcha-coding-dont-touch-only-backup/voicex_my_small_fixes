import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildCollect, buildHangup } from '../../teltech/teltech-builder.js';
import { ivrRuntime } from '../runtime.js';

registerHandler('check_user', async (ctx) => {
  const callerNumber = ctx.req.body.caller_id;

  const { data: phones } = await supabaseAdmin
    .from('user_phones')
    .select('user_id')
    .eq('phone_number', callerNumber)
    .limit(1);

  if (phones && phones.length > 0) {
    const userId = phones[0].user_id;

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, name, status')
      .eq('id', userId)
      .single();

    if (!user) {
      return { type: 'actions', response: buildHangup('We could not find your account. Please contact support.') };
    }

    if (user.status === 'frozen') {
      return { type: 'actions', response: buildHangup('Your account is currently restricted. Please contact support.') };
    }

    if (user.status === 'deleted') {
      return { type: 'actions', response: buildHangup('This account is no longer active. Please contact support.') };
    }

    await ivrRuntime.updateSession(ctx.callSid, { user_id: user.id });

    const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'existing_user');
    if (nextNode) {
      return {
        type: 'actions',
        response: buildGather({
          prompt: nextNode.prompt_text || 'Please enter your 4 digit PIN.',
          actionPath: '/api/ivr/voice/gather',
          numDigits: 4,
          timeout: 10,
          finishOnKey: '',
          regex: '[0-9]+',
          sessionData: {
            call_sid: ctx.callSid,
            user_id: user.id,
            node_key: nextNode.node_key,
          },
        }),
      };
    }
  }

  await ivrRuntime.updateSession(ctx.callSid, { user_id: null });

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'new_user');
  return {
    type: 'actions',
    response: buildCollect({
      type: 'recording',
      id: 'caller_name',
      prompt: 'Welcome to VoiceX! It looks like you are a new caller. To create an account, please say your full name after the beep, then press pound.',
      confirm: true,
      confirmMethod: 'transcribe',
      transcribe: true,
      retry: 3,
      maxDuration: 10,
      actionPath: '/api/ivr/voice/gather',
      sessionData: {
        call_sid: ctx.callSid,
        node_key: nextNode?.node_key || 'register_name',
      },
    }),
  };
});
