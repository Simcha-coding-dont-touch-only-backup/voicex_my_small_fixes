import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildSay, buildHangup, buildCollect, formatCurrency } from '../../teltech/teltech-builder.js';
import { validateAddress, validateAddressFreeform } from '../../../lib/google-address.js';
import { createRyeIntent, confirmRyeIntent, findCartItemForFailure } from '../../../lib/rye-checkout.js';
import type { StockFailure, IntentResult } from '../../../lib/rye-checkout.js';
import { solaTokenize, solaAuthOnly, solaCapture, solaVoidRelease } from '../../../lib/sola.js';
import { calculateManualPricing } from '../../../lib/manual-pricing.js';
import { getProductDisplayName, getCartItemSavingsCents, formatOrderIdForSpeech } from '@voicex/shared';
import type { FulfillmentProvider } from '@voicex/shared';
import { ivrRuntime } from '../runtime.js';
import { config } from '../../../config.js';
import { logCheckoutEvent } from '../../../lib/checkout-logger.js';
import {
  getRainforestSyncSettings,
  revalidateCartBatch,
  recordCheckoutSyncRun,
  markItemsStale,
  backfillSyncRunOrder,
} from '../../../lib/product-sync.js';
import {
  loadActiveCartWithPricing,
  loadUserPricingContext,
  priceCartItems,
  pricedLinesByCartItemId,
  sumPricedLines,
  getUnpricedCartLineIds,
} from '../../../lib/cart-pricing.js';
import type {
  CheckoutCartItem,
  CheckoutRevalidationItemChange,
  CheckoutRevalidationUnavailable,
  CheckoutRevalidationStale,
  ProductSyncResult,
} from '../../../lib/product-sync.js';

const MAX_STOCK_RETRIES_PER_ITEM = 3;
const MAX_UNAVAILABLE_RECOVERY_CYCLES = 3;

function unpricedCartResponse(ctx: { callSid: string }, userId: string) {
  return {
    type: 'actions' as const,
    response: buildSay(
      'One or more items in your cart are no longer available or have no price. Please update your cart and try again.',
      '/api/ivr/voice/gather',
      { call_sid: ctx.callSid, user_id: userId, node_key: 'cart_menu' },
    ),
  };
}

async function getActiveFulfillmentProvider(): Promise<FulfillmentProvider> {
  const { data, error } = await supabaseAdmin
    .from('settings')
    .select('value')
    .eq('key', 'active_fulfillment_provider')
    .maybeSingle();

  if (error) {
    console.error('[checkout] Failed to load active fulfillment provider; defaulting to Rye.', error);
    return 'rye';
  }

  return data?.value === 'manual' ? 'manual' : 'rye';
}

type PaymentMethodRow = {
  id: string;
  user_id: string;
  is_verified?: boolean | null;
  is_default?: boolean | null;
  card_last4?: string | null;
};

/**
 * Promote a card to verified after it has successfully passed an auth hold.
 * If the card was just entered (unverified), it also becomes the user's default
 * payment method. No-op for cards that were already verified (e.g. a saved card
 * the user picked from the list).
 */
async function promoteVerifiedCard(
  paymentMethod: PaymentMethodRow,
  callSid: string,
  userId: string
): Promise<void> {
  if (paymentMethod.is_verified) return;

  await supabaseAdmin
    .from('payment_methods')
    .update({ is_verified: true, is_default: true })
    .eq('id', paymentMethod.id);

  await supabaseAdmin
    .from('payment_methods')
    .update({ is_default: false })
    .eq('user_id', userId)
    .neq('id', paymentMethod.id);

  await logCheckoutEvent({
    callSid,
    userId,
    eventType: 'payment_method_verified',
    details: {
      payment_method_id: paymentMethod.id,
      card_last4: paymentMethod.card_last4 ?? null,
    },
  });
}

/**
 * Delete a card that never completed a payment. Only removes cards that are
 * still unverified, so a previously-saved card the user reused is never touched.
 */
async function discardUnverifiedCard(
  paymentMethod: PaymentMethodRow,
  callSid: string,
  userId: string
): Promise<void> {
  if (paymentMethod.is_verified) return;

  await supabaseAdmin.from('payment_methods').delete().eq('id', paymentMethod.id).eq('is_verified', false);

  await logCheckoutEvent({
    callSid,
    userId,
    eventType: 'payment_method_discarded',
    details: {
      payment_method_id: paymentMethod.id,
      card_last4: paymentMethod.card_last4 ?? null,
      reason: 'auth_failed',
    },
  });
}

registerHandler('address_choice', async (ctx) => {
  const userId = ctx.sessionData.user_id;

  const { data: addresses } = await supabaseAdmin
    .from('addresses')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false });

  await logCheckoutEvent({
    callSid: ctx.callSid,
    userId,
    eventType: 'checkout_entered',
    details: {
      saved_address_count: addresses?.length ?? 0,
    },
  });

  if (addresses && addresses.length > 0) {
    const defaultAddr = addresses[0];
    const addrStr = `${defaultAddr.address1}, ${defaultAddr.address2 || ''}, ${defaultAddr.city}, ${defaultAddr.state} ${defaultAddr.zip_code}`.replace(/, ,/g, ',');

    return {
      type: 'actions',
      response: buildGather({
        prompt: `Your saved address is: ${addrStr}. Press 1 to use this address, or press 2 to enter a new address.`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 10,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_address_confirm',
          address_id: defaultAddr.id, use_saved: 'pending',
        },
      }),
    };
  }

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'new_address');

  return {
    type: 'actions',
    response: buildCollect({
      type: 'recording',
      id: 'addr_full',
      prompt: nextNode?.prompt_text || 'Please say your complete address, including street, apartment or unit number if any, city, state, and zip code.',
      confirm: false,
      transcribe: true,
      retry: 3,
      maxDuration: 25,
      actionPath: '/api/ivr/voice/gather',
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: nextNode?.node_key || 'checkout_address_full',
        addr_full_retries: '0',
      },
    }),
  };
});

const MAX_FREEFORM_RETRIES = 3;

registerHandler('address_full', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const fieldTranscript = ctx.req.body.field_transcript;
  const fieldValue = ctx.req.body.field_value;
  const variables = ctx.req.body.variables || {};
  const rawAddress = fieldTranscript || fieldValue || variables.addr_full_text || variables.addr_full || ctx.req.body.digits || '';
  const retryCount = parseInt(ctx.sessionData.addr_full_retries || '0', 10);

  if (!rawAddress.trim()) {
    return {
      type: 'actions',
      response: buildCollect({
        type: 'recording',
        id: 'addr_full',
        prompt: 'Please say your complete address, including street, apartment or unit number if any, city, state, and zip code.',
        confirm: false,
        transcribe: true,
        retry: 3,
        maxDuration: 25,
        actionPath: '/api/ivr/voice/gather',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: ctx.node.node_key,
          addr_full_retries: String(retryCount),
        },
      }),
    };
  }

  try {
    const validation = await validateAddressFreeform(rawAddress.trim());

    await logCheckoutEvent({
      callSid: ctx.callSid,
      userId,
      eventType: 'address_attempted',
      severity: validation.isValid ? 'info' : 'warn',
      details: {
        attempt_number: retryCount + 1,
        entry_mode: 'freeform',
        raw_input: { transcript: rawAddress.trim() },
        validation: {
          isValid: validation.isValid,
          action: validation.action,
          formattedAddress: validation.formattedAddress,
          address1: validation.address1,
          address2: validation.address2,
          city: validation.city,
          state: validation.state,
          zipCode: validation.zipCode,
          validationGranularity: validation.validationGranularity,
          addressComplete: validation.addressComplete,
          hasSpellCorrections: validation.hasSpellCorrections,
          hasReplacements: validation.hasReplacements,
          hasInferences: validation.hasInferences,
          hasUnresolvedTokens: validation.hasUnresolvedTokens,
          dpvConfirmation: validation.dpvConfirmation,
        },
        google_raw: validation.rawResponse ?? null,
        error: null,
      },
    });

    if (validation.isValid) {
      const fullAddress = validation.formattedAddress || `${validation.address1}, ${validation.address2 ? validation.address2 + ', ' : ''}${validation.city}, ${validation.state} ${validation.zipCode}`;
      const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

      return {
        type: 'actions',
        response: buildGather({
          prompt: `Your address is: ${fullAddress}. Press 1 to confirm, or press 2 to re-enter.`,
          actionPath: '/api/ivr/voice/gather',
          numDigits: 1,
          timeout: 10,
          sessionData: {
            call_sid: ctx.callSid, user_id: userId,
            node_key: nextNode?.node_key || 'checkout_address_confirm',
            addr_line1: validation.address1,
            addr_line2: validation.address2 || '',
            addr_city: validation.city,
            addr_state: validation.state,
            addr_zip: validation.zipCode,
            addr_validated: '1',
          },
        }),
      };
    }

    const nextRetry = retryCount + 1;

    if (nextRetry >= MAX_FREEFORM_RETRIES) {
      const fallbackNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'fallback');
      return {
        type: 'actions',
        response: buildCollect({
          type: 'recording',
          id: 'addr_line1',
          prompt: 'We are having trouble verifying your address. Let\'s try a different way. Please say your street address after the beep, then press pound.',
          confirm: true,
          confirmMethod: 'transcribe',
          transcribe: true,
          retry: 3,
          maxDuration: 15,
          actionPath: '/api/ivr/voice/gather',
          sessionData: {
            call_sid: ctx.callSid, user_id: userId,
            node_key: fallbackNode?.node_key || 'checkout_address_line1',
          },
        }),
      };
    }

    return {
      type: 'actions',
      response: buildCollect({
        type: 'recording',
        id: 'addr_full',
        prompt: 'Sorry, we could not verify that as a valid address. Please say your complete address again, including street, city, state, and zip code.',
        confirm: false,
        transcribe: true,
        retry: 3,
        maxDuration: 25,
        actionPath: '/api/ivr/voice/gather',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: ctx.node.node_key,
          addr_full_retries: String(nextRetry),
        },
      }),
    };
  } catch (error) {
    console.error('Freeform address validation error:', error);
    const nextRetry = retryCount + 1;

    await logCheckoutEvent({
      callSid: ctx.callSid,
      userId,
      eventType: 'address_attempted',
      severity: 'error',
      details: {
        attempt_number: retryCount + 1,
        entry_mode: 'freeform',
        raw_input: { transcript: rawAddress.trim() },
        validation: null,
        google_raw: null,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    if (nextRetry >= MAX_FREEFORM_RETRIES) {
      const fallbackNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'fallback');
      return {
        type: 'actions',
        response: buildCollect({
          type: 'recording',
          id: 'addr_line1',
          prompt: 'We are having trouble verifying your address. Let\'s try a different way. Please say your street address after the beep, then press pound.',
          confirm: true,
          confirmMethod: 'transcribe',
          transcribe: true,
          retry: 3,
          maxDuration: 15,
          actionPath: '/api/ivr/voice/gather',
          sessionData: {
            call_sid: ctx.callSid, user_id: userId,
            node_key: fallbackNode?.node_key || 'checkout_address_line1',
          },
        }),
      };
    }

    return {
      type: 'actions',
      response: buildCollect({
        type: 'recording',
        id: 'addr_full',
        prompt: 'Sorry, we could not verify that as a valid address. Please say your complete address again, including street, city, state, and zip code.',
        confirm: false,
        transcribe: true,
        retry: 3,
        maxDuration: 25,
        actionPath: '/api/ivr/voice/gather',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: ctx.node.node_key,
          addr_full_retries: String(nextRetry),
        },
      }),
    };
  }
});

