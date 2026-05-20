import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildGatherFromNode, buildCollect, buildHangup } from '../../teltech/teltech-builder.js';
import { ivrRuntime } from '../runtime.js';

registerHandler('capture_name', async (ctx) => {
  const fieldTranscript = ctx.req.body.field_transcript;
  const fieldValue = ctx.req.body.field_value;
  const variables = ctx.req.body.variables || {};
  const name = fieldTranscript || fieldValue || variables.caller_name_text || variables.caller_name;

  if (!name || name.trim().length < 2) {
    return {
      type: 'actions',
      response: buildCollect({
        type: 'recording',
        id: 'caller_name',
        prompt: 'Please say your full name after the beep, then press pound.',
        confirm: true,
        confirmMethod: 'transcribe',
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

  // TelTech's collect with confirm:true already handled confirmation,
  // so skip register_name_confirm and go straight to register_pin.
  const pinNode = await ivrRuntime.getNodeByKey(ctx.flowVersionId, 'register_pin');
  return {
    type: 'actions',
    response: buildGather({
      prompt: pinNode?.prompt_text || 'Please enter a 4 digit PIN that you will use to access your account.',
      actionPath: '/api/ivr/voice/gather',
      numDigits: 4,
      timeout: 15,
      finishOnKey: '',
      sessionData: { call_sid: ctx.callSid, node_key: 'register_pin', name: trimmedName },
    }),
  };
});

registerHandler('confirm_name', async (ctx) => {
  const digits = ctx.req.body.digits;
  const name = ctx.sessionData.name;

  if (digits === '2' || !digits) {
    const retryNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'retry');
    return {
      type: 'actions',
      response: buildCollect({
        type: 'recording',
        id: 'caller_name',
        prompt: 'Please say your full name after the beep, then press pound.',
        confirm: true,
        confirmMethod: 'transcribe',
        transcribe: true,
        retry: 3,
        maxDuration: 10,
        actionPath: '/api/ivr/voice/gather',
        sessionData: { call_sid: ctx.callSid, node_key: retryNode?.node_key || 'register_name' },
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
      current_node_key: 'main_menu',
      retry_count: 0,
    });

    const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'confirmed');
    if (nextNode) {
      const intro = 'Please note, you can press star at any time to return to the previous menu. ';
      return {
        type: 'actions',
        response: buildGatherFromNode(
          nextNode,
          { call_sid: ctx.callSid, user_id: user.id },
          { prompt: intro + (nextNode.prompt_text || '') }
        ),
      };
    }

    return { type: 'actions', response: buildHangup('Account created. Please call back.') };
  } catch (error) {
    console.error('Registration error:', error);
    return { type: 'actions', response: buildHangup('We had trouble creating your account. Please try again later.') };
  }
});
