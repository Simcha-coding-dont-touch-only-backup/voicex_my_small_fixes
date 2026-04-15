import { supabaseAdmin } from '../../../lib/supabase.js';
import { registerHandler } from '../handler-registry.js';
import { buildGather, buildSay, buildHangup, buildCollect, formatCurrency } from '../../teltech/teltech-builder.js';
import { validateAddress, validateAddressFreeform } from '../../../lib/google-address.js';
import { createRyeIntent, confirmRyeIntent, findCartItemForFailure } from '../../../lib/rye-checkout.js';
import type { StockFailure, IntentResult } from '../../../lib/rye-checkout.js';
import { solaTokenize, solaAuthOnly, solaCapture, solaVoidRelease } from '../../../lib/sola.js';
import { getProductDisplayName } from '@voicex/shared';
import { ivrRuntime } from '../runtime.js';

const MAX_STOCK_RETRIES_PER_ITEM = 3;

registerHandler('address_choice', async (ctx) => {
  const userId = ctx.sessionData.user_id;

  const { data: addresses } = await supabaseAdmin
    .from('addresses')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false });

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
          addr_line1: validation.correctedAddress?.address1 || line1, addr_line2: line2,
          addr_city: validation.correctedAddress?.city || city,
          addr_state: validation.correctedAddress?.state || state,
          addr_zip: validation.correctedAddress?.zipCode || zip,
          addr_validated: validation.isValid ? '1' : '0',
        },
      }),
    };
  } catch (error) {
    console.error('Address validation error:', error);
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
          addr_line1: line1, addr_line2: line2, addr_city: city, addr_state: state, addr_zip: zip, addr_validated: '0',
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
        cc_num: cleaned,
      },
    }),
  };
});

registerHandler('card_exp', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const ccNum = ctx.sessionData.cc_num;
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
          cc_num: ccNum,
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
          cc_num: ccNum,
        },
      }),
    };
  }

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
        cc_num: ccNum,
        cc_exp: cleaned,
      },
    }),
  };
});

registerHandler('card_cvv', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const ccNum = ctx.sessionData.cc_num;
  const ccExp = ctx.sessionData.cc_exp;
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
          cc_num: ccNum,
          cc_exp: ccExp,
        },
      }),
    };
  }

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
        cc_num: ccNum,
        cc_exp: ccExp,
        cc_cvv: cleaned,
      },
    }),
  };
});

registerHandler('card_zip', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const ccNum = ctx.sessionData.cc_num;
  const ccExp = ctx.sessionData.cc_exp;
  const ccCvv = ctx.sessionData.cc_cvv;
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
          cc_num: ccNum,
          cc_exp: ccExp,
          cc_cvv: ccCvv,
        },
      }),
    };
  }

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
        cc_num: ccNum,
        cc_exp: ccExp,
        cc_cvv: ccCvv,
        cc_zip: digits,
      },
    }),
  };
});