registerHandler('address_line1', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const fieldTranscript = ctx.req.body.field_transcript;
  const fieldValue = ctx.req.body.field_value;
  const variables = ctx.req.body.variables || {};
  const line1 = fieldTranscript || fieldValue || variables.addr_line1_text || variables.addr_line1 || ctx.req.body.digits || '';

  if (!line1.trim()) {
    return {
      type: 'actions',
      response: buildCollect({
        type: 'recording',
        id: 'addr_line1',
        prompt: 'Please say your street address after the beep, then press pound.',
        confirm: true,
        confirmMethod: 'transcribe',
        transcribe: true,
        retry: 3,
        maxDuration: 15,
        actionPath: '/api/ivr/voice/gather',
        sessionData: { call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key },
      }),
    };
  }

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

  return {
    type: 'actions',
    response: buildCollect({
      type: 'recording',
      id: 'addr_line2',
      prompt: nextNode?.prompt_text || 'Say your apartment or unit number after the beep, or press pound to skip.',
      confirm: false,
      transcribe: true,
      retry: 3,
      maxDuration: 10,
      actionPath: '/api/ivr/voice/gather',
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: nextNode?.node_key || 'checkout_address_line2',
        addr_line1: line1.trim(),
      },
    }),
  };
});

registerHandler('address_line2', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const line1 = ctx.sessionData.addr_line1;
  const fieldTranscript = ctx.req.body.field_transcript;
  const fieldValue = ctx.req.body.field_value;
  const variables = ctx.req.body.variables || {};
  const line2 = fieldTranscript || fieldValue || variables.addr_line2_text || variables.addr_line2 || ctx.req.body.digits || '';

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

  return {
    type: 'actions',
    response: buildCollect({
      type: 'recording',
      id: 'addr_city',
      prompt: nextNode?.prompt_text || 'Please say your city name after the beep, then press pound.',
      confirm: true,
      confirmMethod: 'transcribe',
      transcribe: true,
      retry: 3,
      maxDuration: 10,
      actionPath: '/api/ivr/voice/gather',
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: nextNode?.node_key || 'checkout_address_city',
        addr_line1: line1, addr_line2: line2.trim(),
      },
    }),
  };
});

registerHandler('address_city', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const line1 = ctx.sessionData.addr_line1;
  const line2 = ctx.sessionData.addr_line2;
  const fieldTranscript = ctx.req.body.field_transcript;
  const fieldValue = ctx.req.body.field_value;
  const variables = ctx.req.body.variables || {};
  const city = fieldTranscript || fieldValue || variables.addr_city_text || variables.addr_city || ctx.req.body.digits || '';

  if (!city.trim()) {
    return {
      type: 'actions',
      response: buildCollect({
        type: 'recording',
        id: 'addr_city',
        prompt: 'Please say your city name after the beep, then press pound.',
        confirm: true,
        confirmMethod: 'transcribe',
        transcribe: true,
        retry: 3,
        maxDuration: 10,
        actionPath: '/api/ivr/voice/gather',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key,
          addr_line1: line1, addr_line2: line2,
        },
      }),
    };
  }

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

  return {
    type: 'actions',
    response: buildCollect({
      type: 'recording',
      id: 'addr_state',
      prompt: nextNode?.prompt_text || 'Please say your state name or state code after the beep, then press pound.',
      confirm: true,
      confirmMethod: 'transcribe',
      transcribe: true,
      retry: 3,
      maxDuration: 10,
      actionPath: '/api/ivr/voice/gather',
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: nextNode?.node_key || 'checkout_address_state',
        addr_line1: line1, addr_line2: line2, addr_city: city.trim(),
      },
    }),
  };
});

registerHandler('address_state', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const line1 = ctx.sessionData.addr_line1;
  const line2 = ctx.sessionData.addr_line2;
  const city = ctx.sessionData.addr_city;
  const fieldTranscript = ctx.req.body.field_transcript;
  const fieldValue = ctx.req.body.field_value;
  const variables = ctx.req.body.variables || {};
  const rawState = fieldTranscript || fieldValue || variables.addr_state_text || variables.addr_state || ctx.req.body.digits || '';
  const state = parseStateInput(rawState);

  if (!state) {
    return {
      type: 'actions',
      response: buildCollect({
        type: 'recording',
        id: 'addr_state',
        prompt: 'Please say your state name or state code after the beep, then press pound.',
        confirm: true,
        confirmMethod: 'transcribe',
        transcribe: true,
        retry: 3,
        maxDuration: 10,
        actionPath: '/api/ivr/voice/gather',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key,
          addr_line1: line1, addr_line2: line2, addr_city: city,
        },
      }),
    };
  }

  const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

  return {
    type: 'actions',
    response: buildGather({
      prompt: nextNode?.prompt_text || 'Enter your 5-digit ZIP code.',
      actionPath: '/api/ivr/voice/gather',
      numDigits: 5,
      timeout: 10,
      finishOnKey: '',
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: nextNode?.node_key || 'checkout_address_zip',
        addr_line1: line1, addr_line2: line2, addr_city: city, addr_state: state,
      },
    }),
  };
});

registerHandler('address_zip', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const line1 = ctx.sessionData.addr_line1;
  const line2 = ctx.sessionData.addr_line2;
  const city = ctx.sessionData.addr_city;
  const state = ctx.sessionData.addr_state;
  const zip = ctx.req.body.digits || '';

  if (zip.length !== 5) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter a valid 5-digit ZIP code.',
        actionPath: '/api/ivr/voice/gather',
        numDigits: 5,
        timeout: 10,
        finishOnKey: '',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId, node_key: ctx.node.node_key,
          addr_line1: line1, addr_line2: line2, addr_city: city, addr_state: state,
        },
      }),
    };
  }

  try {
    const validation = await validateAddress({ address1: line1, address2: line2 || undefined, city, state, zipCode: zip });

    await logCheckoutEvent({
      callSid: ctx.callSid,
      userId,
      eventType: 'address_attempted',
      severity: validation.isValid ? 'info' : 'warn',
      details: {
        attempt_number: 1,
        entry_mode: 'structured',
        raw_input: {
          structured: { address1: line1, address2: line2 || '', city, state, zip },
        },
        validation: {
          isValid: validation.isValid,
          action: validation.action,
          formattedAddress: validation.formattedAddress,
          address1: validation.correctedAddress?.address1 || line1,
          address2: line2 || '',
          city: validation.correctedAddress?.city || city,
          state: validation.correctedAddress?.state || state,
          zipCode: validation.correctedAddress?.zipCode || zip,
          validationGranularity: validation.validationGranularity,
          addressComplete: validation.addressComplete,
          hasSpellCorrections: validation.hasSpellCorrections,
          hasReplacements: validation.hasReplacements,
          hasInferences: validation.hasInferences,
          hasUnresolvedTokens: validation.hasUnresolvedTokens,
          dpvConfirmation: validation.dpvConfirmation,
        },
        google_raw: validation.rawResponse ?? null,
        error: null,
      },
    });

    const fullAddress = validation.formattedAddress || `${line1}, ${line2 ? line2 + ', ' : ''}${city}, ${state} ${zip}`;
    const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

    return {
      type: 'actions',
      response: buildGather({
        prompt: `Your address is: ${fullAddress}. ${validation.isValid ? '' : 'Note: we detected some issues with this address. '}Press 1 to confirm, or press 2 to re-enter.`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 10,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: nextNode?.node_key || 'checkout_address_confirm',
          addr_line1: validation.correctedAddress?.address1 || line1, addr_line2: line2 || '',
          addr_city: validation.correctedAddress?.city || city,
          addr_state: validation.correctedAddress?.state || state,
          addr_zip: validation.correctedAddress?.zipCode || zip,
          addr_validated: validation.isValid ? '1' : '0',
        },
      }),
    };
  } catch (error) {
    console.error('Address validation error:', error);

    await logCheckoutEvent({
      callSid: ctx.callSid,
      userId,
      eventType: 'address_attempted',
      severity: 'error',
      details: {
        attempt_number: 1,
        entry_mode: 'structured',
        raw_input: {
          structured: { address1: line1, address2: line2 || '', city, state, zip },
        },
        validation: null,
        google_raw: null,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    const fullAddress = `${line1}, ${line2 ? line2 + ', ' : ''}${city}, ${state} ${zip}`;
    const nextNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, null);

    return {
      type: 'actions',
      response: buildGather({
        prompt: `Your address is: ${fullAddress}. Press 1 to confirm, or press 2 to re-enter.`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 10,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: nextNode?.node_key || 'checkout_address_confirm',
          addr_line1: line1, addr_line2: line2 || '', addr_city: city, addr_state: state, addr_zip: zip, addr_validated: '0',
        },
      }),
    };
  }
});

registerHandler('address_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;
  const addressId = ctx.sessionData.address_id;
  const useSaved = ctx.sessionData.use_saved;

  if (useSaved === 'pending') {
    if (digits === '1' && addressId) {
      await logCheckoutEvent({
        callSid: ctx.callSid,
        userId,
        eventType: 'address_selected',
        details: { address_id: addressId, source: 'saved' },
      });
      return {
        type: 'actions',
        response: buildSay(
          'Address confirmed.',
          '/api/ivr/voice/gather',
          { call_sid: ctx.callSid, user_id: userId, node_key: 'checkout_payment_choice', address_id: addressId }
        ),
      };
    }
    return {
      type: 'actions',
      response: buildCollect({
        type: 'recording',
        id: 'addr_full',
        prompt: 'Please say your complete address, including street, apartment or unit number if any, city, state, and zip code.',
        confirm: false,
        transcribe: true,
        retry: 3,
        maxDuration: 25,
        actionPath: '/api/ivr/voice/gather',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_address_full',
          addr_full_retries: '0',
        },
      }),
    };
  }

  if (digits === '2') {
    const retryNode = await ivrRuntime.resolveNextNode(ctx.flowVersionId, ctx.node.id, 'retry');
    return {
      type: 'actions',
      response: buildCollect({
        type: 'recording',
        id: 'addr_full',
        prompt: 'Please say your complete address, including street, apartment or unit number if any, city, state, and zip code.',
        confirm: false,
        transcribe: true,
        retry: 3,
        maxDuration: 25,
        actionPath: '/api/ivr/voice/gather',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: retryNode?.node_key || 'checkout_address_full',
          addr_full_retries: '0',
        },
      }),
    };
  }

  const line1 = ctx.sessionData.addr_line1;
  const line2 = ctx.sessionData.addr_line2;
  const city = ctx.sessionData.addr_city;
  const state = ctx.sessionData.addr_state;
  const zip = ctx.sessionData.addr_zip;
  const validated = ctx.sessionData.addr_validated === '1';

  try {
    const { data: addr } = await supabaseAdmin
      .from('addresses')
      .insert({
        user_id: userId, address1: line1, address2: line2 || null,
        city, state, zip_code: zip, country: 'US', is_default: true, is_validated: validated,
      })
      .select()
      .single();

    if (!addr) throw new Error('Failed to save address');

    await supabaseAdmin.from('addresses').update({ is_default: false }).eq('user_id', userId).neq('id', addr.id);

    await logCheckoutEvent({
      callSid: ctx.callSid,
      userId,
      eventType: 'address_selected',
      details: {
        address_id: addr.id,
        source: 'new',
        validated: validated,
        city: addr.city,
        state: addr.state,
        zip: addr.zip_code,
      },
    });

    return {
      type: 'actions',
      response: buildSay(
        'Address saved.',
        '/api/ivr/voice/gather',
        { call_sid: ctx.callSid, user_id: userId, node_key: 'checkout_payment_choice', address_id: addr.id }
      ),
    };
  } catch (error) {
    console.error('Address save error:', error);
    return { type: 'actions', response: buildHangup('Error saving your address. Please try again later.') };
  }
});

