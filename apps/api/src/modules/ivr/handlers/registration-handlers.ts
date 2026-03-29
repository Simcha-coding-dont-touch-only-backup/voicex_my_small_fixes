import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildHangup } from '../../twilio/twiml-builder.js';
import { ivrRuntime } from '../runtime.js';

registerHandler('capture_name', async (ctx) => {
  const speechResult = ctx.req.body.SpeechResult;

  if (!speechResult || speechResult.trim().length < 2) {
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'I didn\'t catch that. Please say your full name followed by the pound key.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'speech',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: ctx.callSid, node_key: ctx.node.node_key },
      }),
    };
  }

  const name = speechResult.trim();
  const spelled = name.split('').join(', ');

  await ivrRuntime.updateSession(ctx.callSid, {
    state_data: { registration_name: name },
  });

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);
  return {
    type: 'twiml',
    twiml: buildGather({
      prompt: `I heard your name as: ${name}. That is spelled: ${spelled}. Press 1 to confirm, or press 2 to re-enter your name.`,
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf speech',
      numDigits: 1,
      timeout: 10,
      hints: ['confirm', 'reenter', 'yes', 'no', 'one', 'two'],
      sessionData: { call_sid: ctx.callSid, node_key: nextNode?.node_key || 'register_name_confirm', name },
    }),
  };
});

registerHandler('confirm_name', async (ctx) => {
  const digits = ctx.req.body.Digits;
  const name = ctx.sessionData.name;

  if (digits === '2' || !digits) {
    const retryNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'retry');
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'Please say your full name followed by the pound key.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'speech',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: ctx.callSid, node_key: retryNode?.node_key || 'register_name' },
      }),
    };
  }

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'confirmed');
  return {
    type: 'twiml',
    twiml: buildGather({
      prompt: nextNode?.prompt_text || 'Please enter a 4 digit PIN that you will use to access your account.',
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf',
      numDigits: 4,
      timeout: 15,
      finishOnKey: '',
      sessionData: { call_sid: ctx.callSid, node_key: nextNode?.node_key || 'register_pin', name },
    }),
  };
});

registerHandler('capture_pin', async (ctx) => {
  const digits = ctx.req.body.Digits;
  const name = ctx.sessionData.name;

  if (!digits || digits.length !== 4) {
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'The PIN must be exactly 4 digits. Please try again.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
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
    type: 'twiml',
    twiml: buildGather({
      prompt: `Your PIN is: ${spelled}. Press 1 to confirm, or press 2 to re-enter.`,
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf',
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
  const digits = ctx.req.body.Digits;
  const name = ctx.sessionData.name;
  const pin = ctx.sessionData.pin;

  if (digits === '2' || !digits) {
    const retryNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'retry');
    return {
      type: 'twiml',
      twiml: buildGather({
        prompt: 'Please enter a 4 digit PIN.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        numDigits: 4,
        timeout: 15,
        finishOnKey: '',
        sessionData: { call_sid: ctx.callSid, node_key: retryNode?.node_key || 'register_pin', name },
      }),
    };
  }

  try {
    const session = await ivrRuntime.getSession(ctx.callSid);
    const phoneNumber = session?.phone_number || ctx.req.body.From || '';
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
          sessionData: { call_sid: ctx.callSid, user_id: user.id, node_key: nextNode.node_key },
        }),
      };
    }

    return { type: 'twiml', twiml: buildHangup('Account created. Please call back.') };
  } catch (error) {
    console.error('Registration error:', error);
    return { type: 'twiml', twiml: buildHangup('We had trouble creating your account. Please try again later.') };
  }
});
