import type { Request, Response } from 'express';
import { buildSay, buildHangup } from '../teltech-builder.js';

export async function handlePaymentResult(req: Request, res: Response) {
  const userId = req.query.user_id as string;
  const callSid = req.query.call_sid as string;

  res.json(
    buildSay(
      'Phone-based payment is temporarily unavailable. Please use the web app to complete your purchase. Returning to the main menu.',
      `/api/ivr/voice/gather?node_key=main_menu&user_id=${userId}&call_sid=${callSid}`
    )
  );
}