registerHandler('payment_choice', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;

  const { data: methods } = await supabaseAdmin
    .from('payment_methods')
    .select('*')
    .eq('user_id', userId)
    .eq('is_verified', true)
    .order('is_default', { ascending: false });

  if (methods && methods.length > 0) {
    const maxCards = Math.min(methods.length, 8);
    const cardLines = methods.slice(0, maxCards).map((m, i) =>
      `Press ${i + 1} for ${m.card_brand || 'card'} ending in ${m.card_last4}.`
    );
    cardLines.push(`Press 9 to enter a new card.`);

    const cardMap = JSON.stringify(
      Object.fromEntries(methods.slice(0, maxCards).map((m, i) => [String(i + 1), m.id]))
    );

    return {
      type: 'actions',
      response: buildGather({
        prompt: `Select a payment method. ${cardLines.join(' ')}`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 10,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_payment_select',
          address_id: addressId, card_map: cardMap,
        },
      }),
    };
  }

  return {
    type: 'actions',
    response: buildGather({
      prompt: 'No saved cards found. Let\'s add a new card. Please enter your credit card number followed by the pound key.',
      actionPath: '/api/ivr/voice/gather',
      timeout: 15,
      finishOnKey: '#',
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: 'checkout_card_number',
        address_id: addressId,
      },
    }),
  };
});

registerHandler('payment_select', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const digits = ctx.req.body.digits;
  const cardMapJson = ctx.sessionData.card_map || '{}';

  if (digits === '9') {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter your credit card number followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 15,
        finishOnKey: '#',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_card_number',
          address_id: addressId,
        },
      }),
    };
  }

  let cardMap: Record<string, string>;
  try {
    cardMap = JSON.parse(cardMapJson);
  } catch {
    cardMap = {};
  }

  const paymentMethodId = cardMap[digits];
  if (!paymentMethodId) {
    return {
      type: 'actions',
      response: buildSay(
        'Invalid selection. Returning to payment options.',
        '/api/ivr/voice/gather',
        { call_sid: ctx.callSid, user_id: userId, node_key: 'checkout_payment_choice', address_id: addressId }
      ),
    };
  }

  await logCheckoutEvent({
    callSid: ctx.callSid,
    userId,
    eventType: 'payment_method_selected',
    details: { payment_method_id: paymentMethodId, source: 'saved' },
  });

  return {
    type: 'actions',
    response: buildSay(
      'Card selected.',
      '/api/ivr/voice/gather',
      { call_sid: ctx.callSid, user_id: userId, node_key: 'checkout_summary', address_id: addressId, payment_method_id: paymentMethodId }
    ),
  };
});

registerHandler('card_number', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const digits = ctx.req.body.digits || '';

  const cleaned = digits.replace(/[^0-9]/g, '');
  if (cleaned.length < 13 || cleaned.length > 19) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Invalid card number. Please enter your credit card number followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 15,
        finishOnKey: '#',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_card_number',
          address_id: addressId,
        },
      }),
    };
  }

  // Store the raw PAN server-side (never in the action-URL query string).
  await ctx.setSecureData({ cc_num: cleaned });

  return {
    type: 'actions',
    response: buildGather({
      prompt: 'Enter the expiration date as 4 digits. Month, then year. For example, 0 3 2 6 for March 2026.',
      actionPath: '/api/ivr/voice/gather',
      numDigits: 4,
      timeout: 10,
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: 'checkout_card_exp',
        address_id: addressId,
      },
    }),
  };
});

registerHandler('card_exp', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const digits = ctx.req.body.digits || '';

  const cleaned = digits.replace(/[^0-9]/g, '');
  if (cleaned.length !== 4) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Invalid expiration date. Please enter 4 digits, month then year.',
        actionPath: '/api/ivr/voice/gather',
        numDigits: 4,
        timeout: 10,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_card_exp',
          address_id: addressId,
        },
      }),
    };
  }

  const month = parseInt(cleaned.substring(0, 2), 10);
  if (month < 1 || month > 12) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Invalid month. Please enter 4 digits, month then year. For example, 0 3 2 6.',
        actionPath: '/api/ivr/voice/gather',
        numDigits: 4,
        timeout: 10,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_card_exp',
          address_id: addressId,
        },
      }),
    };
  }

  await ctx.setSecureData({ cc_exp: cleaned });

  return {
    type: 'actions',
    response: buildGather({
      prompt: 'Enter the 3 or 4 digit security code from your card, followed by the pound key.',
      actionPath: '/api/ivr/voice/gather',
      timeout: 10,
      finishOnKey: '#',
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: 'checkout_card_cvv',
        address_id: addressId,
      },
    }),
  };
});

registerHandler('card_cvv', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const digits = ctx.req.body.digits || '';

  const cleaned = digits.replace(/[^0-9]/g, '');
  if (cleaned.length < 3 || cleaned.length > 4) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Invalid security code. Please enter the 3 or 4 digit code followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_card_cvv',
          address_id: addressId,
        },
      }),
    };
  }

  await ctx.setSecureData({ cc_cvv: cleaned });

  return {
    type: 'actions',
    response: buildGather({
      prompt: 'Enter your 5 digit billing ZIP code.',
      actionPath: '/api/ivr/voice/gather',
      numDigits: 5,
      timeout: 10,
      finishOnKey: '',
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: 'checkout_card_zip',
        address_id: addressId,
      },
    }),
  };
});

registerHandler('card_zip', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const ccNum = ctx.secureData.cc_num || '';
  const ccExp = ctx.secureData.cc_exp || '';
  const digits = ctx.req.body.digits || '';

  if (digits.length !== 5) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter a valid 5 digit billing ZIP code.',
        actionPath: '/api/ivr/voice/gather',
        numDigits: 5,
        timeout: 10,
        finishOnKey: '',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_card_zip',
          address_id: addressId,
        },
      }),
    };
  }

  await ctx.setSecureData({ cc_zip: digits });

  const last4 = ccNum.slice(-4);
  const expMonth = ccExp.substring(0, 2);
  const expYear = ccExp.substring(2, 4);

  return {
    type: 'actions',
    response: buildGather({
      prompt: `You entered a card ending in ${last4.split('').join(' ')}, expiring ${expMonth} ${expYear}. Press 1 to confirm, or press 2 to re-enter your card.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 10,
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: 'checkout_card_confirm',
        address_id: addressId,
      },
    }),
  };
});

registerHandler('card_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const ccNum = ctx.secureData.cc_num || '';
  const ccExp = ctx.secureData.cc_exp || '';
  const ccCvv = ctx.secureData.cc_cvv || '';
  const ccZip = ctx.secureData.cc_zip || '';
  const digits = ctx.req.body.digits;

  if (digits === '2') {
    // User wants to re-enter; drop the half-entered card data immediately.
    await ctx.clearSecureData();
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter your credit card number followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 15,
        finishOnKey: '#',
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_card_number',
          address_id: addressId,
        },
      }),
    };
  }

  try {
    const solaResult = await solaTokenize(ccNum, ccExp, ccCvv, ccZip);

    // Raw card data has now been handed to the tokenizer; we never need it
    // again, so wipe it from the session regardless of the outcome.
    await ctx.clearSecureData();

    if (solaResult.xResult !== 'A') {
      return {
        type: 'actions',
        response: buildGather({
          prompt: `Your card could not be verified. ${solaResult.xError || 'Please try again.'}. Press 1 to re-enter your card, or press 2 to cancel.`,
          actionPath: '/api/ivr/voice/gather',
          numDigits: 1,
          timeout: 10,
          sessionData: {
            call_sid: ctx.callSid, user_id: userId,
            node_key: 'checkout_card_number',
            address_id: addressId,
          },
        }),
      };
    }

    const last4 = ccNum.slice(-4);
    const expMonth = parseInt(ccExp.substring(0, 2), 10);
    const expYear = parseInt(ccExp.substring(2, 4), 10) + 2000;

    // Tokenization only vaults the card -- it does NOT confirm the card can be
    // charged. Persist it as UNVERIFIED and non-default for now. It is promoted
    // to verified (and made default) only after a successful auth hold in
    // `checkout_pay`, and deleted there if the auth declines. This prevents a
    // card that never completed a payment from sticking around on the account.
    const { data: savedCard } = await supabaseAdmin
      .from('payment_methods')
      .insert({
        user_id: userId,
        sola_token: solaResult.xToken,
        card_last4: last4,
        card_brand: solaResult.xCardType || null,
        card_exp_month: expMonth,
        card_exp_year: expYear,
        is_default: false,
        is_verified: false,
      })
      .select()
      .single();

    if (!savedCard) throw new Error('Failed to save card');

    await logCheckoutEvent({
      callSid: ctx.callSid,
      userId,
      eventType: 'payment_method_selected',
      details: {
        payment_method_id: savedCard.id,
        source: 'new',
        verified: false,
        card_brand: savedCard.card_brand,
        card_last4: savedCard.card_last4,
      },
    });

    return {
      type: 'actions',
      response: buildSay(
        `Your ${solaResult.xCardType || 'card'} ending in ${last4} is ready.`,
        '/api/ivr/voice/gather',
        {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_summary',
          address_id: addressId,
          payment_method_id: savedCard.id,
        }
      ),
    };
  } catch (error) {
    console.error('Card tokenization error:', error);
    await ctx.clearSecureData();
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'There was an error processing your card. Press 1 to try again, or press 2 to cancel.',
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 10,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_card_number',
          address_id: addressId,
        },
      }),
    };
  }
});

registerHandler('order_summary', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;

  const loaded = await loadActiveCartWithPricing(userId);
  if (!loaded) {
    return { type: 'actions', response: buildSay('Your cart is empty.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }) };
  }

  if (getUnpricedCartLineIds(loaded.pricedLines).length > 0) {
    return unpricedCartResponse(ctx, userId);
  }

  const subtotal = sumPricedLines(loaded.pricedLines);

  const savingsCents = loaded.pricedLines.reduce(
    (sum, line) =>
      sum + getCartItemSavingsCents(line.localPriceCents, line.unitPriceCents ?? 0, line.quantity),
    0,
  );
  const savingsLine = savingsCents > 0
    ? ` A total savings of ${formatCurrency(savingsCents)} from the average local retail store pricing.`
    : '';

  return {
    type: 'actions',
    response: buildGather({
      prompt: `Your order total is ${formatCurrency(subtotal)}.${savingsLine} Shipping and tax will be calculated at final confirmation. Press 1 to place the order, or press 2 to go back to your cart.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 15,
      sessionData: {
        call_sid: ctx.callSid, user_id: userId, node_key: 'checkout_confirm',
        address_id: addressId, payment_method_id: paymentMethodId,
      },
    }),
  };
});

/**
 * User pressed 1 to place order. Tell them to hold while we verify with Amazon.
 */
