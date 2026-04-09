TelTech API Model — Developer Documentation
The API model ("type": "api") enables webhook-driven IVR where your external server dynamically controls the entire call flow via JSON. Think of it like Twilio's TwiML — but with JSON actions and full integration into TelTech's navigation system.

1. How It Works
Caller dials hotline
    ↓
FreeSWITCH loads config.json → type: "api"
    ↓
POST to YOUR server (api_url) with call info
    ↓
Your server returns {"actions": [...]}
    ↓
FreeSWITCH executes actions sequentially
    ↓
Actions like "gather" or "collect" can POST results
back to your server (action_url) for dynamic flow
All HTTP requests from the IVR to your server go through a secure proxy — your server never sees the IVR's real IP.

2. Extension Configuration
Create a config.json in any extension directory:

{
    "type": "api",
    "data": {
        "api_url": "https://yourserver.com/ivr/webhook",
        "api_auth": "Bearer your-secret-token",
        "hangup_url": "https://yourserver.com/ivr/hangup",
        "error_action": "hangup"
    }
}
Configuration Fields
Field	Required	Default	Description
api_url	Yes	—	Your webhook URL (must be HTTPS)
api_method	No	POST	HTTP method (POST, GET, PUT, DELETE)
api_auth	No	—	Authorization header value (e.g., "Bearer token123")
api_timeout	No	10	HTTP timeout in seconds
hangup_url	No	—	URL to notify when the caller hangs up (fire-and-forget POST)
error_action	No	hangup	"hangup", "continue", or a navigation path (e.g., "/3")
max_actions	No	50	Max actions per call (safety limit)
custom_params	No	{}	Extra key/value pairs included in every webhook call
wait_music	No	—	Audio file to play while waiting for the first webhook response
wait_music_on_first	No	false	Set to true to enable hold music on the first webhook call
error_webhook_url	No	—	URL to receive async error notifications (file not found, webhook failure, etc.)
fields	No	—	Array of fields to collect from the caller BEFORE the first webhook call (see Section 9)
summary_before_send	No	false	Read back all collected fields before making the first webhook call
allow_edit	No	false	Allow caller to edit fields during summary review
3. What Your Server Receives (Webhook Payload)
Every time the IVR calls your server, it sends a JSON POST body like this:

{
    "event": "new_call",
    "call_id": "a1b2c3d4-uuid",
    "caller_id": "15551234567",
    "did": "18001234567",
    "extension": "18001234567/3/",
    "timestamp": 1741600000,
    "variables": {}
}
Event Types
Event	When Sent	Extra Fields
new_call	Initial webhook when call arrives	collected (if config fields were pre-collected)
gather	After DTMF input collected	digits
record	After voice recording	recording_path
collect	After typed input collection	field_id, field_value, field_type, field_transcript
dial	After bridged call ends	dial_result, dial_duration, dial_number, recording_path
redirect	Redirect action called a different URL	(standard fields only)
hangup	Caller hung up (async, fire-and-forget)	(standard fields only)
The variables object contains all values stored during the call via set_variable and collect actions. These persist across all webhooks within the same call.

4. What Your Server Returns (Actions)
Your server must return a JSON object with an actions array. Actions are executed sequentially.

{
    "actions": [
        {"action": "say", "text": "Welcome to our service!"},
        {"action": "gather", "min_digits": 1, "max_digits": 1,
         "prompt": {"action": "say", "text": "Press 1 for sales, 2 for support."},
         "action_url": "https://yourserver.com/ivr/handle-menu"},
        {"action": "hangup"}
    ]
}
Available Actions (15 total)
Action	Purpose
say	Text-to-speech playback
play	Play an audio file
gather	Collect DTMF digits with a prompt
record	Record caller's voice
collect	Structured input (phone, date, text, email, amount, etc.)
message	Compound message (mix audio files + TTS + digits + dates)
dial	Bridge call to another number
stream	Play a live audio stream
send_digits	Send DTMF tones to the caller
pause	Silent pause (max 30 seconds)
goto	Navigate to a different IVR extension path
redirect	Call a different webhook URL and execute its actions
set_variable	Store a key/value pair for this call
hangup	End the call
Barge-in: All say and play actions support barge-in — if the caller presses a key during audio playback, the audio stops immediately and the pressed digit is automatically passed to the next gather or collect action. No configuration needed.

