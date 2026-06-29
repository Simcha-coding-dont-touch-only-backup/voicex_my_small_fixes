TelTech did a fix for the various support requests we sent their team

Here is what they sent us

-----------------------------------------

Good news — we've fixed this on our end. The webhook gather now does exactly what you described:

- "*" = immediate "back": it fires the moment it's pressed, no terminator needed (no more *#).
- "#" on the menu is ignored: a bare # no longer re-triggers the prompt, so the "Main Main Menu" doubling is gone.
- We also now tell you which key ended the gather, via a new "terminated_by" field in the gather POST.

To switch it on, add two fields to your Main Menu gather action, and read the new field on your side:

{
  "action": "gather",
  "min_digits": 1, "max_digits": 1, "timeout": 4000, "tries": 3,
  "back_key": "*",                 // * fires "back" immediately
  "ignore_bare_terminator": true,  // a bare # is ignored (no re-prompt)
  "prompt": { "action": "say", "text": "Main Menu! ..." },
  "action_url": "https://your-server/..."
}

In the gather POST you'll now receive "terminated_by":
  "*"  = back
  "#"  = submitted with #
  ""   = a digit auto-submitted (or a timeout)

So * now goes back instantly (no need for *#), and # on the menu is a silent no-op.