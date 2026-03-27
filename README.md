# VoiceX

Voice-powered phone ordering system. Customers call a phone number, browse a product catalog, add items to cart, and checkout -- all via voice and keypad interaction powered by Twilio, with orders fulfilled through Amazon via Rye.

## Architecture

```
Caller (Kosher Phone)
   |
   v
Twilio Voice (IVR)
   |
   v
VoiceX API (Node/Express)
   |--- Supabase (Postgres)
   |--- Rye API (Amazon checkout)
   |--- Google Address Validation
   |--- Stripe (via Twilio Pay)
   |
Admin Portal (React/Vite)
```

## Quick Start

### Prerequisites

- Node.js >= 20
- npm >= 10
- Supabase project (or local with `supabase start`)
- Twilio account with a phone number
- Rye staging account
- Google Cloud project with Address Validation API enabled
- Stripe account (for Twilio Pay connector)

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

6. Configure your Twilio phone number webhook to:

```
POST https://your-domain.com/api/twilio/voice/inbound
```

## Project Structure

```
voicex/
├── apps/
│   ├── api/          # Node/Express API server
│   │   └── src/
│   │       ├── modules/
│   │       │   ├── twilio/     # Twilio voice handlers
│   │       │   ├── ivr/        # IVR flow runtime
│   │       │   ├── admin/      # Admin portal APIs
│   │       │   └── orders/     # Webhooks & order processing
│   │       └── lib/            # Supabase, Twilio, Rye, Google clients
│   └── admin-web/    # React admin portal (Vite + Tailwind)
├── packages/
│   └── shared/       # Shared TypeScript types & DTOs
├── supabase/
│   └── migrations/   # Database schema
└── .env.example
```

## IVR Call Flow

1. Call initiation: detect caller by phone number
2. New users: voice registration (name + PIN)
3. Existing users: PIN authentication
4. Main menu: Catalog / Cart / Orders
5. Catalog: enter product ID, hear details, add to cart
6. Cart: view summary, edit quantities, remove items
7. Checkout: address entry with Google validation, payment via Twilio Pay, order confirmation
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
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Twilio phone number |
| `RYE_API_KEY` | Rye API key |
| `GOOGLE_ADDRESS_VALIDATION_API_KEY` | Google API key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