5. Action Reference — Detailed
5.1 — say
Converts text to speech and plays it to the caller.

{"action": "say", "text": "Hello, welcome!", "language": "english"}
Field	Required	Default	Description
text	Yes	—	Text to speak (max 500 characters)
language	No	english	TTS language
5.2 — play
Plays an audio file to the caller.

{"action": "play", "file": "welcome.wav"}
Field	Required	Description
file	Yes	Path to audio file (relative to extension directory, or absolute within allowed paths)
5.3 — gather
Collects DTMF digits from the caller. The most common action for building menus.

{
    "action": "gather",
    "min_digits": 1,
    "max_digits": 4,
    "timeout": 10000,
    "prompt": {"action": "say", "text": "Press 1 for sales, 2 for support."},
    "action_url": "https://yourserver.com/ivr/handle-menu"
}
Field	Required	Default	Description
min_digits	No	1	Minimum digits to collect
max_digits	No	1	Maximum digits to collect
timeout	No	5000	Timeout in milliseconds
terminator	No	#	Key that ends input (e.g., "#", "*")
tries	No	3	Number of retry attempts
regex	No	\d+	Regex pattern digits must match
digit_timeout	No	=timeout	Timeout between individual digits
prompt	No	—	Nested action: {"action": "say", "text": "..."} or {"action": "play", "file": "..."}
action_url	No	—	POST digits to this URL. Server returns new actions to execute.
Webhook receives: {"event": "gather", "digits": "1", ...}

Stored: variables.last_digits

5.4 — record
Records the caller's voice. Caller presses # to stop.

{
    "action": "record",
    "max_duration": 120,
    "beep": true,
    "action_url": "https://yourserver.com/ivr/recording-done"
}
Field	Default	Description
max_duration	60	Max recording length in seconds (capped at 300)
silence_threshold	200	Silence energy level to detect silence
silence_hits	3	Seconds of silence before auto-stop
beep	true	Play beep before recording
action_url	—	POST recording path to this URL
Stored: variables.last_recording

5.5 — collect (Advanced Input)
Collects structured, validated input with optional confirmation readback. Supports 13 input types.

{
    "action": "collect",
    "type": "phone",
    "id": "customer_phone",
    "prompt": {"action": "say", "text": "Please enter your phone number."},
    "confirm": true,
    "retry": 3,
    "action_url": "https://yourserver.com/ivr/phone-collected"
}
Supported Types
Type	Input Method	Stored As
number	DTMF digits + #	Raw digits (e.g., "42")
phone	DTMF 10-15 digits	Phone number (e.g., "15551234567")
date	8 digits (MMDDYYYY)	Formatted (e.g., "03/15/2026")
time	4 digits (HHMM)	Formatted (e.g., "14:30")
text	T9 multi-tap + #	Decoded text (e.g., "john")
email	T9 input + #	Email string
recording	Voice + #	File path to recording
voice	Voice + # (alias for recording)	File path to recording
choice	Single DTMF key	Option value (e.g., "sales")
yes_no	1 = yes, 2 = no	"yes" or "no"
amount	DTMF (dollars * cents) + #	Integer cents (e.g., "5350" = $53.50)
id_number	DTMF + #	Raw digits
credit_card	Delegates to payment module	"last4:txn_id"
Collect Parameters
Field	Default	Description
type	Required	One of the 13 types above
id	collect_result	Key name for storing the value in variables
prompt	auto-generated	Nested action object, plain TTS string, or omit for smart default
prompt_audio	—	Audio file path for the prompt (takes priority over prompt)
confirm	false	Read back value and ask 1=confirm, 2=re-enter
confirm_method	playback	For recordings: "playback", "transcribe", or "both"
transcribe	false	Run speech-to-text on recordings (Deepgram)
retry	3	Max retry attempts
required	true	If false, empty input is accepted
reuse	—	Reuse a previously collected value by key name (skips prompt)
auto	—	Auto-capture without prompting: "caller_id", "called_number", "timestamp", "uuid"
on_value	—	Route to an IVR path based on value: {"1": "/sales", "2": "/support"}
action_url	—	POST collected value to this URL
empty_allowed	false	Allow empty/no input
empty_value	""	Value to store if empty input accepted
allowed_chars	—	Restrict input to only these characters
char_replace	—	Character replacement map (e.g., {"*": "."})
Type-Specific Options
Option	Applies To	Description
min_digits / max_digits	number, phone, id_number	Digit count limits
min_value / max_value	number, amount	Numeric range validation
min_length / max_length	text	Text length limits
options	choice	Array of {"key": "1", "label": "Sales", "value": "sales"}
format	date	"MMDDYYYY" (default) or "DDMMYYYY"
regex	id_number	Lua pattern for format validation
default_source	phone	Set to "caller_id" to offer the caller's own number as default
max_duration	recording	Max recording seconds (capped at 300)
billing_sum	credit_card	Amount to charge
Stored in variables: variables[id] = the collected value, variables[id + "_text"] = transcript (for recordings with transcribe: true), variables.last_collect_value = most recent value.

