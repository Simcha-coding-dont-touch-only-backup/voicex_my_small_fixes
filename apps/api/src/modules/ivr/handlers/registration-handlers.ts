import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildHangup } from '../../teltech/teltech-builder.js';
import { ivrRuntime } from '../runtime.js';

registerHandler('capture_name', async (ctx) => {
  const digits = ctx.req.body.digits;

  if (!digits || digits.trim().length < 2) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'I didn\'t catch that. Please enter your name using the keypad followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: ctx.callSid, node_key: ctx.node.node_key },
      }),
    };
  }

  const name = digits.trim();
  const spelled = name.split('').join(', ');

  await ivrRuntime.updateSession(ctx.callSid, {
    state_data: { registration_name: name },
  });

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);
  return {
    type: 'actions',
    response: buildGather({
      prompt: `Your name is: ${name}. That is spelled: ${spelled}. Press 1 to confirm, or press 2 to re-enter your name.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 10,
      sessionData: { call_sid: ctx.callSid, node_key: nextNode?.node_key || 'register_name_confirm', name },
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
      response: buildGather({
        prompt: 'Please enter your name using the keypad followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
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
      return {
        type: 'actions',
        response: buildGather({
          prompt: nextNode.prompt_text || 'Main Menu.',
          actionPath: '/api/ivr/voice/gather',
          timeout: 8,
          sessionData: { call_sid: ctx.callSid, user_id: user.id, node_key: nextNode.node_key },
        }),
      };
    }

    return { type: 'actions', response: buildHangup('Account created. Please call back.') };
  } catch (error) {
    console.error('Registration error:', error);
    return { type: 'actions', response: buildHangup('We had trouble creating your account. Please try again later.') };
  }
});
