import { Router } from 'express';
import { normalizeToE164, sendSms } from '../../lib/telnyx.js';

export const smsTestRouter = Router();

const MAX_MESSAGE_LENGTH = 1600;

smsTestRouter.post('/', async (req, res) => {
  const { to, message } = req.body;

  if (!to || typeof to !== 'string' || !to.trim()) {
    return res.status(400).json({ error: 'to is required' });
  }

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `message must be at most ${MAX_MESSAGE_LENGTH} characters` });
  }

  const normalizedTo = normalizeToE164(to);
  if (!normalizedTo) {
    return res.status(400).json({ error: 'Invalid phone number. Use E.164 format (e.g. +15551234567) or a 10-digit US number.' });
  }

  try {
    const result = await sendSms({ to: normalizedTo, text: message.trim() });
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('SMS test error:', error);
    const messageText = error instanceof Error ? error.message : String(error);
    if (messageText.includes('not configured')) {
      return res.status(500).json({ error: messageText });
    }
    if (messageText.startsWith('Telnyx error (4')) {
      return res.status(400).json({ error: messageText });
    }
    return res.status(500).json({ error: messageText });
  }
});
