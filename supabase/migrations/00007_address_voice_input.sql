-- Switch address collection from DTMF-only to voice recording with transcription.
-- Street address, apartment, city, and state are now spoken by the caller
-- and transcribed by TelTech/Deepgram. ZIP remains DTMF (5 digits).

UPDATE ivr_nodes SET
  prompt_text = 'Please say your street address after the beep, then press pound.',
  config = '{"input_type":"voice","timeout_seconds":15}'
WHERE node_key = 'checkout_address_line1';

UPDATE ivr_nodes SET
  prompt_text = 'Say your apartment or unit number after the beep, or press pound to skip.',
  config = '{"input_type":"voice","timeout_seconds":10}'
WHERE node_key = 'checkout_address_line2';

UPDATE ivr_nodes SET
  prompt_text = 'Please say your city name after the beep, then press pound.',
  config = '{"input_type":"voice","timeout_seconds":15}'
WHERE node_key = 'checkout_address_city';

UPDATE ivr_nodes SET
  prompt_text = 'Please say your state name or state code after the beep, then press pound.',
  config = '{"input_type":"voice","timeout_seconds":10}'
WHERE node_key = 'checkout_address_state';
