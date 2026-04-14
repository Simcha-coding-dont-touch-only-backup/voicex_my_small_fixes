# VoiceX

Voice-powered phone ordering system. Customers call a phone number, browse a product catalog, add items to cart, and checkout -- all via keypad interaction powered by TelTech IVR, with orders fulfilled through Amazon via Rye.

## Architecture

```
Caller (Kosher Phone)
   |
   v
TelTech IVR (webhook-driven, JSON API)
   |
   v
VoiceX API (Node/Express)
   |--- Supabase (Postgres)
   |--- Rye API (Amazon checkout)
   |--- Google Address Validation
   |--- Stripe
   |
Admin Portal (React/Vite)
```

## Quick Start

### Prerequisites

- Node.js >= 20
- npm >= 10
- Supabase project (or local with `supabase start`)
- TelTech account with an extension configured for API mode
- Rye staging account
- Google Cloud project with Address Validation API enabled
- Stripe account

### Setup

1. Clone and install dependencies:

```bash
cd voicex
npm install
```

2. Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

3. Run database migrations:

```bash
npx supabase db push
```

4. Start the API server:

```bash
npm run dev:api
```

5. Start the admin portal:

```bash
npm run dev:admin
```

6. Configure your TelTech extension `config.json`:

```json
{
  "type": "api",
  "data": {
    "api_url": "https://your-domain.com/api/ivr/voice/inbound",
    "api_auth": "Bearer your-secret-token",
    "hangup_url": "https://your-domain.com/api/ivr/voice/status",
    "error_action": "hangup"
  }
}
```

## Project Structure

```
voicex/
├── apps/
│   ├── api/          # Node/Express API server
│   │   └── src/
│   │       ├── modules/
│   │       │   ├── teltech/    # TelTech IVR handlers & JSON action builders
│   │       │   ├── ivr/        # IVR flow runtime
│   │       │   ├── admin/      # Admin portal APIs
│   │       │   └── orders/     # Webhooks & order processing
│   │       └── lib/            # Supabase, TelTech types, Rye, Google clients
│   └── admin-web/    # React admin portal (Vite + Tailwind)
├── packages/
│   └── shared/       # Shared TypeScript types & DTOs
├── supabase/
│   └── migrations/   # Database schema
└── .env.example
```

## IVR Call Flow

1. Call initiation: detect caller by phone number
2. New users: registration (name + PIN via DTMF)
3. Existing users: PIN authentication
4. Main menu: Catalog / Cart / Orders
5. Catalog: enter product ID, hear details, add to cart
6. Cart: view summary, edit quantities, remove items
7. Checkout: address entry with Google validation, payment via saved card, order confirmation
8. Orders: hear recent order status

## Admin Portal

- **Users**: view/edit/freeze users, reset PINs, view login history
- **Categories**: hierarchical catalog categories (up to 3 levels)
- **Products**: manage VoiceX catalog with Amazon ASIN links, pricing, and overrides
- **Orders**: view all orders with filtering and detailed item/event views
- **Settings**: configure markup %, timeouts, and system parameters
- **Reports**: purchase reports with Excel export
- **IVR Flows**: create/edit IVR flow definitions, manage nodes, and publish versions

## Key Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side) |
| `TELTECH_API_AUTH` | Bearer token for TelTech webhook authentication |
| `RYE_API_KEY` | Rye API key |
| `GOOGLE_ADDRESS_VALIDATION_API_KEY` | Google API key |
| `SOLA_API_KEY` | Sola Payments (Cardknox) API key |

## Migration Note

This project was originally built on Twilio (TwiML/XML-based IVR). It was migrated to TelTech's JSON-based webhook API for better pricing. Key changes:

- **Protocol**: TwiML XML responses replaced with JSON `{actions: [...]}` responses
- **Input**: Speech recognition removed; all input is DTMF (keypad) only
- **Payments**: Twilio `<Pay>` removed; phone-based payment is stubbed pending TelTech payment docs. Existing saved cards still work.
- **Routes**: `/api/twilio/voice/*` replaced with `/api/ivr/voice/*`
- **Middleware**: `express.urlencoded()` replaced with `express.json()`
- **Dependencies**: `twilio` npm package removed entirely
