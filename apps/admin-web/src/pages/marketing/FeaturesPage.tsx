import { Link } from 'react-router-dom';
import {
  Phone,
  ShoppingCart,
  Package,
  CreditCard,
  MapPin,
  KeyRound,
  ArrowRight,
} from 'lucide-react';

export function FeaturesPage() {
  return (
    <>
      <PageHero />
      <CallerExperience />
      <IntegrationsAndSecurity />
      <CTA />
    </>
  );
}

function PageHero() {
  return (
    <section className="relative overflow-hidden bg-white">
      {/* Full-width banner background using inline style to ensure Vite/Tailwind loads it */}
      <div
        aria-hidden
        className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat opacity-70"
        style={{ backgroundImage: "url('/assets/features-hero-banner.jpg')" }}
      />
      <div
        aria-hidden
        className="absolute inset-0 z-[1] bg-gradient-to-b from-white/40 via-white/70 to-white"
      />
      <div
        aria-hidden
        className="absolute -top-40 right-1/2 z-[2] h-[600px] w-[1200px] translate-x-1/2 rounded-full bg-gradient-to-tr from-indigo-200/20 via-violet-200/20 to-transparent blur-3xl"
      />

      <div className="relative z-10 mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 sm:py-24 lg:px-8">
        <h1 className="font-bold tracking-tight text-slate-900">
          <span className="block text-3xl font-bold uppercase tracking-wide text-indigo-600 sm:text-4xl">
            Features
          </span>
          <span className="mt-4 block text-4xl sm:text-5xl">
            Everything you need to shop—without an app or a browser.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
          VoiceX is more than an IVR. It's a complete commerce experience on
          the call—catalog, cart, checkout, and delivery updates—purpose-built for
          customers who shop by phone.
        </p>
      </div>
    </section>
  );
}

const CALLER_FEATURES = [
  {
    icon: <Phone size={22} />,
    title: 'Frictionless call routing',
    text: 'Inbound callers are recognized by phone number and dropped straight into a personalized menu. New users register in under a minute.',
  },
  {
    icon: <KeyRound size={22} />,
    title: 'Secure PIN authentication',
    text: 'Each customer sets a private PIN at signup. PINs are stored hashed and rate-limited against brute force.',
  },
  {
    icon: <Package size={22} />,
    title: 'Audio-first product catalog',
    text: 'Callers enter a product ID and hear name, description, and price. Listings are synced from the merchant catalog in real time.',
  },
  {
    icon: <ShoppingCart size={22} />,
    title: 'Multi-item cart',
    text: 'Add, remove, or edit quantities. Cart state persists across calls so customers can pick up where they left off.',
  },
  {
    icon: <MapPin size={22} />,
    title: 'Address validation built in',
    text: 'Spoken or keyed-in addresses are normalized through Google Address Validation before checkout — no failed deliveries.',
  },
  {
    icon: <CreditCard size={22} />,
    title: 'Saved cards & secure payment',
    text: 'PCI-compliant payment via Sola/Cardknox. Returning customers check out in seconds with a tokenized card on file.',
  },
];

function CallerExperience() {
  return (
    <section className="bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Caller experience"
          title="A clean, predictable shopping flow."
          description="Every interaction is tuned for speed, clarity, and the kinds of customers who don't want to learn a new app."
        />
        <FeatureGrid features={CALLER_FEATURES} />
      </div>
    </section>
  );
}

function IntegrationsAndSecurity() {
  const integrations = [
    {
      label: 'Telephony',
      detail:
        'Cloud-hosted JSON IVR. DTMF-driven, fire-and-forget webhooks.',
    },
    {
      label: 'Database',
      detail:
        'PostgreSQL with row-level security on sensitive tables and admin data.',
    },
    {
      label: 'Fulfillment',
      detail:
        'Connected retailer checkout. Pluggable integrations per merchant.',
    },
    {
      label: 'Address validation',
      detail: 'Google Address Validation API for normalization & deliverability.',
    },
    {
      label: 'Payments',
      detail: 'Sola Payments (Cardknox) for tokenized, PCI-compliant cards.',
    },
    {
      label: 'Auth',
      detail:
        'Secure web sign-in for operators; phone-based PIN for end users.',
    },
  ];
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">
              Integrations & security
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Production-grade infrastructure.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Built on services that retailers and security teams already trust.
            </p>
            <div className="mt-10 overflow-hidden rounded-2xl bg-slate-100 shadow-sm ring-1 ring-slate-200/50">
              <img
                src="/assets/secure-data.jpg"
                alt="Secure digital data flowing through fiber optic cables"
                className="h-64 w-full object-cover sm:h-80"
              />
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-200">
              {integrations.map((row) => (
                <li
                  key={row.label}
                  className="grid gap-1 px-6 py-5 sm:grid-cols-3 sm:gap-6"
                >
                  <p className="text-sm font-semibold text-slate-900">
                    {row.label}
                  </p>
                  <p className="text-sm text-slate-600 sm:col-span-2">
                    {row.detail}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-lg leading-relaxed text-slate-600">{description}</p>
    </div>
  );
}

function FeatureGrid({
  features,
}: {
  features: { icon: React.ReactNode; title: string; text: string }[];
}) {
  return (
    <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {features.map((f) => (
        <div
          key={f.title}
          className="rounded-2xl border border-slate-200 bg-white p-6 transition-shadow hover:shadow-md"
        >
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white">
            {f.icon}
          </div>
          <h3 className="mt-5 text-lg font-semibold text-slate-900">
            {f.title}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.text}</p>
        </div>
      ))}
    </div>
  );
}

function CTA() {
  return (
    <section className="bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
        <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Want to see it live?
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-slate-600">
          We'll dial in a sample customer call and walk through the operator
          dashboard end to end.
        </p>
        <Link
          to="/contact"
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
        >
          Book a demo
          <ArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}
