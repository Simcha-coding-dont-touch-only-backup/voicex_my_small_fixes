import { config } from '../config.js';

interface AddressValidationRequest {
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zipCode: string;
  country?: string;
}

interface AddressValidationResult {
  isValid: boolean;
  action: 'ACCEPT' | 'CONFIRM' | 'CONFIRM_ADD_SUBPREMISES' | 'FIX';
  formattedAddress: string | null;
  correctedAddress: AddressValidationRequest | null;
  hasSpellCorrections: boolean;
  hasReplacements: boolean;
  hasInferences: boolean;
}

export async function validateAddress(
  addr: AddressValidationRequest
): Promise<AddressValidationResult> {
  const url = `https://addressvalidation.googleapis.com/v1:validateAddress?key=${config.google.addressValidationApiKey}`;

  const addressLines = [addr.address1];
  if (addr.address2) addressLines.push(addr.address2);
  addressLines.push(`${addr.city}, ${addr.state} ${addr.zipCode}`);

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: {
        regionCode: addr.country || 'US',
        addressLines,
      },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Google Address Validation failed: ${resp.status} ${body}`);
  }

  const data = await resp.json();
  const verdict = data.result?.verdict || {};
  const addressObj = data.result?.address || {};

  const action = verdict.possibleNextAction || 'ACCEPT';
  const formattedAddress = addressObj.formattedAddress || null;

  return {
    isValid: action === 'ACCEPT',
    action,
    formattedAddress,
    correctedAddress: formattedAddress
      ? parseFormattedAddress(formattedAddress)
      : null,
    hasSpellCorrections: verdict.hasSpellCorrectedComponents || false,
    hasReplacements: verdict.hasReplacedComponents || false,
    hasInferences: verdict.hasInferredComponents || false,
  };
}

function parseFormattedAddress(formatted: string): AddressValidationRequest | null {
  // Google returns formatted addresses like "123 Main St, New York, NY 10001, US"
  const parts = formatted.split(',').map((p) => p.trim());
  if (parts.length < 3) return null;

  const address1 = parts[0];
  const city = parts[parts.length - 3] || parts[1];
  const stateZip = parts[parts.length - 2] || '';
  const stateZipParts = stateZip.trim().split(/\s+/);
  const state = stateZipParts[0] || '';
  const zipCode = stateZipParts.slice(1).join(' ') || '';

  return { address1, city, state, zipCode };
}