// ===========================================================================
// Checkout revalidation poll loop
//
// Re-checking each cart item against Rainforest can take several seconds per
// item. Doing it all inside a single TelTech webhook risks exceeding the
// provider's api_timeout (configured to 40s in the TelTech dashboard; Vercel's
// function max duration is 60s) and dropping the call (an unbounded version of
// this broke live payments on 2026-06-22). Instead we run the revalidation as a bounded
// poll loop: `order_confirm` enqueues the work into the call session, then a
// `checkout_verify_wait` node drains a parallel batch per webhook and redirects
// back to itself ("please hold") until the queue is empty, finally routing to
// `checkout_final_confirm`. Each webhook stays well under the timeout, so the
// flow scales to large carts. A poll cap guarantees we never exceed TelTech's
// per-call webhook limit; any items left unverified fall back to cached pricing
// and are flagged stale (reliability-first).
// ===========================================================================

const REVALIDATION_STATE_KEY = 'checkout_revalidation';

/** Compact, session-serializable accumulator for the checkout revalidation job. */
interface RevalidationJobState {
  status: 'pending' | 'done';
  /** cart_item ids still to verify. */
  queue: string[];
  totalItems: number;
  pollCount: number;
  priceChanges: CheckoutRevalidationItemChange[];
  unavailable: CheckoutRevalidationUnavailable[];
  stale: CheckoutRevalidationStale[];
  /** Compact remaining items (id/product/qty/price) carried to final_confirm. */
  remaining: Array<{
    id: string;
    product_id: string;
    quantity: number;
    unit_price_cents: number;
    voicex_id: string | null;
  }>;
  results: ProductSyncResult[];
  context: {
    userId: string | null;
    callerPhone: string | null;
    isWhitelisted: boolean;
    customMarkupPercent: number | null;
  };
}

async function readRevalidationJob(callSid: string): Promise<RevalidationJobState | null> {
  const session = await ivrRuntime.getSession(callSid);
  const stateData = (session?.state_data || {}) as Record<string, unknown>;
  const job = stateData[REVALIDATION_STATE_KEY];
  return job && typeof job === 'object' ? (job as RevalidationJobState) : null;
}

async function writeRevalidationJob(callSid: string, job: RevalidationJobState): Promise<void> {
  const session = await ivrRuntime.getSession(callSid);
  const stateData = (session?.state_data || {}) as Record<string, unknown>;
  await ivrRuntime.updateSession(callSid, {
    state_data: { ...stateData, [REVALIDATION_STATE_KEY]: job },
  });
}

async function clearRevalidationJob(callSid: string): Promise<void> {
  const session = await ivrRuntime.getSession(callSid);
  const stateData = (session?.state_data || {}) as Record<string, unknown>;
  if (!(REVALIDATION_STATE_KEY in stateData)) return;
  const next = { ...stateData };
  delete next[REVALIDATION_STATE_KEY];
  await ivrRuntime.updateSession(callSid, { state_data: next });
}

/**
 * Advance the revalidation queue after one parallel slice. Every id in `sliceIds`
 * is dropped from the head except ids in `stillExistingMissing` — cart rows that
 * still exist but were absent from the batch fetch (retry next wave). Ids missing
 * from both the fetch and the follow-up existence check are treated as concurrent
 * deletes and removed. Never advance by `items.length`: that leaves deleted ids
 * stuck when the whole slice vanishes, or fails to dequeue processed ids when a
 * middle id was deleted.
 */
function advanceRevalidationQueue(
  queue: string[],
  sliceIds: string[],
  stillExistingMissing: string[],
): string[] {
  return [...stillExistingMissing, ...queue.slice(sliceIds.length)];
}

function mergeBatchIntoJob(
  job: RevalidationJobState,
  batch: { results: ProductSyncResult[]; priceChanges: CheckoutRevalidationItemChange[]; unavailable: CheckoutRevalidationUnavailable[]; stale: CheckoutRevalidationStale[]; remainingItems: CheckoutCartItem[] },
): void {
  job.results.push(...batch.results);
  job.priceChanges.push(...batch.priceChanges);
  job.unavailable.push(...batch.unavailable);
  job.stale.push(...batch.stale);
  for (const it of batch.remainingItems) {
    job.remaining.push({
      id: it.id,
      product_id: it.product_id,
      quantity: it.quantity,
      unit_price_cents: it.unit_price_cents,
      voicex_id: it.voicex_id,
    });
  }
}

registerHandler('order_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;

  if (digits === '2') {
    await clearRevalidationJob(ctx.callSid);
    return {
      type: 'actions',
      response: buildSay('Order cancelled. Returning to cart.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'cart_menu' }),
    };
  }

  try {
    const { data: address } = await supabaseAdmin.from('addresses').select('*').eq('id', addressId).single();
    const { data: cart } = await supabaseAdmin.from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

    if (!address || !cart) throw new Error('Missing checkout data');

    const { data: cartItems } = await supabaseAdmin.from('cart_items').select('*, catalog_products(*)').eq('cart_id', cart.id);
    if (!cartItems || cartItems.length === 0) throw new Error('Empty cart');

    const fulfillmentProvider = await getActiveFulfillmentProvider();
    const rainforestSettings = await getRainforestSyncSettings();

    // Only the manual path revalidates against Rainforest. When revalidation is
    // off (or on the Rye path), skip the poll loop and go straight to
    // final_confirm exactly as before.
    if (fulfillmentProvider !== 'manual' || !rainforestSettings.checkoutRevalidationEnabled) {
      await clearRevalidationJob(ctx.callSid);
      return {
        type: 'actions',
        response: buildSay(
          'Please hold while we verify your order.',
          '/api/ivr/voice/gather',
          {
            call_sid: ctx.callSid, user_id: userId,
            node_key: 'checkout_final_confirm',
            address_id: addressId, payment_method_id: paymentMethodId,
          }
        ),
      };
    }

    const session = await ivrRuntime.getSession(ctx.callSid);
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('is_whitelisted, custom_markup_percent')
      .eq('id', userId)
      .maybeSingle();

    const job: RevalidationJobState = {
      status: 'pending',
      queue: cartItems.map((ci) => ci.id),
      totalItems: cartItems.length,
      pollCount: 0,
      priceChanges: [],
      unavailable: [],
      stale: [],
      remaining: [],
      results: [],
      context: {
        userId,
        callerPhone: session?.phone_number || null,
        isWhitelisted: user?.is_whitelisted || false,
        customMarkupPercent: user?.custom_markup_percent ?? null,
      },
    };
    await writeRevalidationJob(ctx.callSid, job);

    return {
      type: 'actions',
      response: buildSay(
        'Please hold while we verify your order.',
        '/api/ivr/voice/gather',
        {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_verify_wait',
          address_id: addressId, payment_method_id: paymentMethodId,
        }
      ),
    };
  } catch (error) {
    console.error('Order confirmation error:', error);
    return { type: 'actions', response: buildHangup('We had trouble processing your order. Please try again later.') };
  }
});

/**
 * Poll node: drains one parallel batch of the revalidation queue per webhook,
 * then either redirects back to itself ("still verifying") or, once the queue is
 * empty (or the poll budget is exhausted), records the sync run and routes to
 * checkout_final_confirm. Each invocation returns fast so TelTech never times
 * out, regardless of cart size.
 */
registerHandler('verify_wait', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;

  const forwardData = {
    call_sid: ctx.callSid, user_id: userId,
    address_id: addressId, payment_method_id: paymentMethodId,
  };

  const finalize = async (job: RevalidationJobState | null) => {
    // Persist a sync run (when anything changed or is stale), log events, build
    // the spoken change announcement, then route to the totals prompt.
    let runId: string | null = null;
    let announcement = '';
    if (job) {
      const changedCount = job.priceChanges.length + job.unavailable.length;
      runId = await recordCheckoutSyncRun(job.context, job.totalItems, job.results, changedCount, job.stale.length);

      if (changedCount > 0) {
        const parts: string[] = [];
        if (job.unavailable.length > 0) {
          const names = job.unavailable.map((u) => u.productName).join(', ');
          parts.push(
            `We are sorry to inform you that the following ${job.unavailable.length === 1 ? 'product is' : 'products are'} no longer available and ${job.unavailable.length === 1 ? 'has' : 'have'} been removed from your order: ${names}.`,
          );
        }
        if (job.priceChanges.length > 0) {
          const changeParts = job.priceChanges.map((c) => {
            const diff = Math.abs(c.newUnitPriceCents - c.oldUnitPriceCents);
            return `${c.productName} ${c.direction === 'up' ? 'went up' : 'went down'} by ${formatCurrency(diff)} to ${formatCurrency(c.newUnitPriceCents)}`;
          });
          parts.push(`The price of the following changed: ${changeParts.join('; ')}.`);
        }
        announcement = `${parts.join(' ')} `;

        await logCheckoutEvent({
          callSid: ctx.callSid,
          userId,
          eventType: 'checkout_revalidation_changes',
          details: {
            unavailable: job.unavailable.map((u) => u.productName),
            price_changes: job.priceChanges.map((c) => ({
              product: c.productName,
              old_cents: c.oldUnitPriceCents,
              new_cents: c.newUnitPriceCents,
              direction: c.direction,
            })),
            stale: job.stale.map((s) => s.productName),
            sync_run_id: runId,
          },
        });
      }
      if (job.stale.length > 0) {
        await logCheckoutEvent({
          callSid: ctx.callSid,
          userId,
          eventType: 'checkout_revalidation_stale',
          severity: 'warn',
          details: {
            stale: job.stale.map((s) => ({ product: s.productName, reason: s.reason })),
            sync_run_id: runId,
          },
        });
      }

      // If the whole cart became unavailable, there is nothing to pay for.
      if (job.remaining.length === 0) {
        await clearRevalidationJob(ctx.callSid);
        return {
          type: 'actions' as const,
          response: buildSay(
            `${announcement}Your cart no longer has any available items. Returning to the main menu.`,
            '/api/ivr/voice/gather',
            { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' },
          ),
        };
      }
    }
    await clearRevalidationJob(ctx.callSid);
    return {
      type: 'actions' as const,
      response: buildSay('', '/api/ivr/voice/gather', {
        ...forwardData,
        node_key: 'checkout_final_confirm',
        ...(runId ? { revalidation_run_id: runId } : {}),
        ...(announcement ? { revalidation_announcement: announcement } : {}),
      }),
    };
  };

  const job = await readRevalidationJob(ctx.callSid);
  // No job (revalidation disabled or session lost) — just proceed.
  if (!job) {
    return finalize(null);
  }

  job.pollCount += 1;

  const concurrency = config.priceSync.checkout.concurrency;
  const budgetMs = config.priceSync.checkout.pollTimeBudgetMs;
  const startedAt = Date.now();

  // Drain waves of `concurrency` items until the queue empties or the per-poll
  // time budget is (nearly) exhausted. At least one wave runs per poll.
  while (job.queue.length > 0) {
    const sliceIds = job.queue.slice(0, concurrency);
    const { data: rows } = await supabaseAdmin
      .from('cart_items')
      .select('*, catalog_products(*)')
      .in('id', sliceIds);

    const items = (rows || []) as unknown as CheckoutCartItem[];
    const returnedIds = new Set(items.map((item) => item.id));
    const missingFromFetch = sliceIds.filter((id) => !returnedIds.has(id));

    // A batch fetch can return fewer rows than requested. Only treat a missing id
    // as gone when it is no longer in the cart; otherwise keep it queued so it is
    // not dropped unprocessed.
    let stillExistingMissing: string[] = [];
    if (missingFromFetch.length > 0) {
      const { data: existingRows } = await supabaseAdmin
        .from('cart_items')
        .select('id')
        .in('id', missingFromFetch);
      const existingIds = new Set((existingRows ?? []).map((row) => row.id));
      stillExistingMissing = missingFromFetch.filter((id) => existingIds.has(id));
    }

    if (items.length > 0) {
      const batch = await revalidateCartBatch(items, job.context, concurrency);
      mergeBatchIntoJob(job, batch);
    }
    job.queue = advanceRevalidationQueue(job.queue, sliceIds, stillExistingMissing);

    if (job.queue.length === 0) break;
    // Stop if another wave would likely blow the budget; the next poll continues.
    if (Date.now() - startedAt >= budgetMs) break;
  }

  // Queue drained — finalize and go to the totals prompt.
  if (job.queue.length === 0) {
    job.status = 'done';
    await writeRevalidationJob(ctx.callSid, job);
    return finalize(job);
  }

  // Safety valve: if we've hit the poll cap and items remain, charge them at the
  // cached price (flagged stale) instead of looping further or dropping the call.
  if (job.pollCount >= config.priceSync.checkout.maxPolls) {
    const { data: rows } = await supabaseAdmin
      .from('cart_items')
      .select('*, catalog_products(*)')
      .in('id', job.queue);
    const leftover = (rows || []) as unknown as CheckoutCartItem[];
    const staleBatch = markItemsStale(leftover, 'Verification budget exhausted; cached price used');
    mergeBatchIntoJob(job, staleBatch);
    job.queue = [];
    job.status = 'done';
    await writeRevalidationJob(ctx.callSid, job);
    return finalize(job);
  }

  // More to do — persist progress and ask TelTech to call us back ("please
  // hold"). Each redirect is a fresh webhook, resetting the provider timeout.
  await writeRevalidationJob(ctx.callSid, job);
  return {
    type: 'actions',
    response: buildSay(
      'Still verifying your order. One moment please.',
      '/api/ivr/voice/gather',
      { ...forwardData, node_key: 'checkout_verify_wait' },
    ),
  };
});