registerHandler('card_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const ccNum = ctx.sessionData.cc_num;
  const ccExp = ctx.sessionData.cc_exp;
  const ccCvv = ctx.sessionData.cc_cvv;
  const ccZip = ctx.sessionData.cc_zip;
  const digits = ctx.req.body.digits;

  if (digits === '2') {
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

    const { data: savedCard } = await supabaseAdmin
      .from('payment_methods')
      .insert({
        user_id: userId,
        sola_token: solaResult.xToken,
        card_last4: last4,
        card_brand: solaResult.xCardType || null,
        card_exp_month: expMonth,
        card_exp_year: expYear,
        is_default: true,
      })
      .select()
      .single();

    if (!savedCard) throw new Error('Failed to save card');

    await supabaseAdmin
      .from('payment_methods')
      .update({ is_default: false })
      .eq('user_id', userId)
      .neq('id', savedCard.id);

    return {
      type: 'actions',
      response: buildSay(
        `Your ${solaResult.xCardType || 'card'} ending in ${last4} has been saved.`,
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

  const { data: cart } = await supabaseAdmin
    .from('carts').select('id').eq('user_id', userId).eq('status', 'active').single();

  if (!cart) {
    return { type: 'actions', response: buildSay('Your cart is empty.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }) };
  }

  const { data: items } = await supabaseAdmin
    .from('cart_items').select('*, catalog_products(*)').eq('cart_id', cart.id);

  if (!items || items.length === 0) {
    return { type: 'actions', response: buildSay('Your cart is empty.', '/api/ivr/voice/gather', { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }) };
  }

  const subtotal = items.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);

  return {
    type: 'actions',
    response: buildGather({
      prompt: `Your order total is ${formatCurrency(subtotal)}. Shipping and tax will be calculated at final confirmation. Press 1 to place the order, or press 2 to go back to your cart.`,
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
registerHandler('order_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const digits = ctx.req.body.digits;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;

  if (digits === '2') {
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

    return {
      type: 'actions',
      response: buildSay(
        'Please hold while we verify your order with Amazon.',
        '/api/ivr/voice/gather',
        {
          call_sid: ctx.callSid, user_id: userId,
          node_key: 'checkout_final_confirm',
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
 * Creates the Rye multi-item intent synchronously, checks stock, and either
 * presents the final total or routes to stock issue resolution.
 */
registerHandler('final_confirm', async (ctx) => {
  const userId = ctx.sessionData.user_id;
  const addressId = ctx.sessionData.address_id;
  const paymentMethodId = ctx.sessionData.payment_method_id;
  const digits = ctx.req.body.digits;

  if (digits === '2') {
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

    let intentResult: IntentResult;
    try {
      intentResult = await createRyeIntent(cartItems, address);
    } catch (ryeError) {
      console.error('Rye intent creation failed:', ryeError);
      return { type: 'actions', response: buildHangup('We were unable to verify your order with Amazon. Please try again later.') };
    }

    if (!intentResult.success) {
      if (intentResult.stockFailures.length > 0) {
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
      return { type: 'actions', response: buildHangup('We were unable to process your order. Please try again later.') };
    }

    const subtotal = cartItems.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);
    const totalWithFees = subtotal + intentResult.shippingCents + intentResult.taxCents + intentResult.surchareCents;

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
          rye_intent_id: intentResult.intent.id,
          shipping_cents: String(intentResult.shippingCents),
          tax_cents: String(intentResult.taxCents),
          surcharge_cents: String(intentResult.surchareCents),
        },
      }),
    };
  } catch (error) {
    console.error('Final confirm error:', error);
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
  const shippingCents = parseInt(ctx.sessionData.shipping_cents || '0', 10);
  const taxCents = parseInt(ctx.sessionData.tax_cents || '0', 10);
  const surchargeCents = parseInt(ctx.sessionData.surcharge_cents || '0', 10);

  if (digits === '2') {
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

    const subtotal = cartItems.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0);
    const totalCents = subtotal + shippingCents + taxCents + surchargeCents;

    // --- Step 1: Place auth hold on customer's card via Sola ---
    let authResult;
    try {
      authResult = await solaAuthOnly(paymentMethod.sola_token, totalCents);
    } catch (authError) {
      console.error('Sola auth hold failed:', authError);
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

    // --- Step 2: Create order in DB ---
    const { data: order } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: userId, cart_id: cart.id, address_id: addressId, payment_method_id: paymentMethodId,
        rye_checkout_intent_id: ryeIntentId,
        status: 'processing', subtotal_cents: subtotal, shipping_cents: shippingCents,
        tax_cents: taxCents, total_cents: totalCents,
      })
      .select()
      .single();

    if (!order) throw new Error('Failed to create order');

    const orderItems = cartItems.map((ci) => ({
      order_id: order.id, product_id: ci.product_id, voicex_id: ci.voicex_id,
      product_name: getProductDisplayName(ci.catalog_products),
      quantity: ci.quantity, unit_price_cents: ci.unit_price_cents,
      amazon_price_cents: ci.amazon_price_cents, markup_percent: ci.markup_percent,
    }));

    await supabaseAdmin.from('order_items').insert(orderItems);
    await supabaseAdmin.from('order_events').insert({
      order_id: order.id, status: 'processing', source: 'system',
      details: { action: 'order_created', sola_ref_num: solaRefNum },
    });
    await supabaseAdmin.from('order_holds').insert({
      order_id: order.id, sola_ref_num: solaRefNum, amount_cents: totalCents, status: 'held',
    });
    await supabaseAdmin.from('carts').update({ status: 'checked_out' }).eq('id', cart.id);

    // --- Step 3: Confirm with Rye using drawdown ---
    let ryeSuccess = false;
    try {
      const completed = await confirmRyeIntent(ryeIntentId);
      ryeSuccess = completed.state === 'completed';

      await supabaseAdmin.from('order_events').insert({
        order_id: order.id, status: ryeSuccess ? 'completed' : 'failed', source: 'system',
        details: {
          action: 'rye_checkout_confirmed', rye_intent_id: ryeIntentId,
          rye_state: completed.state, failure_reason: completed.failureReason || null,
        },
      });
    } catch (ryeError) {
      console.error('Rye confirm failed:', ryeError);
      await supabaseAdmin.from('order_events').insert({
        order_id: order.id, status: 'failed', source: 'system',
        details: { action: 'rye_checkout_failed', rye_intent_id: ryeIntentId, error: String(ryeError) },
      });
    }

    // --- Step 4: Capture or release the Sola hold ---
    if (ryeSuccess) {
      try {
        await solaCapture(solaRefNum, totalCents);
        await supabaseAdmin.from('order_holds').update({ status: 'captured' }).eq('order_id', order.id).eq('sola_ref_num', solaRefNum);
        await supabaseAdmin.from('orders').update({ status: 'completed' }).eq('id', order.id);

        for (const item of cartItems) {
          await supabaseAdmin.rpc('increment_product_sold', {
            p_product_id: item.product_id,
            p_qty: item.quantity,
          });
        }

        return {
          type: 'actions',
          response: buildSay(
            `Your order has been placed! Your order number is ${order.id.slice(-6).toUpperCase()}. You will receive updates on the status of your order. Thank you for shopping with VoiceX!`,
            '/api/ivr/voice/gather',
            { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
          ),
        };
      } catch (captureError) {
        // Rye drawdown succeeded but Sola capture failed -- critical
        console.error('CRITICAL: Sola capture failed after Rye success:', captureError);
        await supabaseAdmin.from('order_holds').update({ status: 'failed' }).eq('order_id', order.id).eq('sola_ref_num', solaRefNum);
        await supabaseAdmin.from('orders').update({ status: 'completed' }).eq('id', order.id);
        await supabaseAdmin.from('order_events').insert({
          order_id: order.id, status: 'completed', source: 'system',
          details: { action: 'sola_capture_failed_manual_review', error: String(captureError), sola_ref_num: solaRefNum },
        });

        return {
          type: 'actions',
          response: buildSay(
            `Your order has been placed! Your order number is ${order.id.slice(-6).toUpperCase()}. Thank you for shopping with VoiceX!`,
            '/api/ivr/voice/gather',
            { call_sid: ctx.callSid, user_id: userId, node_key: 'main_menu' }
          ),
        };
      }
    } else {
      // Rye failed -- release the auth hold
      try {
        await solaVoidRelease(solaRefNum);
        await supabaseAdmin.from('order_holds').update({ status: 'voided' }).eq('order_id', order.id).eq('sola_ref_num', solaRefNum);
      } catch (voidError) {
        console.error('Sola void release failed:', voidError);
        await supabaseAdmin.from('order_holds').update({ status: 'failed' }).eq('order_id', order.id).eq('sola_ref_num', solaRefNum);
      }

      await supabaseAdmin.from('orders').update({ status: 'failed' }).eq('id', order.id);

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

