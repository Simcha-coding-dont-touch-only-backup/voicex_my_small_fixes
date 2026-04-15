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

export interface FreeformValidationResult {
  isValid: boolean;
  action: 'ACCEPT' | 'CONFIRM' | 'CONFIRM_ADD_SUBPREMISES' | 'FIX';
  formattedAddress: string | null;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  validationGranularity: string;
  addressComplete: boolean;
  hasSpellCorrections: boolean;
  hasReplacements: boolean;
  hasInferences: boolean;
  hasUnresolvedTokens: boolean;
  dpvConfirmation: string;
  rawResponse?: unknown;
}

/**
 * Granularity levels that indicate a premise-level match or better.
 * PREMISE_PROXIMITY means Google matched to a nearby known premise — still deliverable.
 * OTHER and ROUTE are too coarse to be considered valid.
 */
const ACCEPTABLE_GRANULARITY = new Set(['PREMISE', 'SUB_PREMISE', 'PREMISE_PROXIMITY']);

export async function validateAddressFreeform(
  rawAddress: string,
  country: string = 'US'
): Promise<FreeformValidationResult> {
  const url = `https://addressvalidation.googleapis.com/v1:validateAddress?key=${config.google.addressValidationApiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: {
        regionCode: country,
        addressLines: [rawAddress],
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
  const postalAddress = addressObj.postalAddress || {};
  const uspsData = data.result?.uspsData || {};

  const validationGranularity: string = verdict.validationGranularity || 'OTHER';
  const addressComplete: boolean = verdict.addressComplete === true;
  const hasUnresolvedTokens = (addressObj.unresolvedTokens || []).length > 0;
  const dpvConfirmation: string = uspsData.dpvConfirmation || '';

  const action: 'ACCEPT' | 'CONFIRM' | 'CONFIRM_ADD_SUBPREMISES' | 'FIX' =
    verdict.possibleNextAction === 'FIX' ? 'FIX'
    : verdict.possibleNextAction === 'CONFIRM_ADD_SUBPREMISES' ? 'CONFIRM_ADD_SUBPREMISES'
    : verdict.possibleNextAction === 'CONFIRM' ? 'CONFIRM'
    : verdict.possibleNextAction === 'ACCEPT' ? 'ACCEPT'
    : 'FIX'; // if missing, treat as FIX rather than assuming valid

  const formattedAddress = addressObj.formattedAddress || null;

  const addressLines: string[] = postalAddress.addressLines || [];
  const address1 = addressLines[0] || '';
  const address2 = addressLines.length > 1 ? addressLines[1] : '';

  const isValid =
    action === 'ACCEPT'
    && ACCEPTABLE_GRANULARITY.has(validationGranularity)
    && addressComplete
    && !hasUnresolvedTokens;

  return {
    isValid,
    action,
    formattedAddress,
    address1,
    address2,
    city: postalAddress.locality || '',
    state: postalAddress.administrativeArea || '',
    zipCode: postalAddress.postalCode || '',
    validationGranularity,
    addressComplete,
    hasSpellCorrections: verdict.hasSpellCorrectedComponents || false,
    hasReplacements: verdict.hasReplacedComponents || false,
    hasInferences: verdict.hasInferredComponents || false,
    hasUnresolvedTokens,
    dpvConfirmation,
    rawResponse: data,
  };
}
