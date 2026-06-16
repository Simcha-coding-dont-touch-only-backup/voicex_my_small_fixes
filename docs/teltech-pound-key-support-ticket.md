# TelTech Support Ticket: Make a `gather` ignore the `#` key

**Subject:** How to make a `gather` ignore the `#` key (no terminate, no webhook, no re-prompt)?

## Goal

On one specific IVR `gather` menu (our "Main Menu"), we want the `#` key to be a
complete no-op. When a caller presses `#`, it should be ignored and the caller
should simply stay on the current menu — ideally without the prompt being
repeated and without any dead-air pause.

## Our setup

HTTP webhook IVR. The Main Menu is a single `gather` action with `min_digits: 1`,
`max_digits: 1`, `timeout: 4000`, `tries: 3`, `terminator: "*"` (we use `*` as our
universal "back" key), a `say` prompt, and an `action_url` that posts collected
digits back to our server.

## 1. The `gather` action our server returns for the Main Menu

```json
{
  "actions": [
    {
      "action": "gather",
      "min_digits": 1,
      "max_digits": 1,
      "timeout": 4000,
      "digit_timeout": 500,
      "tries": 3,
      "prompt": {
        "action": "say",
        "text": "Main Menu. To place an order, press 1. To manage your cart, press 2. For order status, press 3. For returns, press 4. Press 5 for Subscriptions."
      },
      "action_url": "https://OUR_HOST/api/ivr/voice/gather?call_sid=CALL_ID&node_key=main_menu",
      "terminator": "*",
      "regex": "[0-9*#]+"
    }
  ]
}
```

## 2. The webhook your platform POSTs to our `action_url` when the caller presses `#`

```json
{
  "event": "gather",
  "call_id": "CALL_ID",
  "caller_id": "1XXXXXXXXXX",
  "did": "OUR_DID",
  "extension": "OUR_EXT",
  "timestamp": 1750000000,
  "variables": { "last_digits": "#" },
  "digits": "#"
}
```

## 3. What we observe

- Pressing a normal key (e.g. `1`) posts `{"digits":"1"}` and works as expected.
- Pressing `#` posts `{"digits":"#"}` — i.e. `#` is captured as a literal
  character and submitted, even though `terminator` is `"*"` (not `#`). It still
  ends input and fires the webhook.
- We have no way, from our returned response, to make the platform "ignore that
  `#` and keep listening on the already-spoken prompt." Any response we return
  either re-speaks the menu (unwanted repeat) or arms a silent `gather` (which
  produces ~10 seconds of dead air over `timeout` × `tries`, then re-prompts
  anyway).

## 4. What we want

When the caller presses `#` on this one menu, we want it treated as if no key was
pressed: the gather should keep listening on the same prompt (no webhook fired,
or at least no re-prompt and no dead-air pause), until a valid `0–9` or our `*`
(back) key is pressed.

## 5. Questions

1. Can a `gather` be configured to completely ignore specific keys (e.g. `#`) so
   they neither end input nor fire the webhook — continuing to collect on the
   same prompt?
2. Does `regex` suppress submission of non-matching keys, or only filter the
   returned value? On a `max_digits: 1` gather, can a non-matching key like `#`
   be silently dropped instead of ending input?
3. Is there an `allowed_chars`/ignored-keys option for `gather` (similar to what
   `collect` supports)?
4. If `#` cannot be suppressed at the platform level, is there a recommended way
   to return a `gather` that resumes listening with no audio and no perceptible
   delay, so it behaves like the key was never pressed?
