import Telnyx from 'telnyx';
import { config } from '../config.js';

let client: Telnyx | null = null;

export function getClient(): Telnyx {
  if (!config.telnyx.apiKey) {
    throw new Error('TELNYX_API_KEY is not configured');
  }
  if (!client) {
    client = new Telnyx({ apiKey: config.telnyx.apiKey });
  }
  return client;
}

export function normalizeToE164(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return null;
    return `+${digits}`;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export interface SendSmsParams {
  to: string;
  text: string;
  from?: string;
}

export interface SendSmsResult {
  id: string;
  status: string;
  to: string;
  from: string;
  text: string;
}

export async function sendSms({ to, text, from }: SendSmsParams): Promise<SendSmsResult> {
  const fromNumber = from ?? config.telnyx.smsFromNumber;
  if (!fromNumber) {
    throw new Error('TELNYX_SMS_FROM_NUMBER is not configured');
  }

  try {
    const response = await getClient().messages.send({
      from: fromNumber,
      to,
      text,
      ...(config.telnyx.messagingProfileId && {
        messaging_profile_id: config.telnyx.messagingProfileId,
      }),
    });

    const data = response.data;
    if (!data) {
      throw new Error('Telnyx returned an empty response');
    }

    const toEntry = Array.isArray(data.to) ? data.to[0] : data.to;
    const toNumber =
      typeof toEntry === 'object' && toEntry && 'phone_number' in toEntry
        ? String(toEntry.phone_number)
        : to;

    const fromValue = data.from;
    const fromNumberResult =
      typeof fromValue === 'object' && fromValue && 'phone_number' in fromValue
        ? String(fromValue.phone_number)
        : typeof fromValue === 'string'
          ? fromValue
          : fromNumber;

    return {
      id: data.id ?? '',
      status:
        typeof toEntry === 'object' && toEntry && 'status' in toEntry
          ? String(toEntry.status)
          : 'queued',
      to: toNumber,
      from: fromNumberResult,
      text: data.text ?? text,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && 'message' in error) {
      const status = (error as { status: number }).status;
      const message = String((error as { message: unknown }).message);
      throw new Error(`Telnyx error (${status}): ${message}`);
    }
    throw error;
  }
}
