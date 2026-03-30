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
time	4 digits (HHMM)	