import { Router } from 'express';
import crypto from 'crypto';
import { supabaseAdmin } from '../../lib/supabase.js';

export const webhookRouter = Router();

webhookRouter.post('/rye', async (req, res) => {
  const signature = req.headers['rye-hmac-signature-v1'] as string;
  const body = JSON.stringify(req.body);

  // Webhook signature verification (when HMAC secret is configured)
  if (process.env.RYE_WEBHOOK_SECRET && signature) {
    const expected = crypto
      .createHmac('sha256', process.env.RYE_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    if (signature !== expected) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  }

  const event = req.body;

  try {
    switch (event.type) {
      case 'PAYMENT_SUCCEEDED':
      case 'PAYMENT_FAILED':
      case 'PAYMENT_REFUNDED':
      case 'REFUND_CREATED': {
        const intentId = event.data?.checkoutIntentId;
        if (!intentId) break;

        const { data: order } = await supabaseAdmin
          .from('orders')
          .select('id')
          .eq('rye_checkout_intent_id', intentId)
          .single();

        if (order) {
          const statusMap: Record<string, string> = {
            PAYMENT_SUCCEEDED: 'completed',
            PAYMENT_FAILED: 'failed',
            PAYMENT_REFUNDED: 'cancelled',
            REFUND_CREATED: 'cancelled',
          };

          const newStatus = statusMap[event.type] || 'processing';

          await supabaseAdmin.from('order_events').insert({
            order_id: String(order.id),
            status: newStatus,
            source: 'rye_webhook',
            details: event.data,
          });

          await supabaseAdmin
            .from('orders')
            .update({ status: newStatus })
            .eq('id', String(order.id));
        }
        break;
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
});
