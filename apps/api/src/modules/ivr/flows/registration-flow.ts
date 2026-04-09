import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { buildGather, buildCollect, buildSay, buildHangup } from '../../teltech/teltech-builder.js';
import { ivrRuntime } from '../runtime.js';
import { buildMainMenuResponse } from './pin-flow.js';

export async function handleRegistration(req: Request, res: Response) {
  const step = req.query.step as string;
  const callSid = req.query.call_sid as string;
  const digits = req.body.digits;

  switch (step) {
    case 'register_name':
      return handleNameCapture(req, res, callSid, digits);
    case 'register_name_confirm':
      return handleNameConfirm(req, res, callSid, digits);
    case 'register_pin':
      return handlePinCapture(req, res, callSid, digits);
    case 'register_pin_confirm':
      return handlePinConfirm(req, res, callSid, digits);
    default:
      res.json(
        buildHangup('An error occurred during registration.')
      );
  }
}

async function handleNameCapture(
  req: Request,
  res: Response,
  callSid: string,
  digits: string | undefined
) {
  const fieldTranscript = req.body.field_transcript;
  const fieldValue = req.body.field_value;
  const variables = req.body.variables || {};
  const name = fieldTranscript || fieldValue || variables.caller_name_text || variables.caller_name || digits;

  if (!name || name.trim().length < 2) {
    res.json(
      buildCollect({
        type: 'recording',
        id: 'caller_name',
        prompt: 'Please say your full name after the beep, then press pound.',
        confirm: true,
        confirmMethod: 'transcribe',
        transcribe: true,
        retry: 3,
        maxDuration: 10,
        actionPath: '/api/ivr/voice/gather',
        sessionData: { call_sid: callSid, step: 'register_name' },
      })
    );
    return;
  }

  const trimmedName = name.trim();

  await ivrRuntime.updateSession(callSid, {
    state_data: { registration_name: trimmedName },
  });

  res.json(
    buildGather({
      prompt: 'Please enter a 4 digit PIN that you will use to access your account.',
      actionPath: '/api/ivr/voice/gather',
      numDigits: 4,
      timeout: 15,
      finishOnKey: '',
      sessionData: { call_sid: callSid, step: 'register_pin', name: trimmedName },
    })
  );
}

async function handleNameConfirm(
  req: Request,
  res: Response,
  callSid: string,
  digits: string | undefined
) {
  const name = req.query.name as string;

  if (digits === '2' || !digits) {
    res.json(
      buildCollect({
        type: 'recording',
        id: 'caller_name',
        prompt: 'Please say your full name after the beep, then press pound.',
        confirm: true,
        confirmMethod: 'transcribe',
        transcribe: true,
        retry: 3,
        maxDuration: 10,
        actionPath: '/api/ivr/voice/gather',
        sessionData: { call_sid: callSid, step: 'register_name' },
      })
    );
    return;
  }

  res.json(
    buildGather({
      prompt: 'Please enter a 4 digit PIN that you will use to access your account.',
      actionPath: '/api/ivr/voice/gather',
      numDigits: 4,
      timeout: 15,
      finishOnKey: '',
      sessionData: { call_sid: callSid, step: 'register_pin', name },
    })
  );
}

async function handlePinCapture(
  req: Request,
  res: Response,
  callSid: string,
  digits: string | undefined
) {
  const name = req.query.name as string;

  if (!digits || digits.length !== 4) {
    res.json(
      buildGather({
        prompt: 'The PIN must be exactly 4 digits. Please try again.',
        actionPath: '/api/ivr/voice/gather',
        numDigits: 4,
        timeout: 15,
        finishOnKey: '',
        sessionData: { call_sid: callSid, step: 'register_pin', name },
      })
    );
    return;
  }

  const spelled = digits.split('').join(', ');

  res.json(
    buildGather({
      prompt: `Your PIN is: ${spelled}. Press 1 to confirm, or press 2 to re-enter.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 10,
      finishOnKey: '',
      sessionData: {
        call_sid: callSid,
        step: 'register_pin_confirm',
        name,
        pin: digits,
      },
    })
  );
}

async function handlePinConfirm(
  req: Request,
  res: Response,
  callSid: string,
  digits: string | undefined
) {
  const name = req.query.name as string;
  const pin = req.query.pin as string;

  if (digits === '2' || !digits) {
    res.json(
      buildGather({
        prompt: 'Please enter a 4 digit PIN.',
        actionPath: '/api/ivr/voice/gather',
        numDigits: 4,
        timeout: 15,
        finishOnKey: '',
        sessionData: { call_sid: callSid, step: 'register_pin', name },
      })
    );
    return;
  }

  try {
    const session = await ivrRuntime.getSession(callSid);
    const phoneNumber = session?.phone_number || req.body.caller_id || '';

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

    await ivrRuntime.updateSession(callSid, {
      user_id: user.id,
      current_node_key: 'main_menu',
      retry_count: 0,
    });

    res.json(
      buildMainMenuResponse(callSid, user.id)
    );
  } catch (error) {
    console.error('Registration error:', error);
    res.json(
      buildHangup('We had trouble creating your account. Please try again later.')
    );
  }
}
