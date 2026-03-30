import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { buildGather, buildSay, buildHangup } from '../../twilio/twiml-builder.js';
import { ivrRuntime } from '../runtime.js';

export async function handlePinEntry(req: Request, res: Response) {
  const userId = req.query.user_id as string;
  const callSid = req.query.call_sid as string;
  const digits = req.body.Digits;
  const step = req.query.step as string;

  if (!digits || digits.length !== 4) {
    const session = await ivrRuntime.getSession(callSid);
    const retries = (session?.retry_count || 0) + 1;

    if (retries >= 3) {
      await supabaseAdmin.from('login_events').insert({
        user_id: userId,
        phone_number: session?.phone_number || '',
        success: false,
        failure_reason: 'max_retries_exceeded',
      });
      res.type('text/xml').send(
        buildHangup('Too many failed attempts. Please try again later. Goodbye.')
      );
      return;
    }

    await ivrRuntime.updateSession(callSid, { retry_count: retries });

    res.type('text/xml').send(
      buildGather({
        prompt: 'Invalid PIN. Please enter your 4 digit PIN.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        numDigits: 4,
        timeout: 10,
        finishOnKey: '',
        sessionData: { call_sid: callSid, user_id: userId, step: 'pin_entry' },
      })
    );
    return;
  }

  const { data: pinRecord } = await supabaseAdmin
    .from('user_pins')
    .select('pin_hash')
    .eq('user_id', userId)
    .single();

  if (!pinRecord) {
    res.type('text/xml').send(
      buildHangup('Account configuration error. Please contact support.')
    );
    return;
  }

  const isValid = await bcrypt.compare(digits, pinRecord.pin_hash);

  if (!isValid) {
    const session = await ivrRuntime.getSession(callSid);
    const retries = (session?.retry_count || 0) + 1;

    if (retries >= 3) {
      await supabaseAdmin.from('login_events').insert({
        user_id: userId,
        phone_number: session?.phone_number || '',
        success: false,
        failure_reason: 'wrong_pin_max_retries',
      });
      res.type('text/xml').send(
        buildHangup('Too many failed attempts. Please try again later. Goodbye.')
      );
      return;
    }

    await ivrRuntime.updateSession(callSid, { retry_count: retries });

    res.type('text/xml').send(
      buildGather({
        prompt: 'Incorrect PIN. Please try again.',
        actionPath: '/api/twilio/voice/gather',
        inputType: 'dtmf',
        numDigits: 4,
        timeout: 10,
        finishOnKey: '',
        sessionData: { call_sid: callSid, user_id: userId, step: 'pin_entry' },
      })
    );
    return;
  }

  const session = await ivrRuntime.getSession(callSid);
  await supabaseAdmin.from('login_events').insert({
    user_id: userId,
    phone_number: session?.phone_number || '',
    success: true,
    failure_reason: null,
  });

  await ivrRuntime.updateSession(callSid, {
    current_node_key: 'main_menu',
    retry_count: 0,
  });

  res.type('text/xml').send(
    buildMainMenuTwiml(callSid, userId)
  );
}

export function buildMainMenuTwiml(callSid: string, userId: string): string {
  return buildGather({
    prompt: 'Main Menu. Press 1 or say Catalog to browse products. Press 2 or say Cart to view your cart. Press 3 or say Orders to check order status.',
    actionPath: '/api/twilio/voice/gather',
    inputType: 'dtmf speech',
    timeout: 8,
    hints: ['catalog', 'cart', 'orders', 'one', 'two', 'three', 'shopping', 'buy products', 'order status'],
    sessionData: { call_sid: callSid, user_id: userId, step: 'main_menu' },
  });
}