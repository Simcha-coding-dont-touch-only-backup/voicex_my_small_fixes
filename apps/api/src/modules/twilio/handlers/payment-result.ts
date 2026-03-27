import type { Request, Response } from 'express';
import { supabaseAdmin } from '../../../lib/supabase.js';
import { buildSay, buildHangup } from '../twiml-builder.js';

export async function handlePaymentResult(req: Request, res: Response) {
  const userId = req.query.user_id as string;
  const callSid = req.query.call_sid as string;
  const result = req.body.Result;
  const paymentToken = req.body.PaymentToken;
  const cardType = req.body.PaymentCardType;
  const cardNumber = req.body.PaymentCardNumber;

  if (result !== 'success' || !paymentToken) {
    res.type('text/xml').send(
      buildSay(
        'Payment capture failed. Let us try again.',
        `/api/twilio/voice/gather?step=checkout_payment_choice&user_id=${userId}&call_sid=${callSid}`
      )
    );
    return;
  }

  try {
    const last4 = cardNumber ? cardNumber.slice(-4) : '****';

    const { data: pm } = await supabaseAdmin
      .from('payment_methods')
      .insert({
        user_id: userId,
        stripe_token: paymentToken,
        card_last4: last4,
        card_brand: cardType || null,
        card_exp_month: 0,
        card_exp_year: 0,
        is_default: false,
      })
      .select()
      .single();

    if (!pm) {
      throw new Error('Failed to save payment method');
    }

    res.type('text/xml').send(
      buildSay(
        `Card ending in ${last4} has been captured. Proceeding to order summary.`,
        `/api/twilio/voice/gather?step=checkout_summary&user_id=${userId}&call_sid=${callSid}&payment_method_id=${pm.id}`
      )
    );
  } catch (error) {
    console.error('Payment save error:', error);
    res.type('text/xml').send(
      buildHangup('We had trouble saving your payment information. Please try again later.')
    );
  }
}