5.6 — message (Compound Message Builder)
Build a complex message by combining multiple parts — audio files, TTS text, digit readback, dates, amounts, and call variables.

{
    "action": "message",
    "parts": [
        {"type": "file", "value": "greeting.wav"},
        {"type": "text", "value": "Your confirmation number is"},
        {"type": "digits", "value": "4 5 6"},
        {"type": "text", "value": "scheduled for"},
        {"type": "date", "value": "03/15/2026"},
        {"type": "text", "value": "at"},
        {"type": "time", "value": "14:30"},
        {"type": "text", "value": "Total amount:"},
        {"type": "amount", "value": "5350"},
        {"type": "variable", "key": "customer_phone", "format": "phone"},
        {"type": "silence", "value": "1000"}
    ]
}
Part Types
Type	value	Description
file	File path	Play an audio file
text	Text string	Text-to-speech
number	Number	Natural readback ("one hundred twenty-three")
digits	Digits string	Digit-by-digit readback ("four-five-six")
letters	Text	Letter-by-letter spelling ("J-O-H-N")
amount	Integer cents	Dollar readback (5350 → "fifty-three dollars and fifty cents")
date	MM/DD/YYYY	Date readback ("March fifteenth, twenty twenty-six")
time	HH:MM	Time readback ("2:30 PM")
variable	—	Read a call variable. Use key for the variable name and format for how to read it ("phone", "digits", "letters", "amount", "date", "time", or default TTS).
silence	Milliseconds	Silent pause (max 10 seconds)
5.7 — dial
Bridge the call to one or more phone numbers.

{
    "action": "dial",
    "number": "15551234567",
    "caller_id": "hotline",
    "timeout": 30,
    "record": true,
    "accept_key": "1",
    "accept_message": "You have a call from the hotline. Press 1 to accept.",
    "action_url": "https://yourserver.com/ivr/dial-result"
}
Field	Default	Description
number	Required*	Phone number to dial
numbers	—	Array of numbers for multi-party dialing
simultaneous	false	Ring all numbers at the same time (first to answer wins)
caller_id	caller	"caller" (pass-through), "hotline" (show the DID), or a custom number
timeout	30	Ring timeout in seconds (max 120)
record	false	Record the entire bridged call
accept_key	—	Key the callee must press to accept (e.g., "1"). Prevents voicemail pickup.
accept_message	—	TTS message played to the callee before the accept prompt
reject_goto	—	IVR path to navigate to if the call is rejected/unanswered
ring_music	—	Audio file to play to the caller while ringing
answer_message	—	TTS message played to the callee before connecting
action_url	—	POST dial result to this URL
Stored: variables.last_dial_result (disposition), variables.last_dial_duration, variables.last_dial_recording

