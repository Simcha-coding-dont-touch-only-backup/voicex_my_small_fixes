import { config } from '../config.js';

const SOLA_ENDPOINT = 'https://x1.cardknox.com/gatewayjson';
const SOLA_VERSION = '5.0.0';
const SOLA_SOFTWARE_NAME = 'VoiceX';
const SOLA_SOFTWARE_VERSION = '1.0.0';

interface SolaBaseResponse {
  xResult: 'A' | 'D' | 'E';
  xStatus: string;
  xError: string;
  xErrorCode: string;
  xRefNum: string;
  xDate: string;
}

export interface SolaTokenizeResponse extends SolaBaseResponse {
  xToken: string;
  xMaskedCardNumber: string;
  xCardType: string;
  xExp: string;
}

export interface SolaAuthResponse extends SolaBaseResponse {
  xToken: string;
  xAuthAmount: string;
  xMaskedCardNumber: string;
  xCardType: string;
}

export interface SolaCaptureResponse extends SolaBaseResponse {
  xAuthAmount: string;
}

export interface SolaVoidResponse extends SolaBaseResponse {}

export interface SolaSaleResponse extends SolaBaseResponse {
  xAuthAmount: string;
  xMaskedCardNumber: string;
  xCardType: string;
  xToken: string;
}

function basePayload() {
  return {
    xKey: config.sola.apiKey,
    xVersion: SOLA_VERSION,
    xSoftwareName: SOLA_SOFTWARE_NAME,
    xSoftwareVersion: SOLA_SOFTWARE_VERSION,
  };
}

async function solaRequest<T extends SolaBaseResponse>(payload: Record<string, string>): Promise<T> {
  const response = await fetch(SOLA_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Sola HTTP error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as T;

  if (data.xResult === 'E') {
    throw new Error(`Sola error: ${data.xError} (code: ${data.xErrorCode})`);
  }

  return data;
}

/**
 * Tokenize a card without processing a transaction.
 * Uses cc:save to get a reusable xToken.
 * cardNum may be a raw PAN or an iFields single-use token (SUT).
 * cvv may be a raw CVV or a CVV SUT.
 */
export async function solaTokenize(
  cardNum: string,
  exp: string,
  cvv?: string,
  zip?: string
): Promise<SolaTokenizeResponse> {
  const payload: Record<string, string> = {
    ...basePayload(),
    xCommand: 'cc:save',
    xCardNum: cardNum,
    xExp: exp,
  };
  if (cvv) payload.xCVV = cvv;
  if (zip) payload.xZip = zip;

  return solaRequest<SolaTokenizeResponse>(payload);
}

/**
 * Place an authorization hold on the customer's card.
 * Funds are reserved but not charged.
 */
export async function solaAuthOnly(
  token: string,
  amountCents: number,
  invoice?: string
): Promise<SolaAuthResponse> {
  const payload: Record<string, string> = {
    ...basePayload(),
    xCommand: 'cc:authonly',
    xToken: token,
    xAmount: (amountCents / 100).toFixed(2),
  };
  if (invoice) payload.xInvoice = invoice;

  return solaRequest<SolaAuthResponse>(payload);
}

/**
 * Capture a previously authorized hold.
 * Settles the funds from the cardholder's account.
 */
export async function solaCapture(
  refNum: string,
  amountCents?: number
): Promise<SolaCaptureResponse> {
  const payload: Record<string, string> = {
    ...basePayload(),
    xCommand: 'cc:capture',
    xRefNum: refNum,
  };
  if (amountCents !== undefined) {
    payload.xAmount = (amountCents / 100).toFixed(2);
  }

  return solaRequest<SolaCaptureResponse>(payload);
}

/**
 * Release a pending authorization hold back to the cardholder's credit limit.
 * Used when an order fails after auth was placed.
 */
export async function solaVoidRelease(refNum: string): Promise<SolaVoidResponse> {
  const payload: Record<string, string> = {
    ...basePayload(),
    xCommand: 'cc:voidrelease',
    xRefNum: refNum,
  };

  return solaRequest<SolaVoidResponse>(payload);
}

/**
 * Charge a stored card token in a single step (sale = auth + capture) for a
 * merchant-initiated, unattended subscription charge.
 *
 * Cardknox/Sola flags merchant-initiated recurring transactions with
 * `xRecurringIndicator: 'Recurring'`; omitting it on a stored-token charge with
 * no cardholder present (no CVV) risks issuer declines. Used by the subscription
 * processing engine, NOT the interactive cardholder-present checkout (which
 * stays on the auth/capture flow in checkout-handlers).
 *
 * Returns the response even for declines (xResult='D'); callers must check
 * xResult === 'A'. Only transport/gateway errors (xResult='E') throw.
 */
export async function solaSaleRecurring(
  token: string,
  amountCents: number,
  opts?: { invoice?: string; name?: string; description?: string }
): Promise<SolaSaleResponse> {
  const payload: Record<string, string> = {
    ...basePayload(),
    xCommand: 'cc:sale',
    xToken: token,
    xAmount: (amountCents / 100).toFixed(2),
    xRecurringIndicator: 'Recurring',
  };
  if (opts?.invoice) payload.xInvoice = opts.invoice;
  if (opts?.name) payload.xName = opts.name;
  if (opts?.description) payload.xDescription = opts.description;

  return solaRequest<SolaSaleResponse>(payload);
}

/** Derive last4 from Sola's xMaskedCardNumber (e.g. XXXXXXXXXXXX4242). */
export function last4FromMaskedCardNumber(masked: string | null | undefined): string {
  const digits = String(masked || '').replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4);
  return '0000';
}
