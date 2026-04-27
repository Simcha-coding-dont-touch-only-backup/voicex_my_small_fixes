import { Router, type Request } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../lib/supabase.js';

export const contactRouter = Router();

const ROLE_VALUES = ['merchant', 'investor', 'partner', 'press', 'other'] as const;

const contactSubmissionSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  email: z.string().trim().email('Please enter a valid email').max(320),
  company: z.string().trim().max(200).optional().nullable(),
  role: z.enum(ROLE_VALUES),
  message: z.string().trim().min(1, 'Message is required').max(10000),
  source_path: z.string().trim().max(500).optional(),
  website: z.string().trim().max(0).optional(),
});

function getClientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return raw?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
}

contactRouter.post('/', async (req, res) => {
  const parsed = contactSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid contact submission',
    });
    return;
  }

  // Honeypot: real users never fill this hidden field.
  if (parsed.data.website) {
    res.json({ success: true });
    return;
  }

  const { name, email, company, role, message, source_path } = parsed.data;
  const { error } = await supabaseAdmin.from('contact_submissions').insert({
    name,
    email,
    company: company || null,
    role,
    message,
    source_path: source_path || null,
    user_agent: req.get('user-agent') || null,
    ip_address: getClientIp(req),
  });

  if (error) {
    res.status(500).json({ success: false, error: 'Could not submit contact form' });
    return;
  }

  res.status(201).json({ success: true });
});