5.8 — stream
Play a live internet audio stream to the caller.

{"action": "stream", "url": "https://live.example.com/radio", "exit_key": "*"}
Field	Default	Description
url	Required	Stream URL (HTTP/HTTPS, any format — converted automatically)
exit_key	*	DTMF key to exit the stream
5.9 — send_digits
{"action": "send_digits", "digits": "1234", "duration": 250}
Send DTMF tones to the caller. duration is per-digit in ms (50-1000, default 250).

5.10 — pause
{"action": "pause", "duration": 2000}
Silent pause in milliseconds (max 30,000 = 30 seconds).

5.11 — goto
{"action": "goto", "path": "/3"}
Navigate to another IVR extension path. Uses the standard navigation system — "/3" goes to main menu extension 3, "2" goes to relative subdirectory 2, "../" goes up one level.

5.12 — redirect
{"action": "redirect", "url": "https://other-server.com/ivr/webhook"}
Call a different webhook URL and execute the returned actions. Useful for handing off to another service.

5.13 — set_variable
{"action": "set_variable", "key": "customer_tier", "value": "premium"}
Store a key/value pair for this call. Available in variables on all subsequent webhooks.

5.14 — hangup
{"action": "hangup", "reason": "NORMAL_CLEARING"}
End the call. Default reason is NORMAL_CLEARING.

6. Complete Examples
Example 1: Simple Menu
config.json:

{
    "type": "api",
    "data": {
        "api_url": "https://yourserver.com/ivr/start",
        "api_auth": "Bearer abc123"
    }
}
Your server returns:

{
    "actions": [
        {"action": "say", "text": "Welcome to Acme Corp."},
        {"action": "gather",
         "min_digits": 1, "max_digits": 1, "timeout": 8000,
         "prompt": {"action": "say", "text": "Press 1 for sales, 2 for support, 3 for hours."},
         "action_url": "https://yourserver.com/ivr/menu-choice"}
    ]
}
When caller presses 1, your server at /ivr/menu-choice receives:

{"event": "gather", "digits": "1", "caller_id": "15551234567", ...}
Your server returns:

{
    "actions": [
        {"action": "say", "text": "Connecting you to sales."},
        {"action": "dial", "number": "15559876543", "caller_id": "hotline",
         "accept_key": "1", "accept_message": "Incoming sales call. Press 1 to accept."}
    ]
}
Example 2: Data Collection + Dynamic Response
{
    "actions": [
        {"action": "say", "text": "Let's set up your appointment."},

        {"action": "collect", "type": "phone", "id": "patient_phone",
         "prompt": "Enter your phone number, then pound.",
         "default_source": "caller_id", "confirm": true},

        {"action": "collect", "type": "date", "id": "appt_date",
         "prompt": "Enter your preferred date as month day year, 8 digits.",
         "confirm": true},

        {"action": "collect", "type": "choice", "id": "time_slot",
         "prompt": {"action": "say", "text": "Press 1 for morning, 2 for afternoon, 3 for evening."},
         "options": [
             {"key": "1", "label": "Morning", "value": "morning"},
             {"key": "2", "label": "Afternoon", "value": "afternoon"},
             {"key": "3", "label": "Evening", "value": "evening"}
         ],
         "confirm": true,
         "action_url": "https://yourserver.com/ivr/check-availability"}
    ]
}
When the choice is collected, your server at /ivr/check-availability receives all variables including patient_phone, appt_date, and time_slot. You can then return actions to confirm or offer alternatives.

Example 3: Message Builder
{
    "actions": [
        {"action": "set_variable", "key": "order_id", "value": "7892"},
        {"action": "set_variable", "key": "amount_cents", "value": "4599"},

        {"action": "message", "parts": [
            {"type": "text", "value": "Your order number is"},
            {"type": "variable", "key": "order_id", "format": "digits"},
            {"type": "silence", "value": "500"},
            {"type": "text", "value": "Total amount:"},
            {"type": "variable", "key": "amount_cents", "format": "amount"},
            {"type": "silence", "value": "500"},
            {"type": "text", "value": "Expected delivery date:"},
            {"type": "date", "value": "03/20/2026"}
        ]},

        {"action": "say", "text": "Thank you for your order. Goodbye."},
        {"action": "hangup"}
    ]
}
7. Config-Driven Field Pre-Collection
You can collect fields from the caller before the first webhook call. This is useful when you need data upfront to decide what to do.

