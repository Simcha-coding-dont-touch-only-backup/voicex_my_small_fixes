import { Link } from 'react-router-dom';
import {
  Phone,
  ShoppingCart,
  ShieldCheck,
  Zap,
  Headphones,
  ArrowRight,
  Check,
  Package,
  CreditCard,
  MapPin,
  PhoneCall,
} from 'lucide-react';

export function HomePage() {
  return (
    <>
      <Hero />
      <TrustBar />
      <Problem />
      <HowItWorks />
      <FeatureHighlights />
      <Metrics />
      <FinalCTA />
    </>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Decorative gradient background */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-indigo-50/70 via-white to-white"
      />
      <div
        aria-hidden
        className="absolute -top-40 right-1/2 -z-10 h-[600px] w-[1200px] translate-x-1/2 rounded-full bg-gradient-to-tr from-indigo-200/40 via-violet-200/40 to-transparent blur-3xl"
      />

      <div className="mx-auto max-w-7xl px-4 pt-20 pb-24 sm:px-6 sm:pt-28 sm:pb-32 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-xs font-medium text-slate-600 backdrop-blur">
            <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Live & taking real orders
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Shopping over the phone.
            <br />
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              Reimagined.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600 sm:text-xl">
            VoiceX turns a single phone call into a full shopping experience.
            Customers browse a catalog, check out, and track orders — entirely by
            keypad. No app, no internet, no friction.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/contact"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 transition-colors sm:w-auto"
            >
              Request a demo
              <ArrowRight size={16} />
            </Link>
            <Link
              to="/features"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors sm:w-auto"
            >
              See how it works
            </Link>
          </div>
          <p className="mt-6 text-sm text-slate-500">
            Built for non-internet phones. Works on any landline or feature phone.
          </p>
        </div>

        {/* Phone-mockup illustration */}
        <div className="mx-auto mt-16 max-w-4xl">
          <div className="relative rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-indigo-100/60">
            <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span className="ml-3 text-xs font-medium text-slate-400">
                Live call · 1-800-VOICE-X
              </span>
            </div>
            <div className="grid grid-cols-1 gap-6 p-6 sm:p-8 md:grid-cols-2">
              <CallTranscript />
              <CartPreview />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CallTranscript() {
  const lines = [
    { speaker: 'IVR', text: 'Welcome back, Sarah. Press 1 for catalog.' },
    { speaker: 'You', text: '1' },
    { speaker: 'IVR', text: 'Enter product ID.' },
    { speaker: 'You', text: '4 0 7 2' },
    { speaker: 'IVR', text: 'Premium coffee, $14.99. Press 1 to add.' },
    { speaker: 'You', text: '1' },
    { speaker: 'IVR', text: 'Added. Press 9 to checkout.' },
  ];
  return (
    <div className="rounded-xl bg-slate-50 p-5 ring-1 ring-slate-200">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <PhoneCall size={14} className="text-emerald-600" />
        Call in progress · 00:42
      </div>
      <div className="mt-4 space-y-3 text-sm">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`flex gap-2 ${
              line.speaker === 'You' ? 'justify-end' : ''
            }`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 ${
                line.speaker === 'You'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200'
              }`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
                {line.speaker}
              </p>
              <p className="mt-0.5 leading-snug">{line.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CartPreview() {
  const items = [
    { name: 'Premium coffee beans', qty: 2, price: 14.99 },
    { name: 'Stainless travel mug', qty: 1, price: 22.50 },
  ];
  const total = items.reduce((s, i) => s + i.qty * i.price, 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <ShoppingCart size={14} className="text-indigo-600" />
        Cart syncing in real time
      </div>
      <div className="mt-4 space-y-3">
        {items.map((item, i) => (
          <div
            key={i}
            className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5"
          >
            <div>
              <p className="text-sm font-medium text-slate-900">{item.name}</p>
              <p className="text-xs text-slate-500">Qty {item.qty}</p>
            </div>
            <p className="text-sm font-semibold text-slate-900">
              ${(item.qty * item.price).toFixed(2)}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
        <p className="text-sm text-slate-500">Total</p>
        <p className="text-lg font-bold text-slate-900">${total.toFixed(2)}</p>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-100">
        <Check size={14} />
        Address verified · Saved card on file
      </div>
    </div>
  );
}

function TrustBar() {
  const stats = [
    { label: 'Average call time', value: '< 4 min' },
    { label: 'Catalog size', value: '10,000+ SKUs' },
    { label: 'Order accuracy', value: '99.7%' },
    { label: 'Coverage', value: 'Any phone' },
  ];
  return (
    <section className="border-y border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label}>
              <p className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {s.value}
              </p>
              <p className="mt-1 text-sm text-slate-500">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">
              The problem
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Millions of people are left out of e-commerce.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Seniors, communities that opt out of the open internet, people with
              limited literacy, and customers in low-connectivity regions all
              share the same problem: they have a phone — and that's it.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Today, retailers either ignore them or rely on call centers staffed
              by humans. Both options leave money on the table and customers
              underserved.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <ProblemCard
              icon={<Phone size={20} />}
              title="No internet required"
              text="Works on any landline, flip phone, or restricted device."
            />
            <ProblemCard
              icon={<Headphones size={20} />}
              title="No call center"
              text="Fully automated. Scales infinitely. No staffing costs."
            />
            <ProblemCard
              icon={<ShieldCheck size={20} />}
              title="Secure by design"
              text="PIN authentication, saved cards, encrypted at every step."
            />
            <ProblemCard
              icon={<Zap size={20} />}
              title="Fulfilled instantly"
              text="Connected to live retail catalogs and shipping providers."
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function ProblemCard({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white text-indigo-600 ring-1 ring-slate-200">
        {icon}
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{text}</p>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: '01',
      icon: <Phone size={22} />,
      title: 'Customer calls',
      text: 'A unique phone number routes the caller into the VoiceX IVR. New users register in seconds with a name and PIN.',
    },
    {
      n: '02',
      icon: <Package size={22} />,
      title: 'Browse the catalog',
      text: 'Callers enter product IDs and hear pricing, descriptions, and availability — pulled live from the merchant catalog.',
    },
    {
      n: '03',
      icon: <MapPin size={22} />,
      title: 'Verify & checkout',
      text: 'Address verification via Google. Payment via saved card or Stripe. Confirmed in under a minute.',
    },
    {
      n: '04',
      icon: <CreditCard size={22} />,
      title: 'Order fulfilled',
      text: 'Orders are submitted automatically to the connected retailer and tracked end-to-end in the admin portal.',
    },
  ];

  return (
    <section className="bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">
            How it works
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            From dial tone to delivery in four steps.
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            Every call follows the same simple, reliable flow — designed to be
            fast, accessible, and frustration-free.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <div
              key={s.n}
              className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white">
                {s.icon}
              </div>
              <p className="mt-5 text-xs font-semibold tracking-wider text-slate-400">
                STEP {s.n}
              </p>
              <h3 className="mt-1 text-lg font-semibold text-slate-900">
                {s.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {s.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureHighlights() {
  const features = [
    {
      title: 'Hierarchical product catalog',
      text: 'Up to three levels of categories. Pricing overrides, ASIN linking, and image management.',
    },
    {
      title: 'Address validation',
      text: 'Google Address Validation built in. No more failed deliveries from typos.',
    },
    {
      title: 'Configurable IVR flows',
      text: 'A drag-and-drop flow editor lets ops teams change call logic without engineering.',
    },
    {
      title: 'Real-time order tracking',
      text: 'Every order, event, and call log is queryable from a single admin portal.',
    },
    {
      title: 'Role-based admin access',
      text: 'Super admins, full admins, and scoped sub-admins — granular permissions for ops teams.',
    },
    {
      title: 'Fraud-aware checkout',
      text: 'PIN-protected accounts, saved tokenized cards, and automatic suspicious-activity flags.',
    },
  ];

  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-end justify-between gap-6 sm:flex-row">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">
              Built for scale
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              An entire commerce stack — over the phone.
            </h2>
          </div>
          <Link
            to="/features"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
          >
            View all features
            <ArrowRight size={16} />
          </Link>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-slate-200 bg-white p-6 transition-shadow hover:shadow-md"
            >
              <Check size={18} className="text-indigo-600" strokeWidth={3} />
              <h3 className="mt-4 text-lg font-semibold text-slate-900">
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {f.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Metrics() {
  return (
    <section className="bg-slate-900 py-20 text-white sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-indigo-300">
              Why now
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              A massive, underserved segment.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-300">
              The non-internet shopper isn't a niche — it's tens of millions of
              households globally. VoiceX is the first commerce platform built
              specifically for them, with the infrastructure to scale to any
              merchant.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <MetricCard value="65M+" label="US households without smartphones or limited internet" />
            <MetricCard value="$80B" label="Estimated TAM for voice-first commerce in the US alone" />
            <MetricCard value="3.5x" label="Higher repeat-order rate vs. traditional call-center models" />
            <MetricCard value="100%" label="Automated — no live agent required" />
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5 backdrop-blur">
      <p className="text-3xl font-bold tracking-tight">{value}</p>
      <p className="mt-2 text-sm leading-snug text-slate-300">{label}</p>
    </div>
  );
}

function FinalCTA() {
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-700 px-8 py-14 text-center sm:px-16 sm:py-20">
          <div
            aria-hidden
            className="absolute -top-24 left-1/2 h-72 w-[600px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl"
          />
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            See VoiceX in action.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-indigo-100">
            We'd love to walk you through a live call and the operator dashboard.
            Reach out to schedule a personalized demo.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/contact"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-100 transition-colors sm:w-auto"
            >
              Request a demo
              <ArrowRight size={16} />
            </Link>
            <Link
              to="/features"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/30 bg-white/0 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10 transition-colors sm:w-auto"
            >
              Explore features
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
