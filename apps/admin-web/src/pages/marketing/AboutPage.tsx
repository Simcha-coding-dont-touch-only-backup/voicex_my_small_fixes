import { Link } from 'react-router-dom';
import { Heart, Sparkles, Compass, Shield, ArrowRight } from 'lucide-react';

export function AboutPage() {
  return (
    <>
      <PageHero />
      <Mission />
      <Story />
      <Values />
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
        style={{ backgroundImage: "url('/assets/about-hero-banner.jpg')" }}
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
            About VoiceX
          </span>
          <span className="mt-4 block text-4xl sm:text-5xl">
            Commerce should work for everyone — not just the connected.
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
          We started VoiceX after watching family members struggle to order the
          things they needed because every modern retailer assumed a smartphone,
          a credit card app, and a fast internet connection. We built the
          alternative.
        </p>
      </div>
    </section>
  );
}

const MISSION_QUOTES = [
  "The most underserved segment in commerce isn't a geography or a demographic — it's everyone whose phone doesn't run apps. VoiceX is the platform built for them.",
  "Commerce shouldn't require a smartphone, an app store, or a tutorial. If you can use a keypad, you should be able to browse, check out, and hear where your order is — on the same call.",
  "We meet people on the channel they already trust — the voice line — and connect them to real catalogs, verified addresses, and the same payment rigor shoppers expect everywhere else.",
];

function Mission() {
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-stretch lg:gap-16">
          <div className="flex flex-col">
            <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">
              Our mission
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Make every phone a storefront.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Hundreds of millions of people around the world have a phone and
              nothing else. They've been priced out, locked out, or simply never
              chose to enter the smartphone-only economy. They deserve the same
              shopping experience anyone else gets.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Our mission is to build the rails for voice-first commerce — so
              any merchant can serve any customer, on any phone, at any hour,
              without compromising on selection, price, or trust.
            </p>
            <div className="mt-10 overflow-hidden rounded-2xl bg-slate-100 shadow-sm ring-1 ring-slate-200/50">
              <img
                src="/assets/warehouse-boxes.jpg"
                alt="Neatly stacked shipping boxes in a modern fulfillment center"
                className="h-64 w-full object-cover sm:h-80"
              />
            </div>
          </div>
          <div className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-slate-50 p-6 sm:p-8 lg:h-full">
            <div className="flex flex-1 flex-col gap-5 sm:gap-6 lg:gap-7">
              {MISSION_QUOTES.map((quote, i) => (
                <blockquote
                  key={i}
                  className={`text-base leading-relaxed text-slate-800 sm:text-lg ${
                    i > 0
                      ? 'border-t border-slate-200 pt-5 sm:pt-6 lg:pt-7'
                      : ''
                  }`}
                >
                  &ldquo;{quote}&rdquo;
                </blockquote>
              ))}
            </div>
            <div className="mt-6 flex shrink-0 items-center gap-3 border-t border-slate-200 pt-6 sm:mt-7 sm:pt-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 text-sm font-semibold text-white">
                VX
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Founding team
                </p>
                <p className="text-xs text-slate-500">VoiceX</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Story() {
  const items = [
    {
      year: '2025',
      title: 'The first prototype',
      text: 'Built as a side project to help a family member order weekly essentials without a smartphone. The first call placed a real Amazon order in under 90 seconds.',
    },
    {
      year: '2026',
      title: 'Production-grade voice platform',
      text: 'We rebuilt the early stack into a professional production system—built for real call volume, healthier economics, and fast iteration once we moved past the prototype.',
    },
    {
      year: '2027',
      title: 'Strategic scale and partnerships',
      text: 'Looking ahead: more merchant partners, larger rollouts, and deeper product investment so voice commerce can scale—without losing the clarity and trust we built in the first chapters.',
    },
  ];
  return (
    <section className="bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">
          Our story
        </p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Built from a real need.
        </h2>
        <ol className="mt-12 space-y-10 border-l border-slate-200 pl-8">
          {items.map((item) => (
            <li key={item.year} className="relative">
              <span className="absolute -left-[37px] top-1 flex h-4 w-4 items-center justify-center">
                <span className="h-3 w-3 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 ring-4 ring-slate-50" />
              </span>
              <p className="text-sm font-semibold text-indigo-600">
                {item.year}
              </p>
              <h3 className="mt-1 text-xl font-semibold text-slate-900">
                {item.title}
              </h3>
              <p className="mt-2 text-base leading-relaxed text-slate-600">
                {item.text}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Values() {
  const values = [
    {
      icon: <Heart size={22} />,
      title: 'Accessibility first',
      text: 'Every design decision is judged by whether it works for the least-connected user — not just the average user.',
    },
    {
      icon: <Sparkles size={22} />,
      title: 'Polish matters',
      text: 'Voice is unforgiving. A two-second delay or a confusing prompt can lose a customer. We sweat every detail.',
    },
    {
      icon: <Compass size={22} />,
      title: 'Real-world pragmatism',
      text: 'We ship for production from day one. No mock data, no toy demos — every call goes through real systems with real money.',
    },
    {
      icon: <Shield size={22} />,
      title: 'Earn trust quietly',
      text: 'Security, privacy, and reliability are infrastructure, not marketing. We build them in, and we don\'t take shortcuts.',
    },
  ];
  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">
            Our values
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            How we build.
          </h2>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {values.map((v) => (
            <div
              key={v.title}
              className="rounded-2xl border border-slate-200 bg-white p-6"
            >
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white">
                {v.icon}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-slate-900">
                {v.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {v.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="bg-slate-50 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
        <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Let's build the future of voice commerce together.
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-slate-600">
          Whether you're a merchant, a partner, or an investor — we'd love to
          hear from you.
        </p>
        <Link
          to="/contact"
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
        >
          Get in touch
          <ArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}