{
    "type": "api",
    "data": {
        "api_url": "https://yourserver.com/ivr/start",
        "fields": [
            {"id": "account", "type": "number", "prompt": "Enter your account number.",
             "min_digits": 4, "max_digits": 8, "confirm": true},
            {"id": "pin", "type": "number", "prompt": "Enter your PIN.",
             "min_digits": 4, "max_digits": 4}
        ],
        "summary_before_send": true,
        "allow_edit": true
    }
}
The collected data is included in the first webhook payload:

{
    "event": "new_call",
    "caller_id": "15551234567",
    "collected": {
        "account": "12345678",
        "pin": "9876"
    },
    "variables": {
        "account": "12345678",
        "pin": "9876"
    },
    ...
}
Each field in the fields array supports the same options as the collect action (type, confirm, retry, action_url, on_value, etc.).

8. Safety Limits
Limit	Default	Purpose
Max actions per call	50	Prevents infinite action loops. Configurable via max_actions.
Max webhook calls per call	25	Prevents redirect/gather infinite loops.
Max recursion depth	10	Prevents nested redirect → redirect → redirect chains.
Max pause duration	30 seconds	Prevents abuse.
Max recording duration	300 seconds	Prevents disk abuse.
Max TTS text length	500 characters	Prevents oversized audio files crashing FreeSWITCH.
Max dial timeout	120 seconds	Max ring time.
Webhook timeout	10 seconds	Configurable via api_timeout. Keep responses fast!
9. Error Handling
When something goes wrong (webhook timeout, invalid response, etc.), the system follows the error_action setting:

"hangup" (default) — Play error message, hang up
"continue" — Set action_status = "error" and continue to next IVR step
A navigation path (e.g., "/5") — Play error message, navigate to that extension
If you configure error_webhook_url, the system will fire an async POST to that URL on errors:

{
    "event": "error",
    "error_type": "webhook_failure",
    "error_detail": "https://yourserver.com/ivr/start",
    "call_id": "uuid",
    "caller_id": "15551234567",
    "extension": "18001234567/3/",
    "timestamp": 1741600000
}
Error types: webhook_failure, file_not_found, collect_failed, loop_detected

10. Hangup Notifications
If you set hangup_url in the config, the system fires an async POST when the caller hangs up — even if they hang up mid-call. This is fire-and-forget (no response expected).

POST https://yourserver.com/ivr/hangup
{
    "event": "hangup",
    "call_id": "uuid",
    "caller_id": "15551234567",
    "did": "18001234567",
    "extension": "18001234567/3/",
    "timestamp": 1741600000,
    "variables": {
        "customer_phone": "15559876543",
        "last_digits": "1",
        ...
    }
}
11. Best Practices
Respond fast. Your webhook should return in under 2 seconds. The caller hears silence while waiting. Use wait_music if your first response is slow.
Keep TTS short. Max 500 characters per say action. Use message parts for complex announcements.
Use action_url for dynamic flows. Instead of returning all actions upfront, use gather/collect with action_url to make decisions server-side based on caller input.
Use set_variable to persist state. Variables survive across webhooks within the same call. Stored in variables on every callback.
Use confirm: true on important collect fields. The system reads back the value and asks 1=confirm, 2=re-enter. Catches input mistakes.
Use accept_key on dial. Prevents voicemail from "answering" the call. The callee must press a key to connect.
Handle hangups gracefully. Use hangup_url to log incomplete calls, clean up server state, or trigger follow-up workflows.
Use auto for silent data capture. {"action": "collect", "type": "phone", "id": "caller", "auto": "caller_id"} silently stores the caller's number without prompting.
TelTech IVR System — API Model Documentation v2.0
Last updated: March 16, 2026