/**
 * Creates the Rye multi-item intent synchronously, checks stock, and either
 * presents the final total or routes to stock issue resolution.
 */
registerHandler('final_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;
  const digits = ctx.req.body.digits;

  if (digits === '2') {
    await logCheckoutEvent({
      callSid: ctx.callSid,
      userId,
      eventType: 'checkout_cancelled',
      details: { stage: 'final_confirm_prompt' },
    });
    return {
      type: 'actions',
      response: buildSay('Order cancelled. Returning to cart.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'cart_menu' }),
    };
  }

  try {
    const { data: address } = await supabaseAdmin.from('addresses').select('*').eq('id', addressId).single();
    const { data: paymentMethod } = await supabaseAdmin.from('payment_methods').select('*').eq('id', paymentMethodId).single();
    const { data: cart } = await supabaseAdmin.from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

    if (!address || !paymentMethod || !cart) throw new Error('Missing checkout data');

    const { data: cartItems } = await supabaseAdmin.from('cart_items').select('*, catalog_products(*)').eq('cart_id', cart.id);
    if (!cartItems || cartItems.length === 0) {
      return { type: 'actions', response: buildSay('Your cart is empty.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }) };
    }

    const fulfillmentProvider = await getActiveFulfillmentProvider();
    if (fulfillmentProvider === 'manual') {
      // Revalidation (if enabled) already ran in the checkout_verify_wait poll
      // loop, which refreshed catalog prices and removed unavailable items.
      // Cart snapshot rows are unchanged; pricing is always computed live here.
      const pricingCtx = await loadUserPricingContext(userId);
      const pricedLines = priceCartItems(cartItems, pricingCtx);
      if (getUnpricedCartLineIds(pricedLines).length > 0) {
        return unpricedCartResponse(ctx, userId);
      }

      const revalidationPrefix = ctx.sessionData.revalidation_announcement || '';
      const revalidationRunId = ctx.sessionData.revalidation_run_id || null;

      const subtotal = sumPricedLines(pricedLines);
      const pricing = await calculateManualPricing(subtotal, address.state);
      const shippingStr = pricing.shippingCents > 0
        ? `Shipping is ${formatCurrency(pricing.shippingCents)}. `
        : 'Shipping is free. ';

      await logCheckoutEvent({
        callSid: ctx.callSid,
        userId,
        eventType: 'manual_pricing_calculated',
        details: {
          address_state: pricing.stateCode,
          tax_rate_source: pricing.taxRateSource,
          tax_rate_percent: pricing.taxRatePercent,
          subtotal_cents: pricing.subtotalCents,
          free_shipping_cutoff_cents: pricing.freeShippingCutoffCents,
          shipping_fee_cents: pricing.shippingFeeCents,
          shipping_cents: pricing.shippingCents,
          tax_cents: pricing.taxCents,
          total_cents: pricing.totalCents,
        },
      });

      const totalsPrompt = `${revalidationPrefix}Your order total is ${formatCurrency(pricing.totalCents)}. ${shippingStr}Tax is ${formatCurrency(pricing.taxCents)}. Press 1 to confirm and pay, or press 2 to cancel.`;

      return {
        type: 'actions',
        response: buildGather({
          prompt: totalsPrompt,
          actionPath: '/api/ivr/voice/gather',
          numDigits: 1,
          timeout: 15,
          sessionData: {
            call_sid: ctx.callSid, user_id: userId,
            node_key: 'checkout_pay',
            address_id: addressId, payment_method_id: paymentMethodId,
            fulfillment_provider: 'manual',
            shipping_cents: String(pricing.shippingCents),
            tax_cents: String(pricing.taxCents),
            surcharge_cents: '0',
            ...(revalidationRunId ? { revalidation_run_id: revalidationRunId } : {}),
          },
        }),
      };
    }

    const session = await ivrRuntime.getSession(ctx.callSid);
    const callerPhone = session?.phone_number || undefined;

    let intentResult: IntentResult;
    try {
      intentResult = await createRyeIntent(cartItems, address, callerPhone);
    } catch (ryeError: any) {
      console.error('Rye intent creation failed:', ryeError?.message || ryeError);
      await logCheckoutEvent({
        callSid: ctx.callSid,
        userId,
        eventType: 'rye_intent_failed',
        severity: 'error',
        details: {
          stage: 'create',
          error: ryeError?.message || String(ryeError),
          cart_items: cartItems.map((ci) => ({
            cart_item_id: ci.id,
            voicex_id: ci.voicex_id,
            product_name: getProductDisplayName(ci.catalog_products),
            amazon_url: ci.catalog_products?.amazon_url ?? null,
            quantity: ci.quantity,
          })),
        },
      });
      return { type: 'actions', response: buildHangup('We were unable to verify your order with Amazon. Please try again later.') };
    }

    // Build a quick lookup so we can enrich Rye's URL-only payloads with the
    // product name and voicex_id that admins recognize at a glance.
    const cartByUrl = new Map<string, any>();
    for (const ci of cartItems) {
      const url = ci.catalog_products?.amazon_url;
      if (url) cartByUrl.set(url, ci);
    }
    const enrichByUrl = (productUrl: string | null | undefined) => {
      if (!productUrl) return { product_name: null, voicex_id: null, cart_item_id: null };
      const ci = cartByUrl.get(productUrl);
      if (!ci) return { product_name: null, voicex_id: null, cart_item_id: null };
      return {
        product_name: getProductDisplayName(ci.catalog_products),
        voicex_id: ci.voicex_id ?? null,
        cart_item_id: ci.id ?? null,
      };
    };

    // Snapshot of what Rye returned, captured for both success and failure paths.
    const ryeIntentSnapshot = {
      rye_intent_id: intentResult.intent.id,
      rye_state: intentResult.intent.state,
      shipping_cents: intentResult.shippingCents,
      tax_cents: intentResult.taxCents,
      total_cents: intentResult.totalCents,
      surcharge_cents: intentResult.surchareCents,
      items: (intentResult.intent.items ?? []).map((it) => ({
        product_url: it.productUrl,
        ...enrichByUrl(it.productUrl),
        quantity: it.quantity,
        status: it.status,
        failure_code: it.failureCode ?? null,
      })),
      failure_reason: (intentResult.intent as any).failureReason ?? null,
    };

    if (!intentResult.success) {
      // Branch 1: one or more items are no longer in Amazon's catalog.
      // Auto-remove them, announce to the caller, and retry the intent.
      // Capped at MAX_UNAVAILABLE_RECOVERY_CYCLES to avoid pathological loops.
      const unavailableFailures = intentResult.stockFailures.filter((f) => f.type === 'unavailable');

      if (unavailableFailures.length > 0) {
        await logCheckoutEvent({
          callSid: ctx.callSid,
          userId,
          eventType: 'rye_intent_unavailable',
          severity: 'warn',
          details: {
            ...ryeIntentSnapshot,
            unavailable_failures: unavailableFailures.map((f) => ({
              product_url: f.productUrl,
              ...enrichByUrl(f.productUrl),
              failure_code: f.failureCode,
              message: f.message ?? null,
            })),
            recovery_cycle: parseInt(ctx.sessionData.unavailable_recovery_count || '0', 10),
          },
        });

        // Sub-case: Rye told us product_not_found but parseIntentFailures
        // could not pin down which item (productUrl === ''). We can't
        // auto-remove without risk, so route the user to the cart menu so
        // they can review and adjust manually.
        const unidentified = unavailableFailures.some((f) => !f.productUrl);
        if (unidentified) {
          console.error('[final_confirm] product_not_found with unidentified item; routing user to cart for manual review.', {
            cartItemCount: cartItems.length,
            failureMessages: unavailableFailures.map((f) => f.message ?? null),
          });
          return {
            type: 'actions',
            response: buildSay(
              'One of the items in your cart is no longer available, but we could not determine which one. Please review your cart and remove or replace items before trying again.',
              '/api/ivr/voice/gather',
              { call_sid: ctx.callSid, user_id: userId, node_key: 'cart_menu' }
            ),
          };
        }

        const recoveryCycle = parseInt(ctx.sessionData.unavailable_recovery_count || '0', 10);

        if (recoveryCycle >= MAX_UNAVAILABLE_RECOVERY_CYCLES) {
          console.error(`Unavailable-item recovery exceeded ${MAX_UNAVAILABLE_RECOVERY_CYCLES} cycles; aborting.`);
          return { type: 'actions', response: buildHangup('We were unable to process your order because too many items in your cart are no longer available. Please try again later.') };
        }

        // Track the cart_item ids we actually delete so the
        // remaining-items check reflects real DB writes (not just the
        // failure list, which can drift from in-memory cartItems if any
        // of the lookups above didn't find a match).
        const removedItemIds = new Set<string>();
        const removedNames: string[] = [];
        for (const failure of unavailableFailures) {
          const affected = findCartItemForFailure(failure, cartItems);
          if (!affected) continue;
          const { error: deleteErr } = await supabaseAdmin
            .from('cart_items')
            .delete()
            .eq('id', affected.id);
          if (deleteErr) {
            console.error('[final_confirm] failed to delete unavailable cart item', {
              cartItemId: affected.id, productUrl: failure.productUrl, error: deleteErr,
            });
            continue;
          }
          removedItemIds.add(affected.id);
          removedNames.push(getProductDisplayName(affected.catalog_products));
          await logCheckoutEvent({
            callSid: ctx.callSid,
            userId,
            eventType: 'unavailable_item_removed',
            details: {
              cart_item_id: affected.id,
              product_id: affected.product_id,
              voicex_id: affected.voicex_id,
              product_name: getProductDisplayName(affected.catalog_products),
              amazon_url: affected.catalog_products?.amazon_url ?? null,
              quantity: affected.quantity,
              rye_failure_code: failure.failureCode,
            },
          });
        }

        if (removedItemIds.size === 0) {
          // We detected unavailable failures but couldn't delete any of them
          // (no matching cart items, or all deletes errored). Don't loop
          // forever -- escalate to manual review like the unidentified case.
          console.error('[final_confirm] no unavailable cart items could be deleted; routing user to cart for manual review.', {
            failureProductUrls: unavailableFailures.map((f) => f.productUrl),
            cartItemIds: cartItems.map((ci) => ci.id),
          });
          return {
            type: 'actions',
            response: buildSay(
              'One of the items in your cart is no longer available, but we ran into an issue removing it. Please review your cart and try again.',
              '/api/ivr/voice/gather',
              { call_sid: ctx.callSid, user_id: userId, node_key: 'cart_menu' }
            ),
          };
        }

        const remainingItems = cartItems.filter((ci) => !removedItemIds.has(ci.id));

        const announcement = removedNames.length === 1
          ? `Unfortunately, ${removedNames[0]} is no longer available and has been removed from your cart.`
          : `Unfortunately, the following items are no longer available and have been removed from your cart: ${removedNames.join(', ')}.`;

        if (remainingItems.length === 0) {
          return {
            type: 'actions',
            response: buildSay(
              `${announcement} Your cart is now empty. Returning to the main menu.`,
              '/api/ivr/voice/gather',
              { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
            ),
          };
        }

        return {
          type: 'actions',
          response: buildSay(
            `${announcement} Let me re-check your remaining items with Amazon.`,
            '/api/ivr/voice/gather',
            {
              call_sid: ctx.callSid, user_id: userId,
              node_key: 'checkout_final_confirm',
              address_id: addressId, payment_method_id: paymentMethodId,
              unavailable_recovery_count: String(recoveryCycle + 1),
            }
          ),
        };
      }

      // Branch 2: per-item stock issues (out_of_stock / insufficient_stock).
      // Walk the user through each one to remove or reduce qty.
      if (intentResult.stockFailures.length > 0) {
        await logCheckoutEvent({
          callSid: ctx.callSid,
          userId,
          eventType: 'rye_intent_stock_issue',
          severity: 'warn',
          details: {
            ...ryeIntentSnapshot,
            stock_failures: intentResult.stockFailures.map((f) => ({
              type: f.type,
              product_url: f.productUrl,
              ...enrichByUrl(f.productUrl),
              failure_code: f.failureCode,
            })),
          },
        });
        const failuresJson = JSON.stringify(intentResult.stockFailures);
        return {
          type: 'actions',
          response: buildSay(
            'There is an issue with one or more items in your order.',
            '/api/ivr/voice/gather',
            {
              call_sid: ctx.callSid, user_id: userId,
              node_key: 'checkout_stock_issue',
              address_id: addressId, payment_method_id: paymentMethodId,
              stock_failures: failuresJson,
              stock_failure_idx: '0',
              retry_counts: '{}',
            }
          ),
        };
      }

      const reason = (intentResult.intent as any).failureReason?.code || 'unknown';
      console.error('Rye intent failed with non-stock reason:', reason);
      await logCheckoutEvent({
        callSid: ctx.callSid,
        userId,
        eventType: 'rye_intent_failed',
        severity: 'error',
        details: {
          ...ryeIntentSnapshot,
          reason_code: reason,
        },
      });
      return { type: 'actions', response: buildHangup('We were unable to process your order. Please try again later.') };
    }

    const pricingCtx = await loadUserPricingContext(userId);
    const pricedLines = priceCartItems(cartItems, pricingCtx);
    if (getUnpricedCartLineIds(pricedLines).length > 0) {
      return unpricedCartResponse(ctx, userId);
    }
    const pricedByItemId = pricedLinesByCartItemId(pricedLines);

    const subtotal = sumPricedLines(pricedLines);
    const totalWithFees = subtotal + intentResult.shippingCents + intentResult.taxCents + intentResult.surchareCents;

    await logCheckoutEvent({
      callSid: ctx.callSid,
      userId,
      eventType: 'rye_intent_created',
      details: {
        ...ryeIntentSnapshot,
        // What we will charge the customer (cart prices + Rye fees).
        customer_subtotal_cents: subtotal,
        customer_total_cents: totalWithFees,
        // Per-item charge breakdown (our markup-based prices).
        cart_items: cartItems.map((ci) => {
          const priced = pricedByItemId.get(ci.id);
          const unitPriceCents = priced?.unitPriceCents ?? 0;
          return {
            cart_item_id: ci.id,
            voicex_id: ci.voicex_id,
            product_name: getProductDisplayName(ci.catalog_products),
            amazon_url: ci.catalog_products?.amazon_url ?? null,
            quantity: ci.quantity,
            unit_price_cents: unitPriceCents,
            amazon_price_cents: priced?.amazonPriceCents ?? 0,
            line_total_cents: unitPriceCents * ci.quantity,
          };
        }),
      },
    });

    const shippingStr = intentResult.shippingCents > 0
      ? `Shipping is ${formatCurrency(intentResult.shippingCents)}. `
      : 'Shipping is free. ';
    const taxStr = intentResult.taxCents > 0
      ? `Tax is ${formatCurrency(intentResult.taxCents)}. `
      : '';

    return {
      type: 'actions',
      response: buildGather({
        prompt: `Your order total is ${formatCurrency(totalWithFees)}. ${shippingStr}${taxStr}Press 1 to confirm and pay, or press 2 to cancel.`,
        actionPath: '/api/ivr/voice/gather',
        numDigits: 1,
        timeout: 15,
        sessionData: {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_pay',
          address_id: addressId, payment_method_id: paymentMethodId,
          fulfillment_provider: 'rye',
          rye_intent_id: intentResult.intent.id,
          shipping_cents: String(intentResult.shippingCents),
          tax_cents: String(intentResult.taxCents),
          surcharge_cents: String(intentResult.surchareCents),
        },
      }),
    };
  } catch (error: any) {
    console.error('Final confirm error:', error?.message || error);
    return { type: 'actions', response: buildHangup('We had trouble processing your order. Please try again later.') };
  }
});

/**
 * Handle stock issue resolution. Walk the caller through each failed item
 * one at a time by product name.
 */
registerHandler('stock_issue', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;
  const failuresJson = ctx.sessionData.stock_failures;
  const failureIdx = parseInt(ctx.sessionData.stock_failure_idx || '0', 10);
  const retryCountsJson = ctx.sessionData.retry_counts || '{}';

  let failures: StockFailure[];
  let retryCounts: Record<string, number>;
  try {
    failures = JSON.parse(failuresJson);
    retryCounts = JSON.parse(retryCountsJson);
  } catch {
    return { type: 'actions', response: buildHangup('An error occurred processing your order. Please try again later.') };
  }

  if (failureIdx >= failures.length) {
    return {
      type: 'actions',
      response: buildSay(
        'Let me re-check your updated order with Amazon.',
        '/api/ivr/voice/gather',
        {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_final_confirm',
          address_id: addressId, payment_method_id: paymentMethodId,
        }
      ),
    };
  }

  const failure = failures[failureIdx];

  const { data: cart } = await supabaseAdmin
    .from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

  if (!cart) {
    return { type: 'actions', response: buildSay('Your cart is empty. Returning to main menu.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }) };
  }

  const { data: cartItems } = await supabaseAdmin
    .from('cart_items').select('*, catalog_products(*)').eq('cart_id', cart.id);

  if (!cartItems || cartItems.length === 0) {
    return { type: 'actions', response: buildSay('Your cart is empty. Returning to main menu.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }) };
  }

  const affectedItem = findCartItemForFailure(failure, cartItems);
  if (!affectedItem) {
    return {
      type: 'actions',
      response: buildSay('This item has already been removed from your order.', '/api/ivr/voice/gather', {
        call_sid: ctx.callSid, user_id: userId,
        node_key: 'checkout_stock_issue',
        address_id: addressId, payment_method_id: paymentMethodId,
        stock_failures: failuresJson,
        stock_failure_idx: String(failureIdx + 1),
        retry_counts: JSON.stringify(retryCounts),
      }),
    };
  }

  const productName = getProductDisplayName(affectedItem.catalog_products);
  const productId = affectedItem.product_id;
  const retryCount = retryCounts[productId] || 0;

  if (failure.type === 'out_of_stock') {
    await supabaseAdmin.from('cart_items').delete().eq('id', affectedItem.id);
    await logCheckoutEvent({
      callSid: ctx.callSid,
      userId,
      eventType: 'stock_item_removed',
      details: {
        cart_item_id: affectedItem.id,
        product_id: productId,
        voicex_id: affectedItem.voicex_id,
        product_name: productName,
        amazon_url: affectedItem.catalog_products?.amazon_url ?? null,
        quantity: affectedItem.quantity,
        reason: 'out_of_stock',
      },
    });

    const remainingItems = cartItems.filter((ci) => ci.id !== affectedItem.id);
    if (remainingItems.length === 0) {
      return {
        type: 'actions',
        response: buildSay(
          `Unfortunately, ${productName} is currently out of stock and has been removed from your order. Your cart is now empty. Returning to the main menu.`,
          '/api/ivr/voice/gather',
          { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
        ),
      };
    }

    return {
      type: 'actions',
      response: buildSay(
        `Unfortunately, ${productName} is currently out of stock and has been removed from your order.`,
        '/api/ivr/voice/gather',
        {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_stock_issue',
          address_id: addressId, payment_method_id: paymentMethodId,
          stock_failures: failuresJson,
          stock_failure_idx: String(failureIdx + 1),
          retry_counts: JSON.stringify(retryCounts),
        }
      ),
    };
  }

  // insufficient_stock — check retry limit
  if (retryCount >= MAX_STOCK_RETRIES_PER_ITEM) {
    await supabaseAdmin.from('cart_items').delete().eq('id', affectedItem.id);
    await logCheckoutEvent({
      callSid: ctx.callSid,
      userId,
      eventType: 'stock_item_removed',
      severity: 'warn',
      details: {
        cart_item_id: affectedItem.id,
        product_id: productId,
        voicex_id: affectedItem.voicex_id,
        product_name: productName,
        amazon_url: affectedItem.catalog_products?.amazon_url ?? null,
        quantity: affectedItem.quantity,
        reason: 'retry_cap_exceeded',
        retry_count: retryCount,
      },
    });

    const remainingItems = cartItems.filter((ci) => ci.id !== affectedItem.id);
    if (remainingItems.length === 0) {
      return {
        type: 'actions',
        response: buildSay(
          `We were unable to process ${productName} after multiple attempts. It has been removed from your order. Your cart is now empty. Returning to the main menu.`,
          '/api/ivr/voice/gather',
          { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
        ),
      };
    }

    return {
      type: 'actions',
      response: buildSay(
        `We were unable to process ${productName} after multiple attempts. It has been removed from your order.`,
        '/api/ivr/voice/gather',
        {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_stock_issue',
          address_id: addressId, payment_method_id: paymentMethodId,
          stock_failures: failuresJson,
          stock_failure_idx: String(failureIdx + 1),
          retry_counts: JSON.stringify(retryCounts),
        }
      ),
    };
  }

  return {
    type: 'actions',
    response: buildGather({
      prompt: `${productName} does not have enough stock for the quantity of ${affectedItem.quantity} that you requested. Press 1 to enter a new quantity, or press 2 to remove it from your order.`,
      actionPath: '/api/ivr/voice/gather',
      numDigits: 1,
      timeout: 15,
      sessionData: {
        call_sid: ctx.callSid, user_id: userId,
        node_key: 'checkout_stock_new_qty',
        address_id: addressId, payment_method_id: paymentMethodId,
        stock_failures: failuresJson,
        stock_failure_idx: String(failureIdx),
        retry_counts: JSON.stringify(retryCounts),
        stock_item_id: affectedItem.id,
        stock_product_id: productId,
        stock_action: 'pending',
      },
    }),
  };
});

/**
 * Handle user response to stock issue: enter new qty or remove item.
 */
registerHandler('stock_new_qty', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;
  const failuresJson = ctx.sessionData.stock_failures;
  const failureIdx = parseInt(ctx.sessionData.stock_failure_idx || '0', 10);
  const retryCountsJson = ctx.sessionData.retry_counts || '{}';
  const stockItemId = ctx.sessionData.stock_item_id;
  const stockProductId = ctx.sessionData.stock_product_id;
  const stockAction = ctx.sessionData.stock_action;
  const digits = ctx.req.body.digits;

  let retryCounts: Record<string, number>;
  try {
    retryCounts = JSON.parse(retryCountsJson);
  } catch {
    retryCounts = {};
  }

  const baseSessionData = {
    call_sid: ctx.callSid, user_id: userId,
    address_id: addressId, payment_method_id: paymentMethodId,
    stock_failures: failuresJson,
    stock_failure_idx: String(failureIdx),
    retry_counts: JSON.stringify(retryCounts),
  };

  if (stockAction === 'pending') {
    if (digits === '2') {
      await supabaseAdmin.from('cart_items').delete().eq('id', stockItemId);
      await logCheckoutEvent({
        callSid: ctx.callSid,
        userId,
        eventType: 'stock_item_removed',
        details: {
          cart_item_id: stockItemId,
          product_id: stockProductId,
          reason: 'user_chose_remove',
        },
      });

      const { data: cart } = await supabaseAdmin
        .from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

      if (cart) {
        const { data: remaining } = await supabaseAdmin
          .from('cart_items').select('id').eq('cart_id', cart.id);

        if (!remaining || remaining.length === 0) {
          return {
            type: 'actions',
            response: buildSay(
              'Item removed. Your cart is now empty. Returning to the main menu.',
              '/api/ivr/voice/gather',
              { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
            ),
          };
        }
      }

      return {
        type: 'actions',
        response: buildSay(
          'Item removed from your order.',
          '/api/ivr/voice/gather',
          { ...baseSessionData, node_key: 'checkout_stock_issue', stock_failure_idx: String(failureIdx + 1) }
        ),
      };
    }

    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter the new quantity followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: {
          ...baseSessionData,
          node_key: 'checkout_stock_new_qty',
          stock_item_id: stockItemId,
          stock_product_id: stockProductId,
          stock_action: 'qty_entry',
        },
      }),
    };
  }

  // stock_action === 'qty_entry'
  const newQty = parseInt(digits || '', 10);

  if (!newQty || newQty <= 0) {
    return {
      type: 'actions',
      response: buildGather({
        prompt: 'Please enter a valid quantity greater than zero, followed by the pound key.',
        actionPath: '/api/ivr/voice/gather',
        timeout: 10,
        finishOnKey: '#',
        sessionData: {
          ...baseSessionData,
          node_key: 'checkout_stock_new_qty',
          stock_item_id: stockItemId,
          stock_product_id: stockProductId,
          stock_action: 'qty_entry',
        },
      }),
    };
  }

  await supabaseAdmin
    .from('cart_items')
    .update({ quantity: newQty })
    .eq('id', stockItemId);

  retryCounts[stockProductId] = (retryCounts[stockProductId] || 0) + 1;

  await logCheckoutEvent({
    callSid: ctx.callSid,
    userId,
    eventType: 'stock_item_qty_updated',
    details: {
      cart_item_id: stockItemId,
      product_id: stockProductId,
      new_quantity: newQty,
      retry_count: retryCounts[stockProductId],
    },
  });

  return {
    type: 'actions',
    response: buildSay(
      `Quantity updated to ${newQty}.`,
      '/api/ivr/voice/gather',
      {
        ...baseSessionData,
        node_key: 'checkout_stock_issue',
        stock_failure_idx: String(failureIdx + 1),
        retry_counts: JSON.stringify(retryCounts),
      }
    ),
  };
});

/**
 * Final payment step -- user confirmed the total with real shipping/tax.
 * Synchronous flow: Sola auth-hold -> Rye drawdown -> Sola capture.
 * If Rye fails, the Sola hold is released via cc:voidrelease.
 */
registerHandler('checkout_pay', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;
  const ryeIntentId = ctx.sessionData.rye_intent_id;
  const fulfillmentProvider: FulfillmentProvider = ctx.sessionData.fulfillment_provider === 'manual' ? 'manual' : 'rye';
  const shippingCents = parseInt(ctx.sessionData.shipping_cents || '0', 10);
  const taxCents = parseInt(ctx.sessionData.tax_cents || '0', 10);
  const surchargeCents = parseInt(ctx.sessionData.surcharge_cents || '0', 10);

  if (digits === '2') {
    await logCheckoutEvent({
      callSid: ctx.callSid,
      userId,
      eventType: 'checkout_cancelled',
      details: { stage: 'pay_prompt', fulfillment_provider: fulfillmentProvider, rye_intent_id: ryeIntentId ?? null },
    });
    return {
      type: 'actions',
      response: buildSay('Order cancelled. Returning to cart.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'cart_menu' }),
    };
  }

  try {
    const { data: paymentMethod } = await supabaseAdmin.from('payment_methods').select('*').eq('id', paymentMethodId).single();
    const { data: cart } = await supabaseAdmin.from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

    if (!paymentMethod || !cart) throw new Error('Missing checkout data');

    const { data: cartItems } = await supabaseAdmin.from('cart_items').select('*, catalog_products(*)').eq('cart_id', cart.id);
    if (!cartItems || cartItems.length === 0) throw new Error('Empty cart');

    const pricingCtx = await loadUserPricingContext(userId);
    const pricedLines = priceCartItems(cartItems, pricingCtx);
    if (getUnpricedCartLineIds(pricedLines).length > 0) {
      return unpricedCartResponse(ctx, userId);
    }
    const pricedByItemId = pricedLinesByCartItemId(pricedLines);

    const subtotal = sumPricedLines(pricedLines);
    const totalCents = subtotal + shippingCents + taxCents + surchargeCents;

    // Same enrich-by-URL helper as in final_confirm so Rye-returned items[]
    // can be tagged with the product name + voicex_id we recognize.
    const cartByUrl = new Map<string, any>();
    for (const ci of cartItems) {
      const url = ci.catalog_products?.amazon_url;
      if (url) cartByUrl.set(url, ci);
    }
    const enrichByUrl = (productUrl: string | null | undefined) => {
      if (!productUrl) return { product_name: null, voicex_id: null };
      const ci = cartByUrl.get(productUrl);
      if (!ci) return { product_name: null, voicex_id: null };
      return {
        product_name: getProductDisplayName(ci.catalog_products),
        voicex_id: ci.voicex_id ?? null,
      };
    };

    // --- Step 1: Place auth hold on customer's card via Sola ---
    let authResult;
    try {
      authResult = await solaAuthOnly(paymentMethod.sola_token, totalCents);
    } catch (authError) {
      console.error('Sola auth hold failed:', authError);
      await discardUnverifiedCard(paymentMethod, ctx.callSid, userId);
      await logCheckoutEvent({
        callSid: ctx.callSid,
        userId,
        eventType: 'sola_auth_failed',
        severity: 'error',
        details: {
          stage: 'auth_only',
          amount_cents: totalCents,
          payment_method_id: paymentMethodId,
          card_last4: paymentMethod.card_last4,
          error: String(authError),
        },
      });
      return {
        type: 'actions',
        response: buildGather({
          prompt: 'Your card was declined. Press 1 to try a different card, or press 2 to cancel.',
          actionPath: '/api/ivr/voice/gather',
          numDigits: 1,
          timeout: 10,
          sessionData: {
            call_sid: ctx.callSid, user_id: userId,
            node_key: 'checkout_payment_choice',
            address_id: addressId,
          },
        }),
      };
    }

    if (authResult.xResult !== 'A') {
      await discardUnverifiedCard(paymentMethod, ctx.callSid, userId);
      await logCheckoutEvent({
        callSid: ctx.callSid,
        userId,
        eventType: 'sola_auth_failed',
        severity: 'warn',
        details: {
          stage: 'auth_only',
          amount_cents: totalCents,
          payment_method_id: paymentMethodId,
          card_last4: paymentMethod.card_last4,
          x_result: authResult.xResult,
          x_error: authResult.xError ?? null,
        },
      });
      return {
        type: 'actions',
        response: buildGather({
          prompt: `Your card was declined. ${authResult.xError || ''}. Press 1 to try a different card, or press 2 to cancel.`,
          actionPath: '/api/ivr/voice/gather',
          numDigits: 1,
          timeout: 10,
          sessionData: {
            call_sid: ctx.callSid, user_id: userId,
            node_key: 'checkout_payment_choice',
            address_id: addressId,
          },
        }),
      };
    }

    const solaRefNum = authResult.xRefNum;

    // The card just passed an auth hold, so it's confirmed chargeable. Promote a
    // freshly-entered (unverified) card to verified and make it the user's
    // default now that we know it works.
    await promoteVerifiedCard(paymentMethod, ctx.callSid, userId);

    await logCheckoutEvent({
      callSid: ctx.callSid,
      userId,
      eventType: 'sola_auth_succeeded',
      details: {
        stage: 'auth_only',
        amount_cents: totalCents,
        payment_method_id: paymentMethodId,
        card_last4: paymentMethod.card_last4,
        sola_ref_num: solaRefNum,
      },
    });

    // --- Step 2: Create order in DB ---
    // Snapshot card_brand + card_last4 onto the order so it stays visible
    // even if the user later deletes this saved payment method.
    const { data: order } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: userId, cart_id: cart.id, address_id: addressId, payment_method_id: paymentMethodId,
        rye_checkout_intent_id: fulfillmentProvider === 'rye' ? ryeIntentId : null,
        fulfillment_provider: fulfillmentProvider,
        fulfillment_status: fulfillmentProvider === 'manual' ? 'queued' : 'none',
        status: 'processing', subtotal_cents: subtotal, shipping_cents: shippingCents,
        tax_cents: taxCents, total_cents: totalCents,
        card_brand_snapshot: paymentMethod.card_brand ?? null,
        card_last4_snapshot: paymentMethod.card_last4 ?? null,
      })
      .select()
      .single();

    if (!order) throw new Error('Failed to create order');

    // Link the checkout revalidation sync run (if any) to the new order so it
    // shows the order number in the Product Sync report.
    const revalidationRunId = ctx.sessionData.revalidation_run_id;
    if (revalidationRunId) {
      await backfillSyncRunOrder(revalidationRunId, Number(order.id));
    }

    const orderItems = cartItems.map((ci) => {
      const priced = pricedByItemId.get(ci.id)!;
      return {
        order_id: String(order.id), product_id: ci.product_id, voicex_id: ci.voicex_id,
        product_name: getProductDisplayName(ci.catalog_products),
        quantity: ci.quantity, unit_price_cents: priced.unitPriceCents!,
        amazon_price_cents: priced.amazonPriceCents ?? 0,
        amazon_asin: ci.catalog_products?.amazon_asin ?? null,
        amazon_url: ci.catalog_products?.amazon_url ?? null,
        local_price_cents: priced.localPriceCents,
        markup_percent: priced.markupPercent,
      };
    });

    await supabaseAdmin.from('order_items').insert(orderItems);
    await supabaseAdmin.from('order_events').insert({
      order_id: String(order.id), status: 'processing', source: 'system',
      details: { action: 'order_created', fulfillment_provider: fulfillmentProvider, sola_ref_num: solaRefNum },
    });
    await supabaseAdmin.from('order_holds').insert({
      order_id: String(order.id), sola_ref_num: solaRefNum, amount_cents: totalCents, status: 'held',
    });
    await supabaseAdmin.from('carts').update({ status: 'checked_out' }).eq('id', cart.id);

    await logCheckoutEvent({
      callSid: ctx.callSid,
      userId,
      orderId: String(order.id),
      eventType: 'order_persisted',
      details: {
        order_id: String(order.id),
        fulfillment_provider: fulfillmentProvider,
        rye_intent_id: ryeIntentId,
        sola_ref_num: solaRefNum,
        subtotal_cents: subtotal,
        shipping_cents: shippingCents,
        tax_cents: taxCents,
        total_cents: totalCents,
        item_count: orderItems.length,
        items: orderItems.map((oi) => ({
          product_id: oi.product_id,
          voicex_id: oi.voicex_id,
          product_name: oi.product_name,
          quantity: oi.quantity,
          unit_price_cents: oi.unit_price_cents,
          amazon_price_cents: oi.amazon_price_cents,
          amazon_asin: oi.amazon_asin,
          amazon_url: oi.amazon_url,
          line_total_cents: oi.unit_price_cents * oi.quantity,
        })),
      },
    });

    if (fulfillmentProvider === 'manual') {
      await supabaseAdmin.from('order_events').insert({
        order_id: String(order.id), status: 'processing', source: 'system',
        details: {
          action: 'manual_fulfillment_queued',
          sola_ref_num: solaRefNum,
          total_cents: totalCents,
        },
      });

      await logCheckoutEvent({
        callSid: ctx.callSid,
        userId,
        orderId: String(order.id),
        eventType: 'manual_fulfillment_queued',
        details: {
          order_id: String(order.id),
          sola_ref_num: solaRefNum,
          total_cents: totalCents,
          item_count: orderItems.length,
          items: orderItems.map((oi) => ({
            product_id: oi.product_id,
            voicex_id: oi.voicex_id,
            product_name: oi.product_name,
            quantity: oi.quantity,
            amazon_asin: oi.amazon_asin,
            amazon_url: oi.amazon_url,
          })),
        },
      });

      return {
        type: 'actions',
        response: buildSay(
          'Your order has been placed successfully. Thank you for shopping with Voicex.',
          '/api/ivr/voice/gather',
          { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
        ),
      };
    }

    if (!ryeIntentId) throw new Error('Missing Rye checkout intent id');

    // --- Step 3: Confirm with Rye using drawdown ---
    let ryeSuccess = false;
    try {
      const completed = await confirmRyeIntent(ryeIntentId);
      ryeSuccess = completed.state === 'completed';

      await supabaseAdmin.from('order_events').insert({
        order_id: String(order.id), status: ryeSuccess ? 'completed' : 'failed', source: 'system',
        details: {
          action: 'rye_checkout_confirmed', rye_intent_id: ryeIntentId,
          rye_state: completed.state, failure_reason: completed.failureReason || null,
        },
      });

      await logCheckoutEvent({
        callSid: ctx.callSid,
        userId,
        orderId: String(order.id),
        eventType: ryeSuccess ? 'rye_confirm_succeeded' : 'rye_confirm_failed',
        severity: ryeSuccess ? 'info' : 'error',
        details: {
          rye_intent_id: ryeIntentId,
          rye_state: completed.state,
          rye_order_id: (completed as any).orderId ?? null,
          failure_reason: completed.failureReason ?? null,
          // Final pricing as Rye reported it (what Amazon/Rye actually charges
          // us via drawdown). Compare against order.total_cents (what we
          // charged the customer via Sola) to monitor margin drift.
          rye_final_offer: (completed as any).offer?.cost ?? null,
          rye_items: ((completed as any).items ?? []).map((it: any) => ({
            product_url: it.productUrl,
            ...enrichByUrl(it.productUrl),
            quantity: it.quantity,
            status: it.status,
            failure_code: it.failureCode ?? null,
          })),
          customer_total_cents: totalCents,
        },
      });
    } catch (ryeError) {
      console.error('Rye confirm failed:', ryeError);
      await supabaseAdmin.from('order_events').insert({
        order_id: String(order.id), status: 'failed', source: 'system',
        details: { action: 'rye_checkout_failed', rye_intent_id: ryeIntentId, error: String(ryeError) },
      });
      await logCheckoutEvent({
        callSid: ctx.callSid,
        userId,
        orderId: String(order.id),
        eventType: 'rye_confirm_failed',
        severity: 'error',
        details: {
          rye_intent_id: ryeIntentId,
          error: String(ryeError),
          customer_total_cents: totalCents,
        },
      });
    }

    // --- Step 4: Capture or release the Sola hold ---
    if (ryeSuccess) {
      try {
        await solaCapture(solaRefNum, totalCents);
        await supabaseAdmin.from('order_holds').update({ status: 'captured' }).eq('order_id', String(order.id)).eq('sola_ref_num', solaRefNum);
        await supabaseAdmin.from('orders').update({ status: 'completed' }).eq('id', order.id);

        await logCheckoutEvent({
          callSid: ctx.callSid,
          userId,
          orderId: String(order.id),
          eventType: 'sola_capture_succeeded',
          details: {
            sola_ref_num: solaRefNum,
            amount_cents: totalCents,
            card_last4: paymentMethod.card_last4,
          },
        });
        await logCheckoutEvent({
          callSid: ctx.callSid,
          userId,
          orderId: String(order.id),
          eventType: 'order_completed',
          details: { order_id: String(order.id), total_cents: totalCents },
        });

        for (const item of cartItems) {
          await supabaseAdmin.rpc('increment_product_sold', {
            p_product_id: item.product_id,
            p_qty: item.quantity,
          });
        }

        return {
          type: 'actions',
          response: buildSay(
            `Your order has been placed! Your order number is ${formatOrderIdForSpeech(order.id)}. You will receive updates on the status of your order. Thank you for shopping with VoiceX!`,
            '/api/ivr/voice/gather',
            { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
          ),
        };
      } catch (captureError) {
        // Rye drawdown succeeded but Sola capture failed -- critical
        console.error('CRITICAL: Sola capture failed after Rye success:', captureError);
        await supabaseAdmin.from('order_holds').update({ status: 'failed' }).eq('order_id', String(order.id)).eq('sola_ref_num', solaRefNum);
        await supabaseAdmin.from('orders').update({ status: 'completed' }).eq('id', order.id);
        await supabaseAdmin.from('order_events').insert({
          order_id: String(order.id), status: 'completed', source: 'system',
          details: { action: 'sola_capture_failed_manual_review', error: String(captureError), sola_ref_num: solaRefNum },
        });

        await logCheckoutEvent({
          callSid: ctx.callSid,
          userId,
          orderId: String(order.id),
          eventType: 'sola_capture_failed',
          severity: 'error',
          details: {
            sola_ref_num: solaRefNum,
            amount_cents: totalCents,
            card_last4: paymentMethod.card_last4,
            error: String(captureError),
            note: 'Rye drawdown SUCCEEDED but Sola capture FAILED -- manual review needed (customer was not charged for an order Amazon will fulfill).',
          },
        });
        await logCheckoutEvent({
          callSid: ctx.callSid,
          userId,
          orderId: String(order.id),
          eventType: 'order_completed',
          severity: 'warn',
          details: { order_id: String(order.id), total_cents: totalCents, manual_review: true },
        });

        return {
          type: 'actions',
          response: buildSay(
            `Your order has been placed! Your order number is ${formatOrderIdForSpeech(order.id)}. Thank you for shopping with VoiceX!`,
            '/api/ivr/voice/gather',
            { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
          ),
        };
      }
    } else {
      // Rye failed -- release the auth hold
      let voidSucceeded = false;
      try {
        await solaVoidRelease(solaRefNum);
        await supabaseAdmin.from('order_holds').update({ status: 'voided' }).eq('order_id', String(order.id)).eq('sola_ref_num', solaRefNum);
        voidSucceeded = true;
      } catch (voidError) {
        console.error('Sola void release failed:', voidError);
        await supabaseAdmin.from('order_holds').update({ status: 'failed' }).eq('order_id', String(order.id)).eq('sola_ref_num', solaRefNum);
        await logCheckoutEvent({
          callSid: ctx.callSid,
          userId,
          orderId: String(order.id),
          eventType: 'sola_void_release',
          severity: 'error',
          details: {
            sola_ref_num: solaRefNum,
            amount_cents: totalCents,
            error: String(voidError),
            note: 'Sola void-release FAILED after Rye failure -- customer card may be left with a stuck auth hold.',
          },
        });
      }

      if (voidSucceeded) {
        await logCheckoutEvent({
          callSid: ctx.callSid,
          userId,
          orderId: String(order.id),
          eventType: 'sola_void_release',
          details: { sola_ref_num: solaRefNum, amount_cents: totalCents },
        });
      }

      await supabaseAdmin.from('orders').update({ status: 'failed' }).eq('id', order.id);
      await logCheckoutEvent({
        callSid: ctx.callSid,
        userId,
        orderId: String(order.id),
        eventType: 'order_failed',
        severity: 'error',
        details: { order_id: String(order.id), reason: 'rye_confirm_failed' },
      });

      return {
        type: 'actions',
        response: buildSay(
          'We were unable to complete your order with the merchant. Your card has not been charged. Please try again later.',
          '/api/ivr/voice/gather',
          { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
        ),
      };
    }
  } catch (error) {
    console.error('Order placement error:', error);
    await logCheckoutEvent({
      callSid: ctx.callSid,
      userId,
      eventType: 'order_failed',
      severity: 'error',
      details: { stage: 'checkout_pay', fulfillment_provider: fulfillmentProvider, error: String(error) },
    });
    return { type: 'actions', response: buildHangup('We had trouble placing your order. Please try again later.') };
  }
});

const STATE_NAME_TO_CODE: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
};

const VALID_STATE_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

function parseStateInput(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/[^a-z\s]/g, '');
  if (!trimmed) return '';

  if (trimmed.length <= 2) {
    const code = trimmed.toUpperCase();
    return VALID_STATE_CODES.has(code) ? code : '';
  }

  return STATE_NAME_TO_CODE[trimmed] || '';
}

