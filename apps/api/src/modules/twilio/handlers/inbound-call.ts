import type { Request, Response } from 'express';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { buildGather, buildSay, buildHangup } from '../twiml-builder.js';
import { ivrRuntime } from '../../ivr/runtime.js';

export async function handleInboundCall(req: Request, res: Response) {
  const callSid = req.body.CallSid;
  const callerNumber = req.body.From;

  try {
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
        res.type('text/xml').send(
          buildHangup('We could not find your account. Please contact support.')
        );
        return;
      }

      if (user.status === 'frozen') {
        res.type('text/xml').send(
          buildHangup('Your account is currently restricted. Please contact support.')
        );
        return;
      }

      if (user.status === 'deleted') {
        res.type('text/xml').send(
          buildHangup('This account is no longer active. Please contact support.')
        );
        return;
      }

      await ivrRuntime.createSession(callSid, callerNumber, userId);

      res.type('text/xml').send(
        buildGather({
          prompt: `Welcome back. Please enter your 4 digit PIN.`,
          actionPath: '/api/twilio/voice/gather',
          inputType: 'dtmf',
          numDigits: 4,
          timeout: 10,
          finishOnKey: '',
          sessionData: {
            call_sid: callSid,
            user_id: userId,
            step: 'pin_entry',
          },
        })
      );
    } else {
      await ivrRuntime.createSession(callSid, callerNumber, null);

      res.type('text/xml').send(
        buildGather({
          prompt: 'Welcome to VoiceX! It looks like you are a new caller. To create an account, please say your full name followed by the pound key.',
          actionPath: '/api/twilio/voice/gather',
          inputType: 'dtmf speech',
          timeout: 10,
          finishOnKey: '#',
          sessionData: {
            call_sid: callSid,
            step: 'register_name',
          },
        })
      );
    }
  } catch (error) {
    console.error('Inbound call error:', error);
    res.type('text/xml').send(
      buildHangup('We are experiencing technical difficulties. Please try again later.')
    );
  }
}
