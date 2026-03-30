BS"D

npm run dev:api for the backend on port 3001
npm run dev:admin for the admin portal on port 5173
npm run dev:api & npm run dev:admin

TelTech IVR webhook: POST https://your-domain/api/ivr/voice/inbound
TelTech hangup URL: POST https://your-domain/api/ivr/voice/status
Configure in TelTech extension config.json with type "api" and api_auth Bearer token.

Admin   simcha@targetjump.com   /   VoiceX@246
Create new admin npm run create-admin -- <email> <password> [displayName]

RYE
Staging	- https://staging.api.rye.com/api/v1/
Production	 -  https://api.rye.com/api/v1/
Product Lookup - https://rye.com/docs/api-v2-experimental/api-reference/products/lookup-product

Google
https://console.cloud.google.com/
Address Validation API
AIzaSyCvK84EyW0rI8futLBSnZf4vvPyA17ywwI

Migration: Twilio -> TelTech (completed)
- Twilio TwiML XML replaced with TelTech JSON actions API
- Speech recognition dropped, DTMF-only
- Phone-based payment (Twilio Pay) stubbed pending TelTech payment docs
- Routes changed from /api/twilio/voice/* to /api/ivr/voice/*
- twilio npm package removed
