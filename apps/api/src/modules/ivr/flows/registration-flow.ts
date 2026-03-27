import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { buildGather, buildSay, buildHangup } from '../../twilio/twiml-builder.js';
import { ivrRuntime } from '../runtime.js';
import { buildMainMenuTwiml } from './pin-flow.js';

export async function handleRegistration(req: Request, res: Response) {
  const step = req.query.step as string;
  const callSid = req.query.call_sid as string;
  const digits = req.body.Digits;
  const speechResult = req.body.SpeechResult;

  switch (step) {
    case 'register_name':
      return handleNameCapture(req, res, callSid, speechResult);
    case 'register_name_confirm':
      return handleNameConfirm(req, res, callSid, digits);
    case 'register_pin':
      return handlePinCapture(req, res, callSid, digits);
    case 'register_pin_confirm':
      return handlePinConfirm(req, res, callSid, digits);
    default:
      res.type('text/xml').send(
        buildHangup('An error occurred during registration.')
      );
  }
}

async function handleNameCapture(
  req: Request,
  res: Response,
  callSid: string,
  speechResult: string | undefined
) {
  if (!speechResult || speechResult.trim().length < 2) {
    res.type('text/xml').send(
      buildGather({
        prompt: 'I didn\'t catch that. Please say your full name followed by the pound key.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'speech',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: callSid, step: 'register_name' },
      })
    );
    return;
  }

  const name = speechResult.trim();
  const spelled = name.split('').join(', ');

  await ivrRuntime.updateSession(callSid, {
    state_data: { registration_name: name },
  });

  res.type('text/xml').send(
    buildGather({
      prompt: `I heard your name as: ${name}. That is spelled: ${spelled}. Press 1 to confirm, or press 2 to re-enter your name.`,
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf speech',
      numDigits: 1,
      timeout: 10,
      hints: ['confirm', 'reenter', 'yes', 'no', 'one', 'two'],
      sessionData: { call_sid: callSid, step: 'register_name_confirm', name },
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
    res.type('text/xml').send(
      buildGather({
        prompt: 'Please say your full name followed by the pound key.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'speech',
        timeout: 10,
        finishOnKey: '#',
        sessionData: { call_sid: callSid, step: 'register_name' },
      })
    );
    return;
  }

  res.type('text/xml').send(
    buildGather({
      prompt: 'Please enter a 4 digit PIN that you will use to access your account.',
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf',
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
    res.type('text/xml').send(
      buildGather({
        prompt: 'The PIN must be exactly 4 digits. Please try again.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        numDigits: 4,
        timeout: 15,
        finishOnKey: '',
        sessionData: { call_sid: callSid, step: 'register_pin', name },
      })
    );
    return;
  }

  const spelled = digits.split('').join(', ');

  res.type('text/xml').send(
    buildGather({
      prompt: `Your PIN is: ${spelled}. Press 1 to confirm, or press 2 to re-enter.`,
      actionPath: '/api/twilio/voice/gather',
      inputType: 'dtmf',
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
    res.type('text/xml').send(
      buildGather({
        prompt: 'Please enter a 4 digit PIN.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
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
    const phoneNumber = session?.phone_number || req.body.From || '';

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

    res.type('text/xml').send(
      buildMainMenuTwiml(callSid, user.id)
    );
  } catch (error) {
    console.error('Registration error:', error);
    res.type('text/xml').send(
      buildHangup('We had trouble creating your account. Please try again later.')
    );
  }
}
