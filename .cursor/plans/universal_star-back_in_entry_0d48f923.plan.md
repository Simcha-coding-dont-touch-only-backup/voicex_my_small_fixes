---
name: universal star-back in entry
overview: "Extend the existing universal `*`-back behavior so it works during any DTMF response-entry state (catalog ID, card number, CVV, ZIP, PIN, quantity, exp date, etc.), not only when a menu prompt is being played. Two small backend changes: (1) make `*` a terminator on every gather so it ends the entry instantly, and (2) loosen the `*` detection in the gather webhook so any digit string that starts or ends with `*` is treated as \"back\"."
todos:
  - id: terminator
    content: Update buildGather in apps/api/src/modules/teltech/teltech-builder.ts so `*` is always part of the terminator string (`'#*'` for finishOnKey gathers, `'*'` for fixed-digit gathers)
    status: in_progress
  - id: detection
    content: Update handleGatherResult in apps/api/src/modules/teltech/handlers/gather-result.ts to treat any digit string starting with or ending in `*` as a back request (replaces the exact `=== '*'` check)
    status: completed
  - id: manual-test
    content: "Manual call-through: verify `*` cancels mid-PIN, mid-catalog-ID, mid-card-number, mid-card-exp, mid-CVV, mid-ZIP, mid-quantity — each pops to the correct previous menu via the existing menu_stack"
    status: completed
isProject: false
---

## Why it doesn't work today

The universal `*` handler in [apps/api/src/modules/teltech/handlers/gather-result.ts](apps/api/src/modules/teltech/handlers/gather-result.ts) only fires on an exact match:

```133:135:apps/api/src/modules/teltech/handlers/gather-result.ts
    if (incomingDigits === '*') {
      const currentNode = await ivrRuntime.getNodeByKey(flowVersionId, nodeKey);
```

But for any multi-digit DTMF entry built by `buildGather` in [apps/api/src/modules/teltech/teltech-builder.ts](apps/api/src/modules/teltech/teltech-builder.ts):

```41:52:apps/api/src/modules/teltech/teltech-builder.ts
  const gather: TeltechGatherAction = {
    action: 'gather',
    min_digits: options.numDigits || 1,
    max_digits: options.numDigits || 20,
    timeout: (options.timeout || 5) * 1000,
    digit_timeout: hasFixedDigits ? 500 : undefined,
    tries: options.tries ?? 3,
    prompt: { action: 'say', text: sanitizeForTTS(options.prompt) },
    action_url: actionUrl,
    terminator: hasExplicitTerminator ? options.finishOnKey : (hasFixedDigits ? '' : undefined),
    regex: '[0-9*#]+',
  };
```

…the terminator is either `'#'` (catalog ID, card number, CVV, ZIP) or `''` (PIN, exp date — relies on filling N digits). In neither case does `*` end the gather. So a caller pressing `*` mid-entry either has to also press `#`, fill the remaining digit slots, or wait for the full timeout — and even then the captured digits look like `'*123'` / `'12*'` / `'*'`, only the last of which the universal handler accepts.

## The fix (two changes, both server-side)

### 1. Make `*` a terminator on every gather

File: [apps/api/src/modules/teltech/teltech-builder.ts](apps/api/src/modules/teltech/teltech-builder.ts), `buildGather`.

Change the terminator computation so `*` is always allowed as a terminator alongside whatever else is currently set. TelTech / FreeSWITCH-style `terminator` accepts a set of characters:

- finishOnKey-style gather (`finishOnKey: '#'`) → terminator becomes `'#*'`
- fixed-digit gather (e.g. PIN, exp date) → terminator becomes `'*'` (instead of `''`)
- single-digit menu gather (already terminates instantly via `min_digits=max_digits=1`) → terminator becomes `'*'` for consistency (no behavior change, since gather completes on the first key anyway)

Effect: the moment the caller presses `*`, the gather ends immediately and TelTech POSTs back with whatever digits were typed so far (often just `*`).

### 2. Detect `*` anywhere at the start or end of the digit buffer

File: [apps/api/src/modules/teltech/handlers/gather-result.ts](apps/api/src/modules/teltech/handlers/gather-result.ts).

Replace the exact-match check:

```ts
if (incomingDigits === '*') { ... }
```

with a starts-with-or-ends-with-`*` check:

```ts
const isBackRequest =
  typeof incomingDigits === 'string' &&
  (incomingDigits.startsWith('*') || incomingDigits.endsWith('*'));

if (isBackRequest) {
  // existing pop-stack + re-dispatch logic
}
```

Rationale (covers every realistic mid-entry case):

- Caller presses `*` alone → digits `'*'` → back.
- Caller presses `*#` (old behavior, still works) → digits `'*'` → back.
- Caller starts typing then changes their mind: `123*` → ends with `*` → back (discards the partial entry, which is what they want).
- Caller pressed `*` first then started typing real digits: `*123` → starts with `*` → back.

We deliberately do not match `*` in the middle (e.g. `1*2`), because that's almost certainly a misfire we should let the downstream handler reject as invalid.

### 3. No handler-level changes needed

Because the interception happens at the top of `handleGatherResult` (before `dispatchNode`), every handler — `lookup_product`, `card_number`, `card_exp`, `card_cvv`, `cc_zip`, `validate_pin`, `cart_lookup_id`, `update_qty`, etc. — inherits the new behavior automatically. The existing menu-stack push/pop logic and the `_suppressStackPush` flag continue to work unchanged.

## Edge cases / non-issues

- **PIN entry**: pressing `*` mid-PIN cancels and goes back (to PIN re-entry's parent or the IVR welcome screen, whatever the stack holds). This is the desired UX.
- **Card number / CVV / ZIP**: same — caller can bail out of checkout at any digit prompt.
- **Quantity prompt** (`update_qty` etc.): `*` cancels and returns to the catalog/cart menu.
- **TelTech terminator multi-char support**: If TelTech turns out to only honor a single terminator character (unlikely given FreeSWITCH lineage, but possible), the server-side detection from step 2 is the safety net — the caller may have to also press `#` or wait for one digit_timeout, but `*` will still navigate back correctly. We verify multi-char support during manual test.
- **Voice-recording (`collect`) flows in checkout**: explicitly out of scope per the scope question — `*` will not work during voice address recording. Documented as a follow-up.
- **Stack-push logic**: unchanged. Origin node is still pushed when the response transitions to a new interactive node, deduped against the stack top.

## Manual test plan

1. Call in → PIN prompt → press `*` mid-PIN → should hear the pre-PIN prompt again (or main menu, depending on stack).
2. Login → main menu → "1" for catalog lookup → start typing a catalog number then press `*` → should land back on main menu.
3. Catalog lookup → product found → "1" Add to Cart → quantity prompt → press `*` → back to catalog_after_add.
4. Checkout → card number prompt → type a few digits then `*` → back to previous checkout step.
5. Checkout → card exp prompt (4 fixed digits) → press `*` after 1-2 digits → back to card number prompt. (This is the case that proves the terminator change works; without it the gather would wait for all 4 digits.)
6. Confirm voice-recording confirmation prompts are unaffected (still TelTech-handled).